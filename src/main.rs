use std::env;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand, ValueEnum};
use mindflow::model::{AnchorConnection, EntryKind, StructureRelationship};
use mindflow::observation::{ObservationOutcome, ObservationRecord, OperationalObserver};
use mindflow::project::{
    AnchorMutationError, ChangeOperation, ChangeProposal, HistoricalSelectionError,
    CURRENT_FORMAT, DEFAULT_EVENT_PAGE_SIZE, MANIFEST_FILENAME,
};
use mindflow::project_map::{
    probe_mermaid as topology_probe_mermaid, view_mermaid as topology_view_mermaid,
};
use mindflow::soe::{HistoricalSelectionRequest, TemporalSourceRequest};
use mindflow::topology::{
    TopologyError, TopologyIncidenceSide, TopologyNode, TopologyQueryDirection, TopologySnapshot,
    DEFAULT_TOPOLOGY_PAGE_SIZE, DEFAULT_TOPOLOGY_VIEW_DEPTH, DEFAULT_TOPOLOGY_VIEW_NODES,
};
use mindflow::{Diagnostic, Project, Severity};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::json;

const UPDATE_HANDOFF: &str = include_str!("update-handoff.md");
const CHECK_SCHEMA: &str = "mindflow-check/v1";
const STATUS_SCHEMA: &str = "mindflow-status/v6";
const ERROR_SCHEMA: &str = "mindflow-error/v1";

#[derive(Debug, Parser)]
#[command(name = "mindflow", version, long_version = version_details(), about)]
struct Cli {
    /// Select a root for project-loading commands; update-handoff and bridge reject this option.
    #[arg(long, global = true, value_name = "PATH")]
    root: Option<PathBuf>,

    #[command(subcommand)]
    command: Command,
}

fn version_details() -> &'static str {
    static DETAILS: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
        format!(
            "{}\nProject format: {CURRENT_FORMAT}\nBridge protocol: {}",
            env!("CARGO_PKG_VERSION"),
            mindflow::bridge::PROTOCOL_VERSION
        )
    });
    DETAILS.as_str()
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Report this runtime and the selected project's explicit adoption, or Unknown.
    Version {
        #[arg(long)]
        json: bool,
    },
    /// Create an empty legal Mindflow region in an existing Git worktree directory.
    Init,
    /// Print the static root-independent update handoff without loading a project.
    ///
    /// This command rejects --root and may be run from any directory.
    UpdateHandoff,
    /// Validate the project infrastructure and every managed document.
    Check {
        /// Emit validity and diagnostics as JSON.
        #[arg(long)]
        json: bool,
    },
    /// Show semantic navigation and validation state.
    Status {
        /// Emit the complete current semantic map as JSON.
        #[arg(long)]
        json: bool,
    },
    /// Measure current documentation volume and recent Git growth without changing project state.
    Qc {
        /// Recent first-parent commit samples; the oldest is the baseline (1..=100).
        #[arg(long, conflicts_with_all = ["from", "to", "list_commits"])]
        commits: Option<usize>,
        /// Inclusive baseline commit, as an exact full hash.
        #[arg(long, requires = "to", conflicts_with = "list_commits")]
        from: Option<String>,
        /// Inclusive ending commit hash, or working-tree.
        #[arg(long, requires = "from", conflicts_with = "list_commits")]
        to: Option<String>,
        /// List a page of selectable first-parent commits, newest first.
        #[arg(long)]
        list_commits: bool,
        /// Number of newer commits to skip when listing choices.
        #[arg(long, requires = "list_commits")]
        offset: Option<usize>,
        #[arg(long)]
        json: bool,
    },
    /// Inspect the selected directory hierarchy, filesystem context, and relationships.
    Topology {
        #[command(subcommand)]
        command: TopologyCommand,
    },
    /// Emit the complete filesystem-derived Structure as JSON.
    Map,
    /// Emit the complete adapter projection as JSON.
    #[command(hide = true)]
    Graph,
    /// Inspect the current Opening.
    Opening {
        #[command(subcommand)]
        command: OpeningCommand,
    },
    /// Inspect Evolve history or form a bounded historical selection.
    Evolve {
        #[command(subcommand)]
        command: EvolveCommand,
    },
    /// Inspect or change stable Git-backed anchors.
    Anchor {
        #[command(subcommand)]
        command: AnchorCommand,
    },
    /// Preview or apply one typed invariant-preserving semantic change.
    Change {
        #[command(subcommand)]
        command: ChangeCommand,
    },
    /// Serve the framed headless adapter protocol over standard input and output.
    Bridge,
}

