use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::thread;
use std::time::Instant;

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::observation::{
    duration_ns, private_create_new, read_bundle_marker, set_directory_private, unix_time_ns,
    validate_observation_stage, validate_run_id, CaptureLevel, ObservationBundleMarker,
    OperationalEvent, OBSERVATION_BUNDLE_ENV, OBSERVATION_BUNDLE_MARKER_SCHEMA,
    OBSERVATION_CALL_ID_ENV, OBSERVATION_CAPTURE_ENV, OBSERVATION_MARKER_FILENAME,
    OBSERVATION_MINDFLOW_ENV, OBSERVATION_RECORDER_ENV, OBSERVATION_RUN_ID_ENV,
    OBSERVATION_STAGE_ENV,
};

pub const EXPERIMENT_SCHEMA: &str = "mindflow-observation-experiment/v1";
pub const RUN_SCHEMA: &str = "mindflow-observation-run/v1";
pub const CALL_SCHEMA: &str = "mindflow-observation-call/v1";
pub const ARTIFACT_SCHEMA: &str = "mindflow-observation-artifact/v1";
pub const REPORT_SCHEMA: &str = "mindflow-observation-report/v1";
pub const COMPARISON_SCHEMA: &str = "mindflow-observation-comparison/v1";
const MAX_RECORDED_ARTIFACT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeConfiguration {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub configuration: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExperimentSpec {
    pub schema: String,
    pub name: String,
    pub purpose: String,
    pub task: String,
    pub capture: CaptureLevel,
    pub project_root: PathBuf,
    pub retention_until: String,
    #[serde(default)]
    pub access_boundary: Vec<String>,
    pub runtime: RuntimeConfiguration,
    #[serde(default)]
    pub expected_owners: Vec<String>,
    #[serde(default)]
    pub prompt_files: Vec<PathBuf>,
    #[serde(default)]
    pub validation_commands: Vec<Vec<String>>,
    #[serde(default = "default_true")]
    pub require_clean_worktree: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StreamSummary {
    pub bytes: usize,
    pub sha256: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitStateSummary {
    pub changed_entries: usize,
    pub status_bytes: usize,
    pub status_sha256: String,
    pub diff_bytes: usize,
    pub diff_sha256: String,
    pub staged_diff_bytes: usize,
    pub staged_diff_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ValidationRecord {
    pub index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<Vec<String>>,
    pub exit_code: i32,
    pub duration_ns: u64,
    pub stdout: StreamSummary,
    pub stderr: StreamSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunRecord {
    pub schema: String,
    pub run_id: String,
    pub capture: CaptureLevel,
    pub started_unix_ns: u64,
    pub duration_ns: u64,
    pub agent_exit_code: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mindflow_executable: Option<String>,
    pub project_head: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_snapshot: Option<String>,
    pub project_valid: bool,
    pub runtime: RuntimeConfiguration,
    pub retention_until: String,
    pub expected_owners: Vec<String>,
    pub initial_git: GitStateSummary,
    pub final_git: GitStateSummary,
    pub agent_stdout: StreamSummary,
    pub agent_stderr: StreamSummary,
    pub validations: Vec<ValidationRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CallRecord {
    pub schema: String,
    pub run_id: String,
    pub call_id: String,
    pub stage: String,
    pub started_unix_ns: u64,
    pub duration_ns: u64,
    pub exit_code: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<Vec<String>>,
    pub stdout: StreamSummary,
    pub stderr: StreamSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactRecord {
    pub schema: String,
    pub run_id: String,
    pub artifact_id: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub recorded_unix_ns: u64,
    pub bytes: usize,
    pub sha256: String,
    pub file: String,
}

#[derive(Debug)]
struct GitState {
    status: Vec<u8>,
    diff: Vec<u8>,
    staged_diff: Vec<u8>,
}

impl GitState {
    fn summary(&self) -> GitStateSummary {
        GitStateSummary {
            changed_entries: self
                .status
                .split(|byte| *byte == 0)
                .filter(|entry| !entry.is_empty())
                .count(),
            status_bytes: self.status.len(),
            status_sha256: sha256_bytes(&self.status),
            diff_bytes: self.diff.len(),
            diff_sha256: sha256_bytes(&self.diff),
            staged_diff_bytes: self.staged_diff.len(),
            staged_diff_sha256: sha256_bytes(&self.staged_diff),
        }
    }

    fn clean(&self) -> bool {
        self.status.is_empty()
    }
}

#[derive(Debug)]
struct CapturedCommand {
    exit_code: i32,
    duration_ns: u64,
    stdout: StreamSummary,
    stderr: StreamSummary,
}

#[derive(Debug, Clone, Copy)]
pub struct RunOutcome {
    pub exit_code: i32,
    pub validation_failed: bool,
}

pub fn run_experiment(
    spec_path: &Path,
    output: &Path,
    mindflow: &Path,
    command: &[String],
) -> Result<RunOutcome> {
    if command.is_empty() {
        bail!("an exact agent command is required after `--`");
    }
    let spec_path = spec_path
        .canonicalize()
        .with_context(|| format!("cannot access experiment spec `{}`", spec_path.display()))?;
    let source = fs::read(&spec_path)
        .with_context(|| format!("cannot read experiment spec `{}`", spec_path.display()))?;
    let mut spec: ExperimentSpec = serde_json::from_slice(&source)
        .with_context(|| format!("invalid experiment spec `{}`", spec_path.display()))?;
    validate_spec(&spec)?;

    let spec_directory = spec_path
        .parent()
        .ok_or_else(|| anyhow!("experiment spec has no parent directory"))?;
    let project_root = resolve_from(spec_directory, &spec.project_root)?;
    spec.project_root = project_root.clone();
    let mindflow = mindflow
        .canonicalize()
        .with_context(|| format!("cannot access Mindflow executable `{}`", mindflow.display()))?;
    let git_root = git_root(&project_root)?;
    let output = normalize_new_output(output)?;
    if output.starts_with(&git_root) || output.starts_with(&project_root) {
        bail!(
            "observation bundle `{}` must remain outside the observed project and Git worktree",
            output.display()
        );
    }

    let initial_git = capture_git_state(&git_root)?;
    if spec.require_clean_worktree && !initial_git.clean() {
        bail!("the experiment requires a clean initial Git worktree");
    }
    let project_head = git_text(&git_root, &["rev-parse", "HEAD"])?;
    let (project_snapshot, project_valid) = inspect_project_snapshot(&mindflow, &project_root)?;
    let run_id = generate_id("run", &[spec.name.as_bytes(), project_head.as_bytes()]);
    validate_run_id(&run_id)?;

    create_bundle(&output, &run_id, spec.capture)?;
    write_experiment_record(&output, &spec)?;
    write_git_state(&output, "initial", &initial_git, spec.capture)?;
    if spec.capture == CaptureLevel::AgentEffect {
        for (index, prompt) in spec.prompt_files.iter().enumerate() {
            let prompt_path = resolve_confined(&project_root, prompt)?;
            let bytes = fs::read(&prompt_path)
                .with_context(|| format!("cannot read prompt file `{}`", prompt_path.display()))?;
            record_artifact_bytes(
                &output,
                "prompt",
                Some(format!("prompt-file-{index}")),
                &bytes,
            )?;
        }
    }

    let observer_executable = env::current_exe()
        .context("cannot resolve the running mindflow-observe executable")?
        .canonicalize()
        .context("cannot canonicalize the running mindflow-observe executable")?;
    let runtime_bin = output.join("runtime-bin");
    install_mindflow_wrapper(&runtime_bin)?;

    let started_unix_ns = unix_time_ns();
    let run_started = Instant::now();
    let agent_capture_prefix =
        (spec.capture == CaptureLevel::AgentEffect).then(|| output.join("agent"));
    let mut agent = Command::new(&command[0]);
    agent.args(&command[1..]).current_dir(&project_root);
    configure_observed_environment(
        &mut agent,
        &runtime_bin,
        &output,
        &run_id,
        spec.capture,
        &observer_executable,
        &mindflow,
        "agent",
    );
    let agent_result = run_captured(&mut agent, agent_capture_prefix.as_deref(), true)?;

    let mut validations = Vec::new();
    for (index, validation_command) in spec.validation_commands.iter().enumerate() {
        if validation_command.is_empty() {
            bail!("validation command {index} is empty");
        }
        let capture_prefix = (spec.capture == CaptureLevel::AgentEffect)
            .then(|| output.join("validations").join(format!("{index:03}")));
        if let Some(prefix) = &capture_prefix {
            if let Some(parent) = prefix.parent() {
                fs::create_dir_all(parent)
                    .with_context(|| format!("cannot create `{}`", parent.display()))?;
                set_directory_private(parent)?;
            }
        }
        let mut validation = Command::new(&validation_command[0]);
        validation
            .args(&validation_command[1..])
            .current_dir(&project_root);
        configure_observed_environment(
            &mut validation,
            &runtime_bin,
            &output,
            &run_id,
            spec.capture,
            &observer_executable,
            &mindflow,
            "validation",
        );
        let result = run_captured(&mut validation, capture_prefix.as_deref(), true)?;
        validations.push(ValidationRecord {
            index,
            command: (spec.capture == CaptureLevel::AgentEffect)
                .then(|| validation_command.clone()),
            exit_code: result.exit_code,
            duration_ns: result.duration_ns,
            stdout: result.stdout,
            stderr: result.stderr,
        });
    }

    let final_git = capture_git_state(&git_root)?;
    write_git_state(&output, "final", &final_git, spec.capture)?;
    let expected_owners = if spec.capture == CaptureLevel::AgentEffect {
        spec.expected_owners.clone()
    } else {
        Vec::new()
    };
    let record = RunRecord {
        schema: RUN_SCHEMA.to_owned(),
        run_id: run_id.clone(),
        capture: spec.capture,
        started_unix_ns,
        duration_ns: duration_ns(run_started.elapsed()),
        agent_exit_code: agent_result.exit_code,
        command: (spec.capture == CaptureLevel::AgentEffect).then(|| command.to_vec()),
        project_root: (spec.capture == CaptureLevel::AgentEffect)
            .then(|| project_root.display().to_string()),
        mindflow_executable: (spec.capture == CaptureLevel::AgentEffect)
            .then(|| mindflow.display().to_string()),
        project_head,
        project_snapshot,
        project_valid,
        runtime: spec.runtime,
        retention_until: spec.retention_until,
        expected_owners,
        initial_git: initial_git.summary(),
        final_git: final_git.summary(),
        agent_stdout: agent_result.stdout,
        agent_stderr: agent_result.stderr,
        validations,
    };
    write_json_new(&output.join("run.json"), &record)?;

    let validation_failed = record.validations.iter().any(|item| item.exit_code != 0);
    let exit_code = if record.agent_exit_code != 0 {
        record.agent_exit_code
    } else if validation_failed {
        1
    } else {
        0
    };
    Ok(RunOutcome {
        exit_code,
        validation_failed,
    })
}

pub fn proxy_mindflow(bundle: &Path, mindflow: &Path, arguments: &[String]) -> Result<i32> {
    let bundle = canonical_bundle(bundle)?;
    let marker = read_bundle_marker(&bundle)?;
    let mindflow = mindflow
        .canonicalize()
        .with_context(|| format!("cannot access Mindflow executable `{}`", mindflow.display()))?;
    let stage = env::var(OBSERVATION_STAGE_ENV).unwrap_or_else(|_| "agent".to_owned());
    validate_observation_stage(&stage)?;
    let call_id = generate_id("call", &[marker.run_id.as_bytes()]);
    let started_unix_ns = unix_time_ns();
    let started = Instant::now();
    let capture_prefix =
        (marker.capture == CaptureLevel::AgentEffect).then(|| bundle.join("calls").join(&call_id));

    let mut child = Command::new(&mindflow);
    child.args(arguments).env(OBSERVATION_CALL_ID_ENV, &call_id);
    let result = run_captured(&mut child, capture_prefix.as_deref(), true)?;
    let record = CallRecord {
        schema: CALL_SCHEMA.to_owned(),
        run_id: marker.run_id,
        call_id: call_id.clone(),
        stage,
        started_unix_ns,
        duration_ns: duration_ns(started.elapsed()),
        exit_code: result.exit_code,
        arguments: (marker.capture == CaptureLevel::AgentEffect).then(|| arguments.to_vec()),
        stdout: result.stdout,
        stderr: result.stderr,
    };
    write_json_new(
        &bundle.join("calls").join(format!("{call_id}.json")),
        &record,
    )?;
    Ok(record.exit_code)
}

pub fn record_artifact(
    bundle: &Path,
    kind: &str,
    input: &str,
    label: Option<String>,
) -> Result<ArtifactRecord> {
    validate_artifact_kind(kind)?;
    if kind == "selected-owner" && label.as_deref().is_none_or(str::is_empty) {
        bail!("selected-owner artifacts require --label with the exact owner identity");
    }
    let bundle = canonical_bundle(bundle)?;
    let marker = read_bundle_marker(&bundle)?;
    if marker.capture != CaptureLevel::AgentEffect {
        bail!("runtime-visible artifacts require an agent-effect observation bundle");
    }
    let bytes = if input == "-" {
        let mut bytes = Vec::new();
        io::stdin()
            .take((MAX_RECORDED_ARTIFACT_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .context("cannot read artifact from standard input")?;
        bytes
    } else {
        let input_path = PathBuf::from(input)
            .canonicalize()
            .with_context(|| format!("cannot access artifact input `{input}`"))?;
        let allowed = allowed_artifact_roots(&bundle)?;
        if !allowed.iter().any(|root| input_path.starts_with(root)) {
            bail!(
                "artifact input `{}` is outside the experiment access boundary",
                input_path.display()
            );
        }
        fs::read(&input_path)
            .with_context(|| format!("cannot read artifact input `{}`", input_path.display()))?
    };
    if bytes.len() > MAX_RECORDED_ARTIFACT_BYTES {
        bail!("one recorded artifact may not exceed {MAX_RECORDED_ARTIFACT_BYTES} bytes");
    }
    record_artifact_bytes(&bundle, kind, label, &bytes)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CallMetrics {
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub agent_calls: usize,
    pub validation_calls: usize,
    pub status_calls: usize,
    pub stdout_bytes: usize,
    pub stderr_bytes: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repeated_exact_calls: Option<usize>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperationMetric {
    pub count: usize,
    pub failures: usize,
    pub total_duration_ns: u64,
    pub max_duration_ns: u64,
    pub result_count: usize,
    pub response_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OwnerMetrics {
    pub expected: Vec<String>,
    pub selected: Vec<String>,
    pub unexpected: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_expected_owner_duration_ns: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObservationReport {
    pub schema: String,
    pub run_id: String,
    pub capture: CaptureLevel,
    pub agent_exit_code: i32,
    pub duration_ns: u64,
    pub initial_clean: bool,
    pub final_changed_entries: usize,
    pub validation_total: usize,
    pub validation_failed: usize,
    pub calls: CallMetrics,
    pub operations: BTreeMap<String, OperationMetric>,
    pub artifacts: BTreeMap<String, usize>,
    pub captured_artifact_bytes: usize,
    pub owners: OwnerMetrics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObservationDeltas {
    pub duration_ns: i128,
    pub agent_exit_code: i64,
    pub final_changed_entries: i128,
    pub validation_failed: i128,
    pub calls: i128,
    pub failed_calls: i128,
    pub status_calls: i128,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repeated_exact_calls: Option<i128>,
    pub stdout_bytes: i128,
    pub stderr_bytes: i128,
    pub captured_artifact_bytes: i128,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_expected_owner_duration_ns: Option<i128>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObservationComparison {
    pub schema: String,
    pub baseline_run_id: String,
    pub candidate_run_id: String,
    pub deltas: ObservationDeltas,
}

pub fn report_bundle(bundle: &Path) -> Result<ObservationReport> {
    let bundle = canonical_bundle(bundle)?;
    let marker = read_bundle_marker(&bundle)?;
    let run: RunRecord = read_json(&bundle.join("run.json"))?;
    if run.schema != RUN_SCHEMA || run.run_id != marker.run_id || run.capture != marker.capture {
        bail!("run record does not match its observation bundle marker");
    }

    let mut calls = read_json_directory::<CallRecord>(&bundle.join("calls"), "json")?;
    calls.sort_by_key(|call| call.started_unix_ns);
    let mut call_metrics = CallMetrics::default();
    let mut exact_call_counts = BTreeMap::<Vec<String>, usize>::new();
    for call in &calls {
        if call.schema != CALL_SCHEMA || call.run_id != run.run_id {
            bail!("call record does not match run `{}`", run.run_id);
        }
        call_metrics.total += 1;
        if call.exit_code == 0 {
            call_metrics.succeeded += 1;
        } else {
            call_metrics.failed += 1;
        }
        match call.stage.as_str() {
            "validation" => call_metrics.validation_calls += 1,
            _ => call_metrics.agent_calls += 1,
        }
        call_metrics.stdout_bytes += call.stdout.bytes;
        call_metrics.stderr_bytes += call.stderr.bytes;
        if let Some(arguments) = &call.arguments {
            *exact_call_counts.entry(arguments.clone()).or_default() += 1;
        }
    }
    call_metrics.repeated_exact_calls = (run.capture == CaptureLevel::AgentEffect).then(|| {
        exact_call_counts
            .values()
            .map(|count| count.saturating_sub(1))
            .sum()
    });

    let mut operations = BTreeMap::<String, OperationMetric>::new();
    for event in read_operational_events(&bundle.join("operations"))? {
        if event.schema != crate::observation::OBSERVATION_EVENT_SCHEMA
            || event.run_id != run.run_id
        {
            bail!("operational event does not match run `{}`", run.run_id);
        }
        let key = format!("{}.{}", event.scope, event.operation);
        if event.scope == "cli" && event.operation == "status" {
            call_metrics.status_calls += 1;
        }
        let metric = operations.entry(key).or_default();
        metric.count += 1;
        metric.failures += usize::from(event.outcome != "success");
        metric.total_duration_ns = metric.total_duration_ns.saturating_add(event.duration_ns);
        metric.max_duration_ns = metric.max_duration_ns.max(event.duration_ns);
        metric.result_count = metric
            .result_count
            .saturating_add(event.result_count.unwrap_or_default());
        metric.response_bytes = metric
            .response_bytes
            .saturating_add(event.response_bytes.unwrap_or_default());
    }

    let mut artifact_counts = BTreeMap::<String, usize>::new();
    let mut captured_artifact_bytes = 0usize;
    let mut selected = Vec::new();
    let mut first_expected_owner_duration_ns = None;
    let expected = run.expected_owners.clone();
    let expected_set = expected.iter().collect::<BTreeSet<_>>();
    let mut artifacts = read_json_directory::<ArtifactRecord>(&bundle.join("artifacts"), "json")?;
    artifacts.sort_by_key(|artifact| artifact.recorded_unix_ns);
    for artifact in &artifacts {
        if artifact.schema != ARTIFACT_SCHEMA || artifact.run_id != run.run_id {
            bail!("artifact record does not match run `{}`", run.run_id);
        }
        *artifact_counts.entry(artifact.kind.clone()).or_default() += 1;
        captured_artifact_bytes = captured_artifact_bytes.saturating_add(artifact.bytes);
        if artifact.kind == "selected-owner" {
            if let Some(owner) = &artifact.label {
                selected.push(owner.clone());
                if first_expected_owner_duration_ns.is_none() && expected_set.contains(owner) {
                    first_expected_owner_duration_ns = Some(
                        artifact
                            .recorded_unix_ns
                            .saturating_sub(run.started_unix_ns),
                    );
                }
            }
        }
    }
    let unexpected = selected
        .iter()
        .filter(|owner| !expected_set.contains(owner))
        .cloned()
        .collect();

    Ok(ObservationReport {
        schema: REPORT_SCHEMA.to_owned(),
        run_id: run.run_id,
        capture: run.capture,
        agent_exit_code: run.agent_exit_code,
        duration_ns: run.duration_ns,
        initial_clean: run.initial_git.changed_entries == 0,
        final_changed_entries: run.final_git.changed_entries,
        validation_total: run.validations.len(),
        validation_failed: run
            .validations
            .iter()
            .filter(|validation| validation.exit_code != 0)
            .count(),
        calls: call_metrics,
        operations,
        artifacts: artifact_counts,
        captured_artifact_bytes,
        owners: OwnerMetrics {
            expected,
            selected,
            unexpected,
            first_expected_owner_duration_ns,
        },
    })
}

pub fn compare_bundles(baseline: &Path, candidate: &Path) -> Result<ObservationComparison> {
    let baseline = report_bundle(baseline)?;
    let candidate = report_bundle(candidate)?;
    let first_expected_owner_duration_ns = match (
        baseline.owners.first_expected_owner_duration_ns,
        candidate.owners.first_expected_owner_duration_ns,
    ) {
        (Some(baseline), Some(candidate)) => Some(candidate as i128 - baseline as i128),
        _ => None,
    };
    Ok(ObservationComparison {
        schema: COMPARISON_SCHEMA.to_owned(),
        baseline_run_id: baseline.run_id,
        candidate_run_id: candidate.run_id,
        deltas: ObservationDeltas {
            duration_ns: delta_u64(baseline.duration_ns, candidate.duration_ns),
            agent_exit_code: candidate.agent_exit_code as i64 - baseline.agent_exit_code as i64,
            final_changed_entries: delta_usize(
                baseline.final_changed_entries,
                candidate.final_changed_entries,
            ),
            validation_failed: delta_usize(baseline.validation_failed, candidate.validation_failed),
            calls: delta_usize(baseline.calls.total, candidate.calls.total),
            failed_calls: delta_usize(baseline.calls.failed, candidate.calls.failed),
            status_calls: delta_usize(baseline.calls.status_calls, candidate.calls.status_calls),
            repeated_exact_calls: match (
                baseline.calls.repeated_exact_calls,
                candidate.calls.repeated_exact_calls,
            ) {
                (Some(baseline), Some(candidate)) => Some(delta_usize(baseline, candidate)),
                _ => None,
            },
            stdout_bytes: delta_usize(baseline.calls.stdout_bytes, candidate.calls.stdout_bytes),
            stderr_bytes: delta_usize(baseline.calls.stderr_bytes, candidate.calls.stderr_bytes),
            captured_artifact_bytes: delta_usize(
                baseline.captured_artifact_bytes,
                candidate.captured_artifact_bytes,
            ),
            first_expected_owner_duration_ns,
        },
    })
}

pub fn dispose_bundle(bundle: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(bundle)
        .with_context(|| format!("cannot inspect observation bundle `{}`", bundle.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        bail!("observation bundle disposal requires an exact, non-symlink directory");
    }
    let bundle = canonical_bundle(bundle)?;
    let _marker = read_bundle_marker(&bundle)?;
    if bundle.parent().is_none() {
        bail!("refusing to dispose a filesystem root");
    }
    let current = env::current_dir()
        .context("cannot inspect current directory before disposal")?
        .canonicalize()
        .context("cannot canonicalize current directory before disposal")?;
    if current.starts_with(&bundle) {
        bail!("refusing to dispose the current directory or one of its ancestors");
    }
    if let Some(home) = env::var_os("HOME") {
        if PathBuf::from(home).canonicalize().ok().as_ref() == Some(&bundle) {
            bail!("refusing to dispose the home directory");
        }
    }
    if env::temp_dir().canonicalize().ok().as_ref() == Some(&bundle) {
        bail!("refusing to dispose the operating-system temporary root");
    }
    if bundle.join(".git").exists()
        || bundle.join("Cargo.toml").exists()
        || bundle.join("MINDFLOW.yaml").exists()
    {
        bail!("refusing to dispose a directory that presents as a project root");
    }
    for required_directory in ["artifacts", "calls", "operations", "runtime-bin"] {
        if !bundle.join(required_directory).is_dir() {
            bail!(
                "refusing to dispose an observation marker without its `{required_directory}` bundle directory"
            );
        }
    }
    fs::remove_dir_all(&bundle)
        .with_context(|| format!("cannot dispose observation bundle `{}`", bundle.display()))
}

pub fn print_report_text(report: &ObservationReport) {
    println!(
        "Observation run: {} ({})",
        report.run_id,
        report.capture.as_str()
    );
    println!(
        "Agent exit {}; {} Mindflow calls ({} failed); {} validation failures.",
        report.agent_exit_code, report.calls.total, report.calls.failed, report.validation_failed
    );
    println!(
        "Calls: {} agent, {} validation, {} status, {} repeated exact; {} stdout bytes, {} stderr bytes.",
        report.calls.agent_calls,
        report.calls.validation_calls,
        report.calls.status_calls,
        report
            .calls
            .repeated_exact_calls
            .map(|value| value.to_string())
            .unwrap_or_else(|| "unavailable".to_owned()),
        report.calls.stdout_bytes,
        report.calls.stderr_bytes
    );
    println!(
        "Result: {} changed Git entries; selected owners [{}]; unexpected [{}].",
        report.final_changed_entries,
        report.owners.selected.join(", "),
        report.owners.unexpected.join(", ")
    );
}

pub fn print_comparison_text(comparison: &ObservationComparison) {
    println!(
        "Observation comparison: {} -> {}",
        comparison.baseline_run_id, comparison.candidate_run_id
    );
    println!(
        "Deltas (candidate - baseline): calls {:+}, failed calls {:+}, repeated exact calls {}, duration {:+} ns.",
        comparison.deltas.calls,
        comparison.deltas.failed_calls,
        comparison
            .deltas
            .repeated_exact_calls
            .map(|value| format!("{value:+}"))
            .unwrap_or_else(|| "unavailable".to_owned()),
        comparison.deltas.duration_ns
    );
    println!(
        "Output bytes: stdout {:+}, stderr {:+}; changed entries {:+}; validation failures {:+}.",
        comparison.deltas.stdout_bytes,
        comparison.deltas.stderr_bytes,
        comparison.deltas.final_changed_entries,
        comparison.deltas.validation_failed
    );
}

fn create_bundle(bundle: &Path, run_id: &str, capture: CaptureLevel) -> Result<()> {
    fs::create_dir(bundle)
        .with_context(|| format!("cannot create observation bundle `{}`", bundle.display()))?;
    set_directory_private(bundle)?;
    for name in ["artifacts", "calls", "operations", "runtime-bin"] {
        let directory = bundle.join(name);
        fs::create_dir(&directory)
            .with_context(|| format!("cannot create `{}`", directory.display()))?;
        set_directory_private(&directory)?;
    }
    let marker = ObservationBundleMarker {
        schema: OBSERVATION_BUNDLE_MARKER_SCHEMA.to_owned(),
        run_id: run_id.to_owned(),
        capture,
    };
    write_json_new(&bundle.join(OBSERVATION_MARKER_FILENAME), &marker)
}

fn write_experiment_record(bundle: &Path, spec: &ExperimentSpec) -> Result<()> {
    if spec.capture == CaptureLevel::AgentEffect {
        write_json_new(&bundle.join("experiment.json"), spec)
    } else {
        #[derive(Serialize)]
        struct OperationalExperiment<'a> {
            schema: &'a str,
            name: &'a str,
            capture: CaptureLevel,
            purpose_sha256: String,
            task_sha256: String,
            retention_until: &'a str,
            runtime: &'a RuntimeConfiguration,
            validation_count: usize,
        }
        write_json_new(
            &bundle.join("experiment.json"),
            &OperationalExperiment {
                schema: EXPERIMENT_SCHEMA,
                name: &spec.name,
                capture: spec.capture,
                purpose_sha256: sha256_bytes(spec.purpose.as_bytes()),
                task_sha256: sha256_bytes(spec.task.as_bytes()),
                retention_until: &spec.retention_until,
                runtime: &spec.runtime,
                validation_count: spec.validation_commands.len(),
            },
        )
    }
}

fn configure_observed_environment(
    command: &mut Command,
    runtime_bin: &Path,
    bundle: &Path,
    run_id: &str,
    capture: CaptureLevel,
    observer_executable: &Path,
    mindflow: &Path,
    stage: &str,
) {
    let path = env::var_os("PATH")
        .map(|path| {
            env::join_paths(
                std::iter::once(runtime_bin.to_path_buf()).chain(env::split_paths(&path)),
            )
            .unwrap_or_else(|_| runtime_bin.as_os_str().to_owned())
        })
        .unwrap_or_else(|| runtime_bin.as_os_str().to_owned());
    command
        .env("PATH", path)
        .env(OBSERVATION_BUNDLE_ENV, bundle)
        .env(OBSERVATION_RUN_ID_ENV, run_id)
        .env(OBSERVATION_CAPTURE_ENV, capture.as_str())
        .env(OBSERVATION_RECORDER_ENV, observer_executable)
        .env(OBSERVATION_MINDFLOW_ENV, mindflow)
        .env(OBSERVATION_STAGE_ENV, stage)
        .env_remove(OBSERVATION_CALL_ID_ENV);
}

fn install_mindflow_wrapper(runtime_bin: &Path) -> Result<()> {
    let wrapper = runtime_bin.join("mindflow");
    let source = concat!(
        "#!/bin/sh\n",
        "exec \"$MINDFLOW_OBSERVATION_RECORDER\" proxy ",
        "--bundle \"$MINDFLOW_OBSERVATION_BUNDLE\" ",
        "--mindflow \"$MINDFLOW_OBSERVATION_MINDFLOW\" -- \"$@\"\n",
    );
    let mut file = private_create_new(&wrapper)?;
    file.write_all(source.as_bytes())
        .with_context(|| format!("cannot write `{}`", wrapper.display()))?;
    file.flush()
        .with_context(|| format!("cannot flush `{}`", wrapper.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700))
            .with_context(|| format!("cannot make `{}` executable", wrapper.display()))?;
    }
    Ok(())
}

fn run_captured(
    command: &mut Command,
    capture_prefix: Option<&Path>,
    echo: bool,
) -> Result<CapturedCommand> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let started = Instant::now();
    let mut child = command.spawn().context("cannot launch observed command")?;
    let stdout = child.stdout.take().expect("piped stdout is available");
    let stderr = child.stderr.take().expect("piped stderr is available");
    let stdout_path = capture_prefix.map(|prefix| prefix.with_extension("stdout"));
    let stderr_path = capture_prefix.map(|prefix| prefix.with_extension("stderr"));

    let stdout_thread = thread::spawn(move || {
        stream_and_summarize(stdout, stdout_path.as_deref(), StreamTarget::Stdout, echo)
    });
    let stderr_thread = thread::spawn(move || {
        stream_and_summarize(stderr, stderr_path.as_deref(), StreamTarget::Stderr, echo)
    });
    let status = child.wait().context("cannot wait for observed command")?;
    let stdout = stdout_thread
        .join()
        .map_err(|_| anyhow!("stdout capture thread panicked"))??;
    let stderr = stderr_thread
        .join()
        .map_err(|_| anyhow!("stderr capture thread panicked"))??;
    Ok(CapturedCommand {
        exit_code: exit_code(status),
        duration_ns: duration_ns(started.elapsed()),
        stdout,
        stderr,
    })
}

#[derive(Clone, Copy)]
enum StreamTarget {
    Stdout,
    Stderr,
}

fn stream_and_summarize(
    mut input: impl Read,
    capture_path: Option<&Path>,
    target: StreamTarget,
    echo: bool,
) -> Result<StreamSummary> {
    let mut capture = capture_path.map(private_create_new).transpose()?;
    let mut digest = Sha256::new();
    let mut bytes = 0usize;
    let mut buffer = [0u8; 16 * 1024];
    loop {
        let read = input
            .read(&mut buffer)
            .context("cannot read observed stream")?;
        if read == 0 {
            break;
        }
        bytes = bytes.saturating_add(read);
        digest.update(&buffer[..read]);
        if let Some(file) = &mut capture {
            file.write_all(&buffer[..read])
                .context("cannot write captured observed stream")?;
        }
        if echo {
            match target {
                StreamTarget::Stdout => io::stdout()
                    .write_all(&buffer[..read])
                    .context("cannot echo observed stdout")?,
                StreamTarget::Stderr => io::stderr()
                    .write_all(&buffer[..read])
                    .context("cannot echo observed stderr")?,
            }
        }
    }
    if let Some(file) = &mut capture {
        file.flush()
            .context("cannot flush captured observed stream")?;
    }
    Ok(StreamSummary {
        bytes,
        sha256: format!("sha256:{:x}", digest.finalize()),
        file: capture_path
            .and_then(|path| path.file_name())
            .map(|name| name.to_string_lossy().into_owned()),
    })
}

fn capture_git_state(root: &Path) -> Result<GitState> {
    Ok(GitState {
        status: git_bytes(root, &["status", "--porcelain=v1", "-z"])?,
        diff: git_bytes(root, &["diff", "--binary", "--no-ext-diff"])?,
        staged_diff: git_bytes(root, &["diff", "--cached", "--binary", "--no-ext-diff"])?,
    })
}

fn write_git_state(
    bundle: &Path,
    name: &str,
    state: &GitState,
    capture: CaptureLevel,
) -> Result<()> {
    if capture != CaptureLevel::AgentEffect {
        return Ok(());
    }
    let directory = bundle.join(name);
    fs::create_dir(&directory)
        .with_context(|| format!("cannot create `{}`", directory.display()))?;
    set_directory_private(&directory)?;
    write_bytes_new(&directory.join("git-status"), &state.status)?;
    write_bytes_new(&directory.join("working.diff"), &state.diff)?;
    write_bytes_new(&directory.join("staged.diff"), &state.staged_diff)
}

fn git_root(project_root: &Path) -> Result<PathBuf> {
    PathBuf::from(git_text(project_root, &["rev-parse", "--show-toplevel"])?)
        .canonicalize()
        .context("cannot canonicalize Git worktree root")
}

fn git_text(root: &Path, arguments: &[&str]) -> Result<String> {
    let bytes = git_bytes(root, arguments)?;
    String::from_utf8(bytes)
        .context("Git returned non-UTF-8 text")
        .map(|value| value.trim_end().to_owned())
}

fn git_bytes(root: &Path, arguments: &[&str]) -> Result<Vec<u8>> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(arguments)
        .output()
        .with_context(|| format!("cannot run Git in `{}`", root.display()))?;
    if !output.status.success() {
        bail!(
            "Git command failed in `{}`: {}",
            root.display(),
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(output.stdout)
}

fn inspect_project_snapshot(mindflow: &Path, root: &Path) -> Result<(Option<String>, bool)> {
    let output = Command::new(mindflow)
        .arg("--root")
        .arg(root)
        .args(["status", "--json"])
        .env_remove(OBSERVATION_BUNDLE_ENV)
        .env_remove(OBSERVATION_RUN_ID_ENV)
        .env_remove(OBSERVATION_CAPTURE_ENV)
        .env_remove(OBSERVATION_CALL_ID_ENV)
        .env_remove(OBSERVATION_STAGE_ENV)
        .output()
        .with_context(|| format!("cannot inspect Mindflow project `{}`", root.display()))?;
    if !matches!(output.status.code(), Some(0 | 1)) {
        bail!(
            "cannot inspect project snapshot: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let value: Value = serde_json::from_slice(&output.stdout)
        .context("Mindflow status did not return its JSON contract")?;
    let snapshot = value
        .pointer("/status/snapshot/id")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let valid = value
        .pointer("/status/valid")
        .and_then(Value::as_bool)
        .ok_or_else(|| anyhow!("Mindflow status omitted `/status/valid`"))?;
    Ok((snapshot, valid))
}

fn record_artifact_bytes(
    bundle: &Path,
    kind: &str,
    label: Option<String>,
    bytes: &[u8],
) -> Result<ArtifactRecord> {
    validate_artifact_kind(kind)?;
    if bytes.len() > MAX_RECORDED_ARTIFACT_BYTES {
        bail!("one recorded artifact may not exceed {MAX_RECORDED_ARTIFACT_BYTES} bytes");
    }
    let marker = read_bundle_marker(bundle)?;
    if marker.capture != CaptureLevel::AgentEffect {
        bail!("runtime-visible artifacts require an agent-effect observation bundle");
    }
    let artifact_id = generate_id("artifact", &[kind.as_bytes(), bytes]);
    let data_name = format!("{artifact_id}.bin");
    let record_name = format!("{artifact_id}.json");
    write_bytes_new(&bundle.join("artifacts").join(&data_name), bytes)?;
    let record = ArtifactRecord {
        schema: ARTIFACT_SCHEMA.to_owned(),
        run_id: marker.run_id,
        artifact_id,
        kind: kind.to_owned(),
        label,
        recorded_unix_ns: unix_time_ns(),
        bytes: bytes.len(),
        sha256: sha256_bytes(bytes),
        file: data_name,
    };
    write_json_new(&bundle.join("artifacts").join(record_name), &record)?;
    Ok(record)
}

fn validate_artifact_kind(kind: &str) -> Result<()> {
    const KINDS: &[&str] = &[
        "prompt",
        "instruction",
        "plan",
        "plan-change",
        "transcript",
        "final-response",
        "document",
        "selected-owner",
        "review",
        "validation",
    ];
    if !KINDS.contains(&kind) {
        bail!(
            "artifact kind must be one of {}, not `{kind}`",
            KINDS.join(", ")
        );
    }
    Ok(())
}

fn allowed_artifact_roots(bundle: &Path) -> Result<Vec<PathBuf>> {
    let mut roots = vec![bundle.to_path_buf()];
    let experiment_path = bundle.join("experiment.json");
    let source = fs::read(&experiment_path)
        .with_context(|| format!("cannot read `{}`", experiment_path.display()))?;
    let spec: ExperimentSpec = serde_json::from_slice(&source)
        .with_context(|| format!("agent-effect experiment record is invalid"))?;
    roots.push(
        spec.project_root
            .canonicalize()
            .context("cannot access the experiment project root")?,
    );
    Ok(roots)
}

fn validate_spec(spec: &ExperimentSpec) -> Result<()> {
    if spec.schema != EXPERIMENT_SCHEMA {
        bail!("unsupported experiment schema `{}`", spec.schema);
    }
    for (field, value) in [
        ("name", spec.name.as_str()),
        ("purpose", spec.purpose.as_str()),
        ("task", spec.task.as_str()),
        ("retention_until", spec.retention_until.as_str()),
        ("runtime.name", spec.runtime.name.as_str()),
    ] {
        if value.is_empty() || value.trim() != value {
            bail!("experiment `{field}` must be nonempty and have no edge whitespace");
        }
    }
    if spec.capture == CaptureLevel::Operational && !spec.prompt_files.is_empty() {
        bail!("operational observation cannot capture prompt_files");
    }
    let mut owners = BTreeSet::new();
    for owner in &spec.expected_owners {
        if owner.is_empty() || owner.trim() != owner || !owners.insert(owner) {
            bail!("expected owner identities must be unique nonempty exact values");
        }
    }
    for (index, command) in spec.validation_commands.iter().enumerate() {
        if command.is_empty() || command.iter().any(String::is_empty) {
            bail!("validation command {index} must be a nonempty exact argv array");
        }
    }
    reject_secret_configuration(&spec.runtime.configuration, "runtime.configuration")
}

fn reject_secret_configuration(
    configuration: &BTreeMap<String, Value>,
    prefix: &str,
) -> Result<()> {
    for (key, value) in configuration {
        reject_secret_key(key, prefix)?;
        reject_secret_value(value, &format!("{prefix}.{key}"))?;
    }
    Ok(())
}

fn reject_secret_value(value: &Value, prefix: &str) -> Result<()> {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                reject_secret_key(key, prefix)?;
                reject_secret_value(value, &format!("{prefix}.{key}"))?;
            }
        }
        Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                reject_secret_value(item, &format!("{prefix}[{index}]"))?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn reject_secret_key(key: &str, prefix: &str) -> Result<()> {
    let normalized = key.to_ascii_lowercase().replace('-', "_");
    if [
        "secret",
        "password",
        "token",
        "credential",
        "api_key",
        "private_key",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
    {
        bail!("{prefix}.{key} looks secret-bearing and cannot enter an observation bundle");
    }
    Ok(())
}

fn read_operational_events(directory: &Path) -> Result<Vec<OperationalEvent>> {
    let mut events = Vec::new();
    for path in directory_entries(directory, "jsonl")? {
        let source = fs::read_to_string(&path)
            .with_context(|| format!("cannot read `{}`", path.display()))?;
        for (index, line) in source.lines().enumerate() {
            if line.is_empty() {
                continue;
            }
            events.push(serde_json::from_str(line).with_context(|| {
                format!("invalid event at `{}` line {}", path.display(), index + 1)
            })?);
        }
    }
    Ok(events)
}

fn read_json_directory<T: for<'de> Deserialize<'de>>(
    directory: &Path,
    extension: &str,
) -> Result<Vec<T>> {
    directory_entries(directory, extension)?
        .into_iter()
        .map(|path| read_json(&path))
        .collect()
}

fn directory_entries(directory: &Path, extension: &str) -> Result<Vec<PathBuf>> {
    let mut paths = fs::read_dir(directory)
        .with_context(|| format!("cannot read `{}`", directory.display()))?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<std::result::Result<Vec<_>, _>>()?;
    paths.retain(|path| path.extension().is_some_and(|item| item == extension));
    paths.sort();
    Ok(paths)
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T> {
    let source = fs::read(path).with_context(|| format!("cannot read `{}`", path.display()))?;
    serde_json::from_slice(&source).with_context(|| format!("invalid JSON in `{}`", path.display()))
}

fn write_json_new(path: &Path, value: &impl Serialize) -> Result<()> {
    let mut file = private_create_new(path)?;
    serde_json::to_writer_pretty(&mut file, value)
        .with_context(|| format!("cannot encode `{}`", path.display()))?;
    file.write_all(b"\n")
        .with_context(|| format!("cannot finish `{}`", path.display()))?;
    file.flush()
        .with_context(|| format!("cannot flush `{}`", path.display()))
}

fn write_bytes_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = private_create_new(path)?;
    file.write_all(bytes)
        .with_context(|| format!("cannot write `{}`", path.display()))?;
    file.flush()
        .with_context(|| format!("cannot flush `{}`", path.display()))
}

fn canonical_bundle(bundle: &Path) -> Result<PathBuf> {
    let bundle = bundle
        .canonicalize()
        .with_context(|| format!("cannot access observation bundle `{}`", bundle.display()))?;
    if !bundle.is_dir() {
        bail!(
            "observation bundle `{}` is not a directory",
            bundle.display()
        );
    }
    let _marker = read_bundle_marker(&bundle)?;
    Ok(bundle)
}

fn normalize_new_output(output: &Path) -> Result<PathBuf> {
    if output.exists() {
        bail!(
            "observation bundle target `{}` already exists",
            output.display()
        );
    }
    let name = output
        .file_name()
        .ok_or_else(|| anyhow!("observation bundle target must name a new directory"))?;
    let parent = output
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
        .canonicalize()
        .with_context(|| format!("cannot access bundle parent for `{}`", output.display()))?;
    Ok(parent.join(name))
}

fn resolve_from(base: &Path, path: &Path) -> Result<PathBuf> {
    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        base.join(path)
    };
    candidate
        .canonicalize()
        .with_context(|| format!("cannot access `{}`", candidate.display()))
}

fn resolve_confined(root: &Path, path: &Path) -> Result<PathBuf> {
    let resolved = resolve_from(root, path)?;
    if !resolved.starts_with(root) {
        bail!(
            "path `{}` escapes the experiment project root",
            path.display()
        );
    }
    Ok(resolved)
}

fn generate_id(prefix: &str, parts: &[&[u8]]) -> String {
    let mut digest = Sha256::new();
    digest.update(prefix.as_bytes());
    digest.update(unix_time_ns().to_le_bytes());
    digest.update(std::process::id().to_le_bytes());
    for part in parts {
        digest.update((part.len() as u64).to_le_bytes());
        digest.update(part);
    }
    let encoded = format!("{:x}", digest.finalize());
    format!("{prefix}-{}", &encoded[..24])
}

fn sha256_bytes(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

fn exit_code(status: ExitStatus) -> i32 {
    if let Some(code) = status.code() {
        return code;
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(signal) = status.signal() {
            return 128 + signal;
        }
    }
    2
}

fn delta_u64(baseline: u64, candidate: u64) -> i128 {
    candidate as i128 - baseline as i128
}

fn delta_usize(baseline: usize, candidate: usize) -> i128 {
    candidate as i128 - baseline as i128
}

fn default_true() -> bool {
    true
}
