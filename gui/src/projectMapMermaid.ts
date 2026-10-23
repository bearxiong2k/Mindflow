import type { ProjectMapMetrics } from "./projectMapMetrics";
import type {
  ProjectMapFocusProjection,
  ProjectMapProjectionLayer,
} from "./projectMapNavigation";
import { normalizeCanvasTextScale } from "./canvasTextScale.ts";
import { wrapLabelText } from "./textLayout.ts";
import {
  decideProjectMapLayout,
  type ProjectMapLayoutDecision,
} from "./projectMapLayoutPolicy.ts";
import type {
  ProjectComponent,
  ProjectMapDirection,
  ProjectMapRelationship,
} from "./types";

export type ProjectMapMermaidOrigin =
  | "root-overview"
  | "projected-scope";

export interface ProjectMapMermaidGraph {
  origin: ProjectMapMermaidOrigin;
  metrics?: ProjectMapMetrics;
  source: string;
  effectiveRoles: ReadonlyMap<string, string>;
  layout: ProjectMapLayoutDecision;
  nodeByKey: ReadonlyMap<string, ProjectComponent>;
  layerByKey: ReadonlyMap<string, ProjectComponent>;
  layerVisibleDepthByKey: ReadonlyMap<string, number>;
  // Rendered occurrence keys preserve exact local containment, including
  // contextual occurrences of the same component in different layers.
  parentLayerByKey?: ReadonlyMap<string, string | undefined>;
  keyByComponentId: ReadonlyMap<string, string>;
  connections: ProjectMapMermaidConnection[];
}

export interface ProjectMapMermaidConnection {
  family: "relationship";
  source: string;
  target: string;
  type: string;
  direction: ProjectMapRelationship["direction"];
  renderedSource: string;
  renderedTarget: string;
}

export function projectMapMermaidRenderedNodeId(renderedId: string) {
  return renderedId.match(/(?:^|-)flowchart-(.+)-\d+$/)?.[1];
}

const MERMAID_INITIALIZATION = `%%{init: {
  "flowchart": {
    "curve": "basis",
    "htmlLabels": false,
    "nodeSpacing": 38,
    "rankSpacing": 96,
    "padding": 20,
    "wrappingWidth": 1000000,
    "useMaxWidth": false
  },
  "themeVariables": {
    "background": "#ffffff",
    "primaryColor": "#f3f6fc",
    "primaryTextColor": "#14213d",
    "primaryBorderColor": "#7186a3",
    "lineColor": "#647187",
    "edgeLabelBackground": "#ffffff",
    "fontFamily": "Inter, ui-sans-serif, system-ui, sans-serif"
  }
}}%%`;

const MERMAID_OVERVIEW_INITIALIZATION = `%%{init: {
  "flowchart": {
    "curve": "basis",
    "padding": 20,
    "wrappingWidth": 1000000
  }
}}%%`;

const OPENING_CLASS =
  "  classDef opening stroke:#b65e14,stroke-width:2.5px,stroke-dasharray:6 2;";

function projectMapMermaidInitialization(overview = false) {
  return overview ? MERMAID_OVERVIEW_INITIALIZATION : MERMAID_INITIALIZATION;
}

function escapeMermaidText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\|/g, "&#124;")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

// Structure supplies explicit natural breaks before Mermaid measures geometry.
// Its default 200px greedy pass otherwise splits filenames inside words. Node
// wrapping is disabled in our generated diagram; edge labels still have that
// Mermaid gate, so their estimate leaves room for differences between fonts.
const NODE_LABEL_WIDTH = 13.6;
const RELATIONSHIP_LABEL_WIDTH = 12;

export function projectMapRoleLabel(component: ProjectComponent, folder?: string) {
  if (!component.managed) return "Unmanaged folder context";
  if (component.kind === "document" && folder) return `Folder: ${folder}`;
  return undefined;
}

function componentTitleLabel(component: ProjectComponent, textScale: number) {
  return wrapLabelText(
    component.label,
    NODE_LABEL_WIDTH / normalizeCanvasTextScale(textScale),
  )
    .map(escapeMermaidText)
    .join("<br/>");
}

export const PROJECT_MAP_METRIC_TREND_SPACE = "Volume · growth";
export const PROJECT_MAP_METRIC_SIZE_SPACE = "Documentation";

function componentLabel(
  component: ProjectComponent,
  textScale: number,
  metrics?: ProjectMapMetrics,
) {
  const titleLabel = componentTitleLabel(component, textScale);
  const metric = metrics?.byComponentId.get(component.id);
  const measurementLines = metric ? [metric.lineCountLabel, PROJECT_MAP_METRIC_TREND_SPACE, PROJECT_MAP_METRIC_SIZE_SPACE] : [];
  return [titleLabel, ...measurementLines.map(escapeMermaidText)].join("<br/>");
}

