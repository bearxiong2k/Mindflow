mod ssh;
mod windowing;
mod versions;

use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};
#[cfg(test)]
use std::time::{SystemTime, UNIX_EPOCH};

use mindflow::human::{
    self, DocumentResponse, OpenProjectResponse as OpenRegionResponse, ProjectDirectoryResponse,
    ReaderDocumentKind, RegionResponse,
};
#[cfg(test)]
use mindflow::human::{ProjectEntryKind, ReaderContentKind};
#[cfg(test)]
use mindflow::project::CURRENT_FORMAT;
use mindflow::Project;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use ssh::{parse_access_root, SshSessionManager};
use windowing::{
    encode_restore_plan, parse_process_startup, parse_window_launch, DesktopController, OpenBatch,
    ProcessStartup, ReaderWindowSession, WindowMode, RESTORE_WINDOWS_ARGUMENT,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReaderWindowSnapshot {
    root: String,
    project: String,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    snapshot: Option<mindflow::project::SnapshotIdentity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fragment: Option<String>,
    graph: mindflow::model::GraphData,
    document: DocumentResponse,
    kind: ReaderDocumentKind,
    interface_scale: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum ReaderNavigationMode {
    SameReader,
    NewReader,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum ReaderInspectionTarget {
    Document { path: String },
    Relationship { index: usize },
}

#[derive(Clone, Debug, Serialize)]
struct ReaderNavigationEvent {
    root: String,
    path: String,
}

#[derive(Clone, Debug, Serialize)]
struct ReaderInspectionEvent {
    root: String,
    target: Option<ReaderInspectionTarget>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "action", rename_all = "kebab-case")]
enum RefreshProjectResponse {
    Region { region: RegionResponse },
    Folder { root: String, project: String },
    Relaunch,
}

#[derive(Debug)]
struct AppBuildState {
    source_digest: Option<String>,
}

#[derive(Debug, Default)]
struct LocalProjectStore {
    projects: Mutex<BTreeMap<(String, String), Arc<Project>>>,
    pending: Mutex<BTreeMap<(String, String), Arc<()>>>,
}

impl LocalProjectStore {
    fn projects(&self) -> Result<MutexGuard<'_, BTreeMap<(String, String), Arc<Project>>>, String> {
        self.projects
            .lock()
            .map_err(|_| "local Mindflow project store is unavailable".to_owned())
    }

    #[cfg(test)]
    fn retain(&self, owner: &str, project: Project) -> Result<RegionResponse, String> {
        let root = project.root.clone();
        self.load_region_with(owner, &root, || Ok(project))
    }

    fn load_region(&self, owner: &str, root: impl AsRef<Path>) -> Result<RegionResponse, String> {
        let root = root.as_ref();
        self.load_region_with(owner, root, || {
            Project::load(root.to_path_buf()).map_err(|error| format!("{error:#}"))
        })
    }

    fn load_region_with(
        &self,
        owner: &str,
        root: &Path,
        load: impl FnOnce() -> Result<Project, String>,
    ) -> Result<RegionResponse, String> {
        let key = (owner.to_owned(), root.display().to_string());
        let ticket = Arc::new(());
        self.pending
            .lock()
            .map_err(|_| "local project load registry is unavailable")?
            .insert(key.clone(), Arc::clone(&ticket));
        let result = load().and_then(|project| {
            human::region_response(&project).map(|region| (Arc::new(project), region))
        });
        // A close or newer load removes/replaces this ticket. Holding the pending
        // lock through insertion makes cleanup atomic with publishing a result.
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "local project load registry is unavailable")?;
        if !pending
            .get(&key)
            .is_some_and(|current| Arc::ptr_eq(current, &ticket))
        {
            return Err("Mindflow project was closed or replaced while loading".to_owned());
        }
        pending.remove(&key);
        let (project, region) = result?;
        self.projects()?.insert(key, project);
        Ok(region)
    }

    fn opened_region(&self, owner: &str, root: &Path) -> Result<Option<RegionResponse>, String> {
        let project = self
            .projects()?
            .get(&(owner.to_owned(), root.display().to_string()))
            .cloned();
        project
            .map(|project| human::region_response(&project))
            .transpose()
    }

    fn release_region(&self, owner: &str, root: &Path) -> Result<(), String> {
        let key = (owner.to_owned(), root.display().to_string());
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "local project load registry is unavailable")?;
        pending.remove(&key);
        self.projects()?.remove(&key);
        Ok(())
    }

    fn release_workspace(&self, owner: &str) -> Result<(), String> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "local project load registry is unavailable")?;
        pending.retain(|(workspace, _), _| workspace != owner);
        self.projects()?
            .retain(|(workspace, _), _| workspace != owner);
        Ok(())
    }

    fn canonical_root(&self, root: &str) -> Result<String, String> {
        Ok(canonical_desktop_folder(root)?.display().to_string())
    }

    fn retained_project(
        &self,
        owner: &str,
        root: &str,
        expected_snapshot: &str,
    ) -> Result<Arc<Project>, String> {
        let project = self
            .projects()?
            .get(&(owner.to_owned(), root.to_owned()))
            .cloned()
            .ok_or_else(|| {
                format!(
                "Mindflow project '{root}' is not retained by workspace '{owner}'; refresh it first"
            )
            })?;
        if project.snapshot_identity().id != expected_snapshot {
            return Err(format!(
                "Mindflow Reader requested snapshot {expected_snapshot}, but the retained project snapshot is {}",
                project.snapshot_identity().id
            ));
        }
        Ok(project)
    }

    fn validate_reader_root(
        &self,
        owner: &str,
        root: &str,
        expected_snapshot: Option<&str>,
    ) -> Result<String, String> {
        let root = self.canonical_root(root)?;
        match expected_snapshot {
            Some(snapshot) => {
                self.retained_project(owner, &root, snapshot)?;
            }
            None if self
                .projects()?
                .contains_key(&(owner.to_owned(), root.clone())) =>
            {
                return Err(
                    "an opened Region Reader request must name its retained snapshot".to_owned(),
                );
            }
            None => {}
        }
        Ok(root)
    }

    fn reader_snapshot(
        &self,
        owner: &str,
        root: &str,
        path: &str,
        expected_snapshot: Option<&str>,
    ) -> Result<mindflow::human::ReaderProjectSnapshot, String> {
        let root = self.canonical_root(root)?;
        match expected_snapshot {
            Some(snapshot) => {
                let project = self.retained_project(owner, &root, snapshot)?;
                human::reader_snapshot_for_project(project.as_ref(), path, true)
            }
            None if self
                .projects()?
                .contains_key(&(owner.to_owned(), root.clone())) =>
            {
                Err("an opened Region Reader request must name its retained snapshot".to_owned())
            }
            None => human::reader_snapshot(root, path),
        }
    }
}

fn synchronization_record_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target/release/bundle/macos/.mindflow-toolchain-digest")
}

fn parse_source_digest(record: &str) -> Option<String> {
    record.lines().find_map(|line| {
        let mut fields = line.split_whitespace();
        match (fields.next(), fields.next(), fields.next()) {
            (Some("source-digest"), Some(digest), None) => Some(digest.to_owned()),
            _ => None,
        }
    })
}

fn parse_synchronized_app_executable(record: &str) -> Option<PathBuf> {
    let mut selected = None;

    for line in record.lines() {
        let Some(value) = line.strip_prefix("app-executable ") else {
            if line == "app-executable" || line.starts_with("app-executable\t") {
                return None;
            }
            continue;
        };
        if selected.is_some() || value.is_empty() || value.trim() != value {
            return None;
        }

        let path = Path::new(value);
        if path.is_absolute() {
            return None;
        }
        let components = path
            .components()
            .map(|component| match component {
                Component::Normal(value) => Some(value),
                _ => None,
            })
            .collect::<Option<Vec<_>>>()?;
        if components.len() != 8
            || components[0] != OsStr::new("target")
            || components[1] != OsStr::new("release")
            || components[2] != OsStr::new("bundle")
            || components[3] != OsStr::new("macos")
            || components[5] != OsStr::new("Contents")
            || components[6] != OsStr::new("MacOS")
            || components[7] != OsStr::new("mindflow-desktop")
        {
            return None;
        }
        let app_bundle = components[4].to_string_lossy();
        if app_bundle == ".app" || !app_bundle.ends_with(".app") {
            return None;
        }

        selected = Some(path.to_path_buf());
    }

    selected
}

fn synchronized_app_executable_path() -> Option<PathBuf> {
    fs::read_to_string(synchronization_record_path())
        .ok()
        .and_then(|record| parse_synchronized_app_executable(&record))
        .map(|relative| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative))
}

fn current_source_digest() -> Option<String> {
    fs::read_to_string(synchronization_record_path())
        .ok()
        .and_then(|record| parse_source_digest(&record))
}

fn synchronized_build_changed(started: Option<&str>, current: Option<&str>) -> bool {
    current.is_some() && current != started
}

fn synchronized_build_activation_required(
    activate_synchronized_build: bool,
    started: Option<&str>,
    current: Option<&str>,
) -> bool {
    activate_synchronized_build && synchronized_build_changed(started, current)
}

#[cfg(test)]
fn open_region(root: impl AsRef<Path>) -> Result<RegionResponse, String> {
    human::open_region(root)
}

const READER_STATE_CHANGED_EVENT: &str = "mindflow-reader-state-changed";
const READER_NAVIGATION_EVENT: &str = "mindflow-reader-navigation";
const READER_INSPECTION_EVENT: &str = "mindflow-reader-inspection";

fn normalized_reader_scale(interface_scale: f64) -> f64 {
    if interface_scale.is_finite() {
        interface_scale.clamp(0.8, 1.4)
    } else {
        1.0
    }
}

fn reader_window_title(root: &str, path: &str) -> String {
    let document = Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(path);
    let project = Path::new(root)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Mindflow");
    format!("{document} — {project} — Mindflow Reader")
}

#[cfg(test)]
fn validated_desktop_project(root: impl AsRef<Path>) -> Result<Project, String> {
    human::validated_project(root)
}

fn canonical_desktop_folder(root: impl AsRef<Path>) -> Result<PathBuf, String> {
    human::canonical_project_folder(root)
}

fn project_directory_for(root: &Path, path: &str) -> Result<ProjectDirectoryResponse, String> {
    human::list_project_directory(root, path)
}

#[cfg(test)]
fn project_file_document_for(root: &Path, path: &str) -> Result<DocumentResponse, String> {
    human::project_file_document_for(root, path)
}

#[cfg(test)]
fn project_document_for(project: &Project, path: &str) -> Result<DocumentResponse, String> {
    human::project_document_for(project, path)
}

