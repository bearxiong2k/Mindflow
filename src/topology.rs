use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};

pub use crate::model::StructureNode as TopologyNode;
use crate::model::{EntryKind, RelationshipDirection, StructureProjection, StructureRelationship};
use crate::project::{Diagnostic, SnapshotIdentity};
use crate::Project;

pub const TOPOLOGY_RESOLUTION_SCHEMA: &str = "mindflow-topology-resolution/v2";
pub const TOPOLOGY_CHILDREN_SCHEMA: &str = "mindflow-topology-children/v2";
pub const TOPOLOGY_INCIDENCES_SCHEMA: &str = "mindflow-topology-incidences/v2";
pub const TOPOLOGY_CONTENT_SCHEMA: &str = "mindflow-topology-content/v2";
pub const TOPOLOGY_VIEW_SCHEMA: &str = "mindflow-topology-view/v2";
pub const TOPOLOGY_PROBE_SCHEMA: &str = "mindflow-topology-probe/v2";
pub const DEFAULT_TOPOLOGY_PAGE_SIZE: usize = 64;
pub const MAX_TOPOLOGY_PAGE_SIZE: usize = 512;
pub const DEFAULT_TOPOLOGY_VIEW_DEPTH: usize = 1;
pub const MAX_TOPOLOGY_VIEW_DEPTH: usize = 16;
pub const DEFAULT_TOPOLOGY_VIEW_NODES: usize = 256;
pub const MAX_TOPOLOGY_VIEW_NODES: usize = 4096;

#[derive(Debug)]
pub enum TopologyError {
    CurrentInvalid(Vec<Diagnostic>),
    Runtime(anyhow::Error),
}

impl From<anyhow::Error> for TopologyError {
    fn from(error: anyhow::Error) -> Self {
        Self::Runtime(error)
    }
}

