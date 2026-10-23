use std::collections::{BTreeMap, VecDeque};
use std::ffi::{OsStr, OsString};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

pub const MAIN_WINDOW_LABEL: &str = "main";
pub const WINDOW_MODE_ARGUMENT: &str = "--mindflow-window-mode";
pub const RESTORE_WINDOWS_ARGUMENT: &str = "--mindflow-restore-windows";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WindowMode {
    Reuse,
    New,
}

impl WindowMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Reuse => "reuse",
            Self::New => "new",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WindowLaunch {
    pub mode: WindowMode,
    pub arguments: Vec<OsString>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RestoredWindow {
    pub paths: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProcessStartup {
    Ordinary(WindowLaunch),
    Restore(Vec<RestoredWindow>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OpenBatch {
    Startup(Vec<OsString>),
    Requested(Vec<OsString>),
}

pub fn parse_window_launch(arguments: Vec<OsString>) -> Result<WindowLaunch, String> {
    if arguments
        .first()
        .is_none_or(|argument| argument != OsStr::new(WINDOW_MODE_ARGUMENT))
    {
        return Ok(WindowLaunch {
            mode: WindowMode::Reuse,
            arguments,
        });
    }

    let Some(mode) = arguments.get(1).and_then(|value| value.to_str()) else {
        return Err(format!("{WINDOW_MODE_ARGUMENT} requires one UTF-8 mode"));
    };
    let mode = match mode {
        "reuse" => WindowMode::Reuse,
        "new" => WindowMode::New,
        _ => {
            return Err(format!("unsupported {WINDOW_MODE_ARGUMENT} value '{mode}'"));
        }
    };

    Ok(WindowLaunch {
        mode,
        arguments: arguments.into_iter().skip(2).collect(),
    })
}

pub fn parse_process_startup(arguments: Vec<OsString>) -> Result<ProcessStartup, String> {
    if arguments
        .first()
        .is_none_or(|argument| argument != OsStr::new(RESTORE_WINDOWS_ARGUMENT))
    {
        return parse_window_launch(arguments).map(ProcessStartup::Ordinary);
    }

    if arguments.len() != 2 {
        return Err(format!(
            "{RESTORE_WINDOWS_ARGUMENT} requires exactly one reconstruction plan"
        ));
    }
    let plan = arguments[1]
        .to_str()
        .ok_or_else(|| format!("{RESTORE_WINDOWS_ARGUMENT} must be valid UTF-8"))?;
    let windows = serde_json::from_str::<Vec<RestoredWindow>>(plan)
        .map_err(|error| format!("invalid {RESTORE_WINDOWS_ARGUMENT}: {error}"))?;
    if windows.is_empty() {
        return Err(format!(
            "{RESTORE_WINDOWS_ARGUMENT} must contain at least one window"
        ));
    }
    Ok(ProcessStartup::Restore(windows))
}

pub fn encode_restore_plan(windows: &[RestoredWindow]) -> Result<String, String> {
    if windows.is_empty() {
        return Err("cannot encode an empty Mindflow window reconstruction plan".to_owned());
    }
    serde_json::to_string(windows)
        .map_err(|error| format!("cannot encode Mindflow window reconstruction plan: {error}"))
}

#[derive(Debug, Default)]
struct WindowSession {
    pending: VecDeque<OpenBatch>,
    relaunch_paths: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderWindowSession {
    pub owner_window: String,
    pub root: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<String>,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fragment: Option<String>,
    pub interface_scale: f64,
}

#[derive(Debug, Default)]
struct ControllerState {
    windows: BTreeMap<String, WindowSession>,
    creation_order: Vec<String>,
    last_focused: Option<String>,
    readers: BTreeMap<String, ReaderWindowSession>,
    reader_focus_order: Vec<String>,
}

#[derive(Debug)]
pub struct DesktopController {
    next_window_id: AtomicU64,
    next_reader_id: AtomicU64,
    state: Mutex<ControllerState>,
}

impl DesktopController {
    pub fn with_main(initial: OpenBatch) -> Self {
        let mut main = WindowSession::default();
        main.pending.push_back(initial);
        let mut windows = BTreeMap::new();
        windows.insert(MAIN_WINDOW_LABEL.to_owned(), main);
        Self {
            next_window_id: AtomicU64::new(2),
            next_reader_id: AtomicU64::new(1),
            state: Mutex::new(ControllerState {
                windows,
                creation_order: vec![MAIN_WINDOW_LABEL.to_owned()],
                last_focused: Some(MAIN_WINDOW_LABEL.to_owned()),
                readers: BTreeMap::new(),
                reader_focus_order: Vec::new(),
            }),
        }
    }

    fn state(&self) -> Result<MutexGuard<'_, ControllerState>, String> {
        self.state
            .lock()
            .map_err(|_| "Mindflow desktop window controller is unavailable".to_owned())
    }

    pub fn allocate_window_label(&self) -> String {
        let id = self.next_window_id.fetch_add(1, Ordering::Relaxed);
        format!("workspace-{id}")
    }

    pub fn allocate_reader_label(&self) -> String {
        let id = self.next_reader_id.fetch_add(1, Ordering::Relaxed);
        format!("reader-{id}")
    }

    pub fn register_window(&self, label: String, initial: OpenBatch) -> Result<(), String> {
        let mut state = self.state()?;
        if state.windows.contains_key(&label) {
            return Err(format!("Mindflow window '{label}' is already registered"));
        }
        let mut session = WindowSession::default();
        session.pending.push_back(initial);
        state.windows.insert(label.clone(), session);
        state.creation_order.push(label.clone());
        state.last_focused = Some(label);
        Ok(())
    }

    pub fn remove_window(&self, label: &str) -> Result<Vec<String>, String> {
        let mut state = self.state()?;
        if state.windows.remove(label).is_some() {
            state.creation_order.retain(|candidate| candidate != label);
            if state.last_focused.as_deref() == Some(label) {
                state.last_focused = state.creation_order.last().cloned();
            }
            let dependent_readers = state
                .reader_focus_order
                .iter()
                .filter(|reader_label| {
                    state
                        .readers
                        .get(*reader_label)
                        .is_some_and(|reader| reader.owner_window == label)
                })
                .cloned()
                .collect::<Vec<_>>();
            for reader_label in &dependent_readers {
                state.readers.remove(reader_label);
            }
            state
                .reader_focus_order
                .retain(|reader_label| !dependent_readers.contains(reader_label));
            return Ok(dependent_readers);
        }

        state.readers.remove(label);
        state
            .reader_focus_order
            .retain(|candidate| candidate != label);
        Ok(Vec::new())
    }

    pub fn note_focused(&self, label: &str) -> Result<(), String> {
        let mut state = self.state()?;
        if state.windows.contains_key(label) {
            state.last_focused = Some(label.to_owned());
        } else if state.readers.contains_key(label) {
            state
                .reader_focus_order
                .retain(|candidate| candidate != label);
            state.reader_focus_order.push(label.to_owned());
        }
        Ok(())
    }

    pub fn has_workspace(&self, label: &str) -> Result<bool, String> {
        Ok(self.state()?.windows.contains_key(label))
    }

    pub fn register_reader(
        &self,
        label: String,
        session: ReaderWindowSession,
    ) -> Result<(), String> {
        let mut state = self.state()?;
        if !state.windows.contains_key(&session.owner_window) {
            return Err(format!(
                "Mindflow Reader owner '{}' has no active workspace session",
                session.owner_window
            ));
        }
        if state.readers.contains_key(&label) || state.windows.contains_key(&label) {
            return Err(format!("Mindflow window '{label}' is already registered"));
        }
        state.readers.insert(label.clone(), session);
        state.reader_focus_order.push(label);
        Ok(())
    }

    pub fn reader_session(&self, label: &str) -> Result<Option<ReaderWindowSession>, String> {
        Ok(self.state()?.readers.get(label).cloned())
    }

    pub fn update_reader(
        &self,
        label: &str,
        snapshot: Option<String>,
        path: String,
        fragment: Option<String>,
        interface_scale: f64,
    ) -> Result<ReaderWindowSession, String> {
        let mut state = self.state()?;
        let reader = state
            .readers
            .get_mut(label)
            .ok_or_else(|| format!("Mindflow Reader '{label}' has no active session"))?;
        reader.snapshot = snapshot;
        reader.path = path;
        reader.fragment = fragment;
        reader.interface_scale = interface_scale;
        let reader = reader.clone();
        state
            .reader_focus_order
            .retain(|candidate| candidate != label);
        state.reader_focus_order.push(label.to_owned());
        Ok(reader)
    }

    pub fn update_reader_snapshot(
        &self,
        label: &str,
        snapshot: Option<String>,
    ) -> Result<ReaderWindowSession, String> {
        let mut state = self.state()?;
        let reader = state
            .readers
            .get_mut(label)
            .ok_or_else(|| format!("Mindflow Reader '{label}' has no active session"))?;
        reader.snapshot = snapshot;
        Ok(reader.clone())
    }

    pub fn frontmost_reader(
        &self,
        owner_window: &str,
        root: &str,
    ) -> Result<Option<String>, String> {
        let state = self.state()?;
        Ok(state.reader_focus_order.iter().rev().find_map(|label| {
            state.readers.get(label).and_then(|reader| {
                (reader.owner_window == owner_window && reader.root == root).then(|| label.clone())
            })
        }))
    }

    pub fn reader_sessions_for(
        &self,
        owner_window: &str,
        root: &str,
    ) -> Result<Vec<(String, ReaderWindowSession)>, String> {
        let state = self.state()?;
        Ok(state
            .reader_focus_order
            .iter()
            .filter_map(|label| {
                state.readers.get(label).and_then(|reader| {
                    (reader.owner_window == owner_window && reader.root == root)
                        .then(|| (label.clone(), reader.clone()))
                })
            })
            .collect())
    }

    pub fn update_reader_scale(
        &self,
        owner_window: &str,
        root: &str,
        interface_scale: f64,
    ) -> Result<Vec<(String, ReaderWindowSession)>, String> {
        let mut state = self.state()?;
        let labels = state.reader_focus_order.clone();
        let mut updated = Vec::new();
        for label in labels {
            let Some(reader) = state.readers.get_mut(&label) else {
                continue;
            };
            if reader.owner_window != owner_window || reader.root != root {
                continue;
            }
            reader.interface_scale = interface_scale;
            updated.push((label, reader.clone()));
        }
        Ok(updated)
    }

    pub fn remove_reader(&self, label: &str) -> Result<Option<ReaderWindowSession>, String> {
        let mut state = self.state()?;
        let removed = state.readers.remove(label);
        state
            .reader_focus_order
            .retain(|candidate| candidate != label);
        Ok(removed)
    }

    pub fn remove_readers_for(
        &self,
        owner_window: &str,
        root: &str,
    ) -> Result<Vec<String>, String> {
        let mut state = self.state()?;
        let labels = state
            .reader_focus_order
            .iter()
            .filter(|label| {
                state.readers.get(*label).is_some_and(|reader| {
                    reader.owner_window == owner_window && reader.root == root
                })
            })
            .cloned()
            .collect::<Vec<_>>();
        for label in &labels {
            state.readers.remove(label);
        }
        state
            .reader_focus_order
            .retain(|candidate| !labels.contains(candidate));
        Ok(labels)
    }

    pub fn preferred_window_label(&self) -> Result<Option<String>, String> {
        let state = self.state()?;
        Ok(state
            .last_focused
            .as_ref()
            .filter(|label| state.windows.contains_key(*label))
            .cloned()
            .or_else(|| state.creation_order.last().cloned()))
    }

    pub fn enqueue_for_reuse(&self, batch: OpenBatch) -> Result<Option<String>, String> {
        let mut state = self.state()?;
        let target = state
            .last_focused
            .as_ref()
            .filter(|label| state.windows.contains_key(*label))
            .cloned()
            .or_else(|| state.creation_order.last().cloned());
        let Some(target) = target else {
            return Ok(None);
        };
        let Some(session) = state.windows.get_mut(&target) else {
            return Ok(None);
        };
        session.pending.push_back(batch);
        Ok(Some(target))
    }

    pub fn drain(&self, label: &str) -> Result<Vec<OpenBatch>, String> {
        let mut state = self.state()?;
        let session = state
            .windows
            .get_mut(label)
            .ok_or_else(|| format!("Mindflow window '{label}' has no active session"))?;
        Ok(session.pending.drain(..).collect())
    }

    pub fn update_relaunch_paths(&self, label: &str, paths: Vec<String>) -> Result<(), String> {
        let mut state = self.state()?;
        let session = state
            .windows
            .get_mut(label)
            .ok_or_else(|| format!("Mindflow window '{label}' has no active session"))?;
        session.relaunch_paths = paths;
        Ok(())
    }

    pub fn relaunch_plan(
        &self,
        requesting_label: &str,
        requesting_paths: Vec<String>,
    ) -> Result<Vec<RestoredWindow>, String> {
        let mut state = self.state()?;
        let requesting = state
            .windows
            .get_mut(requesting_label)
            .ok_or_else(|| format!("Mindflow window '{requesting_label}' has no active session"))?;
        requesting.relaunch_paths = requesting_paths;

        let mut labels = vec![requesting_label.to_owned()];
        labels.extend(
            state
                .creation_order
                .iter()
                .filter(|label| label.as_str() != requesting_label)
                .cloned(),
        );
        Ok(labels
            .into_iter()
            .filter_map(|label| state.windows.get(&label))
            .map(|session| RestoredWindow {
                paths: session.relaunch_paths.clone(),
            })
            .collect())
    }

    #[cfg(test)]
    fn labels(&self) -> Vec<String> {
        self.state()
            .map(|state| state.creation_order.clone())
            .unwrap_or_default()
    }

    #[cfg(test)]
    fn reader_labels(&self) -> Vec<String> {
        self.state()
            .map(|state| state.reader_focus_order.clone())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn requested(path: &str) -> OpenBatch {
        OpenBatch::Requested(vec![OsString::from(path)])
    }

    fn reader(owner_window: &str, root: &str, path: &str) -> ReaderWindowSession {
        ReaderWindowSession {
            owner_window: owner_window.to_owned(),
            root: root.to_owned(),
            snapshot: None,
            path: path.to_owned(),
            fragment: None,
            interface_scale: 1.0,
        }
    }

    #[test]
    fn launch_mode_is_explicit_and_defaults_to_reuse() {
        assert_eq!(
            parse_window_launch(vec![OsString::from("/one")]).unwrap(),
            WindowLaunch {
                mode: WindowMode::Reuse,
                arguments: vec![OsString::from("/one")],
            }
        );
        assert_eq!(
            parse_window_launch(vec![
                OsString::from(WINDOW_MODE_ARGUMENT),
                OsString::from("new"),
                OsString::from("/one"),
            ])
            .unwrap(),
            WindowLaunch {
                mode: WindowMode::New,
                arguments: vec![OsString::from("/one")],
            }
        );
        assert!(parse_window_launch(vec![
            OsString::from(WINDOW_MODE_ARGUMENT),
            OsString::from("sideways"),
        ])
        .is_err());
    }

    #[test]
    fn restore_plan_round_trips_exact_window_groups() {
        let windows = vec![
            RestoredWindow {
                paths: vec!["/active".to_owned(), "/peer".to_owned()],
            },
            RestoredWindow { paths: vec![] },
        ];
        let encoded = encode_restore_plan(&windows).unwrap();
        assert_eq!(
            parse_process_startup(vec![
                OsString::from(RESTORE_WINDOWS_ARGUMENT),
                OsString::from(encoded),
            ])
            .unwrap(),
            ProcessStartup::Restore(windows)
        );
    }

    #[test]
    fn pending_batches_are_window_scoped() {
        let controller = DesktopController::with_main(requested("/main"));
        controller
            .register_window("workspace-2".to_owned(), requested("/second"))
            .unwrap();

        assert_eq!(
            controller.drain(MAIN_WINDOW_LABEL).unwrap(),
            vec![requested("/main")]
        );
        assert_eq!(
            controller.drain("workspace-2").unwrap(),
            vec![requested("/second")]
        );
    }

    #[test]
    fn reuse_routing_follows_the_most_recently_focused_window() {
        let controller = DesktopController::with_main(requested("/main"));
        controller
            .register_window("workspace-2".to_owned(), requested("/second"))
            .unwrap();
        controller.note_focused(MAIN_WINDOW_LABEL).unwrap();

        assert_eq!(
            controller.preferred_window_label().unwrap(),
            Some(MAIN_WINDOW_LABEL.to_owned())
        );

        assert_eq!(
            controller.enqueue_for_reuse(requested("/reuse")).unwrap(),
            Some(MAIN_WINDOW_LABEL.to_owned())
        );
        assert_eq!(controller.drain(MAIN_WINDOW_LABEL).unwrap().len(), 2);
        assert_eq!(controller.drain("workspace-2").unwrap().len(), 1);
    }

    #[test]
    fn closing_one_window_preserves_peer_routing() {
        let controller = DesktopController::with_main(requested("/main"));
        controller
            .register_window("workspace-2".to_owned(), requested("/second"))
            .unwrap();
        controller.remove_window("workspace-2").unwrap();

        assert_eq!(controller.labels(), vec![MAIN_WINDOW_LABEL.to_owned()]);
        assert_eq!(
            controller.enqueue_for_reuse(requested("/reuse")).unwrap(),
            Some(MAIN_WINDOW_LABEL.to_owned())
        );
    }

    #[test]
    fn relaunch_plan_preserves_windows_and_puts_the_requester_first() {
        let controller = DesktopController::with_main(requested("/main"));
        controller
            .register_window("workspace-2".to_owned(), requested("/second"))
            .unwrap();
        controller
            .update_relaunch_paths(MAIN_WINDOW_LABEL, vec!["/main".to_owned()])
            .unwrap();

        assert_eq!(
            controller
                .relaunch_plan(
                    "workspace-2",
                    vec!["/second-active".to_owned(), "/second-peer".to_owned()],
                )
                .unwrap(),
            vec![
                RestoredWindow {
                    paths: vec!["/second-active".to_owned(), "/second-peer".to_owned()],
                },
                RestoredWindow {
                    paths: vec!["/main".to_owned()],
                },
            ]
        );
    }

    #[test]
    fn allocated_window_labels_are_unique_and_skip_the_main_label() {
        let controller = DesktopController::with_main(requested("/main"));
        assert_eq!(controller.allocate_window_label(), "workspace-2");
        assert_eq!(controller.allocate_window_label(), "workspace-3");
    }

    #[test]
    fn reader_labels_are_distinct_from_workspace_labels() {
        let controller = DesktopController::with_main(requested("/main"));
        assert_eq!(controller.allocate_reader_label(), "reader-1");
        assert_eq!(controller.allocate_reader_label(), "reader-2");
        assert_eq!(controller.allocate_window_label(), "workspace-2");
    }

    #[test]
    fn frontmost_reader_is_scoped_to_its_workspace_and_project() {
        let controller = DesktopController::with_main(requested("/main"));
        controller
            .register_window("workspace-2".to_owned(), requested("/second"))
            .unwrap();
        controller
            .register_reader(
                "reader-1".to_owned(),
                reader(MAIN_WINDOW_LABEL, "/one", "one.md"),
            )
            .unwrap();
        controller
            .register_reader(
                "reader-2".to_owned(),
                reader(MAIN_WINDOW_LABEL, "/two", "two.md"),
            )
            .unwrap();
        controller
            .register_reader(
                "reader-3".to_owned(),
                reader("workspace-2", "/one", "peer.md"),
            )
            .unwrap();
        controller
            .register_reader(
                "reader-4".to_owned(),
                reader(MAIN_WINDOW_LABEL, "/one", "latest.md"),
            )
            .unwrap();

        assert_eq!(
            controller
                .frontmost_reader(MAIN_WINDOW_LABEL, "/one")
                .unwrap(),
            Some("reader-4".to_owned())
        );
        controller.note_focused("reader-1").unwrap();
        assert_eq!(
            controller
                .frontmost_reader(MAIN_WINDOW_LABEL, "/one")
                .unwrap(),
            Some("reader-1".to_owned())
        );
        assert_eq!(
            controller.frontmost_reader("workspace-2", "/one").unwrap(),
            Some("reader-3".to_owned())
        );
    }

    #[test]
    fn reader_navigation_and_scale_updates_preserve_ownership() {
        let controller = DesktopController::with_main(requested("/main"));
        controller
            .register_reader(
                "reader-1".to_owned(),
                reader(MAIN_WINDOW_LABEL, "/one", "before.md"),
            )
            .unwrap();

        let updated = controller
            .update_reader(
                "reader-1",
                Some("sha256:reader-one".to_owned()),
                "after.md".to_owned(),
                Some("section".to_owned()),
                1.1,
            )
            .unwrap();
        assert_eq!(updated.path, "after.md");
        assert_eq!(updated.fragment.as_deref(), Some("section"));
        assert_eq!(updated.interface_scale, 1.1);
        assert_eq!(updated.owner_window, MAIN_WINDOW_LABEL);
        assert_eq!(updated.root, "/one");
        assert_eq!(updated.snapshot.as_deref(), Some("sha256:reader-one"));

        let refreshed = controller
            .update_reader_snapshot("reader-1", Some("sha256:reader-two".to_owned()))
            .unwrap();
        assert_eq!(refreshed.snapshot.as_deref(), Some("sha256:reader-two"));

        let scaled = controller
            .update_reader_scale(MAIN_WINDOW_LABEL, "/one", 1.3)
            .unwrap();
        assert_eq!(scaled.len(), 1);
        assert_eq!(scaled[0].1.path, "after.md");
        assert_eq!(scaled[0].1.interface_scale, 1.3);
    }

    #[test]
    fn closing_a_workspace_returns_only_its_dependent_readers() {
        let controller = DesktopController::with_main(requested("/main"));
        controller
            .register_window("workspace-2".to_owned(), requested("/second"))
            .unwrap();
        controller
            .register_reader(
                "reader-1".to_owned(),
                reader(MAIN_WINDOW_LABEL, "/one", "one.md"),
            )
            .unwrap();
        controller
            .register_reader(
                "reader-2".to_owned(),
                reader("workspace-2", "/two", "two.md"),
            )
            .unwrap();

        assert_eq!(
            controller.remove_window(MAIN_WINDOW_LABEL).unwrap(),
            vec!["reader-1".to_owned()]
        );
        assert_eq!(controller.reader_labels(), vec!["reader-2".to_owned()]);
        assert!(controller.reader_session("reader-1").unwrap().is_none());
        assert!(controller.reader_session("reader-2").unwrap().is_some());
    }

    #[test]
    fn disabling_reader_removes_only_the_matching_project_readers() {
        let controller = DesktopController::with_main(requested("/main"));
        controller
            .register_reader(
                "reader-1".to_owned(),
                reader(MAIN_WINDOW_LABEL, "/one", "one.md"),
            )
            .unwrap();
        controller
            .register_reader(
                "reader-2".to_owned(),
                reader(MAIN_WINDOW_LABEL, "/two", "two.md"),
            )
            .unwrap();

        assert_eq!(
            controller
                .remove_readers_for(MAIN_WINDOW_LABEL, "/one")
                .unwrap(),
            vec!["reader-1".to_owned()]
        );
        assert_eq!(controller.reader_labels(), vec!["reader-2".to_owned()]);
    }
}
