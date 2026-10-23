use std::collections::{BTreeMap, BTreeSet};
#[cfg(unix)]
use std::ffi::{CStr, CString};
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Cursor, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;

#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd};
#[cfg(unix)]
use std::os::unix::ffi::OsStrExt;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

use anyhow::{anyhow, bail, Context, Result};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::model::*;
use crate::soe::{
    CurrentContext, EvolveFlow, HistoricalContext, HistoricalSelection, HistoricalSelectionRequest,
    Opening, OpeningFile, SelectedAnchor, TemporalSource, TemporalSourceProvenance,
};
use crate::yaml::{insert_root_mapping_entry, remove_root_mapping_entry, validate_restricted_yaml};
pub const MANIFEST_FILENAME: &str = "MINDFLOW.yaml";
pub const CURRENT_FORMAT: &str = "2026-10-20";
pub const SNAPSHOT_ID_VERSION: u32 = 2;
pub const REGION_INDEX_SCHEMA: &str = "mindflow-region-index/v5";
pub const EVENT_PAGE_SCHEMA: &str = "mindflow-evolve-event-page/v1";
pub const DEFAULT_EVENT_PAGE_SIZE: usize = 64;
pub const MAX_EVENT_PAGE_SIZE: usize = 512;
pub const CHANGE_PROPOSAL_SCHEMA: &str = "mindflow-change-proposal/v3";
pub const CHANGE_APPLIED_SCHEMA: &str = "mindflow-change-applied/v3";
pub const EMPTY_MANIFEST_SOURCE: &str = concat!("format: \"2026-10-20\"\nadopted-release: \"", env!("CARGO_PKG_VERSION"), "\"\ncomponents: {}\nrelationship-types: {}\nrelationships: []\nanchor-connection-types: {}\nopening:\n  files: []\nevolve:\n  events: []\nhistorical-components: {}\nanchors: {}\n");
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diagnostic {
    pub severity: Severity,
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub message: String,
}

