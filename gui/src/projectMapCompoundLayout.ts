import { layout as dagreLayout } from "dagre-d3-es/src/dagre/index.js";
import { Graph } from "dagre-d3-es/src/graphlib/index.js";
import {
  foldProjectMapChain,
  packProjectMapDisconnectedComponents,
  projectMapDirectedChain,
  type ProjectMapPackingPlacement,
  type ProjectMapPackingRectangle,
} from "./projectMapLayoutPolicy.ts";
import type { ProjectMapRelationship } from "./types";
import type { ProjectMapMermaidGraph } from "./projectMapMermaid";
import { PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE } from "./projectMapHover.ts";

export interface CompoundLayoutNode extends ProjectMapPackingRectangle {
  parent?: string;
  title?: { width: number; height: number };
}

export interface CompoundLayoutEdge {
  id: string;
  source: string;
  target: string;
  direction: ProjectMapRelationship["direction"];
  width: number;
  height: number;
}

interface Point { x: number; y: number }

interface CompoundLayoutRoute {
  id: string;
  path: string;
  offset: Point;
  label: Point & { width: number; height: number };
}

interface ScopeLayout {
  width: number;
  height: number;
  placements: ProjectMapPackingPlacement[];
  routes: CompoundLayoutRoute[];
  foldedChains: number;
  packed: boolean;
}

function roundedRoute(points: readonly Point[], bidirectional: boolean) {
  const route = points.map((point) => ({ ...point }));
  // Arrow markers extend four units beyond the path endpoint. Dagre clips to
  // the measured rectangle; keep the arrow tip on that boundary too.
  const shorten = (point: Point, toward: Point) => {
    const length = Math.hypot(toward.x - point.x, toward.y - point.y);
    if (length === 0) return;
    const distance = Math.min(4, length / 2);
    point.x += (toward.x - point.x) * distance / length;
    point.y += (toward.y - point.y) * distance / length;
  };
  if (route.length < 2) return "";
  if (bidirectional) shorten(route[0], route[1]);
  shorten(route[route.length - 1], route[route.length - 2]);
  const point = ({ x, y }: Point) => `${Number(x.toFixed(3))},${Number(y.toFixed(3))}`;
  let path = `M${point(route[0])}`;
  for (let index = 1; index < route.length - 1; index++) {
    const previous = route[index - 1];
    const current = route[index];
    const next = route[index + 1];
    // Round only the corner, preserving the long straight section through a
    // relationship label and the route's original Dagre corridor.
    const approach = (neighbor: Point) => {
      const distance = Math.hypot(neighbor.x - current.x, neighbor.y - current.y);
      const ratio = distance === 0 ? 0 : Math.min(12 / distance, 0.25);
      return { x: current.x + (neighbor.x - current.x) * ratio,
        y: current.y + (neighbor.y - current.y) * ratio };
    };
    path += ` L${point(approach(previous))} Q${point(current)} ${point(approach(next))}`;
  }
  return `${path} L${point(route[route.length - 1])}`;
}

function arrangeConnected(
  nodes: readonly ProjectMapPackingRectangle[],
  edges: readonly CompoundLayoutEdge[],
  direction: string,
): ScopeLayout {
  const order = projectMapDirectedChain(nodes.map(({ id }) => id), edges);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const orderedEdges = order?.slice(0, -1).map((source) => edges.find((edge) => edge.source === source)!);
  const folded = order && orderedEdges && foldProjectMapChain(
    order.map((id) => byId.get(id)!), orderedEdges, direction === "BT" || direction === "RL",
  );
  if (folded && orderedEdges) {
    return { ...folded, foldedChains: 1, packed: false,
      routes: folded.routes.map((route, index) => ({
        id: orderedEdges[index].id, path: route.path, label: route.label, offset: { x: 0, y: 0 },
      })) };
  }
  const graph = new Graph({ multigraph: true });
  graph.setGraph({ rankdir: direction, nodesep: 38, ranksep: 96, edgesep: 30, marginx: 0, marginy: 0 });
  for (const node of nodes) graph.setNode(node.id, { width: node.width, height: node.height });
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target,
      { width: edge.width, height: edge.height, labelpos: "c" }, edge.id);
  }
  dagreLayout(graph, {});
  return {
    width: graph.graph().width,
    height: graph.graph().height,
    placements: nodes.map((node) => {
      const { x, y } = graph.node(node.id);
      return { ...node, x: x - node.width / 2, y: y - node.height / 2 };
    }),
    routes: edges.map((edge) => {
      const routed = graph.edge(edge.source, edge.target, edge.id);
      return { id: edge.id, path: roundedRoute(routed.points, edge.direction === "bidirectional"),
        offset: { x: 0, y: 0 },
        label: { x: routed.x - edge.width / 2, y: routed.y - edge.height / 2,
          width: edge.width, height: edge.height } };
    }),
    foldedChains: 0,
    packed: false,
  };
}