impl fmt::Display for TopologyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CurrentInvalid(_) => write!(formatter, "the current Mindflow project is invalid"),
            Self::Runtime(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for TopologyError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Runtime(error) => Some(error.as_ref()),
            Self::CurrentInvalid(_) => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TopologyMatch {
    Identity,
    Path,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TopologyQueryDirection {
    Outgoing,
    Incoming,
    Both,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TopologyIncidenceSide {
    Source,
    Target,
    Both,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TopologyResolution {
    pub schema: String,
    pub snapshot: SnapshotIdentity,
    pub address: String,
    pub matched_by: TopologyMatch,
    pub node: TopologyNode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TopologyChildrenPage {
    pub schema: String,
    pub snapshot: SnapshotIdentity,
    pub focus: TopologyNode,
    pub offset: usize,
    pub limit: usize,
    pub total: usize,
    pub children: Vec<TopologyNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TopologyIncidence {
    pub side: TopologyIncidenceSide,
    pub relationship: StructureRelationship,
    pub other: TopologyNode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TopologyIncidencePage {
    pub schema: String,
    pub snapshot: SnapshotIdentity,
    pub focus: TopologyNode,
    pub direction: TopologyQueryDirection,
    pub relationship_types: Vec<String>,
    pub offset: usize,
    pub limit: usize,
    pub total: usize,
    pub incidences: Vec<TopologyIncidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TopologyContent {
    pub schema: String,
    pub snapshot: SnapshotIdentity,
    pub node: TopologyNode,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TopologyViewNode {
    pub depth: usize,
    pub node: TopologyNode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TopologyView {
    pub schema: String,
    pub snapshot: SnapshotIdentity,
    pub focus: TopologyNode,
    pub depth: usize,
    pub max_nodes: usize,
    pub has_deeper: bool,
    pub nodes: Vec<TopologyViewNode>,
    pub relationships: Vec<StructureRelationship>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TopologyProbe {
    pub schema: String,
    pub snapshot: SnapshotIdentity,
    pub structure: TopologyView,
    pub incidences: Vec<TopologyIncidence>,
}

/// An immutable filesystem-derived Structure at one validated snapshot.
pub struct TopologySnapshot<'a> {
    project: &'a Project,
    snapshot: SnapshotIdentity,
    structure: StructureProjection,
    by_id: BTreeMap<String, usize>,
    by_path: BTreeMap<String, usize>,
    children: BTreeMap<String, Vec<usize>>,
}
impl<'a> TopologySnapshot<'a> {
    pub fn new(project: &'a Project) -> std::result::Result<Self, TopologyError> {
        let structure = project.structure().map_err(TopologyError::CurrentInvalid)?;
        let mut by_id = BTreeMap::new();
        let mut by_path = BTreeMap::new();
        let mut children = BTreeMap::<String, Vec<usize>>::new();
        for (i, node) in structure.nodes.iter().enumerate() {
            by_path.insert(node.path.clone(), i);
            if let Some(c) = &node.component {
                by_id.insert(c.id.clone(), i);
            }
            if let Some(parent) = &node.parent_path {
                children.entry(parent.clone()).or_default().push(i);
            }
        }
        for entries in children.values_mut() {
            entries.sort_by(|a, b| {
                structure.nodes[*a]
                    .name
                    .cmp(&structure.nodes[*b].name)
                    .then(structure.nodes[*a].path.cmp(&structure.nodes[*b].path))
            });
        }
        Ok(Self {
            project,
            snapshot: project.snapshot_identity().clone(),
            structure,
            by_id,
            by_path,
            children,
        })
    }
    fn resolve_index(&self, address: &str) -> Result<(usize, TopologyMatch)> {
        match (self.by_id.get(address), self.by_path.get(address)) {
            (None, None) => bail!("unknown topology address `{address}`"),
            (Some(a), Some(b)) if a != b => bail!("ambiguous topology address `{address}`"),
            (Some(a), _) => Ok((*a, TopologyMatch::Identity)),
            (None, Some(b)) => Ok((*b, TopologyMatch::Path)),
        }
    }
    fn focus_index(&self, address: Option<&str>) -> Result<usize> {
        match address {
            Some(a) => Ok(self.resolve_index(a)?.0),
            None => Ok(self.by_path["."]),
        }
    }
    fn node(&self, i: usize) -> TopologyNode {
        self.structure.nodes[i].clone()
    }
    pub fn resolve(&self, address: &str) -> Result<TopologyResolution> {
        let (index, matched_by) = self.resolve_index(address)?;
        Ok(TopologyResolution {
            schema: TOPOLOGY_RESOLUTION_SCHEMA.into(),
            snapshot: self.snapshot.clone(),
            address: address.into(),
            matched_by,
            node: self.node(index),
        })
    }
    pub fn list(
        &self,
        address: Option<&str>,
        offset: usize,
        limit: usize,
    ) -> Result<TopologyChildrenPage> {
        validate_page(limit)?;
        let focus = self.node(self.focus_index(address)?);
        let children = self
            .children
            .get(&focus.path)
            .map(Vec::as_slice)
            .unwrap_or_default();
        let total = children.len();
        validate_offset(offset, total)?;
        let end = offset.saturating_add(limit).min(total);
        Ok(TopologyChildrenPage {
            schema: TOPOLOGY_CHILDREN_SCHEMA.into(),
            snapshot: self.snapshot.clone(),
            focus,
            offset,
            limit,
            total,
            children: children[offset..end]
                .iter()
                .map(|i| self.node(*i))
                .collect(),
            next_offset: (end < total).then_some(end),
        })
    }
    pub fn read(&self, address: &str) -> Result<TopologyContent> {
        let node = self.node(self.resolve_index(address)?.0);
        let document = node
            .document
            .as_ref()
            .ok_or_else(|| anyhow!("`{address}` is not a managed Markdown document"))?;
        let content = self.project.read_managed_document(&document.path)?;
        Ok(TopologyContent {
            schema: TOPOLOGY_CONTENT_SCHEMA.into(),
            snapshot: self.snapshot.clone(),
            node,
            content,
        })
    }
    pub fn neighbors(
        &self,
        address: &str,
        direction: TopologyQueryDirection,
        relationship_types: Vec<String>,
        offset: usize,
        limit: usize,
    ) -> Result<TopologyIncidencePage> {
        validate_page(limit)?;
        let mut seen = BTreeSet::new();
        for name in &relationship_types {
            if !seen.insert(name) || !self.project.manifest.relationship_types.contains_key(name) {
                bail!("unknown or repeated relationship type `{name}`");
            }
        }
        let focus = self.node(self.resolve_index(address)?.0);
        let incidences = self.collect_incidences(&focus, direction, &relationship_types);
        let total = incidences.len();
        validate_offset(offset, total)?;
        let end = offset.saturating_add(limit).min(total);
        Ok(TopologyIncidencePage {
            schema: TOPOLOGY_INCIDENCES_SCHEMA.into(),
            snapshot: self.snapshot.clone(),
            focus,
            direction,
            relationship_types,
            offset,
            limit,
            total,
            incidences: incidences[offset..end].to_vec(),
            next_offset: (end < total).then_some(end),
        })
    }
    fn collect_incidences(
        &self,
        focus: &TopologyNode,
        direction: TopologyQueryDirection,
        types: &[String],
    ) -> Vec<TopologyIncidence> {
        let Some(component) = &focus.component else {
            return Vec::new();
        };
        self.structure
            .relationships
            .iter()
            .filter_map(|r| {
                if !types.is_empty() && !types.contains(&r.relationship_type) {
                    return None;
                }
                let source = r.source == component.id;
                let target = r.target == component.id;
                if !source && !target {
                    return None;
                }
                if r.direction != RelationshipDirection::Bidirectional
                    && match direction {
                        TopologyQueryDirection::Outgoing => !source,
                        TopologyQueryDirection::Incoming => !target,
                        TopologyQueryDirection::Both => false,
                    }
                {
                    return None;
                }
                let other = if source { &r.target } else { &r.source };
                Some(TopologyIncidence {
                    side: if source {
                        TopologyIncidenceSide::Source
                    } else {
                        TopologyIncidenceSide::Target
                    },
                    relationship: r.clone(),
                    other: self.node(self.by_id[other]),
                })
            })
            .collect()
    }
    pub fn view(
        &self,
        address: Option<&str>,
        depth: usize,
        max_nodes: usize,
    ) -> Result<TopologyView> {
        if depth > MAX_TOPOLOGY_VIEW_DEPTH {
            bail!("topology view depth exceeds {MAX_TOPOLOGY_VIEW_DEPTH}");
        }
        if max_nodes == 0 || max_nodes > MAX_TOPOLOGY_VIEW_NODES {
            bail!("topology node budget must be between 1 and {MAX_TOPOLOGY_VIEW_NODES}");
        }
        let focus = self.node(self.focus_index(address)?);
        let mut stack = vec![(self.by_path[&focus.path], 0)];
        let mut nodes = Vec::new();
        let mut has_deeper = false;
        while let Some((i, current_depth)) = stack.pop() {
            if nodes.len() == max_nodes {
                bail!("topology view exceeds its {max_nodes}-node budget");
            }
            let node = self.node(i);
            if let Some(children) = self.children.get(&node.path) {
                if current_depth < depth {
                    stack.extend(children.iter().rev().map(|i| (*i, current_depth + 1)));
                } else {
                    has_deeper |= !children.is_empty();
                }
            }
            nodes.push(TopologyViewNode {
                depth: current_depth,
                node,
            });
        }
        let visible = nodes
            .iter()
            .filter_map(|n| n.node.component.as_ref().map(|c| c.id.as_str()))
            .collect::<BTreeSet<_>>();
        let relationships = self
            .structure
            .relationships
            .iter()
            .filter(|r| visible.contains(r.source.as_str()) && visible.contains(r.target.as_str()))
            .cloned()
            .collect();
        Ok(TopologyView {
            schema: TOPOLOGY_VIEW_SCHEMA.into(),
            snapshot: self.snapshot.clone(),
            focus,
            depth,
            max_nodes,
            has_deeper,
            nodes,
            relationships,
        })
    }
    pub fn probe(
        &self,
        address: Option<&str>,
        depth: usize,
        max_nodes: usize,
    ) -> Result<TopologyProbe> {
        let structure = self.view(address, depth, max_nodes)?;
        if structure.focus.kind != EntryKind::Directory {
            bail!("topology probe requires a directory scope");
        }
        let incidences =
            self.collect_incidences(&structure.focus, TopologyQueryDirection::Both, &[]);
        let paths = structure
            .nodes
            .iter()
            .map(|n| n.node.path.as_str())
            .chain(incidences.iter().map(|i| i.other.path.as_str()))
            .collect::<BTreeSet<_>>();
        if paths.len() > max_nodes {
            bail!("topology probe exceeds its {max_nodes}-node budget after boundary peers");
        }
        Ok(TopologyProbe {
            schema: TOPOLOGY_PROBE_SCHEMA.into(),
            snapshot: self.snapshot.clone(),
            structure,
            incidences,
        })
    }
}
fn validate_page(limit: usize) -> Result<()> {
    if limit == 0 || limit > MAX_TOPOLOGY_PAGE_SIZE {
        bail!("topology page limit must be between 1 and {MAX_TOPOLOGY_PAGE_SIZE}, not {limit}");
    }
    Ok(())
}

fn validate_offset(offset: usize, total: usize) -> Result<()> {
    if offset > total {
        bail!("topology page offset {offset} exceeds total {total}");
    }
    Ok(())
}
