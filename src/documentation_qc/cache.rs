//! One replaceable numeric cache per canonical root, inside worktree-local Git state.
use super::{git, QcPoint, QcSample};
use anyhow::{Context, Result};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const VERSION: u32 = 2;
const MAX_CACHE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Measurements {
    version: u32,
    root: String,
    context: String,
    paths: Vec<String>,
    pub snapshot: String,
    pub commits: BTreeMap<String, Commit>,
    pub blobs: BTreeMap<String, Blob>,
    pub working: BTreeMap<String, Working>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Commit {
    pub objects: BTreeMap<String, String>,
    pub trees: BTreeSet<String>,
    pub previous: Option<String>,
    pub changes: BTreeMap<String, (usize, usize)>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Blob {
    pub sha256: String,
    pub sample: QcSample,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Working {
    pub sha256: String,
    pub head_object: Option<String>,
    pub comparison: bool,
    pub sample: QcSample,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    sha256: String,
    data: Measurements,
}

pub(super) fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(super) struct Store {
    path: PathBuf,
    _lock: File,
}

impl Store {
    // Cache availability never determines whether a valid observation can run.
    pub fn open(root: &Path, paths: &[String]) -> Option<(Self, Measurements)> {
        Self::try_open(root, paths).ok()
    }

    fn try_open(root: &Path, paths: &[String]) -> Result<(Self, Measurements)> {
        let locations = String::from_utf8(git(
            root,
            &[
                "rev-parse",
                "--absolute-git-dir",
                "--git-path",
                "shallow",
                "--git-path",
                "info/grafts",
            ],
        )?)?;
        let locations: Vec<_> = locations.lines().collect();
        anyhow::ensure!(locations.len() == 3, "unavailable QC cache locations");
        let directory = Path::new(locations[0]).join("mindflow");
        fs::create_dir_all(&directory)?;
        let root_name = root.to_string_lossy();
        let path = directory.join(format!("qc-{}.json", digest(root_name.as_bytes())));
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path.with_extension("lock"))?;
        // Serialize concurrent windows/processes so a second reader can reuse
        // the first result. This lock is independent of project transactions.
        FileExt::lock_exclusive(&lock)?;
        let store = Self { path, _lock: lock };
        // Commit IDs normally name immutable bytes. Replacement refs, grafts,
        // and shallow boundaries can change what those IDs expose to Git.
        let mut context = git(
            root,
            &[
                "for-each-ref",
                "--format=%(refname):%(objectname)",
                "refs/replace",
            ],
        )?;
        for location in &locations[1..] {
            let path = root.join(location);
            let bytes = match fs::read(path) {
                Ok(bytes) => bytes,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
                Err(error) => return Err(error.into()),
            };
            context.extend_from_slice(digest(&bytes).as_bytes());
        }
        let context = digest(&context);
        let data = store
            .read()
            .filter(|data| {
                data.version == VERSION
                    && data.root == root_name
                    && data.paths == paths
                    && data.context == context
            })
            .unwrap_or_else(|| Measurements {
                version: VERSION,
                root: root_name.into_owned(),
                context,
                paths: paths.to_vec(),
                ..Measurements::default()
            });
        Ok((store, data))
    }

    fn read(&self) -> Option<Measurements> {
        let file = File::open(&self.path).ok()?;
        if file.metadata().ok()?.len() > MAX_CACHE_BYTES {
            return None;
        }
        let mut bytes = Vec::new();
        file.take(MAX_CACHE_BYTES + 1)
            .read_to_end(&mut bytes)
            .ok()?;
        if bytes.len() as u64 > MAX_CACHE_BYTES {
            return None;
        }
        let envelope: Envelope = serde_json::from_slice(&bytes).ok()?;
        let encoded = serde_json::to_vec(&envelope.data).ok()?;
        (digest(&encoded) == envelope.sha256).then_some(envelope.data)
    }

    pub fn publish(&self, data: Measurements) {
        let _ = self.try_publish(data);
    }

    fn try_publish(&self, data: Measurements) -> Result<()> {
        let sha256 = digest(&serde_json::to_vec(&data)?);
        let bytes = serde_json::to_vec(&Envelope { sha256, data })?;
        if bytes.len() as u64 > MAX_CACHE_BYTES {
            // Do not retain an obsolete window when the replacement is too big.
            let _ = fs::remove_file(&self.path);
            return Ok(());
        }
        // The per-root lock owns this one scratch slot, including recovery
        // after an interrupted writer. Crashes cannot accumulate temp files.
        let temporary = self.path.with_extension("tmp");
        let _ = fs::remove_file(&temporary);
        let result = (|| -> Result<()> {
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temporary)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            fs::rename(&temporary, &self.path)?;
            Ok(())
        })();
        let _ = fs::remove_file(temporary);
        result
    }
}

impl Measurements {
    /// A cache hit must not turn missing historical objects into available data.
    /// Check cached blobs and required trees in one process, without reading
    /// prose. A newly selected commit may reuse an object from the prior window.
    pub fn verify_objects(&mut self, root: &Path) {
        if self.try_verify_objects(root).is_err() {
            self.commits.clear();
            self.blobs.clear();
            self.working.clear();
        }
    }

    fn try_verify_objects(&self, root: &Path) -> Result<()> {
        let mut objects: BTreeMap<String, (&str, Option<usize>)> = self
            .blobs
            .iter()
            .map(|(object, blob)| (object.clone(), ("blob", Some(blob.sample.bytes))))
            .collect();
        if !self.paths.is_empty() {
            for (commit, data) in &self.commits {
                objects.insert(format!("{commit}^{{tree}}"), ("tree", None));
                for tree in &data.trees {
                    objects.insert(tree.clone(), ("tree", None));
                }
            }
        }
        if objects.is_empty() {
            return Ok(());
        }
        let input = objects
            .keys()
            .map(|object| format!("{object}\n"))
            .collect::<String>();
        let mut child = Command::new("git")
            .arg("-C")
            .arg(root)
            .arg("cat-file")
            .arg("--batch-check")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let mut stdin = child
            .stdin
            .take()
            .context("missing QC object-check input")?;
        let output = std::thread::scope(|scope| -> Result<_> {
            let writer = scope.spawn(move || stdin.write_all(input.as_bytes()));
            let output = child.wait_with_output()?;
            writer
                .join()
                .map_err(|_| anyhow::anyhow!("QC object check interrupted"))??;
            Ok(output)
        })?;
        anyhow::ensure!(output.status.success(), "QC object check failed");
        let text = std::str::from_utf8(&output.stdout)?;
        anyhow::ensure!(
            text.lines().count() == objects.len(),
            "incomplete QC object check"
        );
        for (line, (object, (kind, bytes))) in text.lines().zip(objects) {
            let fields: Vec<_> = line.split_whitespace().collect();
            anyhow::ensure!(
                fields.len() == 3
                    && (object.ends_with("^{tree}") || fields[0] == object)
                    && fields[1] == kind
                    && bytes.map_or(true, |expected| fields[2].parse::<usize>() == Ok(expected)),
                "changed QC object"
            );
        }
        Ok(())
    }

    pub fn retain_window(&mut self, points: &[QcPoint], objects: &BTreeSet<String>) {
        let commits: BTreeSet<_> = points
            .iter()
            .filter_map(|point| point.commit.as_ref())
            .collect();
        self.commits.retain(|commit, _| commits.contains(commit));
        self.blobs.retain(|object, _| objects.contains(object));
        if points.last().map(|point| point.kind.as_str()) != Some("working-tree") {
            self.working.clear();
        }
    }
}