impl Diagnostic {
    fn error(code: &str, path: impl Into<Option<String>>, message: impl Into<String>) -> Self {
        Self {
            severity: Severity::Error,
            code: code.to_owned(),
            path: path.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug)]
pub struct Project {
    pub root: PathBuf,
    pub manifest: Manifest,
    pub managed_files: BTreeSet<String>,
    manifest_source: String,
    repository_files: BTreeSet<String>,
    entries: BTreeMap<String, CapturedEntry>,
    ignored: BTreeSet<String>,
    document_sources: BTreeMap<String, CapturedDocument>,
    snapshot: SnapshotIdentity,
    diagnostics: OnceLock<Vec<Diagnostic>>,
    structure: OnceLock<StructureProjection>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SnapshotIdentity {
    pub version: u32,
    pub id: String,
    pub revision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContentHandle {
    pub sha256: String,
    pub bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentHandle {
    pub path: String,
    pub component: String,
    pub index: bool,
    pub content: ContentHandle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlaneDescriptor {
    pub count: usize,
    pub sha256: String,
    pub page_size: usize,
    pub command: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegionIndex {
    pub schema: String,
    pub root: String,
    pub snapshot: SnapshotIdentity,
    pub format: String,
    pub structure: StructureProjection,
    pub relationship_types: BTreeMap<String, RelationshipTypeDefinition>,
    pub anchor_connection_types: BTreeMap<String, AnchorConnectionTypeDefinition>,
    pub documents: Vec<DocumentHandle>,
    pub historical_components: BTreeMap<String, HistoricalComponentDefinition>,
    pub opening: Opening,
    pub events: PlaneDescriptor,
    pub anchors: BTreeMap<String, AnchorView>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventPage {
    pub schema: String,
    pub snapshot: SnapshotIdentity,
    pub offset: usize,
    pub limit: usize,
    pub total: usize,
    pub events: Vec<crate::model::EvolveEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ChangeOperation {
    OpenOpeningBranch {
        component: String,
        file: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        relationship_parent: String,
        relationship_type: String,
        event: String,
        event_description: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CarrierPreview {
    pub path: String,
    pub before: ContentHandle,
    pub after: ContentHandle,
    pub diff: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChangeDependency {
    pub path: String,
    pub content: ContentHandle,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChangeProposal {
    pub schema: String,
    pub id: String,
    pub source: SnapshotIdentity,
    pub operation: ChangeOperation,
    pub dependencies: Vec<ChangeDependency>,
    pub carriers: Vec<CarrierPreview>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChangeApplied {
    pub schema: String,
    pub proposal: String,
    pub source: SnapshotIdentity,
    pub committed: SnapshotIdentity,
    pub carriers: Vec<CarrierPreview>,
}

struct PreparedChange {
    proposal: ChangeProposal,
    manifest_source: String,
}
#[derive(Debug, Clone, PartialEq, Eq)]
enum CapturedDocument {
    Text(String),
    InvalidPath(String),
    Missing,
    Symlink,
    NotRegular,
    Unreadable(String),
    NonUtf8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
enum CapturedEntry {
    Directory,
    File,
    Missing,
    Symlink,
    Other,
    Unreadable(String),
}
#[derive(Debug)]
struct ProjectCapture {
    manifest: Manifest,
    manifest_source: String,
    repository_files: BTreeSet<String>,
    entries: BTreeMap<String, CapturedEntry>,
    ignored: BTreeSet<String>,
    document_sources: BTreeMap<String, CapturedDocument>,
    head: Option<String>,
}
impl ProjectCapture {
    fn same_sources(&self, other: &Self) -> bool {
        self.manifest_source == other.manifest_source
            && self.repository_files == other.repository_files
            && self.entries == other.entries
            && self.ignored == other.ignored
            && self.document_sources == other.document_sources
            && self.head == other.head
    }
    fn snapshot_identity(&self) -> SnapshotIdentity {
        let mut hash = Sha256::new();
        for value in [
            "mindflow-working-slice-v2",
            &self.manifest_source,
            self.head.as_deref().unwrap_or(""),
        ] {
            hash_snapshot_field(&mut hash, value.as_bytes());
        }
        for value in [
            serde_json::to_vec(&self.entries).unwrap(),
            serde_json::to_vec(&self.ignored).unwrap(),
            serde_json::to_vec(&self.repository_files).unwrap(),
        ] {
            hash_snapshot_field(&mut hash, &value);
        }
        for (path, source) in &self.document_sources {
            hash_snapshot_field(&mut hash, path.as_bytes());
            hash_snapshot_field(&mut hash, format!("{source:?}").as_bytes());
        }
        SnapshotIdentity {
            version: SNAPSHOT_ID_VERSION,
            id: format!("sha256:{:x}", hash.finalize()),
            revision: "working-tree".into(),
            head: self.head.clone(),
        }
    }
}
#[derive(Debug, Clone)]
struct GitObjectInfo {
    id: String,
    kind: String,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct StatusData {
    pub root: String,
    pub revision: String,
    pub snapshot: SnapshotIdentity,
    pub valid: bool,
    pub documents: usize,
    pub components: usize,
    pub relationships: usize,
    pub opening_files: usize,
    pub evolve_events: usize,
    pub anchors: usize,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnchorTimelineSlice {
    pub name: String,
    pub commit: String,
    pub event_boundary: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimelineCommit {
    pub commit: String,
    pub event_boundary: Option<usize>,
}

#[derive(Debug)]
pub enum HistoricalSelectionError {
    CurrentInvalid(Vec<Diagnostic>),
    Runtime(anyhow::Error),
}

impl fmt::Display for HistoricalSelectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CurrentInvalid(_) => write!(formatter, "the current Mindflow project is invalid"),
            Self::Runtime(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for HistoricalSelectionError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Runtime(error) => Some(error.as_ref()),
            _ => None,
        }
    }
}

impl From<anyhow::Error> for HistoricalSelectionError {
    fn from(error: anyhow::Error) -> Self {
        Self::Runtime(error)
    }
}

#[derive(Debug)]
pub enum AnchorMutationError {
    CurrentInvalid(Vec<Diagnostic>),
    ProposedInvalid(Vec<Diagnostic>),
    Runtime(anyhow::Error),
}

impl fmt::Display for AnchorMutationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CurrentInvalid(_) => write!(formatter, "the current Mindflow project is invalid"),
            Self::ProposedInvalid(_) => write!(formatter, "the proposed anchor state is invalid"),
            Self::Runtime(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for AnchorMutationError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Runtime(error) => Some(error.as_ref()),
            _ => None,
        }
    }
}

impl From<anyhow::Error> for AnchorMutationError {
    fn from(error: anyhow::Error) -> Self {
        Self::Runtime(error)
    }
}

impl Project {
    pub fn initialize(root: PathBuf) -> Result<Self> {
        let root = root.canonicalize()?;
        ensure_git_worktree(&root)?;
        let path = root.join(MANIFEST_FILENAME);
        if fs::symlink_metadata(&path).is_ok() {
            bail!("refusing to initialize: MINDFLOW.yaml already exists");
        }
        if git_path_is_ignored(&root, MANIFEST_FILENAME)? {
            bail!("MINDFLOW.yaml is ignored by Git");
        }
        let guard = lock_semantic_writer(&root)?;
        let source = write_initialization_sibling(&path, EMPTY_MANIFEST_SOURCE)?;
        let publication = fs::hard_link(&source, &path);
        let _ = fs::remove_file(source);
        publication.context("cannot publish MINDFLOW.yaml without replacing an existing entry")?;
        sync_directory(&root)?;
        let result = Self::load_unlocked(root.clone()).and_then(|project| {
            let diagnostics = project.diagnostics();
            if Self::has_errors(&diagnostics) {
                bail!(
                    "initialized manifest is invalid: {}",
                    diagnostic_messages(&diagnostics)
                );
            }
            Ok(project)
        });
        if result.is_err() {
            let _ = fs::remove_file(path);
        }
        drop(guard);
        result
    }
    pub fn discover(start: &Path) -> Result<PathBuf> {
        let mut cursor = start.canonicalize()?;
        if cursor.is_file() {
            cursor.pop();
        }
        loop {
            match fs::symlink_metadata(cursor.join(MANIFEST_FILENAME)) {
                Ok(_) => return Ok(cursor),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(error).context("cannot inspect Mindflow manifest candidate")
                }
            }
            if !cursor.pop() {
                bail!(
                    "no MINDFLOW.yaml found in `{}` or its ancestors",
                    start.display()
                );
            }
        }
    }
    pub fn load(root: PathBuf) -> Result<Self> {
        let root = root.canonicalize()?;
        ensure_git_worktree(&root)?;
        let _guard = lock_semantic_reader(&root)?;
        Self::load_unlocked(root)
    }
    fn load_unlocked(root: PathBuf) -> Result<Self> {
        let mut capture = capture_project(&root, None)?;
        for attempt in 0..3 {
            let next = capture_project(&root, None)?;
            if capture.same_sources(&next) {
                return Ok(Self::from_capture(root, next));
            }
            if attempt == 2 {
                bail!("project inputs changed repeatedly while loading; retry from a stable working slice");
            }
            capture = next;
        }
        unreachable!()
    }
    fn from_capture(root: PathBuf, capture: ProjectCapture) -> Self {
        let snapshot = capture.snapshot_identity();
        Self {
            root,
            manifest: capture.manifest,
            managed_files: capture.document_sources.keys().cloned().collect(),
            manifest_source: capture.manifest_source,
            repository_files: capture.repository_files,
            entries: capture.entries,
            ignored: capture.ignored,
            document_sources: capture.document_sources,
            snapshot,
            diagnostics: OnceLock::new(),
            structure: OnceLock::new(),
        }
    }
    fn candidate(&self, source: &str) -> Result<Self> {
        Ok(Self::from_capture(
            self.root.clone(),
            capture_project(&self.root, Some(source))?,
        ))
    }
    pub fn diagnostics(&self) -> Vec<Diagnostic> {
        self.diagnostics
            .get_or_init(|| self.compute_diagnostics())
            .clone()
    }
    pub fn has_errors(diagnostics: &[Diagnostic]) -> bool {
        diagnostics.iter().any(|d| d.severity == Severity::Error)
    }
    fn require_valid(&self) -> std::result::Result<(), Vec<Diagnostic>> {
        let diagnostics = self.diagnostics();
        if Self::has_errors(&diagnostics) {
            Err(diagnostics)
        } else {
            Ok(())
        }
    }
    fn registrations(&self) -> Vec<(&String, &ComponentRegistration)> {
        let mut entries = self.manifest.components.iter().collect::<Vec<_>>();
        entries.sort_by(|(ai, a), (bi, b)| a.path.cmp(&b.path).then(ai.cmp(bi)));
        entries
    }
    fn document_path(&self, id: &str) -> Option<&str> {
        self.manifest
            .components
            .get(id)
            .filter(|c| {
                self.entries.get(&c.path) == Some(&CapturedEntry::File) && c.path.ends_with(".md")
            })
            .map(|c| c.path.as_str())
    }
    fn document_path_for_reference(&self, id: &str) -> Option<&str> {
        self.document_path(id).or_else(|| {
            self.manifest
                .historical_components
                .get(id)
                .map(|c| c.path.as_str())
        })
    }
    fn compute_document_handles(&self) -> Vec<DocumentHandle> {
        self.registrations()
            .into_iter()
            .filter_map(|(id, c)| match self.document_sources.get(&c.path) {
                Some(CapturedDocument::Text(content)) => Some(DocumentHandle {
                    component: id.clone(),
                    path: c.path.clone(),
                    index: c.index,
                    content: content_handle(content),
                }),
                _ => None,
            })
            .collect()
    }
    pub fn document_handles(&self) -> std::result::Result<Vec<DocumentHandle>, Vec<Diagnostic>> {
        self.require_valid()?;
        Ok(self.compute_document_handles())
    }
    pub fn structure(&self) -> std::result::Result<StructureProjection, Vec<Diagnostic>> {
        self.require_valid()?;
        Ok(self
            .structure
            .get_or_init(|| {
                let registrations = self
                    .manifest
                    .components
                    .iter()
                    .map(|(id, c)| (c.path.as_str(), (id, c)))
                    .collect::<BTreeMap<_, _>>();
                let documents = self
                    .compute_document_handles()
                    .into_iter()
                    .map(|d| (d.path.clone(), d))
                    .collect::<BTreeMap<_, _>>();
                let nodes = self
                    .entries
                    .iter()
                    .map(|(path, entry)| StructureNode {
                        path: path.clone(),
                        name: if path == "." {
                            self.root
                                .file_name()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .into_owned()
                        } else {
                            path.rsplit('/').next().unwrap().to_owned()
                        },
                        kind: if *entry == CapturedEntry::Directory {
                            EntryKind::Directory
                        } else if path.ends_with(".md") {
                            EntryKind::Document
                        } else {
                            EntryKind::Target
                        },
                        parent_path: (path != ".").then(|| directory_parent(path).to_owned()),
                        component: registrations.get(path.as_str()).map(|(id, c)| {
                            ComponentAnnotation {
                                id: (*id).clone(),
                                description: c.description.clone(),
                                index: c.index,
                            }
                        }),
                        document: documents.get(path).cloned(),
                    })
                    .collect();
                StructureProjection {
                    nodes,
                    relationships: self.manifest.relationships.clone(),
                }
            })
            .clone())
    }
    pub fn anchor_views(&self) -> BTreeMap<String, AnchorView> {
        self.manifest
            .anchors
            .iter()
            .map(|(name, anchor)| {
                (
                    name.clone(),
                    AnchorView {
                        definition: anchor.clone(),
                        file: self
                            .document_path(&anchor.component)
                            .unwrap_or("")
                            .to_owned(),
                    },
                )
            })
            .collect()
    }
    pub fn graph(&self) -> GraphData {
        self.validated_graph()
            .expect("graph requires a valid project")
    }
    pub fn validated_graph(&self) -> std::result::Result<GraphData, Vec<Diagnostic>> {
        self.require_valid()?;
        Ok(GraphData {
            format: CURRENT_FORMAT.into(),
            structure: self.structure()?,
            documents: self.document_handles()?,
            relationship_types: self.manifest.relationship_types.clone(),
            anchor_connection_types: self.manifest.anchor_connection_types.clone(),
            historical_components: self.manifest.historical_components.clone(),
            events: self.manifest.evolve.events.clone(),
            anchors: self.anchor_views(),
        })
    }
    pub fn region_index(&self) -> std::result::Result<RegionIndex, Vec<Diagnostic>> {
        self.require_valid()?;
        Ok(RegionIndex {
            schema: REGION_INDEX_SCHEMA.into(),
            root: self.root.display().to_string(),
            snapshot: self.snapshot.clone(),
            format: CURRENT_FORMAT.into(),
            structure: self.structure()?,
            relationship_types: self.manifest.relationship_types.clone(),
            anchor_connection_types: self.manifest.anchor_connection_types.clone(),
            documents: self.document_handles()?,
            historical_components: self.manifest.historical_components.clone(),
            opening: self.opening(),
            events: PlaneDescriptor {
                count: self.manifest.evolve.events.len(),
                sha256: sha256_bytes(&serde_json::to_vec(&self.manifest.evolve.events).unwrap()),
                page_size: DEFAULT_EVENT_PAGE_SIZE,
                command: vec!["evolve".into(), "events".into(), "--json".into()],
            },
            anchors: self.anchor_views(),
        })
    }
    pub fn opening(&self) -> Opening {
        self.require_valid()
            .expect("Opening requires a valid project");
        Opening {
            files: self
                .manifest
                .opening
                .files
                .iter()
                .map(|id| OpeningFile {
                    component: id.clone(),
                    path: self.document_path(id).unwrap().to_owned(),
                })
                .collect(),
        }
    }
    pub fn evolve_flow(&self) -> EvolveFlow {
        self.require_valid()
            .expect("Events require a valid project");
        EvolveFlow {
            events: self.manifest.evolve.events.clone(),
        }
    }
    pub fn event_page(&self, offset: usize, limit: usize) -> Result<EventPage> {
        if limit == 0 || limit > MAX_EVENT_PAGE_SIZE {
            bail!("Event page limit must be between 1 and {MAX_EVENT_PAGE_SIZE}");
        }
        self.require_valid()
            .map_err(|_| anyhow!("cannot page Events from an invalid project"))?;
        let total = self.manifest.evolve.events.len();
        if offset > total {
            bail!("Event page offset {offset} exceeds total {total}");
        }
        let end = offset.saturating_add(limit).min(total);
        Ok(EventPage {
            schema: EVENT_PAGE_SCHEMA.into(),
            snapshot: self.snapshot.clone(),
            offset,
            limit,
            total,
            events: self.manifest.evolve.events[offset..end].to_vec(),
            next_offset: (end < total).then_some(end),
        })
    }
    pub fn status(&self) -> StatusData {
        let diagnostics = self.diagnostics();
        StatusData {
            root: self.root.display().to_string(),
            revision: self.snapshot.revision.clone(),
            snapshot: self.snapshot.clone(),
            valid: !Self::has_errors(&diagnostics),
            documents: self.managed_files.len(),
            components: self.manifest.components.len(),
            relationships: self.manifest.relationships.len(),
            opening_files: self.manifest.opening.files.len(),
            evolve_events: self.manifest.evolve.events.len(),
            anchors: self.manifest.anchors.len(),
            diagnostics,
        }
    }
    pub fn read_managed_document(&self, path: &str) -> Result<String> {
        if !self.managed_files.contains(path) {
            bail!("`{path}` is not a managed document");
        }
        validate_managed_file_path(path)
            .map_err(|message| anyhow!("invalid managed path `{path}`: {message}"))?;
        match self.document_sources.get(path) {
            Some(CapturedDocument::Text(content)) => Ok(content.clone()),
            Some(CapturedDocument::InvalidPath(message)) => {
                bail!("invalid managed path `{path}`: {message}")
            }
            Some(CapturedDocument::Missing) | None => {
                bail!("managed document `{path}` does not exist")
            }
            Some(CapturedDocument::Symlink) => {
                bail!("managed document `{path}` must not be a symbolic link")
            }
            Some(CapturedDocument::NotRegular) => {
                bail!("managed document `{path}` is not a regular file")
            }
            Some(CapturedDocument::Unreadable(message)) => {
                bail!("cannot read managed document `{path}`: {message}")
            }
            Some(CapturedDocument::NonUtf8) => {
                bail!("managed document `{path}` is not valid UTF-8")
            }
        }
    }

    pub fn snapshot_identity(&self) -> &SnapshotIdentity {
        &self.snapshot
    }

    pub fn anchor_timeline(&self) -> Vec<AnchorTimelineSlice> {
        self.manifest
            .anchors
            .iter()
            .map(|(name, anchor)| AnchorTimelineSlice {
                name: name.clone(),
                commit: anchor.commit.clone(),
                event_boundary: historical_events(&self.root, &anchor.commit).ok().and_then(
                    |events| exact_event_prefix_boundary(&self.manifest.evolve.events, &events),
                ),
            })
            .collect()
    }

    pub fn timeline_commits(&self) -> Vec<TimelineCommit> {
        let commits: Vec<String> = git_output(
            &self.root,
            &["rev-list", "--first-parent", "--reverse", "HEAD"],
        )
        .map(|output| {
            output
                .lines()
                .filter(|commit| {
                    commit.len() == 40 && commit.bytes().all(|byte| byte.is_ascii_hexdigit())
                })
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
        if commits.is_empty() {
            return Vec::new();
        }

        let boundary_updates = (|| -> Result<BTreeMap<String, Option<usize>>> {
            let manifest_changes = git_output(
                &self.root,
                &[
                    "log",
                    "--first-parent",
                    "--reverse",
                    "--format=%H",
                    "HEAD",
                    "--",
                    MANIFEST_FILENAME,
                ],
            )?;
            let manifest_change_set = manifest_changes
                .lines()
                .filter(|commit| commits.iter().any(|candidate| candidate == commit))
                .map(str::to_owned)
                .collect::<BTreeSet<_>>();
            let manifest_change_commits = commits
                .iter()
                .filter(|commit| manifest_change_set.contains(*commit))
                .cloned()
                .collect::<Vec<_>>();
            let historical_manifests =
                git_blob_texts(&self.root, &manifest_change_commits, MANIFEST_FILENAME)?;

            Ok(manifest_change_commits
                .into_iter()
                .zip(historical_manifests)
                .map(|(commit, content)| {
                    let boundary =
                        match content {
                            None => Some(0),
                            Some(content) => decode_historical_events(&content, &commit)
                                .ok()
                                .and_then(|events| {
                                    exact_event_name_prefix_boundary(
                                        &self.manifest.evolve.events,
                                        &events,
                                    )
                                }),
                        };
                    (commit, boundary)
                })
                .collect())
        })()
        .ok();

        let mut event_boundary = boundary_updates.as_ref().map(|_| Some(0)).unwrap_or(None);
        commits
            .into_iter()
            .map(|commit| {
                if let Some(boundary) = boundary_updates
                    .as_ref()
                    .and_then(|updates| updates.get(&commit))
                {
                    event_boundary = *boundary;
                }
                TimelineCommit {
                    commit,
                    event_boundary,
                }
            })
            .collect()
    }

    pub fn form_historical_selection(
        &self,
        request: HistoricalSelectionRequest,
    ) -> std::result::Result<HistoricalSelection, HistoricalSelectionError> {
        let current_diagnostics = self.diagnostics();
        if Self::has_errors(&current_diagnostics) {
            return Err(HistoricalSelectionError::CurrentInvalid(
                current_diagnostics,
            ));
        }
        if request.concern.trim().is_empty() {
            return Err(anyhow!("historical-selection concern must not be empty").into());
        }
        if request
            .instructions
            .iter()
            .any(|instruction| instruction.trim().is_empty())
        {
            return Err(anyhow!("historical-selection instructions must not be empty").into());
        }

        let mut requested_anchors = BTreeSet::new();
        for name in &request.anchors {
            if !requested_anchors.insert(name) {
                return Err(anyhow!("historical-selection request repeats anchor `{name}`").into());
            }
            if !self.manifest.anchors.contains_key(name) {
                return Err(anyhow!("unknown anchor `{name}`").into());
            }
        }

        let mut sources = Vec::<TemporalSource>::new();
        let mut source_indexes = BTreeMap::<(String, String), usize>::new();
        let mut exact_requests = BTreeSet::new();
        for source in &request.sources {
            if source.revision.trim().is_empty() {
                return Err(anyhow!("temporal-source revision must not be empty").into());
            }
            validate_repo_path(&source.path).map_err(|message| {
                anyhow!("invalid temporal-source path `{}`: {message}", source.path)
            })?;
            let commit = resolve_commit(&self.root, &source.revision).with_context(|| {
                format!(
                    "cannot resolve temporal-source revision `{}` for `{}`",
                    source.revision, source.path
                )
            })?;
            if !exact_requests.insert((commit.clone(), source.path.clone())) {
                return Err(anyhow!(
                    "historical-selection request repeats temporal source `{}` at `{commit}`",
                    source.path
                )
                .into());
            }
            let content = git_blob_text(&self.root, &commit, &source.path).with_context(|| {
                format!(
                    "cannot read temporal source `{}` at `{commit}`",
                    source.path
                )
            })?;
            push_temporal_source(
                &mut sources,
                &mut source_indexes,
                commit,
                source.path.clone(),
                TemporalSourceProvenance::Source {
                    requested_revision: source.revision.clone(),
                },
                content,
            );
        }

        let mut selected_anchors = Vec::new();
        for name in &request.anchors {
            let anchor = &self.manifest.anchors[name];
            selected_anchors.push(SelectedAnchor {
                name: name.clone(),
                file: self.document_path(&anchor.component).unwrap().to_owned(),
                commit: anchor.commit.clone(),
                connections: anchor.connections.clone(),
            });
            for connection in &anchor.connections {
                let content = git_blob_text(&self.root, &anchor.commit, &connection.target)
                    .with_context(|| {
                        format!(
                            "cannot read anchor `{name}` connection target `{}` at `{}`",
                            connection.target, anchor.commit
                        )
                    })?;
                push_temporal_source(
                    &mut sources,
                    &mut source_indexes,
                    anchor.commit.clone(),
                    connection.target.clone(),
                    TemporalSourceProvenance::Anchor {
                        name: name.clone(),
                        connection_type: connection.connection_type.clone(),
                    },
                    content,
                );
            }
        }

        Ok(HistoricalSelection {
            concern: request.concern,
            instructions: request.instructions,
            historical: HistoricalContext {
                selected_anchors,
                sources,
            },
            current: CurrentContext {
                region: self
                    .region_index()
                    .expect("validated historical selection has a Region index"),
            },
        })
    }

    pub fn create_anchor(
        &self,
        name: String,
        file: String,
        revision: &str,
        connections: Vec<AnchorConnection>,
        description: Option<String>,
    ) -> std::result::Result<AnchorDefinition, AnchorMutationError> {
        let _guard = lock_semantic_writer(&self.root)?;
        let current = Self::load_unlocked(self.root.clone())?;
        self.ensure_same_snapshot(&current)?;
        current.create_anchor_unlocked(name, file, revision, connections, description)
    }

    fn create_anchor_unlocked(
        &self,
        name: String,
        file: String,
        revision: &str,
        connections: Vec<AnchorConnection>,
        description: Option<String>,
    ) -> std::result::Result<AnchorDefinition, AnchorMutationError> {
        self.ensure_anchor_mutation_ready()?;
        if self.manifest.anchors.contains_key(&name) {
            return Err(anyhow!("anchor `{name}` already exists").into());
        }

        let commit = resolve_commit(&self.root, revision)
            .with_context(|| format!("cannot resolve anchor revision `{revision}`"))?;
        let component = self
            .manifest
            .components
            .iter()
            .find(|(_, c)| c.path == file)
            .map(|(id, _)| id.clone())
            .ok_or_else(|| anyhow!("`{file}` is not a registered document"))?;
        let anchor = AnchorDefinition {
            component,
            commit,
            connections,
            description,
        };
        let entry = render_anchor_entry(&name, &anchor)?;
        let updated_source =
            insert_root_mapping_entry(&self.manifest_source, "anchors", &name, &entry)
                .context("cannot edit the anchor mapping losslessly")?;

        let mut expected_manifest = self.manifest.clone();
        expected_manifest.anchors.insert(name, anchor.clone());
        self.validate_and_write_anchor_manifest(updated_source, expected_manifest)?;
        Ok(anchor)
    }

    pub fn remove_anchor(
        &self,
        name: &str,
    ) -> std::result::Result<AnchorDefinition, AnchorMutationError> {
        let _guard = lock_semantic_writer(&self.root)?;
        let current = Self::load_unlocked(self.root.clone())?;
        self.ensure_same_snapshot(&current)?;
        current.remove_anchor_unlocked(name)
    }

    fn remove_anchor_unlocked(
        &self,
        name: &str,
    ) -> std::result::Result<AnchorDefinition, AnchorMutationError> {
        self.ensure_anchor_mutation_ready()?;
        let anchor = self
            .manifest
            .anchors
            .get(name)
            .cloned()
            .ok_or_else(|| anyhow!("unknown anchor `{name}`"))?;
        let updated_source = remove_root_mapping_entry(&self.manifest_source, "anchors", name)
            .context("cannot edit the anchor mapping losslessly")?;

        let mut expected_manifest = self.manifest.clone();
        expected_manifest.anchors.remove(name);
        self.validate_and_write_anchor_manifest(updated_source, expected_manifest)?;
        Ok(anchor)
    }

    fn ensure_same_snapshot(&self, current: &Self) -> Result<()> {
        if self.snapshot.id != current.snapshot.id {
            bail!(
                "project snapshot changed after load (expected {}, found {}); reload before mutation",
                self.snapshot.id,
                current.snapshot.id
            );
        }
        Ok(())
    }

    fn ensure_anchor_mutation_ready(&self) -> std::result::Result<(), AnchorMutationError> {
        let diagnostics = self.diagnostics();
        if Self::has_errors(&diagnostics) {
            return Err(AnchorMutationError::CurrentInvalid(diagnostics));
        }
        Ok(())
    }

    fn validate_and_write_anchor_manifest(
        &self,
        updated_source: String,
        expected_manifest: Manifest,
    ) -> std::result::Result<(), AnchorMutationError> {
        let manifest = decode_manifest(&updated_source)?;
        let decoded_value = serde_json::to_value(&manifest).map_err(anyhow::Error::from)?;
        let expected_value =
            serde_json::to_value(&expected_manifest).map_err(anyhow::Error::from)?;
        if decoded_value != expected_value {
            return Err(
                anyhow!("the lossless anchor edit changed unexpected manifest data").into(),
            );
        }

        let candidate = self.candidate(&updated_source)?;
        let diagnostics = candidate.diagnostics();
        if Self::has_errors(&diagnostics) {
            return Err(AnchorMutationError::ProposedInvalid(diagnostics));
        }

        self.ensure_same_snapshot(&Self::load_unlocked(self.root.clone())?)?;
        write_carrier_atomically_if_unchanged(
            &self.root,
            MANIFEST_FILENAME,
            &self.manifest_source,
            &updated_source,
        )?;
        let committed = Self::load_unlocked(self.root.clone())?;
        let diagnostics = committed.diagnostics();
        if Self::has_errors(&diagnostics) {
            return Err(AnchorMutationError::ProposedInvalid(diagnostics));
        }
        Ok(())
    }

    fn compute_diagnostics(&self) -> Vec<Diagnostic> {
        let mut diagnostics = Vec::new();
        if !self.repository_files.contains(MANIFEST_FILENAME) {
            diagnostics.push(Diagnostic::error(
                "manifest-git-visible",
                Some(MANIFEST_FILENAME.into()),
                "manifest is not Git-visible",
            ));
        }
        for (name, value) in &self.manifest.relationship_types {
            validate_name_and_description(
                "relationship type",
                name,
                &value.description,
                &mut diagnostics,
            );
        }
        for (name, value) in &self.manifest.anchor_connection_types {
            validate_name_and_description(
                "anchor connection type",
                name,
                &value.description,
                &mut diagnostics,
            );
        }
        let mut paths = BTreeSet::new();
        for (id, registration) in self.registrations() {
            let path = &registration.path;
            let mut error = |code: &str, message: String| {
                diagnostics.push(Diagnostic::error(code, Some(path.clone()), message))
            };
            if !valid_component_id(id) {
                error("component-id", format!("invalid component identity `{id}`"));
            }
            if !paths.insert(path) {
                error(
                    "duplicate-component-path",
                    format!("more than one identity binds `{path}`"),
                );
            }
            if registration
                .description
                .as_deref()
                .is_some_and(|s| s.trim().is_empty())
            {
                error(
                    "component-description",
                    format!("`{id}` has an empty description"),
                );
            }
            if let Err(message) = validate_component_path(path) {
                error("component-path", message.into());
                continue;
            }
            let entry = self.entries.get(path).unwrap_or(&CapturedEntry::Missing);
            match entry {
                CapturedEntry::Missing => error("component-missing",format!("`{id}` binds a missing entry")),
                CapturedEntry::Symlink => error("component-symlink",format!("`{id}` traverses a symbolic link")),
                CapturedEntry::Other => error("component-kind",format!("`{id}` is neither a real directory nor a regular file, or traverses a non-directory")),
                CapturedEntry::Unreadable(message) => error("component-unreadable",message.clone()),
                CapturedEntry::Directory | CapturedEntry::File => {
                    if self.ignored.contains(path) || (*entry == CapturedEntry::File && !self.repository_files.contains(path)) { error("component-ignored",format!("`{path}` is not Git-visible")); }
                }
            }
            let document = *entry == CapturedEntry::File && path.ends_with(".md");
            if registration.index && !document {
                error(
                    "component-index",
                    format!("`{id}` is not a Markdown document"),
                );
            }
            if document {
                match self.document_sources.get(path) {
                    Some(CapturedDocument::Text(_)) => {}
                    Some(CapturedDocument::NonUtf8) => {
                        error("document-utf8", format!("`{path}` is not UTF-8"))
                    }
                    _ => error(
                        "document-unreadable",
                        format!("cannot read exact Markdown bytes for `{path}`"),
                    ),
                }
            }
        }
        for (id, history) in &self.manifest.historical_components {
            let mut error = |code: &str, message: String| {
                diagnostics.push(Diagnostic::error(
                    code,
                    Some(MANIFEST_FILENAME.into()),
                    message,
                ))
            };
            if !valid_component_id(id) {
                error(
                    "historical-component-id",
                    format!("invalid historical identity `{id}`"),
                );
            }
            if self.manifest.components.contains_key(id) {
                error(
                    "historical-component-current",
                    format!("`{id}` is also current"),
                );
            }
            if let Err(message) = validate_managed_file_path(&history.path) {
                error("historical-component-path", format!("`{id}`: {message}"));
            }
            if history
                .description
                .as_deref()
                .is_some_and(|s| s.trim().is_empty())
            {
                error(
                    "historical-component-description",
                    format!("`{id}` has an empty description"),
                );
            }
        }
        let mut seen = BTreeSet::new();
        for relation in &self.manifest.relationships {
            let mut error = |code: &str, message: String| {
                diagnostics.push(Diagnostic::error(
                    code,
                    Some(MANIFEST_FILENAME.into()),
                    message,
                ))
            };
            let mut key = relation.clone();
            if key.direction == RelationshipDirection::Bidirectional && key.source > key.target {
                std::mem::swap(&mut key.source, &mut key.target);
            }
            if !seen.insert(key) {
                error(
                    "duplicate-relationship",
                    format!(
                        "repeated relationship {} -> {}",
                        relation.source, relation.target
                    ),
                );
            }
            if relation.source == relation.target {
                error(
                    "self-relationship",
                    format!("`{}` connects to itself", relation.source),
                );
            }
            match (
                self.manifest.components.get(&relation.source),
                self.manifest.components.get(&relation.target),
            ) {
                (Some(a), Some(b)) => {
                    if a.path == "."
                        || b.path == "."
                        || directory_parent(&a.path) != directory_parent(&b.path)
                    {
                        error(
                            "relationship-scope",
                            format!(
                                "{} and {} must share their actual immediate directory parent",
                                relation.source, relation.target
                            ),
                        );
                    }
                }
                _ => error(
                    "relationship-component",
                    format!(
                        "{} and {} must both be registered identities",
                        relation.source, relation.target
                    ),
                ),
            }
            match self
                .manifest
                .relationship_types
                .get(&relation.relationship_type)
            {
                None => error(
                    "unknown-relationship-type",
                    format!("unknown type `{}`", relation.relationship_type),
                ),
                Some(def) if !direction_allowed(def.direction, relation.direction) => error(
                    "relationship-direction",
                    format!("direction violates type `{}`", relation.relationship_type),
                ),
                _ => {}
            }
        }
        let mut seen = BTreeSet::new();
        for id in &self.manifest.opening.files {
            if !seen.insert(id) {
                diagnostics.push(Diagnostic::error(
                    "duplicate-opening-file",
                    Some(MANIFEST_FILENAME.into()),
                    format!("Opening repeats `{id}`"),
                ));
            }
            if self.document_path(id).is_none() {
                diagnostics.push(Diagnostic::error(
                    "missing-opening-component",
                    Some(MANIFEST_FILENAME.into()),
                    format!("`{id}` is not a current document"),
                ));
            }
            if self.manifest.components.get(id).is_some_and(|c| c.index) {
                diagnostics.push(Diagnostic::error(
                    "opening-index-file",
                    Some(MANIFEST_FILENAME.into()),
                    format!("index `{id}` cannot be in Opening"),
                ));
            }
        }
        self.validate_events(&mut diagnostics);
        self.validate_anchors(&mut diagnostics);
        diagnostics
    }
    fn validate_events(&self, diagnostics: &mut Vec<Diagnostic>) {
        let mut names = BTreeSet::new();
        let mut open = Vec::<String>::new();
        for event in &self.manifest.evolve.events {
            let mut error = |code: &str, message: String| {
                diagnostics.push(Diagnostic::error(
                    code,
                    Some(MANIFEST_FILENAME.into()),
                    format!("Event `{}`: {message}", event.name),
                ))
            };
            if event.name.trim().is_empty() {
                error("event-name", "empty name".into());
            } else if !names.insert(&event.name) {
                error("duplicate-event", "name is repeated".into());
            }
            if event
                .description
                .as_deref()
                .is_some_and(|s| s.trim().is_empty())
            {
                error("event-description", "empty description".into());
            }
            if event.predecessors.is_empty() && event.successors.is_empty() {
                error("event-empty", "at least one side must be nonempty".into());
            }
            for (side, participants) in [
                ("predecessor", &event.predecessors),
                ("successor", &event.successors),
            ] {
                let mut seen = BTreeSet::new();
                for id in participants {
                    if !seen.insert(id) {
                        error(
                            &format!("duplicate-event-{side}"),
                            format!("repeated {side} `{id}`"),
                        );
                    }
                    if self.document_path_for_reference(id).is_none() {
                        error(
                            "event-component",
                            format!("`{id}` is not a current or historical document"),
                        );
                    }
                    if self.manifest.components.get(id).is_some_and(|c| c.index) {
                        error("event-index-path", format!("`{id}` is an index"));
                    }
                    if side == "predecessor" && !open.contains(id) {
                        error("event-predecessor-not-open", format!("`{id}` is not open"));
                    }
                    if side == "successor" && open.contains(id) && !event.predecessors.contains(id)
                    {
                        error(
                            "event-successor-already-open",
                            format!("`{id}` is already open without being carried through"),
                        );
                    }
                }
            }
            open.retain(|id| !event.predecessors.contains(id));
            for id in &event.successors {
                if !open.contains(id) {
                    open.push(id.clone());
                }
            }
        }
        if open != self.manifest.opening.files {
            diagnostics.push(Diagnostic::error(
                "event-opening-mismatch",
                Some(MANIFEST_FILENAME.into()),
                format!(
                    "ordered Event replay {open:?} does not equal opening.files {:?}",
                    self.manifest.opening.files
                ),
            ));
        }
    }
    pub fn plan_change(&self, operation: ChangeOperation) -> Result<ChangeProposal> {
        Ok(self.prepare_change(operation)?.proposal)
    }
    fn prepare_change(&self, operation: ChangeOperation) -> Result<PreparedChange> {
        self.require_valid().map_err(|d| {
            anyhow!(
                "cannot plan from invalid project: {}",
                diagnostic_messages(&d)
            )
        })?;
        let mut manifest = self.manifest.clone();
        let ChangeOperation::OpenOpeningBranch {
            component,
            file,
            description,
            relationship_parent,
            relationship_type,
            event,
            event_description,
        } = &operation;
        if !valid_component_id(component)
            || manifest.components.contains_key(component)
            || manifest.historical_components.contains_key(component)
        {
            bail!("new component identity must be valid and unused");
        }
        validate_managed_file_path(file)
            .map_err(|m| anyhow!("invalid Opening branch file: {m}"))?;
        if manifest.components.values().any(|c| c.path == *file) {
            bail!("Opening branch file is already managed");
        }
        if !manifest.opening.files.contains(relationship_parent) {
            bail!("relationship parent must be a current Opening document");
        }
        let parent = &manifest.components[relationship_parent];
        if directory_parent(file) != directory_parent(&parent.path) {
            bail!("Opening branch must share its peer's actual immediate directory");
        }
        if event_description.trim().is_empty() {
            bail!("Event description must not be empty");
        }
        manifest.components.insert(
            component.clone(),
            ComponentRegistration {
                path: file.clone(),
                description: description.clone(),
                index: false,
            },
        );
        manifest.relationships.push(StructureRelationship {
            source: component.clone(),
            target: relationship_parent.clone(),
            relationship_type: relationship_type.clone(),
            direction: RelationshipDirection::SourceToTarget,
        });
        manifest.opening.files.push(component.clone());
        // Carry the complete ordered Opening through the junction so its order
        // remains explicit and unchanged while the new branch is appended.
        manifest.evolve.events.push(EvolveEvent {
            name: event.clone(),
            description: Some(event_description.clone()),
            predecessors: self.manifest.opening.files.clone(),
            successors: manifest.opening.files.clone(),
        });
        let source = serde_norway::to_string(&manifest)?;
        let candidate = self.candidate(&source)?;
        candidate
            .require_valid()
            .map_err(|d| anyhow!("proposed change is invalid: {}", diagnostic_messages(&d)))?;
        let dependencies = vec![ChangeDependency {
            path: file.clone(),
            content: content_handle(&candidate.read_managed_document(file)?),
        }];
        let carriers = vec![CarrierPreview {
            path: MANIFEST_FILENAME.into(),
            before: content_handle(&self.manifest_source),
            after: content_handle(&source),
            diff: unified_diff(MANIFEST_FILENAME, &self.manifest_source, &source),
        }];
        let id = sha256_bytes(&serde_json::to_vec(&json_change_identity(
            &self.snapshot,
            &operation,
            &dependencies,
            &carriers,
        ))?);
        Ok(PreparedChange {
            manifest_source: source,
            proposal: ChangeProposal {
                schema: CHANGE_PROPOSAL_SCHEMA.into(),
                id,
                source: self.snapshot.clone(),
                operation,
                dependencies,
                carriers,
            },
        })
    }
    pub fn apply_change(&self, proposal: &ChangeProposal) -> Result<ChangeApplied> {
        if proposal.schema != CHANGE_PROPOSAL_SCHEMA {
            bail!("unsupported change proposal schema");
        }
        let _guard = lock_semantic_writer(&self.root)?;
        let current = Self::load_unlocked(self.root.clone())?;
        self.ensure_same_snapshot(&current)?;
        if current.snapshot != proposal.source {
            bail!("change proposal source is stale");
        }
        let prepared = current.prepare_change(proposal.operation.clone())?;
        if prepared.proposal != *proposal {
            bail!("change proposal does not match the exact re-formed proposal");
        }
        current.ensure_same_snapshot(&Self::load_unlocked(self.root.clone())?)?;
        write_carrier_atomically_if_unchanged(
            &self.root,
            MANIFEST_FILENAME,
            &current.manifest_source,
            &prepared.manifest_source,
        )?;
        let committed = Self::load_unlocked(self.root.clone())?;
        committed.require_valid().map_err(|d| {
            anyhow!(
                "committed project failed validation: {}",
                diagnostic_messages(&d)
            )
        })?;
        Ok(ChangeApplied {
            schema: CHANGE_APPLIED_SCHEMA.into(),
            proposal: proposal.id.clone(),
            source: proposal.source.clone(),
            committed: committed.snapshot.clone(),
            carriers: proposal.carriers.clone(),
        })
    }
    fn validate_anchors(&self, diagnostics: &mut Vec<Diagnostic>) {
        let mut queries = BTreeSet::new();
        for anchor in self.manifest.anchors.values() {
            if is_full_object_id(&anchor.commit) {
                queries.insert(anchor.commit.clone());
                for connection in &anchor.connections {
                    if validate_repo_path(&connection.target).is_ok() {
                        queries.insert(format!("{}:{}", anchor.commit, connection.target));
                    }
                }
            }
        }
        let observations =
            match git_object_batch_check(&self.root, &queries.into_iter().collect::<Vec<_>>()) {
                Ok(observations) => Some(observations),
                Err(error) => {
                    diagnostics.push(Diagnostic::error(
                        "anchor-git-inspection",
                        Some(MANIFEST_FILENAME.to_owned()),
                        format!("cannot inspect Anchor Git objects: {error}"),
                    ));
                    None
                }
            };
        let mut anchor_file_owners = BTreeMap::<&str, &str>::new();
        for (name, anchor) in &self.manifest.anchors {
            if let Some(first_owner) = anchor_file_owners.insert(&anchor.component, name) {
                diagnostics.push(Diagnostic::error(
                    "duplicate-anchor-file",
                    Some(MANIFEST_FILENAME.to_owned()),
                    format!(
                        "anchor `{name}` reuses current file `{}` already owned by anchor `{first_owner}`",
                        anchor.component
                    ),
                ));
            }
            self.validate_anchor(name, anchor, observations.as_ref(), diagnostics);
        }
    }

    fn validate_anchor(
        &self,
        name: &str,
        anchor: &AnchorDefinition,
        observations: Option<&BTreeMap<String, Option<GitObjectInfo>>>,
        diagnostics: &mut Vec<Diagnostic>,
    ) {
        if name.trim().is_empty() {
            diagnostics.push(Diagnostic::error(
                "anchor-name",
                Some(MANIFEST_FILENAME.to_owned()),
                "anchor name must not be empty",
            ));
        }

        if self.document_path(&anchor.component).is_none()
            || self
                .manifest
                .components
                .get(&anchor.component)
                .is_some_and(|c| c.index)
        {
            diagnostics.push(Diagnostic::error(
                "anchor-component",
                Some(MANIFEST_FILENAME.into()),
                format!("Anchor `{name}` requires a current non-index Markdown component"),
            ));
        }
        if self.manifest.opening.files.contains(&anchor.component) {
            diagnostics.push(Diagnostic::error(
                "anchor-file-opening",
                Some(MANIFEST_FILENAME.into()),
                format!("Anchor `{name}` component is also in Opening"),
            ));
        }
        if anchor
            .description
            .as_deref()
            .is_some_and(|s| s.trim().is_empty())
        {
            diagnostics.push(Diagnostic::error(
                "anchor-description",
                Some(MANIFEST_FILENAME.into()),
                format!("Anchor `{name}` has an empty description"),
            ));
        }
        let full_object_id = is_full_object_id(&anchor.commit);
        if !full_object_id {
            diagnostics.push(Diagnostic::error(
                "anchor-commit-full",
                Some(MANIFEST_FILENAME.to_owned()),
                format!(
                    "anchor `{name}` must store one full 40-character hexadecimal commit, not `{}`",
                    anchor.commit
                ),
            ));
        }
        let commit_valid = if !full_object_id {
            false
        } else if let Some(observations) = observations {
            match observations.get(&anchor.commit) {
                Some(Some(object)) if object.kind == "commit" && object.id == anchor.commit => true,
                Some(Some(object)) => {
                    diagnostics.push(Diagnostic::error(
                        "anchor-commit",
                        Some(MANIFEST_FILENAME.to_owned()),
                        format!(
                            "anchor `{name}` object `{}` resolves to {} `{}`, not the stored commit",
                            anchor.commit, object.kind, object.id
                        ),
                    ));
                    false
                }
                Some(None) | None => {
                    diagnostics.push(Diagnostic::error(
                        "anchor-commit",
                        Some(MANIFEST_FILENAME.to_owned()),
                        format!("anchor `{name}` has unresolved commit `{}`", anchor.commit),
                    ));
                    false
                }
            }
        } else {
            false
        };

        let mut seen = BTreeSet::new();
        for connection in &anchor.connections {
            if !seen.insert(connection) {
                diagnostics.push(Diagnostic::error(
                    "duplicate-anchor-connection",
                    Some(MANIFEST_FILENAME.to_owned()),
                    format!(
                        "anchor `{name}` repeats connection `{} -> {}`",
                        connection.connection_type, connection.target
                    ),
                ));
            }
            if !self
                .manifest
                .anchor_connection_types
                .contains_key(&connection.connection_type)
            {
                diagnostics.push(Diagnostic::error(
                    "unknown-anchor-connection-type",
                    Some(MANIFEST_FILENAME.to_owned()),
                    format!(
                        "anchor `{name}` uses unknown connection type `{}`",
                        connection.connection_type
                    ),
                ));
            }
            if let Err(message) = validate_repo_path(&connection.target) {
                diagnostics.push(Diagnostic::error(
                    "anchor-target-path",
                    Some(MANIFEST_FILENAME.to_owned()),
                    format!(
                        "anchor `{name}` has invalid connection target `{}`: {message}",
                        connection.target
                    ),
                ));
            } else if commit_valid {
                let query = format!("{}:{}", anchor.commit, connection.target);
                if !observations
                    .and_then(|observations| observations.get(&query))
                    .and_then(Option::as_ref)
                    .is_some_and(|object| object.kind == "blob")
                {
                    diagnostics.push(Diagnostic::error(
                        "anchor-target-missing",
                        Some(MANIFEST_FILENAME.to_owned()),
                        format!(
                            "anchor `{name}` connection target `{}` is not a file at `{}`",
                            connection.target, anchor.commit
                        ),
                    ));
                }
            }
        }
    }
}
fn diagnostic_messages(diagnostics: &[Diagnostic]) -> String {
    diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.severity == Severity::Error)
        .map(|diagnostic| format!("{}: {}", diagnostic.code, diagnostic.message))
        .collect::<Vec<_>>()
        .join("; ")
}

fn json_change_identity(
    source: &SnapshotIdentity,
    operation: &ChangeOperation,
    dependencies: &[ChangeDependency],
    carriers: &[CarrierPreview],
) -> serde_json::Value {
    serde_json::json!({
        "source": source,
        "operation": operation,
        "dependencies": dependencies,
        "carriers": carriers,
    })
}

#[derive(Clone, Copy)]
enum DiffLine<'a> {
    Equal(&'a str),
    Delete(&'a str),
    Insert(&'a str),
}

impl DiffLine<'_> {
    fn changes(self) -> bool {
        !matches!(self, Self::Equal(_))
    }

    fn old_line(self) -> bool {
        !matches!(self, Self::Insert(_))
    }

    fn new_line(self) -> bool {
        !matches!(self, Self::Delete(_))
    }
}

fn unified_diff(path: &str, before: &str, after: &str) -> String {
    if before == after {
        return String::new();
    }
    let old = before.split_inclusive('\n').collect::<Vec<_>>();
    let new = after.split_inclusive('\n').collect::<Vec<_>>();
    let operations = if old.len().saturating_mul(new.len()) <= 4_000_000 {
        line_diff(&old, &new)
    } else {
        old.iter()
            .map(|line| DiffLine::Delete(*line))
            .chain(new.iter().map(|line| DiffLine::Insert(*line)))
            .collect()
    };
    let changed = operations
        .iter()
        .enumerate()
        .filter_map(|(index, operation)| operation.changes().then_some(index))
        .collect::<Vec<_>>();
    let mut ranges = Vec::<(usize, usize)>::new();
    for index in changed {
        let start = index.saturating_sub(3);
        let end = (index + 4).min(operations.len());
        if let Some((_, previous_end)) = ranges.last_mut() {
            if start <= *previous_end {
                *previous_end = (*previous_end).max(end);
                continue;
            }
        }
        ranges.push((start, end));
    }

    let mut output = format!("--- a/{path}\n+++ b/{path}\n");
    for (start, end) in ranges {
        let old_start = 1 + operations[..start]
            .iter()
            .filter(|operation| operation.old_line())
            .count();
        let new_start = 1 + operations[..start]
            .iter()
            .filter(|operation| operation.new_line())
            .count();
        let old_count = operations[start..end]
            .iter()
            .filter(|operation| operation.old_line())
            .count();
        let new_count = operations[start..end]
            .iter()
            .filter(|operation| operation.new_line())
            .count();
        output.push_str(&format!(
            "@@ -{old_start},{old_count} +{new_start},{new_count} @@\n"
        ));
        for operation in &operations[start..end] {
            let (prefix, line) = match operation {
                DiffLine::Equal(line) => (' ', *line),
                DiffLine::Delete(line) => ('-', *line),
                DiffLine::Insert(line) => ('+', *line),
            };
            output.push(prefix);
            output.push_str(line);
            if !line.ends_with('\n') {
                output.push('\n');
                output.push_str("\\ No newline at end of file\n");
            }
        }
    }
    output
}

fn line_diff<'a>(old: &[&'a str], new: &[&'a str]) -> Vec<DiffLine<'a>> {
    let width = new.len() + 1;
    let mut lengths = vec![0_u32; (old.len() + 1) * width];
    for old_index in (0..old.len()).rev() {
        for new_index in (0..new.len()).rev() {
            let index = old_index * width + new_index;
            lengths[index] = if old[old_index] == new[new_index] {
                1 + lengths[(old_index + 1) * width + new_index + 1]
            } else {
                lengths[(old_index + 1) * width + new_index]
                    .max(lengths[old_index * width + new_index + 1])
            };
        }
    }
    let mut operations = Vec::new();
    let (mut old_index, mut new_index) = (0, 0);
    while old_index < old.len() && new_index < new.len() {
        if old[old_index] == new[new_index] {
            operations.push(DiffLine::Equal(old[old_index]));
            old_index += 1;
            new_index += 1;
        } else if lengths[(old_index + 1) * width + new_index]
            >= lengths[old_index * width + new_index + 1]
        {
            operations.push(DiffLine::Delete(old[old_index]));
            old_index += 1;
        } else {
            operations.push(DiffLine::Insert(new[new_index]));
            new_index += 1;
        }
    }
    operations.extend(old[old_index..].iter().map(|line| DiffLine::Delete(*line)));
    operations.extend(new[new_index..].iter().map(|line| DiffLine::Insert(*line)));
    operations
}

struct SemanticLockGuard {
    lock: File,
}

impl Drop for SemanticLockGuard {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.lock);
    }
}

fn open_semantic_lock(root: &Path) -> Result<(PathBuf, File)> {
    let path = semantic_git_path(root, "mindflow/semantic-write.lock")?;
    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("semantic write lock has no parent directory"))?;
    fs::create_dir_all(parent).with_context(|| {
        format!(
            "cannot create semantic write lock directory `{}`",
            parent.display()
        )
    })?;
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(&path)
        .with_context(|| format!("cannot open semantic write lock `{}`", path.display()))?;
    Ok((path, lock))
}

fn lock_semantic_reader(root: &Path) -> Result<SemanticLockGuard> {
    let (path, lock) = open_semantic_lock(root)?;
    FileExt::lock_shared(&lock)
        .with_context(|| format!("cannot acquire semantic read lock `{}`", path.display()))?;
    Ok(SemanticLockGuard { lock })
}

fn lock_semantic_writer(root: &Path) -> Result<SemanticLockGuard> {
    let (path, lock) = open_semantic_lock(root)?;
    FileExt::lock_exclusive(&lock)
        .with_context(|| format!("cannot acquire semantic write lock `{}`", path.display()))?;
    Ok(SemanticLockGuard { lock })
}

fn semantic_git_path(root: &Path, relative: &str) -> Result<PathBuf> {
    let git_path = git_output(root, &["rev-parse", "--git-path", relative])?;
    let requested = PathBuf::from(git_path.trim());
    Ok(if requested.is_absolute() {
        requested
    } else {
        root.join(requested)
    })
}

fn sync_directory(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        File::open(path)
            .with_context(|| format!("cannot open directory `{}` for sync", path.display()))?
            .sync_all()
            .with_context(|| format!("cannot sync directory `{}`", path.display()))?;
    }
    Ok(())
}

fn write_carrier_atomically_if_unchanged(
    root: &Path,
    relative: &str,
    expected: &str,
    updated: &str,
) -> Result<()> {
    validate_repo_path(relative)
        .map_err(|message| anyhow!("invalid carrier path `{relative}`: {message}"))?;
    let path = root.join(relative);
    let current = required_regular_text(root, relative)
        .with_context(|| format!("cannot reread `{relative}` before mutation"))?;
    if current != expected {
        bail!(
            "`{}` changed after the project was loaded; reload before writing",
            path.display()
        );
    }

    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("`{}` has no parent directory", path.display()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow!("`{}` has no UTF-8 file name", path.display()))?;
    let metadata = fs::symlink_metadata(&path)
        .with_context(|| format!("cannot inspect `{}` before mutation", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!("carrier `{relative}` must remain a regular non-symbolic-link file");
    }
    let permissions = metadata.permissions();

    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);
    let mut temporary_path = None;
    let mut temporary_file = None;
    for _ in 0..100 {
        let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(
            ".{file_name}.mindflow-{}-{sequence}.tmp",
            std::process::id()
        ));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => {
                temporary_path = Some(candidate);
                temporary_file = Some(file);
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(error).with_context(|| {
                    format!("cannot create an atomic sibling for `{}`", path.display())
                });
            }
        }
    }

    let temporary_path = temporary_path
        .ok_or_else(|| anyhow!("cannot allocate an atomic sibling for `{}`", path.display()))?;
    let mut temporary_file = temporary_file.expect("temporary path and file are set together");
    let write_result = (|| -> Result<()> {
        temporary_file
            .set_permissions(permissions)
            .with_context(|| format!("cannot preserve permissions for `{}`", path.display()))?;
        temporary_file
            .write_all(updated.as_bytes())
            .with_context(|| format!("cannot write atomic update for `{}`", path.display()))?;
        temporary_file
            .sync_all()
            .with_context(|| format!("cannot sync atomic update for `{}`", path.display()))?;
        drop(temporary_file);

        let latest = required_regular_text(root, relative)
            .with_context(|| format!("cannot recheck `{relative}` before replacement"))?;
        if latest != expected {
            bail!(
                "`{}` changed while the update was prepared; no mutation was written",
                path.display()
            );
        }

        fs::rename(&temporary_path, &path)
            .with_context(|| format!("cannot atomically replace `{}`", path.display()))?;
        sync_directory(parent)?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    write_result
}

fn push_temporal_source(
    sources: &mut Vec<TemporalSource>,
    indexes: &mut BTreeMap<(String, String), usize>,
    commit: String,
    path: String,
    provenance: TemporalSourceProvenance,
    content: String,
) {
    let key = (commit.clone(), path.clone());
    if let Some(index) = indexes.get(&key).copied() {
        sources[index].provenance.push(provenance);
        return;
    }

    indexes.insert(key, sources.len());
    sources.push(TemporalSource {
        commit,
        path,
        provenance: vec![provenance],
        content,
    });
}

fn hash_snapshot_field(hasher: &mut Sha256, value: &[u8]) {
    hasher.update((value.len() as u64).to_be_bytes());
    hasher.update(value);
}

fn sha256_bytes(value: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(value))
}

fn content_handle(content: &str) -> ContentHandle {
    ContentHandle {
        sha256: sha256_bytes(content.as_bytes()),
        bytes: content.len(),
    }
}

fn required_regular_text(root: &Path, path: &str) -> Result<String> {
    match capture_regular_text(root, path, false) {
        CapturedDocument::Text(content) => Ok(content),
        CapturedDocument::InvalidPath(message) => {
            bail!("invalid carrier path `{path}`: {message}")
        }
        CapturedDocument::Missing => bail!("required carrier `{path}` does not exist"),
        CapturedDocument::Symlink => bail!("required carrier `{path}` must not be a symbolic link"),
        CapturedDocument::NotRegular => bail!("required carrier `{path}` is not a regular file"),
        CapturedDocument::Unreadable(message) => bail!("cannot read carrier `{path}`: {message}"),
        CapturedDocument::NonUtf8 => bail!("required carrier `{path}` is not valid UTF-8"),
    }
}

fn capture_regular_text(root: &Path, path: &str, managed: bool) -> CapturedDocument {
    let validation = if managed {
        validate_managed_file_path(path)
    } else {
        validate_repo_path(path)
    };
    if let Err(message) = validation {
        return CapturedDocument::InvalidPath(message.to_owned());
    }

    #[cfg(unix)]
    {
        return capture_regular_text_unix(root, path);
    }

    #[cfg(not(unix))]
    capture_regular_text_portable(root, path)
}

#[cfg(unix)]
fn capture_regular_text_unix(root: &Path, path: &str) -> CapturedDocument {
    let mut root_options = OpenOptions::new();
    root_options
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC);
    let mut current = match root_options.open(root) {
        Ok(directory) => directory,
        Err(error) => return captured_open_error(error),
    };
    let mut components = Path::new(path).components().peekable();
    while let Some(component) = components.next() {
        let Component::Normal(component) = component else {
            return CapturedDocument::InvalidPath(
                "path contains a non-normal component".to_owned(),
            );
        };
        let name = match CString::new(component.as_bytes()) {
            Ok(name) => name,
            Err(_) => {
                return CapturedDocument::InvalidPath("path contains a null byte".to_owned());
            }
        };
        let final_component = components.peek().is_none();
        let mut flags = libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC;
        if !final_component {
            flags |= libc::O_DIRECTORY;
        }
        // SAFETY: `current` is an open directory descriptor, `name` is a
        // NUL-terminated single path component, and a successful descriptor
        // is immediately owned by `File` exactly once.
        let descriptor = unsafe { libc::openat(current.as_raw_fd(), name.as_ptr(), flags) };
        if descriptor < 0 {
            return captured_openat_error(
                current.as_raw_fd(),
                &name,
                std::io::Error::last_os_error(),
            );
        }
        // SAFETY: `openat` returned a new owned descriptor above.
        current = unsafe { File::from_raw_fd(descriptor) };
    }

    match current.metadata() {
        Ok(metadata) if metadata.is_file() => {}
        Ok(_) => return CapturedDocument::NotRegular,
        Err(error) => return CapturedDocument::Unreadable(error.to_string()),
    }
    captured_utf8(current)
}

#[cfg(unix)]
fn captured_open_error(error: std::io::Error) -> CapturedDocument {
    match error.raw_os_error() {
        Some(libc::ENOENT) => CapturedDocument::Missing,
        Some(libc::ELOOP) => CapturedDocument::Symlink,
        Some(libc::ENOTDIR) | Some(libc::EISDIR) => CapturedDocument::NotRegular,
        _ => CapturedDocument::Unreadable(error.to_string()),
    }
}

#[cfg(unix)]
fn captured_openat_error(
    parent: std::os::fd::RawFd,
    name: &CString,
    error: std::io::Error,
) -> CapturedDocument {
    if error.raw_os_error() == Some(libc::ENOTDIR) {
        // macOS reports ENOTDIR for an intermediate symbolic link opened with
        // O_DIRECTORY | O_NOFOLLOW. This no-follow observation refines the
        // diagnostic; the descriptor-relative open remains the safety gate.
        // SAFETY: `parent` and `name` are the same valid values passed to
        // `openat`; `status` points to initialized writable storage.
        let mut status = unsafe { std::mem::zeroed::<libc::stat>() };
        let observed = unsafe {
            libc::fstatat(
                parent,
                name.as_ptr(),
                &mut status,
                libc::AT_SYMLINK_NOFOLLOW,
            )
        };
        if observed == 0 && (status.st_mode & libc::S_IFMT) == libc::S_IFLNK {
            return CapturedDocument::Symlink;
        }
    }
    captured_open_error(error)
}

#[cfg(not(unix))]
fn capture_regular_text_portable(root: &Path, path: &str) -> CapturedDocument {
    let relative = Path::new(path);
    let mut current = root.to_path_buf();
    let components = relative.components().collect::<Vec<_>>();
    for (index, component) in components.iter().enumerate() {
        let Component::Normal(component) = component else {
            return CapturedDocument::InvalidPath(
                "path contains a non-normal component".to_owned(),
            );
        };
        current.push(component);
        let metadata = match fs::symlink_metadata(&current) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return CapturedDocument::Missing;
            }
            Err(error) => return CapturedDocument::Unreadable(error.to_string()),
        };
        if metadata.file_type().is_symlink() {
            return CapturedDocument::Symlink;
        }
        let final_component = index + 1 == components.len();
        if (final_component && !metadata.is_file()) || (!final_component && !metadata.is_dir()) {
            return CapturedDocument::NotRegular;
        }
    }

    let file = match OpenOptions::new().read(true).open(&current) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return CapturedDocument::Missing;
        }
        Err(error) => return CapturedDocument::Unreadable(error.to_string()),
    };
    match file.metadata() {
        Ok(metadata) if metadata.is_file() => {}
        Ok(_) => return CapturedDocument::NotRegular,
        Err(error) => return CapturedDocument::Unreadable(error.to_string()),
    }
    match current.canonicalize() {
        Ok(canonical) if canonical.starts_with(root) => {}
        Ok(_) => return CapturedDocument::Symlink,
        Err(error) => return CapturedDocument::Unreadable(error.to_string()),
    }

    captured_utf8(file)
}

fn captured_utf8(mut file: File) -> CapturedDocument {
    let mut bytes = Vec::new();
    if let Err(error) = file.read_to_end(&mut bytes) {
        return CapturedDocument::Unreadable(error.to_string());
    }
    match String::from_utf8(bytes) {
        Ok(content) => CapturedDocument::Text(content),
        Err(_) => CapturedDocument::NonUtf8,
    }
}

fn exact_event_prefix_boundary(
    current: &[crate::model::EvolveEvent],
    historical: &[crate::model::EvolveEvent],
) -> Option<usize> {
    (historical.len() <= current.len()
        && historical
            .iter()
            .zip(current)
            .all(|(historical, current)| historical == current))
    .then_some(historical.len())
}

fn exact_event_name_prefix_boundary(
    current: &[crate::model::EvolveEvent],
    historical: &[crate::model::EvolveEvent],
) -> Option<usize> {
    (historical.len() <= current.len()
        && historical
            .iter()
            .zip(current)
            .all(|(historical, current)| historical.name == current.name))
    .then_some(historical.len())
}

fn direction_allowed(constraint: DirectionConstraint, direction: RelationshipDirection) -> bool {
    match constraint {
        DirectionConstraint::Directional => direction == RelationshipDirection::SourceToTarget,
        DirectionConstraint::Bidirectional => direction == RelationshipDirection::Bidirectional,
        DirectionConstraint::Either => true,
    }
}

fn validate_name_and_description(
    kind: &str,
    name: &str,
    description: &str,
    diagnostics: &mut Vec<Diagnostic>,
) {
    if name.trim().is_empty() {
        diagnostics.push(Diagnostic::error(
            "glossary-name",
            Some(MANIFEST_FILENAME.to_owned()),
            format!("{kind} name must not be empty"),
        ));
    }
    if description.trim().is_empty() {
        diagnostics.push(Diagnostic::error(
            "glossary-description",
            Some(MANIFEST_FILENAME.to_owned()),
            format!("{kind} `{name}` must have a description"),
        ));
    }
}

fn valid_component_id(id: &str) -> bool {
    let mut characters = id.chars();
    characters
        .next()
        .is_some_and(|character| character.is_ascii_alphabetic())
        && characters.all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
}

fn validate_managed_file_path(path: &str) -> std::result::Result<(), &'static str> {
    validate_component_path(path)?;
    if !path.ends_with(".md") {
        return Err("managed files must have a `.md` suffix");
    }
    Ok(())
}

fn directory_parent(path: &str) -> &str {
    path.rsplit_once('/').map_or(".", |(parent, _)| parent)
}

fn validate_repo_path(path: &str) -> std::result::Result<(), &'static str> {
    if path.is_empty() {
        return Err("path is empty");
    }
    if path.contains('\\') {
        return Err("paths use POSIX `/` separators");
    }
    if path.chars().any(char::is_control) {
        return Err("paths cannot contain control characters");
    }
    if Path::new(path).is_absolute() {
        return Err("absolute paths are not portable");
    }
    if path.starts_with('/') || path.ends_with('/') || path.contains("//") {
        return Err("path is not normalized");
    }
    if Path::new(path)
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("path contains `.` or `..` components");
    }
    if path
        .split('/')
        .any(|component| matches!(component, ".git" | "." | ".."))
    {
        return Err("paths cannot enter `.git`");
    }
    Ok(())
}

fn ensure_git_worktree(root: &Path) -> Result<()> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .context("failed to execute Git")?;
    if !output.status.success() || String::from_utf8_lossy(&output.stdout).trim() != "true" {
        let detail = String::from_utf8_lossy(&output.stderr);
        let detail = detail.trim();
        if detail.is_empty() {
            bail!(
                "cannot initialize `{}` because it is not inside a Git worktree",
                root.display()
            );
        }
        bail!(
            "cannot initialize `{}` because it is not inside a Git worktree: {detail}",
            root.display()
        );
    }
    Ok(())
}