#[cfg(test)]
fn reader_window_snapshot_for(
    session: ReaderWindowSession,
) -> Result<ReaderWindowSnapshot, String> {
    let snapshot = human::reader_snapshot(PathBuf::from(&session.root), &session.path)?;
    let graph = snapshot
        .graph
        .ok_or_else(|| "local Reader snapshot omitted its project graph".to_owned())?;
    Ok(ReaderWindowSnapshot {
        root: snapshot.root,
        project: snapshot.project,
        path: session.path.clone(),
        snapshot: snapshot.snapshot,
        fragment: session.fragment.clone(),
        graph,
        document: snapshot.document,
        kind: snapshot.kind,
        interface_scale: session.interface_scale,
    })
}

fn reader_project_snapshot_for_access(
    owner: &str,
    ssh_sessions: &SshSessionManager,
    local_projects: &LocalProjectStore,
    root: &str,
    path: &str,
    expected_snapshot: Option<&str>,
) -> Result<mindflow::human::ReaderProjectSnapshot, String> {
    match parse_access_root(root)? {
        Some(access) => ssh_sessions.reader_snapshot(owner, &access, path, expected_snapshot),
        None => local_projects.reader_snapshot(owner, root, path, expected_snapshot),
    }
}

fn reader_window_snapshot_for_access(
    ssh_sessions: &SshSessionManager,
    local_projects: &LocalProjectStore,
    session: ReaderWindowSession,
) -> Result<ReaderWindowSnapshot, String> {
    let snapshot = reader_project_snapshot_for_access(
        &session.owner_window,
        ssh_sessions,
        local_projects,
        &session.root,
        &session.path,
        session.snapshot.as_deref(),
    )?;
    let graph = snapshot
        .graph
        .ok_or_else(|| "Reader snapshot omitted its project graph".to_owned())?;
    Ok(ReaderWindowSnapshot {
        root: snapshot.root,
        project: snapshot.project,
        path: session.path.clone(),
        snapshot: snapshot.snapshot,
        fragment: session.fragment.clone(),
        graph,
        document: snapshot.document,
        kind: snapshot.kind,
        interface_scale: session.interface_scale,
    })
}

fn reader_image_data_url_for_access(
    owner: &str,
    ssh_sessions: &SshSessionManager,
    root: &str,
    path: &str,
) -> Result<String, String> {
    match parse_access_root(root)? {
        Some(access) => ssh_sessions.image_data_url(owner, &access, path),
        None => reader_image_data_url_for(Path::new(root), path),
    }
}

fn reader_image_data_url_for(root: &Path, path: &str) -> Result<String, String> {
    human::reader_image_data_url(root, path)
}

const CALLER_CWD_ARGUMENT: &str = "--mindflow-caller-cwd";
const RELAUNCH_AFTER_PID_ARGUMENT: &str = "--mindflow-relaunch-after-pid";
const ISOLATED_TEST_INSTANCE_ENV: &str = "MINDFLOW_ISOLATED_TEST_INSTANCE";
const TEST_OPEN_REQUEST_LOG_ENV: &str = "MINDFLOW_TEST_OPEN_REQUEST_LOG";

fn isolated_test_identifier(
    base_identifier: &str,
    namespace: Option<&OsStr>,
) -> Result<Option<String>, String> {
    let Some(namespace) = namespace else {
        return Ok(None);
    };
    let namespace = namespace
        .to_str()
        .ok_or_else(|| format!("{ISOLATED_TEST_INSTANCE_ENV} must be valid UTF-8"))?;
    if namespace.is_empty()
        || !namespace
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(format!(
            "{ISOLATED_TEST_INSTANCE_ENV} must contain only ASCII letters, digits, and hyphens"
        ));
    }
    Ok(Some(format!("{base_identifier}.isolated-test.{namespace}")))
}

fn record_test_message(message: &str) {
    let Some(path) = env::var_os(TEST_OPEN_REQUEST_LOG_ENV) else {
        return;
    };
    let Ok(mut log) = fs::OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    let _ = writeln!(log, "{message}");
}

fn record_test_open_request(arguments: &[String]) {
    let record = arguments
        .iter()
        .map(|argument| argument.replace('\n', "\\n"))
        .collect::<Vec<_>>()
        .join("\t");
    record_test_message(&format!("received\t{record}"));
}

fn open_response_identity(response: &OpenRegionResponse) -> String {
    match response {
        OpenRegionResponse::Region { region } => format!("region:{}", region.root),
        OpenRegionResponse::Folder { root, .. } => format!("folder:{root}"),
        OpenRegionResponse::Error { requested_path, .. } => format!("error:{requested_path}"),
    }
}

#[derive(Debug)]
enum StartingPath {
    Explicit(PathBuf),
    Implicit(PathBuf),
}

impl StartingPath {
    fn path(&self) -> &Path {
        match self {
            Self::Explicit(path) | Self::Implicit(path) => path,
        }
    }

    fn is_explicit(&self) -> bool {
        matches!(self, Self::Explicit(_))
    }
}

#[derive(Debug)]
enum ResolvedStartingPath {
    Root {
        requested_path: PathBuf,
        root: PathBuf,
    },
    Folder {
        root: PathBuf,
    },
    Error {
        requested_path: PathBuf,
        message: String,
    },
}

fn discover_starting_path(path: &OsStr) -> Result<PathBuf, String> {
    Project::discover(Path::new(path)).map_err(|error| format!("{error:#}"))
}

fn parse_starting_paths(
    environment_root: Option<OsString>,
    arguments: Vec<OsString>,
    implicit_default: Option<PathBuf>,
) -> Result<Vec<StartingPath>, String> {
    if let Some(root) = environment_root {
        return Ok(vec![StartingPath::Explicit(PathBuf::from(root))]);
    }

    if arguments
        .first()
        .is_some_and(|value| value == CALLER_CWD_ARGUMENT)
    {
        if arguments.len() != 2 {
            return Err(format!(
                "{CALLER_CWD_ARGUMENT} requires exactly one caller directory"
            ));
        }
        return Ok(vec![StartingPath::Implicit(PathBuf::from(&arguments[1]))]);
    }

    if arguments.is_empty() {
        return Ok(implicit_default
            .into_iter()
            .map(StartingPath::Implicit)
            .collect());
    }

    Ok(arguments
        .into_iter()
        .map(PathBuf::from)
        .map(StartingPath::Explicit)
        .collect())
}

fn resolve_starting_paths(starting_paths: Vec<StartingPath>) -> Vec<ResolvedStartingPath> {
    let mut seen_roots = BTreeSet::new();
    let mut resolved = Vec::new();

    for starting_path in starting_paths {
        let requested_path = starting_path.path().to_path_buf();
        match discover_starting_path(starting_path.path().as_os_str()) {
            Ok(root) if seen_roots.insert(root.clone()) => {
                resolved.push(ResolvedStartingPath::Root {
                    requested_path,
                    root,
                });
            }
            Ok(_) => {}
            Err(message) if starting_path.is_explicit() => {
                match canonical_desktop_folder(&requested_path) {
                    Ok(root) if seen_roots.insert(root.clone()) => {
                        resolved.push(ResolvedStartingPath::Folder { root });
                    }
                    Ok(_) => {}
                    Err(folder_message) => resolved.push(ResolvedStartingPath::Error {
                        requested_path,
                        message: format!("{message}\n{folder_message}"),
                    }),
                }
            }
            Err(_) => {}
        }
    }

    resolved
}

fn project_label(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Mindflow region")
        .to_owned()
}

fn open_starting_paths_retained(
    owner: &str,
    starting_paths: Vec<StartingPath>,
    local_projects: &LocalProjectStore,
    refresh: bool,
) -> Vec<OpenRegionResponse> {
    resolve_starting_paths(starting_paths)
        .into_iter()
        .map(|resolved| {
            if !refresh {
                let root = match &resolved {
                    ResolvedStartingPath::Root { root, .. }
                    | ResolvedStartingPath::Folder { root } => Some(root),
                    ResolvedStartingPath::Error { .. } => None,
                };
                if let Some(root) = root {
                    if let Ok(Some(region)) = local_projects.opened_region(owner, root) {
                        return OpenRegionResponse::Region { region };
                    }
                }
            }
            match resolved {
                ResolvedStartingPath::Root {
                    requested_path,
                    root,
                } => match local_projects.load_region(owner, &root) {
                    Ok(region) => OpenRegionResponse::Region { region },
                    Err(message) => OpenRegionResponse::Error {
                        requested_path: requested_path.display().to_string(),
                        root: Some(root.display().to_string()),
                        project: project_label(&root),
                        message,
                    },
                },
                ResolvedStartingPath::Folder { root } => {
                    match local_projects.release_region(owner, &root) {
                        Ok(()) => OpenRegionResponse::Folder {
                            project: project_label(&root),
                            root: root.display().to_string(),
                        },
                        Err(message) => OpenRegionResponse::Error {
                            requested_path: root.display().to_string(),
                            root: Some(root.display().to_string()),
                            project: project_label(&root),
                            message,
                        },
                    }
                }
                ResolvedStartingPath::Error {
                    requested_path,
                    message,
                } => OpenRegionResponse::Error {
                    project: project_label(&requested_path),
                    requested_path: requested_path.display().to_string(),
                    root: None,
                    message,
                },
            }
        })
        .collect()
}

fn open_starting_paths_with_access(
    owner: &str,
    starting_paths: Vec<StartingPath>,
    ssh_sessions: &SshSessionManager,
    local_projects: &LocalProjectStore,
) -> Vec<OpenRegionResponse> {
    let mut seen = BTreeSet::new();
    let mut responses = Vec::new();
    for starting_path in starting_paths {
        let requested = starting_path.path().display().to_string();
        let response = if requested.starts_with("ssh://") {
            match parse_access_root(&requested) {
                Ok(Some(access)) => match ssh_sessions.open_project(owner, &access.destination, &access.root) {
                    Ok(response) => Some(response),
                    Err(message) => Some(OpenRegionResponse::Error {
                        requested_path: requested.clone(),
                        root: Some(requested.clone()),
                        project: project_label(Path::new(&access.root)),
                        message,
                    }),
                },
                Ok(None) => unreachable!("SSH prefix was checked before access parsing"),
                Err(message) => Some(OpenRegionResponse::Error {
                    requested_path: requested.clone(),
                    root: None,
                    project: "SSH project".to_owned(),
                    message,
                }),
            }
        } else {
            open_starting_paths_retained(owner, vec![starting_path], local_projects, false)
                .into_iter()
                .next()
        };
        if let Some(response) = response {
            let identity = open_response_identity(&response);
            if seen.insert(identity) {
                responses.push(response);
            }
        }
    }
    responses
}

fn requested_starting_paths(arguments: Vec<OsString>) -> Result<Vec<StartingPath>, String> {
    #[cfg(debug_assertions)]
    let implicit_default = Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."));
    #[cfg(not(debug_assertions))]
    let implicit_default = None;

    parse_starting_paths(env::var_os("MINDFLOW_ROOT"), arguments, implicit_default)
}