function relationshipLabel(type: string, textScale: number) {
  return wrapLabelText(
    type,
    RELATIONSHIP_LABEL_WIDTH / normalizeCanvasTextScale(textScale),
  )
    .map(escapeMermaidText)
    .join("<br/>");
}

function componentClass(component: ProjectComponent) {
  switch (component.kind) {
    case "directory":
      return "aggregate";
    case "document":
      return "document";
    case "target":
      return "external";
  }
}

function componentShape(component: ProjectComponent) {
  switch (component.kind) {
    case "directory":
      return "rounded";
    case "document":
      return "doc";
    case "target":
      return "notch-rect";
  }
}

function mermaidComponentNode(
  key: string,
  component: ProjectComponent,
  label: string,
) {
  return `${key}@{ shape: ${componentShape(component)}, label: "${label}" }`;
}

function uniqueComponents(components: readonly ProjectComponent[]) {
  const result: ProjectComponent[] = [];
  const seen = new Set<string>();
  for (const component of components) {
    if (seen.has(component.id)) continue;
    seen.add(component.id);
    result.push(component);
  }
  return result;
}

function mermaidDirection(direction: ProjectMapDirection) {
  return direction.toUpperCase();
}

export function reverseProjectMapDirection(
  direction: ProjectMapDirection,
): ProjectMapDirection {
  switch (direction) {
    case "lr":
      return "rl";
    case "rl":
      return "lr";
    case "bt":
      return "tb";
    case "tb":
    case "td":
      return "bt";
  }
}

function defaultProjectMapLayoutDirection(
  projection: ProjectMapFocusProjection,
): ProjectMapDirection {
  return projection.focus.parent === undefined ? projection.direction : "td";
}

function nestedProjectMapLayoutDirection(direction: ProjectMapDirection) {
  return direction === "bt" ? "BT" : "TB";
}

function mermaidRelationship(
  relationship: ProjectMapRelationship,
  source: string,
  target: string,
  textScale: number,
) {
  const label = relationshipLabel(relationship.type, textScale);
  if (relationship.line === "dotted") {
    return `  ${source} -. "${label}" .-> ${target}`;
  }
  const connector =
    relationship.direction === "bidirectional" ? "<-->" : "-->";
  return `  ${source} ${connector}|"${label}"| ${target}`;
}

function buildRootOverviewMermaidGraph(
  projection: ProjectMapFocusProjection,
  layoutDirection: ProjectMapDirection,
  layout: ProjectMapLayoutDecision,
  textScale: number,
  metrics?: ProjectMapMetrics,
): ProjectMapMermaidGraph {
  const components = uniqueComponents([
    ...projection.primary,
    ...projection.context,
  ]);
  const componentById = new Map(
    components.map((component) => [component.id, component]),
  );
  const nodeByKey = new Map<string, ProjectComponent>();
  const keyByComponentId = new Map<string, string>();
  components.forEach((component,index) => {
    const key = `pm${index}`;
    nodeByKey.set(key,component);
    keyByComponentId.set(component.id,key);
  });
  const declared = new Set<string>();
  const endpoint = (id: string) => {
    const component = componentById.get(id);
    const key = keyByComponentId.get(id);
    if (!component || !key) return undefined;
    if (declared.has(id)) return key;
    declared.add(id);
    return mermaidComponentNode(key,component,componentLabel(component, textScale, metrics));
  };
  const lines = [
    projectMapMermaidInitialization(true),
    `flowchart ${mermaidDirection(layoutDirection)}`,
  ];
  const connections: ProjectMapMermaidConnection[] = [];
  for (const relationship of projection.relationships) {
    const source = endpoint(relationship.source);
    const target = endpoint(relationship.target);
    if (!source || !target) continue;
    lines.push(
      mermaidRelationship(relationship, source, target, textScale),
    );
    connections.push({
      family: "relationship",
      ...relationship,
      renderedSource: keyByComponentId.get(relationship.source)!,
      renderedTarget: keyByComponentId.get(relationship.target)!,
    });
  }
  for (const component of components) {
    if (declared.has(component.id)) continue;
    const declaration = endpoint(component.id);
    if (declaration) lines.push(`  ${declaration}`);
  }
  const openingIds = new Set(projection.openingComponentIds);
  if (openingIds.size > 0) {
    lines.push(OPENING_CLASS);
    for (const component of components) {
      if (openingIds.has(component.id)) {
        lines.push(`  class ${keyByComponentId.get(component.id)} opening;`);
      }
    }
  }
  return {
    origin: "root-overview",
    source: `${lines.join("\n")}\n${metrics ? `%% QC ${metrics.key}\n` : ""}`,
    effectiveRoles: projection.effectiveRoles,
    metrics,
    layout,
    nodeByKey,
    layerByKey: new Map(),
    layerVisibleDepthByKey: new Map(),
    keyByComponentId,
    connections,
  };
}

