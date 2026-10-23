use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use mindflow::project::{EMPTY_MANIFEST_SOURCE, MANIFEST_FILENAME};
use serde_json::{json, Value};

fn temporary_directory(name: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let directory =
        std::env::temp_dir().join(format!("mindflow-{name}-{}-{unique}", std::process::id()));
    fs::create_dir(&directory).unwrap();
    directory
}

fn git(root: &Path, arguments: &[&str]) {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(root)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {} failed: {}",
        arguments.join(" "),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn empty_project(root: &Path) {
    git(root, &["init", "--quiet"]);
    fs::write(root.join(MANIFEST_FILENAME), EMPTY_MANIFEST_SOURCE).unwrap();
    git(root, &["add", "."]);
    git(
        root,
        &[
            "-c",
            "user.name=Mindflow Tests",
            "-c",
            "user.email=mindflow-tests@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "initial",
        ],
    );
}

fn observer() -> &'static str {
    env!("CARGO_BIN_EXE_mindflow-observe")
}

fn mindflow() -> &'static str {
    env!("CARGO_BIN_EXE_mindflow")
}

fn directory_contains(directory: &Path, needle: &[u8]) -> bool {
    for entry in fs::read_dir(directory).unwrap() {
        let path = entry.unwrap().path();
        let metadata = fs::symlink_metadata(&path).unwrap();
        if metadata.is_dir() {
            if directory_contains(&path, needle) {
                return true;
            }
        } else if metadata.is_file() {
            let source = fs::read(&path).unwrap();
            if source.windows(needle.len()).any(|window| window == needle) {
                return true;
            }
        }
    }
    false
}

#[test]
fn agent_effect_bundle_correlates_calls_events_artifacts_and_validation() {
    let project = temporary_directory("observation-project");
    empty_project(&project);
    let control = temporary_directory("observation-control");
    let spec = control.join("experiment.json");
    let bundle = control.join("bundle");
    fs::write(
        &spec,
        serde_json::to_vec_pretty(&json!({
            "schema": "mindflow-observation-experiment/v1",
            "name": "empty-region-navigation",
            "purpose": "Exercise the runtime observation contract.",
            "task": "Navigate the empty Region and identify its root owner.",
            "capture": "agent-effect",
            "project_root": project,
            "retention_until": "test-completion",
            "access_boundary": ["the temporary project"],
            "runtime": {
                "name": "test-shell",
                "model": "none",
                "reasoning_effort": "none",
                "configuration": {"fixture": true}
            },
            "expected_owners": ["project"],
            "validation_commands": [["mindflow", "check", "--json"]],
            "require_clean_worktree": true
        }))
        .unwrap(),
    )
    .unwrap();

    let script = concat!(
        "printf 'inspect the root' | \"$MINDFLOW_OBSERVATION_RECORDER\" record ",
        "--bundle \"$MINDFLOW_OBSERVATION_BUNDLE\" --kind plan --input - >/dev/null && ",
        "mindflow topology list --json && ",
        "mindflow topology probe --json && ",
        "printf 'project' | \"$MINDFLOW_OBSERVATION_RECORDER\" record ",
        "--bundle \"$MINDFLOW_OBSERVATION_BUNDLE\" --kind selected-owner ",
        "--label project --input - >/dev/null"
    );
    let run = Command::new(observer())
        .args(["run", "--spec"])
        .arg(&spec)
        .arg("--output")
        .arg(&bundle)
        .arg("--mindflow")
        .arg(mindflow())
        .arg("--")
        .args(["/bin/sh", "-c", script])
        .output()
        .unwrap();
    assert!(
        run.status.success(),
        "{}",
        String::from_utf8_lossy(&run.stderr)
    );
    assert!(bundle.join("run.json").is_file());
    assert!(bundle.join("agent.stdout").is_file());
    assert!(bundle.join("final/working.diff").is_file());

    let report = Command::new(observer())
        .args(["report"])
        .arg(&bundle)
        .arg("--json")
        .output()
        .unwrap();
    assert!(
        report.status.success(),
        "{}",
        String::from_utf8_lossy(&report.stderr)
    );
    let report: Value = serde_json::from_slice(&report.stdout).unwrap();
    assert_eq!(report["schema"], "mindflow-observation-report/v1");
    assert_eq!(report["calls"]["total"], 3);
    assert_eq!(report["calls"]["agent_calls"], 2);
    assert_eq!(report["calls"]["validation_calls"], 1);
    assert_eq!(report["artifacts"]["plan"], 1);
    assert_eq!(report["artifacts"]["selected-owner"], 1);
    assert_eq!(report["owners"]["selected"], json!(["project"]));
    assert_eq!(report["owners"]["unexpected"], json!([]));
    assert_eq!(report["validation_failed"], 0);
    assert!(
        report["operations"]["core.project.capture"]["count"]
            .as_u64()
            .unwrap()
            >= 2
    );
    assert_eq!(report["operations"]["core.topology.list"]["count"], 1);
    assert_eq!(report["operations"]["core.topology.probe"]["count"], 1);

    let comparison = Command::new(observer())
        .args(["compare"])
        .arg(&bundle)
        .arg(&bundle)
        .arg("--json")
        .output()
        .unwrap();
    assert!(comparison.status.success());
    let comparison: Value = serde_json::from_slice(&comparison.stdout).unwrap();
    assert_eq!(comparison["deltas"]["calls"], 0);
    assert_eq!(comparison["deltas"]["duration_ns"], 0);

    let dispose = Command::new(observer())
        .args(["dispose"])
        .arg(&bundle)
        .output()
        .unwrap();
    assert!(
        dispose.status.success(),
        "{}",
        String::from_utf8_lossy(&dispose.stderr)
    );
    assert!(!bundle.exists());
    fs::remove_dir_all(project).unwrap();
    fs::remove_dir_all(control).unwrap();
}