fn git_path_is_ignored(root: &Path, path: &str) -> Result<bool> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["check-ignore", "--quiet", "--no-index", "--", path])
        .output()
        .context("failed to execute Git")?;
    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => bail!(
            "cannot inspect Git visibility for `{path}`: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ),
    }
}

fn write_initialization_sibling(destination: &Path, content: &str) -> Result<PathBuf> {
    let parent = destination
        .parent()
        .ok_or_else(|| anyhow!("`{}` has no parent directory", destination.display()))?;
    let file_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow!("`{}` has no UTF-8 file name", destination.display()))?;

    static INIT_TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);
    for _ in 0..100 {
        let sequence = INIT_TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let temporary_path = parent.join(format!(
            ".{file_name}.mindflow-init-{}-{sequence}.tmp",
            std::process::id()
        ));
        let mut temporary_file = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(error).with_context(|| {
                    format!(
                        "cannot prepare initialized carrier `{}`",
                        destination.display()
                    )
                });
            }
        };
        let write_result = (|| -> Result<()> {
            temporary_file
                .write_all(content.as_bytes())
                .with_context(|| {
                    format!(
                        "cannot write initialized carrier `{}`",
                        destination.display()
                    )
                })?;
            temporary_file.sync_all().with_context(|| {
                format!(
                    "cannot sync initialized carrier `{}`",
                    destination.display()
                )
            })?;
            Ok(())
        })();
        if let Err(error) = write_result {
            drop(temporary_file);
            let _ = fs::remove_file(&temporary_path);
            return Err(error);
        }
        drop(temporary_file);
        return Ok(temporary_path);
    }

    bail!(
        "cannot allocate a temporary sibling for `{}`",
        destination.display()
    )
}

