use std::path::PathBuf;
use std::process::ExitCode;

use anyhow::Result;
use clap::{Parser, Subcommand};
use mindflow::runtime_observation::{
    compare_bundles, dispose_bundle, print_comparison_text, print_report_text, proxy_mindflow,
    record_artifact, report_bundle, run_experiment,
};

#[derive(Debug, Parser)]
#[command(
    name = "mindflow-observe",
    version,
    about = "Run explicit local Mindflow CLI and agent-effect observations"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Run one exact experiment in a new private bundle.
    Run {
        /// Closed mindflow-observation-experiment/v1 JSON specification.
        #[arg(long)]
        spec: PathBuf,
        /// New bundle directory; it must remain outside the observed worktree.
        #[arg(long)]
        output: PathBuf,
        /// Exact synchronized Mindflow CLI executable to wrap.
        #[arg(long)]
        mindflow: PathBuf,
        /// Exact agent/runtime argv, following `--`.
        #[arg(required = true, trailing_var_arg = true, allow_hyphen_values = true)]
        command: Vec<String>,
    },
    /// Add one explicitly runtime-visible artifact to an agent-effect bundle.
    Record {
        #[arg(long)]
        bundle: PathBuf,
        /// prompt, instruction, plan, plan-change, transcript, final-response,
        /// document, selected-owner, review, or validation.
        #[arg(long)]
        kind: String,
        /// Exact input path, or `-` for standard input.
        #[arg(long, default_value = "-")]
        input: String,
        /// Optional artifact identity; required for selected-owner.
        #[arg(long)]
        label: Option<String>,
    },
    /// Aggregate one completed bundle without assigning a composite score.
    Report {
        bundle: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// Compare candidate metrics against a baseline as separate deltas.
    Compare {
        baseline: PathBuf,
        candidate: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// Permanently remove one exact marker-validated observation bundle.
    Dispose { bundle: PathBuf },
    /// Transparent internal target used by the generated `mindflow` wrapper.
    #[command(hide = true)]
    Proxy {
        #[arg(long)]
        bundle: PathBuf,
        #[arg(long)]
        mindflow: PathBuf,
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        arguments: Vec<String>,
    },
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(code) => ExitCode::from(code.clamp(0, u8::MAX as i32) as u8),
        Err(error) => {
            eprintln!("error: {error:#}");
            ExitCode::from(2)
        }
    }
}

fn run(cli: Cli) -> Result<i32> {
    match cli.command {
        Command::Run {
            spec,
            output,
            mindflow,
            command,
        } => {
            let outcome = run_experiment(&spec, &output, &mindflow, &command)?;
            eprintln!("Observation bundle: {}", output.display());
            Ok(outcome.exit_code)
        }
        Command::Record {
            bundle,
            kind,
            input,
            label,
        } => {
            let record = record_artifact(&bundle, &kind, &input, label)?;
            println!("{}", serde_json::to_string(&record)?);
            Ok(0)
        }
        Command::Report { bundle, json } => {
            let report = report_bundle(&bundle)?;
            if json {
                println!("{}", serde_json::to_string(&report)?);
            } else {
                print_report_text(&report);
            }
            Ok(0)
        }
        Command::Compare {
            baseline,
            candidate,
            json,
        } => {
            let comparison = compare_bundles(&baseline, &candidate)?;
            if json {
                println!("{}", serde_json::to_string(&comparison)?);
            } else {
                print_comparison_text(&comparison);
            }
            Ok(0)
        }
        Command::Dispose { bundle } => {
            dispose_bundle(&bundle)?;
            println!("Disposed observation bundle: {}", bundle.display());
            Ok(0)
        }
        Command::Proxy {
            bundle,
            mindflow,
            arguments,
        } => proxy_mindflow(&bundle, &mindflow, &arguments),
    }
}