#[derive(Debug, Subcommand)]
enum TopologyCommand {
    /// Resolve one exact component identity or binding.
    Resolve {
        /// Exact stable component identity or binding value.
        address: String,
        /// Emit the complete resolution as JSON.
        #[arg(long)]
        json: bool,
    },
    /// Page immediate primary children of a component or the Region root.
    List {
        /// Exact component identity or binding; omit for the Region root.
        address: Option<String>,
        /// Start at this zero-based child position.
        #[arg(long, default_value_t = 0)]
        offset: usize,
        /// Return at most this many immediate children.
        #[arg(long, default_value_t = DEFAULT_TOPOLOGY_PAGE_SIZE)]
        limit: usize,
        /// Emit the complete page as JSON.
        #[arg(long)]
        json: bool,
    },
    /// Page authored ordinary relationships incident to one component.
    Neighbors {
        /// Exact stable component identity or binding value.
        address: String,
        /// Select outgoing, incoming, or all authored incidence.
        #[arg(long, value_enum, default_value_t = TopologyDirectionArg::Both)]
        direction: TopologyDirectionArg,
        /// Keep one exact declared ordinary relationship type; repeat to keep more.
        #[arg(long = "type", value_name = "RELATIONSHIP-TYPE")]
        relationship_type: Vec<String>,
        /// Start at this zero-based incidence position.
        #[arg(long, default_value_t = 0)]
        offset: usize,
        /// Return at most this many incidences.
        #[arg(long, default_value_t = DEFAULT_TOPOLOGY_PAGE_SIZE)]
        limit: usize,
        /// Emit the complete page as JSON.
        #[arg(long)]
        json: bool,
    },
    /// Read one exact captured bound document.
    Read {
        /// Exact stable component identity or bound path.
        address: String,
        /// Emit the content envelope as JSON instead of exact raw bytes.
        #[arg(long)]
        json: bool,
    },
    /// Form one depth- and node-budgeted primary-containment view.
    View {
        /// Exact component identity or binding; omit for the Region root.
        address: Option<String>,
        /// Expand primary containment through this many levels.
        #[arg(long, default_value_t = DEFAULT_TOPOLOGY_VIEW_DEPTH)]
        depth: usize,
        /// Refuse rather than return more than this many nodes.
        #[arg(long, default_value_t = DEFAULT_TOPOLOGY_VIEW_NODES)]
        max_nodes: usize,
        /// Emit the complete bounded view as JSON.
        #[arg(long, conflicts_with = "mermaid")]
        json: bool,
        /// Emit a generated Mermaid hierarchy projection.
        #[arg(long, conflicts_with = "json")]
        mermaid: bool,
    },
    /// Combine one directory scope's bounded hierarchy with relationships on that scope.
    Probe {
        /// Exact registered directory identity or directory path; omit for the Region root.
        address: Option<String>,
        /// Expand primary containment through this many levels.
        #[arg(long, default_value_t = DEFAULT_TOPOLOGY_VIEW_DEPTH)]
        depth: usize,
        /// Refuse rather than return more than this many structure and boundary nodes.
        #[arg(long, default_value_t = DEFAULT_TOPOLOGY_VIEW_NODES)]
        max_nodes: usize,
        /// Emit the complete probe as JSON.
        #[arg(long, conflicts_with = "mermaid")]
        json: bool,
        /// Emit one Mermaid hierarchy with unexpanded focus-relationship peers.
        #[arg(long, conflicts_with = "json")]
        mermaid: bool,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum TopologyDirectionArg {
    Outgoing,
    Incoming,
    Both,
}

impl From<TopologyDirectionArg> for TopologyQueryDirection {
    fn from(value: TopologyDirectionArg) -> Self {
        match value {
            TopologyDirectionArg::Outgoing => Self::Outgoing,
            TopologyDirectionArg::Incoming => Self::Incoming,
            TopologyDirectionArg::Both => Self::Both,
        }
    }
}

#[derive(Debug, Subcommand)]
enum AnchorCommand {
    /// List configured anchor definitions.
    List,
    /// Show one anchor, its current file, and its historical connections.
    Show {
        /// Name of the anchor to inspect.
        name: String,
    },
    /// Create one persistent exact reference.
    Create {
        /// Name of the anchor to create.
        name: String,
        /// Resolve the anchor at this Git revision.
        #[arg(long, value_name = "REVISION", default_value = "HEAD")]
        at: String,
        /// Categorize this managed document as the anchor's current file.
        #[arg(long, value_name = "PATH")]
        file: String,
        /// Add one typed connection to a path at the resolved revision.
        #[arg(
            long,
            value_names = ["TYPE", "PATH"],
            num_args = 2,
            action = clap::ArgAction::Append
        )]
        connection: Vec<String>,
        /// Record an optional human-readable description.
        #[arg(long, value_name = "TEXT")]
        description: Option<String>,
    },
    /// Remove one current reference.
    Remove {
        /// Name of the anchor to remove.
        name: String,
    },
}

#[derive(Debug, Subcommand)]
enum OpeningCommand {
    /// Show every explicitly selected Opening file.
    Show {
        /// Emit the complete Opening as JSON.
        #[arg(long)]
        json: bool,
    },
}

#[derive(Debug, Subcommand)]
enum EvolveCommand {
    /// Page the ordered authored Event sequence.
    Events {
        /// Emit the Event page as JSON.
        #[arg(long)]
        json: bool,
        /// Start at this zero-based Event position.
        #[arg(long, default_value_t = 0)]
        offset: usize,
        /// Return at most this many Events; JSON defaults to the protocol page size.
        #[arg(long)]
        limit: Option<usize>,
    },
    /// Form one request-local historical selection.
    Select {
        /// State the exact present concern that bounds this selection.
        #[arg(long, value_name = "TEXT")]
        concern: String,
        /// Add one exact historical revision and repository path.
        #[arg(
            long,
            value_names = ["REVISION", "PATH"],
            num_args = 2,
            action = clap::ArgAction::Append
        )]
        source: Vec<String>,
        /// Include one anchor and all of its typed historical connections.
        #[arg(long, value_name = "NAME")]
        anchor: Vec<String>,
        /// Add one explicit instruction without changing project state.
        #[arg(long, value_name = "TEXT")]
        instruction: Vec<String>,
    },
}

#[derive(Debug, Subcommand)]
enum ChangeCommand {
    /// Validate one typed operation and emit its exact carrier proposal.
    Plan {
        /// Read the operation JSON from this path, or `-` for standard input.
        #[arg(long, value_name = "PATH|-", default_value = "-")]
        input_json: String,
    },
    /// Re-form and atomically apply one exact proposal.
    Apply {
        /// Read the proposal JSON from this path, or `-` for standard input.
        #[arg(long, value_name = "PATH|-", default_value = "-")]
        input_json: String,
    },
}

