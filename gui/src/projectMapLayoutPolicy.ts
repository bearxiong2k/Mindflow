import type {
  ProjectMapFocusProjection,
  ProjectMapProjectionLayer,
} from "./projectMapNavigation";
import type { ProjectComponent, ProjectMapRelationship } from "./types";

export interface ProjectMapLayoutPressure {
  nodeCount: number;
  connectionCount: number;
  edgeDensity: number;
  maximumBreadth: number;
  expandedLayerCount: number;
  cyclic: boolean;
}

export interface ProjectMapLayoutDecision {
  engine: "dagre";
  reason:
    | "root-overview"
    | "cycle"
    | "nested"
    | "sparse-wide"
    | "large"
    | "dense"
    | "simple";
  pressure: ProjectMapLayoutPressure;
}

export interface ProjectMapPackingRectangle {
  id: string;
  width: number;
  height: number;
}

export interface ProjectMapPackingPlacement
  extends ProjectMapPackingRectangle {
  x: number;
  y: number;
}

export interface ProjectMapComponentPacking {
  placements: ProjectMapPackingPlacement[];
  width: number;
  height: number;
  columnCount: number;
  rowCount: number;
}

const PROJECT_MAP_COMPONENT_COLUMN_GAP = 38;
const PROJECT_MAP_COMPONENT_ROW_GAP = 54;
const PROJECT_MAP_PACKING_TARGET_ASPECT = 1.6;

/** Only a whole, directed, unbranched component is safe to fold as a chain. */
export function projectMapDirectedChain(
  componentIds: readonly string[],
  connections: readonly Pick<ProjectMapRelationship, "source" | "target" | "direction">[],
): string[] | undefined {
  const members = new Set(componentIds);
  if (members.size < 5 || members.size !== componentIds.length) return undefined;
  const outgoing = new Map<string, string>();
  const incoming = new Set<string>();
  for (const connection of connections) {
    if (!members.has(connection.source) && !members.has(connection.target)) continue;
    if (
      !members.has(connection.source) || !members.has(connection.target) ||
      connection.direction !== "source-to-target" ||
      outgoing.has(connection.source) || incoming.has(connection.target)
    ) return undefined;
    outgoing.set(connection.source, connection.target);
    incoming.add(connection.target);
  }
  const starts = componentIds.filter((id) => !incoming.has(id));
  if (starts.length !== 1 || outgoing.size !== members.size - 1) return undefined;
  const order: string[] = [];
  const visited = new Set<string>();
  let cursor: string | undefined = starts[0];
  while (cursor !== undefined && !visited.has(cursor)) {
    order.push(cursor);
    visited.add(cursor);
    cursor = outgoing.get(cursor);
  }
  return order.length === members.size && cursor === undefined ? order : undefined;
}

export interface ProjectMapChainRoute {
  source: string;
  target: string;
  path: string;
  label: { x: number; y: number; width: number; height: number };
}

export interface ProjectMapFoldedChain extends ProjectMapComponentPacking {
  routes: ProjectMapChainRoute[];
}

/**
 * Fold measured nodes into alternating rows. Each row turn stays outside the
 * node columns; its label has a dedicated gutter. No edge or node is invented.
 * The fixed aspect target keeps cached geometry independent of pan and resize.
 */
