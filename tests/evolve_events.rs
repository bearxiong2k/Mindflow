use mindflow::Project;
use std::{fs, path::PathBuf, process::Command, sync::atomic::{AtomicU64, Ordering}};

// Portable fixtures: this suite also runs from the independent public release.
static COUNTER: AtomicU64 = AtomicU64::new(0);
struct Fixture(PathBuf);
impl Fixture {
    fn base() -> Self {
        let root = std::env::temp_dir().join(format!("mindflow-events-{}-{}",
            std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir(&root).unwrap();
        let output = Command::new("git").arg("-C").arg(&root).args(["init", "--quiet"]).output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let fixture = Self(root);
        fixture.write("docs/a.md", "# A\n\nExact prose.\n");
        fixture.write("docs/b.md", "# B\n");
        fixture.write("docs/c.md", "# C\n");
        fixture.manifest(BASE);
        fixture
    }
    fn write(&self, path: &str, bytes: impl AsRef<[u8]>) {
        let path = self.0.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }
    fn manifest(&self, source: &str) { self.write("MINDFLOW.yaml", source); }
    fn load(&self) -> Project { Project::load(self.0.clone()).unwrap() }
    fn valid(&self) -> Project {
        let project = self.load();
        assert!(project.status().valid, "{:?}", project.diagnostics());
        project
    }
}
impl Drop for Fixture {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
}
const BASE:&str="format: \"2026-10-27\"\ncomponents:\n  a: {path: docs/a.md}\n  b: {path: docs/b.md}\nrelationship-types:\n  supports: {description: Adds context, direction: either}\nrelationships:\n  - {source: a, type: supports, direction: source-to-target, target: b}\nopening:\n  files: [a, b]\nevolve:\n  events:\n    - {component: a, children: [b]}\n    - {component: b}\n";
fn codes(p: &Project) -> Vec<String> {
    p.diagnostics().iter().map(|d| d.code.clone()).collect()
}

#[test]
fn event_documents_groups_and_opening_are_independent() {
    let f = Fixture::base();
    f.manifest(&BASE.replace("files: [a, b]", "files: [b, a]"));
    let p = f.valid();
    let page = p.event_page(0, 1).unwrap();
    assert_eq!(page.total, 2);
    assert_eq!(page.next_offset, Some(1));
    assert_eq!(page.events[0].component, "a");
    assert_eq!(page.events[0].children, ["b"]);
    assert_eq!(page.events[0].file, "docs/a.md");
    assert_eq!(p.event_page(1, 1).unwrap().events[0].component, "b");
    let old_digest = p.region_index().unwrap().events.sha256;
    f.write("docs/a.md", "# Revised summary\n");
    let current = f.valid();
    assert_ne!(old_digest, current.region_index().unwrap().events.sha256);
    assert_ne!(page.events[0].content, current.event_page(0, 1).unwrap().events[0].content);
    assert_eq!(p.event_page(0, 1).unwrap().events[0].content, page.events[0].content);
    let mut manifest = current.manifest.clone();
    manifest.evolve.events.clear();
    f.manifest(&serde_norway::to_string(&manifest).unwrap());
    assert_eq!(f.valid().opening().files.len(), 2);
}

#[test]
fn event_forest_rejects_missing_duplicate_index_and_cyclic_membership() {
    use mindflow::model::EvolveEvent;
    let f = Fixture::base();
    for (events, expected) in [
        (vec![("missing", vec![])], "event-component"),
        (vec![("a", vec![]), ("a", vec![])], "duplicate-event"),
        (vec![("a", vec!["missing"])], "event-child"),
        (vec![("a", vec!["b", "b"]), ("b", vec![])], "duplicate-event-child"),
        (vec![("a", vec!["a"])], "event-cycle"),
        (vec![("a", vec!["b"]), ("b", vec!["a"])], "event-cycle"),
        (vec![("a", vec!["c"]), ("b", vec!["c"]), ("c", vec![])], "event-parent"),
    ] {
        let mut manifest = Project::load(f.0.clone()).unwrap().manifest;
        manifest.evolve.events = events.into_iter().map(|(id, children)| EvolveEvent {
            component: id.into(), children: children.into_iter().map(String::from).collect(), opening: None,
        }).collect();
        f.manifest(&serde_norway::to_string(&manifest).unwrap());
        assert!(codes(&f.load()).contains(&expected.into()), "{expected}");
    }
    f.manifest(&BASE.replace("a: {path: docs/a.md}", "a: {path: docs/a.md, index: true}"));
    assert!(codes(&f.load()).contains(&"event-index-path".into()));
}

#[test]
fn event_grouping_limits_are_bounded_and_old_transition_fields_are_rejected() {
    use mindflow::model::{ComponentRegistration, EvolveEvent};
    let f = Fixture::base();
    let mut manifest = f.valid().manifest;
    manifest.evolve.events.clear();
    for i in 0..33 {
        let id = format!("level{i}");
        let path = format!("events/{id}.md");
        f.write(&path, "# Summary\n");
        manifest.components.insert(id.clone(), ComponentRegistration { path, description: None, index: false });
        if let Some(previous) = manifest.evolve.events.last_mut() { previous.children.push(id.clone()); }
        manifest.evolve.events.push(EvolveEvent { component: id, children: vec![], opening: None });
        if i == 31 {
            f.manifest(&serde_norway::to_string(&manifest).unwrap());
            f.valid();
        }
    }
    f.manifest(&serde_norway::to_string(&manifest).unwrap());
    assert!(codes(&f.load()).contains(&"event-depth".into()));
    manifest.evolve.events = vec![EvolveEvent { component: "a".into(), children: vec![], opening: None }; 4097];
    f.manifest(&serde_norway::to_string(&manifest).unwrap());
    assert!(codes(&f.load()).contains(&"event-limit".into()));
    f.manifest(&BASE.replace("component: a, children: [b]", "name: old, predecessors: [], successors: [a]"));
    assert!(Project::load(f.0.clone()).is_err());
    f.manifest(&format!("{BASE}historical-components: {{}}\n"));
    f.valid();
}

#[test]
fn event_opening_transitions_follow_nested_order_and_keep_present_opening_independent() {
    use mindflow::model::{EvolveEvent, OpeningTransition};
    let f = Fixture::base();
    let mut manifest = f.valid().manifest;
    // Registry placement differs from the authored child order.
    manifest.evolve.events = vec![
        EvolveEvent {
            component: "a".into(),
            children: vec!["c".into(), "b".into()],
            opening: None,
        },
        EvolveEvent {
            component: "b".into(),
            children: vec![],
            opening: Some(OpeningTransition {
                predecessors: vec!["a".into()],
                successors: vec!["b".into()],
            }),
        },
        EvolveEvent {
            component: "c".into(),
            children: vec![],
            opening: Some(OpeningTransition {
                predecessors: vec![],
                successors: vec!["a".into()],
            }),
        },
    ];
    f.write("docs/c.md", "# First transition\n");
    manifest.components.insert(
        "c".into(),
        mindflow::model::ComponentRegistration {
            path: "docs/c.md".into(),
            description: None,
            index: false,
        },
    );
    manifest.opening.files.clear();
    f.manifest(&serde_norway::to_string(&manifest).unwrap());
    let project = f.valid();
    assert!(project.opening().files.is_empty());
    assert_eq!(
        project.event_page(1, 1).unwrap().events[0]
            .opening
            .as_ref()
            .unwrap()
            .successors,
        ["b"]
    );
    let digest = project.region_index().unwrap().events.sha256;
    manifest.evolve.events[1]
        .opening
        .as_mut()
        .unwrap()
        .successors
        .clear();
    f.manifest(&serde_norway::to_string(&manifest).unwrap());
    assert_ne!(digest, f.valid().region_index().unwrap().events.sha256);
}

#[test]
fn historical_opening_participants_are_references_without_current_file_access() {
    use mindflow::model::{HistoricalComponentDefinition, OpeningTransition};
    let f = Fixture::base();
    let mut manifest = f.valid().manifest;
    manifest.historical_components.insert(
        "past".into(),
        HistoricalComponentDefinition {
            path: "missing/old.md".into(),
            description: None,
        },
    );
    manifest.evolve.events[0].opening = Some(OpeningTransition {
        predecessors: vec!["past".into()],
        successors: vec!["a".into()],
    });
    f.manifest(&serde_norway::to_string(&manifest).unwrap());
    let project = f.valid();
    assert!(!project.managed_files.contains("missing/old.md"));
    assert_eq!(
        project.graph().historical_components["past"].path,
        "missing/old.md"
    );
    assert_eq!(
        project.region_index().unwrap().historical_components.len(),
        1
    );
    manifest.historical_components.insert(
        "a".into(),
        HistoricalComponentDefinition {
            path: "old/a.md".into(),
            description: None,
        },
    );
    f.manifest(&serde_norway::to_string(&manifest).unwrap());
    assert!(codes(&f.load()).contains(&"historical-component-id".into()));
}

#[test]
fn event_opening_defaults_each_side_but_rejects_empty_or_invalid_references() {
    let f = Fixture::base();
    f.manifest(&BASE.replace(
        "{component: a, children: [b]}",
        "{component: a, children: [b], opening: {successors: [a]}}",
    ));
    let p = f.valid();
    assert!(p.manifest.evolve.events[0]
        .opening
        .as_ref()
        .unwrap()
        .predecessors
        .is_empty());
    f.manifest(&BASE.replace(
        "{component: a, children: [b]}",
        "{component: a, children: [b], opening: {predecessors: [a]}}",
    ));
    assert!(f.valid().manifest.evolve.events[0]
        .opening
        .as_ref()
        .unwrap()
        .successors
        .is_empty());
    f.manifest(&BASE.replace("{component: a, children: [b]}", "{component: a, children: [b], opening: {}}"));
    assert!(codes(&f.load()).contains(&"empty-event-opening".into()));
    f.manifest(&format!(
        "{BASE}historical-components:\n  past: {{path: ../outside.md}}\n"
    ));
    assert!(codes(&f.load()).contains(&"historical-component-path".into()));
}

#[test]
fn event_opening_rejects_unknown_duplicate_and_inconsistent_participants() {
    use mindflow::model::OpeningTransition;
    let f = Fixture::base();
    for (first, second, code) in [
        (
            (vec![], vec!["missing"]),
            (vec![], vec![]),
            "event-opening-participant",
        ),
        (
            (vec![], vec!["a", "a"]),
            (vec![], vec![]),
            "duplicate-event-participant",
        ),
        (
            (vec!["a"], vec![]),
            (vec!["a"], vec![]),
            "event-opening-predecessor",
        ),
        (
            (vec![], vec!["a"]),
            (vec![], vec!["a"]),
            "event-opening-successor",
        ),
    ] {
        f.manifest(BASE);
        let mut manifest = f.valid().manifest;
        for (event, (predecessors, successors)) in
            manifest.evolve.events.iter_mut().zip([first, second])
        {
            event.opening = Some(OpeningTransition {
                predecessors: predecessors.into_iter().map(String::from).collect(),
                successors: successors.into_iter().map(String::from).collect(),
            });
        }
        f.manifest(&serde_norway::to_string(&manifest).unwrap());
        assert!(codes(&f.load()).contains(&code.into()), "{code}");
    }
}