fn main() -> ExitCode {
    let observer = match OperationalObserver::from_environment() {
        Ok(observer) => observer,
        Err(error) => {
            eprintln!("error: cannot enable runtime observation: {error:#}");
            return ExitCode::from(2);
        }
    };
    let invocation_span = observer.start();
    let parse_span = observer.start();
    let cli = match Cli::try_parse() {
        Ok(cli) => {
            if let Err(error) = observer.record(
                &parse_span,
                ObservationRecord {
                    scope: "cli",
                    operation: "parse",
                    outcome: ObservationOutcome::Success,
                    snapshot: None,
                    result_count: None,
                    response_bytes: None,
                    continuation: None,
                },
            ) {
                eprintln!("error: cannot record runtime observation: {error:#}");
                return ExitCode::from(2);
            }
            cli
        }
        Err(error) => {
            let exit = error.exit_code().clamp(0, u8::MAX as i32) as u8;
            let outcome = if exit == 0 {
                ObservationOutcome::Success
            } else {
                ObservationOutcome::Error
            };
            let recorded = observer
                .record(
                    &parse_span,
                    ObservationRecord {
                        scope: "cli",
                        operation: "parse",
                        outcome,
                        snapshot: None,
                        result_count: None,
                        response_bytes: None,
                        continuation: None,
                    },
                )
                .and_then(|_| {
                    observer.record(
                        &invocation_span,
                        ObservationRecord {
                            scope: "cli",
                            operation: "invocation",
                            outcome,
                            snapshot: None,
                            result_count: None,
                            response_bytes: None,
                            continuation: None,
                        },
                    )
                });
            if let Err(observation_error) = recorded {
                eprintln!("error: cannot record runtime observation: {observation_error:#}");
                return ExitCode::from(2);
            }
            if let Err(print_error) = error.print() {
                eprintln!("error: cannot print command-line result: {print_error}");
                return ExitCode::from(2);
            }
            return ExitCode::from(exit);
        }
    };
    let structured = cli.structured_output();
    let operation = cli.command.observation_name();
    let command_span = observer.start();
    let result = run(cli, &observer);
    let outcome = match &result {
        Ok(code) if *code == ExitCode::SUCCESS => ObservationOutcome::Success,
        Ok(_) => ObservationOutcome::Refused,
        Err(_) => ObservationOutcome::Error,
    };
    if let Err(error) = observer
        .record(
            &command_span,
            ObservationRecord {
                scope: "cli",
                operation,
                outcome,
                snapshot: None,
                result_count: None,
                response_bytes: None,
                continuation: None,
            },
        )
        .and_then(|_| {
            observer.record(
                &invocation_span,
                ObservationRecord {
                    scope: "cli",
                    operation: "invocation",
                    outcome,
                    snapshot: None,
                    result_count: None,
                    response_bytes: None,
                    continuation: None,
                },
            )
        })
    {
        eprintln!("error: cannot record runtime observation: {error:#}");
        return ExitCode::from(2);
    }

    match result {
        Ok(code) => code,
        Err(error) => {
            if structured {
                eprintln!(
                    "{}",
                    serde_json::to_string(&json!({
                        "schema": ERROR_SCHEMA,
                        "error": {
                            "kind": "runtime",
                            "message": format!("{error:#}"),
                        }
                    }))
                    .expect("error envelope always serializes")
                );
            } else {
                eprintln!("error: {error:#}");
            }
            ExitCode::from(2)
        }
    }
}

impl Command {
    fn observation_name(&self) -> &'static str {
        match self {
            Self::Version { .. } => "version",
            Self::Init => "init",
            Self::UpdateHandoff => "update-handoff",
            Self::Check { .. } => "check",
            Self::Status { .. } => "status",
            Self::Qc { .. } => "qc",
            Self::Topology { command } => command.observation_name(),
            Self::Map => "map",
            Self::Graph => "graph",
            Self::Opening { .. } => "opening.show",
            Self::Evolve { command } => match command {
                EvolveCommand::Events { .. } => "evolve.events",
                EvolveCommand::Select { .. } => "evolve.select",
            },
            Self::Anchor { command } => match command {
                AnchorCommand::List => "anchor.list",
                AnchorCommand::Show { .. } => "anchor.show",
                AnchorCommand::Create { .. } => "anchor.create",
                AnchorCommand::Remove { .. } => "anchor.remove",
            },
            Self::Change { command } => match command {
                ChangeCommand::Plan { .. } => "change.plan",
                ChangeCommand::Apply { .. } => "change.apply",
            },
            Self::Bridge => "bridge",
        }
    }
}

impl Cli {
    fn structured_output(&self) -> bool {
        match &self.command {
            Command::Version { json } | Command::Check { json } | Command::Status { json } | Command::Qc { json, .. } => *json,
            Command::Topology { command } => command.output_json(),
            Command::Map | Command::Graph | Command::Change { .. } => true,
            Command::Opening { command } => match command {
                OpeningCommand::Show { json } => *json,
            },
            Command::Evolve { command } => match command {
                EvolveCommand::Events { json, .. } => *json,
                EvolveCommand::Select { .. } => true,
            },
            Command::Init | Command::UpdateHandoff | Command::Anchor { .. } | Command::Bridge => {
                false
            }
        }
    }
}

