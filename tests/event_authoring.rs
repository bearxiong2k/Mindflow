use mindflow::{
    model::{ComponentRegistration, EvolveEvent, HistoricalComponentDefinition, OpeningTransition},
    project::{ChangeOperation, Severity},
    Project,
};
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
};

static COUNTER: AtomicU64 = AtomicU64::new(0);

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "mindflow-event-authoring-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        let fixture = Self(root);
        fixture.git(&["init", "--quiet"]);
        fixture.write("MINDFLOW.yaml", "format: '2026-10-27'\ncomponents: {}\n");
        let mut manifest = fixture.load().manifest;
        for id in ["summary", "first", "second", "tail", "available"] {
            let path = format!("notes/{id}.md");
            fixture.write(&path, &format!("# {id}\n\nExact authored prose.\n"));
            manifest.components.insert(
                id.into(),
                ComponentRegistration {
                    path,
                    description: Some(format!("About {id}")),
                    index: false,
                },
            );
        }
        manifest.evolve.events = vec![
            event("summary", &["first", "second"]),
            event("first", &[]),
            event("second", &[]),
            event("tail", &[]),
        ];
        manifest.opening.files = vec!["available".into()];
        fixture.manifest(&manifest);
        fixture.write("notes/new.md", "# New discussion\n\nNot yet registered.\n");
        fixture
    }

    fn write(&self, path: &str, content: &str) {
        let target = self.0.join(path);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(target, content).unwrap();
    }

    fn manifest(&self, manifest: &mindflow::model::Manifest) {
        self.write("MINDFLOW.yaml", &serde_norway::to_string(manifest).unwrap());
    }

    fn load(&self) -> Project {
        Project::load(self.0.clone()).unwrap()
    }

    fn git(&self, args: &[&str]) -> String {
        let output = Command::new("git")
            .arg("-C")
            .arg(&self.0)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }

    fn cli(&self, args: &[&str]) -> std::process::Output {
        Command::new(env!("CARGO_BIN_EXE_mindflow"))
            .current_dir(&self.0)
            .args(args)
            .output()
            .unwrap()
    }

    fn bytes(&self) -> Vec<u8> {
        fs::read(self.0.join("MINDFLOW.yaml")).unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn event(id: &str, children: &[&str]) -> EvolveEvent {
    EvolveEvent {
        component: id.into(),
        children: children.iter().map(|id| (*id).into()).collect(),
        opening: None,
    }
}

fn operation(parent: Option<&str>) -> ChangeOperation {
    serde_json::from_value(json!({
        "operation":"register-event", "component":"new", "file":"notes/new.md", "parent_event":parent
    })).unwrap()
}

fn order(project: &Project) -> Vec<&str> {
    project
        .manifest
        .evolve
        .events
        .iter()
        .map(|event| event.component.as_str())
        .collect()
}

#[test]
fn misplaced_definitions_warn_without_rewriting_or_invalidating_the_forest() {
    let f = Fixture::new();
    let mut manifest = f.load().manifest;
    // A root inserted beside a summary header, before that summary's children.
    manifest.evolve.events = vec![
        event("summary", &["first", "second"]),
        event("tail", &[]),
        event("second", &[]),
        event("first", &[]),
    ];
    f.manifest(&manifest);
    let before = f.bytes();
    let project = f.load();
    let diagnostics = project.diagnostics();
    assert!(project.status().valid);
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].severity, Severity::Warning);
    assert_eq!(diagnostics[0].code, "evolve-registry-order");
    assert_eq!(diagnostics[0].path.as_deref(), Some("MINDFLOW.yaml"));
    assert!(diagnostics[0].message.contains("position 2"));
    assert!(diagnostics[0].message.contains("expected `first`"));
    assert_eq!(
        project.event_page(1, 1).unwrap().events[0].component,
        "tail"
    );
    assert!(project.region_index().is_ok());
    let output = f.cli(&["check", "--json"]);
    assert!(output.status.success());
    let check: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(check["valid"], true);
    assert_eq!(check["diagnostics"][0]["severity"], "warning");
    assert_eq!(f.bytes(), before);

    // Different root order is authored meaning, not an inferred chronology error.
    manifest.evolve.events = vec![
        event("tail", &[]),
        event("summary", &["first", "second"]),
        event("first", &[]),
        event("second", &[]),
    ];
    f.manifest(&manifest);
    assert!(f.load().diagnostics().is_empty());
}

