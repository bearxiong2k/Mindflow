use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use mindflow::bridge::{
    self, BridgeCall, BridgeOutcome, BridgeRequest, BridgeResponse, BridgeResult, HandshakeParams,
    OpenProjectParams, ProjectPathParams, ReaderSnapshotParams, RootParams, PROTOCOL_VERSION,
    REQUIRED_CAPABILITIES, STDERR_LIMIT_BYTES,
};
use mindflow::human::{
    FolderPickerResponse, OpenProjectResponse, ProjectDirectoryResponse, ReaderProjectSnapshot,
};
use mindflow::version::{ProjectVersion, RuntimeVersion};

const SSH_PREFIX: &str = "ssh://";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SshProjectAccess {
    pub destination: String,
    pub root: String,
}

pub struct SshSessionManager {
    sessions: Mutex<BTreeMap<String, Arc<Mutex<SshSession>>>>,
}

impl Default for SshSessionManager {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(BTreeMap::new()),
        }
    }
}

impl SshSessionManager {
    pub fn versions(&self, access: &SshProjectAccess) -> Option<(RuntimeVersion, ProjectVersion)> {
        // Reading version details never opens or reconnects a remote session.
        self.with_session(&access.destination, false, |session| {
            let runtime = session.runtime.clone().ok_or("Unknown core version")?;
            let project = session.regions.get(&access.root)
                .map(|region| region.version.clone()).unwrap_or_default();
            Ok((runtime, project))
        }).ok()
    }

    pub fn browse_directory(
        &self,
        destination: &str,
        path: &str,
        connect_if_missing: bool,
    ) -> Result<FolderPickerResponse, String> {
        validate_destination(destination)?;
        self.with_session(destination, connect_if_missing, |session| {
            let result = session.request(BridgeCall::BrowseDirectory(OpenProjectParams {
                path: path.to_owned(),
            }))?;
            match result {
                BridgeResult::FolderDirectory(directory) => {
                    session.accept_protocol_result(validate_folder_directory(directory))
                }
                other => Err(unexpected_result(session, "browse-directory", &other)),
            }
        })
    }

    pub fn open_project(
        &self,
        destination: &str,
        path: &str,
    ) -> Result<OpenProjectResponse, String> {
        validate_destination(destination)?;
        self.with_session(destination, true, |session| {
            let result = session.request(BridgeCall::OpenProject(OpenProjectParams {
                path: path.to_owned(),
            }))?;
            match result {
                BridgeResult::OpenProject(response) => {
                    session.cache_open_response(&response);
                    session.accept_protocol_result(qualify_open_response(destination, response))
                }
                other => Err(unexpected_result(session, "open-project", &other)),
            }
        })
    }

    pub fn refresh_project(
        &self,
        access: &SshProjectAccess,
        connect_if_missing: bool,
    ) -> Result<OpenProjectResponse, String> {
        self.with_session(&access.destination, connect_if_missing, |session| {
            let result = session.request(BridgeCall::RefreshProject(RootParams {
                root: access.root.clone(),
            }))?;
            match result {
                BridgeResult::RefreshProject(response) => {
                    session.cache_refresh_response(&access.root, &response);
                    session.accept_protocol_result(qualify_open_response(
                        &access.destination,
                        response,
                    ))
                }
                other => Err(unexpected_result(session, "refresh-project", &other)),
            }
        })
    }

    pub fn list_directory(
        &self,
        access: &SshProjectAccess,
        path: &str,
    ) -> Result<ProjectDirectoryResponse, String> {
        self.with_session(&access.destination, false, |session| {
            let result = session.request(BridgeCall::ListDirectory(ProjectPathParams {
                root: access.root.clone(),
                path: path.to_owned(),
            }))?;
            match result {
                BridgeResult::Directory(directory) => Ok(directory),
                other => Err(unexpected_result(session, "list-directory", &other)),
            }
        })
    }