function buildExpandedProjectMapMermaidGraph(
  projection: ProjectMapFocusProjection,
  layoutDirection: ProjectMapDirection,
  layout: ProjectMapLayoutDecision,
  textScale: number,
  metrics?: ProjectMapMetrics,
): ProjectMapMermaidGraph {
  const nodeByKey = new Map<string, ProjectComponent>();
  const layerByKey = new Map<string, ProjectComponent>();
  const layerVisibleDepthByKey = new Map<string, number>();
  const parentLayerByKey = new Map<string, string | undefined>();
  const keyByComponentId = new Map<string, string>();
  const connections: ProjectMapMermaidConnection[] = [];
  const nodeClasses = new Map<string, Set<string>>();
  const layerStyles = new Map<string, { opening: boolean }>();
  let sequence = 0;

  const projectionLayerVisibleDepth = (
    layer: ProjectMapProjectionLayer,
  ): number =>
    1 +
    Math.max(
      0,
      ...layer.expanded.map((expanded) =>
        projectionLayerVisibleDepth(expanded),
      ),
    );

  const nextKey = () => `pm${sequence++}`;
  const rememberComponentKey = (componentId: string, key: string) => {
    if (!keyByComponentId.has(componentId)) {
      keyByComponentId.set(componentId, key);
    }
  };
  const lines = [
    projectMapMermaidInitialization(),
    `flowchart ${mermaidDirection(layoutDirection)}`,
  ];

  const emitLayer = (
    layer: ProjectMapProjectionLayer,
    indentation: string,
    visibleDepth: number,
    parentKey?: string,
  ) => {
    const expandedById = new Map(
      layer.expanded.map((expanded) => [expanded.focus.id, expanded]),
    );
    const endpointByComponentId = new Map<string, string>();
    const contextIds = new Set(
      layer.context.map((component) => component.id),
    );
    const openingIds = new Set(layer.openingComponentIds);
    const components = uniqueComponents([
      ...layer.primary,
      ...layer.context,
    ]);
    for (const component of components) {
      const key = nextKey();
      parentLayerByKey.set(key, parentKey);
      endpointByComponentId.set(component.id, key);
      rememberComponentKey(component.id, key);
    }

    const emitNode = (
      component: ProjectComponent,
      key: string,
      nodeIndentation: string,
    ) => {
      nodeByKey.set(key, component);
      const classes = new Set([componentClass(component)]);
      if (contextIds.has(component.id)) classes.add("context");
      if (openingIds.has(component.id)) classes.add("opening");
      nodeClasses.set(key, classes);
      lines.push(
        `${nodeIndentation}${mermaidComponentNode(
          key,
          component,
          componentLabel(component, textScale, metrics),
        )}`,
      );
    };

    const emitComponent = (
      component: ProjectComponent,
      componentIndentation: string,
    ) => {
      const expanded = expandedById.get(component.id);
      const key = endpointByComponentId.get(component.id);
      if (!key) return;
      if (expanded) {
        const expandedVisibleDepth = Math.min(
          Math.max(1, visibleDepth - 1),
          projectionLayerVisibleDepth(expanded),
        );
        layerByKey.set(key, component);
        layerVisibleDepthByKey.set(key, expandedVisibleDepth);
        layerStyles.set(key, { opening: openingIds.has(component.id) });
        lines.push(
          `${componentIndentation}subgraph ${key}["${componentLabel(component, textScale, metrics)}"]`,
          `${componentIndentation}  direction ${nestedProjectMapLayoutDirection(
            layoutDirection,
          )}`,
        );
        emitLayer(
          expanded,
          `${componentIndentation}  `,
          expandedVisibleDepth,
          key,
        );
        lines.push(`${componentIndentation}end`);
        return;
      }
      emitNode(component, key, componentIndentation);
    };

    for (const component of components) {
      emitComponent(component, indentation);
    }

    for (const relationship of layer.relationships) {
      const source = endpointByComponentId.get(relationship.source);
      const target = endpointByComponentId.get(relationship.target);
      if (!source || !target) continue;
      lines.push(
        `${indentation}${mermaidRelationship(
          relationship,
          source,
          target,
          textScale,
        ).trimStart()}`,
      );
      connections.push({
        family: "relationship",
        ...relationship,
        renderedSource: source,
        renderedTarget: target,
      });
    }
  };

  emitLayer(projection, "  ", projection.depth);
  lines.push(
    "  classDef aggregate fill:#f3f6fc,stroke:#7186a3,color:#14213d,stroke-width:1px;",
    "  classDef document fill:#e6f5f3,stroke:#0a7c82,color:#14213d,stroke-width:1px;",
    "  classDef external fill:#f7edf6,stroke:#8e4f86,color:#14213d,stroke-width:1px;",
    "  classDef context stroke-dasharray:4 3;",
    OPENING_CLASS,
  );
  for (const [key, classes] of nodeClasses) {
    for (const className of classes) {
      lines.push(`  class ${key} ${className};`);
    }
  }
  for (const [key, style] of layerStyles) {
    if (style.opening) lines.push(`  class ${key} opening;`);
    lines.push(
      `  style ${key} fill:#fbfcfd,stroke:${
        style.opening ? "#b65e14" : "#8796a8"
      },stroke-width:${style.opening ? "2.5px" : "1.5px"},stroke-dasharray:${
        style.opening ? "6 2" : "7 5"
      }`,
    );
  }
  return {
    origin:
      projection.focus.parent === undefined ? "root-overview" : "projected-scope",
    source: `${lines.join("\n")}\n${metrics ? `%% QC ${metrics.key}\n` : ""}`,
    effectiveRoles: projection.effectiveRoles,
    metrics,
    layout,
    nodeByKey,
    layerByKey,
    layerVisibleDepthByKey,
    parentLayerByKey,
    keyByComponentId,
    connections,
  };
}