#[test]
fn registry_warning_does_not_suppress_transition_errors_or_replace_forest_errors() {
    let f = Fixture::new();
    let mut manifest = f.load().manifest;
    manifest.evolve.events.swap(1, 2);
    for event in &mut manifest.evolve.events[1..3] {
        event.opening = Some(OpeningTransition {
            predecessors: vec![],
            successors: vec!["available".into()],
        });
    }
    f.manifest(&manifest);
    let project = f.load();
    let diagnostics = project.diagnostics();
    assert!(!project.status().valid);
    assert!(diagnostics
        .iter()
        .any(|d| d.code == "evolve-registry-order"));
    assert!(diagnostics
        .iter()
        .any(|d| d.code == "event-opening-successor" && d.severity == Severity::Error));
    assert!(project.event_page(0, 10).is_err());

    manifest.evolve.events[0].children.push("missing".into());
    f.manifest(&manifest);
    let diagnostics = f.load().diagnostics();
    assert!(diagnostics.iter().any(|d| d.code == "event-child"));
    assert!(!diagnostics
        .iter()
        .any(|d| d.code == "evolve-registry-order"));
}

#[test]
fn indexed_directory_advice_is_explicit_local_and_nonblocking() {
    let f = Fixture::new();
    f.write("README.md", "# Root index\n");
    f.write("notes/README.md", "# Notes index\n");
    let mut manifest = f.load().manifest;
    for (id, path) in [
        ("root_index", "README.md"),
        ("notes_index", "notes/README.md"),
    ] {
        manifest.components.insert(
            id.into(),
            ComponentRegistration {
                path: path.into(),
                index: true,
                description: None,
            },
        );
    }
    f.manifest(&manifest);
    let project = f.load();
    let diagnostics = project.diagnostics();
    assert!(project.status().valid);
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].code, "unmanaged-indexed-directory");
    assert_eq!(diagnostics[0].path.as_deref(), Some("notes/README.md"));
    assert_eq!(diagnostics[0].severity, Severity::Warning);
    assert!(!project
        .manifest
        .components
        .values()
        .any(|component| component.path == "notes"));
    assert!(project
        .graph()
        .structure
        .nodes
        .iter()
        .any(|node| node.path == "notes" && node.component.is_none()));

    manifest.components.insert(
        "notes".into(),
        ComponentRegistration {
            path: "notes".into(),
            index: false,
            description: None,
        },
    );
    f.manifest(&manifest);
    assert!(f.load().diagnostics().is_empty());
    manifest.components.remove("notes");
    manifest.components.get_mut("notes_index").unwrap().index = false;
    f.manifest(&manifest);
    assert!(f.load().diagnostics().is_empty());
    manifest.components.get_mut("notes_index").unwrap().index = true;
    f.manifest(&manifest);
    fs::write(f.0.join("notes/README.md"), [255]).unwrap();
    let diagnostics = f.load().diagnostics();
    assert!(diagnostics.iter().any(|d| d.code == "document-utf8"));
    assert!(!diagnostics
        .iter()
        .any(|d| d.code == "unmanaged-indexed-directory"));
}