fn run(cli: Cli, observer: &OperationalObserver) -> Result<ExitCode> {
    if let Command::Version { json } = &cli.command {
        // Detection never falls back to a legacy parser or stamps adoption.
        // Missing, unsupported and unavailable projects share one unknown value.
        let project = resolve_root(cli.root.as_deref()).ok()
            .and_then(|root| Project::load(root).ok());
        let report = mindflow::version::VersionReport::new(project.as_ref());
        if *json {
            println!("{}", serde_json::to_string_pretty(&report)?);
        } else {
            println!("Core/CLI: {}", report.runtime.release);
            println!("Supported project format: {}", report.runtime.project_format);
            println!("Bridge protocol: {}", report.runtime.bridge_protocol);
            println!("Project format: {}", report.project.format.as_deref().unwrap_or("Unknown"));
            println!("Project adopted release: {}", report.project.adopted_release.as_deref().unwrap_or("Unknown"));
        }
        return Ok(ExitCode::SUCCESS);
    }
    if let Command::Init = &cli.command {
        let root = cli
            .root
            .clone()
            .unwrap_or(env::current_dir().context("cannot read current directory")?);
        return initialize(root);
    }
    if let Command::UpdateHandoff = &cli.command {
        if cli.root.is_some() {
            bail!(
                "update-handoff is root-independent and does not accept --root; run `mindflow update-handoff` from any directory"
            );
        }
        return print_update_handoff();
    }
    if let Command::Bridge = &cli.command {
        if cli.root.is_some() {
            bail!("bridge does not accept --root");
        }
        mindflow::bridge::serve_stdio()?;
        return Ok(ExitCode::SUCCESS);
    }
    let resolve_span = observer.start();
    let root_result = resolve_root(cli.root.as_deref());
    let resolve_span = resolve_span.finish();
    observer.record(
        &resolve_span,
        ObservationRecord {
            scope: "cli",
            operation: "root.resolve",
            outcome: if root_result.is_ok() {
                ObservationOutcome::Success
            } else {
                ObservationOutcome::Error
            },
            snapshot: None,
            result_count: None,
            response_bytes: None,
            continuation: None,
        },
    )?;
    let root = root_result?;

    let load_span = observer.start();
    let project_result = Project::load(root);
    let load_span = load_span.finish();
    let (load_outcome, load_snapshot) = match &project_result {
        Ok(project) => (
            ObservationOutcome::Success,
            Some(project.snapshot_identity().id.as_str()),
        ),
        Err(_) => (ObservationOutcome::Error, None),
    };
    observer.record(
        &load_span,
        ObservationRecord {
            scope: "core",
            operation: "project.capture",
            outcome: load_outcome,
            snapshot: load_snapshot,
            result_count: None,
            response_bytes: None,
            continuation: None,
        },
    )?;
    let project = project_result?;

    match cli.command {
        Command::Version { .. } => unreachable!("version detection precedes required project discovery"),
        Command::Init => unreachable!("initialization returns before project discovery"),
        Command::UpdateHandoff => {
            unreachable!("update-handoff returns before project discovery")
        }
        Command::Check { json } => check(&project, json),
        Command::Status { json } => status(&project, json),
        Command::Qc { commits, from, to, list_commits, offset, json } => {
            let diagnostics = project.diagnostics();
            if Project::has_errors(&diagnostics) {
                eprint_diagnostics(&diagnostics);
                eprintln!("error: refusing documentation QC from an invalid current project");
                return Ok(ExitCode::from(1));
            }
            if list_commits {
                let history = mindflow::documentation_qc::history_choices(&project, offset.unwrap_or(0))?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&history)?);
                } else {
                    for point in &history.commits {
                        println!("{}\t{}\t{}", point.commit.as_deref().unwrap(), point.timestamp.unwrap(), point.subject);
                    }
                    if history.has_more {
                        println!("More commits available with --offset {}", history.offset + history.commits.len());
                    }
                }
                return Ok(ExitCode::SUCCESS);
            }
            let window = match (from, to) {
                (Some(start), Some(end)) => mindflow::documentation_qc::QcWindow::Range { start, end },
                _ => mindflow::documentation_qc::QcWindow::Recent { commits: commits.unwrap_or(mindflow::documentation_qc::DEFAULT_COMMITS) },
            };
            let report = mindflow::documentation_qc::observe_window(&project, window)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&report)?);
            } else {
                let working_tree = report.points.last().is_some_and(|point| point.kind == "working-tree");
                println!("Documentation QC: current registered document paths; {} commit samples{}",
                    report.points.iter().filter(|point| point.kind == "commit").count(),
                    if working_tree { " + captured working tree" } else { " (ending at selected commit)" });
                if report.points.len() == 1 {
                    println!("No comparison interval; only selected endpoint volume is available.");
                } else {
                    println!("Oldest displayed commit is the baseline.");
                }
                if report.shallow_history {
                    println!("Shallow Git history: earlier commits may be unavailable.");
                }
                println!("Current paths only. Renames are not followed; removed/unregistered documents are excluded.");
                println!("End lines\tEnd bytes\tNet lines\tAdded\tDeleted\tPath");
                for entry in &report.entries {
                    let now = entry.samples.last().unwrap();
                    let growth = if entry.samples.len() > 1 {
                        format!("{:+}", now.lines as i64 - entry.samples[0].lines as i64)
                    } else { "Unknown".into() };
                    let added: usize = entry.samples.iter().filter_map(|sample| sample.added_lines).sum();
                    let deleted: usize = entry.samples.iter().filter_map(|sample| sample.deleted_lines).sum();
                    let added = if entry.samples.len() > 1 { added.to_string() } else { "Unknown".into() };
                    let deleted = if entry.samples.len() > 1 { deleted.to_string() } else { "Unknown".into() };
                    let path = if entry.path.is_empty() { "." } else { &entry.path };
                    println!("{}\t{}\t{growth}\t{added}\t{deleted}\t{path}{}", now.lines, now.bytes,
                        if entry.kind == "directory" { "/" } else { "" });
                }
            }
            Ok(ExitCode::SUCCESS)
        }
        Command::Topology { command } => topology(&project, command, observer),
        Command::Map => project_map(&project),
        Command::Graph => graph(&project),
        Command::Opening { command } => opening(&project, command),
        Command::Evolve { command } => evolve(&project, command),
        Command::Anchor { command } => anchor(&project, command),
        Command::Change { command } => change(&project, command),
        Command::Bridge => unreachable!("bridge returns before project discovery"),
    }
}