    pub fn documentation_qc(
        &self,
        access: &SshProjectAccess,
        snapshot: &str,
        window: mindflow::documentation_qc::QcWindow,
    ) -> Result<mindflow::documentation_qc::DocumentationQc, String> {
        self.with_session(&access.destination, false, |session| {
            if session.regions.get(&access.root).map(|region| region.snapshot.as_str()) != Some(snapshot) {
                return Err("QC requires the retained SSH Region snapshot; refresh the project first".into());
            }
            let result = session.request(BridgeCall::DocumentationQc(bridge::DocumentationQcParams {
                root: access.root.clone(), snapshot: snapshot.into(), window: window.clone(),
            }))?;
            match result {
                BridgeResult::DocumentationQc(mut report) => {
                    if report.root != access.root || report.snapshot.id != snapshot
                        || report.schema != "mindflow-documentation-qc/v2" || report.window != window {
                        return Err(session.protocol_failure("SSH QC response does not match the requested observation"));
                    }
                    report.root = encode_access_root(&access.destination, &report.root)?;
                    Ok(report)
                }
                other => Err(unexpected_result(session, "documentation-qc", &other)),
            }
        })
    }

    pub fn documentation_qc_history(
        &self,
        access: &SshProjectAccess,
        snapshot: &str,
        offset: usize,
    ) -> Result<mindflow::documentation_qc::DocumentationQcHistory, String> {
        self.with_session(&access.destination, false, |session| {
            if session.regions.get(&access.root).map(|region| region.snapshot.as_str()) != Some(snapshot) {
                return Err("QC history requires the retained SSH Region snapshot; refresh the project first".into());
            }
            let result = session.request(BridgeCall::DocumentationQcHistory(bridge::DocumentationQcHistoryParams {
                root: access.root.clone(), snapshot: snapshot.into(), offset,
            }))?;
            match result {
                BridgeResult::DocumentationQcHistory(mut report) => {
                    if report.root != access.root || report.snapshot.id != snapshot
                        || report.schema != "mindflow-documentation-qc-history/v1" || report.offset != offset {
                        return Err(session.protocol_failure("SSH QC history response does not match the requested observation"));
                    }
                    report.root = encode_access_root(&access.destination, &report.root)?;
                    Ok(report)
                }
                other => Err(unexpected_result(session, "documentation-qc-history", &other)),
            }
        })
    }

    pub fn reader_snapshot(
        &self,
        access: &SshProjectAccess,
        path: &str,
        expected_snapshot: Option<&str>,
    ) -> Result<ReaderProjectSnapshot, String> {
        self.with_session(&access.destination, false, |session| {
            let cached = session.regions.get(&access.root).cloned();
            let request_snapshot = match (expected_snapshot, cached.as_ref()) {
                (Some(expected), Some(cached)) if expected == cached.snapshot.as_str() => {
                    Some(cached.snapshot.clone())
                }
                (Some(expected), Some(cached)) => {
                    return Err(format!(
                        "SSH Reader requested snapshot {expected}, but the retained project snapshot is {}",
                        cached.snapshot
                    ));
                }
                (Some(_), None) => {
                    return Err(
                        "SSH project is not retained by this desktop session; refresh it first"
                            .to_owned(),
                    );
                }
                (None, Some(_)) => {
                    return Err(
                        "an opened SSH Region Reader request must name its retained snapshot"
                            .to_owned(),
                    );
                }
                (None, None) => None,
            };
            let result = session.request(BridgeCall::ReaderSnapshot(ReaderSnapshotParams {
                root: access.root.clone(),
                path: path.to_owned(),
                snapshot: request_snapshot,
            }))?;
            match result {
                BridgeResult::Reader(mut snapshot) => {
                    if snapshot.root != access.root {
                        return Err(session.protocol_failure(&format!(
                            "SSH response root '{}' does not match requested root '{}'",
                            snapshot.root, access.root
                        )));
                    }
                    if let Some(cached) = cached {
                        if snapshot
                            .snapshot
                            .as_ref()
                            .map(|snapshot| snapshot.id.as_str())
                            != Some(cached.snapshot.as_str())
                        {
                            return Err(session.protocol_failure(
                                "SSH Reader response does not match the retained project snapshot",
                            ));
                        }
                        if snapshot.graph.is_some() {
                            return Err(session.protocol_failure(
                                "SSH Reader response unexpectedly repeated the project graph",
                            ));
                        }
                        snapshot.graph = Some(cached.graph);
                    } else if snapshot.snapshot.is_some() || snapshot.graph.is_none() {
                        return Err(session.protocol_failure(
                            "SSH folder Reader response has an unexpected semantic snapshot shape",
                        ));
                    }
                    snapshot.root = session.accept_protocol_result(encode_access_root(
                        &access.destination,
                        &snapshot.root,
                    ))?;
                    Ok(snapshot)
                }
                other => Err(unexpected_result(session, "reader-snapshot", &other)),
            }
        })
    }

