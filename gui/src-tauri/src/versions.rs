use std::{collections::BTreeMap, fs, path::Path, process::Command};

use mindflow::version::{ProjectVersion, RuntimeVersion};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct AppVersion {
    pub release: String,
    pub variant: &'static str,
}

#[derive(Debug, Serialize)]
pub struct DesktopVersionInfo {
    pub app: AppVersion,
    pub local_core: RuntimeVersion,
    pub project_core: Option<RuntimeVersion>,
    pub project: ProjectVersion,
    pub local_update: LocalUpdate,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum LocalUpdate {
    Unknown,
    Current,
    Ready { release: String, built_at: String },
}

pub fn app_variant(identifier: &str) -> &'static str {
    for (base, variant) in [
        ("dev.mindflow.desktop.development", "development"),
        ("dev.mindflow.desktop", "stable"),
    ] {
        if identifier == base
            || identifier
                .strip_prefix(&format!("{base}.isolated-test."))
                .is_some_and(|namespace| {
                    !namespace.is_empty()
                        && namespace
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
                })
        {
            return variant;
        }
    }
    "unknown"
}

// Only the new, explicit version record participates in detection. An older
// record, raw build or incomplete synchronization has the same unknown state.
fn update_from_record(record: &str, running_digest: Option<&str>, variant: &str) -> LocalUpdate {
    let Some(running_digest) = running_digest.filter(|digest| !digest.is_empty()) else {
        return LocalUpdate::Unknown;
    };
    let mut fields = BTreeMap::new();
    for line in record.lines() {
        let Some((key, value)) = line.split_once(' ') else {
            return LocalUpdate::Unknown;
        };
        if value.is_empty() || value.trim() != value || fields.insert(key, value).is_some() {
            return LocalUpdate::Unknown;
        }
    }
    if fields.get("version-info") != Some(&"1")
        || fields.get("app-variant") != Some(&variant)
        || variant == "unknown"
        || super::parse_synchronized_app_executable(record).is_none()
    {
        return LocalUpdate::Unknown;
    }
    let (Some(release), Some(built_at), Some(digest)) = (
        fields.get("release"),
        fields.get("built-at"),
        fields.get("source-digest"),
    ) else {
        return LocalUpdate::Unknown;
    };
    if !mindflow::version::is_calendar_release(release) {
        return LocalUpdate::Unknown;
    }
    if *digest == running_digest {
        LocalUpdate::Current
    } else {
        LocalUpdate::Ready {
            release: release.to_string(),
            built_at: built_at.to_string(),
        }
    }
}

pub fn local_update(running_digest: Option<&str>, variant: &str) -> LocalUpdate {
    let Ok(record) = fs::read_to_string(super::synchronization_record_path()) else {
        return LocalUpdate::Unknown;
    };
    let update = update_from_record(&record, running_digest, variant);
    if update == LocalUpdate::Unknown {
        return update;
    }
    // Reuse the exact artifact/source/identity check used by the launcher.
    // A record left by a stale or interrupted build is not an available update.
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/sync-local-app.sh");
    let valid = Command::new("bash")
        .arg(script)
        .args(["--check", "--quiet"])
        .output()
        .is_ok_and(|output| output.status.success());
    if valid {
        update
    } else {
        LocalUpdate::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record() -> String {
        "version-info 1\nrelease 2026.10.20\napp-variant development\nsource-digest next\nbuilt-at 2026-10-27T10:00:00Z\napp-executable target/release/bundle/macos/Mind Dev.app/Contents/MacOS/mindflow-desktop\n".into()
    }

    #[test]
    fn update_detection_requires_explicit_known_matching_identity() {
        assert_eq!(
            update_from_record(&record(), Some("next"), "development"),
            LocalUpdate::Current
        );
        assert!(matches!(
            update_from_record(&record(), Some("old"), "development"),
            LocalUpdate::Ready { .. }
        ));
        for source in [
            record().replace("version-info 1\n", ""),
            record().replace("release 2026.10.20", "release 0.1.0"),
            record().replace("source-digest next\n", ""),
            format!("{}source-digest duplicate\n", record()),
            record().replace("target/release", "../target/release"),
        ] {
            assert_eq!(
                update_from_record(&source, Some("old"), "development"),
                LocalUpdate::Unknown
            );
        }
        assert_eq!(
            update_from_record(&record(), None, "development"),
            LocalUpdate::Unknown
        );
        assert_eq!(
            update_from_record(&record(), Some("next"), "stable"),
            LocalUpdate::Unknown
        );
    }

    #[test]
    fn variant_uses_only_the_declared_identifier() {
        assert_eq!(app_variant("dev.mindflow.desktop"), "stable");
        assert_eq!(
            app_variant("dev.mindflow.desktop.development"),
            "development"
        );
        assert_eq!(
            app_variant("dev.mindflow.desktop.isolated-test.window-1"),
            "stable"
        );
        for identifier in [
            "Mind Dev",
            "main",
            "dev.mindflow.desktop.other",
            "dev.mindflow.desktop.isolated-test.",
        ] {
            assert_eq!(app_variant(identifier), "unknown");
        }
    }
}
