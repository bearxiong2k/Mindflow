use serde::{Deserialize, Serialize};

use crate::model::{AnchorConnection, EvolveEvent};
use crate::project::RegionIndex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Opening {
    pub files: Vec<OpeningFile>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct OpeningFile {
    pub path: String,
    pub component: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvolveFlow {
    pub events: Vec<EvolveEvent>,
}

#[derive(Debug, Clone)]
pub struct HistoricalSelectionRequest {
    pub concern: String,
    pub sources: Vec<TemporalSourceRequest>,
    pub anchors: Vec<String>,
    pub instructions: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct TemporalSourceRequest {
    pub revision: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum TemporalSourceProvenance {
    Source {
        requested_revision: String,
    },
    Anchor {
        name: String,
        #[serde(rename = "type")]
        connection_type: String,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct TemporalSource {
    pub commit: String,
    pub path: String,
    pub provenance: Vec<TemporalSourceProvenance>,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SelectedAnchor {
    pub name: String,
    pub file: String,
    pub commit: String,
    pub connections: Vec<AnchorConnection>,
}

#[derive(Debug, Serialize)]
pub struct HistoricalContext {
    pub selected_anchors: Vec<SelectedAnchor>,
    pub sources: Vec<TemporalSource>,
}

#[derive(Debug, Serialize)]
pub struct CurrentContext {
    pub region: RegionIndex,
}

#[derive(Debug, Serialize)]
pub struct HistoricalSelection {
    pub concern: String,
    pub instructions: Vec<String>,
    pub historical: HistoricalContext,
    pub current: CurrentContext,
}
