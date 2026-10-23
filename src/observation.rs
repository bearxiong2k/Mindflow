use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const OBSERVATION_EVENT_SCHEMA: &str = "mindflow-operational-event/v1";
pub const OBSERVATION_BUNDLE_MARKER_SCHEMA: &str = "mindflow-observation-bundle/v1";
pub const OBSERVATION_BUNDLE_ENV: &str = "MINDFLOW_OBSERVATION_BUNDLE";
pub const OBSERVATION_RUN_ID_ENV: &str = "MINDFLOW_OBSERVATION_RUN_ID";
pub const OBSERVATION_CAPTURE_ENV: &str = "MINDFLOW_OBSERVATION_CAPTURE";
pub const OBSERVATION_CALL_ID_ENV: &str = "MINDFLOW_OBSERVATION_CALL_ID";
pub const OBSERVATION_STAGE_ENV: &str = "MINDFLOW_OBSERVATION_STAGE";
pub const OBSERVATION_RECORDER_ENV: &str = "MINDFLOW_OBSERVATION_RECORDER";
pub const OBSERVATION_MINDFLOW_ENV: &str = "MINDFLOW_OBSERVATION_MINDFLOW";
pub const OBSERVATION_MARKER_FILENAME: &str = ".mindflow-observation-bundle.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureLevel {
    Operational,
    AgentEffect,
}