export function foldProjectMapChain(
  nodes: readonly ProjectMapPackingRectangle[],
  labels: readonly { width: number; height: number }[],
  reversed = false,
): ProjectMapFoldedChain | undefined {
  if (nodes.length < 5 || labels.length !== nodes.length - 1) return undefined;
  if ([...nodes, ...labels].some(({ width, height }) =>
    !Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0,
  )) return undefined;
  const nodeWidth = Math.max(1, ...nodes.map(({ width }) => width));
  const nodeHeight = Math.max(1, ...nodes.map(({ height }) => height));
  const labelWidth = Math.max(0, ...labels.map(({ width }) => width));
  const labelHeight = Math.max(0, ...labels.map(({ height }) => height));
  const rowHeight = Math.max(nodeHeight, labelHeight);
  const columnGap = Math.max(64, labelWidth + 32);
  const rowGap = Math.max(72, labelHeight + 40);
  const turnReach = Math.max(40, nodeHeight * 0.65);
  const gutter = turnReach + labelWidth / 2 + 20;
  const candidates = Array.from({ length: nodes.length - 2 }, (_, index) => {
    const columnCount = index + 2;
    const rowCount = Math.ceil(nodes.length / columnCount);
    const width = columnCount * nodeWidth + (columnCount - 1) * columnGap + gutter * 2;
    const height = rowCount * rowHeight + (rowCount - 1) * rowGap;
    // Minimize the scale needed to fit a readable landscape surface, with a
    // small cost for empty slots when two arrangements have similar extents.
    const score = Math.max(width / PROJECT_MAP_PACKING_TARGET_ASPECT, height) *
      (1 + (rowCount * columnCount - nodes.length) * 0.006);
    return { columnCount, rowCount, width, height, score };
  });
  const best = candidates.reduce((best, candidate) =>
    candidate.score < best.score ? candidate : best,
  );
  const placements = nodes.map((node, index) => {
    const row = Math.floor(index / best.columnCount);
    const slot = index % best.columnCount;
    const column = row % 2 === 0 ? slot : best.columnCount - 1 - slot;
    const y = row * (rowHeight + rowGap) + (rowHeight - node.height) / 2;
    return {
      ...node,
      x: gutter + column * (nodeWidth + columnGap) + (nodeWidth - node.width) / 2,
      y: reversed ? best.height - y - node.height : y,
    };
  });
  const number = (value: number) => Number(value.toFixed(3));
  const point = (x: number, y: number) => `${number(x)},${number(y)}`;
  const routes = placements.slice(0, -1).map((source, index): ProjectMapChainRoute => {
    const target = placements[index + 1];
    const row = Math.floor(index / best.columnCount);
    const turns = Math.floor((index + 1) / best.columnCount) !== row;
    const sign = row % 2 === 0 ? 1 : -1;
    const sourceX = source.x + (sign > 0 ? source.width : 0);
    const sourceY = source.y + source.height / 2;
    const targetX = target.x + ((turns ? sign < 0 : sign > 0) ? 0 : target.width);
    const targetY = target.y + target.height / 2;
    // Mermaid's arrow tip extends four units beyond the path endpoint.
    const endX = targetX + (turns ? sign : -sign) * 4;
    const controlX = turns
      ? (sign > 0 ? Math.max(sourceX, targetX) : Math.min(sourceX, targetX)) + sign * turnReach
      : (sourceX + targetX) / 2;
    const label = labels[index];
    const centerX = turns
      ? (sourceX + endX) / 8 + controlX * 0.75
      : (sourceX + targetX) / 2;
    return {
      source: source.id,
      target: target.id,
      path: `M${point(sourceX, sourceY)} C${point(controlX, sourceY)} ${point(controlX, targetY)} ${point(endX, targetY)}`,
      label: {
        ...label,
        x: centerX - label.width / 2,
        y: (sourceY + targetY) / 2 - label.height / 2,
      },
    };
  });
  return {
    width: best.width, height: best.height,
    columnCount: best.columnCount, rowCount: best.rowCount,
    placements, routes,
  };
}

function packProjectMapRectanglesByColumns(
  rectangles: readonly ProjectMapPackingRectangle[],
  columnCount: number,
): ProjectMapComponentPacking {
  const rows = Array.from(
    { length: Math.ceil(rectangles.length / columnCount) },
    (_, rowIndex) =>
      rectangles.slice(
        rowIndex * columnCount,
        (rowIndex + 1) * columnCount,
      ),
  );
  const rowSizes = rows.map((row) => ({
    width:
      row.reduce((sum, rectangle) => sum + rectangle.width, 0) +
      Math.max(0, row.length - 1) * PROJECT_MAP_COMPONENT_COLUMN_GAP,
    height: Math.max(0, ...row.map((rectangle) => rectangle.height)),
  }));
  const width = Math.max(0, ...rowSizes.map((row) => row.width));
  const placements: ProjectMapPackingPlacement[] = [];
  let cursorY = 0;

  rows.forEach((row, rowIndex) => {
    const rowSize = rowSizes[rowIndex];
    let cursorX = (width - rowSize.width) / 2;
    for (const rectangle of row) {
      placements.push({
        ...rectangle,
        x: cursorX,
        y: cursorY + (rowSize.height - rectangle.height) / 2,
      });
      cursorX += rectangle.width + PROJECT_MAP_COMPONENT_COLUMN_GAP;
    }
    cursorY += rowSize.height + PROJECT_MAP_COMPONENT_ROW_GAP;
  });

  return {
    placements,
    width,
    height:
      cursorY - (rows.length > 0 ? PROJECT_MAP_COMPONENT_ROW_GAP : 0),
    columnCount,
    rowCount: rows.length,
  };
}

function projectMapComponentPackingScore(
  packing: ProjectMapComponentPacking,
) {
  const width = Math.max(packing.width, 1);
  const height = Math.max(1, packing.height);
  const aspectMismatch = Math.abs(
    Math.log(width / height / PROJECT_MAP_PACKING_TARGET_ASPECT),
  );
  const unusedSlots =
    packing.columnCount * packing.rowCount - packing.placements.length;
  return aspectMismatch + unusedSlots * 0.018 + packing.rowCount * 0.002;
}

/**
 * Packs disconnected visual components after Dagre has laid out each semantic
 * region. The caller moves every node, edge, label, and containment rectangle
 * in a component by one shared translation, so Dagre's internal geometry stays
 * untouched.
 */