impl TopologyCommand {
    fn observation_name(&self) -> &'static str {
        match self {
            Self::Resolve { .. } => "topology.resolve",
            Self::List { .. } => "topology.list",
            Self::Neighbors { .. } => "topology.neighbors",
            Self::Read { .. } => "topology.read",
            Self::View { .. } => "topology.view",
            Self::Probe { .. } => "topology.probe",
        }
    }

    fn output_json(&self) -> bool {
        match self {
            Self::Resolve { json, .. }
            | Self::List { json, .. }
            | Self::Neighbors { json, .. }
            | Self::Read { json, .. }
            | Self::View { json, .. }
            | Self::Probe { json, .. } => *json,
        }
    }
}

fn print_update_handoff() -> Result<ExitCode> {
    let stdout = io::stdout();
    let mut output = stdout.lock();
    output
        .write_all(UPDATE_HANDOFF.as_bytes())
        .context("cannot write update handoff")?;
    output.flush().context("cannot flush update handoff")?;
    Ok(ExitCode::SUCCESS)
}

fn initialize(root: PathBuf) -> Result<ExitCode> {
    let project = Project::initialize(root)?;
    println!(
        "Initialized empty Mindflow region: {}",
        project.root.display()
    );
    Ok(ExitCode::SUCCESS)
}

fn resolve_root(explicit: Option<&Path>) -> Result<PathBuf> {
    match explicit {
        Some(root) => {
            let root = root
                .canonicalize()
                .with_context(|| format!("cannot access project root `{}`", root.display()))?;
            if !root.join(MANIFEST_FILENAME).is_file() {
                bail!("`{}` does not contain {MANIFEST_FILENAME}", root.display());
            }
            Ok(root)
        }
        None => Project::discover(&env::current_dir().context("cannot read current directory")?),
    }
}

fn check(project: &Project, output_json: bool) -> Result<ExitCode> {
    let diagnostics = project.diagnostics();
    let valid = !Project::has_errors(&diagnostics);

    if output_json {
        print_json(&json!({
            "schema": CHECK_SCHEMA,
            "snapshot": project.snapshot_identity(),
            "valid": valid,
            "diagnostics": diagnostics,
        }))?;
    } else if diagnostics.is_empty() {
        println!(
            "Mindflow region is valid: {}, {}, {}.",
            counted(project.manifest.components.len(), "component", "components"),
            counted(project.managed_files.len(), "document", "documents"),
            counted(
                project.manifest.relationships.len(),
                "relationship",
                "relationships"
            )
        );
    } else {
        print_diagnostics(&diagnostics);
        println!(
            "{} error(s), {} warning(s).",
            diagnostics
                .iter()
                .filter(|item| item.severity == Severity::Error)
                .count(),
            diagnostics
                .iter()
                .filter(|item| item.severity == Severity::Warning)
                .count()
        );
    }

    Ok(if valid {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    })
}

fn status(project: &Project, output_json: bool) -> Result<ExitCode> {
    let status = project.status();
    let valid = status.valid;

    if output_json {
        let region = if valid {
            Some(
                project
                    .region_index()
                    .expect("valid status has a Region index"),
            )
        } else {
            None
        };
        print_json(&json!({
            "schema": STATUS_SCHEMA,
            "status": status,
            "region": region,
        }))?;
    } else {
        println!("Mindflow region: {}", project.root.display());
        println!("{} components; {} documents; {} relationships; {} Opening files; {} Events; {} Anchors",status.components,status.documents,status.relationships,status.opening_files,status.evolve_events,status.anchors);
        if valid {
            for node in project.structure().unwrap().nodes {
                println!("{}", topology_node_record(&node));
            }
        }
        print_diagnostics(&status.diagnostics);
    }

    Ok(if valid {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    })
}