    pub fn reader_snapshot_current(
        &self,
        access: &SshProjectAccess,
        path: &str,
    ) -> Result<ReaderProjectSnapshot, String> {
        let snapshot = self.with_session(&access.destination, false, |session| {
            Ok(session
                .regions
                .get(&access.root)
                .map(|cached| cached.snapshot.clone()))
        })?;
        self.reader_snapshot(access, path, snapshot.as_deref())
    }

    pub fn validate_reader_root(
        &self,
        access: &SshProjectAccess,
        expected_snapshot: Option<&str>,
    ) -> Result<String, String> {
        self.with_session(&access.destination, false, |session| {
            match (expected_snapshot, session.regions.get(&access.root)) {
                (Some(expected), Some(cached)) if expected == cached.snapshot.as_str() => {}
                (Some(expected), Some(cached)) => {
                    return Err(format!(
                        "SSH Reader requested snapshot {expected}, but the retained project snapshot is {}",
                        cached.snapshot
                    ));
                }
                (Some(_), None) => {
                    return Err(
                        "SSH project is not retained by this desktop session; refresh it first"
                            .to_owned(),
                    );
                }
                (None, Some(_)) => {
                    return Err(
                        "an opened SSH Region Reader request must name its retained snapshot"
                            .to_owned(),
                    );
                }
                (None, None) => {}
            }
            encode_access_root(&access.destination, &access.root)
        })
    }

    pub fn image_data_url(&self, access: &SshProjectAccess, path: &str) -> Result<String, String> {
        self.with_session(&access.destination, false, |session| {
            let result = session.request(BridgeCall::ReadImage(ProjectPathParams {
                root: access.root.clone(),
                path: path.to_owned(),
            }))?;
            match result {
                BridgeResult::ImageDataUrl(data_url) => Ok(data_url),
                other => Err(unexpected_result(session, "read-image", &other)),
            }
        })
    }

    fn with_session<T>(
        &self,
        destination: &str,
        connect_if_missing: bool,
        operation: impl FnOnce(&mut SshSession) -> Result<T, String>,
    ) -> Result<T, String> {
        let session = self.session(destination, connect_if_missing)?;
        let (result, healthy) = {
            let mut session = session
                .lock()
                .map_err(|_| format!("SSH session '{destination}' is unavailable"))?;
            let result = operation(&mut session);
            (result, session.healthy)
        };
        if !healthy {
            self.remove_if_current(destination, &session);
        }
        result
    }

    fn session(
        &self,
        destination: &str,
        connect_if_missing: bool,
    ) -> Result<Arc<Mutex<SshSession>>, String> {
        validate_destination(destination)?;
        let existing = {
            let sessions = self
                .sessions
                .lock()
                .map_err(|_| "SSH session registry is unavailable".to_owned())?;
            sessions.get(destination).cloned()
        };
        if let Some(session) = existing {
            let running = session
                .lock()
                .map(|mut session| session.is_running())
                .unwrap_or(false);
            if running {
                return Ok(session);
            }
            self.remove_if_current(destination, &session);
        }
        if !connect_if_missing {
            return Err(format!(
                "SSH session '{destination}' is disconnected; use Open or Refresh to reconnect"
            ));
        }

        let candidate = Arc::new(Mutex::new(SshSession::connect(destination)?));
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "SSH session registry is unavailable".to_owned())?;
        Ok(sessions
            .entry(destination.to_owned())
            .or_insert(candidate)
            .clone())
    }

    fn remove_if_current(&self, destination: &str, failed: &Arc<Mutex<SshSession>>) {
        let Ok(mut sessions) = self.sessions.lock() else {
            return;
        };
        if sessions
            .get(destination)
            .is_some_and(|current| Arc::ptr_eq(current, failed))
        {
            sessions.remove(destination);
        }
    }

    #[cfg(test)]
    fn terminate_session_for_test(&self, destination: &str) {
        let session = self
            .sessions
            .lock()
            .unwrap()
            .get(destination)
            .cloned()
            .expect("test SSH session is missing");
        let mut session = session.lock().unwrap();
        let child = session.child.as_mut().expect("test SSH child is missing");
        child.kill().unwrap();
        child.wait().unwrap();
    }
}

