//! Runtime identity and explicit project adoption, independent of SOE.
use serde::{Deserialize, Serialize};

use crate::{project::CURRENT_FORMAT, Project};

pub const RELEASE: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeVersion {
    pub release: String,
    pub project_format: String,
    pub bridge_protocol: u32,
    pub source_digest: Option<String>,
    pub source_revision: Option<String>,
    pub built_at: Option<String>,
}

pub fn runtime_version() -> RuntimeVersion {
    RuntimeVersion {
        release: RELEASE.into(),
        project_format: CURRENT_FORMAT.into(),
        bridge_protocol: crate::bridge::PROTOCOL_VERSION,
        source_digest: option_env!("MINDFLOW_BUILD_SOURCE_DIGEST").map(str::to_owned),
        source_revision: option_env!("MINDFLOW_BUILD_REVISION").map(str::to_owned),
        built_at: option_env!("MINDFLOW_BUILD_UTC").map(str::to_owned),
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectVersion {
    pub format: Option<String>,
    pub adopted_release: Option<String>,
}

impl ProjectVersion {
    pub fn from_project(project: &Project) -> Self {
        Self {
            format: Some(project.manifest.format.clone()),
            adopted_release: project.manifest.adopted_release.clone(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct VersionReport {
    pub schema: &'static str,
    pub runtime: RuntimeVersion,
    pub project: ProjectVersion,
}

impl VersionReport {
    pub fn new(project: Option<&Project>) -> Self {
        Self {
            schema: "mindflow-version/v1",
            runtime: runtime_version(),
            project: project
                .map(ProjectVersion::from_project)
                .unwrap_or_default(),
        }
    }
}

pub fn is_calendar_release(value: &str) -> bool {
    let parts: Vec<_> = value.split('.').collect();
    if parts.len() != 3 || parts[0].len() != 4 {
        return false;
    }
    let parsed: Option<Vec<u32>> = parts
        .iter()
        .map(|part| {
            if part.is_empty() || part.starts_with('0') || !part.bytes().all(|b| b.is_ascii_digit())
            {
                None
            } else {
                part.parse().ok()
            }
        })
        .collect();
    let Some(numbers) = parsed else { return false };
    let (year, month, day) = (numbers[0], numbers[1], numbers[2]);
    let maximum = match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => return false,
    };
    day >= 1 && day <= maximum
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calendar_release_requires_an_exact_real_date() {
        for release in [RELEASE, "2026.1.1", "2028.2.29", "2000.2.29"] {
            assert!(is_calendar_release(release), "{release}");
        }
        for release in [
            "",
            "unknown",
            "0.1.0",
            "2026.02.2",
            "2026.2.29",
            "2026.4.31",
            "2026.10.20.1",
            "2026-10-27",
        ] {
            assert!(!is_calendar_release(release), "{release}");
        }
    }
}
