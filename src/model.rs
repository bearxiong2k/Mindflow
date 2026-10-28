use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub format: String,
    #[serde(rename = "adopted-release", default, skip_serializing_if = "Option::is_none")]
    pub adopted_release: Option<String>,
    pub components: BTreeMap<String, ComponentRegistration>,
    #[serde(rename = "historical-components", default, skip_serializing_if = "BTreeMap::is_empty")]
    pub historical_components: BTreeMap<String, HistoricalComponentDefinition>,
    #[serde(rename = "relationship-types", default)]
    pub relationship_types: BTreeMap<String, RelationshipTypeDefinition>,
    #[serde(default)]
    pub relationships: Vec<StructureRelationship>,
    #[serde(rename = "anchor-connection-types", default)]
    pub anchor_connection_types: BTreeMap<String, AnchorConnectionTypeDefinition>,
    #[serde(default)]
    pub opening: OpeningDefinition,
    #[serde(default)]
    pub evolve: EvolveDefinition,
    #[serde(default)]
    pub anchors: BTreeMap<String, AnchorDefinition>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ManifestHeader {
    pub format: serde_norway::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ComponentRegistration {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub index: bool,
}
fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RelationshipTypeDefinition {
    pub description: String,
    pub direction: DirectionConstraint,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DirectionConstraint {
    Directional,
    Bidirectional,
    Either,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AnchorConnectionTypeDefinition {
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AnchorDefinition {
    pub component: String,
    pub commit: String,
    #[serde(default)]
    pub connections: Vec<AnchorConnection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AnchorConnection {
    #[serde(rename = "type")]
    pub connection_type: String,
    pub target: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvolveEvent {
    pub component: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opening: Option<OpeningTransition>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpeningTransition {
    #[serde(default)]
    pub predecessors: Vec<String>,
    #[serde(default)]
    pub successors: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HistoricalComponentDefinition {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Exact document handle and authored grouping in one captured Region.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventView {
    pub component: String,
    pub name: String,
    pub file: String,
    pub content: crate::project::ContentHandle,
    pub children: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opening: Option<OpeningTransition>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpeningDefinition {
    #[serde(default)]
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvolveDefinition {
    #[serde(default)]
    pub events: Vec<EvolveEvent>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RelationshipDirection {
    SourceToTarget,
    Bidirectional,
}

impl RelationshipDirection {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SourceToTarget => "source-to-target",
            Self::Bidirectional => "bidirectional",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StructureRelationship {
    pub source: String,
    #[serde(rename = "type")]
    pub relationship_type: String,
    pub direction: RelationshipDirection,
    pub target: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    Directory,
    Document,
    Target,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ComponentAnnotation {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub index: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StructureNode {
    pub path: String,
    pub name: String,
    pub kind: EntryKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component: Option<ComponentAnnotation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document: Option<crate::project::DocumentHandle>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StructureProjection {
    pub nodes: Vec<StructureNode>,
    pub relationships: Vec<StructureRelationship>,
}

/// Adapter envelope: every semantic participant retains its stable identity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphData {
    pub format: String,
    pub structure: StructureProjection,
    pub relationship_types: BTreeMap<String, RelationshipTypeDefinition>,
    pub anchor_connection_types: BTreeMap<String, AnchorConnectionTypeDefinition>,
    pub documents: Vec<crate::project::DocumentHandle>,
    pub historical_components: BTreeMap<String, HistoricalComponentDefinition>,
    pub events: Vec<EventView>,
    pub anchors: BTreeMap<String, AnchorView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnchorView {
    #[serde(flatten)]
    pub definition: AnchorDefinition,
    pub file: String,
}