#[tauri::command]
fn startup_regions(
    window: WebviewWindow,
    controller: tauri::State<'_, DesktopController>,
    ssh_sessions: tauri::State<'_, SshSessionManager>,
    local_projects: tauri::State<'_, LocalProjectStore>,
) -> Result<Vec<Vec<OpenRegionResponse>>, String> {
    let batches = controller.drain(window.label())?;
    open_batches(window.label(), batches, &ssh_sessions, &local_projects)
}

#[tauri::command]
fn open_regions(
    window: WebviewWindow,
    ssh_sessions: tauri::State<'_, SshSessionManager>,
    local_projects: tauri::State<'_, LocalProjectStore>,
    arguments: Vec<String>,
) -> Result<Vec<OpenRegionResponse>, String> {
    open_region_arguments(window.label(), arguments, &ssh_sessions, &local_projects)
}

fn open_region_arguments(
    owner: &str,
    arguments: Vec<String>,
    ssh_sessions: &SshSessionManager,
    local_projects: &LocalProjectStore,
) -> Result<Vec<OpenRegionResponse>, String> {
    open_batch(
        owner,
        OpenBatch::Requested(arguments.into_iter().map(OsString::from).collect()),
        ssh_sessions,
        local_projects,
    )
}

fn open_batch(
    owner: &str,
    batch: OpenBatch,
    ssh_sessions: &SshSessionManager,
    local_projects: &LocalProjectStore,
) -> Result<Vec<OpenRegionResponse>, String> {
    match batch {
        OpenBatch::Startup(arguments) => requested_starting_paths(arguments)
            .map(|paths| open_starting_paths_with_access(owner, paths, ssh_sessions, local_projects)),
        OpenBatch::Requested(arguments) => parse_starting_paths(None, arguments, None)
            .map(|paths| open_starting_paths_with_access(owner, paths, ssh_sessions, local_projects)),
    }
}

fn open_batches(
    window_label: &str,
    batches: Vec<OpenBatch>,
    ssh_sessions: &SshSessionManager,
    local_projects: &LocalProjectStore,
) -> Result<Vec<Vec<OpenRegionResponse>>, String> {
    record_test_message(&format!("drained\t{window_label}\t{}", batches.len()));
    let responses = batches
        .into_iter()
        .map(|batch| open_batch(window_label, batch, ssh_sessions, local_projects))
        .collect::<Result<Vec<_>, _>>()?;
    let opened = responses
        .iter()
        .map(|batch| {
            batch
                .iter()
                .map(open_response_identity)
                .collect::<Vec<_>>()
                .join(",")
        })
        .collect::<Vec<_>>()
        .join("|");
    record_test_message(&format!(
        "opened\t{window_label}\t{}\t{opened}",
        responses.len()
    ));
    Ok(responses)
}

#[tauri::command]
fn take_pending_open_regions(
    window: WebviewWindow,
    controller: tauri::State<'_, DesktopController>,
    ssh_sessions: tauri::State<'_, SshSessionManager>,
    local_projects: tauri::State<'_, LocalProjectStore>,
) -> Result<Vec<Vec<OpenRegionResponse>>, String> {
    let batches = controller.drain(window.label())?;
    open_batches(window.label(), batches, &ssh_sessions, &local_projects)
}

#[tauri::command]
fn open_ssh_region(
    window: WebviewWindow,
    ssh_sessions: tauri::State<'_, SshSessionManager>,
    destination: String,
    path: String,
) -> Result<OpenRegionResponse, String> {
    ssh_sessions.open_project(window.label(), &destination, &path)
}

#[tauri::command]
fn list_ssh_destinations() -> Result<Vec<String>, String> {
    ssh::configured_destinations()
}

#[tauri::command]
fn close_ssh_picker(
    window: WebviewWindow,
    ssh_sessions: tauri::State<'_, SshSessionManager>,
) -> Result<(), String> {
    ssh_sessions.release_picker(window.label())
}

#[tauri::command]
fn browse_ssh_directory(
    window: WebviewWindow,
    ssh_sessions: tauri::State<'_, SshSessionManager>,
    destination: String,
    path: String,
    connect_if_missing: bool,
) -> Result<mindflow::human::FolderPickerResponse, String> {
    ssh_sessions.browse_directory(window.label(), &destination, &path, connect_if_missing)
}

