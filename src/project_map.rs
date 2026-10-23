//! Generated Mermaid views. No diagram is read as project authority.
use crate::model::{RelationshipDirection, StructureNode, StructureRelationship};
use crate::topology::{TopologyProbe, TopologyView};
use std::collections::{BTreeMap, BTreeSet};

pub fn view_mermaid(view: &TopologyView) -> String {
    render(view, &[], &[])
}
pub fn probe_mermaid(probe: &TopologyProbe) -> String {
    let visible = probe
        .structure
        .nodes
        .iter()
        .map(|n| n.node.path.as_str())
        .collect::<BTreeSet<_>>();
    let mut seen = BTreeSet::new();
    let extra = probe
        .incidences
        .iter()
        .filter(|i| !visible.contains(i.other.path.as_str()) && seen.insert(i.other.path.as_str()))
        .map(|i| i.other.clone())
        .collect::<Vec<_>>();
    let relations = probe
        .incidences
        .iter()
        .filter(|i| !probe.structure.relationships.contains(&i.relationship))
        .map(|i| i.relationship.clone())
        .collect::<Vec<_>>();
    render(&probe.structure, &extra, &relations)
}
fn render(
    view: &TopologyView,
    extra: &[StructureNode],
    relations: &[StructureRelationship],
) -> String {
    let nodes = view
        .nodes
        .iter()
        .map(|n| &n.node)
        .chain(extra)
        .collect::<Vec<_>>();
    let ids = nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.path.as_str(), format!("mf_view_{i}")))
        .collect::<BTreeMap<_, _>>();
    let component_paths = nodes
        .iter()
        .filter_map(|n| {
            n.component
                .as_ref()
                .map(|c| (c.id.as_str(), n.path.as_str()))
        })
        .collect::<BTreeMap<_, _>>();
    let mut output=format!("flowchart TD\n%% generated Mindflow Structure snapshot={}\n%% scope={} depth={} max_nodes={} has_deeper={}\n",view.snapshot.id,view.focus.path,view.depth,view.max_nodes,view.has_deeper);
    fn emit(
        output: &mut String,
        node: &StructureNode,
        nodes: &[&StructureNode],
        ids: &BTreeMap<&str, String>,
        indent: usize,
    ) {
        let prefix = "  ".repeat(indent);
        let id = &ids[node.path.as_str()];
        let children = nodes
            .iter()
            .filter(|n| n.parent_path.as_deref() == Some(node.path.as_str()))
            .collect::<Vec<_>>();
        let mut lines = vec![escape(&node.name), escape(&node.path)];
        if let Some(c) = &node.component {
            lines.push(escape(&c.id));
            if let Some(d) = &c.description {
                lines.push(escape(d));
            }
        } else {
            lines.push("unmanaged context".into());
        }
        let label = lines.join("<br/>");
        if children.is_empty() {
            output.push_str(&format!("{prefix}{id}[\"{label}\"]\n"));
        } else {
            output.push_str(&format!("{prefix}subgraph {id}[\"{label}\"]\n"));
            for child in children {
                emit(output, child, nodes, ids, indent + 1);
            }
            output.push_str(&format!("{prefix}end\n"));
        }
    }
    let hierarchy = view.nodes.iter().map(|n| &n.node).collect::<Vec<_>>();
    emit(&mut output, &view.focus, &hierarchy, &ids, 1);
    for node in extra {
        emit(&mut output, node, &[], &ids, 1);
    }
    for r in view.relationships.iter().chain(relations) {
        let arrow = match r.direction {
            RelationshipDirection::SourceToTarget => "-->",
            RelationshipDirection::Bidirectional => "<-->",
        };
        output.push_str(&format!(
            "  {} {arrow}|\"{}\"| {}\n",
            ids[component_paths[r.source.as_str()]],
            escape(&r.relationship_type),
            ids[component_paths[r.target.as_str()]]
        ));
    }
    output
}
fn escape(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '&' => "&amp;".into(),
            '<' => "&lt;".into(),
            '>' => "&gt;".into(),
            '"' => "&quot;".into(),
            '|' => "&#124;".into(),
            '%' => "&#37;".into(),
            '\r' | '\n' => " ".into(),
            c => c.to_string(),
        })
        .collect()
}
