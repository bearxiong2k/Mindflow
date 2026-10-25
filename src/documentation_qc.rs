//! Disposable measurements of the current document cohort, never SOE state.
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::{project::SnapshotIdentity, Project};

mod cache;

pub const DEFAULT_COMMITS: usize = 30;
pub const MAX_COMMITS: usize = 100;
pub const MAX_RANGE_COMMITS: usize = 500;
pub const HISTORY_PAGE_SIZE: usize = 100;
const MAX_DOCUMENTS: usize = 512;
const MAX_ENTRIES: usize = 2048;
const MAX_SAMPLE_CELLS: usize = 250_000;
const MAX_BLOB_BYTES: usize = 8 * 1024 * 1024;
const MAX_HISTORY_BYTES: usize = 128 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum QcWindow {
    Recent { commits: usize },
    Range { start: String, end: String },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DocumentationQcHistory {
    pub schema: String,
    pub root: String,
    pub snapshot: SnapshotIdentity,
    pub offset: usize,
    pub has_more: bool,
    pub commits: Vec<QcPoint>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DocumentationQc {
    pub schema: String,
    pub root: String,
    pub snapshot: SnapshotIdentity,
    pub window: QcWindow,
    pub history_truncated: bool,
    pub shallow_history: bool,
    pub points: Vec<QcPoint>,
    pub entries: Vec<QcEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QcPoint {
    pub kind: String,
    pub commit: Option<String>,
    pub timestamp: Option<i64>,
    pub subject: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QcEntry {
    pub path: String,
    pub kind: String,
    pub component: Option<String>,
    pub samples: Vec<QcSample>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct QcSample {
    pub documents: usize,
    pub lines: usize,
    pub bytes: usize,
    pub added_lines: Option<usize>,
    pub deleted_lines: Option<usize>,
}

fn measure(content: Option<&str>, changes: Option<(usize, usize)>) -> QcSample {
    QcSample {
        documents: usize::from(content.is_some()),
        lines: content.map_or(0, |text| {
            text.bytes().filter(|byte| *byte == b'\n').count()
                + usize::from(!text.is_empty() && !text.ends_with('\n'))
        }),
        bytes: content.map_or(0, str::len),
        added_lines: changes.map(|value| value.0),
        deleted_lines: changes.map(|value| value.1),
    }
}

pub fn observe(project: &Project, commits: usize) -> Result<DocumentationQc> {
    observe_window(project, QcWindow::Recent { commits })
}

pub fn observe_window(project: &Project, window: QcWindow) -> Result<DocumentationQc> {
    if Project::has_errors(&project.diagnostics()) {
        bail!("Documentation QC requires a valid Region");
    }
    let paths: Vec<_> = project.managed_files.iter().cloned().collect();
    if paths.len() > MAX_DOCUMENTS {
        bail!("QC supports at most {MAX_DOCUMENTS} current documents per observation");
    }
    let snapshot = project.snapshot_identity().clone();
    let (mut points, history_truncated, include_working_tree) =
        selected_history(&project.root, snapshot.head.as_deref(), &window)?;
    // Bound the complete table before reading document versions or allocating samples.
    let mut folder_paths = BTreeSet::from([String::new()]);
    for path in &paths {
        let mut directory = Path::new(path).parent();
        while let Some(path) = directory {
            folder_paths.insert(
                path.to_str()
                    .context("QC folder path is not UTF-8")?
                    .to_owned(),
            );
            if paths.len() + folder_paths.len() > MAX_ENTRIES {
                bail!("QC exceeds its {MAX_ENTRIES} file and folder entry limit");
            }
            directory = path.parent();
        }
    }
    let sample_count = points.len() + usize::from(include_working_tree);
    if (paths.len() + folder_paths.len()).saturating_mul(sample_count) > MAX_SAMPLE_CELLS {
        bail!("QC exceeds its {MAX_SAMPLE_CELLS} total sample-cell limit; choose a shorter range");
    }
    let shallow_history =
        git(&project.root, &["rev-parse", "--is-shallow-repository"])? == b"true\n";
    let (store, mut measurements) = match cache::Store::open(&project.root, &paths) {
        Some((store, measurements)) => (Some(store), measurements),
        None => (None, cache::Measurements::default()),
    };
    measurements.verify_objects(&project.root);
    measurements.snapshot = snapshot.id.clone();
    let mut entries: Vec<_> = paths
        .iter()
        .map(|path| QcEntry {
            path: path.clone(),
            kind: "file".into(),
            component: project
                .manifest
                .components
                .iter()
                .find(|(_, registration)| &registration.path == path)
                .map(|(id, _)| id.clone()),
            samples: Vec::new(),
        })
        .collect();
    let mut blobs = None;
    let mut prefix = None;
    let mut measured_objects = BTreeSet::new();
    let mut history_bytes = 0usize;
    let mut head_objects = BTreeMap::new();
    for (index, point) in points.iter().enumerate() {
        let commit = point.commit.as_deref().unwrap();
        let mut cached = match measurements.commits.get(commit) {
            Some(cached) => cached.clone(),
            None => {
                if prefix.is_none() {
                    prefix = Some(String::from_utf8(git(
                        &project.root,
                        &["rev-parse", "--show-prefix"],
                    )?)?);
                }
                let (objects, trees) = tree_objects(
                    &project.root,
                    prefix.as_deref().unwrap().trim_end_matches('\n'),
                    commit,
                    &paths,
                )?;
                cache::Commit {
                    objects,
                    trees,
                    ..cache::Commit::default()
                }
            }
        };
        let previous = index
            .checked_sub(1)
            .and_then(|index| points[index].commit.as_deref());
        if let Some(previous) =
            previous.filter(|previous| cached.previous.as_deref() != Some(*previous))
        {
            let mut args = vec![
                "diff",
                "--relative",
                "--numstat",
                "-z",
                "--no-renames",
                "--no-ext-diff",
                "--no-textconv",
                "--text",
                "--diff-algorithm=myers",
                "--no-indent-heuristic",
                previous,
                commit,
                "--",
            ];
            args.extend(paths.iter().map(String::as_str));
            cached.changes = if paths.is_empty() || cached.objects == head_objects {
                BTreeMap::new()
            } else {
                numstat(&git(&project.root, &args)?)?
            };
            cached.previous = Some(previous.into());
        }
        for entry in &mut entries {
            let mut sample = if let Some(object) = cached.objects.get(&entry.path) {
                if !measurements.blobs.contains_key(object) {
                    let content = read_blob(&mut blobs, &project.root, object)
                        .with_context(|| format!("cannot measure '{}' at {commit}", entry.path))?;
                    measurements.blobs.insert(
                        object.clone(),
                        cache::Blob {
                            sha256: cache::digest(content.as_bytes()),
                            sample: measure(Some(content), None),
                        },
                    );
                }
                let sample = measurements.blobs[object].sample.clone();
                if measured_objects.insert(object.clone()) {
                    history_bytes = history_bytes.saturating_add(sample.bytes);
                    if sample.bytes > MAX_BLOB_BYTES || history_bytes > MAX_HISTORY_BYTES {
                        bail!("QC history exceeds its 8 MiB per document or 128 MiB total limit; choose fewer commits");
                    }
                }
                sample
            } else {
                QcSample::default()
            };
            let change =
                previous.map(|_| cached.changes.get(&entry.path).copied().unwrap_or_default());
            sample.added_lines = change.map(|value| value.0);
            sample.deleted_lines = change.map(|value| value.1);
            entry.samples.push(sample);
        }
        head_objects = cached.objects.clone();
        measurements.commits.insert(commit.into(), cached);
    }
    if include_working_tree {
        let mut scratch = None;
        for entry in &mut entries {
            let content = project.read_managed_document(&entry.path)?;
            if content.len() > MAX_BLOB_BYTES {
                bail!(
                    "QC document '{}' exceeds the 8 MiB measurement limit",
                    entry.path
                );
            }
            let sha256 = cache::digest(content.as_bytes());
            let head_object = head_objects.get(&entry.path).cloned();
            if let Some(cached) = measurements.working.get(&entry.path).filter(|cached| {
                cached.sha256 == sha256
                    && cached.head_object == head_object
                    && cached.comparison == !points.is_empty()
            }) {
                entry.samples.push(cached.sample.clone());
                continue;
            }
            let changes = if points.is_empty() {
                None
            } else if head_object
                .as_ref()
                .and_then(|object| measurements.blobs.get(object))
                .is_some_and(|blob| blob.sha256 == sha256)
            {
                Some((0, 0))
            } else {
                let before = head_object
                    .as_ref()
                    .map(|object| read_blob(&mut blobs, &project.root, object))
                    .transpose()?
                    .unwrap_or("");
                Some(if before == content {
                    (0, 0)
                } else {
                    if scratch.is_none() {
                        scratch = Some(DiffScratch::new()?);
                    }
                    scratch.as_ref().unwrap().changes(before, &content)?
                })
            };
            let sample = measure(Some(&content), changes);
            measurements.working.insert(
                entry.path.clone(),
                cache::Working {
                    sha256,
                    head_object,
                    comparison: !points.is_empty(),
                    sample: sample.clone(),
                },
            );
            entry.samples.push(sample);
        }
        points.push(QcPoint {
            kind: "working-tree".into(),
            commit: None,
            timestamp: None,
            subject: "Working tree".into(),
        });
    }
    let mut folders = BTreeMap::<String, Vec<QcSample>>::new();
    folders.insert(String::new(), vec![QcSample::default(); points.len()]);
    for entry in &entries {
        let mut directory = Path::new(&entry.path).parent();
        while let Some(path) = directory {
            let path = path.to_str().context("QC folder path is not UTF-8")?;
            if folders.len() + entries.len() >= MAX_ENTRIES && !folders.contains_key(path) {
                bail!("QC exceeds its {MAX_ENTRIES} file and folder entry limit");
            }
            let totals = folders
                .entry(path.into())
                .or_insert_with(|| vec![QcSample::default(); points.len()]);
            for (total, sample) in totals.iter_mut().zip(&entry.samples) {
                total.documents += sample.documents;
                total.lines += sample.lines;
                total.bytes += sample.bytes;
                if let Some(added) = sample.added_lines {
                    *total.added_lines.get_or_insert(0) += added;
                    *total.deleted_lines.get_or_insert(0) += sample.deleted_lines.unwrap_or(0);
                }
            }
            directory = Path::new(path).parent();
        }
    }
    // Empty Regions still have a well-defined zero-valued comparison after the baseline.
    for samples in folders.values_mut() {
        for sample in samples.iter_mut().skip(1) {
            sample.added_lines.get_or_insert(0);
            sample.deleted_lines.get_or_insert(0);
        }
    }
    entries.extend(folders.into_iter().map(|(path, samples)| {
        QcEntry {
            component: project
                .manifest
                .components
                .iter()
                .find(|(_, value)| value.path == if path.is_empty() { "." } else { &path })
                .map(|(id, _)| id.clone()),
            path,
            kind: "directory".into(),
            samples,
        }
    }));
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    measurements.retain_window(&points, &measured_objects);
    if let Some(store) = store {
        store.publish(measurements);
    }
    Ok(DocumentationQc {
        schema: "mindflow-documentation-qc/v2".into(),
        root: project.root.display().to_string(),
        snapshot,
        window,
        history_truncated,
        shallow_history,
        points,
        entries,
    })
}

fn git(root: &Path, args: &[&str]) -> Result<Vec<u8>> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .arg("--literal-pathspecs")
        .args(args)
        .output()
        .context("cannot execute Git for QC")?;
    if !output.status.success() {
        bail!(
            "QC Git inspection failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(output.stdout)
}

/// Page exact first-parent commit choices from the retained snapshot, newest first.
pub fn history_choices(project: &Project, offset: usize) -> Result<DocumentationQcHistory> {
    if Project::has_errors(&project.diagnostics()) {
        bail!("Documentation QC requires a valid Region");
    }
    let snapshot = project.snapshot_identity().clone();
    let (commits, has_more) = history_page(
        &project.root,
        snapshot.head.as_deref(),
        offset,
        HISTORY_PAGE_SIZE,
    )?;
    Ok(DocumentationQcHistory {
        schema: "mindflow-documentation-qc-history/v1".into(),
        root: project.root.display().to_string(),
        snapshot,
        offset,
        has_more,
        commits,
    })
}

fn selected_history(
    root: &Path,
    head: Option<&str>,
    window: &QcWindow,
) -> Result<(Vec<QcPoint>, bool, bool)> {
    match window {
        QcWindow::Recent { commits } => {
            if !(1..=MAX_COMMITS).contains(commits) {
                bail!("QC commits must be between 1 and {MAX_COMMITS}");
            }
            let (mut points, truncated) = history_page(root, head, 0, *commits)?;
            points.reverse();
            Ok((points, truncated, true))
        }
        QcWindow::Range { start, end } => {
            let head = head.context("QC custom ranges require Git commit history")?;
            let start_offset = first_parent_offset(root, head, start)?;
            let include_working_tree = end == "working-tree";
            let end_offset = if include_working_tree {
                0
            } else {
                first_parent_offset(root, head, end)?
            };
            if start_offset < end_offset {
                bail!("QC range start must be at or before its end on the captured first-parent history");
            }
            let count = start_offset - end_offset + 1;
            if count > MAX_RANGE_COMMITS {
                bail!("QC custom ranges support at most {MAX_RANGE_COMMITS} commit samples; choose a shorter range");
            }
            let (mut points, truncated) = history_page(root, Some(head), end_offset, count)?;
            if points.first().and_then(|point| point.commit.as_deref())
                != Some(if include_working_tree { head } else { end })
                || points.last().and_then(|point| point.commit.as_deref()) != Some(start)
            {
                bail!("QC selected commit range is unavailable in the captured history");
            }
            points.reverse();
            Ok((points, truncated, include_working_tree))
        }
    }
}

/// Validate membership on the captured first-parent chain without loading all history.
fn first_parent_offset(root: &Path, head: &str, commit: &str) -> Result<usize> {
    if !matches!(commit.len(), 40 | 64)
        || !commit
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        bail!("QC range endpoints must be exact full lowercase commit hashes");
    }
    let count = git(
        root,
        &[
            "rev-list",
            "--first-parent",
            "--count",
            head,
            "--not",
            commit,
            "--",
        ],
    )?;
    let offset: usize = std::str::from_utf8(&count)?.trim().parse()?;
    let resolved = git(
        root,
        &[
            "rev-parse",
            "--verify",
            &format!("{head}~{offset}^{{commit}}"),
        ],
    )
    .context("QC endpoint is not available on the captured first-parent history")?;
    if std::str::from_utf8(&resolved)?.trim() != commit {
        bail!("QC endpoint is not on the captured first-parent history");
    }
    Ok(offset)
}

fn history_page(
    root: &Path,
    head: Option<&str>,
    offset: usize,
    count: usize,
) -> Result<(Vec<QcPoint>, bool)> {
    let Some(head) = head else {
        return Ok((Vec::new(), false));
    };
    let output = git(
        root,
        &[
            "log",
            "--first-parent",
            &format!("--skip={offset}"),
            &format!("--max-count={}", count + 1),
            "--format=%H%x00%ct%x00%s",
            head,
            "--",
        ],
    )?;
    let text = String::from_utf8(output).context("QC commit metadata is not UTF-8")?;
    let mut points = text
        .lines()
        .map(|line| {
            let fields: Vec<_> = line.splitn(3, '\0').collect();
            if fields.len() != 3 {
                bail!("Invalid QC commit record");
            }
            Ok(QcPoint {
                kind: "commit".into(),
                commit: Some(fields[0].into()),
                timestamp: Some(fields[1].parse()?),
                subject: fields[2].into(),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let truncated = points.len() > count;
    points.truncate(count);
    Ok((points, truncated))
}

fn tree_objects(
    root: &Path,
    prefix: &str,
    commit: &str,
    paths: &[String],
) -> Result<(BTreeMap<String, String>, BTreeSet<String>)> {
    if paths.is_empty() {
        return Ok((BTreeMap::new(), BTreeSet::new()));
    }
    // Include the traversed ancestor trees, even for paths absent at this
    // commit, so warm observations still require the same available history.
    let mut args = vec!["ls-tree", "-z", "-t", "--full-tree", commit, "--"];
    let tree_paths: Vec<_> = paths.iter().map(|path| format!("{prefix}{path}")).collect();
    args.extend(tree_paths.iter().map(String::as_str));
    let output = git(root, &args)?;
    let mut objects = BTreeMap::new();
    let mut trees = BTreeSet::new();
    for record in output
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
    {
        let record = std::str::from_utf8(record)?;
        let (metadata, path) = record
            .split_once('\t')
            .context("Invalid QC Git tree record")?;
        let fields: Vec<_> = metadata.split_whitespace().collect();
        if fields.len() == 3
            && fields[0] == "040000"
            && fields[1] == "tree"
            && tree_paths.iter().any(|document| {
                document
                    .strip_prefix(path)
                    .is_some_and(|suffix| suffix.starts_with('/'))
            })
        {
            trees.insert(fields[2].into());
            continue;
        }
        if fields.len() != 3 || !matches!(fields[0], "100644" | "100755") || fields[1] != "blob" {
            bail!("QC path '{path}' at {commit} is not a regular document");
        }
        let path = path
            .strip_prefix(prefix)
            .context("QC Git path leaves the project root")?;
        if paths
            .binary_search_by(|candidate| candidate.as_str().cmp(path))
            .is_err()
        {
            bail!("Git returned an unexpected QC path '{path}'");
        }
        objects.insert(path.into(), fields[2].into());
    }
    Ok((objects, trees))
}

fn numstat(output: &[u8]) -> Result<BTreeMap<String, (usize, usize)>> {
    output
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
        .map(|record| {
            let record = std::str::from_utf8(record)?;
            let mut fields = record.splitn(3, '\t');
            let added = fields.next().context("Missing QC additions")?.parse()?;
            let deleted = fields.next().context("Missing QC deletions")?.parse()?;
            let path = fields.next().context("Missing QC diff path")?.to_owned();
            Ok((path, (added, deleted)))
        })
        .collect()
}

struct BlobReader {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    cache: BTreeMap<String, String>,
    bytes: usize,
}

fn read_blob<'a>(reader: &'a mut Option<BlobReader>, root: &Path, object: &str) -> Result<&'a str> {
    if reader.is_none() {
        *reader = Some(BlobReader::new(root)?);
    }
    reader.as_mut().unwrap().read(object)
}

impl BlobReader {
    fn new(root: &Path) -> Result<Self> {
        let mut child = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(["cat-file", "--batch"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let input = child.stdin.take().context("Missing QC blob input")?;
        let output = BufReader::new(child.stdout.take().context("Missing QC blob output")?);
        Ok(Self {
            child,
            input,
            output,
            cache: BTreeMap::new(),
            bytes: 0,
        })
    }
    fn read(&mut self, object: &str) -> Result<&str> {
        if !self.cache.contains_key(object) {
            writeln!(self.input, "{object}")?;
            self.input.flush()?;
            let mut header = String::new();
            self.output.read_line(&mut header)?;
            let fields: Vec<_> = header.split_whitespace().collect();
            if fields.len() != 3 || fields[0] != object || fields[1] != "blob" {
                bail!("QC historical blob {object} is unavailable");
            }
            let size: usize = fields[2].parse()?;
            if size > MAX_BLOB_BYTES || self.bytes.saturating_add(size) > MAX_HISTORY_BYTES {
                bail!("QC history exceeds its 8 MiB per document or 128 MiB total limit; choose fewer commits");
            }
            let mut bytes = vec![0; size];
            self.output.read_exact(&mut bytes)?;
            let mut delimiter = [0];
            self.output.read_exact(&mut delimiter)?;
            if delimiter != [b'\n'] {
                bail!("Invalid QC blob delimiter");
            }
            self.bytes += size;
            self.cache.insert(
                object.into(),
                String::from_utf8(bytes).context("QC historical document is not UTF-8")?,
            );
        }
        Ok(self.cache.get(object).unwrap())
    }
}
impl Drop for BlobReader {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct DiffScratch(PathBuf);
impl DiffScratch {
    fn new() -> Result<Self> {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        loop {
            let path = std::env::temp_dir().join(format!(
                "mindflow-qc-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            let mut builder = fs::DirBuilder::new();
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            match builder.create(&path) {
                Ok(()) => return Ok(Self(path)),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error.into()),
            }
        }
    }
    fn changes(&self, before: &str, after: &str) -> Result<(usize, usize)> {
        fs::write(self.0.join("before"), before)?;
        fs::write(self.0.join("after"), after)?;
        let output = Command::new("git")
            .current_dir(&self.0)
            .args([
                "diff",
                "--no-index",
                "--numstat",
                "--no-ext-diff",
                "--no-textconv",
                "--text",
                "--diff-algorithm=myers",
                "--no-indent-heuristic",
                "--",
                "before",
                "after",
            ])
            .output()?;
        if !matches!(output.status.code(), Some(0 | 1)) {
            bail!(
                "Cannot measure working-tree QC changes: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        let text = String::from_utf8(output.stdout)?;
        if text.is_empty() {
            return Ok((0, 0));
        }
        let mut fields = text.splitn(3, '\t');
        Ok((
            fields.next().context("Missing added lines")?.parse()?,
            fields.next().context("Missing deleted lines")?.parse()?,
        ))
    }
}
impl Drop for DiffScratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