struct SshSession {
    destination: String,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    stdout: Option<BufReader<ChildStdout>>,
    stderr_tail: Arc<Mutex<Vec<u8>>>,
    stderr_thread: Option<JoinHandle<()>>,
    next_id: u64,
    healthy: bool,
    regions: BTreeMap<String, CachedRemoteRegion>,
    runtime: Option<RuntimeVersion>,
}

#[derive(Clone)]
struct CachedRemoteRegion {
    snapshot: String,
    graph: mindflow::model::GraphData,
    version: ProjectVersion,
}

impl SshSession {
    fn connect(destination: &str) -> Result<Self, String> {
        validate_destination(destination)?;
        let mut child = Command::new("ssh")
            .args([
                "-T",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=10",
                "--",
                destination,
                "mindflow",
                "bridge",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("cannot start SSH destination '{destination}': {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| format!("cannot open SSH input for '{destination}'"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| format!("cannot open SSH output for '{destination}'"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| format!("cannot open SSH diagnostics for '{destination}'"))?;
        let stderr_tail = Arc::new(Mutex::new(Vec::new()));
        let stderr_thread = capture_stderr(stderr, Arc::clone(&stderr_tail));
        let mut session = Self {
            destination: destination.to_owned(),
            child: Some(child),
            stdin: Some(stdin),
            stdout: Some(BufReader::new(stdout)),
            stderr_tail,
            stderr_thread: Some(stderr_thread),
            next_id: 1,
            healthy: true,
            regions: BTreeMap::new(),
            runtime: None,
        };
        let result = session.request(BridgeCall::Handshake(HandshakeParams {
            client_version: format!("mindflow-desktop-{}", env!("CARGO_PKG_VERSION")),
            required_capabilities: REQUIRED_CAPABILITIES
                .iter()
                .map(|capability| (*capability).to_owned())
                .collect(),
        }))?;
        let BridgeResult::Handshake(handshake) = result else {
            return Err("SSH bridge returned an unexpected handshake result".to_owned());
        };
        if !is_lexically_unique(&handshake.capabilities) {
            return Err("SSH bridge capabilities are not lexically ordered and unique".to_owned());
        }
        for required in REQUIRED_CAPABILITIES {
            if !handshake
                .capabilities
                .iter()
                .any(|capability| capability == required)
            {
                return Err(format!(
                    "SSH bridge is missing required capability '{required}'"
                ));
            }
        }
        session.runtime = Some(handshake.runtime);
        Ok(session)
    }

    fn cache_open_response(&mut self, response: &OpenProjectResponse) {
        match response {
            OpenProjectResponse::Region { region } => {
                self.regions.insert(
                    region.root.clone(),
                    CachedRemoteRegion {
                        snapshot: region.status.snapshot.id.clone(),
                        graph: region.graph.clone(),
                        version: region.version.clone(),
                    },
                );
            }
            OpenProjectResponse::Folder { root, .. } => {
                self.regions.remove(root);
            }
            OpenProjectResponse::Error {
                root: Some(root), ..
            } => {
                self.regions.remove(root);
            }
            OpenProjectResponse::Error { root: None, .. } => {}
        }
    }

    fn cache_refresh_response(&mut self, root: &str, response: &OpenProjectResponse) {
        self.regions.remove(root);
        self.cache_open_response(response)
    }

    fn request(&mut self, call: BridgeCall) -> Result<BridgeResult, String> {
        let id = self.next_id;
        let Some(next_id) = self.next_id.checked_add(1) else {
            return Err(self.protocol_failure("request identity exhausted"));
        };
        self.next_id = next_id;
        let request = BridgeRequest::new(id, call);
        let Some(stdin) = self.stdin.as_mut() else {
            return Err(self.protocol_failure("bridge input is closed"));
        };
        if let Err(error) = bridge::write_frame(stdin, &request) {
            return Err(self.protocol_failure(&format!("cannot send request: {error:#}")));
        }
        let Some(stdout) = self.stdout.as_mut() else {
            return Err(self.protocol_failure("bridge output is closed"));
        };
        let response: BridgeResponse = match bridge::read_frame(stdout) {
            Ok(Some(response)) => response,
            Ok(None) => {
                return Err(self.protocol_failure("remote bridge ended before its response"))
            }
            Err(error) => {
                return Err(self.protocol_failure(&format!("cannot read response: {error:#}")))
            }
        };
        if response.protocol != PROTOCOL_VERSION {
            return Err(self.protocol_failure(&format!(
                "response protocol {} does not match {PROTOCOL_VERSION}",
                response.protocol
            )));
        }
        if response.id != id {
            return Err(self.protocol_failure(&format!(
                "response id {} does not match request id {id}",
                response.id
            )));
        }
        match response.outcome {
            BridgeOutcome::Ok { result } => Ok(result),
            BridgeOutcome::Error { error } => Err(self.failure(&format!(
                "{} ({:?}) failed: {}",
                error.phase, error.code, error.message
            ))),
        }
    }

    fn is_running(&mut self) -> bool {
        if !self.healthy {
            return false;
        }
        let running = self
            .child
            .as_mut()
            .is_some_and(|child| child.try_wait().is_ok_and(|status| status.is_none()));
        if !running {
            self.healthy = false;
        }
        running
    }

    fn accept_protocol_result<T>(&mut self, result: Result<T, String>) -> Result<T, String> {
        result.map_err(|message| self.protocol_failure(&message))
    }

    fn protocol_failure(&mut self, reason: &str) -> String {
        self.healthy = false;
        self.failure(reason)
    }

    fn failure(&self, reason: &str) -> String {
        let diagnostic = self
            .stderr_tail
            .lock()
            .ok()
            .map(|tail| String::from_utf8_lossy(&tail).trim().to_owned())
            .filter(|tail| !tail.is_empty());
        match diagnostic {
            Some(diagnostic) => format!(
                "SSH destination '{}' failed: {reason}\n{diagnostic}",
                self.destination
            ),
            None => format!("SSH destination '{}' failed: {reason}", self.destination),
        }
    }
}

impl Drop for SshSession {
    fn drop(&mut self) {
        if let Some(stdin) = self.stdin.as_mut() {
            let _ =
                bridge::write_frame(stdin, &BridgeRequest::new(self.next_id, BridgeCall::Close));
        }
        self.stdin.take();
        self.stdout.take();
        if let Some(mut child) = self.child.take() {
            if child.try_wait().ok().flatten().is_none() {
                let _ = child.kill();
            }
            let _ = child.wait();
        }
        if let Some(thread) = self.stderr_thread.take() {
            let _ = thread.join();
        }
    }
}

fn capture_stderr(
    mut stderr: impl Read + Send + 'static,
    tail: Arc<Mutex<Vec<u8>>>,
) -> JoinHandle<()> {
    thread::Builder::new()
        .name("mindflow-ssh-stderr".to_owned())
        .spawn(move || {
            let mut buffer = [0_u8; 4096];
            loop {
                let read = match stderr.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => read,
                };
                let Ok(mut tail) = tail.lock() else {
                    break;
                };
                tail.extend_from_slice(&buffer[..read]);
                if tail.len() > STDERR_LIMIT_BYTES {
                    let excess = tail.len() - STDERR_LIMIT_BYTES;
                    tail.drain(..excess);
                }
            }
        })
        .expect("cannot start bounded SSH diagnostic reader")
}

pub fn validate_destination(destination: &str) -> Result<(), String> {
    if destination.is_empty() {
        return Err("SSH destination must not be empty".to_owned());
    }
    if destination.starts_with('-') {
        return Err("SSH destination must not begin with '-'".to_owned());
    }
    if !destination.bytes().all(|byte| {
        byte.is_ascii_alphanumeric()
            || matches!(byte, b'.' | b'-' | b'_' | b'@' | b':' | b'[' | b']')
    }) {
        return Err(
            "SSH destination contains unsupported characters; use a configured host or user@host"
                .to_owned(),
        );
    }
    Ok(())
}

pub fn configured_destinations() -> Result<Vec<String>, String> {
    let Some(home) = env::var_os("HOME") else {
        return Ok(Vec::new());
    };
    let config = PathBuf::from(home).join(".ssh/config");
    let source = match fs::read_to_string(&config) {
        Ok(source) => source,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(format!(
                "cannot read local SSH configuration '{}': {error}",
                config.display()
            ))
        }
    };
    Ok(parse_configured_destinations(&source))
}

fn parse_configured_destinations(source: &str) -> Vec<String> {
    let mut destinations = Vec::new();
    let mut seen = BTreeSet::new();
    for line in source.lines() {
        let declaration = line.split('#').next().unwrap_or_default().trim();
        let mut tokens = declaration.split_whitespace();
        let Some(keyword) = tokens.next() else {
            continue;
        };
        if !keyword.eq_ignore_ascii_case("host") {
            continue;
        }
        for token in tokens {
            let destination = token.trim_matches(|character| character == '\'' || character == '"');
            if validate_destination(destination).is_ok() && seen.insert(destination.to_owned()) {
                destinations.push(destination.to_owned());
            }
        }
    }
    destinations
}

pub fn encode_access_root(destination: &str, root: &str) -> Result<String, String> {
    validate_destination(destination)?;
    if !Path::new(root).is_absolute() {
        return Err("SSH project root must be an absolute remote path".to_owned());
    }
    Ok(format!("{SSH_PREFIX}{destination}{root}"))
}

pub fn parse_access_root(value: &str) -> Result<Option<SshProjectAccess>, String> {
    let Some(access) = value.strip_prefix(SSH_PREFIX) else {
        return Ok(None);
    };
    let separator = access
        .find('/')
        .ok_or_else(|| "SSH project access root is missing its absolute remote path".to_owned())?;
    let destination = &access[..separator];
    let root = &access[separator..];
    validate_destination(destination)?;
    if !Path::new(root).is_absolute() {
        return Err("SSH project access root is not absolute".to_owned());
    }
    Ok(Some(SshProjectAccess {
        destination: destination.to_owned(),
        root: root.to_owned(),
    }))
}

fn qualify_open_response(
    destination: &str,
    response: OpenProjectResponse,
) -> Result<OpenProjectResponse, String> {
    match response {
        OpenProjectResponse::Region { mut region } => {
            let remote_root = region.root.clone();
            if region.status.root != remote_root {
                return Err(format!(
                    "SSH region root '{}' does not match status root '{}'",
                    remote_root, region.status.root
                ));
            }
            region.root = encode_access_root(destination, &remote_root)?;
            Ok(OpenProjectResponse::Region { region })
        }
        OpenProjectResponse::Folder { root, project } => Ok(OpenProjectResponse::Folder {
            root: encode_access_root(destination, &root)?,
            project,
        }),
        OpenProjectResponse::Error {
            requested_path,
            root,
            project,
            message,
        } => Ok(OpenProjectResponse::Error {
            requested_path,
            root: root
                .as_deref()
                .map(|root| encode_access_root(destination, root))
                .transpose()?,
            project,
            message,
        }),
    }
}

fn validate_folder_directory(
    directory: FolderPickerResponse,
) -> Result<FolderPickerResponse, String> {
    let root = Path::new(&directory.path);
    if !root.is_absolute() {
        return Err("SSH folder browser returned a non-absolute directory".to_owned());
    }
    if directory
        .parent
        .as_deref()
        .is_some_and(|parent| !Path::new(parent).is_absolute())
    {
        return Err("SSH folder browser returned a non-absolute parent".to_owned());
    }
    if directory.entries.iter().any(|entry| {
        let path = Path::new(&entry.path);
        !path.is_absolute()
            || path.parent() != Some(root)
            || path.file_name().and_then(|name| name.to_str()) != Some(entry.name.as_str())
    }) {
        return Err("SSH folder browser returned an invalid child directory".to_owned());
    }
    if directory
        .entries
        .windows(2)
        .any(|entries| entries[0].name >= entries[1].name)
    {
        return Err("SSH folder browser entries are not lexically ordered and unique".to_owned());
    }
    Ok(directory)
}

fn unexpected_result(session: &mut SshSession, operation: &str, result: &BridgeResult) -> String {
    session.protocol_failure(&format!(
        "SSH bridge returned an unexpected result for {operation}: {result:?}"
    ))
}

fn is_lexically_unique(values: &[String]) -> bool {
    values.windows(2).all(|pair| pair[0] < pair[1])
}

#[cfg(test)]
mod tests {
    use std::env;