fn activate_window(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("Mindflow window '{label}' is unavailable"))?;
    record_test_message(&format!("activation\tstarted\t{label}"));
    window
        .show()
        .map_err(|error| format!("cannot show Mindflow window '{label}': {error}"))?;
    window
        .unminimize()
        .map_err(|error| format!("cannot restore Mindflow window '{label}': {error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("cannot focus Mindflow window '{label}': {error}"))?;
    record_test_message(&format!("activation\tcompleted\t{label}"));
    Ok(())
}

fn emit_reader_state_changed(
    app: &tauri::AppHandle,
    label: &str,
    session: &ReaderWindowSession,
) -> Result<(), String> {
    let reader = app
        .get_webview_window(label)
        .ok_or_else(|| format!("Mindflow Reader '{label}' is unavailable"))?;
    reader
        .emit(READER_STATE_CHANGED_EVENT, session)
        .map_err(|error| format!("cannot update Mindflow Reader '{label}': {error}"))
}

fn emit_reader_navigation(
    app: &tauri::AppHandle,
    owner_window: &str,
    root: &str,
    path: &str,
) -> Result<(), String> {
    let owner = app
        .get_webview_window(owner_window)
        .ok_or_else(|| format!("Mindflow workspace '{owner_window}' is unavailable"))?;
    owner
        .emit(
            READER_NAVIGATION_EVENT,
            ReaderNavigationEvent {
                root: root.to_owned(),
                path: path.to_owned(),
            },
        )
        .map_err(|error| format!("cannot synchronize Reader navigation: {error}"))
}

fn reader_cascade_position(
    app: &tauri::AppHandle,
    controller: &DesktopController,
    owner_window: &str,
    root: &str,
) -> Option<(f64, f64)> {
    let anchor_label = controller
        .frontmost_reader(owner_window, root)
        .ok()
        .flatten()
        .unwrap_or_else(|| owner_window.to_owned());
    let anchor = app.get_webview_window(&anchor_label)?;
    let position = anchor.outer_position().ok()?;
    let scale = anchor.scale_factor().ok()?;
    Some((
        f64::from(position.x) / scale + 32.0,
        f64::from(position.y) / scale + 32.0,
    ))
}

fn create_reader_window(
    app: &tauri::AppHandle,
    controller: &DesktopController,
    session: ReaderWindowSession,
) -> Result<String, String> {
    let cascade_position =
        reader_cascade_position(app, controller, &session.owner_window, &session.root);
    let label = controller.allocate_reader_label();
    let title = reader_window_title(&session.root, &session.path);
    controller.register_reader(label.clone(), session)?;
    let mut builder =
        WebviewWindowBuilder::new(app, label.clone(), WebviewUrl::App("index.html".into()))
            .title(title)
            .inner_size(720.0, 820.0)
            .min_inner_size(420.0, 300.0)
            .resizable(true)
            .focused(true);
    if let Some((x, y)) = cascade_position {
        builder = builder.position(x, y).prevent_overflow();
    }
    if let Err(error) = builder.build() {
        let _ = controller.remove_reader(&label);
        return Err(format!("cannot create Mindflow Reader '{label}': {error}"));
    }
    record_test_message(&format!("reader\tcreated\t{label}"));
    Ok(label)
}

fn create_workspace_window(app: &tauri::AppHandle, initial: OpenBatch) -> Result<String, String> {
    let controller = app.state::<DesktopController>();
    let cascade_position = controller
        .preferred_window_label()?
        .and_then(|label| app.get_webview_window(&label))
        .and_then(|window| {
            let position = window.outer_position().ok()?;
            let scale = window.scale_factor().ok()?;
            Some((
                f64::from(position.x) / scale + 28.0,
                f64::from(position.y) / scale + 28.0,
            ))
        });
    let label = controller.allocate_window_label();
    controller.register_window(label.clone(), initial)?;
    let mut builder =
        WebviewWindowBuilder::new(app, label.clone(), WebviewUrl::App("index.html".into()))
            .title("Mindflow")
            .inner_size(1440.0, 920.0)
            .min_inner_size(900.0, 620.0)
            .resizable(true)
            .focused(true);
    if let Some((x, y)) = cascade_position {
        builder = builder.position(x, y).prevent_overflow();
    }
    let built = builder.build();
    if let Err(error) = built {
        let _ = controller.remove_window(&label);
        return Err(format!("cannot create Mindflow window '{label}': {error}"));
    }
    record_test_message(&format!("window\tcreated\t{label}"));
    Ok(label)
}

fn route_forwarded_launch(app: &tauri::AppHandle, arguments: Vec<String>) -> Result<(), String> {
    let launch = parse_window_launch(arguments.into_iter().map(OsString::from).collect())?;
    record_test_message(&format!(
        "route\t{}\t{}",
        launch.mode.as_str(),
        launch.arguments.len()
    ));
    let batch = OpenBatch::Requested(launch.arguments);
    match launch.mode {
        WindowMode::New => {
            let label = create_workspace_window(app, batch)?;
            activate_window(app, &label)
        }
        WindowMode::Reuse => {
            let controller = app.state::<DesktopController>();
            if let Some(label) = controller.enqueue_for_reuse(batch.clone())? {
                if app.get_webview_window(&label).is_some() && activate_window(app, &label).is_ok()
                {
                    return Ok(());
                }
                controller.remove_window(&label)?;
            }
            let label = create_workspace_window(app, batch)?;
            activate_window(app, &label)
        }
    }
}

#[tauri::command]
async fn create_project_window(
    app: tauri::AppHandle,
    arguments: Vec<String>,
) -> Result<String, String> {
    create_workspace_window(
        &app,
        OpenBatch::Requested(arguments.into_iter().map(OsString::from).collect()),
    )
}

#[tauri::command]
async fn present_reader_window(
    app: tauri::AppHandle,
    window: WebviewWindow,
    controller: tauri::State<'_, DesktopController>,
    ssh_sessions: tauri::State<'_, SshSessionManager>,
    local_projects: tauri::State<'_, LocalProjectStore>,
    root: String,
    snapshot: Option<String>,
    path: String,
    interface_scale: f64,
    mode: ReaderNavigationMode,
    fragment: Option<String>,
) -> Result<String, String> {
    let present_started = Instant::now();
    record_test_message(&format!("reader\tpresent-started\t{}", window.label()));
    let caller_reader = controller.reader_session(window.label())?;
    let (owner_window, root, snapshot, interface_scale, local_reader) =
        if let Some(reader) = caller_reader {
            (
                reader.owner_window,
                reader.root,
                reader.snapshot,
                reader.interface_scale,
                Some(window.label().to_owned()),
            )
        } else {
            if !controller.has_workspace(window.label())? {
                return Err(format!(
                    "Mindflow window '{}' cannot own a Reader",
                    window.label()
                ));
            }
            (
                window.label().to_owned(),
                root,
                snapshot,
                normalized_reader_scale(interface_scale),
                None,
            )
        };

    let root = match parse_access_root(&root)? {
        Some(access) => ssh_sessions.validate_reader_root(&owner_window, &access, snapshot.as_deref())?,
        None => local_projects.validate_reader_root(&owner_window, &root, snapshot.as_deref())?,
    };
    record_test_message(&format!(
        "reader\ttarget-validated\t{}\t{}ms",
        window.label(),
        present_started.elapsed().as_millis()
    ));

    let reuse_label = match mode {
        ReaderNavigationMode::NewReader => None,
        ReaderNavigationMode::SameReader => match local_reader {
            Some(label) => Some(label),
            None => controller.frontmost_reader(&owner_window, &root)?,
        },
    };

    let label = if let Some(label) = reuse_label {
        if let Some(reader) = app.get_webview_window(&label) {
            let session = controller.update_reader(
                &label,
                snapshot.clone(),
                path.clone(),
                fragment.clone(),
                normalized_reader_scale(interface_scale),
            )?;
            reader
                .set_title(&reader_window_title(&session.root, &session.path))
                .map_err(|error| format!("cannot update Mindflow Reader title: {error}"))?;
            emit_reader_state_changed(&app, &label, &session)?;
            activate_window(&app, &label)?;
            label
        } else {
            controller.remove_reader(&label)?;
            create_reader_window(
                &app,
                &controller,
                ReaderWindowSession {
                    owner_window: owner_window.clone(),
                    root: root.clone(),
                    snapshot: snapshot.clone(),
                    path: path.clone(),
                    fragment: fragment.clone(),
                    interface_scale: normalized_reader_scale(interface_scale),
                },
            )?
        }
    } else {
        create_reader_window(
            &app,
            &controller,
            ReaderWindowSession {
                owner_window: owner_window.clone(),
                root: root.clone(),
                snapshot: snapshot.clone(),
                path: path.clone(),
                fragment: fragment.clone(),
                interface_scale: normalized_reader_scale(interface_scale),
            },
        )?
    };

    emit_reader_navigation(&app, &owner_window, &root, &path)?;
    record_test_message(&format!(
        "reader\tpresent-completed\t{label}\t{}ms",
        present_started.elapsed().as_millis()
    ));
    Ok(label)
}

#[tauri::command]
fn reader_window_snapshot(
    window: WebviewWindow,
    controller: tauri::State<'_, DesktopController>,
    ssh_sessions: tauri::State<'_, SshSessionManager>,
    local_projects: tauri::State<'_, LocalProjectStore>,
) -> Result<ReaderWindowSnapshot, String> {
    let load_started = Instant::now();
    let session = controller
        .reader_session(window.label())?
        .ok_or_else(|| format!("Mindflow window '{}' is not a Reader", window.label()))?;
    let snapshot = reader_window_snapshot_for_access(&ssh_sessions, &local_projects, session)?;
    record_test_message(&format!(
        "reader\tsnapshot-loaded\t{}\t{}ms",
        window.label(),
        load_started.elapsed().as_millis()
    ));
    Ok(snapshot)
}

#[tauri::command]
fn reader_image_data_url(
    window: WebviewWindow,
    controller: tauri::State<'_, DesktopController>,
    ssh_sessions: tauri::State<'_, SshSessionManager>,
    path: String,
) -> Result<String, String> {
    let session = controller
        .reader_session(window.label())?
        .ok_or_else(|| format!("Mindflow window '{}' is not a Reader", window.label()))?;
    reader_image_data_url_for_access(&session.owner_window, &ssh_sessions, &session.root, &path)
}

#[tauri::command]
fn inspect_reader_target(
    app: tauri::AppHandle,
    window: WebviewWindow,
    controller: tauri::State<'_, DesktopController>,
    target: Option<ReaderInspectionTarget>,
) -> Result<(), String> {
    let session = controller
        .reader_session(window.label())?
        .ok_or_else(|| format!("Mindflow window '{}' is not a Reader", window.label()))?;
    let owner = app
        .get_webview_window(&session.owner_window)
        .ok_or_else(|| {
            format!(
                "Mindflow workspace '{}' is unavailable",
                session.owner_window
            )
        })?;
    owner
        .emit(
            READER_INSPECTION_EVENT,
            ReaderInspectionEvent {
                root: session.root,
                target,
            },
        )
        .map_err(|error| format!("cannot synchronize Reader inspection: {error}"))
}

#[tauri::command]
fn update_reader_window_scale(
    app: tauri::AppHandle,
    window: WebviewWindow,
    controller: tauri::State<'_, DesktopController>,
    root: String,
    interface_scale: f64,
) -> Result<(), String> {
    if !controller.has_workspace(window.label())? {
        return Err(format!(
            "Mindflow window '{}' cannot update project Readers",
            window.label()
        ));
    }
    let updated = controller.update_reader_scale(
        window.label(),
        &root,
        normalized_reader_scale(interface_scale),
    )?;
    for (label, session) in updated {
        if emit_reader_state_changed(&app, &label, &session).is_err() {
            controller.remove_reader(&label)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn reconcile_reader_windows(
    app: tauri::AppHandle,
    window: WebviewWindow,
    controller: tauri::State<'_, DesktopController>,
    ssh_sessions: tauri::State<'_, SshSessionManager>,
    local_projects: tauri::State<'_, LocalProjectStore>,
    root: String,
    snapshot: Option<String>,
) -> Result<(), String> {
    if !controller.has_workspace(window.label())? {
        return Err(format!(
            "Mindflow window '{}' cannot reconcile project Readers",
            window.label()
        ));
    }
    let root = match parse_access_root(&root)? {
        Some(access) => ssh_sessions.validate_reader_root(window.label(), &access, snapshot.as_deref())?,
        None => local_projects.validate_reader_root(window.label(), &root, snapshot.as_deref())?,
    };
    for (label, _) in controller.reader_sessions_for(window.label(), &root)? {
        let session = controller.update_reader_snapshot(&label, snapshot.clone())?;
        if reader_project_snapshot_for_access(
            &session.owner_window,
            &ssh_sessions,
            &local_projects,
            &session.root,
            &session.path,
            session.snapshot.as_deref(),
        )
        .is_err()
        {
            controller.remove_reader(&label)?;
            if let Some(reader) = app.get_webview_window(&label) {
                let _ = reader.close();
            }
        } else if emit_reader_state_changed(&app, &label, &session).is_err() {
            controller.remove_reader(&label)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn close_project(
    app: tauri::AppHandle,
    local_projects: tauri::State<'_, LocalProjectStore>,
    ssh_sessions: tauri::State<'_, SshSessionManager>,
    window: WebviewWindow,
    controller: tauri::State<'_, DesktopController>,
    root: String,
) -> Result<(), String> {
    if !controller.has_workspace(window.label())? {
        return Err(format!(
            "Mindflow window '{}' cannot close project Readers",
            window.label()
        ));
    }
    let labels = controller.remove_readers_for(window.label(), &root)?;
    for label in labels {
        if let Some(reader) = app.get_webview_window(&label) {
            let _ = reader.close();
        }
    }
    match parse_access_root(&root)? {
        Some(access) => ssh_sessions.release_project(window.label(), &access)?,
        None => local_projects.release_region(window.label(), Path::new(&root))?,
    }
    Ok(())
}

#[tauri::command]
fn update_window_session(
    window: WebviewWindow,
    controller: tauri::State<'_, DesktopController>,
    paths: Vec<String>,
    active_project: Option<String>,
) -> Result<(), String> {
    let trace_active = active_project
        .as_deref()
        .unwrap_or("none")
        .replace('\n', "\\n");
    let trace_paths = paths
        .iter()
        .map(|path| path.replace('\n', "\\n"))
        .collect::<Vec<_>>()
        .join(",");
    controller.update_relaunch_paths(window.label(), paths)?;
    let title = active_project
        .filter(|project| !project.trim().is_empty())
        .map(|project| format!("{project} — Mindflow"))
        .unwrap_or_else(|| "Mindflow".to_owned());
    window
        .set_title(&title)
        .map_err(|error| format!("cannot update Mindflow window title: {error}"))?;
    record_test_message(&format!(
        "ui\t{}\tactive={trace_active};paths={trace_paths}",
        window.label()
    ));
    Ok(())
}

#[tauri::command]
async fn version_info(
    window: WebviewWindow,
    app: tauri::AppHandle,
    ssh_sessions: tauri::State<'_, SshSessionManager>,
    root: Option<String>,
) -> Result<versions::DesktopVersionInfo, String> {
    let local_core = mindflow::version::runtime_version();
    let variant = versions::app_variant(&app.config().identifier);
    let (project_core, project) = match root.as_deref() {
        Some(root) => match parse_access_root(root) {
            Ok(Some(access)) => ssh_sessions.versions(window.label(), &access)
                .map(|(core, project)| (Some(core), project))
                .unwrap_or_default(),
            Ok(None) => {
                let root = PathBuf::from(root);
                let project = tauri::async_runtime::spawn_blocking(move || {
                    Project::load(root).ok()
                        .map(|project| mindflow::version::ProjectVersion::from_project(&project))
                        .unwrap_or_default()
                }).await.map_err(|error| error.to_string())?;
                (Some(local_core.clone()), project)
            }
            Err(_) => (None, Default::default()),
        },
        None => (None, Default::default()),
    };
    let digest = local_core.source_digest.clone();
    let local_update = tauri::async_runtime::spawn_blocking(move || {
        versions::local_update(digest.as_deref(), variant)
    }).await.map_err(|error| error.to_string())?;
    Ok(versions::DesktopVersionInfo {
        app: versions::AppVersion { release: env!("CARGO_PKG_VERSION").into(), variant },
        local_core,
        project_core,
        project,
        local_update,
    })
}

#[tauri::command]
fn refresh_project(
    window: WebviewWindow,
    build_state: tauri::State<'_, AppBuildState>,
    ssh_sessions: tauri::State<'_, SshSessionManager>,
    local_projects: tauri::State<'_, LocalProjectStore>,
    root: String,
    activate_synchronized_build: bool,
) -> Result<RefreshProjectResponse, String> {
    let current_digest = current_source_digest();
    if synchronized_build_activation_required(
        activate_synchronized_build,
        build_state.source_digest.as_deref(),
        current_digest.as_deref(),
    ) {
        return Ok(RefreshProjectResponse::Relaunch);
    }

    reconstruct_project_path(
        window.label(),
        root,
        &ssh_sessions,
        &local_projects,
        activate_synchronized_build,
    )
}

fn reconstruct_project_path(
    owner: &str,
    root: String,
    ssh_sessions: &SshSessionManager,
    local_projects: &LocalProjectStore,
    connect_if_missing: bool,
) -> Result<RefreshProjectResponse, String> {
    let response = match parse_access_root(&root)? {
        Some(access) => ssh_sessions.refresh_project(owner, &access, connect_if_missing)?,
        None => open_starting_paths_retained(
            owner,
            vec![StartingPath::Explicit(PathBuf::from(&root))],
            local_projects,
            true,
        )
        .into_iter()
        .next()
        .ok_or_else(|| format!("cannot reconstruct project path '{root}'"))?,
    };

    match response {
        OpenRegionResponse::Region { region } => Ok(RefreshProjectResponse::Region { region }),
        OpenRegionResponse::Folder { root, project } => {
            Ok(RefreshProjectResponse::Folder { root, project })
        }
        OpenRegionResponse::Error { message, .. } => Err(message),
    }
}

#[tauri::command]
fn relaunch_regions(
    app: tauri::AppHandle,
    window: WebviewWindow,
    controller: tauri::State<'_, DesktopController>,
    paths: Vec<String>,
) -> Result<(), String> {
    let reconstruction = controller.relaunch_plan(window.label(), paths)?;
    let reconstruction = encode_restore_plan(&reconstruction)?;

    let executable = synchronized_app_executable_path().ok_or_else(|| {
        format!(
            "completed local toolchain synchronization record does not select a safe application executable: {}",
            synchronization_record_path().display()
        )
    })?;
    if !executable.is_file() {
        return Err(format!(
            "synchronized Mindflow application is missing: {}",
            executable.display()
        ));
    }

    Command::new(&executable)
        .env_remove("MINDFLOW_ROOT")
        .arg(RELAUNCH_AFTER_PID_ARGUMENT)
        .arg(std::process::id().to_string())
        .arg(RESTORE_WINDOWS_ARGUMENT)
        .arg(reconstruction)
        .spawn()
        .map_err(|error| format!("cannot relaunch synchronized Mindflow application: {error}"))?;

    for window in app.webview_windows().values() {
        let _ = window.hide();
    }
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn choose_region(
    window: WebviewWindow,
    local_projects: tauri::State<'_, LocalProjectStore>,
) -> Result<Option<OpenRegionResponse>, String> {
    let Some(root) = rfd::FileDialog::new()
        .set_title("Open Mindflow Region")
        .pick_folder()
    else {
        return Ok(None);
    };
    Ok(
        open_starting_paths_retained(window.label(), vec![StartingPath::Explicit(root)], &local_projects, false)
            .into_iter()
            .next(),
    )
}

#[tauri::command]
fn initialize_region(
    window: WebviewWindow,
    local_projects: tauri::State<'_, LocalProjectStore>,
    root: String,
) -> Result<RegionResponse, String> {
    if parse_access_root(&root)?.is_some() {
        return Err(
            "Remote region initialization is not supported by the SSH bridge".to_owned(),
        );
    }
    let root = canonical_desktop_folder(root)?;
    local_projects.load_region_with(window.label(), &root, || {
        Project::initialize(root.clone()).map_err(|error| format!("{error:#}"))
    })
}

#[tauri::command]
async fn timeline_history(
    app: tauri::AppHandle,
    webview: WebviewWindow,
    root: String,
    snapshot: String,
) -> Result<human::TimelineHistoryResponse, String> {
    let owner = webview.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        match parse_access_root(&root)? {
            Some(access) => app.state::<SshSessionManager>().timeline_history(&owner, &access, &snapshot),
            None => {
                let store = app.state::<LocalProjectStore>();
                let root = store.canonical_root(&root)?;
                let project = store.retained_project(&owner, &root, &snapshot)?;
                human::timeline_history(&project)
            }
        }
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn documentation_qc(
    webview: WebviewWindow,
    app: tauri::AppHandle,
    root: String,
    snapshot: String,
    window: mindflow::documentation_qc::QcWindow,
) -> Result<mindflow::documentation_qc::DocumentationQc, String> {
    let owner = webview.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        match parse_access_root(&root)? {
            Some(access) => app.state::<SshSessionManager>().documentation_qc(&owner, &access, &snapshot, window),
            None => {
                let store = app.state::<LocalProjectStore>();
                let root = store.canonical_root(&root)?;
                let project = store.retained_project(&owner, &root, &snapshot)?;
                mindflow::documentation_qc::observe_window(&project, window).map_err(|error| format!("{error:#}"))
            }
        }
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn documentation_qc_history(
    webview: WebviewWindow,
    app: tauri::AppHandle,
    root: String,
    snapshot: String,
    offset: usize,
) -> Result<mindflow::documentation_qc::DocumentationQcHistory, String> {
    let owner = webview.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        match parse_access_root(&root)? {
            Some(access) => app.state::<SshSessionManager>().documentation_qc_history(&owner, &access, &snapshot, offset),
            None => {
                let store = app.state::<LocalProjectStore>();
                let root = store.canonical_root(&root)?;
                let project = store.retained_project(&owner, &root, &snapshot)?;
                mindflow::documentation_qc::history_choices(&project, offset).map_err(|error| format!("{error:#}"))
            }
        }
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
fn list_project_directory(
    window: WebviewWindow,
    ssh_sessions: tauri::State<'_, SshSessionManager>,
    root: String,
    path: String,
) -> Result<ProjectDirectoryResponse, String> {
    match parse_access_root(&root)? {
        Some(access) => ssh_sessions.list_directory(window.label(), &access, &path),
        None => {
            let root = canonical_desktop_folder(root)?;
            project_directory_for(&root, &path)
        }
    }
}

#[tauri::command]
fn read_document(
    window: WebviewWindow,
    ssh_sessions: tauri::State<'_, SshSessionManager>,
    root: String,
    path: String,
) -> Result<DocumentResponse, String> {
    match parse_access_root(&root)? {
        Some(access) => Ok(ssh_sessions
            .reader_snapshot_current(window.label(), &access, &path)?
            .document),
        None => human::read_managed_document(root, &path),
    }
}

fn wait_for_relaunch_parent(arguments: Vec<OsString>) -> Vec<OsString> {
    if arguments
        .first()
        .is_none_or(|argument| argument != RELAUNCH_AFTER_PID_ARGUMENT)
    {
        return arguments;
    }
    let Some(parent_pid) = arguments.get(1).and_then(|pid| pid.to_str()) else {
        return arguments;
    };

    for _ in 0..200 {
        let parent_is_running = Command::new("/bin/kill")
            .args(["-0", parent_pid])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success());
        if !parent_is_running {
            break;
        }
        thread::sleep(Duration::from_millis(25));
    }

    arguments.into_iter().skip(2).collect()
}

fn forwarded_arguments(arguments: Vec<String>, cwd: String) -> Vec<String> {
    let forwarded = arguments.into_iter().skip(1).collect::<Vec<_>>();
    if forwarded.is_empty() {
        vec![CALLER_CWD_ARGUMENT.to_owned(), cwd]
    } else {
        forwarded
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let startup_arguments = wait_for_relaunch_parent(env::args_os().skip(1).collect());
    let startup = parse_process_startup(startup_arguments)
        .unwrap_or_else(|error| panic!("invalid Mindflow desktop startup request: {error}"));
    let (initial_batch, additional_windows) = match startup {
        ProcessStartup::Ordinary(launch) => (OpenBatch::Startup(launch.arguments), Vec::new()),
        ProcessStartup::Restore(mut windows) => {
            let first = windows.remove(0);
            (
                OpenBatch::Requested(first.paths.into_iter().map(OsString::from).collect()),
                windows,
            )
        }
    };
    let mut context = tauri::generate_context!();
    let isolated_identifier = isolated_test_identifier(
        &context.config().identifier,
        env::var_os(ISOLATED_TEST_INSTANCE_ENV).as_deref(),
    )
    .unwrap_or_else(|error| panic!("invalid isolated test instance: {error}"));
    if let Some(identifier) = isolated_identifier {
        context.config_mut().identifier = identifier;
    }
    let (launch_sender, launch_receiver) = mpsc::channel();
    let app = tauri::Builder::default()
        .manage(DesktopController::with_main(initial_batch))
        .manage(SshSessionManager::default())
        .manage(LocalProjectStore::default())
        .plugin(tauri_plugin_single_instance::init(
            move |_app, arguments, cwd| {
                let arguments = forwarded_arguments(arguments, cwd);
                record_test_open_request(&arguments);
                let _ = launch_sender.send(arguments);
            },
        ))
        .manage(AppBuildState {
            source_digest: mindflow::version::runtime_version().source_digest,
        })
        .setup(move |app| {
            for window in &additional_windows {
                create_workspace_window(
                    app.handle(),
                    OpenBatch::Requested(
                        window.paths.iter().cloned().map(OsString::from).collect(),
                    ),
                )
                .map_err(std::io::Error::other)?;
            }

            let app_handle = app.handle().clone();
            thread::Builder::new()
                .name("mindflow-window-router".to_owned())
                .spawn(move || {
                    for arguments in launch_receiver {
                        if let Err(error) = route_forwarded_launch(&app_handle, arguments) {
                            record_test_message(&format!("route-error\t{error}"));
                        }
                    }
                })
                .map_err(std::io::Error::other)?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::Focused(true) => {
                let _ = window
                    .app_handle()
                    .state::<DesktopController>()
                    .note_focused(window.label());
            }
            tauri::WindowEvent::Destroyed => {
                let app = window.app_handle();
                let controller = app.state::<DesktopController>();
                let _ = app.state::<LocalProjectStore>().release_workspace(window.label());
                let _ = app.state::<SshSessionManager>().release_workspace(window.label());
                let removed_reader = controller.reader_session(window.label()).ok().flatten();
                let dependent_readers =
                    controller.remove_window(window.label()).unwrap_or_default();
                if let Some(reader) = removed_reader {
                    if let Some(owner) = app.get_webview_window(&reader.owner_window) {
                        let _ = owner.emit(
                            READER_INSPECTION_EVENT,
                            ReaderInspectionEvent {
                                root: reader.root,
                                target: None,
                            },
                        );
                    }
                }
                for reader_label in dependent_readers {
                    if let Some(reader) = app.get_webview_window(&reader_label) {
                        let _ = reader.close();
                    }
                }
                record_test_message(&format!("window\tdestroyed\t{}", window.label()));
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            startup_regions,
            open_regions,
            open_ssh_region,
            list_ssh_destinations,
            browse_ssh_directory,
            close_ssh_picker,
            take_pending_open_regions,
            create_project_window,
            present_reader_window,
            reader_window_snapshot,
            reader_image_data_url,
            inspect_reader_target,
            update_reader_window_scale,
            reconcile_reader_windows,
            close_project,
            update_window_session,
            version_info,
            refresh_project,
            relaunch_regions,
            choose_region,
            initialize_region,
            list_project_directory,
            timeline_history,
            documentation_qc,
            documentation_qc_history,
            read_document
        ])
        .build(context)
        .expect("failed to build Mindflow desktop application");

    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } = event
        {
            if let Some(window) = app.webview_windows().values().next() {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            } else {
                let _ = create_workspace_window(app, OpenBatch::Requested(Vec::new()));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_region(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = env::temp_dir().join(format!(
            "mindflow-desktop-{name}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir(&root).unwrap();
        let status = Command::new("git")
            .args(["init", "--quiet"])
            .current_dir(&root)
            .status()
            .unwrap();
        assert!(status.success());
        root
    }

    fn fixture_git(root: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(root)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }

    fn commit_fixture(root: &Path, message: &str) -> String {
        fixture_git(root, &["add", "."]);
        fixture_git(
            root,
            &[
                "-c",
                "user.name=Mindflow Desktop Tests",
                "-c",
                "user.email=mindflow-desktop@example.invalid",
                "commit",
                "--quiet",
                "-m",
                message,
            ],
        );
        fixture_git(root, &["rev-parse", "HEAD"])
    }

    fn anchor_fixture_manifest(anchor: Option<&str>) -> String {
        let anchors = anchor.map_or_else(
            || "anchors: {}\n".to_owned(),
            |commit| {
                format!(
                    concat!(
                        "anchors:\n",
                        "  review-point:\n",
                        "    component: anchor_note\n",
                        "    commit: {commit}\n",
                        "    connections: []\n",
                    ),
                    commit = commit,
                )
            },
        );
        format!(
            concat!(
                "format: \"2026-10-20\"\n",
                "components:\n",
                "  project: {{path: .}}\n",
                "  notes: {{path: notes}}\n",
                "  current_note: {{path: notes/current.md}}\n",
                "  anchor_note: {{path: notes/anchor.md}}\n",
                "relationship-types: {{}}\n",
                "anchor-connection-types: {{}}\n",
                "opening:\n",
                "  files:\n",
                "    - current_note\n",
                "evolve:\n",
                "  events:\n",
                "    - name: establish-current\n",
                "      description: Establish the representative current intent.\n",
                "      predecessors: []\n",
                "      successors:\n",
                "        - current_note\n",
                "historical-components: {{}}\n",
                "{anchors}",
            ),
            anchors = anchors,
        )
    }

    fn representative_region(name: &str) -> PathBuf {
        let root = temporary_region(name);
        fs::create_dir(root.join("notes")).unwrap();
        fs::write(
            root.join("notes/current.md"),
            "# Current\n\nRepresentative prose.\n",
        )
        .unwrap();
        fs::write(
            root.join("notes/anchor.md"),
            "# Anchor\n\nHistorical context.\n",
        )
        .unwrap();
        fs::write(
            root.join("project-notes.md"),
            "# Project notes\n\nOrdinary project evidence.\n",
        )
        .unwrap();
        fs::write(root.join("example.rs"), "fn main() {}\n").unwrap();
        fs::write(root.join("MINDFLOW.yaml"), anchor_fixture_manifest(None)).unwrap();
        let anchor_commit = commit_fixture(&root, "representative baseline");
        fs::write(
            root.join("MINDFLOW.yaml"),
            anchor_fixture_manifest(Some(&anchor_commit)),
        )
        .unwrap();
        fs::create_dir_all(root.join("nested/inside")).unwrap();
        root
    }

    #[test]
    fn representative_region_opens_through_the_desktop_boundary() {
        let root = representative_region("open-boundary");
        let response = open_region(&root).unwrap_or_else(|error| panic!("{error}"));

        assert_eq!(
            response.project,
            root.file_name().unwrap().to_string_lossy().as_ref()
        );
        assert_eq!(response.slice, "working-tree");
        assert!(!response.graph.documents.is_empty());
        assert_eq!(
            response.status.relationships,
            response.graph.structure.relationships.len()
        );
        assert_eq!(response.status.opening_files, response.opening.files.len());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn desktop_files_lists_project_children_lazily_without_git_or_symlinks() {
        let fixture = representative_region("project-files");
        let root = fixture.canonicalize().unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("project-notes.md"), root.join("notes-link.md"))
            .unwrap();

        let listing = project_directory_for(&root, "").unwrap_or_else(|error| panic!("{error}"));
        let paths = listing
            .entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>();
        assert!(paths.contains(&"nested"));
        assert!(paths.contains(&"MINDFLOW.yaml"));
        assert!(paths.contains(&"project-notes.md"));
        assert!(!paths.contains(&".git"));
        assert!(!paths.contains(&"notes-link.md"));
        assert_eq!(listing.entries[0].kind, ProjectEntryKind::Directory);

        let nested =
            project_directory_for(&root, "nested").unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(nested.entries[0].path, "nested/inside");
        assert!(project_directory_for(&root, "../").is_err());
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn desktop_region_carries_registered_events_with_the_graph() {
        let root = representative_region("events");
        let response = open_region(&root).unwrap_or_else(|error| panic!("{error}"));

        assert_eq!(response.graph.events.len(), 1);
        assert_eq!(response.status.evolve_events, response.graph.events.len());
        assert_eq!(response.anchor_timeline.len(), response.graph.anchors.len());
        assert!(response.timeline_commits.is_empty());
        assert!(!response.timeline_history_loaded);
        let timeline = human::timeline_history(&Project::load(root.clone()).unwrap()).unwrap();
        assert_eq!(timeline.commits.len(), 1);
        assert_eq!(
            timeline.commits[0].commit,
            fixture_git(&root, &["rev-parse", "HEAD"])
        );
        assert_eq!(timeline.commits[0].event_boundary, Some(1));
        assert!(response
            .anchor_timeline
            .iter()
            .any(|anchor| { anchor.name == "review-point" && anchor.event_boundary == Some(1) }));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn desktop_reconstructs_anchor_removal_and_git_rewind() {
        let root = temporary_region("anchor-rewind");
        fs::create_dir(root.join("notes")).unwrap();
        fs::write(root.join("notes/current.md"), "# Current\n").unwrap();
        fs::write(root.join("notes/anchor.md"), "# Anchor\n").unwrap();
        fs::write(root.join("MINDFLOW.yaml"), anchor_fixture_manifest(None)).unwrap();
        let anchor_commit = commit_fixture(&root, "base");

        fs::write(
            root.join("MINDFLOW.yaml"),
            anchor_fixture_manifest(Some(&anchor_commit)),
        )
        .unwrap();
        let anchored_slice = commit_fixture(&root, "add anchor");

        let anchored = open_region(&root).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(
            anchored.graph.anchors.keys().cloned().collect::<Vec<_>>(),
            ["review-point"]
        );
        assert_eq!(anchored.anchor_timeline.len(), 1);
        let history = human::timeline_history(&Project::load(root.clone()).unwrap()).unwrap();
        assert_eq!(
            history
                .commits
                .iter()
                .map(|entry| entry.commit.as_str())
                .collect::<Vec<_>>(),
            vec![anchor_commit.as_str(), anchored_slice.as_str()]
        );
        assert_eq!(
            history
                .commits
                .iter()
                .map(|entry| entry.event_boundary)
                .collect::<Vec<_>>(),
            vec![Some(1), Some(1)]
        );

        fs::write(root.join("MINDFLOW.yaml"), anchor_fixture_manifest(None)).unwrap();
        let removed = open_region(&root).unwrap_or_else(|error| panic!("{error}"));
        assert!(removed.graph.anchors.is_empty());
        assert!(removed.anchor_timeline.is_empty());

        fixture_git(&root, &["reset", "--hard", &anchored_slice]);
        let rewound = open_region(&root).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(
            rewound.graph.anchors.keys().cloned().collect::<Vec<_>>(),
            ["review-point"]
        );
        assert_eq!(rewound.anchor_timeline[0].name, "review-point");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn native_reader_snapshot_uses_the_same_validated_region_and_exact_prose() {
        let fixture = representative_region("managed-reader");
        let root = fixture.canonicalize().unwrap();
        let region = open_region(&root).unwrap_or_else(|error| panic!("{error}"));
        let path = "notes/current.md".to_owned();
        let snapshot = reader_window_snapshot_for(ReaderWindowSession {
            owner_window: "main".to_owned(),
            root: root.display().to_string(),
            snapshot: None,
            path: path.clone(),
            fragment: Some("reader-section".to_owned()),
            interface_scale: 1.2,
        })
        .unwrap_or_else(|error| panic!("{error}"));

        assert_eq!(snapshot.root, root.display().to_string());
        assert_eq!(snapshot.path, path);
        assert_eq!(snapshot.fragment.as_deref(), Some("reader-section"));
        assert_eq!(snapshot.document.path, snapshot.path);
        assert!(!snapshot.document.content.is_empty());
        assert_eq!(snapshot.graph.documents.len(), region.graph.documents.len());
        assert_eq!(snapshot.kind, ReaderDocumentKind::Managed);
        assert_eq!(snapshot.interface_scale, 1.2);
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn local_reader_uses_the_retained_workspace_snapshot_until_refresh() {
        let fixture = representative_region("retained-reader");
        let root = fixture.canonicalize().unwrap();
        let local_projects = LocalProjectStore::default();
        let region = local_projects
            .load_region("main", &root)
            .unwrap_or_else(|error| panic!("{error}"));
        let retained_id = region.status.snapshot.id.clone();
        let original = fs::read_to_string(root.join("notes/current.md")).unwrap();

        fs::write(
            root.join("notes/current.md"),
            "# Changed after workspace load\n",
        )
        .unwrap();
        let retained = local_projects
            .reader_snapshot("main", &region.root, "notes/current.md", Some(retained_id.as_str()))
            .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(retained.document.content, original);
        assert_eq!(
            retained
                .snapshot
                .as_ref()
                .map(|snapshot| snapshot.id.as_str()),
            Some(retained_id.as_str())
        );
        assert!(retained.graph.is_some());
        assert!(local_projects
            .reader_snapshot("main", &region.root, "notes/current.md", Some("sha256:stale"))
            .unwrap_err()
            .contains("retained project snapshot"));
        assert!(local_projects
            .reader_snapshot("main", &region.root, "notes/current.md", None)
            .unwrap_err()
            .contains("must name its retained snapshot"));

        let refreshed = local_projects
            .load_region("main", &root)
            .unwrap_or_else(|error| panic!("{error}"));
        assert_ne!(refreshed.status.snapshot.id, retained_id);
        let current = local_projects
            .reader_snapshot(
                "main",
                &refreshed.root,
                "notes/current.md",
                Some(refreshed.status.snapshot.id.as_str()),
            )
            .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(current.document.content, "# Changed after workspace load\n");

        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn peer_workspace_refresh_preserves_reader_qc_and_history_snapshots() {
        let fixture = representative_region("peer-window-snapshots");
        let root = fixture.canonicalize().unwrap();
        let local_projects = LocalProjectStore::default();
        let ssh_sessions = SshSessionManager::default();
        let first = local_projects.load_region("main", &root).unwrap();
        let first_id = first.status.snapshot.id.clone();
        let original = fs::read_to_string(root.join("notes/current.md")).unwrap();
        let first_lease = Arc::downgrade(
            &local_projects
                .retained_project("main", &first.root, &first_id)
                .unwrap(),
        );
        let reader = ReaderWindowSession {
            owner_window: "main".to_owned(),
            root: first.root.clone(),
            snapshot: Some(first_id.clone()),
            path: "notes/current.md".to_owned(),
            fragment: None,
            interface_scale: 1.0,
        };
        fs::write(
            root.join("notes/current.md"),
            "# A newer window observation\n",
        )
        .unwrap();
        let second = local_projects.load_region("workspace-2", &root).unwrap();
        assert_ne!(first_id, second.status.snapshot.id);
        assert_eq!(local_projects.projects().unwrap().len(), 2);
        let first_reader =
            reader_window_snapshot_for_access(&ssh_sessions, &local_projects, reader.clone()).unwrap();
        assert_eq!(first_reader.document.content, original);
        assert_eq!(first_reader.snapshot.unwrap().id, first_id);
        let second_reader = reader_window_snapshot_for_access(
            &ssh_sessions,
            &local_projects,
            ReaderWindowSession {
                owner_window: "workspace-2".to_owned(),
                snapshot: Some(second.status.snapshot.id.clone()),
                ..reader.clone()
            },
        )
        .unwrap();
        assert_eq!(
            second_reader.document.content,
            "# A newer window observation\n"
        );
        // Both measurement surfaces pin the same workspace lookup as Reader.
        for (owner, region) in [("main", &first), ("workspace-2", &second)] {
            let project = local_projects
                .retained_project(owner, &region.root, &region.status.snapshot.id)
                .unwrap();
            let qc = mindflow::documentation_qc::observe_window(
                &project,
                mindflow::documentation_qc::QcWindow::Recent { commits: 5 },
            )
            .unwrap();
            assert_eq!(qc.snapshot.id, region.status.snapshot.id);
            assert_eq!(
                human::timeline_history(&project).unwrap().snapshot.id,
                region.status.snapshot.id
            );
        }
        assert!(local_projects
            .retained_project("main", &first.root, &second.status.snapshot.id)
            .is_err());
        assert!(local_projects
            .retained_project("workspace-3", &first.root, &first_id)
            .is_err());

        let controller = DesktopController::with_main(OpenBatch::Requested(Vec::new()));
        controller
            .register_reader("reader-1".to_owned(), reader)
            .unwrap();
        controller.remove_window("reader-1").unwrap();
        assert!(
            first_lease.upgrade().is_some(),
            "Reader close must preserve its workspace observation"
        );
        local_projects.release_region("workspace-2", &root).unwrap();
        assert!(
            first_lease.upgrade().is_some(),
            "peer tab close must preserve this observation"
        );
        local_projects.release_workspace("main").unwrap();
        assert!(
            first_lease.upgrade().is_none(),
            "workspace close releases its final snapshot owner"
        );
        assert!(local_projects.projects().unwrap().is_empty());
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn same_workspace_refresh_and_folder_transition_release_only_its_previous_snapshot() {
        let fixture = representative_region("snapshot-lifetime");
        let root = fixture.canonicalize().unwrap();
        let local_projects = LocalProjectStore::default();
        let first = local_projects.load_region("main", &root).unwrap();
        let previous = Arc::downgrade(
            &local_projects
                .retained_project("main", &first.root, &first.status.snapshot.id)
                .unwrap(),
        );
        let peer = local_projects.load_region("workspace-2", &root).unwrap();
        fs::write(root.join("notes/current.md"), "# New slice\n").unwrap();
        let newer = local_projects.load_region("main", &root).unwrap();
        assert_ne!(first.status.snapshot.id, newer.status.snapshot.id);
        assert!(
            previous.upgrade().is_none(),
            "repeated refresh must not accumulate old slices"
        );
        assert_eq!(local_projects.projects().unwrap().len(), 2);
        fs::remove_file(root.join(mindflow::project::MANIFEST_FILENAME)).unwrap();
        assert!(matches!(
            reconstruct_project_path(
                "main",
                first.root.clone(),
                &SshSessionManager::default(),
                &local_projects,
                false
            )
            .unwrap(),
            RefreshProjectResponse::Folder { .. }
        ));
        assert!(local_projects
            .retained_project("main", &first.root, &newer.status.snapshot.id)
            .is_err());
        let reader = local_projects
            .reader_snapshot(
                "workspace-2",
                &peer.root,
                "notes/current.md",
                Some(&peer.status.snapshot.id),
            )
            .unwrap();
        assert_eq!(reader.snapshot.unwrap().id, peer.status.snapshot.id);
        assert_eq!(local_projects.projects().unwrap().len(), 1);
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn closing_a_project_or_workspace_during_load_does_not_restore_its_snapshot() {
        let fixture = representative_region("closed-during-load");
        let root = fixture.canonicalize().unwrap();
        let store = LocalProjectStore::default();
        let peer = store.load_region("workspace-2", &root).unwrap();
        for close_workspace in [false, true] {
            let result = store.load_region_with("main", &root, || {
                if close_workspace {
                    store.release_workspace("main").unwrap();
                } else {
                    store.release_region("main", &root).unwrap();
                }
                Project::load(root.clone()).map_err(|error| error.to_string())
            });
            assert!(result.unwrap_err().contains("closed or replaced"));
            assert!(store.pending.lock().unwrap().is_empty());
            assert_eq!(store.projects().unwrap().len(), 1);
            store
                .retained_project("workspace-2", &peer.root, &peer.status.snapshot.id)
                .unwrap();
        }
        store.load_region("main", &root).unwrap();
        assert_eq!(
            store.projects().unwrap().len(),
            2,
            "a later explicit open can load again"
        );
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn duplicate_open_preserves_the_existing_workspace_snapshot_until_refresh() {
        let fixture = representative_region("duplicate-window-open");
        let root = fixture.canonicalize().unwrap();
        let local_projects = LocalProjectStore::default();
        let first = local_projects.load_region("main", &root).unwrap();
        fs::write(root.join("notes/current.md"), "# Changed after open\n").unwrap();
        let responses = open_starting_paths_retained(
            "main",
            vec![StartingPath::Explicit(root.clone())],
            &local_projects,
            false,
        );
        assert!(
            matches!(&responses[0], OpenRegionResponse::Region { region } if region.status.snapshot.id == first.status.snapshot.id)
        );
        local_projects
            .retained_project("main", &first.root, &first.status.snapshot.id)
            .unwrap();
        let refreshed = reconstruct_project_path(
            "main",
            first.root,
            &SshSessionManager::default(),
            &local_projects,
            false,
        )
        .unwrap();
        assert!(
            matches!(refreshed, RefreshProjectResponse::Region { region } if region.status.snapshot.id != first.status.snapshot.id)
        );
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn region_refresh_after_manifest_removal_keeps_ordinary_files_readable() {
        let fixture = representative_region("region-to-folder-reader");
        let root = fixture.canonicalize().unwrap();
        let local_projects = LocalProjectStore::default();
        let region = local_projects.load_region("main", &root).unwrap();
        let original = fs::read_to_string(root.join("notes/current.md")).unwrap();
        fs::remove_file(root.join(mindflow::project::MANIFEST_FILENAME)).unwrap();

        let refreshed = reconstruct_project_path(
            "main",
            region.root.clone(),
            &SshSessionManager::default(),
            &local_projects,
            false,
        )
        .unwrap();
        assert!(matches!(
            refreshed,
            RefreshProjectResponse::Folder { root: folder_root, .. }
                if folder_root == region.root
        ));
        assert_eq!(
            local_projects
                .validate_reader_root("main", &region.root, None)
                .unwrap(),
            region.root
        );
        let reader = local_projects
            .reader_snapshot("main", &region.root, "notes/current.md", None)
            .unwrap();
        assert_eq!(reader.document.content, original);
        assert_eq!(reader.kind, ReaderDocumentKind::Project);
        assert!(reader.snapshot.is_none());
        assert!(reader.graph.unwrap().documents.is_empty());
        assert!(local_projects
            .reader_snapshot(
                "main",
                &region.root,
                "notes/current.md",
                Some(&region.status.snapshot.id),
            )
            .unwrap_err()
            .contains("not retained"));
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn native_reader_loads_local_gifs_without_exposing_paths_outside_the_region() {
        let fixture = representative_region("reader-image");
        let root = fixture.canonicalize().unwrap();
        let image_directory = root.join("assets");
        fs::create_dir_all(&image_directory).unwrap();
        fs::write(
            image_directory.join("preview.gif"),
            b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;",
        )
        .unwrap();

        let data_url = reader_image_data_url_for(&root, "assets/preview.gif")
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(data_url.starts_with("data:image/gif;base64,"));
        assert!(data_url.len() > "data:image/gif;base64,".len());

        let outside = root.parent().unwrap().join("outside-reader-image.gif");
        fs::write(&outside, b"GIF89a").unwrap();
        let error = reader_image_data_url_for(&root, "../outside-reader-image.gif")
            .expect_err("Reader images must remain inside the region");
        assert!(error.contains("parent components"));

        fs::remove_file(outside).unwrap();
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn native_reader_opens_supported_project_files_without_managing_them() {
        let fixture = representative_region("project-reader");
        let root = fixture.canonicalize().unwrap();
        let region = open_region(&root).unwrap_or_else(|error| panic!("{error}"));
        let path = "project-notes.md".to_owned();
        assert!(!region
            .graph
            .documents
            .iter()
            .any(|document| document.path == path));

        let snapshot = reader_window_snapshot_for(ReaderWindowSession {
            owner_window: "main".to_owned(),
            root: root.display().to_string(),
            snapshot: None,
            path: path.clone(),
            fragment: None,
            interface_scale: 1.0,
        })
        .unwrap_or_else(|error| panic!("{error}"));

        assert_eq!(snapshot.kind, ReaderDocumentKind::Project);
        assert_eq!(snapshot.path, path);
        assert_eq!(snapshot.document.content_kind, ReaderContentKind::Markdown);
        assert!(snapshot.document.content.contains("# Project notes"));

        let text =
            project_document_for(&validated_desktop_project(&root).unwrap(), "example.rs").unwrap();
        assert_eq!(text.content_kind, ReaderContentKind::Text);
        assert!(text.content.contains("fn main"));

        fs::write(root.join("unsupported.bin"), [0xff, 0xfe, 0xfd]).unwrap();
        assert!(project_document_for(
            &validated_desktop_project(&root).unwrap(),
            "unsupported.bin",
        )
        .is_err());
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn native_reader_opens_supported_files_before_region_initialization() {
        let fixture = temporary_region("unregistered-project-reader");
        let root = fixture.canonicalize().unwrap();
        fs::write(
            root.join("README.md"),
            "# Unregistered project\n\nExact project prose.\n",
        )
        .unwrap();

        let snapshot = reader_window_snapshot_for(ReaderWindowSession {
            owner_window: "main".to_owned(),
            root: root.display().to_string(),
            snapshot: None,
            path: "README.md".to_owned(),
            fragment: None,
            interface_scale: 1.1,
        })
        .unwrap_or_else(|error| panic!("{error}"));

        assert_eq!(snapshot.root, root.display().to_string());
        assert_eq!(snapshot.kind, ReaderDocumentKind::Project);
        assert_eq!(snapshot.document.content_kind, ReaderContentKind::Markdown);
        assert!(snapshot.document.content.contains("Exact project prose"));
        assert_eq!(snapshot.graph.format, CURRENT_FORMAT);
        assert!(snapshot.graph.relationship_types.is_empty());
        assert!(snapshot.graph.documents.is_empty());
        assert!(snapshot.graph.structure.relationships.is_empty());
        assert!(snapshot.graph.events.is_empty());
        assert!(snapshot.graph.anchors.is_empty());

        let error = project_file_document_for(&root, "../outside.md")
            .expect_err("folder Readers must remain inside the selected folder");
        assert!(error.contains("parent components"));
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn native_reader_scale_and_title_stay_bounded_and_descriptive() {
        assert_eq!(normalized_reader_scale(0.2), 0.8);
        assert_eq!(normalized_reader_scale(1.1), 1.1);
        assert_eq!(normalized_reader_scale(8.0), 1.4);
        assert_eq!(normalized_reader_scale(f64::NAN), 1.0);
        assert_eq!(
            reader_window_title("/projects/Flow-IR", "profiles/architecture.md"),
            "architecture.md — Flow-IR — Mindflow Reader"
        );
    }

    #[test]
    fn startup_path_uses_normal_project_discovery() {
        let fixture = representative_region("startup-discovery");
        let root = fixture.canonicalize().unwrap();
        let nested = fixture.join("nested/inside");
        let resolved = resolve_starting_paths(vec![StartingPath::Explicit(nested)]);

        assert!(matches!(
            resolved.as_slice(),
            [ResolvedStartingPath::Root { root: resolved_root, .. }]
                if resolved_root == &root
        ));
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn explicit_unregistered_folder_opens_for_files_and_initializes_in_place() {
        let fixture = temporary_region("folder-first-initialization");
        fs::write(fixture.join("notes.txt"), "ordinary project file\n").unwrap();
        let root = fixture.canonicalize().unwrap();
        let resolved = resolve_starting_paths(vec![StartingPath::Explicit(root.clone())]);

        assert!(matches!(
            resolved.as_slice(),
            [ResolvedStartingPath::Folder { root: resolved_root, .. }]
                if resolved_root == &root
        ));
        let listing = project_directory_for(&root, "").unwrap_or_else(|error| panic!("{error}"));
        assert!(listing
            .entries
            .iter()
            .any(|entry| entry.path == "notes.txt"));
        let ssh_sessions = SshSessionManager::default();
        let local_projects = LocalProjectStore::default();

        let refreshed = reconstruct_project_path(
            "main",
            root.display().to_string(),
            &ssh_sessions,
            &local_projects,
            false,
        )
        .unwrap_or_else(|error| panic!("{error}"));
        assert!(matches!(
            refreshed,
            RefreshProjectResponse::Folder {
                root: refreshed_root,
                ..
            } if refreshed_root == root.display().to_string()
        ));

        let project = Project::initialize(root.clone()).unwrap_or_else(|error| panic!("{error:#}"));
        let region = local_projects
            .retain("main", project)
            .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(region.root, root.display().to_string());
        assert!(region.status.valid);
        assert_eq!(region.status.documents, 0);
        assert!(region.graph.documents.is_empty());
        assert!(region.opening.files.is_empty());

        let refreshed = reconstruct_project_path(
            "main",
            root.display().to_string(),
            &ssh_sessions,
            &local_projects,
            false,
        )
        .unwrap_or_else(|error| panic!("{error}"));
        assert!(matches!(
            refreshed,
            RefreshProjectResponse::Region { region }
                if region.root == root.display().to_string()
        ));

        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn undiscoverable_implicit_caller_directory_falls_back_to_the_chooser() {
        let directory = env::temp_dir().join(format!(
            "mindflow-undiscoverable-startup-{}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();

        let starting_paths = parse_starting_paths(
            None,
            vec![
                OsString::from(CALLER_CWD_ARGUMENT),
                directory.clone().into_os_string(),
            ],
            None,
        )
        .unwrap_or_else(|error| panic!("{error}"));
        let resolved = resolve_starting_paths(starting_paths);

        fs::remove_dir(&directory).unwrap();
        assert!(resolved.is_empty());
    }

    #[test]
    fn several_starting_paths_preserve_order_and_deduplicate_roots() {
        let fixture = representative_region("deduplicate-starting-paths");
        let root = fixture.canonicalize().unwrap();
        let starting_paths = parse_starting_paths(
            None,
            vec![
                fixture.join("nested/inside").into_os_string(),
                fixture.clone().into_os_string(),
            ],
            None,
        )
        .unwrap_or_else(|error| panic!("{error}"));
        let resolved = resolve_starting_paths(starting_paths);

        assert_eq!(resolved.len(), 1);
        assert!(matches!(
            resolved.as_slice(),
            [ResolvedStartingPath::Root { root: resolved_root, .. }]
                if resolved_root == &root
        ));
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn explicit_discovery_failure_becomes_a_project_local_error() {
        let path = env::temp_dir().join(format!(
            "mindflow-missing-explicit-startup-{}",
            std::process::id()
        ));
        let resolved = resolve_starting_paths(vec![StartingPath::Explicit(path.clone())]);

        assert!(matches!(
            resolved.as_slice(),
            [ResolvedStartingPath::Error { requested_path, .. }] if requested_path == &path
        ));
    }

    #[test]
    fn forwarded_launches_keep_all_explicit_paths_and_supply_an_implicit_cwd() {
        assert_eq!(
            forwarded_arguments(
                vec![
                    "mindflow-desktop".to_owned(),
                    "/first".to_owned(),
                    "/second".to_owned(),
                ],
                "/caller".to_owned(),
            ),
            vec!["/first".to_owned(), "/second".to_owned()]
        );
        assert_eq!(
            forwarded_arguments(vec!["mindflow-desktop".to_owned()], "/caller".to_owned()),
            vec![CALLER_CWD_ARGUMENT.to_owned(), "/caller".to_owned()]
        );
    }

    #[test]
    fn relaunch_wait_arguments_are_private_and_not_opened_as_projects() {
        let arguments = vec![
            OsString::from(RELAUNCH_AFTER_PID_ARGUMENT),
            OsString::from("99999999"),
            OsString::from("/first"),
            OsString::from("/second"),
        ];

        assert_eq!(
            wait_for_relaunch_parent(arguments),
            vec![OsString::from("/first"), OsString::from("/second")]
        );
    }

    #[test]
    fn synchronization_record_parses_exact_activation_fields() {
        assert_eq!(
            parse_source_digest("source-digest abc123\ncli-digest def456\napp-digest ghi789\n"),
            Some("abc123".to_owned())
        );
        assert_eq!(parse_source_digest("source-digest\n"), None);
        assert_eq!(parse_source_digest("source-digest one extra\n"), None);

        assert_eq!(
            parse_synchronized_app_executable(
                "source-digest abc123\napp-executable target/release/bundle/macos/Mind Dev.app/Contents/MacOS/mindflow-desktop\n"
            ),
            Some(PathBuf::from(
                "target/release/bundle/macos/Mind Dev.app/Contents/MacOS/mindflow-desktop"
            ))
        );
        assert_eq!(
            parse_synchronized_app_executable(
                "app-executable target/release/bundle/macos/Mindflow.app/Contents/MacOS/mindflow-desktop\n"
            ),
            Some(PathBuf::from(
                "target/release/bundle/macos/Mindflow.app/Contents/MacOS/mindflow-desktop"
            ))
        );
        for invalid in [
            "app-executable\n",
            "app-executable /tmp/Mindflow.app/Contents/MacOS/mindflow-desktop\n",
            "app-executable target/release/bundle/macos/../Mindflow.app/Contents/MacOS/mindflow-desktop\n",
            "app-executable target/release/Mindflow.app/Contents/MacOS/mindflow-desktop\n",
            "app-executable target/release/bundle/macos/Mindflow.app/Contents/MacOS/other\n",
            "app-executable target/release/bundle/macos/Mindflow.app/Contents/MacOS/mindflow-desktop \n",
            "app-executable target/release/bundle/macos/Mindflow.app/Contents/MacOS/mindflow-desktop\napp-executable target/release/bundle/macos/Mind Dev.app/Contents/MacOS/mindflow-desktop\n",
        ] {
            assert_eq!(parse_synchronized_app_executable(invalid), None);
        }
    }

    #[test]
    fn only_a_completed_different_synchronization_requests_relaunch() {
        assert!(!synchronized_build_changed(Some("same"), Some("same")));
        assert!(!synchronized_build_changed(Some("started"), None));
        assert!(!synchronized_build_changed(None, None));
        assert!(synchronized_build_changed(Some("started"), Some("new")));
        assert!(synchronized_build_changed(None, Some("new")));
        assert!(synchronized_build_activation_required(
            true,
            Some("started"),
            Some("new")
        ));
        assert!(!synchronized_build_activation_required(
            false,
            Some("started"),
            Some("new")
        ));
    }

    #[test]
    fn isolated_test_instances_receive_a_private_singleton_identifier() {
        assert_eq!(
            isolated_test_identifier("dev.mindflow.desktop", Some(OsStr::new("window-42")))
                .unwrap(),
            Some("dev.mindflow.desktop.isolated-test.window-42".to_owned())
        );
        assert_eq!(
            isolated_test_identifier("dev.mindflow.desktop", None).unwrap(),
            None
        );
        assert!(isolated_test_identifier("dev.mindflow.desktop", Some(OsStr::new(""))).is_err());
        assert!(
            isolated_test_identifier("dev.mindflow.desktop", Some(OsStr::new("window/42")))
                .is_err()
        );
    }
}