fn git_worktree_files(root: &Path) -> Result<BTreeSet<String>> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args([
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ])
        .output()
        .context("failed to execute Git")?;
    if !output.status.success() {
        bail!(
            "cannot enumerate project files through Git: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }

    output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|bytes| !bytes.is_empty())
        .map(|bytes| {
            String::from_utf8(bytes.to_vec()).context("repository path is not valid UTF-8")
        })
        .collect()
}

fn is_full_object_id(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn git_batch_output(
    root: &Path,
    mode: &str,
    queries: impl Iterator<Item = String> + Send,
) -> Result<Output> {
    let mut child = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["cat-file", mode])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("failed to execute Git object batch inspection")?;
    let mut stdin = child
        .stdin
        .take()
        .context("failed to open Git object batch input")?;

    // Git can fill stdout before it has consumed all queries. Feed stdin while
    // wait_with_output drains both output pipes, then reap and join on every path.
    std::thread::scope(|scope| {
        let writer = scope.spawn(move || -> std::io::Result<()> {
            for query in queries {
                writeln!(stdin, "{query}")?;
            }
            Ok(())
        });
        let output = child.wait_with_output();
        let written = writer.join();
        let output = output.context("failed to read Git object batch inspection")?;
        if !output.status.success() {
            bail!("{}", String::from_utf8_lossy(&output.stderr).trim());
        }
        written
            .map_err(|_| anyhow!("Git object batch input worker failed"))?
            .context("failed to query Git objects")?;
        Ok(output)
    })
}