#[test]
fn registration_appends_at_present_and_normalizes_definitions_without_changing_old_meaning() {
    let f = Fixture::new();
    let mut manifest = f.load().manifest;
    manifest.evolve.events.swap(1, 2);
    manifest.evolve.events[0].opening = Some(OpeningTransition {
        predecessors: vec![],
        successors: vec!["available".into()],
    });
    f.manifest(&manifest);
    let before = f.bytes();
    let prose = fs::read(f.0.join("notes/new.md")).unwrap();
    let project = f.load();
    let proposal = project.plan_change(operation(None)).unwrap();
    assert_eq!(f.bytes(), before);
    assert_eq!(proposal.carriers.len(), 1);
    assert_eq!(proposal.carriers[0].path, "MINDFLOW.yaml");
    assert!(proposal.carriers[0].diff.contains("component: new"));
    assert_eq!(proposal.dependencies[0].path, "notes/new.md");
    project.apply_change(&proposal).unwrap();
    let result = f.load();
    assert_eq!(
        order(&result),
        ["summary", "first", "second", "tail", "new"]
    );
    assert!(result.diagnostics().is_empty());
    for old in &manifest.evolve.events {
        assert_eq!(
            result
                .manifest
                .evolve
                .events
                .iter()
                .find(|event| event.component == old.component),
            Some(old)
        );
    }
    assert_eq!(result.manifest.opening.files, manifest.opening.files);
    assert_eq!(result.manifest.relationships, manifest.relationships);
    assert_eq!(
        serde_json::to_value(&result.manifest.anchors).unwrap(),
        serde_json::to_value(&manifest.anchors).unwrap()
    );
    for (id, component) in &manifest.components {
        assert_eq!(result.manifest.components.get(id), Some(component));
    }
    assert_eq!(
        result.manifest.components.len(),
        manifest.components.len() + 1
    );
    assert_eq!(fs::read(f.0.join("notes/new.md")).unwrap(), prose);
}

#[test]
fn registration_places_new_and_existing_documents_after_the_named_nested_subtree() {
    for reuse in [false, true] {
        let f = Fixture::new();
        let mut manifest = f.load().manifest;
        manifest.evolve.events = vec![
            event("summary", &["first"]),
            event("first", &["second"]),
            event("second", &[]),
            event("tail", &[]),
        ];
        f.manifest(&manifest);
        let operation: ChangeOperation = serde_json::from_value(if reuse {
            json!({"operation":"register-event", "component":"available", "file":"notes/available.md", "parent_event":"first"})
        } else {
            json!({"operation":"register-event", "component":"new", "file":"notes/new.md", "parent_event":"first", "description":"New evidence"})
        }).unwrap();
        let project = f.load();
        project
            .apply_change(&project.plan_change(operation).unwrap())
            .unwrap();
        let result = f.load();
        let id = if reuse { "available" } else { "new" };
        assert_eq!(order(&result), ["summary", "first", "second", id, "tail"]);
        assert_eq!(result.manifest.evolve.events[1].children, ["second", id]);
        assert_eq!(result.manifest.evolve.events[0], manifest.evolve.events[0]);
        assert_eq!(result.manifest.opening.files, manifest.opening.files);
        assert_eq!(
            result.manifest.components[id].description.as_deref(),
            Some(if reuse {
                "About available"
            } else {
                "New evidence"
            })
        );
    }
}

#[test]
fn invalid_registration_requests_publish_nothing() {
    let f = Fixture::new();
    f.write("notes/index.md", "# Index\n");
    let mut manifest = f.load().manifest;
    manifest.components.insert(
        "index".into(),
        ComponentRegistration {
            path: "notes/index.md".into(),
            index: true,
            description: None,
        },
    );
    manifest.historical_components.insert(
        "historical".into(),
        HistoricalComponentDefinition {
            path: "old.md".into(),
            description: None,
        },
    );
    f.manifest(&manifest);
    let before = f.bytes();
    for fields in [
        json!({"component":"bad id"}),
        json!({"component":"historical"}),
        json!({"component":"summary", "file":"notes/summary.md"}),
        json!({"file":"notes/first.md"}),
        json!({"file":"../outside.md"}),
        json!({"file":"missing.md"}),
        json!({"file":"notes/new.txt"}),
        json!({"parent_event":"absent"}),
        json!({"parent_event":"available"}),
        json!({"parent_event":"new"}),
        json!({"description":" "}),
        json!({"component":"available", "file":"notes/new.md"}),
        json!({"component":"available", "file":"notes/available.md", "description":"Replace annotation"}),
        json!({"component":"index", "file":"notes/index.md"}),
    ] {
        let mut value =
            json!({"operation":"register-event", "component":"new", "file":"notes/new.md"});
        value
            .as_object_mut()
            .unwrap()
            .extend(fields.as_object().unwrap().clone());
        let operation = serde_json::from_value(value.clone()).unwrap();
        assert!(f.load().plan_change(operation).is_err(), "{value}");
        assert_eq!(f.bytes(), before);
    }
    for content in [b"notes/new.md\n".as_slice(), b"notes/\n".as_slice()] {
        fs::write(f.0.join(".gitignore"), content).unwrap();
        assert!(f.load().plan_change(operation(None)).is_err());
        assert_eq!(f.bytes(), before);
    }
    f.write(".gitignore", "");
    fs::write(f.0.join("notes/new.md"), [255]).unwrap();
    assert!(f.load().plan_change(operation(None)).is_err());
    assert_eq!(f.bytes(), before);
    assert!(serde_json::from_value::<ChangeOperation>(json!({
        "operation":"register-event", "component":"new", "file":"notes/new.md", "date":"2026-11-23"
    }))
    .is_err());
}

