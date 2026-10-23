use std::collections::BTreeMap;
use std::env;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::human::{
    self, FolderPickerResponse, OpenProjectResponse, ProjectDirectoryResponse,
    ReaderProjectSnapshot,
};
use crate::Project;

pub const PROTOCOL_VERSION: u32 = 6;
pub const MAX_FRAME_BYTES: usize = 48 * 1024 * 1024;
pub const STDERR_LIMIT_BYTES: usize = 64 * 1024;
pub const REQUIRED_CAPABILITIES: [&str; 6] = [
    "folder-picker-v1",
    "project-files-v1",
    "qc-v2",
    "reader-v3",
    "region-v4",
    "snapshot-v2",
];

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BridgeRequest {
    pub protocol: u32,
    pub id: u64,
    #[serde(flatten)]
    pub call: BridgeCall,
}

impl BridgeRequest {
    pub fn new(id: u64, call: BridgeCall) -> Self {
        Self {
            protocol: PROTOCOL_VERSION,
            id,
            call,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "method", content = "params", rename_all = "kebab-case")]
pub enum BridgeCall {
    Handshake(HandshakeParams),
    BrowseDirectory(OpenProjectParams),
    OpenProject(OpenProjectParams),
    RefreshProject(RootParams),
    ListDirectory(ProjectPathParams),
    DocumentationQc(DocumentationQcParams),
    DocumentationQcHistory(DocumentationQcHistoryParams),
    ReaderSnapshot(ReaderSnapshotParams),
    ReadImage(ProjectPathParams),
    Close,
}

impl BridgeCall {
    fn phase(&self) -> &'static str {
        match self {
            Self::Handshake(_) => "handshake",
            Self::BrowseDirectory(_) => "browse-directory",
            Self::OpenProject(_) => "open-project",
            Self::RefreshProject(_) => "refresh-project",
            Self::ListDirectory(_) => "list-directory",
            Self::DocumentationQc(_) => "documentation-qc",
            Self::DocumentationQcHistory(_) => "documentation-qc-history",
            Self::ReaderSnapshot(_) => "reader-snapshot",
            Self::ReadImage(_) => "read-image",
            Self::Close => "close",
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HandshakeParams {
    pub client_version: String,
    pub required_capabilities: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpenProjectParams {
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RootParams {
    pub root: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectPathParams {
    pub root: String,
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReaderSnapshotParams {
    pub root: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentationQcParams {
    pub root: String,
    pub snapshot: String,
    pub window: crate::documentation_qc::QcWindow,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentationQcHistoryParams {
    pub root: String,
    pub snapshot: String,
    pub offset: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BridgeResponse {
    pub protocol: u32,
    pub id: u64,
    #[serde(flatten)]
    pub outcome: BridgeOutcome,
}

impl BridgeResponse {
    fn success(id: u64, result: BridgeResult) -> Self {
        Self {
            protocol: PROTOCOL_VERSION,
            id,
            outcome: BridgeOutcome::Ok { result },
        }
    }

    fn failure(
        id: u64,
        code: BridgeErrorCode,
        phase: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            protocol: PROTOCOL_VERSION,
            id,
            outcome: BridgeOutcome::Error {
                error: BridgeError {
                    code,
                    phase: phase.into(),
                    message: bounded_message(message.into()),
                },
            },
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum BridgeOutcome {
    Ok { result: BridgeResult },
    Error { error: BridgeError },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "kebab-case")]
pub enum BridgeResult {
    Handshake(HandshakeResult),
    FolderDirectory(FolderPickerResponse),
    OpenProject(OpenProjectResponse),
    RefreshProject(OpenProjectResponse),
    Directory(ProjectDirectoryResponse),
    DocumentationQc(crate::documentation_qc::DocumentationQc),
    DocumentationQcHistory(crate::documentation_qc::DocumentationQcHistory),
    Reader(ReaderProjectSnapshot),
    ImageDataUrl(String),
    Closed,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HandshakeResult {
    pub bridge_version: String,
    pub runtime: crate::version::RuntimeVersion,
    pub capabilities: Vec<String>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BridgeErrorCode {
    InvalidRequest,
    IncompatibleProtocol,
    MissingCapability,
    ProjectAccess,
    StaleSnapshot,
    Internal,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BridgeError {
    pub code: BridgeErrorCode,
    pub phase: String,
    pub message: String,
}

pub fn bridge_version() -> String {
    format!(
        "mindflow-{}-bridge-{PROTOCOL_VERSION}",
        env!("CARGO_PKG_VERSION")
    )
}

pub fn capabilities() -> Vec<String> {
    REQUIRED_CAPABILITIES
        .iter()
        .map(|capability| (*capability).to_owned())
        .collect()
}

pub fn write_frame<W: Write, T: Serialize>(writer: &mut W, value: &T) -> Result<()> {
    let payload = serde_json::to_vec(value).context("cannot serialize bridge frame")?;
    if payload.is_empty() || payload.len() > MAX_FRAME_BYTES {
        bail!(
            "bridge payload is {} bytes; expected 1..={MAX_FRAME_BYTES}",
            payload.len()
        );
    }
    let length = u32::try_from(payload.len()).context("bridge frame length exceeds u32")?;
    writer
        .write_all(&length.to_be_bytes())
        .context("cannot write bridge frame length")?;
    writer
        .write_all(&payload)
        .context("cannot write bridge frame payload")?;
    writer.flush().context("cannot flush bridge frame")
}

pub fn read_frame<R: Read, T: DeserializeOwned>(reader: &mut R) -> Result<Option<T>> {
    let mut length_bytes = [0_u8; 4];
    match reader.read(&mut length_bytes[..1]) {
        Ok(0) => return Ok(None),
        Ok(1) => {}
        Ok(_) => unreachable!("one-byte read returned more than one byte"),
        Err(error) => return Err(error).context("cannot read bridge frame length"),
    }
    reader
        .read_exact(&mut length_bytes[1..])
        .context("truncated bridge frame length")?;
    let length = u32::from_be_bytes(length_bytes) as usize;
    if length == 0 || length > MAX_FRAME_BYTES {
        bail!("invalid bridge frame length {length}; expected 1..={MAX_FRAME_BYTES}");
    }
    let mut payload = vec![0_u8; length];
    reader
        .read_exact(&mut payload)
        .context("truncated bridge frame payload")?;
    let value = serde_json::from_slice(&payload).context("invalid bridge frame JSON")?;
    Ok(Some(value))
}

pub fn serve_stdio() -> Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    serve(stdin.lock(), stdout.lock())
}

pub fn serve<R: Read, W: Write>(mut reader: R, mut writer: W) -> Result<()> {
    let mut handshaken = false;
    let mut last_id = 0_u64;
    let mut projects = BTreeMap::new();

    while let Some(request) = read_frame::<_, BridgeRequest>(&mut reader)? {
        let (response, terminate) =
            handle_request(request, &mut handshaken, &mut last_id, &mut projects);
        write_frame(&mut writer, &response)?;
        if terminate {
            return Ok(());
        }
    }
    Ok(())
}

fn handle_request(
    request: BridgeRequest,
    handshaken: &mut bool,
    last_id: &mut u64,
    projects: &mut BTreeMap<String, Project>,
) -> (BridgeResponse, bool) {
    let phase = request.call.phase();
    if request.protocol != PROTOCOL_VERSION {
        return (
            BridgeResponse::failure(
                request.id,
                BridgeErrorCode::IncompatibleProtocol,
                phase,
                format!(
                    "bridge protocol {} is unsupported; expected {PROTOCOL_VERSION}",
                    request.protocol
                ),
            ),
            true,
        );
    }
    if request.id == 0 || request.id <= *last_id {
        return (
            BridgeResponse::failure(
                request.id,
                BridgeErrorCode::InvalidRequest,
                phase,
                "request id must be positive and strictly increasing",
            ),
            true,
        );
    }
    *last_id = request.id;

    if !*handshaken {
        let BridgeCall::Handshake(params) = request.call else {
            return (
                BridgeResponse::failure(
                    request.id,
                    BridgeErrorCode::InvalidRequest,
                    phase,
                    "handshake must be the first bridge request",
                ),
                true,
            );
        };
        if params.client_version.trim().is_empty() {
            return (
                BridgeResponse::failure(
                    request.id,
                    BridgeErrorCode::InvalidRequest,
                    "handshake",
                    "client_version must not be empty",
                ),
                true,
            );
        }
        if !is_lexically_unique(&params.required_capabilities) {
            return (
                BridgeResponse::failure(
                    request.id,
                    BridgeErrorCode::InvalidRequest,
                    "handshake",
                    "required_capabilities must be lexically ordered and unique",
                ),
                true,
            );
        }
        let supported = capabilities();
        if let Some(missing) = params
            .required_capabilities
            .iter()
            .find(|required| !supported.contains(required))
        {
            return (
                BridgeResponse::failure(
                    request.id,
                    BridgeErrorCode::MissingCapability,
                    "handshake",
                    format!("required capability '{missing}' is unavailable"),
                ),
                true,
            );
        }
        *handshaken = true;
        return (
            BridgeResponse::success(
                request.id,
                BridgeResult::Handshake(HandshakeResult {
                    bridge_version: bridge_version(),
                    runtime: crate::version::runtime_version(),
                    capabilities: supported,
                }),
            ),
            false,
        );
    }

    let response = match request.call {
        BridgeCall::Handshake(_) => {
            return (
                BridgeResponse::failure(
                    request.id,
                    BridgeErrorCode::InvalidRequest,
                    "handshake",
                    "handshake may occur only once",
                ),
                true,
            );
        }
        BridgeCall::BrowseDirectory(params) => match expand_remote_project_path(&params.path)
            .and_then(human::browse_folder_directory)
        {
            Ok(directory) => {
                BridgeResponse::success(request.id, BridgeResult::FolderDirectory(directory))
            }
            Err(message) => BridgeResponse::failure(
                request.id,
                BridgeErrorCode::ProjectAccess,
                "browse-directory",
                message,
            ),
        },
        BridgeCall::OpenProject(params) => match expand_remote_project_path(&params.path)
            .and_then(|path| open_and_cache_project(path, projects))
        {
            Ok(response) => {
                BridgeResponse::success(request.id, BridgeResult::OpenProject(response))
            }
            Err(message) => BridgeResponse::failure(
                request.id,
                BridgeErrorCode::ProjectAccess,
                "open-project",
                message,
            ),
        },
        BridgeCall::RefreshProject(params) => match canonical_root_argument(&params.root)
            .and_then(|root| open_and_cache_project(root, projects))
        {
            Ok(response) => {
                BridgeResponse::success(request.id, BridgeResult::RefreshProject(response))
            }
            Err(message) => BridgeResponse::failure(
                request.id,
                BridgeErrorCode::ProjectAccess,
                "refresh-project",
                message,
            ),
        },
        BridgeCall::ListDirectory(params) => {
            match canonical_root_argument(&params.root)
                .and_then(|root| human::list_project_directory(root, &params.path))
            {
                Ok(directory) => {
                    BridgeResponse::success(request.id, BridgeResult::Directory(directory))
                }
                Err(message) => BridgeResponse::failure(
                    request.id,
                    BridgeErrorCode::ProjectAccess,
                    "list-directory",
                    message,
                ),
            }
        }
        BridgeCall::DocumentationQc(params) => {
            match projects.get(&params.root).filter(|project| project.snapshot_identity().id == params.snapshot) {
                Some(project) => match crate::documentation_qc::observe_window(project, params.window) {
                    Ok(report) => BridgeResponse::success(request.id, BridgeResult::DocumentationQc(report)),
                    Err(error) => BridgeResponse::failure(request.id, BridgeErrorCode::ProjectAccess, phase, format!("{error:#}")),
                },
                None => BridgeResponse::failure(request.id, BridgeErrorCode::StaleSnapshot, phase,
                    "QC requires the exact retained Region snapshot; refresh the project first"),
            }
        }
        BridgeCall::DocumentationQcHistory(params) => {
            match projects.get(&params.root).filter(|project| project.snapshot_identity().id == params.snapshot) {
                Some(project) => match crate::documentation_qc::history_choices(project, params.offset) {
                    Ok(report) => BridgeResponse::success(request.id, BridgeResult::DocumentationQcHistory(report)),
                    Err(error) => BridgeResponse::failure(request.id, BridgeErrorCode::ProjectAccess, phase, format!("{error:#}")),
                },
                None => BridgeResponse::failure(request.id, BridgeErrorCode::StaleSnapshot, phase,
                    "QC history requires the exact retained Region snapshot; refresh the project first"),
            }
        }
        BridgeCall::ReaderSnapshot(params) => match cached_reader_snapshot(projects, &params) {
            Ok(snapshot) => BridgeResponse::success(request.id, BridgeResult::Reader(snapshot)),
            Err(error) => {
                let (code, message) = match error {
                    CachedReaderError::Stale(message) => (BridgeErrorCode::StaleSnapshot, message),
                    CachedReaderError::Project(message) => {
                        (BridgeErrorCode::ProjectAccess, message)
                    }
                };
                BridgeResponse::failure(request.id, code, "reader-snapshot", message)
            }
        },
        BridgeCall::ReadImage(params) => match canonical_root_argument(&params.root)
            .and_then(|root| human::reader_image_data_url(root, &params.path))
        {
            Ok(data_url) => {
                BridgeResponse::success(request.id, BridgeResult::ImageDataUrl(data_url))
            }
            Err(message) => BridgeResponse::failure(
                request.id,
                BridgeErrorCode::ProjectAccess,
                "read-image",
                message,
            ),
        },
        BridgeCall::Close => {
            return (
                BridgeResponse::success(request.id, BridgeResult::Closed),
                true,
            );
        }
    };
    (response, false)
}

fn is_lexically_unique(values: &[String]) -> bool {
    values.windows(2).all(|pair| pair[0] < pair[1])
}

fn open_and_cache_project(
    path: PathBuf,
    projects: &mut BTreeMap<String, Project>,
) -> Result<OpenProjectResponse, String> {
    if let Ok(root) = Project::discover(&path) {
        let root_key = root.display().to_string();
        let project_name = human::project_label(&root);
        let requested_path = path.display().to_string();
        let project = match Project::load(root) {
            Ok(project) => project,
            Err(error) => {
                projects.remove(&root_key);
                return Ok(OpenProjectResponse::Error {
                    requested_path,
                    root: Some(root_key),
                    project: project_name,
                    message: format!("{error:#}"),
                });
            }
        };
        return match human::region_response(&project) {
            Ok(region) => {
                projects.insert(region.root.clone(), project);
                Ok(OpenProjectResponse::Region { region })
            }
            Err(message) => {
                projects.remove(&root_key);
                Ok(OpenProjectResponse::Error {
                    requested_path,
                    root: Some(root_key),
                    project: project_name,
                    message,
                })
            }
        };
    }

    let response = human::open_project(path);
    let root = match &response {
        OpenProjectResponse::Folder { root, .. } => Some(root),
        OpenProjectResponse::Error { root, .. } => root.as_ref(),
        OpenProjectResponse::Region { .. } => None,
    };
    if let Some(root) = root {
        projects.remove(root);
    }
    Ok(response)
}

enum CachedReaderError {
    Stale(String),
    Project(String),
}

fn cached_reader_snapshot(
    projects: &BTreeMap<String, Project>,
    params: &ReaderSnapshotParams,
) -> Result<ReaderProjectSnapshot, CachedReaderError> {
    let root = canonical_root_argument(&params.root).map_err(CachedReaderError::Project)?;
    let root_key = root.display().to_string();
    match (&params.snapshot, projects.get(&root_key)) {
        (Some(requested), Some(project)) => {
            if requested != &project.snapshot_identity().id {
                return Err(CachedReaderError::Stale(format!(
                    "requested {requested}, current bridge snapshot is {}",
                    project.snapshot_identity().id
                )));
            }
            human::reader_snapshot_for_project(project, &params.path, false)
                .map_err(CachedReaderError::Project)
        }
        (Some(_), None) => Err(CachedReaderError::Stale(
            "project is not open in this bridge session; refresh it first".to_owned(),
        )),
        (None, Some(_)) => Err(CachedReaderError::Stale(
            "an opened Region Reader request must name its retained snapshot".to_owned(),
        )),
        (None, None) => {
            if Project::discover(&root).is_ok_and(|discovered| discovered == root) {
                return Err(CachedReaderError::Stale(
                    "project is a Region but is not open in this bridge session; refresh it first"
                        .to_owned(),
                ));
            }
            let snapshot =
                human::reader_snapshot(root, &params.path).map_err(CachedReaderError::Project)?;
            Ok(snapshot)
        }
    }
}

fn expand_remote_project_path(path: &str) -> Result<PathBuf, String> {
    if path == "~" {
        return remote_home();
    }
    if let Some(relative) = path.strip_prefix("~/") {
        if relative.is_empty() {
            return remote_home();
        }
        return Ok(remote_home()?.join(relative));
    }
    let path = Path::new(path);
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }
    Err("remote project path must be absolute, '~', or begin with '~/'".to_owned())
}

fn remote_home() -> Result<PathBuf, String> {
    let home = env::var_os("HOME").ok_or_else(|| "remote HOME is unavailable".to_owned())?;
    let home = PathBuf::from(home);
    if !home.is_absolute() {
        return Err("remote HOME is not an absolute path".to_owned());
    }
    Ok(home)
}

fn canonical_root_argument(root: &str) -> Result<PathBuf, String> {
    let root = Path::new(root);
    if !root.is_absolute() {
        return Err("project root must be a canonical absolute remote path".to_owned());
    }
    human::canonical_project_folder(root)
}

fn bounded_message(message: String) -> String {
    const MAX_CHARS: usize = 4096;
    if message.chars().count() <= MAX_CHARS {
        return message;
    }
    let mut bounded = message.chars().take(MAX_CHARS).collect::<String>();
    bounded.push('…');
    bounded
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io::Cursor;
    use std::process::Command;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;
    use crate::Project;

    struct TemporaryProject(PathBuf);

    impl TemporaryProject {
        fn new() -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let sequence = COUNTER.fetch_add(1, Ordering::Relaxed);
            let root = env::temp_dir().join(format!(
                "mindflow-bridge-{}-{nonce}-{sequence}",
                std::process::id()
            ));
            fs::create_dir(&root).unwrap();
            let status = Command::new("git")
                .args(["init", "--quiet"])
                .current_dir(&root)
                .status()
                .unwrap();
            assert!(status.success());
            Project::initialize(root.clone()).unwrap();
            fs::write(root.join("notes.txt"), "remote reader\n").unwrap();
            fs::create_dir(root.join("nested")).unwrap();
            Self(root)
        }
    }

    impl Drop for TemporaryProject {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn qc_requires_retained_snapshot_and_returns_the_shared_observation() {
        let fixture = TemporaryProject::new();
        let project = Project::load(fixture.0.clone()).unwrap();
        let root = project.root.display().to_string();
        let snapshot = project.snapshot_identity().id.clone();
        let expected = serde_json::to_value(crate::documentation_qc::observe(&project, 10).unwrap()).unwrap();
        let mut projects = BTreeMap::from([(root.clone(), project)]);
        let mut handshaken = true;
        let mut last_id = 0;
        let request = |id, snapshot| BridgeRequest::new(id, BridgeCall::DocumentationQc(DocumentationQcParams {
            root: root.clone(), snapshot, window: crate::documentation_qc::QcWindow::Recent { commits: 10 },
        }));
        let (response, terminate) = handle_request(request(1, "stale".into()), &mut handshaken, &mut last_id, &mut projects);
        assert!(!terminate);
        assert!(matches!(response.outcome, BridgeOutcome::Error { error: BridgeError { code: BridgeErrorCode::StaleSnapshot, .. } }));
        let (response, terminate) = handle_request(request(2, snapshot.clone()), &mut handshaken, &mut last_id, &mut projects);
        assert!(!terminate);
        let BridgeOutcome::Ok { result: BridgeResult::DocumentationQc(report) } = response.outcome else { panic!("QC failed") };
        assert_eq!(serde_json::to_value(report).unwrap(), expected);
        let history_request = |id, snapshot| BridgeRequest::new(id, BridgeCall::DocumentationQcHistory(DocumentationQcHistoryParams {
            root: root.clone(), snapshot, offset: 0,
        }));
        let (response, _) = handle_request(history_request(3, "stale".into()), &mut handshaken, &mut last_id, &mut projects);
        assert!(matches!(response.outcome, BridgeOutcome::Error { error: BridgeError { code: BridgeErrorCode::StaleSnapshot, .. } }));
        let (response, _) = handle_request(history_request(4, snapshot.clone()), &mut handshaken, &mut last_id, &mut projects);
        let BridgeOutcome::Ok { result: BridgeResult::DocumentationQcHistory(history) } = response.outcome else { panic!("QC history failed") };
        assert_eq!(history.snapshot.id, snapshot);
        assert_eq!(history.schema, "mindflow-documentation-qc-history/v1");
        assert!(history.commits.is_empty());
        assert!(!history.has_more);
    }

    #[test]
    fn frame_round_trip_and_boundaries_are_exact() {
        let request = BridgeRequest::new(
            1,
            BridgeCall::Handshake(HandshakeParams {
                client_version: "test".to_owned(),
                required_capabilities: capabilities(),
            }),
        );
        let mut bytes = Vec::new();
        write_frame(&mut bytes, &request).unwrap();
        let decoded: BridgeRequest = read_frame(&mut Cursor::new(bytes)).unwrap().unwrap();
        assert_eq!(decoded.id, 1);
        assert!(matches!(decoded.call, BridgeCall::Handshake(_)));

        let mut truncated = Cursor::new(vec![0, 0, 0, 2, b'{']);
        assert!(read_frame::<_, BridgeRequest>(&mut truncated).is_err());
        let mut oversized = Cursor::new(((MAX_FRAME_BYTES as u32) + 1).to_be_bytes());
        assert!(read_frame::<_, BridgeRequest>(&mut oversized).is_err());
    }

    #[test]
    fn bridge_serves_region_files_reader_and_close_in_one_session() {
        let project = TemporaryProject::new();
        let canonical = project.0.canonicalize().unwrap();
        let root = canonical.display().to_string();
        let snapshot = Project::load(canonical.clone())
            .unwrap()
            .snapshot_identity()
            .id
            .clone();
        let requests = [
            BridgeRequest::new(
                1,
                BridgeCall::Handshake(HandshakeParams {
                    client_version: "test".to_owned(),
                    required_capabilities: capabilities(),
                }),
            ),
            BridgeRequest::new(
                2,
                BridgeCall::BrowseDirectory(OpenProjectParams { path: root.clone() }),
            ),
            BridgeRequest::new(
                3,
                BridgeCall::OpenProject(OpenProjectParams { path: root.clone() }),
            ),
            BridgeRequest::new(
                4,
                BridgeCall::ListDirectory(ProjectPathParams {
                    root: root.clone(),
                    path: String::new(),
                }),
            ),
            BridgeRequest::new(
                5,
                BridgeCall::ReaderSnapshot(ReaderSnapshotParams {
                    root: root.clone(),
                    path: "notes.txt".to_owned(),
                    snapshot: Some(snapshot.clone()),
                }),
            ),
            BridgeRequest::new(
                6,
                BridgeCall::ReaderSnapshot(ReaderSnapshotParams {
                    root: root.clone(),
                    path: "notes.txt".to_owned(),
                    snapshot: Some(format!("sha256:{}", "0".repeat(64))),
                }),
            ),
            BridgeRequest::new(7, BridgeCall::Close),
        ];
        let mut input = Vec::new();
        for request in requests {
            write_frame(&mut input, &request).unwrap();
        }
        let mut output = Vec::new();
        serve(Cursor::new(input), &mut output).unwrap();

        let mut responses = Cursor::new(output);
        assert!(matches!(
            read_frame::<_, BridgeResponse>(&mut responses)
                .unwrap()
                .unwrap()
                .outcome,
            BridgeOutcome::Ok {
                result: BridgeResult::Handshake(handshake)
            } if handshake.runtime == crate::version::runtime_version()
        ));
        assert!(matches!(
            read_frame::<_, BridgeResponse>(&mut responses)
                .unwrap()
                .unwrap()
                .outcome,
            BridgeOutcome::Ok {
                result: BridgeResult::FolderDirectory(FolderPickerResponse { entries, .. })
            } if entries.iter().any(|entry| entry.name == "nested")
        ));
        assert!(matches!(
            read_frame::<_, BridgeResponse>(&mut responses)
                .unwrap()
                .unwrap()
                .outcome,
            BridgeOutcome::Ok {
                result: BridgeResult::OpenProject(OpenProjectResponse::Region { region })
            } if region.version.format.as_deref() == Some(crate::project::CURRENT_FORMAT)
        ));
        match read_frame::<_, BridgeResponse>(&mut responses)
            .unwrap()
            .unwrap()
            .outcome
        {
            BridgeOutcome::Ok {
                result: BridgeResult::Directory(directory),
            } => assert!(directory
                .entries
                .iter()
                .any(|entry| entry.path == "notes.txt")),
            response => panic!("unexpected directory response: {response:?}"),
        }
        match read_frame::<_, BridgeResponse>(&mut responses)
            .unwrap()
            .unwrap()
            .outcome
        {
            BridgeOutcome::Ok {
                result: BridgeResult::Reader(reader),
            } => {
                assert_eq!(reader.document.content, "remote reader\n");
                assert_eq!(reader.snapshot.unwrap().id, snapshot);
                assert!(reader.graph.is_none());
            }
            response => panic!("unexpected Reader response: {response:?}"),
        }
        assert!(matches!(
            read_frame::<_, BridgeResponse>(&mut responses)
                .unwrap()
                .unwrap()
                .outcome,
            BridgeOutcome::Error {
                error: BridgeError {
                    code: BridgeErrorCode::StaleSnapshot,
                    ..
                }
            }
        ));
        assert!(matches!(
            read_frame::<_, BridgeResponse>(&mut responses)
                .unwrap()
                .unwrap()
                .outcome,
            BridgeOutcome::Ok {
                result: BridgeResult::Closed
            }
        ));
        assert!(read_frame::<_, BridgeResponse>(&mut responses)
            .unwrap()
            .is_none());
    }

    #[test]
    fn bridge_keeps_unregistered_folder_readers_outside_semantic_snapshots() {
        let project = TemporaryProject::new();
        fs::remove_file(project.0.join(crate::project::MANIFEST_FILENAME)).unwrap();
        let root = project.0.canonicalize().unwrap().display().to_string();
        let requests = [
            BridgeRequest::new(
                1,
                BridgeCall::Handshake(HandshakeParams {
                    client_version: "test".to_owned(),
                    required_capabilities: capabilities(),
                }),
            ),
            BridgeRequest::new(
                2,
                BridgeCall::OpenProject(OpenProjectParams { path: root.clone() }),
            ),
            BridgeRequest::new(
                3,
                BridgeCall::ReaderSnapshot(ReaderSnapshotParams {
                    root,
                    path: "notes.txt".to_owned(),
                    snapshot: None,
                }),
            ),
            BridgeRequest::new(4, BridgeCall::Close),
        ];
        let mut input = Vec::new();
        for request in requests {
            write_frame(&mut input, &request).unwrap();
        }
        let mut output = Vec::new();
        serve(Cursor::new(input), &mut output).unwrap();
        let mut responses = Cursor::new(output);
        let _handshake: BridgeResponse = read_frame(&mut responses).unwrap().unwrap();
        assert!(matches!(
            read_frame::<_, BridgeResponse>(&mut responses)
                .unwrap()
                .unwrap()
                .outcome,
            BridgeOutcome::Ok {
                result: BridgeResult::OpenProject(OpenProjectResponse::Folder { .. })
            }
        ));
        match read_frame::<_, BridgeResponse>(&mut responses)
            .unwrap()
            .unwrap()
            .outcome
        {
            BridgeOutcome::Ok {
                result: BridgeResult::Reader(reader),
            } => {
                assert!(reader.snapshot.is_none());
                assert!(reader.graph.is_some());
                assert_eq!(reader.document.content, "remote reader\n");
            }
            response => panic!("unexpected folder Reader response: {response:?}"),
        }
    }

    #[test]
    fn bridge_refuses_to_infer_an_unretained_region_reader_snapshot() {
        let project = TemporaryProject::new();
        let root = project.0.canonicalize().unwrap().display().to_string();
        let requests = [
            BridgeRequest::new(
                1,
                BridgeCall::Handshake(HandshakeParams {
                    client_version: "test".to_owned(),
                    required_capabilities: capabilities(),
                }),
            ),
            BridgeRequest::new(
                2,
                BridgeCall::ReaderSnapshot(ReaderSnapshotParams {
                    root,
                    path: "notes.txt".to_owned(),
                    snapshot: None,
                }),
            ),
            BridgeRequest::new(3, BridgeCall::Close),
        ];
        let mut input = Vec::new();
        for request in requests {
            write_frame(&mut input, &request).unwrap();
        }
        let mut output = Vec::new();
        serve(Cursor::new(input), &mut output).unwrap();
        let mut responses = Cursor::new(output);
        let _handshake: BridgeResponse = read_frame(&mut responses).unwrap().unwrap();
        assert!(matches!(
            read_frame::<_, BridgeResponse>(&mut responses)
                .unwrap()
                .unwrap()
                .outcome,
            BridgeOutcome::Error {
                error: BridgeError {
                    code: BridgeErrorCode::StaleSnapshot,
                    ..
                }
            }
        ));
    }

    #[test]
    fn request_identity_and_handshake_fail_closed() {
        let request = BridgeRequest::new(
            1,
            BridgeCall::OpenProject(OpenProjectParams {
                path: "/tmp".to_owned(),
            }),
        );
        let mut input = Vec::new();
        write_frame(&mut input, &request).unwrap();
        let mut output = Vec::new();
        serve(Cursor::new(input), &mut output).unwrap();
        let response: BridgeResponse = read_frame(&mut Cursor::new(output)).unwrap().unwrap();
        assert!(matches!(
            response.outcome,
            BridgeOutcome::Error {
                error: BridgeError {
                    code: BridgeErrorCode::InvalidRequest,
                    ..
                }
            }
        ));
    }

    #[test]
    fn previous_protocol_cannot_negotiate_the_calendar_format_payload() {
        let mut request = BridgeRequest::new(
            1,
            BridgeCall::Handshake(HandshakeParams {
                client_version: "previous-client".to_owned(),
                required_capabilities: vec!["region-v2".to_owned()],
            }),
        );
        request.protocol = 4;
        let mut input = Vec::new();
        write_frame(&mut input, &request).unwrap();
        let mut output = Vec::new();
        serve(Cursor::new(input), &mut output).unwrap();
        let response: BridgeResponse = read_frame(&mut Cursor::new(output)).unwrap().unwrap();
        assert!(matches!(
            response.outcome,
            BridgeOutcome::Error {
                error: BridgeError {
                    code: BridgeErrorCode::IncompatibleProtocol,
                    ..
                }
            }
        ));
    }
}