impl CaptureLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Operational => "operational",
            Self::AgentEffect => "agent-effect",
        }
    }

    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "operational" => Ok(Self::Operational),
            "agent-effect" => Ok(Self::AgentEffect),
            _ => bail!(
                "{OBSERVATION_CAPTURE_ENV} must be `operational` or `agent-effect`, not `{value}`"
            ),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObservationBundleMarker {
    pub schema: String,
    pub run_id: String,
    pub capture: CaptureLevel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObservationOutcome {
    Success,
    Refused,
    Error,
}

impl ObservationOutcome {
    fn as_str(self) -> &'static str {
        match self {
            Self::Success => "success",
            Self::Refused => "refused",
            Self::Error => "error",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ObservationSpan {
    started_at: Instant,
    started_unix_ns: u64,
    elapsed: Option<Duration>,
}

impl ObservationSpan {
    fn new() -> Self {
        Self {
            started_at: Instant::now(),
            started_unix_ns: unix_time_ns(),
            elapsed: None,
        }
    }

    fn duration(&self) -> Duration {
        self.elapsed.unwrap_or_else(|| self.started_at.elapsed())
    }

    pub fn finish(mut self) -> Self {
        self.elapsed = Some(self.started_at.elapsed());
        self
    }
}

#[derive(Debug, Clone)]
pub struct ObservationRecord<'a> {
    pub scope: &'a str,
    pub operation: &'a str,
    pub outcome: ObservationOutcome,
    pub snapshot: Option<&'a str>,
    pub result_count: Option<usize>,
    pub response_bytes: Option<usize>,
    pub continuation: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperationalEvent {
    pub schema: String,
    pub run_id: String,
    pub invocation_id: String,
    pub sequence: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub call_id: Option<String>,
    pub stage: String,
    pub scope: String,
    pub operation: String,
    pub started_unix_ns: u64,
    pub duration_ns: u64,
    pub outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_bytes: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub continuation: Option<bool>,
}

pub trait ObservationSink: Send + Sync {
    fn record(&self, span: &ObservationSpan, record: ObservationRecord<'_>) -> Result<()>;
}

#[derive(Debug, Default)]
pub struct NoopObservationSink;

impl ObservationSink for NoopObservationSink {
    fn record(&self, _span: &ObservationSpan, _record: ObservationRecord<'_>) -> Result<()> {
        Ok(())
    }
}

struct JsonlObservationState {
    writer: BufWriter<File>,
    sequence: u64,
    run_id: String,
    invocation_id: String,
    call_id: Option<String>,
    stage: String,
}

struct JsonlObservationSink {
    state: Mutex<JsonlObservationState>,
}

impl ObservationSink for JsonlObservationSink {
    fn record(&self, span: &ObservationSpan, record: ObservationRecord<'_>) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| anyhow!("operational observation writer lock is poisoned"))?;
        state.sequence += 1;
        let event = OperationalEvent {
            schema: OBSERVATION_EVENT_SCHEMA.to_owned(),
            run_id: state.run_id.clone(),
            invocation_id: state.invocation_id.clone(),
            sequence: state.sequence,
            call_id: state.call_id.clone(),
            stage: state.stage.clone(),
            scope: record.scope.to_owned(),
            operation: record.operation.to_owned(),
            started_unix_ns: span.started_unix_ns,
            duration_ns: duration_ns(span.duration()),
            outcome: record.outcome.as_str().to_owned(),
            snapshot: record.snapshot.map(str::to_owned),
            result_count: record.result_count,
            response_bytes: record.response_bytes,
            continuation: record.continuation,
        };
        serde_json::to_writer(&mut state.writer, &event)
            .context("cannot encode operational observation event")?;
        state
            .writer
            .write_all(b"\n")
            .context("cannot write operational observation event")?;
        state
            .writer
            .flush()
            .context("cannot flush operational observation event")?;
        Ok(())
    }
}

#[derive(Clone)]
pub struct OperationalObserver {
    enabled: bool,
    sink: Arc<dyn ObservationSink>,
}

impl Default for OperationalObserver {
    fn default() -> Self {
        Self::disabled()
    }
}

impl OperationalObserver {
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            sink: Arc::new(NoopObservationSink),
        }
    }

    pub fn with_sink(sink: Arc<dyn ObservationSink>) -> Self {
        Self {
            enabled: true,
            sink,
        }
    }

    pub fn from_environment() -> Result<Self> {
        let bundle = env::var_os(OBSERVATION_BUNDLE_ENV);
        let run_id = env::var_os(OBSERVATION_RUN_ID_ENV);
        let capture = env::var_os(OBSERVATION_CAPTURE_ENV);

        if bundle.is_none() && run_id.is_none() && capture.is_none() {
            return Ok(Self::disabled());
        }
        let bundle = required_unicode_env(OBSERVATION_BUNDLE_ENV, bundle)?;
        let run_id = required_unicode_env(OBSERVATION_RUN_ID_ENV, run_id)?;
        let capture =
            CaptureLevel::parse(&required_unicode_env(OBSERVATION_CAPTURE_ENV, capture)?)?;
        validate_run_id(&run_id)?;

        let bundle = PathBuf::from(bundle).canonicalize().with_context(|| {
            format!("cannot access observation bundle from {OBSERVATION_BUNDLE_ENV}")
        })?;
        let marker = read_bundle_marker(&bundle)?;
        if marker.run_id != run_id {
            bail!(
                "observation run ID `{run_id}` does not match bundle marker `{}`",
                marker.run_id
            );
        }
        if marker.capture != capture {
            bail!(
                "observation capture `{}` does not match bundle marker `{}`",
                capture.as_str(),
                marker.capture.as_str()
            );
        }

        let operations = bundle.join("operations");
        fs::create_dir_all(&operations)
            .with_context(|| format!("cannot create `{}`", operations.display()))?;
        set_directory_private(&operations)?;

        let invocation_id = generate_invocation_id(&run_id);
        let event_path = operations.join(format!("{invocation_id}.jsonl"));
        let file = private_create_new(&event_path)?;
        let call_id = optional_unicode_env(OBSERVATION_CALL_ID_ENV)?;
        if let Some(call_id) = &call_id {
            validate_run_id(call_id)?;
        }
        let stage =
            optional_unicode_env(OBSERVATION_STAGE_ENV)?.unwrap_or_else(|| "agent".to_owned());
        validate_observation_stage(&stage)?;

        Ok(Self {
            enabled: true,
            sink: Arc::new(JsonlObservationSink {
                state: Mutex::new(JsonlObservationState {
                    writer: BufWriter::new(file),
                    sequence: 0,
                    run_id,
                    invocation_id,
                    call_id,
                    stage,
                }),
            }),
        })
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    pub fn start(&self) -> ObservationSpan {
        ObservationSpan::new()
    }

    pub fn record(&self, span: &ObservationSpan, record: ObservationRecord<'_>) -> Result<()> {
        self.sink.record(span, record)
    }
}

pub fn read_bundle_marker(bundle: &Path) -> Result<ObservationBundleMarker> {
    let marker_path = bundle.join(OBSERVATION_MARKER_FILENAME);
    let source = fs::read(&marker_path)
        .with_context(|| format!("cannot read observation marker `{}`", marker_path.display()))?;
    let marker: ObservationBundleMarker = serde_json::from_slice(&source)
        .with_context(|| format!("invalid observation marker `{}`", marker_path.display()))?;
    if marker.schema != OBSERVATION_BUNDLE_MARKER_SCHEMA {
        bail!(
            "unsupported observation marker schema `{}` in `{}`",
            marker.schema,
            marker_path.display()
        );
    }
    validate_run_id(&marker.run_id)?;
    Ok(marker)
}

pub fn validate_run_id(run_id: &str) -> Result<()> {
    if run_id.is_empty()
        || run_id.len() > 96
        || !run_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        bail!("invalid observation run ID `{run_id}`");
    }
    Ok(())
}

pub fn validate_observation_stage(stage: &str) -> Result<()> {
    if !matches!(stage, "agent" | "validation") {
        bail!("observation stage must be `agent` or `validation`, not `{stage}`");
    }
    Ok(())
}

pub fn unix_time_ns() -> u64 {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    nanos.min(u64::MAX as u128) as u64
}

pub fn duration_ns(duration: Duration) -> u64 {
    duration.as_nanos().min(u64::MAX as u128) as u64
}

pub fn private_create_new(path: &Path) -> Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .with_context(|| format!("cannot create private file `{}`", path.display()))
}

pub fn set_directory_private(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .with_context(|| format!("cannot make `{}` private", path.display()))?;
    }
    Ok(())
}

fn required_unicode_env(name: &str, value: Option<std::ffi::OsString>) -> Result<String> {
    let value = value.ok_or_else(|| anyhow!("{name} is required when observation is enabled"))?;
    value
        .into_string()
        .map_err(|_| anyhow!("{name} must contain Unicode text"))
}

fn optional_unicode_env(name: &str) -> Result<Option<String>> {
    env::var_os(name)
        .map(|value| {
            value
                .into_string()
                .map_err(|_| anyhow!("{name} must contain Unicode text"))
        })
        .transpose()
}

fn generate_invocation_id(run_id: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(run_id.as_bytes());
    digest.update(unix_time_ns().to_le_bytes());
    digest.update(std::process::id().to_le_bytes());
    format!(
        "invocation-{}-{}",
        std::process::id(),
        &format!("{:x}", digest.finalize())[..16]
    )
}
