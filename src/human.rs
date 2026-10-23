use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::fs;
use std::path::{Component, Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

use crate::model::GraphData;
use crate::project::{
    AnchorTimelineSlice, SnapshotIdentity, StatusData, TimelineCommit, CURRENT_FORMAT,
};
use crate::soe::Opening;
use crate::{Diagnostic, Project, Severity};

pub const READER_TEXT_MAX_BYTES: u64 = 8 * 1024 * 1024;
pub const READER_IMAGE_MAX_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
pub struct RegionResponse {
    pub root: String,
    pub project: String,
    pub slice: String,
    pub status: StatusData,
    pub graph: GraphData,
    pub opening: Opening,
    pub anchor_timeline: Vec<AnchorTimelineSlice>,
    pub timeline_commits: Vec<TimelineCommit>,
    pub version: crate::version::ProjectVersion,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentResponse {
    pub path: String,
    pub content: String,
    pub content_kind: ReaderContentKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReaderContentKind {
    Markdown,
    Text,
    Image,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectEntryKind {
    Directory,
    File,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectEntry {
    pub path: String,
    pub name: String,
    pub kind: ProjectEntryKind,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectDirectoryResponse {
    pub path: String,
    pub entries: Vec<ProjectEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderPickerEntry {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderPickerResponse {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    pub entries: Vec<FolderPickerEntry>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReaderDocumentKind {
    Managed,
    Project,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReaderProjectSnapshot {
    pub root: String,
    pub project: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<SnapshotIdentity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub graph: Option<GraphData>,
    pub document: DocumentResponse,
    pub kind: ReaderDocumentKind,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum OpenProjectResponse {
    Region {
        region: RegionResponse,
    },
    Folder {
        root: String,
        project: String,
    },
    Error {
        requested_path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        root: Option<String>,
        project: String,
        message: String,
    },
}

pub fn diagnostic_summary(diagnostics: &[Diagnostic]) -> String {
    let details = diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.severity == Severity::Error)
        .map(|diagnostic| {
            let path = diagnostic
                .path
                .as_deref()
                .map(|path| format!(" ({path})"))
                .unwrap_or_default();
            format!("{}{}: {}", diagnostic.code, path, diagnostic.message)
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!("Mindflow region is invalid:\n{details}")
}

pub fn region_response(project: &Project) -> Result<RegionResponse, String> {
    let graph = project
        .validated_graph()
        .map_err(|diagnostics| diagnostic_summary(&diagnostics))?;
    let status = project.status();
    let opening = project.opening();
    let anchor_timeline = project.anchor_timeline();
    let timeline_commits = project.timeline_commits();
    let name = project_label(&project.root);

    Ok(RegionResponse {
        root: project.root.display().to_string(),
        project: name,
        slice: "working-tree".to_owned(),
        status,
        graph,
        opening,
        anchor_timeline,
        timeline_commits,
        version: crate::version::ProjectVersion::from_project(project),
    })
}

pub fn open_region(root: impl AsRef<Path>) -> Result<RegionResponse, String> {
    let project =
        Project::load(root.as_ref().to_path_buf()).map_err(|error| format!("{error:#}"))?;
    region_response(&project)
}

pub fn open_project(requested_path: impl AsRef<Path>) -> OpenProjectResponse {
    let requested_path = requested_path.as_ref();
    match Project::discover(requested_path) {
        Ok(root) => match open_region(&root) {
            Ok(region) => OpenProjectResponse::Region { region },
            Err(message) => OpenProjectResponse::Error {
                requested_path: requested_path.display().to_string(),
                root: Some(root.display().to_string()),
                project: project_label(&root),
                message,
            },
        },
        Err(discovery_message) => match canonical_project_folder(requested_path) {
            Ok(root) => OpenProjectResponse::Folder {
                project: project_label(&root),
                root: root.display().to_string(),
            },
            Err(folder_message) => OpenProjectResponse::Error {
                requested_path: requested_path.display().to_string(),
                root: None,
                project: project_label(requested_path),
                message: format!("{discovery_message:#}\n{folder_message}"),
            },
        },
    }
}

pub fn validated_project(root: impl AsRef<Path>) -> Result<Project, String> {
    let project =
        Project::load(root.as_ref().to_path_buf()).map_err(|error| format!("{error:#}"))?;
    let diagnostics = project.diagnostics();
    if Project::has_errors(&diagnostics) {
        return Err(diagnostic_summary(&diagnostics));
    }
    Ok(project)
}

pub fn canonical_project_folder(root: impl AsRef<Path>) -> Result<PathBuf, String> {
    let root = root
        .as_ref()
        .canonicalize()
        .map_err(|error| format!("cannot access project folder: {error}"))?;
    if !root.is_dir() {
        return Err(format!(
            "Project path '{}' is not a directory",
            root.display()
        ));
    }
    Ok(root)
}

pub fn browse_folder_directory(path: impl AsRef<Path>) -> Result<FolderPickerResponse, String> {
    let directory = canonical_project_folder(path)?;
    let path = directory.display().to_string();
    let parent = directory
        .parent()
        .map(|parent| parent.display().to_string());
    let mut entries = fs::read_dir(&directory)
        .map_err(|error| format!("cannot browse remote folder '{path}': {error}"))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            if name == ".git" || !entry.file_type().ok()?.is_dir() {
                return None;
            }
            Some(FolderPickerEntry {
                path: entry.path().display().to_string(),
                name,
            })
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(FolderPickerResponse {
        path,
        parent,
        entries,
    })
}

pub fn list_project_directory(
    root: impl AsRef<Path>,
    path: &str,
) -> Result<ProjectDirectoryResponse, String> {
    let root = canonical_project_folder(root)?;
    let directory = bounded_project_path(&root, path, true)?;
    if !directory.is_dir() {
        return Err(format!("Project path '{path}' is not a directory"));
    }
    let mut entries = fs::read_dir(&directory)
        .map_err(|error| format!("cannot read project directory '{path}': {error}"))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            if name == ".git" {
                return None;
            }
            let file_type = entry.file_type().ok()?;
            let kind = if file_type.is_dir() {
                ProjectEntryKind::Directory
            } else if file_type.is_file() {
                ProjectEntryKind::File
            } else {
                return None;
            };
            let entry_path = if path.is_empty() {
                name.clone()
            } else {
                format!("{path}/{name}")
            };
            Some(ProjectEntry {
                path: entry_path,
                name,
                kind,
            })
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| {
        let left_rank = matches!(left.kind, ProjectEntryKind::File);
        let right_rank = matches!(right.kind, ProjectEntryKind::File);
        left_rank
            .cmp(&right_rank)
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(ProjectDirectoryResponse {
        path: path.to_owned(),
        entries,
    })
}

pub fn reader_snapshot(
    root: impl AsRef<Path>,
    path: &str,
) -> Result<ReaderProjectSnapshot, String> {
    let context = reader_project_context(root)?;
    let graph = context.graph();
    let managed = graph.documents.iter().any(|document| document.path == path);
    let kind = if managed {
        ReaderDocumentKind::Managed
    } else {
        ReaderDocumentKind::Project
    };
    let document = context.document(path)?;
    Ok(ReaderProjectSnapshot {
        root: context.root().display().to_string(),
        project: project_label(context.root()),
        path: path.to_owned(),
        snapshot: context.snapshot_identity().cloned(),
        graph: Some(graph),
        document,
        kind,
    })
}

pub fn reader_snapshot_for_project(
    project: &Project,
    path: &str,
    include_graph: bool,
) -> Result<ReaderProjectSnapshot, String> {
    let diagnostics = project.diagnostics();
    if Project::has_errors(&diagnostics) {
        return Err(diagnostic_summary(&diagnostics));
    }
    let kind = if project.managed_files.contains(path) {
        ReaderDocumentKind::Managed
    } else {
        ReaderDocumentKind::Project
    };
    Ok(ReaderProjectSnapshot {
        root: project.root.display().to_string(),
        project: project_label(&project.root),
        path: path.to_owned(),
        snapshot: Some(project.snapshot_identity().clone()),
        graph: include_graph.then(|| project.graph()),
        document: project_document_for(project, path)?,
        kind,
    })
}

pub fn read_managed_document(
    root: impl AsRef<Path>,
    path: &str,
) -> Result<DocumentResponse, String> {
    let project = validated_project(root)?;
    if !project.managed_files.contains(path) {
        return Err(format!("'{path}' is not a managed document"));
    }
    project_document_for(&project, path)
}

pub fn reader_image_data_url(root: impl AsRef<Path>, path: &str) -> Result<String, String> {
    let root = canonical_project_folder(root)?;
    let canonical_image = bounded_project_path(&root, path, false)?;
    let mime_type = reader_image_mime_type(&canonical_image)
        .ok_or_else(|| format!("Reader image '{path}' has an unsupported format"))?;
    let metadata = canonical_image
        .metadata()
        .map_err(|error| format!("cannot inspect Reader image '{path}': {error}"))?;
    if !metadata.is_file() {
        return Err(format!("Reader image '{path}' is not a regular file"));
    }
    if metadata.len() > READER_IMAGE_MAX_BYTES {
        return Err(format!(
            "Reader image '{path}' exceeds the {} MiB limit",
            READER_IMAGE_MAX_BYTES / (1024 * 1024)
        ));
    }
    let bytes = fs::read(&canonical_image)
        .map_err(|error| format!("cannot read Reader image '{path}': {error}"))?;
    Ok(format!(
        "data:{mime_type};base64,{}",
        BASE64_STANDARD.encode(bytes)
    ))
}

pub fn project_label(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Mindflow region")
        .to_owned()
}

fn project_relative_components(path: &str, allow_root: bool) -> Result<Vec<&OsStr>, String> {
    if path.is_empty() {
        return if allow_root {
            Ok(Vec::new())
        } else {
            Err("Project file path must not be empty".to_owned())
        };
    }
    let relative = Path::new(path);
    if relative.is_absolute() {
        return Err("Project path must be project-relative".to_owned());
    }
    let components = relative
        .components()
        .map(|component| match component {
            Component::Normal(component) if component != OsStr::new(".git") => Ok(component),
            Component::Normal(_) => Err("Git metadata is not available in Files".to_owned()),
            _ => {
                Err("Project path must not contain empty, current, or parent components".to_owned())
            }
        })
        .collect::<Result<Vec<_>, _>>()?;
    if components.is_empty() && !allow_root {
        return Err("Project file path must not be empty".to_owned());
    }
    Ok(components)
}

fn bounded_project_path(root: &Path, path: &str, allow_root: bool) -> Result<PathBuf, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("cannot resolve Mindflow project: {error}"))?;
    let components = project_relative_components(path, allow_root)?;
    let mut candidate = canonical_root.clone();
    for component in components {
        candidate.push(component);
        let metadata = fs::symlink_metadata(&candidate)
            .map_err(|error| format!("cannot resolve project path '{path}': {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err(format!("Project path '{path}' traverses a symbolic link"));
        }
    }
    let canonical = candidate
        .canonicalize()
        .map_err(|error| format!("cannot resolve project path '{path}': {error}"))?;
    if !canonical.starts_with(&canonical_root) {
        return Err(format!(
            "Project path '{path}' is outside the Mindflow project"
        ));
    }
    Ok(canonical)
}

pub fn project_file_document_for(root: &Path, path: &str) -> Result<DocumentResponse, String> {
    let project_path = bounded_project_path(root, path, false)?;
    let metadata = project_path
        .metadata()
        .map_err(|error| format!("cannot inspect project file '{path}': {error}"))?;
    if !metadata.is_file() {
        return Err(format!("Project path '{path}' is not a regular file"));
    }
    if let Some(mime_type) = reader_image_mime_type(&project_path) {
        if metadata.len() > READER_IMAGE_MAX_BYTES {
            return Err(format!(
                "Project image '{path}' exceeds the {} MiB limit",
                READER_IMAGE_MAX_BYTES / (1024 * 1024)
            ));
        }
        return Ok(DocumentResponse {
            path: path.to_owned(),
            content: String::new(),
            content_kind: ReaderContentKind::Image,
            mime_type: Some(mime_type.to_owned()),
        });
    }
    if metadata.len() > READER_TEXT_MAX_BYTES {
        return Err(format!(
            "Project text file '{path}' exceeds the {} MiB limit",
            READER_TEXT_MAX_BYTES / (1024 * 1024)
        ));
    }
    let bytes = fs::read(&project_path)
        .map_err(|error| format!("cannot read project file '{path}': {error}"))?;
    let content = String::from_utf8(bytes)
        .map_err(|_| format!("Project file '{path}' is not supported UTF-8 text or an image"))?;
    let content_kind = match project_path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("md" | "markdown") => ReaderContentKind::Markdown,
        _ => ReaderContentKind::Text,
    };
    Ok(DocumentResponse {
        path: path.to_owned(),
        content,
        content_kind,
        mime_type: None,
    })
}

pub fn project_document_for(project: &Project, path: &str) -> Result<DocumentResponse, String> {
    if project.managed_files.contains(path) {
        let content = project
            .read_managed_document(path)
            .map_err(|error| format!("{error:#}"))?;
        return Ok(DocumentResponse {
            path: path.to_owned(),
            content,
            content_kind: ReaderContentKind::Markdown,
            mime_type: None,
        });
    }
    project_file_document_for(&project.root, path)
}

fn empty_reader_graph() -> GraphData {
    GraphData {
        format: CURRENT_FORMAT.into(),
        structure: crate::model::StructureProjection {
            nodes: Vec::new(),
            relationships: Vec::new(),
        },
        documents: Vec::new(),
        relationship_types: BTreeMap::new(),
        anchor_connection_types: BTreeMap::new(),
        historical_components: BTreeMap::new(),
        events: Vec::new(),
        anchors: BTreeMap::new(),
    }
}

enum ReaderProjectContext {
    Region(Project),
    Folder(PathBuf),
}

impl ReaderProjectContext {
    fn root(&self) -> &Path {
        match self {
            Self::Region(project) => &project.root,
            Self::Folder(root) => root,
        }
    }

    fn graph(&self) -> GraphData {
        match self {
            Self::Region(project) => project.graph(),
            Self::Folder(_) => empty_reader_graph(),
        }
    }

    fn snapshot_identity(&self) -> Option<&SnapshotIdentity> {
        match self {
            Self::Region(project) => Some(project.snapshot_identity()),
            Self::Folder(_) => None,
        }
    }

    fn document(&self, path: &str) -> Result<DocumentResponse, String> {
        match self {
            Self::Region(project) => project_document_for(project, path),
            Self::Folder(root) => project_file_document_for(root, path),
        }
    }
}

fn reader_project_context(root: impl AsRef<Path>) -> Result<ReaderProjectContext, String> {
    let root = canonical_project_folder(root)?;
    match Project::discover(&root) {
        Ok(discovered_root) if discovered_root == root => {
            validated_project(root).map(ReaderProjectContext::Region)
        }
        Ok(_) | Err(_) => Ok(ReaderProjectContext::Folder(root)),
    }
}

fn reader_image_mime_type(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())?
        .to_ascii_lowercase()
        .as_str()
    {
        "gif" => Some("image/gif"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "avif" => Some("image/avif"),
        "bmp" => Some("image/bmp"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_paths_reject_parent_and_git_components() {
        assert!(project_relative_components("../secret", false).is_err());
        assert!(project_relative_components(".git/config", false).is_err());
        assert_eq!(
            project_relative_components("docs/readme.md", false).unwrap(),
            [OsStr::new("docs"), OsStr::new("readme.md")]
        );
    }
}