/**
 * Lay out real visible containment from the inside out. Each expanded child is
 * one measured rectangle in its parent's Dagre graph. The parent cannot reserve
 * the old unbounded rank width after its children have been packed or folded.
 * Occurrence keys, not semantic IDs or geometric proximity, own each scope.
 */
export function layoutProjectMapCompound(
  nodes: readonly CompoundLayoutNode[],
  edges: readonly CompoundLayoutEdge[],
  direction = "TB",
) {
  const children = new Map<string | undefined, CompoundLayoutNode[]>();
  for (const node of nodes) {
    const siblings = children.get(node.parent) ?? [];
    siblings.push(node);
    children.set(node.parent, siblings);
  }
  const scopes = new Map<string | undefined, ScopeLayout>();
  const arrangeScope = (parent?: string): ScopeLayout => {
    const originals = children.get(parent) ?? [];
    const measured = originals.map((node): ProjectMapPackingRectangle => {
      if (!node.title) return node;
      const content = arrangeScope(node.id);
      return { id: node.id, width: Math.max(content.width, node.title.width) + 48,
        height: content.height + node.title.height + 58 };
    });
    const ids = new Set(measured.map(({ id }) => id));
    const localEdges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
    const neighbors = new Map(measured.map(({ id }) => [id, new Set<string>()]));
    for (const edge of localEdges) {
      neighbors.get(edge.source)!.add(edge.target);
      neighbors.get(edge.target)!.add(edge.source);
    }
    const visited = new Set<string>();
    const groups: ScopeLayout[] = [];
    for (const node of measured) {
      if (visited.has(node.id)) continue;
      const members = new Set<string>();
      const pending = [node.id];
      while (pending.length > 0) {
        const id = pending.pop()!;
        if (visited.has(id)) continue;
        visited.add(id);
        members.add(id);
        pending.push(...neighbors.get(id)!);
      }
      groups.push(arrangeConnected(
        measured.filter(({ id }) => members.has(id)),
        localEdges.filter(({ source }) => members.has(source)),
        parent === undefined ? direction : direction === "BT" ? "BT" : "TB",
      ));
    }
    // Keep large regions together; a small isolated item must not allocate a
    // whole tall row between two expanded categories or folded chains.
    groups.sort((left, right) => Math.abs(right.height - left.height) < 0.5 ? 0 : right.height - left.height);
    const packing = packProjectMapDisconnectedComponents(groups.map((group, index) => ({
      id: String(index), width: group.width, height: group.height,
    })));
    const result: ScopeLayout = { width: packing.width, height: packing.height,
      placements: [], routes: [], foldedChains: 0, packed: groups.length >= 4 && packing.rowCount > 1 };
    for (const placement of packing.placements) {
      const group = groups[Number(placement.id)];
      result.foldedChains += group.foldedChains;
      result.placements.push(...group.placements.map((node) => ({ ...node,
        x: placement.x + node.x, y: placement.y + node.y })));
      result.routes.push(...group.routes.map((route) => ({ ...route,
        offset: { x: route.offset.x + placement.x, y: route.offset.y + placement.y },
        label: { ...route.label, x: route.label.x + placement.x, y: route.label.y + placement.y } })));
    }
    scopes.set(parent, result);
    return result;
  };
  const root = arrangeScope();
  const placements: ProjectMapPackingPlacement[] = [];
  const routes: CompoundLayoutRoute[] = [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const emitScope = (parent: string | undefined, x: number, y: number) => {
    const scope = scopes.get(parent)!;
    for (const node of scope.placements) {
      const placement = { ...node, x: node.x + x, y: node.y + y };
      placements.push(placement);
      const original = nodeById.get(node.id)!;
      if (original.title) {
        const content = scopes.get(node.id)!;
        emitScope(node.id, placement.x + (node.width - content.width) / 2,
          placement.y + original.title.height + 34);
      }
    }
    routes.push(...scope.routes.map((route) => ({ ...route,
      offset: { x: route.offset.x + x, y: route.offset.y + y },
      label: { ...route.label, x: route.label.x + x, y: route.label.y + y } })));
  };
  emitScope(undefined, 0, 0);
  return { width: root.width, height: root.height, placements, routes,
    foldedChains: [...scopes.values()].reduce((sum, scope) => sum + scope.foldedChains, 0),
    packedScopes: [...scopes.values()].filter((scope) => scope.packed).length };
}

/** Reuse Mermaid's actual shapes, labels, markers and interaction identities. */
export function reflowCompoundMermaidSvg(svg: SVGSVGElement, graph: ProjectMapMermaidGraph) {
  if (!graph.parentLayerByKey) return false;
  const svgMatrix = svg.getScreenCTM();
  if (!svgMatrix) return false;
  const inverse = svgMatrix.inverse();
  const bounds = (element: SVGGraphicsElement) => {
    const rectangle = element.getBoundingClientRect();
    const start = new DOMPoint(rectangle.left, rectangle.top).matrixTransform(inverse);
    const end = new DOMPoint(rectangle.right, rectangle.bottom).matrixTransform(inverse);
    return { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y };
  };
  const visuals = new Map([...svg.querySelectorAll<SVGGraphicsElement>(
    "g.node[data-project-map-key], g.cluster[data-project-map-key]",
  )].map((element) => [element.dataset.projectMapKey!, {
    element, bounds: bounds(element), matrix: inverse.multiply(element.getScreenCTM()!),
    title: element.querySelector<SVGGraphicsElement>(":scope > .cluster-label"),
  }]));
  if (visuals.size !== graph.parentLayerByKey.size) return false;
  const edgeVisuals = new Map(graph.connections.map((connection, index) => {
    const id = `connection-${index}`;
    const selector = `[${PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE}="${id}"]`;
    const label = svg.querySelector<SVGGraphicsElement>(`g.edgeLabel${selector}`);
    return [id, { connection, label, labelBounds: label ? bounds(label) : undefined,
      paths: [...svg.querySelectorAll<SVGPathElement>(`path${selector}`)] }];
  }));
  if ([...edgeVisuals.values()].some(({ label, paths }) => !label || paths.length < 2)) return false;
  const result = layoutProjectMapCompound(
    [...graph.parentLayerByKey].map(([id, parent]) => {
      const visual = visuals.get(id)!;
      return { id, parent, width: visual.bounds.width, height: visual.bounds.height,
        title: visual.title ? bounds(visual.title) : undefined };
    }),
    [...edgeVisuals].map(([id, { connection, labelBounds }]) => ({ id,
      source: connection.renderedSource, target: connection.renderedTarget,
      direction: connection.direction, width: labelBounds!.width, height: labelBounds!.height })),
    graph.source.match(/^flowchart (\w+)$/m)?.[1].replace("TD", "TB") ?? "TB",
  );
  const group = () => document.createElementNS("http://www.w3.org/2000/svg", "g");
  const arranged = group();
  const clusters = group();
  const routes = group();
  const labels = group();
  const nodes = group();
  arranged.setAttribute("class", "project-map-compound-layout");
  clusters.setAttribute("class", "clusters");
  routes.setAttribute("class", "edgePaths");
  labels.setAttribute("class", "edgeLabels");
  nodes.setAttribute("class", "nodes");
  arranged.append(clusters, routes, labels, nodes);
  // Mermaid may nest complete diagram roots inside aggregate wrappers. Keep
  // definitions but flatten the presentation into one coordinate system, so a
  // parent move cannot translate a descendant or its route a second time.
  for (const definitions of [...svg.querySelectorAll("defs")]) svg.append(definitions);
  for (const placement of result.placements) {
    const visual = visuals.get(placement.id)!;
    if (visual.title) {
      const cluster = visual.element.cloneNode(false) as SVGGraphicsElement;
      const rectangle = visual.element.querySelector(":scope > rect")!;
      const titleBounds = visual.title.getBBox();
      rectangle.setAttribute("x", "0");
      rectangle.setAttribute("y", "0");
      rectangle.setAttribute("width", String(placement.width));
      rectangle.setAttribute("height", String(placement.height));
      cluster.setAttribute("transform", `translate(${placement.x} ${placement.y})`);
      visual.title.setAttribute("transform",
        `translate(${(placement.width - titleBounds.width) / 2 - titleBounds.x} ${14 - titleBounds.y})`);
      cluster.append(rectangle, visual.title);
      const title = visual.element.querySelector(":scope > title");
      if (title) cluster.append(title);
      clusters.append(cluster);
    } else {
      const matrix = new DOMMatrix().translate(placement.x - visual.bounds.x, placement.y - visual.bounds.y)
        .multiply(visual.matrix);
      visual.element.setAttribute("transform", matrix.toString());
      nodes.append(visual.element);
    }
  }
  for (const route of result.routes) {
    const visual = edgeVisuals.get(route.id)!;
    for (const path of visual.paths) {
      path.setAttribute("d", route.path);
      path.setAttribute("transform", `translate(${route.offset.x} ${route.offset.y})`);
      path.removeAttribute("data-points");
      routes.append(path);
    }
    const label = visual.label!;
    const rectangle = label.getBBox();
    label.setAttribute("transform", `translate(${route.label.x - rectangle.x} ${route.label.y - rectangle.y})`);
    labels.append(label);
  }
  for (const child of [...svg.children]) if (child.tagName.toLowerCase() === "g") child.remove();
  svg.append(arranged);
  svg.setAttribute("viewBox", `-20 -20 ${result.width + 40} ${result.height + 40}`);
  svg.setAttribute("width", String(result.width + 40));
  svg.setAttribute("height", String(result.height + 40));
  svg.setAttribute("data-project-map-compound-layout", "true");
  svg.setAttribute("data-project-map-folded-chains", String(result.foldedChains));
  svg.setAttribute("data-project-map-packed-scopes", String(result.packedScopes));
  return true;
}