#[test]
fn event_proposals_reject_changed_prose_parent_state_and_tampered_placement() {
    let f = Fixture::new();
    let before = f.bytes();
    let project = f.load();
    let proposal = project.plan_change(operation(Some("summary"))).unwrap();
    f.write("notes/new.md", "# Changed unregistered prose\n");
    assert!(project.apply_change(&proposal).is_err());
    assert_eq!(f.bytes(), before);

    let project = f.load();
    let proposal = project.plan_change(operation(Some("summary"))).unwrap();
    let mut tampered = proposal.clone();
    tampered.operation = operation(Some("tail"));
    assert!(project.apply_change(&tampered).is_err());
    assert_eq!(f.bytes(), before);
    let mut manifest = project.manifest.clone();
    manifest.evolve.events[0].children.reverse();
    f.manifest(&manifest);
    let changed = f.bytes();
    assert!(project.apply_change(&proposal).is_err());
    assert_eq!(f.bytes(), changed);
}

#[test]
fn appending_beyond_the_nesting_limit_is_rejected_before_publication() {
    let f = Fixture::new();
    let mut manifest = f.load().manifest;
    manifest.evolve.events.clear();
    for level in 0..32 {
        let id = format!("level_{level}");
        let path = format!("notes/{id}.md");
        f.write(&path, "# Summary\n");
        manifest.components.insert(
            id.clone(),
            ComponentRegistration {
                path,
                description: None,
                index: false,
            },
        );
        if let Some(parent) = manifest.evolve.events.last_mut() {
            parent.children.push(id.clone());
        }
        manifest.evolve.events.push(event(&id, &[]));
    }
    f.manifest(&manifest);
    let project = f.load();
    assert!(project.status().valid);
    let before = f.bytes();
    let error = project
        .plan_change(operation(Some("level_31")))
        .unwrap_err();
    assert!(error.to_string().contains("event-depth"), "{error}");
    assert_eq!(f.bytes(), before);
    assert!(project.plan_change(operation(None)).is_ok());
}

#[test]
fn cli_plan_and_apply_append_a_root_without_losing_existing_git_prefix_evidence() {
    let f = Fixture::new();
    f.git(&["add", "."]);
    f.git(&[
        "-c",
        "user.name=Event Test",
        "-c",
        "user.email=event@example.invalid",
        "commit",
        "--quiet",
        "--no-gpg-sign",
        "-m",
        "Existing event account",
    ]);
    let head = f.git(&["rev-parse", "HEAD"]);
    f.write(
        "operation.json",
        &serde_json::to_string(&operation(None)).unwrap(),
    );
    let plan = f.cli(&["change", "plan", "--input-json", "operation.json"]);
    assert!(
        plan.status.success(),
        "{}",
        String::from_utf8_lossy(&plan.stderr)
    );
    let proposal: Value = serde_json::from_slice(&plan.stdout).unwrap();
    assert_eq!(proposal["operation"]["operation"], "register-event");
    fs::write(f.0.join("proposal.json"), &plan.stdout).unwrap();
    let apply = f.cli(&["change", "apply", "--input-json", "proposal.json"]);
    assert!(
        apply.status.success(),
        "{}",
        String::from_utf8_lossy(&apply.stderr)
    );
    let project = f.load();
    assert_eq!(order(&project).last(), Some(&"new"));
    let commits = project.timeline_commits().unwrap();
    assert_eq!(
        commits
            .iter()
            .find(|commit| commit.commit == head)
            .unwrap()
            .event_boundary,
        Some(4)
    );
    let check = f.cli(&["check", "--json"]);
    assert!(check.status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&check.stdout).unwrap()["diagnostics"],
        json!([])
    );
}