fn git_object_batch_check(
    root: &Path,
    queries: &[String],
) -> Result<BTreeMap<String, Option<GitObjectInfo>>> {
    if queries.is_empty() {
        return Ok(BTreeMap::new());
    }
    let output = git_batch_output(
        root,
        "--batch-check=%(objectname) %(objecttype)",
        queries.iter().cloned(),
    )?;
    let stdout = String::from_utf8(output.stdout).context("Git object output is not UTF-8")?;
    let lines = stdout.lines().collect::<Vec<_>>();
    if lines.len() != queries.len() {
        bail!(
            "Git object batch returned {} records for {} queries",
            lines.len(),
            queries.len()
        );
    }
    queries
        .iter()
        .zip(lines)
        .map(|(query, line)| {
            if line.ends_with(" missing") {
                return Ok((query.clone(), None));
            }
            let mut fields = line.split_whitespace();
            let id = fields
                .next()
                .ok_or_else(|| anyhow!("Git object result is missing its identity"))?;
            let kind = fields
                .next()
                .ok_or_else(|| anyhow!("Git object result is missing its type"))?;
            if fields.next().is_some() {
                bail!("Git object result has unexpected fields: `{line}`");
            }
            Ok((
                query.clone(),
                Some(GitObjectInfo {
                    id: id.to_owned(),
                    kind: kind.to_owned(),
                }),
            ))
        })
        .collect()
}