    use super::*;

    #[test]
    fn destination_grammar_rejects_shell_and_option_surfaces() {
        for destination in ["server", "user@server", "host:2222", "[::1]"] {
            validate_destination(destination).unwrap();
        }
        for destination in [
            "",
            "-oProxyCommand=bad",
            "server name",
            "server/path",
            "$(bad)",
        ] {
            assert!(validate_destination(destination).is_err(), "{destination}");
        }
    }

    #[test]
    fn configured_server_selection_uses_literal_host_aliases_in_source_order() {
        let destinations = parse_configured_destinations(
            "Host *\n  User default\nHost server-proxy server_proxy\nHost \"server\"\nHost server\n",
        );
        assert_eq!(destinations, ["server-proxy", "server_proxy", "server"]);
    }

    #[test]
    fn access_roots_round_trip_destination_and_remote_absolute_root() {
        let encoded = encode_access_root("server", "/home/user/coding/Mindflow").unwrap();
        assert_eq!(encoded, "ssh://server/home/user/coding/Mindflow");
        assert_eq!(
            parse_access_root(&encoded).unwrap(),
            Some(SshProjectAccess {
                destination: "server".to_owned(),
                root: "/home/user/coding/Mindflow".to_owned(),
            })
        );
        assert_eq!(parse_access_root("/local/project").unwrap(), None);
        assert!(parse_access_root("ssh://server").is_err());
    }