fn topology(
    project: &Project,
    command: TopologyCommand,
    observer: &OperationalObserver,
) -> Result<ExitCode> {
    let snapshot = project.snapshot_identity().id.as_str();
    let snapshot_span = observer.start();
    let topology_result = TopologySnapshot::new(project);
    let snapshot_span = snapshot_span.finish();
    let snapshot_outcome = match &topology_result {
        Ok(_) => ObservationOutcome::Success,
        Err(TopologyError::CurrentInvalid(_)) => ObservationOutcome::Refused,
        Err(TopologyError::Runtime(_)) => ObservationOutcome::Error,
    };
    observer.record(
        &snapshot_span,
        ObservationRecord {
            scope: "core",
            operation: "topology.snapshot",
            outcome: snapshot_outcome,
            snapshot: Some(snapshot),
            result_count: None,
            response_bytes: None,
            continuation: None,
        },
    )?;
    let topology = match topology_result {
        Ok(topology) => topology,
        Err(TopologyError::CurrentInvalid(diagnostics)) => {
            eprint_diagnostics(&diagnostics);
            eprintln!("error: refusing topology navigation from an invalid current project");
            return Ok(ExitCode::from(1));
        }
        Err(TopologyError::Runtime(error)) => return Err(error),
    };

    match command {
        TopologyCommand::Resolve { address, json } => {
            let span = observer.start();
            let result = topology.resolve(&address);
            let span = span.finish();
            let response_bytes = result
                .as_ref()
                .ok()
                .and_then(|value| serde_json::to_vec(value).ok())
                .map(|value| value.len());
            observer.record(
                &span,
                ObservationRecord {
                    scope: "core",
                    operation: "topology.resolve",
                    outcome: query_outcome(&result),
                    snapshot: Some(snapshot),
                    result_count: result.as_ref().ok().map(|_| 1),
                    response_bytes,
                    continuation: None,
                },
            )?;
            let resolution = result?;
            if json {
                print_json(&resolution)?;
            } else {
                println!("{}", topology_node_record(&resolution.node));
            }
        }
        TopologyCommand::List {
            address,
            offset,
            limit,
            json,
        } => {
            let span = observer.start();
            let result = topology.list(address.as_deref(), offset, limit);
            let span = span.finish();
            let response_bytes = result
                .as_ref()
                .ok()
                .and_then(|value| serde_json::to_vec(value).ok())
                .map(|value| value.len());
            observer.record(
                &span,
                ObservationRecord {
                    scope: "core",
                    operation: "topology.list",
                    outcome: query_outcome(&result),
                    snapshot: Some(snapshot),
                    result_count: result.as_ref().ok().map(|page| page.children.len()),
                    response_bytes,
                    continuation: result.as_ref().ok().map(|page| page.next_offset.is_some()),
                },
            )?;
            let page = result?;
            if json {
                print_json(&page)?;
            } else {
                for child in &page.children {
                    println!("{}", topology_node_record(child));
                }
            }
        }
        TopologyCommand::Neighbors {
            address,
            direction,
            relationship_type,
            offset,
            limit,
            json,
        } => {
            let span = observer.start();
            let result =
                topology.neighbors(&address, direction.into(), relationship_type, offset, limit);
            let span = span.finish();
            let response_bytes = result
                .as_ref()
                .ok()
                .and_then(|value| serde_json::to_vec(value).ok())
                .map(|value| value.len());
            observer.record(
                &span,
                ObservationRecord {
                    scope: "core",
                    operation: "topology.neighbors",
                    outcome: query_outcome(&result),
                    snapshot: Some(snapshot),
                    result_count: result.as_ref().ok().map(|page| page.incidences.len()),
                    response_bytes,
                    continuation: result.as_ref().ok().map(|page| page.next_offset.is_some()),
                },
            )?;
            let page = result?;
            if json {
                print_json(&page)?;
            } else {
                for incidence in &page.incidences {
                    println!(
                        "{}\t{}",
                        topology_side_label(incidence.side),
                        topology_relationship_record(&incidence.relationship)
                    );
                }
            }
        }
        TopologyCommand::Read { address, json } => {
            let span = observer.start();
            let result = topology.read(&address);
            let span = span.finish();
            observer.record(
                &span,
                ObservationRecord {
                    scope: "core",
                    operation: "topology.read",
                    outcome: query_outcome(&result),
                    snapshot: Some(snapshot),
                    result_count: result.as_ref().ok().map(|_| 1),
                    response_bytes: result.as_ref().ok().map(|content| content.content.len()),
                    continuation: None,
                },
            )?;
            let content = result?;
            if json {
                print_json(&content)?;
            } else {
                let stdout = io::stdout();
                let mut output = stdout.lock();
                output
                    .write_all(content.content.as_bytes())
                    .context("cannot write topology content")?;
                output.flush().context("cannot flush topology content")?;
            }
        }
        TopologyCommand::View {
            address,
            depth,
            max_nodes,
            json,
            mermaid,
        } => {
            let span = observer.start();
            let result = topology.view(address.as_deref(), depth, max_nodes);
            let span = span.finish();
            let response_bytes = result
                .as_ref()
                .ok()
                .and_then(|value| serde_json::to_vec(value).ok())
                .map(|value| value.len());
            observer.record(
                &span,
                ObservationRecord {
                    scope: "core",
                    operation: "topology.view",
                    outcome: query_outcome(&result),
                    snapshot: Some(snapshot),
                    result_count: result.as_ref().ok().map(|view| view.nodes.len()),
                    response_bytes,
                    continuation: result.as_ref().ok().map(|view| view.has_deeper),
                },
            )?;
            let view = result?;
            if json {
                print_json(&view)?;
            } else if mermaid {
                print!("{}", topology_view_mermaid(&view));
            } else {
                for entry in &view.nodes {
                    println!("{}\t{}", entry.depth, topology_node_record(&entry.node));
                }
                for relationship in &view.relationships {
                    println!(
                        "relationship\t{}",
                        topology_relationship_record(relationship)
                    );
                }
            }
        }
        TopologyCommand::Probe {
            address,
            depth,
            max_nodes,
            json,
            mermaid,
        } => {
            let span = observer.start();
            let result = topology.probe(address.as_deref(), depth, max_nodes);
            let span = span.finish();
            let response_bytes = result
                .as_ref()
                .ok()
                .and_then(|value| serde_json::to_vec(value).ok())
                .map(|value| value.len());
            observer.record(
                &span,
                ObservationRecord {
                    scope: "core",
                    operation: "topology.probe",
                    outcome: query_outcome(&result),
                    snapshot: Some(snapshot),
                    result_count: result
                        .as_ref()
                        .ok()
                        .map(|probe| probe.structure.nodes.len() + probe.incidences.len()),
                    response_bytes,
                    continuation: result.as_ref().ok().map(|probe| probe.structure.has_deeper),
                },
            )?;
            let probe = result?;
            if json {
                print_json(&probe)?;
            } else if mermaid {
                print!("{}", topology_probe_mermaid(&probe));
            } else {
                println!("structure");
                for entry in &probe.structure.nodes {
                    println!("{}\t{}", entry.depth, topology_node_record(&entry.node));
                }
                println!("relationships");
                for incidence in &probe.incidences {
                    println!(
                        "{}\t{}",
                        topology_side_label(incidence.side),
                        topology_relationship_record(&incidence.relationship)
                    );
                }
            }
        }
    }

    Ok(ExitCode::SUCCESS)
}

