import { documentDirectory, documentRelationships } from "./types.ts";
import type {
  ExternalTarget,
  GraphData,
  GraphRelationship,
  ManagedDocument,
} from "./types.ts";
import { externalTargetLabel, isExternalTarget } from "./types.ts";

export const GRAPH_WIDTH = 980;
export const GRAPH_HEIGHT = 780;
export const GRAPH_CENTER = { x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 + 8 };
export const ROLE_INNER_RADIUS = 168;
export const RADIAL_ROLE_LABEL_CLEARANCE = 12;
export const ROLE_OUTER_RADIUS = 197;
export const DIRECTORY_INNER_RADIUS = 204;
export const DIRECTORY_OUTER_RADIUS = 242;
export const LEAF_RADIUS = 278;
export const EXTERNAL_RADIUS = 354;
export const RING_LEAF_NODE_SIZES = {
  default: 16,
  related: 20,
  emphasized: 24,
} as const;
export const RING_EXTERNAL_NODE_RADIUS = 10;
export const MAP_NODE_LABEL_FONT_SIZE = 10;
export const MAP_ROLE_LABEL_FONT_SIZE = 11;
export const RADIAL_RELATIONSHIP_MARKER_SIZES = {
  ring: 6,
  graph: 8,
} as const;

const TAU = Math.PI * 2;
const RING_LEAF_STROKE_MARGIN = 1.1;
const RING_EXTERNAL_STROKE_MARGIN = 1.3;
const RING_MARKER_TIP_OVERHANG = 1.5;

export interface LeafLayout {
  document: ManagedDocument;
  directory: string;
  angle: number;
  interval: number;
  point: Point;
}

export interface DirectoryLayout {
  key: string;
  name: string;
  role: string;
  startAngle: number;
  endAngle: number;
  index: number;
}

export interface RadialRoleLayer {
  role: string;
  startAngle: number;
  endAngle: number;
  index: number;
  count: number;
}