fn resolve_commit(root: &Path, revision: &str) -> Result<String> {
    let expression = format!("{revision}^{{commit}}");
    let resolved = git_output(
        root,
        &["rev-parse", "--verify", "--end-of-options", &expression],
    )?;
    Ok(resolved.trim().to_owned())
}

fn git_blob_texts(root: &Path, commits: &[String], path: &str) -> Result<Vec<Option<String>>> {
    if commits.is_empty() {
        return Ok(Vec::new());
    }

    let output = git_batch_output(
        root,
        "--batch",
        commits.iter().map(|commit| format!("{commit}:{path}")),
    )?;

    let mut reader = BufReader::new(Cursor::new(output.stdout));
    let mut contents = Vec::with_capacity(commits.len());
    for commit in commits {
        let mut header = String::new();
        if reader.read_line(&mut header)? == 0 {
            bail!("Git omitted `{path}` history at `{commit}`");
        }
        let header = header.trim_end_matches(['\r', '\n']);
        if header.ends_with(" missing") {
            contents.push(None);
            continue;
        }
        let mut fields = header.split_whitespace();
        let _object = fields.next();
        let kind = fields.next();
        let size = fields.next().and_then(|field| field.parse::<usize>().ok());
        if kind != Some("blob") || size.is_none() || fields.next().is_some() {
            bail!("Git returned an invalid `{path}` object header at `{commit}`");
        }

        let mut bytes = vec![0; size.unwrap_or_default()];
        reader.read_exact(&mut bytes)?;
        let mut delimiter = [0_u8; 1];
        reader.read_exact(&mut delimiter)?;
        if delimiter[0] != b'\n' {
            bail!("Git returned an invalid `{path}` object boundary at `{commit}`");
        }
        contents.push(Some(String::from_utf8(bytes).with_context(|| {
            format!("Git source `{path}` at `{commit}` is not valid UTF-8")
        })?));
    }
    Ok(contents)
}