export function buildProjectMapMermaidGraph(
  projection: ProjectMapFocusProjection,
  layoutDirection: ProjectMapDirection = defaultProjectMapLayoutDirection(
    projection,
  ),
  textScale = 1,
  metrics?: ProjectMapMetrics,
): ProjectMapMermaidGraph {
  const layout = decideProjectMapLayout(projection);
  if (projection.expanded.length > 0) {
    return buildExpandedProjectMapMermaidGraph(
      projection,
      layoutDirection,
      layout,
      textScale,
      metrics,
    );
  }
  const focusIsRoot = projection.focus.parent === undefined;
  if (focusIsRoot) {
    return buildRootOverviewMermaidGraph(
      projection,
      layoutDirection,
      layout,
      textScale,
      metrics,
    );
  }
  const components = uniqueComponents([
    ...projection.primary,
    ...projection.context,
  ]);
  const nodeByKey = new Map<string, ProjectComponent>();
  const keyByComponentId = new Map<string, string>();
  for (const [index, component] of components.entries()) {
    const key = `pm${index}`;
    nodeByKey.set(key, component);
    keyByComponentId.set(component.id, key);
  }

  const lines = [
    projectMapMermaidInitialization(),
    `flowchart ${mermaidDirection(layoutDirection)}`,
  ];
  const connections: ProjectMapMermaidConnection[] = [];
  for (const [key, component] of nodeByKey) {
    lines.push(
      `  ${mermaidComponentNode(key, component, componentLabel(component, textScale, metrics))}`,
    );
  }

  for (const relationship of projection.relationships) {
    const source = keyByComponentId.get(relationship.source);
    const target = keyByComponentId.get(relationship.target);
    if (!source || !target) continue;
    lines.push(
      mermaidRelationship(relationship, source, target, textScale),
    );
    connections.push({
      family: "relationship",
      ...relationship,
      renderedSource: source,
      renderedTarget: target,
    });
  }

  lines.push(
    "  classDef aggregate fill:#f3f6fc,stroke:#7186a3,color:#14213d,stroke-width:1px;",
    "  classDef document fill:#e6f5f3,stroke:#0a7c82,color:#14213d,stroke-width:1px;",
    "  classDef external fill:#f7edf6,stroke:#8e4f86,color:#14213d,stroke-width:1px;",
    "  classDef context stroke-dasharray:4 3;",
    OPENING_CLASS,
  );
  const contextIds = new Set(projection.context.map((component) => component.id));
  const openingIds = new Set(projection.openingComponentIds);
  for (const [key, component] of nodeByKey) {
    lines.push(`  class ${key} ${componentClass(component)};`);
    if (contextIds.has(component.id)) lines.push(`  class ${key} context;`);
    if (openingIds.has(component.id)) lines.push(`  class ${key} opening;`);
  }

  return {
    origin: "projected-scope",
    source: `${lines.join("\n")}\n${metrics ? `%% QC ${metrics.key}\n` : ""}`,
    effectiveRoles: projection.effectiveRoles,
    metrics,
    layout,
    nodeByKey,
    layerByKey: new Map(),
    layerVisibleDepthByKey: new Map(),
    keyByComponentId,
    connections,
  };
}