export function packProjectMapDisconnectedComponents(
  rectangles: readonly ProjectMapPackingRectangle[],
): ProjectMapComponentPacking {
  const normalized = rectangles.flatMap((rectangle) => {
    const width = Number.isFinite(rectangle.width)
      ? Math.max(1, rectangle.width)
      : 1;
    const height = Number.isFinite(rectangle.height)
      ? Math.max(1, rectangle.height)
      : 1;
    return [{ ...rectangle, width, height }];
  });
  if (normalized.length === 0) {
    return {
      placements: [],
      width: 0,
      height: 0,
      columnCount: 0,
      rowCount: 0,
    };
  }

  const maximumColumns =
    normalized.length < 4
      ? normalized.length
      : Math.min(
          normalized.length - 1,
          Math.max(
            2,
            Math.ceil(
              Math.sqrt(
                normalized.length * PROJECT_MAP_PACKING_TARGET_ASPECT,
              ),
            ),
          ),
        );
  const candidates = Array.from({ length: maximumColumns }, (_, index) =>
    packProjectMapRectanglesByColumns(normalized, index + 1),
  );
  let best = candidates[0];
  let bestScore = projectMapComponentPackingScore(best);
  for (const candidate of candidates.slice(1)) {
    const score = projectMapComponentPackingScore(candidate);
    if (
      score < bestScore - 0.000001 ||
      (Math.abs(score - bestScore) <= 0.000001 &&
        candidate.rowCount < best.rowCount)
    ) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function layerConnections(layer: ProjectMapProjectionLayer) {
  return layer.relationships;
}

export function projectMapWeakComponentGroups(
  layer: ProjectMapProjectionLayer,
) {
  const components = [...layer.primary, ...layer.context].filter(
    (component, index, all) =>
      all.findIndex((candidate) => candidate.id === component.id) === index,
  );
  const indexById = new Map(
    components.map((component, index) => [component.id, index]),
  );
  const parent = components.map((_, index) => index);
  const find = (index: number): number => {
    let cursor = index;
    while (parent[cursor] !== cursor) cursor = parent[cursor];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = cursor;
      index = next;
    }
    return cursor;
  };
  const unite = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  for (const connection of layerConnections(layer)) {
    const source = indexById.get(connection.source);
    const target = indexById.get(connection.target);
    if (source !== undefined && target !== undefined) unite(source, target);
  }
  const groups = new Map<number, ProjectComponent[]>();
  components.forEach((component, index) => {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(component);
    groups.set(root, group);
  });
  return [...groups.values()];
}

function projectionLayers(projection: ProjectMapFocusProjection) {
  const result: ProjectMapProjectionLayer[] = [];
  const visit = (layer: ProjectMapProjectionLayer) => {
    result.push(layer);
    for (const expanded of layer.expanded) visit(expanded);
  };
  visit(projection);
  return result;
}

function projectionIsCyclic(layers: ReturnType<typeof projectionLayers>) {
  const adjacency = new Map<string, Set<string>>();
  const connect = (source: string, target: string) => {
    const targets = adjacency.get(source) ?? new Set<string>();
    targets.add(target);
    adjacency.set(source, targets);
  };
  for (const layer of layers) {
    for (const connection of layerConnections(layer)) {
      connect(connection.source, connection.target);
      if (connection.direction === "bidirectional") {
        connect(connection.target, connection.source);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const target of adjacency.get(node) ?? []) {
      if (visit(target)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  return [...adjacency.keys()].some(visit);
}

export function projectMapLayoutPressure(
  projection: ProjectMapFocusProjection,
): ProjectMapLayoutPressure {
  const layers = projectionLayers(projection);
  const componentIds = new Set<string>();
  let connectionCount = 0;
  let maximumBreadth = 0;
  for (const layer of layers) {
    const visible = [...layer.primary, ...layer.context];
    for (const component of visible) componentIds.add(component.id);
    connectionCount += layerConnections(layer).length;
    maximumBreadth = Math.max(maximumBreadth, visible.length);
  }
  const nodeCount = componentIds.size;
  return {
    nodeCount,
    connectionCount,
    edgeDensity: connectionCount / Math.max(1, nodeCount),
    maximumBreadth,
    expandedLayerCount: Math.max(0, layers.length - 1),
    cyclic: projectionIsCyclic(layers),
  };
}

export function decideProjectMapLayout(
  projection: ProjectMapFocusProjection,
): ProjectMapLayoutDecision {
  const pressure = projectMapLayoutPressure(projection);
  let reason: ProjectMapLayoutDecision["reason"] = "simple";

  if (
    projection.focus.parent === undefined &&
    pressure.expandedLayerCount === 0 &&
    !pressure.cyclic
  ) {
    reason = "root-overview";
  } else if (pressure.cyclic) {
    reason = "cycle";
  } else if (pressure.expandedLayerCount > 0) {
    reason = "nested";
  } else if (pressure.maximumBreadth >= 6 && pressure.edgeDensity < 0.9) {
    reason = "sparse-wide";
  } else if (pressure.nodeCount >= 12) {
    reason = "large";
  } else if (
    pressure.connectionCount >= 10 &&
    pressure.edgeDensity >= 1
  ) {
    reason = "dense";
  }
  return { engine: "dagre", reason, pressure };
}