fn git_blob_text(root: &Path, commit: &str, path: &str) -> Result<String> {
    let object = format!("{commit}:{path}");
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["cat-file", "blob", &object])
        .output()
        .context("failed to execute Git")?;
    if !output.status.success() {
        bail!("{}", String::from_utf8_lossy(&output.stderr).trim());
    }
    String::from_utf8(output.stdout)
        .with_context(|| format!("Git source `{path}` at `{commit}` is not valid UTF-8"))
}

fn git_output(root: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .context("failed to execute Git")?;
    if !output.status.success() {
        bail!("{}", String::from_utf8_lossy(&output.stderr).trim());
    }
    String::from_utf8(output.stdout).context("Git output is not valid UTF-8")
}

fn decode_historical_events(content: &str, _commit: &str) -> Result<Vec<EvolveEvent>> {
    Ok(decode_manifest(content)?.evolve.events)
}
fn historical_events(root: &Path, commit: &str) -> Result<Vec<EvolveEvent>> {
    decode_historical_events(&git_blob_text(root, commit, MANIFEST_FILENAME)?, commit)
}
fn render_anchor_entry(name: &str, anchor: &AnchorDefinition) -> Result<String> {
    let entry = serde_norway::to_string(&BTreeMap::from([(name, anchor)]))?;
    Ok(entry.lines().map(|line| format!("  {line}\n")).collect())
}
fn decode_manifest(content: &str) -> Result<Manifest> {
    validate_restricted_yaml(content).context("MINDFLOW.yaml uses unsupported YAML")?;
    let header: ManifestHeader =
        serde_norway::from_str(content).context("cannot decode MINDFLOW.yaml format header")?;
    if header.format.as_str() != Some(CURRENT_FORMAT) {
        let found = serde_norway::to_string(&header.format)?;
        bail!("unsupported MINDFLOW.yaml format {}; expected \"{CURRENT_FORMAT}\"; adoption requires an explicit manual update", found.trim());
    }
    let manifest: Manifest = serde_norway::from_str(content)
        .with_context(|| format!("cannot decode MINDFLOW.yaml project format {CURRENT_FORMAT}"))?;
    if let Some(release) = &manifest.adopted_release {
        if !crate::version::is_calendar_release(release) {
            bail!("adopted-release must be a calendar release in YYYY.M.D form");
        }
    }
    Ok(manifest)
}
fn validate_component_path(path: &str) -> std::result::Result<(), &'static str> {
    if path == "." {
        return Ok(());
    }
    validate_repo_path(path)?;
    if path
        .chars()
        .any(|ch| matches!(ch, '*' | '?' | '[' | ']' | '{' | '}'))
    {
        return Err("component bindings cannot contain glob metacharacters");
    }
    Ok(())
}
fn capture_project(root: &Path, source: Option<&str>) -> Result<ProjectCapture> {
    let manifest_source = match source {
        Some(source) => source.to_owned(),
        None => required_regular_text(root, MANIFEST_FILENAME)?,
    };
    let manifest = decode_manifest(&manifest_source)?;
    let mut paths = BTreeSet::from([".".to_owned()]);
    for registration in manifest.components.values() {
        if validate_component_path(&registration.path).is_err() {
            continue;
        }
        let mut path = registration.path.as_str();
        paths.insert(path.to_owned());
        while path != "." {
            path = directory_parent(path);
            paths.insert(path.to_owned());
        }
    }
    let entries = paths
        .iter()
        .map(|path| (path.clone(), capture_entry(root, path)))
        .collect::<BTreeMap<_, _>>();
    let repository_files = git_worktree_files(root)?;
    let mut ignored = BTreeSet::new();
    // Batch directory checks; file visibility is already captured by ls-files.
    let directories = entries
        .iter()
        .filter(|(_, entry)| **entry == CapturedEntry::Directory)
        .map(|(path, _)| path)
        .collect::<Vec<_>>();
    if !directories.is_empty() {
        let mut child = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(["check-ignore", "-z", "--stdin"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;
        {
            let mut input = child.stdin.take().unwrap();
            for path in directories {
                input.write_all(path.as_bytes())?;
                input.write_all(&[0])?;
            }
        }
        let output = child.wait_with_output()?;
        if !matches!(output.status.code(), Some(0 | 1)) {
            bail!(
                "cannot inspect ignored directories: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        for path in output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|p| !p.is_empty())
        {
            ignored.insert(String::from_utf8(path.to_vec())?);
        }
    }
    let document_sources = manifest
        .components
        .values()
        .filter(|c| {
            c.path.ends_with(".md") && entries.get(&c.path) != Some(&CapturedEntry::Directory)
        })
        .map(|c| (c.path.clone(), capture_regular_text(root, &c.path, true)))
        .collect();
    let head = git_output(root, &["rev-parse", "--verify", "HEAD"])
        .ok()
        .map(|s| s.trim().to_owned());
    Ok(ProjectCapture {
        manifest,
        manifest_source,
        repository_files,
        entries,
        ignored,
        document_sources,
        head,
    })
}
#[cfg(unix)]
fn directory_contains_exact_name(directory: &File, name: &CStr) -> std::io::Result<bool> {
    // A case-insensitive filesystem may resolve a differently spelled binding.
    // Enumerate the already-open directory, so names stay exact without following
    // a path that could have been replaced by a symlink.
    let descriptor = unsafe { libc::dup(directory.as_raw_fd()) };
    if descriptor < 0 {
        return Err(std::io::Error::last_os_error());
    }
    let stream = unsafe { libc::fdopendir(descriptor) };
    if stream.is_null() {
        let error = std::io::Error::last_os_error();
        unsafe { libc::close(descriptor) };
        return Err(error);
    }
    let found = loop {
        let entry = unsafe { libc::readdir(stream) };
        if entry.is_null() {
            break false;
        }
        if unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) } == name {
            break true;
        }
    };
    unsafe { libc::closedir(stream) };
    Ok(found)
}

#[cfg(unix)]
fn capture_entry(root: &Path, path: &str) -> CapturedEntry {
    let root_file = match OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_DIRECTORY)
        .open(root)
    {
        Ok(file) => file,
        Err(error) => return CapturedEntry::Unreadable(error.to_string()),
    };
    if path == "." {
        return CapturedEntry::Directory;
    }
    let mut parent = root_file;
    let parts = path.split('/').collect::<Vec<_>>();
    for (i, part) in parts.iter().enumerate() {
        let name = match CString::new(*part) {
            Ok(name) => name,
            Err(_) => return CapturedEntry::Other,
        };
        match directory_contains_exact_name(&parent, &name) {
            Ok(true) => {}
            Ok(false) => return CapturedEntry::Missing,
            Err(error) => return CapturedEntry::Unreadable(error.to_string()),
        }
        let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
        // Inspect the link itself. openat below independently prohibits following
        // a replacement symlink between this observation and the descriptor open.
        if unsafe {
            libc::fstatat(
                parent.as_raw_fd(),
                name.as_ptr(),
                stat.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } != 0
        {
            let error = std::io::Error::last_os_error();
            return if error.kind() == std::io::ErrorKind::NotFound {
                CapturedEntry::Missing
            } else {
                CapturedEntry::Unreadable(error.to_string())
            };
        }
        let stat = unsafe { stat.assume_init() };
        let kind = stat.st_mode & libc::S_IFMT;
        if kind == libc::S_IFLNK {
            return CapturedEntry::Symlink;
        }
        if kind != libc::S_IFDIR && kind != libc::S_IFREG {
            return CapturedEntry::Other;
        }
        let final_part = i + 1 == parts.len();
        if !final_part && kind != libc::S_IFDIR {
            return CapturedEntry::Other;
        }
        let flags = libc::O_RDONLY
            | libc::O_NOFOLLOW
            | libc::O_NONBLOCK
            | libc::O_CLOEXEC
            | if !final_part { libc::O_DIRECTORY } else { 0 };
        let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags) };
        if fd < 0 {
            let error = std::io::Error::last_os_error();
            return if error.raw_os_error() == Some(libc::ELOOP) {
                CapturedEntry::Symlink
            } else if error.kind() == std::io::ErrorKind::NotFound {
                CapturedEntry::Missing
            } else {
                CapturedEntry::Unreadable(error.to_string())
            };
        }
        parent = unsafe { File::from_raw_fd(fd) };
        if final_part {
            return match parent.metadata() {
                Ok(meta) if meta.is_dir() => CapturedEntry::Directory,
                Ok(meta) if meta.is_file() => CapturedEntry::File,
                Ok(_) => CapturedEntry::Other,
                Err(error) => CapturedEntry::Unreadable(error.to_string()),
            };
        }
    }
    CapturedEntry::Other
}
#[cfg(not(unix))]
fn capture_entry(root: &Path, path: &str) -> CapturedEntry {
    if path == "." {
        return CapturedEntry::Directory;
    }
    let mut current = root.to_owned();
    for (i, part) in path.split('/').enumerate() {
        match fs::read_dir(&current).and_then(|entries| {
            for entry in entries {
                if entry?.file_name() == part {
                    return Ok(true);
                }
            }
            Ok(false)
        }) {
            Ok(true) => {}
            Ok(false) => return CapturedEntry::Missing,
            Err(error) => return CapturedEntry::Unreadable(error.to_string()),
        }
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(meta) if meta.file_type().is_symlink() => return CapturedEntry::Symlink,
            Ok(meta) if meta.is_dir() => {}
            Ok(meta) if meta.is_file() && i + 1 == path.split('/').count() => {
                return CapturedEntry::File
            }
            Ok(_) => return CapturedEntry::Other,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return CapturedEntry::Missing,
            Err(e) => return CapturedEntry::Unreadable(e.to_string()),
        }
    }
    CapturedEntry::Directory
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    const HISTORY_SIZE: usize = 10_000;
    const HISTORY_TEST_ROOT: &str = "MINDFLOW_HISTORY_BATCH_TEST_ROOT";

    struct HistoryFixture(PathBuf);

    impl Drop for HistoryFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn history_manifest(index: usize) -> String {
        format!("{EMPTY_MANIFEST_SOURCE}# History revision {index}\n")
    }

    fn verify_large_history(root: PathBuf) {
        let commits = git_output(&root, &["rev-list", "--reverse", "HEAD"])
            .unwrap()
            .lines()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        assert_eq!(commits.len(), HISTORY_SIZE);

        let mut queries = commits.clone();
        queries.push("missing-history-object".to_owned());
        let objects = git_object_batch_check(&root, &queries).unwrap();
        for commit in &commits {
            let object = objects[commit].as_ref().unwrap();
            assert_eq!(&object.id, commit);
            assert_eq!(object.kind, "commit");
        }
        assert!(objects["missing-history-object"].is_none());

        let blobs = git_blob_texts(&root, &commits, MANIFEST_FILENAME).unwrap();
        assert_eq!(blobs.len(), HISTORY_SIZE);
        for (index, blob) in blobs.iter().enumerate() {
            assert_eq!(blob.as_deref(), Some(history_manifest(index).as_str()));
        }
        assert_eq!(
            git_blob_texts(&root, &commits[..1], "absent.md").unwrap(),
            [None]
        );

        let project = Project::load(root).unwrap();
        assert!(project.status().valid);
        let timeline = project.timeline_commits();
        assert_eq!(timeline.len(), HISTORY_SIZE);
        for (entry, commit) in timeline.iter().zip(&commits) {
            assert_eq!(&entry.commit, commit);
            assert_eq!(entry.event_boundary, Some(0));
        }
    }

    #[test]
    fn long_git_history_batches_complete() {
        if let Some(root) = std::env::var_os(HISTORY_TEST_ROOT) {
            verify_large_history(PathBuf::from(root));
            return;
        }

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let fixture = HistoryFixture(std::env::temp_dir().join(format!(
            "mindflow-history-batch-{}-{nonce}",
            std::process::id()
        )));
        fs::create_dir(&fixture.0).unwrap();
        git_output(&fixture.0, &["init", "--quiet"]).unwrap();

        // Fast-import creates ordinary committed history without thousands of
        // process launches. File-backed input cannot itself block on Git output.
        let stream_path = fixture.0.join(".git/history-import");
        let mut stream = File::create(&stream_path).unwrap();
        for index in 0..HISTORY_SIZE {
            let manifest = history_manifest(index);
            let message = format!("Revision {index}");
            writeln!(stream,
                "commit refs/heads/history\ncommitter Mindflow Test <history@example.invalid> {} +0000\ndata {}\n{message}\nM 100644 inline {MANIFEST_FILENAME}\ndata {}\n{manifest}",
                1_700_000_000 + index, message.len(), manifest.len()
            ).unwrap();
        }
        drop(stream);
        let imported = Command::new("git")
            .arg("-C")
            .arg(&fixture.0)
            .args(["fast-import", "--quiet"])
            .stdin(File::open(&stream_path).unwrap())
            .output()
            .unwrap();
        assert!(
            imported.status.success(),
            "{}",
            String::from_utf8_lossy(&imported.stderr)
        );
        git_output(&fixture.0, &["symbolic-ref", "HEAD", "refs/heads/history"]).unwrap();
        git_output(&fixture.0, &["reset", "--hard", "HEAD"]).unwrap();

        // Isolate the potentially blocking calls so a regression has a bounded
        // failure and only this test's process is terminated and reaped.
        let log_path = fixture.0.join(".git/history-test-output");
        let log = File::create(&log_path).unwrap();
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "project::tests::long_git_history_batches_complete",
                "--nocapture",
            ])
            .env(HISTORY_TEST_ROOT, &fixture.0)
            .stdout(log.try_clone().unwrap())
            .stderr(log)
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(30);
        let status = loop {
            if let Some(status) = child.try_wait().unwrap() {
                break status;
            }
            if Instant::now() >= deadline {
                child.kill().unwrap();
                child.wait().unwrap();
                panic!("Git batches failed to finish within 30 seconds");
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        assert!(
            status.success(),
            "{}",
            fs::read_to_string(log_path).unwrap()
        );
    }
}