export interface RadialRoleLabelLayout {
  role: string;
  side: "left" | "right";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ExternalLayout {
  key: string;
  target: ExternalTarget;
  label: string;
  angle: number;
  point: Point;
}

export interface RadialLayout {
  leaves: LeafLayout[];
  leafByPath: Map<string, LeafLayout>;
  directories: DirectoryLayout[];
  cyclicRoleLayers: RadialRoleLayer[];
  externalTargets: ExternalLayout[];
  externalByKey: Map<string, ExternalLayout>;
  roleLayers?: GraphRoleLayer[];
}

export interface NodeLayout {
  leaves: LeafLayout[];
  leafByPath: Map<string, LeafLayout>;
  externalTargets: ExternalLayout[];
  externalByKey: Map<string, ExternalLayout>;
  roleLayers?: GraphRoleLayer[];
}

export interface GraphRoleLayer {
  key: string;
  label: string;
  kind: "role" | "external";
  count: number;
  bounds: LayoutBounds;
}

export interface GraphLayoutOptions {
  roleOrder?: readonly string[];
  visibleRoles?: ReadonlySet<string>;
  includeExternalTargets?: boolean;
}

export interface RadialLayoutOptions {
  roleOrder?: readonly string[];
  visibleRoles?: ReadonlySet<string>;
  includeExternalTargets?: boolean;
}

export type LayerDropPlacement = "before" | "after";

export interface RelationshipStyle {
  color: string;
  label: string;
}

export interface RoleColorStyle {
  sector: string;
  directory: string;
  node: string;
  stroke: string;
  text: string;
}

export interface RelationshipTypeSections {
  relationships: string[];
}

const relationshipPalette = [
  "#285cc4",
  "#b5473e",
  "#6c54b2",
  "#2f7a54",
  "#8e4f86",
  "#0a7c82",
  "#a46b0a",
  "#4f669d",
  "#5c7b2f",
  "#8b4f37",
  "#526777",
  "#87589e",
];

export function relationshipStyle(type: string): RelationshipStyle {
  return {
    color: relationshipPalette[stableHash(type) % relationshipPalette.length],
    label: type,
  };
}

export function relationshipTypeSections(
  definitions: GraphData["relationship_types"],
): RelationshipTypeSections {
  return { relationships: Object.keys(definitions) };
}

export function relationshipMarkerId(type: string): string {
  const slug = type.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return `arrow-${slug}-${stableHash(type).toString(16)}`;
}

export function pointAt(angle: number, radius: number): Point {
  return {
    x: GRAPH_CENTER.x + Math.cos(angle) * radius,
    y: GRAPH_CENTER.y + Math.sin(angle) * radius,
  };
}

export function annularPath(
  startAngle: number,
  endAngle: number,
  innerRadius: number,
  outerRadius: number,
): string {
  const outerStart = pointAt(startAngle, outerRadius);
  const outerEnd = pointAt(endAngle, outerRadius);
  const innerEnd = pointAt(endAngle, innerRadius);
  const innerStart = pointAt(startAngle, innerRadius);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

export function externalTargetKey(target: ExternalTarget): string {
  return `path:${target.path}`;
}

export function relationshipIdentity(
  relationship: GraphRelationship,
): string {
  const target =
    typeof relationship.target === "string"
      ? `document:${relationship.target}`
      : externalTargetKey(relationship.target);
  return JSON.stringify([
    relationship.source,
    relationship.type,
    relationship.direction,
    target,
  ]);
}

export function buildRadialRoleLabelLayout(
  layers: readonly RadialRoleLayer[],
  textScale = 1,
): RadialRoleLabelLayout[] {
  const placed: RadialRoleLabelLayout[] = [];
  return layers.map((layer) => {
    const midpoint = (layer.startAngle + layer.endAngle) / 2;
    const span = layer.endAngle - layer.startAngle;
    const candidateAngles = [
      midpoint,
      ...Array.from(
        { length: 25 },
        (_, index) => layer.startAngle + span * ((index + 0.5) / 25),
      ),
    ];
    const width = Math.max(
      32,
      layer.role.length * MAP_ROLE_LABEL_FONT_SIZE * 0.58 * textScale,
    );
    const height = MAP_ROLE_LABEL_FONT_SIZE * 1.25 * textScale;
    let best:
      | {
          label: RadialRoleLabelLayout;
          overlap: number;
          displacement: number;
        }
      | undefined;

    for (const angle of candidateAngles) {
      const attachment = pointAt(angle, ROLE_INNER_RADIUS);
      const label: RadialRoleLabelLayout = {
        role: layer.role,
        side: Math.cos(angle) < 0 ? "left" : "right",
        x: attachment.x,
        y: attachment.y,
        width,
        height,
      };
      const overlap = placed.reduce(
        (sum, other) => sum + radialRoleLabelOverlap(label, other),
        0,
      );
      const displacement = Math.abs(angle - midpoint);
      if (
        !best ||
        overlap < best.overlap - 0.001 ||
        (Math.abs(overlap - best.overlap) < 0.001 &&
          displacement < best.displacement)
      ) {
        best = { label, overlap, displacement };
      }
    }

    const label = best?.label ?? {
      role: layer.role,
      side: Math.cos(midpoint) < 0 ? ("left" as const) : ("right" as const),
      ...pointAt(midpoint, ROLE_INNER_RADIUS),
      width,
      height,
    };
    placed.push(label);
    return label;
  });
}

function radialRoleLabelOverlap(
  left: RadialRoleLabelLayout,
  right: RadialRoleLabelLayout,
) {
  const leftBounds = radialRoleLabelBounds(left);
  const rightBounds = radialRoleLabelBounds(right);
  const horizontal = Math.max(
    0,
    Math.min(leftBounds.right, rightBounds.right) -
      Math.max(leftBounds.left, rightBounds.left) +
      RADIAL_ROLE_LABEL_CLEARANCE,
  );
  const vertical = Math.max(
    0,
    Math.min(leftBounds.bottom, rightBounds.bottom) -
      Math.max(leftBounds.top, rightBounds.top) +
      RADIAL_ROLE_LABEL_CLEARANCE,
  );
  return horizontal * vertical;
}

function radialRoleLabelBounds(label: RadialRoleLabelLayout) {
  return {
    left: label.side === "left" ? label.x : label.x - label.width,
    right: label.side === "left" ? label.x + label.width : label.x,
    top: label.y - label.height / 2,
    bottom: label.y + label.height / 2,
  };
}

export function buildRadialLayout(
  graph: GraphData,
  options: RadialLayoutOptions = {},
): RadialLayout {
  const documents = graph.documents
    .filter(
      (document) =>
        options.visibleRoles === undefined ||
        options.visibleRoles.has(documentDirectory(document)),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  const byRole = new Map<string, ManagedDocument[]>();
  for (const document of documents) {
    const existing = byRole.get(documentDirectory(document));
    if (existing) existing.push(document);
    else byRole.set(documentDirectory(document), [document]);
  }

  const roles = orderedGraphRoles(graph, options.roleOrder).filter((role) =>
    byRole.has(role),
  );
  const roleGap =
    roles.length > 1 ? Math.min(0.085, 0.58 / roles.length) : 0;
  const usableAngle = TAU - roleGap * roles.length;
  let cursor = -Math.PI / 2;
  const cyclicRoleLayers: RadialRoleLayer[] = [];
  const directories: DirectoryLayout[] = [];
  const leaves: LeafLayout[] = [];

  let directoryIndex = 0;
  roles.forEach((role, roleIndex) => {
    const roleDocuments = [...(byRole.get(role) ?? [])].sort((left, right) =>
      left.path.localeCompare(right.path),
    );
    const roleSpan = usableAngle * (roleDocuments.length / documents.length);
    const roleStartAngle = cursor;
    const roleEndAngle = roleStartAngle + roleSpan;
    cyclicRoleLayers.push({
      role,
      startAngle: roleStartAngle,
      endAngle: roleEndAngle,
      index: roleIndex,
      count: roleDocuments.length,
    });

    const byDirectory = new Map<string, ManagedDocument[]>();
    for (const document of roleDocuments) {
      const pieces = document.path.split("/");
      const directory = pieces.length > 1 ? pieces[0] : ".";
      const existing = byDirectory.get(directory);
      if (existing) existing.push(document);
      else byDirectory.set(directory, [document]);
    }
    const directoryEntries = [...byDirectory.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    );
    const directoryGap =
      directoryEntries.length > 1
        ? Math.min(0.024, roleSpan * 0.1 / directoryEntries.length)
        : 0;
    const directoryAngle = Math.max(
      0,
      roleSpan - directoryGap * Math.max(directoryEntries.length - 1, 0),
    );
    let directoryCursor = roleStartAngle;

    for (const [directory, members] of directoryEntries) {
      const directorySpan =
        directoryAngle * (members.length / roleDocuments.length);
      const startAngle = directoryCursor;
      const endAngle = startAngle + directorySpan;
      const interval = directorySpan / members.length;
      directories.push({
        key: `${role}\u001f${directory}`,
        name: directory,
        role,
        startAngle,
        endAngle,
        index: directoryIndex,
      });
      directoryIndex += 1;
      members.forEach((document, memberIndex) => {
        const angle = startAngle + interval * (memberIndex + 0.5);
        leaves.push({
          document,
          directory,
          angle,
          interval,
          point: pointAt(angle, LEAF_RADIUS),
        });
      });
      directoryCursor = endAngle + directoryGap;
    }
    cursor = roleEndAngle + roleGap;
  });

  const leafByPath = new Map(leaves.map((leaf) => [leaf.document.path, leaf]));
  const externalByKey = new Map<string, ExternalLayout>();
  const perSourceCounts = new Map<string, number>();

  if (options.includeExternalTargets !== false) {
    for (const relationship of documentRelationships(graph)) {
      if (!isExternalTarget(relationship.target)) continue;
      const key = externalTargetKey(relationship.target);
      if (externalByKey.has(key)) continue;
      const source = leafByPath.get(relationship.source);
      if (!source) continue;
      const sourceCount = perSourceCounts.get(relationship.source) ?? 0;
      perSourceCounts.set(relationship.source, sourceCount + 1);
      const angle = source.angle + (sourceCount - 0.5) * 0.055;
      externalByKey.set(key, {
        key,
        target: relationship.target,
        label: externalTargetLabel(relationship.target),
        angle,
        point: pointAt(angle, EXTERNAL_RADIUS),
      });
    }
  }

  return {
    leaves,
    leafByPath,
    directories,
    cyclicRoleLayers,
    externalTargets: [...externalByKey.values()],
    externalByKey,
  };
}

interface SimulationNode {
  key: string;
  x: number;
  y: number;
}

const graphBounds = {
  left: 28,
  right: GRAPH_WIDTH - 28,
  top: 28,
  bottom: GRAPH_HEIGHT - 28,
};

export interface LayoutBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface RoleLayerWorkingSet {
  key: string;
  label: string;
  kind: "role" | "external";
  members: number[];
  desiredHeight: number;
}

const ROLE_LAYER_GAP = 7;
const ROLE_LABEL_WIDTH = 162;
const ROLE_LAYER_MAX_COLUMNS = 6;
const ROLE_LAYER_BASE_HEIGHT = 32;
const ROLE_LAYER_ROW_HEIGHT = 26;
const ROLE_LAYER_NODE_PADDING = 11;

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function roleColorStyle(role: string): RoleColorStyle {
  const hue = stableHash(`mindflow-role:${role}`) % 360;
  return {
    sector: `hsl(${hue} 44% 88%)`,
    directory: `hsl(${hue} 32% 95%)`,
    node: `hsl(${hue} 48% 49%)`,
    stroke: `hsl(${hue} 42% 34%)`,
    text: `hsl(${hue} 38% 27%)`,
  };
}

function orderLayerMembers(
  nodes: SimulationNode[],
  layers: RoleLayerWorkingSet[],
  edges: ReadonlyArray<readonly [number, number]>,
): void {
  const adjacency = nodes.map(() => new Set<number>());
  for (const [source, target] of edges) {
    adjacency[source].add(target);
    adjacency[target].add(source);
  }

  const layerByNode = new Map<number, number>();
  const horizontalRank = new Map<number, number>();
  for (const [layerIndex, layer] of layers.entries()) {
    layer.members.sort((left, right) =>
      nodes[left].key.localeCompare(nodes[right].key),
    );
    for (const [memberIndex, nodeIndex] of layer.members.entries()) {
      layerByNode.set(nodeIndex, layerIndex);
      horizontalRank.set(
        nodeIndex,
        (memberIndex + 0.5) / Math.max(layer.members.length, 1),
      );
    }
  }

  for (let pass = 0; pass < 6; pass += 1) {
    const layerOrder =
      pass % 2 === 0 ? layers : [...layers].reverse();
    for (const layer of layerOrder) {
      const layerIndex = layers.indexOf(layer);
      const barycenter = (nodeIndex: number): number | undefined => {
        const neighborRanks = [...adjacency[nodeIndex]].flatMap((neighbor) =>
          layerByNode.get(neighbor) === layerIndex
            ? []
            : [horizontalRank.get(neighbor) ?? 0.5],
        );
        if (neighborRanks.length === 0) return undefined;
        return (
          neighborRanks.reduce((sum, rank) => sum + rank, 0) /
          neighborRanks.length
        );
      };

      layer.members.sort((left, right) => {
        const leftCenter = barycenter(left);
        const rightCenter = barycenter(right);
        if (leftCenter === undefined && rightCenter !== undefined) return 1;
        if (leftCenter !== undefined && rightCenter === undefined) return -1;
        if (leftCenter !== undefined && rightCenter !== undefined) {
          const difference = leftCenter - rightCenter;
          if (Math.abs(difference) > 0.0001) return difference;
        }
        return nodes[left].key.localeCompare(nodes[right].key);
      });
      for (const [memberIndex, nodeIndex] of layer.members.entries()) {
        horizontalRank.set(
          nodeIndex,
          (memberIndex + 0.5) / Math.max(layer.members.length, 1),
        );
      }
    }
  }
}

function assignRoleLayerGeometry(
  nodes: SimulationNode[],
  layers: RoleLayerWorkingSet[],
): GraphRoleLayer[] {
  if (layers.length === 0) return [];

  const totalHeight = graphBounds.bottom - graphBounds.top;
  const layerGap = Math.min(
    ROLE_LAYER_GAP,
    totalHeight / Math.max(layers.length * 4, 1),
  );
  const availableHeight =
    totalHeight - layerGap * Math.max(layers.length - 1, 0);
  const desiredHeight = layers.reduce(
    (sum, layer) => sum + layer.desiredHeight,
    0,
  );
  let cursor = graphBounds.top;

  return layers.map((layer, layerIndex) => {
    const height =
      layerIndex === layers.length - 1
        ? graphBounds.bottom - cursor
        : availableHeight * (layer.desiredHeight / desiredHeight);
    const bounds = {
      left: graphBounds.left,
      right: graphBounds.right,
      top: cursor,
      bottom: cursor + height,
    };
    cursor = bounds.bottom + layerGap;

    const columns = Math.min(
      ROLE_LAYER_MAX_COLUMNS,
      Math.max(layer.members.length, 1),
    );
    const rows = Math.max(Math.ceil(layer.members.length / columns), 1);
    const nodeBounds = {
      left: bounds.left + ROLE_LABEL_WIDTH,
      right: bounds.right - ROLE_LAYER_NODE_PADDING,
      top: bounds.top + ROLE_LAYER_NODE_PADDING,
      bottom: bounds.bottom - ROLE_LAYER_NODE_PADDING,
    };
    const width = Math.max(nodeBounds.right - nodeBounds.left, 1);
    const innerHeight = Math.max(nodeBounds.bottom - nodeBounds.top, 1);

    for (const [memberIndex, nodeIndex] of layer.members.entries()) {
      const row = Math.floor(memberIndex / columns);
      const rowStart = row * columns;
      const columnsInRow = Math.min(columns, layer.members.length - rowStart);
      const column = memberIndex - rowStart;
      nodes[nodeIndex].x =
        nodeBounds.left + width * ((column + 0.5) / columnsInRow);
      nodes[nodeIndex].y =
        nodeBounds.top + innerHeight * ((row + 0.5) / rows);
    }

    return {
      key: layer.key,
      label: layer.label,
      kind: layer.kind,
      count: layer.members.length,
      bounds,
    };
  });
}

export function graphRoleNames(graph: GraphData): string[] {
  return [...new Set(graph.documents.map(documentDirectory))].sort();
}

export function reorderLayerOrder(
  order: string[],
  source: string,
  target: string,
  placement: LayerDropPlacement,
): string[] {
  const sourceIndex = order.indexOf(source);
  if (sourceIndex < 0 || source === target || !order.includes(target)) {
    return order;
  }

  const next = [...order];
  next.splice(sourceIndex, 1);
  const targetIndex = next.indexOf(target);
  next.splice(targetIndex + (placement === "after" ? 1 : 0), 0, source);
  return next.every((name, index) => name === order[index]) ? order : next;
}

export function orderDocumentsByRole(
  documents: readonly ManagedDocument[],
  roleOrder: readonly string[] | undefined,
): ManagedDocument[] {
  const rank = new Map(
    (roleOrder ?? []).map((role, index) => [role, index] as const),
  );
  return [...documents].sort((left, right) => {
    const roleDifference =
      (rank.get(documentDirectory(left)) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(documentDirectory(right)) ?? Number.MAX_SAFE_INTEGER);
    return roleDifference || left.path.localeCompare(right.path);
  });
}

export function compareRoleCollections(
  leftRoles: Iterable<string>,
  rightRoles: Iterable<string>,
  roleOrder: readonly string[],
): number {
  const rank = new Map(roleOrder.map((role, index) => [role, index] as const));
  const ordered = (roles: Iterable<string>) =>
    [...new Set(roles)].sort((left, right) => {
      const difference =
        (rank.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(right) ?? Number.MAX_SAFE_INTEGER);
      return difference || left.localeCompare(right);
    });
  const left = ordered(leftRoles);
  const right = ordered(rightRoles);
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const rankDifference =
      (rank.get(left[index]) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(right[index]) ?? Number.MAX_SAFE_INTEGER);
    if (rankDifference !== 0) return rankDifference;
    const nameDifference = left[index].localeCompare(right[index]);
    if (nameDifference !== 0) return nameDifference;
  }
  return left.length - right.length;
}

function orderedGraphRoles(
  graph: GraphData,
  requestedOrder: readonly string[] | undefined,
): string[] {
  const available = graphRoleNames(graph);
  const availableSet = new Set(available);
  const seen = new Set<string>();
  const requested = (requestedOrder ?? []).filter((role) => {
    if (!availableSet.has(role) || seen.has(role)) return false;
    seen.add(role);
    return true;
  });
  return [...requested, ...available.filter((role) => !seen.has(role))];
}

export function buildGraphLayout(
  graph: GraphData,
  options: GraphLayoutOptions = {},
): NodeLayout {
  const documents = graph.documents
    .filter(
      (document) =>
        options.visibleRoles === undefined ||
        options.visibleRoles.has(documentDirectory(document)),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  const visiblePaths = new Set(documents.map((document) => document.path));
  const externalTargets = new Map<string, ExternalTarget>();
  if (options.includeExternalTargets !== false) {
    for (const relationship of documentRelationships(graph)) {
      if (
        visiblePaths.has(relationship.source) &&
        isExternalTarget(relationship.target)
      ) {
        externalTargets.set(
          externalTargetKey(relationship.target),
          relationship.target,
        );
      }
    }
  }

  const externalEntries = [...externalTargets.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const nodeKeys = [
    ...documents.map((document) => `document:${document.path}`),
    ...externalEntries.map(([key]) => `external:${key}`),
  ];
  const nodes: SimulationNode[] = nodeKeys.map((key) => ({
    key,
    x: GRAPH_CENTER.x,
    y: GRAPH_CENTER.y,
  }));
  const nodeIndex = new Map(nodes.map((node, index) => [node.key, index]));
  const edges = documentRelationships(graph).flatMap((relationship) => {
    const source = nodeIndex.get(`document:${relationship.source}`);
    const targetKey =
      typeof relationship.target === "string"
        ? `document:${relationship.target}`
        : `external:${externalTargetKey(relationship.target)}`;
    const target = nodeIndex.get(targetKey);
    return source === undefined || target === undefined ? [] : [[source, target] as const];
  });

  const documentIndexesByRole = new Map<string, number[]>();
  for (const document of documents) {
    const index = nodeIndex.get(`document:${document.path}`);
    if (index === undefined) continue;
    const members = documentIndexesByRole.get(documentDirectory(document));
    if (members) members.push(index);
    else documentIndexesByRole.set(documentDirectory(document), [index]);
  }
  const roleOrder = orderedGraphRoles(graph, options.roleOrder).filter((role) =>
    documentIndexesByRole.has(role),
  );
  const layers: RoleLayerWorkingSet[] = roleOrder.map((role) => {
    const members = documentIndexesByRole.get(role) ?? [];
    return {
      key: `role:${role}`,
      label: role,
      kind: "role",
      members,
      desiredHeight:
        ROLE_LAYER_BASE_HEIGHT +
        Math.ceil(members.length / ROLE_LAYER_MAX_COLUMNS) *
          ROLE_LAYER_ROW_HEIGHT,
    };
  });
  if (externalEntries.length > 0) {
    const members = externalEntries.flatMap(([key]) => {
      const index = nodeIndex.get(`external:${key}`);
      return index === undefined ? [] : [index];
    });
    layers.push({
      key: "external-targets",
      label: "External targets",
      kind: "external",
      members,
      desiredHeight:
        ROLE_LAYER_BASE_HEIGHT +
        Math.ceil(members.length / ROLE_LAYER_MAX_COLUMNS) *
          ROLE_LAYER_ROW_HEIGHT,
    });
  }

  orderLayerMembers(nodes, layers, edges);
  const roleLayers = assignRoleLayerGeometry(nodes, layers);

  const pointByKey = new Map(nodes.map((node) => [node.key, { x: node.x, y: node.y }]));
  const leaves = documents.map((document) => ({
    document,
    directory: document.path.split("/")[0] ?? ".",
    angle: 0,
    interval: 0,
    point: pointByKey.get(`document:${document.path}`) ?? GRAPH_CENTER,
  }));
  const externalLayouts = externalEntries.map(([key, target]) => ({
    key,
    target,
    label: externalTargetLabel(target),
    angle: 0,
    point: pointByKey.get(`external:${key}`) ?? GRAPH_CENTER,
  }));

  return {
    leaves,
    leafByPath: new Map(leaves.map((leaf) => [leaf.document.path, leaf])),
    externalTargets: externalLayouts,
    externalByKey: new Map(externalLayouts.map((external) => [external.key, external])),
    roleLayers,
  };
}

export function relationshipPath(
  relationship: GraphRelationship,
  layout: NodeLayout,
  mode: "ring" | "graph" = "ring",
): string | undefined {
  const source = layout.leafByPath.get(relationship.source);
  if (!source) return undefined;

  let targetPoint: Point | undefined;
  if (typeof relationship.target === "string") {
    targetPoint = layout.leafByPath.get(relationship.target)?.point;
  } else {
    targetPoint = layout.externalByKey.get(externalTargetKey(relationship.target))?.point;
  }
  if (!targetPoint) return undefined;

  if (mode === "graph") {
    const deltaX = targetPoint.x - source.point.x;
    const deltaY = targetPoint.y - source.point.y;
    const distance = Math.max(Math.hypot(deltaX, deltaY), 1);
    const unitX = deltaX / distance;
    const unitY = deltaY / distance;
    const start = {
      x: source.point.x + unitX * 7,
      y: source.point.y + unitY * 7,
    };
    const end = {
      x: targetPoint.x - unitX * 9,
      y: targetPoint.y - unitY * 9,
    };
    const bend = Math.min(28, distance * 0.07);
    const control = {
      x: (start.x + end.x) / 2 - unitY * bend,
      y: (start.y + end.y) / 2 + unitX * bend,
    };
    return `M ${start.x} ${start.y} Q ${control.x} ${control.y}, ${end.x} ${end.y}`;
  }

  const bend = 0.17;
  const control1 = {
    x: source.point.x * (1 - bend) + GRAPH_CENTER.x * bend,
    y: source.point.y * (1 - bend) + GRAPH_CENTER.y * bend,
  };
  const control2 = {
    x: targetPoint.x * (1 - bend) + GRAPH_CENTER.x * bend,
    y: targetPoint.y * (1 - bend) + GRAPH_CENTER.y * bend,
  };
  const targetToCenterX = GRAPH_CENTER.x - targetPoint.x;
  const targetToCenterY = GRAPH_CENTER.y - targetPoint.y;
  const targetToCenterDistance = Math.max(
    Math.hypot(targetToCenterX, targetToCenterY),
    1,
  );
  const targetToCenterUnitX = targetToCenterX / targetToCenterDistance;
  const targetToCenterUnitY = targetToCenterY / targetToCenterDistance;
  const targetBoundaryInset =
    typeof relationship.target === "string"
      ? (RING_LEAF_NODE_SIZES.emphasized / 2 + RING_LEAF_STROKE_MARGIN) /
        Math.max(
          Math.abs(targetToCenterUnitX),
          Math.abs(targetToCenterUnitY),
          Number.EPSILON,
        )
      : RING_EXTERNAL_NODE_RADIUS + RING_EXTERNAL_STROKE_MARGIN;
  const targetInset = targetBoundaryInset + RING_MARKER_TIP_OVERHANG;
  const end = {
    x: targetPoint.x + targetToCenterUnitX * targetInset,
    y: targetPoint.y + targetToCenterUnitY * targetInset,
  };
  return `M ${source.point.x} ${source.point.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`;
}

export function externalKeyForRelationship(
  relationship: GraphRelationship,
): string | undefined {
  return isExternalTarget(relationship.target)
    ? externalTargetKey(relationship.target)
    : undefined;
}