fn query_outcome<T>(result: &Result<T>) -> ObservationOutcome {
    if result.is_ok() {
        ObservationOutcome::Success
    } else {
        ObservationOutcome::Refused
    }
}

fn topology_node_record(node: &TopologyNode) -> String {
    let kind = match node.kind {
        EntryKind::Directory => "directory",
        EntryKind::Document => "document",
        EntryKind::Target => "target",
    };
    format!(
        "{}\t{}\t{}\t{}",
        node.component
            .as_ref()
            .map(|c| c.id.as_str())
            .unwrap_or("-"),
        kind,
        node.name,
        node.path
    )
}

fn topology_side_label(side: TopologyIncidenceSide) -> &'static str {
    match side {
        TopologyIncidenceSide::Source => "source",
        TopologyIncidenceSide::Target => "target",
        TopologyIncidenceSide::Both => "both",
    }
}

fn topology_relationship_record(relationship: &StructureRelationship) -> String {
    format!(
        "{}\t{}\t{}\t{}",
        relationship.source,
        relationship.relationship_type,
        relationship.direction.as_str(),
        relationship.target
    )
}

fn graph(project: &Project) -> Result<ExitCode> {
    match project.validated_graph() {
        Ok(graph) => {
            print_json(&graph)?;
            Ok(ExitCode::SUCCESS)
        }
        Err(diagnostics) => {
            eprint_diagnostics(&diagnostics);
            eprintln!("error: refusing to emit a partial semantic graph");
            Ok(ExitCode::from(1))
        }
    }
}

fn project_map(project: &Project) -> Result<ExitCode> {
    let diagnostics = project.diagnostics();
    if Project::has_errors(&diagnostics) {
        eprint_diagnostics(&diagnostics);
        eprintln!("error: refusing to emit Structure from an invalid region");
        return Ok(ExitCode::from(1));
    }
    print_json(&project.structure().expect("validated Structure"))?;
    Ok(ExitCode::SUCCESS)
}

fn opening(project: &Project, command: OpeningCommand) -> Result<ExitCode> {
    match command {
        OpeningCommand::Show { json } => show_opening(project, json),
    }
}

fn evolve(project: &Project, command: EvolveCommand) -> Result<ExitCode> {
    match command {
        EvolveCommand::Events {
            json,
            offset,
            limit,
        } => evolve_events(project, json, offset, limit),
        EvolveCommand::Select {
            concern,
            source,
            anchor,
            instruction,
        } => historical_selection(project, concern, source, anchor, instruction),
    }
}

fn evolve_events(
    project: &Project,
    output_json: bool,
    offset: usize,
    limit: Option<usize>,
) -> Result<ExitCode> {
    let diagnostics = project.diagnostics();
    if Project::has_errors(&diagnostics) {
        eprint_diagnostics(&diagnostics);
        eprintln!("error: refusing to emit Evolve Events from an invalid project");
        return Ok(ExitCode::from(1));
    }

    if output_json {
        let page = project.event_page(offset, limit.unwrap_or(DEFAULT_EVENT_PAGE_SIZE))?;
        print_json(&page)?;
    } else {
        let (total, events) = if let Some(limit) = limit {
            let page = project.event_page(offset, limit)?;
            (page.total, page.events)
        } else {
            let flow = project.evolve_flow();
            if offset > flow.events.len() {
                anyhow::bail!(
                    "Event page offset {offset} exceeds total {}",
                    flow.events.len()
                );
            }
            let total = flow.events.len();
            (total, flow.events.into_iter().skip(offset).collect())
        };
        let end = offset + events.len();
        println!(
            "Evolve Events: {}; showing {}..{}.",
            counted(total, "registered event", "registered events"),
            offset,
            end
        );
        for (index, event) in events.iter().enumerate() {
            println!("  {}. {}", offset + index + 1, event.name);
            if let Some(description) = &event.description {
                println!("     {description}");
            }
            print_intent_paths("Predecessors", &event.predecessors);
            print_intent_paths("Successors", &event.successors);
        }
    }

    Ok(ExitCode::SUCCESS)
}

fn print_intent_paths(label: &str, paths: &[String]) {
    if paths.is_empty() {
        println!("     {label}: (none)");
    } else {
        println!("     {label}:");
        for path in paths {
            println!("       {path}");
        }
    }
}

fn show_opening(project: &Project, output_json: bool) -> Result<ExitCode> {
    let diagnostics = project.diagnostics();
    if Project::has_errors(&diagnostics) {
        eprint_diagnostics(&diagnostics);
        eprintln!("error: refusing to emit Opening from an invalid semantic graph");
        return Ok(ExitCode::from(1));
    }

    let opening = project.opening();
    if output_json {
        print_json(&opening)?;
    } else if opening.files.is_empty() {
        println!("Opening is empty.");
    } else {
        println!("Opening: {}", counted(opening.files.len(), "file", "files"));
        for file in opening.files {
            println!("  File  {}  [{}]", file.path, file.component);
        }
    }

    Ok(ExitCode::SUCCESS)
}

fn historical_selection(
    project: &Project,
    concern: String,
    source_values: Vec<String>,
    anchors: Vec<String>,
    instructions: Vec<String>,
) -> Result<ExitCode> {
    let sources = source_values
        .chunks_exact(2)
        .map(|values| TemporalSourceRequest {
            revision: values[0].clone(),
            path: values[1].clone(),
        })
        .collect();
    let request = HistoricalSelectionRequest {
        concern,
        sources,
        anchors,
        instructions,
    };

    match project.form_historical_selection(request) {
        Ok(selection) => {
            print_json(&selection)?;
            Ok(ExitCode::SUCCESS)
        }
        Err(HistoricalSelectionError::CurrentInvalid(diagnostics)) => {
            eprint_diagnostics(&diagnostics);
            eprintln!(
                "error: refusing to form a historical selection from an invalid current project"
            );
            Ok(ExitCode::from(1))
        }
        Err(HistoricalSelectionError::Runtime(error)) => Err(error),
    }
}

