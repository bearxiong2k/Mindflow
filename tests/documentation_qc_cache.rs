//! Portable regression coverage for the disposable documentation measurement cache.
use mindflow::{model::ComponentRegistration, Project};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
};

static COUNTER: AtomicU64 = AtomicU64::new(0);
struct Fixture(PathBuf);
impl Fixture {
    fn base() -> Self {
        let root = std::env::temp_dir().join(format!(
            "mindflow-qc-cache-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        git(&root, &["init", "--quiet"]);
        let fixture = Self(root);
        fixture.write("docs/a.md", "# A\n\nExact prose.\n");
        fixture.write("docs/b.md", "# B\n");
        fixture.write("docs/c.md", "# C\n");
        fixture.manifest(
            "format: \"2026-10-27\"\ncomponents:\n  a: {path: docs/a.md}\n  b: {path: docs/b.md}\n",
        );
        fixture
    }
    fn write(&self, path: &str, bytes: impl AsRef<[u8]>) {
        let path = self.0.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }
    fn manifest(&self, source: &str) {
        self.write("MINDFLOW.yaml", source);
    }
    fn valid(&self) -> Project {
        let project = Project::load(self.0.clone()).unwrap();
        assert!(project.status().valid, "{:?}", project.diagnostics());
        project
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn git(root: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().into()
}
fn qc_commit(fixture: &Fixture, message: &str) -> String {
    git(&fixture.0, &["add", "."]);
    git(
        &fixture.0,
        &[
            "-c",
            "user.name=QC Test",
            "-c",
            "user.email=qc@example.invalid",
            "commit",
            "--quiet",
            "--no-gpg-sign",
            "-m",
            message,
        ],
    );
    git(&fixture.0, &["rev-parse", "HEAD"])
}
fn git_directory(fixture: &Fixture) -> PathBuf {
    PathBuf::from(git(&fixture.0, &["rev-parse", "--absolute-git-dir"]))
}

#[test]
fn unregistered_file_churn_preserves_the_qc_snapshot() {
    let fixture = Fixture::base();
    qc_commit(&fixture, "baseline");
    let before = fixture.valid();
    let report = mindflow::documentation_qc::observe_window(
        &before,
        mindflow::documentation_qc::QcWindow::Recent { commits: 5 },
    )
    .unwrap();

    // Background tools can create files without changing the registered Region.
    // Include a sibling beneath a required ancestor, not only root-level noise.
    fixture.write("build-session.log", "background output\n");
    fixture.write("docs/scratch.md", "Unregistered notes\n");
    fixture.write("docs/c.md", "Changed unregistered prose\n");
    fixture.write(".gitignore", "build-session.log\n");
    git(&fixture.0, &["add", "docs/scratch.md"]);
    let after = fixture.valid();
    assert_eq!(before.snapshot_identity(), after.snapshot_identity());
    let repeated = mindflow::documentation_qc::observe_window(
        &after,
        mindflow::documentation_qc::QcWindow::Recent { commits: 5 },
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(report).unwrap(),
        serde_json::to_value(repeated).unwrap()
    );

    fs::remove_file(fixture.0.join("docs/c.md")).unwrap();
    git(&fixture.0, &["rm", "--cached", "docs/c.md"]);
    assert_eq!(
        before.snapshot_identity(),
        fixture.valid().snapshot_identity()
    );

    // Actual measured inputs and Git history still invalidate the observation.
    fixture.write("docs/a.md", "# Updated registered prose\n");
    assert_ne!(
        before.snapshot_identity(),
        fixture.valid().snapshot_identity()
    );
    fixture.write("docs/a.md", "# A\n\nExact prose.\n");
    assert_eq!(
        before.snapshot_identity(),
        fixture.valid().snapshot_identity()
    );
    qc_commit(&fixture, "unregistered files only");
    assert_ne!(
        before.snapshot_identity(),
        fixture.valid().snapshot_identity()
    );
}

#[test]
fn registered_git_visibility_still_invalidates_the_snapshot() {
    let fixture = Fixture::base();
    let before = fixture.valid();
    for (pattern, diagnostic) in [
        ("docs/a.md\n", "component-ignored"),
        ("docs/\n", "component-ignored"),
        ("MINDFLOW.yaml\n", "manifest-git-visible"),
    ] {
        fixture.write(".gitignore", pattern);
        let after = Project::load(fixture.0.clone()).unwrap();
        assert_ne!(before.snapshot_identity(), after.snapshot_identity());
        assert!(after
            .diagnostics()
            .iter()
            .any(|entry| entry.code == diagnostic));
    }
    fixture.write(".gitignore", "docs/c.md\n");
    assert_eq!(
        before.snapshot_identity(),
        fixture.valid().snapshot_identity()
    );
}

fn qc_cache_file(fixture: &Fixture) -> PathBuf {
    fs::read_dir(git_directory(fixture).join("mindflow"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("qc-")
                && path
                    .extension()
                    .is_some_and(|extension| extension == "json")
        })
        .unwrap()
}

fn traced_qc(fixture: &Fixture, commits: usize) -> (Value, String) {
    let trace = git_directory(fixture).join("qc-test-trace.json");
    let _ = fs::remove_file(&trace);
    let output = Command::new(env!("CARGO_BIN_EXE_mindflow"))
        .current_dir(&fixture.0)
        .env("GIT_TRACE2_EVENT", &trace)
        .args(["qc", "--commits", &commits.to_string(), "--json"])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let commands = fs::read_to_string(&trace)
        .unwrap()
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|event| event["event"] == "start")
        .map(|event| {
            event["argv"]
                .as_array()
                .unwrap()
                .iter()
                .map(|arg| arg.as_str().unwrap())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect::<Vec<_>>()
        .join("\n");
    (serde_json::from_slice(&output.stdout).unwrap(), commands)
}

#[test]
fn qc_numeric_cache_survives_processes_reuses_history_and_replaces_the_window() {
    let f = Fixture::base();
    for index in 0..7 {
        f.write("docs/a.md", format!("# A\n{}", "line\n".repeat(index)));
        qc_commit(&f, &format!("revision {index}"));
    }
    let before = f.valid().snapshot_identity().clone();
    let (cold, trace) = traced_qc(&f, 5);
    assert!(trace.contains("ls-tree"), "{trace}");
    let file = qc_cache_file(&f);
    let original = fs::read(&file).unwrap();
    assert!(original.len() < 32 * 1024);
    assert!(!String::from_utf8_lossy(&original).contains("Exact prose"));
    let (warm, trace) = traced_qc(&f, 5);
    assert_eq!(cold, warm);
    // The CLI process exits between observations; this is disk reuse, not an
    // in-process memo. Object availability is still checked in one batch.
    assert!(trace.contains("cat-file --batch-check"), "{trace}");
    assert!(!trace.contains("cat-file --batch\n"), "{trace}");
    assert!(!trace.contains("ls-tree"), "{trace}");
    assert!(!trace.contains("diff --relative"), "{trace}");
    assert_eq!(f.valid().snapshot_identity(), &before);
    f.write("docs/a.md", "# A\nChanged working prose.\n");
    let (edited, trace) = traced_qc(&f, 5);
    assert!(!trace.contains("ls-tree"), "{trace}");
    assert_ne!(edited["snapshot"], warm["snapshot"]);
    let a = edited["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["path"] == "docs/a.md")
        .unwrap();
    assert_eq!(a["samples"].as_array().unwrap().last().unwrap()["lines"], 2);
    assert_eq!(
        a["samples"].as_array().unwrap().last().unwrap()["added_lines"],
        1
    );
    assert_eq!(
        a["samples"].as_array().unwrap().last().unwrap()["deleted_lines"],
        6
    );
    let (_, _) = traced_qc(&f, 2);
    let stored: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    assert_eq!(stored["data"]["commits"].as_object().unwrap().len(), 2);
    assert_eq!(stored["data"]["working"].as_object().unwrap().len(), 2);
    let git_status = git(&f.0, &["status", "--porcelain"]);
    assert_eq!(git_status.trim(), "M docs/a.md");
}

#[test]
fn qc_cache_corruption_or_unavailability_falls_back_and_cohort_changes_prune_old_paths() {
    let f = Fixture::base();
    let mut manifest = f.valid().manifest;
    manifest.components.insert(
        "c".into(),
        ComponentRegistration {
            path: "docs/c.md".into(),
            index: false,
            description: None,
        },
    );
    f.manifest(&serde_norway::to_string(&manifest).unwrap());
    qc_commit(&f, "baseline");
    let (expected, _) = traced_qc(&f, 5);
    let file = qc_cache_file(&f);
    fs::write(&file, b"incomplete cache").unwrap();
    assert_eq!(traced_qc(&f, 5).0, expected);
    // Detect parseable corruption as well as malformed JSON.
    let mut corrupt: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    corrupt["data"]["version"] = json!(999);
    fs::write(&file, serde_json::to_vec(&corrupt).unwrap()).unwrap();
    assert_eq!(traced_qc(&f, 5).0, expected);
    fs::File::create(&file)
        .unwrap()
        .set_len(9 * 1024 * 1024)
        .unwrap();
    assert_eq!(traced_qc(&f, 5).0, expected);
    fs::remove_file(&file).unwrap();
    fs::create_dir(&file).unwrap();
    assert_eq!(traced_qc(&f, 5).0, expected);
    fs::remove_dir(&file).unwrap();
    let mut manifest = f.valid().manifest;
    manifest
        .components
        .retain(|_, value| value.path != "docs/c.md");
    f.manifest(&serde_norway::to_string(&manifest).unwrap());
    let (changed, _) = traced_qc(&f, 5);
    assert!(!changed["entries"]
        .as_array()
        .unwrap()
        .iter()
        .any(|entry| entry["path"] == "docs/c.md"));
    let data: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    assert_eq!(data["data"]["paths"].as_array().unwrap().len(), 2);
}

#[test]
fn qc_cache_preserves_retained_snapshots_and_refuses_missing_historical_content() {
    use mindflow::documentation_qc::observe;
    let f = Fixture::base();
    qc_commit(&f, "baseline");
    let earlier = f.valid();
    let old = serde_json::to_value(observe(&earlier, 5).unwrap()).unwrap();
    f.write(
        "docs/a.md",
        "# A\n\nChanged current content.\nExtra line.\n",
    );
    let current = f.valid();
    let newer = serde_json::to_value(observe(&current, 5).unwrap()).unwrap();
    assert_ne!(newer["snapshot"], old["snapshot"]);
    assert_eq!(
        serde_json::to_value(observe(&earlier, 5).unwrap()).unwrap(),
        old
    );
    assert_eq!(
        serde_json::to_value(observe(&current, 5).unwrap()).unwrap(),
        newer
    );
    let object = git(&f.0, &["rev-parse", "HEAD:docs/a.md"]);
    let object = object.trim();
    fs::remove_file(
        f.0.join(".git/objects")
            .join(&object[..2])
            .join(&object[2..]),
    )
    .unwrap();
    assert!(
        observe(&current, 5).is_err(),
        "cached numbers concealed missing historical content"
    );
}

#[test]
fn qc_concurrent_windows_publish_one_complete_bounded_cache() {
    use mindflow::documentation_qc::observe;
    let f = Fixture::base();
    for index in 0..5 {
        f.write("docs/a.md", "line\n".repeat(index + 1));
        qc_commit(&f, &format!("version {index}"));
    }
    let project = f.valid();
    let expected =
        [2, 5].map(|count| serde_json::to_value(observe(&project, count).unwrap()).unwrap());
    let file = qc_cache_file(&f);
    fs::remove_file(&file).unwrap();
    std::thread::scope(|scope| {
        let requests: Vec<_> = [2, 5, 2, 5]
            .into_iter()
            .map(|count| {
                let project = &project;
                (
                    count,
                    scope.spawn(move || {
                        serde_json::to_value(observe(project, count).unwrap()).unwrap()
                    }),
                )
            })
            .collect();
        for (count, request) in requests {
            assert_eq!(request.join().unwrap(), expected[usize::from(count == 5)]);
        }
    });
    let data: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    assert!(matches!(
        data["data"]["commits"].as_object().unwrap().len(),
        2 | 5
    ));
    assert!(!file.with_extension("tmp").exists());
}

#[test]
fn qc_cache_rechecks_replacement_refs_even_when_blob_size_is_unchanged() {
    let f = Fixture::base();
    qc_commit(&f, "baseline");
    let original = traced_qc(&f, 5).0;
    let blob = git(&f.0, &["rev-parse", "HEAD:docs/a.md"]);
    let replacement = f.0.join(".git/replacement.txt");
    let original_bytes = fs::read(f.0.join("docs/a.md")).unwrap();
    // Object type and byte count alone cannot distinguish these line counts.
    fs::write(&replacement, "x".repeat(original_bytes.len())).unwrap();
    let replaced_blob = git(&f.0, &["hash-object", "-w", replacement.to_str().unwrap()]);
    git(&f.0, &["replace", &blob, &replaced_blob]);
    let replaced = traced_qc(&f, 5).0;
    let entry = replaced["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["path"] == "docs/a.md")
        .unwrap();
    assert_eq!(entry["samples"][0]["lines"], 1);
    fs::remove_file(qc_cache_file(&f)).unwrap();
    assert_eq!(traced_qc(&f, 5).0, replaced);
    git(&f.0, &["replace", "-d", &blob]);
    assert_eq!(traced_qc(&f, 5).0, original);
}

#[test]
fn qc_cache_uses_each_worktrees_git_directory_and_captured_working_content() {
    let f = Fixture::base();
    qc_commit(&f, "baseline");
    let original = traced_qc(&f, 5).0;
    let linked = Fixture(f.0.with_extension("linked"));
    git(
        &f.0,
        &[
            "worktree",
            "add",
            "--quiet",
            "--detach",
            linked.0.to_str().unwrap(),
        ],
    );
    linked.write("docs/a.md", "Changed linked workspace.\n");
    let changed = traced_qc(&linked, 5).0;
    let entry = changed["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["path"] == "docs/a.md")
        .unwrap();
    assert_eq!(entry["samples"][1]["lines"], 1);
    assert_ne!(qc_cache_file(&f), qc_cache_file(&linked));
    assert!(qc_cache_file(&linked).starts_with(git_directory(&linked)));
    assert_eq!(traced_qc(&f, 5).0, original);
    assert_eq!(traced_qc(&linked, 5).0, changed);
}

#[test]
fn qc_cache_does_not_conceal_missing_historical_root_or_ancestor_trees() {
    use mindflow::documentation_qc::observe;
    for tree_spec in ["HEAD^^{tree}", "HEAD^:docs"] {
        let f = Fixture::base();
        qc_commit(&f, "baseline");
        f.write("docs/a.md", "changed\n");
        qc_commit(&f, "current");
        let project = f.valid();
        observe(&project, 5).unwrap();
        let tree = git(&f.0, &["rev-parse", tree_spec]);
        fs::remove_file(f.0.join(".git/objects").join(&tree[..2]).join(&tree[2..])).unwrap();
        let warm_error = observe(&project, 5).unwrap_err().to_string();
        fs::remove_file(qc_cache_file(&f)).unwrap();
        let cold_error = observe(&project, 5).unwrap_err().to_string();
        assert!(
            warm_error.contains("QC Git inspection failed"),
            "{warm_error}"
        );
        assert_eq!(warm_error, cold_error);
    }
}

#[test]
fn qc_tree_inspection_still_rejects_a_historical_directory_at_a_document_path() {
    use mindflow::documentation_qc::observe;
    let f = Fixture::base();
    fs::remove_file(f.0.join("docs/a.md")).unwrap();
    f.write("docs/a.md/child.md", "historical folder content\n");
    qc_commit(&f, "historical directory");
    fs::remove_dir_all(f.0.join("docs/a.md")).unwrap();
    f.write("docs/a.md", "current document\n");
    let error = observe(&f.valid(), 5).unwrap_err().to_string();
    assert!(error.contains("not a regular document"), "{error}");
}