#[test]
fn operational_bundle_omits_raw_task_arguments_and_stream_files() {
    let project = temporary_directory("operational-observation-project");
    empty_project(&project);
    let control = temporary_directory("operational-observation-control");
    let spec = control.join("experiment.json");
    let bundle = control.join("bundle");
    let secret_task_marker = "raw-task-language-must-not-enter-operational-bundle";
    fs::write(
        &spec,
        serde_json::to_vec_pretty(&json!({
            "schema": "mindflow-observation-experiment/v1",
            "name": "operational-only",
            "purpose": "Measure one command without semantic capture.",
            "task": secret_task_marker,
            "capture": "operational",
            "project_root": project,
            "retention_until": "test-completion",
            "runtime": {"name": "test-shell", "configuration": {}},
            "validation_commands": [],
            "require_clean_worktree": true
        }))
        .unwrap(),
    )
    .unwrap();

    let run = Command::new(observer())
        .args(["run", "--spec"])
        .arg(&spec)
        .arg("--output")
        .arg(&bundle)
        .arg("--mindflow")
        .arg(mindflow())
        .arg("--")
        .args(["/bin/sh", "-c", "mindflow check --json"])
        .output()
        .unwrap();
    assert!(
        run.status.success(),
        "{}",
        String::from_utf8_lossy(&run.stderr)
    );
    assert!(!bundle.join("agent.stdout").exists());
    let stored_experiment = fs::read_to_string(bundle.join("experiment.json")).unwrap();
    assert!(!stored_experiment.contains(secret_task_marker));
    assert!(!stored_experiment.contains(&project.display().to_string()));
    assert!(!directory_contains(&bundle, secret_task_marker.as_bytes()));
    assert!(!directory_contains(
        &bundle,
        project.display().to_string().as_bytes()
    ));

    let call_path = fs::read_dir(bundle.join("calls"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
        })
        .unwrap();
    let call: Value = serde_json::from_slice(&fs::read(call_path).unwrap()).unwrap();
    assert!(call.get("arguments").is_none());
    assert!(call["stdout"].get("file").is_none());
    assert!(call["stderr"].get("file").is_none());

    let dispose = Command::new(observer())
        .args(["dispose"])
        .arg(&bundle)
        .output()
        .unwrap();
    assert!(dispose.status.success());
    fs::remove_dir_all(project).unwrap();
    fs::remove_dir_all(control).unwrap();
}

#[test]
fn experiment_spec_rejects_nested_secret_bearing_runtime_configuration() {
    let control = temporary_directory("observation-secret-config");
    let spec = control.join("experiment.json");
    let bundle = control.join("bundle");
    fs::write(
        &spec,
        serde_json::to_vec_pretty(&json!({
            "schema": "mindflow-observation-experiment/v1",
            "name": "secret-refusal",
            "purpose": "Prove secret-shaped configuration fails closed.",
            "task": "This command must never start.",
            "capture": "agent-effect",
            "project_root": control,
            "retention_until": "test-completion",
            "runtime": {
                "name": "test-shell",
                "configuration": {"nested": [{"api-token": "must-not-copy"}]}
            }
        }))
        .unwrap(),
    )
    .unwrap();
    let run = Command::new(observer())
        .args(["run", "--spec"])
        .arg(&spec)
        .arg("--output")
        .arg(&bundle)
        .arg("--mindflow")
        .arg(mindflow())
        .arg("--")
        .arg("/usr/bin/true")
        .output()
        .unwrap();
    assert_eq!(run.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&run.stderr).contains("secret-bearing"));
    assert!(!bundle.exists());
    fs::remove_dir_all(control).unwrap();
}