fn change(project: &Project, command: ChangeCommand) -> Result<ExitCode> {
    match command {
        ChangeCommand::Plan { input_json } => {
            let operation: ChangeOperation = read_json_input(&input_json)?;
            let proposal = project.plan_change(operation)?;
            print_json(&proposal)?;
        }
        ChangeCommand::Apply { input_json } => {
            let proposal: ChangeProposal = read_json_input(&input_json)?;
            let applied = project.apply_change(&proposal)?;
            print_json(&applied)?;
        }
    }
    Ok(ExitCode::SUCCESS)
}

fn read_json_input<T: DeserializeOwned>(path: &str) -> Result<T> {
    let source = if path == "-" {
        let mut source = String::new();
        io::stdin()
            .read_to_string(&mut source)
            .context("cannot read JSON from standard input")?;
        source
    } else {
        std::fs::read_to_string(path).with_context(|| format!("cannot read JSON input `{path}`"))?
    };
    serde_json::from_str(&source).with_context(|| format!("cannot decode JSON input `{path}`"))
}

fn anchor(project: &Project, command: AnchorCommand) -> Result<ExitCode> {
    let diagnostics = project.diagnostics();
    if Project::has_errors(&diagnostics) {
        eprint_diagnostics(&diagnostics);
        eprintln!("error: refusing Anchor operations in an invalid current project");
        return Ok(ExitCode::from(1));
    }
    match command {
        AnchorCommand::List => {
            for (name, anchor) in &project.manifest.anchors {
                println!(
                    "{}\t{}\t{}\t{}\t{}",
                    name,
                    anchor.component,
                    project.manifest.components[&anchor.component].path,
                    short_commit(&anchor.commit),
                    anchor.connections.len()
                );
            }
        }
        AnchorCommand::Show { name } => {
            let anchor = project
                .manifest
                .anchors
                .get(&name)
                .with_context(|| format!("unknown anchor `{name}`"))?;
            println!("Anchor: {name}");
            println!("Component: {}", anchor.component);
            println!(
                "File: {}",
                project.manifest.components[&anchor.component].path
            );
            println!("Commit: {}", anchor.commit);
            if let Some(description) = &anchor.description {
                println!("Description: {description}");
            }
            println!("Connections:");
            for connection in &anchor.connections {
                println!("  {} -> {}", connection.connection_type, connection.target);
            }
        }
        AnchorCommand::Create {
            name,
            at,
            file,
            connection,
            description,
        } => match project.create_anchor(
            name.clone(),
            file,
            &at,
            connection
                .chunks_exact(2)
                .map(|values| AnchorConnection {
                    connection_type: values[0].clone(),
                    target: values[1].clone(),
                })
                .collect(),
            description,
        ) {
            Ok(anchor) => {
                println!("Created anchor: {name}");
                println!("Component: {}", anchor.component);
                println!(
                    "File: {}",
                    project.manifest.components[&anchor.component].path
                );
                println!("Commit: {}", anchor.commit);
                if let Some(description) = &anchor.description {
                    println!("Description: {description}");
                }
                println!("Connections:");
                for connection in &anchor.connections {
                    println!("  {} -> {}", connection.connection_type, connection.target);
                }
            }
            Err(error) => return anchor_mutation_error(error),
        },
        AnchorCommand::Remove { name } => match project.remove_anchor(&name) {
            Ok(_) => println!("Removed anchor: {name}"),
            Err(error) => return anchor_mutation_error(error),
        },
    }
    Ok(ExitCode::SUCCESS)
}

fn anchor_mutation_error(error: AnchorMutationError) -> Result<ExitCode> {
    match error {
        AnchorMutationError::CurrentInvalid(diagnostics) => {
            eprint_diagnostics(&diagnostics);
            eprintln!("error: refusing to change anchors in an invalid current project");
            Ok(ExitCode::from(1))
        }
        AnchorMutationError::ProposedInvalid(diagnostics) => {
            eprint_diagnostics(&diagnostics);
            eprintln!("error: refusing to write an invalid proposed anchor state");
            Ok(ExitCode::from(1))
        }
        AnchorMutationError::Runtime(error) => Err(error),
    }
}

fn short_commit(commit: &str) -> &str {
    &commit[..commit.len().min(12)]
}

fn print_json<T: Serialize + ?Sized>(value: &T) -> Result<()> {
    println!("{}", serde_json::to_string(value)?);
    Ok(())
}

fn counted(count: usize, singular: &str, plural: &str) -> String {
    format!("{count} {}", if count == 1 { singular } else { plural })
}

fn print_diagnostics(diagnostics: &[Diagnostic]) {
    for diagnostic in diagnostics {
        println!("{}", format_diagnostic(diagnostic));
    }
}

fn eprint_diagnostics(diagnostics: &[Diagnostic]) {
    for diagnostic in diagnostics {
        eprintln!("{}", format_diagnostic(diagnostic));
    }
}

fn format_diagnostic(diagnostic: &Diagnostic) -> String {
    let severity = match diagnostic.severity {
        Severity::Error => "error",
        Severity::Warning => "warning",
    };
    let path = diagnostic
        .path
        .as_deref()
        .map(|path| format!(" {path}"))
        .unwrap_or_default();
    format!(
        "  {severity} [{}]{path}: {}",
        diagnostic.code, diagnostic.message
    )
}