    #[test]
    #[ignore = "requires MINDFLOW_SSH_TEST_DESTINATION and MINDFLOW_SSH_TEST_PATH"]
    fn configured_server_opens_lists_and_reads_through_the_real_bridge() {
        let destination = env::var("MINDFLOW_SSH_TEST_DESTINATION").unwrap();
        let path = env::var("MINDFLOW_SSH_TEST_PATH").unwrap();
        let sessions = SshSessionManager::default();
        let home = sessions.browse_directory(&destination, "~", true).unwrap();
        assert!(Path::new(&home.path).is_absolute());
        assert!(home.entries.iter().any(|entry| entry.name == "coding"));
        let response = sessions.open_project(&destination, &path).unwrap();
        let (qualified_root, retained_snapshot) = match response {
            OpenProjectResponse::Region { region } => (region.root, region.status.snapshot.id),
            other => panic!("expected a remote region, received {other:?}"),
        };
        let access = parse_access_root(&qualified_root).unwrap().unwrap();
        let directory = sessions.list_directory(&access, "").unwrap();
        assert!(directory
            .entries
            .iter()
            .any(|entry| entry.path == "governance"));
        assert!(sessions
            .reader_snapshot(&access, "missing-reader-file.md", Some(&retained_snapshot),)
            .is_err());
        assert!(sessions.list_directory(&access, "").is_ok());
        let reader = sessions
            .reader_snapshot(
                &access,
                "governance/Documentation.md",
                Some(&retained_snapshot),
            )
            .unwrap();
        assert!(reader
            .document
            .content
            .starts_with("# Repository Documentation System"));
        assert_eq!(reader.root, qualified_root);

        sessions.terminate_session_for_test(&destination);
        assert!(sessions.list_directory(&access, "").is_err());
        assert!(matches!(
            sessions.refresh_project(&access, true).unwrap(),
            OpenProjectResponse::Region { .. }
        ));
    }
}
