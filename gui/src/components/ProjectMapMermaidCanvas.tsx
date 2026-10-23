import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";

import { createPortal } from "react-dom";
import { HelpOnly } from "./InterfaceHelp";
import { projectMapMetricTextBounds, projectMapVolumeComparisons, type ProjectMapMetric } from "../projectMapMetrics";

import {
  mermaidSvgSize,
  type MermaidSvgSize,
} from "../mermaidRendering";
import { renderMermaid } from "../mermaidRuntime";
import { mermaidRenderAborted } from "../mermaidRenderQueue";
import {
  PROJECT_MAP_METRIC_TREND_SPACE,
  PROJECT_MAP_METRIC_SIZE_SPACE,
  projectMapMermaidRenderedNodeId,
  projectMapRoleLabel,
  type ProjectMapMermaidConnection,
  type ProjectMapMermaidGraph,
} from "../projectMapMermaid";
import {
  foldProjectMapChain,
  packProjectMapDisconnectedComponents,
  projectMapDirectedChain,
} from "../projectMapLayoutPolicy";
import {
  PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE,
  PROJECT_MAP_CONNECTION_SOURCE_ATTRIBUTE,
  PROJECT_MAP_CONNECTION_TARGET_ATTRIBUTE,
  setProjectMapComponentHover,
  setProjectMapConnectionHover,
  setProjectMapPresentationState,
} from "../projectMapHover";
import { projectMapComponentIsAggregate } from "../projectMapNavigation";
import type { ProjectComponent } from "../types";

export interface ProjectMapActivationModifiers {
  metaKey: boolean;
  ctrlKey: boolean;
  expandedRegionDepth?: number;
  origin: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

interface ProjectMapMermaidCanvasProps {
  graph: ProjectMapMermaidGraph;
  matchingIds: ReadonlySet<string>;
  selectedId: string;
  hoveredComponentId?: string;
  onHoverComponent?: (componentId?: string, expandedRegion?: boolean) => void;
  textScale: number;
  childrenByParent: ReadonlyMap<string, ProjectComponent[]>;
  onActivate: (
    component: ProjectComponent,
    modifiers: ProjectMapActivationModifiers,
  ) => void;
  preloadGraph?: ProjectMapMermaidGraph;
  onPrepare?: (
    component?: ProjectComponent,
    expandedRegionDepth?: number,
  ) => void;
  onRenderedGraphChange: (rendered: ProjectMapRenderedGraph) => void;
  onRenderStatusChange: (status: MermaidRenderState["status"]) => void;
}

export interface ProjectMapRenderedGraph {
  source: string;
  svg: string;
  size: MermaidSvgSize;
  textScale: number;
}

interface MermaidRenderState {
  key: string;
  source: string;
  textScale: number;
  status: "loading" | "rendered" | "error";
  svg?: string;
  size?: MermaidSvgSize;
  error?: string;
}

type ProjectMapActionKind = "enter" | "reader" | "external" | "inspect";

const PROJECT_MAP_RENDER_CACHE_LIMIT = 24;
const PROJECT_MAP_LAYOUT_CACHE_LIMIT = 8;
const PROJECT_MAP_SVG_CACHE_CHARACTERS = 8_000_000;

function mermaidRenderKey(source: string, textScale: number) {
  return `${textScale}\u0000${source}`;
}

function projectMapInteractionKey(
  graph: ProjectMapMermaidGraph,
  childrenByParent: ReadonlyMap<string, ProjectComponent[]>,
) {
  const parts: string[] = [graph.origin];
  for (const [key, component] of graph.nodeByKey) {
    parts.push(component.label, graph.effectiveRoles.get(component.id) ?? "");
    parts.push(component.description ?? "");
    parts.push(
      `node:${key}:${component.id}:${component.kind}:${childrenByParent.get(component.id)?.length ?? 0}`,
    );
  }
  for (const [key, component] of graph.layerByKey) {
    parts.push(component.label, graph.effectiveRoles.get(component.id) ?? "");
    parts.push(component.description ?? "");
    parts.push(
      `layer:${key}:${component.id}:${component.kind}:${childrenByParent.get(component.id)?.length ?? 0}:${graph.layerVisibleDepthByKey.get(key) ?? 0}`,
    );
  }
  for (const connection of graph.connections) {
    parts.push(
      `connection:${connection.family}:${connection.type}:${connection.source}:${connection.target}:${connection.direction}:${connection.renderedSource}:${connection.renderedTarget}`,
    );
  }
  return parts.join("\u0000");
}

function projectMapGraphRenderKey(
  graph: ProjectMapMermaidGraph,
  textScale: number,
  childrenByParent: ReadonlyMap<string, ProjectComponent[]>,
) {
  return `${mermaidRenderKey(graph.source, textScale)}\u0000${projectMapInteractionKey(graph, childrenByParent)}`;
}

function renderErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("Edge limit exceeded.")
    ? "This view exceeds the graph renderer's relationship limit. Reduce the visible depth or return to the parent folder."
    : message;
}

function componentAction(
  component: ProjectComponent,
  childrenCount: number,
) {
  if (projectMapComponentIsAggregate(component) && childrenCount > 0) {
    return "Open internal graph";
  }
  if (component.kind === "document") {
    return "Open in Reader";
  }
  if (component.kind === "target" || component.kind === "directory") {
    return "Show in Files";
  }
  return "Inspect component";
}

function componentActionKind(
  component: ProjectComponent,
  childrenCount: number,
): ProjectMapActionKind {
  if (projectMapComponentIsAggregate(component) && childrenCount > 0) {
    return "enter";
  }
  if (component.kind === "document") return "reader";
  if (component.kind === "target" || component.kind === "directory") return "external";
  return "inspect";
}

function componentKindLabel(component: ProjectComponent) {
  switch (component.kind) {
    case "directory":
      return "Directory";
    case "document":
      return "File";
    case "target":
      return "File target";
  }
}

function annotateOpeningCue(visual: SVGElement, component: ProjectComponent) {
  if (!visual.classList.contains("opening")) return "";
  const member = component.kind === "document";
  visual.setAttribute("data-project-map-opening", member ? "member" : "contains");
  return member ? "Opening member" : "Contains Opening documents";
}

function annotateMetrics(visual: SVGElement, component: ProjectComponent, graph: ProjectMapMermaidGraph) {
  const metric = graph.metrics?.byComponentId.get(component.id);
  if (!metric) return "";
  visual.setAttribute("data-project-map-metrics", "true");
  visual.setAttribute("data-metric-direction", metric.direction);
  const labels = new Set([PROJECT_MAP_METRIC_TREND_SPACE, PROJECT_MAP_METRIC_SIZE_SPACE]);
  const candidates = [...visual.querySelectorAll<SVGElement>("text, tspan")].filter((text) => {
    if (text.closest("g.node, g.cluster") !== visual) return false;
    const value = text.textContent?.trim() ?? "";
    return labels.has(value) && text.parentElement?.textContent?.trim() !== value;
  });
  // The final two lines are ours; a real name may use the same words.
  for (const text of candidates.slice(-2)) text.classList.add("project-map-metric-space");
  const absoluteVolume = [...visual.querySelectorAll<SVGElement>("text, tspan")].filter((text) =>
    text.closest("g.node, g.cluster") === visual
    && text.textContent?.trim() === metric.lineCountLabel
    && text.parentElement?.textContent?.trim() !== metric.lineCountLabel).at(-1);
  if (absoluteVolume) {
    absoluteVolume.classList.add("project-map-metric-volume");
    // Keep Mermaid's positioned outer line intact; style only its glyphs.
    for (const glyph of absoluteVolume.querySelectorAll<SVGElement>(".text-inner-tspan")) {
      glyph.style.setProperty("font-size", "0.9em", "important");
      glyph.style.setProperty("font-weight", "650", "important");
      glyph.style.setProperty("fill", "#365776", "important");
    }
  }
  return metric.description;
}

const METRIC_COLORS = { growth: "#2878b8", shrink: "#8b5fb5", flat: "#6d7d8b", unknown: "#85929d" };

function metricSvgElement<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  // Mermaid's node theme and hover rules also match descendant chart primitives.
  // Isolate chart paint without touching the surrounding SOE node shape.
  for (const property of ["fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linejoin", "stroke-linecap", "font-size", "font-weight", "opacity", "text-anchor"]) {
    const value = attributes[property] ?? (property === "fill" || property === "stroke" ? "none" : undefined);
    if (value !== undefined) element.style.setProperty(property,
      property === "font-size" && typeof value === "number" ? `${value}px` : String(value), "important");
  }
  return element;
}

/** Replace reserved label lines while they are mounted for precise SVG measurement. */
function installProjectMapMetricCharts(svg: SVGSVGElement, graph: ProjectMapMermaidGraph) {
  if (!graph.metrics) return;
  const comparisons = projectMapVolumeComparisons(graph.metrics,
    [...graph.nodeByKey.values(), ...graph.layerByKey.values()].map((component) => component.id));
  for (const visual of svg.querySelectorAll<SVGGraphicsElement>("g.node[data-project-map-metrics], g.cluster[data-project-map-metrics]")) {
    const componentId = visual.getAttribute("data-project-component-id")!;
    const metric = graph.metrics.byComponentId.get(componentId);
    const comparison = comparisons.get(componentId);
    if (!metric || !comparison) continue;
    const spaces = [...visual.querySelectorAll<SVGTextContentElement>(".project-map-metric-space")]
      .filter((space) => space.closest("g.node, g.cluster") === visual);
    const volume = [...visual.querySelectorAll<SVGTextPositioningElement>(".project-map-metric-volume")]
      .find((text) => text.closest("g.node, g.cluster") === visual);
    if (spaces.length < 2 || !volume) continue;
    const first = spaces[0];
    const last = spaces.at(-1)!;
    const label = first.closest("g.label, g.cluster-label") as SVGGraphicsElement | null;
    if (!label) continue;
    const firstBounds = projectMapMetricTextBounds(first);
    const lastBounds = projectMapMetricTextBounds(last);
    const volumeBounds = projectMapMetricTextBounds(volume);
    if (!firstBounds || !lastBounds || !volumeBounds) continue;
    const name = volume.previousElementSibling as SVGTextContentElement | null;
    const nameBounds = name ? projectMapMetricTextBounds(name) : undefined;
    const textMatrix = first.getScreenCTM();
    const labelMatrix = label.getScreenCTM();
    if (!textMatrix || !labelMatrix) continue;
    const left = Math.min(firstBounds.x, lastBounds.x);
    const right = Math.max(firstBounds.x + firstBounds.width, lastBounds.x + lastBounds.width);
    const width = Math.min(140, right - left);
    // Group the count with its chart, leaving a larger gap below the name.
    // Measure the name's last row as well: its glyph height varies between
    // fonts and expanded folder labels. Each row has an absolute y, so moving
    // the count leaves later reservations and the measured node box in place.
    const volumeOffset = nameBounds
      ? Math.max(0, nameBounds.y + nameBounds.height + firstBounds.height * 0.45 - volumeBounds.y)
      : 0;
    const chartTop = volumeBounds.y + volumeBounds.height + volumeOffset + firstBounds.height * 0.12;
    const height = lastBounds.y + lastBounds.height - chartTop;
    const scaleX = width / 132;
    const scaleY = Math.min(scaleX, height / 36);
    if (!(scaleX > 0 && scaleY > 0)) continue;
    const matrix = labelMatrix.inverse().multiply(textMatrix)
      .translate((left + right) / 2 - 66 * scaleX, chartTop)
      .scale(scaleX, scaleY);
    const chart = metricSvgElement("g", {
      class: "project-map-metric-chart", "data-metric-direction": metric.direction,
      transform: `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`,
      "pointer-events": "none", "aria-hidden": "true",
    });
    const color = METRIC_COLORS[metric.direction];
    if (metric.trend.hasHistory) {
      chart.append(metricSvgElement("path", { d: metric.trend.areaPath, fill: color, opacity: 0.1, stroke: "none" }));
      if (metric.trend.baselineY !== null) chart.append(metricSvgElement("line", {
        x1: 0, x2: 112, y1: metric.trend.baselineY, y2: metric.trend.baselineY,
        stroke: color, "stroke-width": 0.8, opacity: 0.35, "stroke-dasharray": "2 3",
      }));
      chart.append(metricSvgElement("polyline", { points: metric.trend.points, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      if (metric.trend.endpoint) chart.append(metricSvgElement("circle", { cx: metric.trend.endpoint.x, cy: metric.trend.endpoint.y, r: 2.3, fill: color }));
    } else {
      const unknown = metricSvgElement("text", { x: 56, y: 16, "text-anchor": "middle", "font-size": 10, fill: color });
      unknown.textContent = "No history";
      chart.append(unknown);
    }
    const direction = metricSvgElement("text", { x: 124, y: 16, "text-anchor": "middle", "font-size": 15, "font-weight": 600, fill: color });
    direction.textContent = metric.direction === "growth" ? "↗" : metric.direction === "shrink" ? "↘" : metric.direction === "flat" ? "→" : "?";
    chart.append(direction);
    chart.append(metricSvgElement("rect", { x: 0, y: 30, width: 112, height: 4, rx: 2, fill: "#dce3e9" }));
    chart.append(metricSvgElement("rect", { x: 0, y: 30, width: 112 * comparison.ratio, height: 4, rx: 2, fill: color, opacity: 0.7 }));
    chart.setAttribute("data-volume-ratio", String(comparison.ratio));
    const volumeBaseline = volume.getStartPositionOfChar(0).y;
    volume.setAttribute("y", String(volumeBaseline + volumeOffset));
    volume.setAttribute("dy", "0");
    for (const space of spaces) {
      space.style.opacity = "0";
      space.setAttribute("aria-hidden", "true");
    }
    label.append(chart);
  }
}

function releaseMermaidNodeShapeStyles(node: SVGGElement) {
  for (const shape of node.querySelectorAll<SVGElement>(
    ":scope > rect, :scope > polygon, :scope > path, :scope > .outer-path > path",
  )) {
    shape.style.removeProperty("fill");
    shape.style.removeProperty("stroke");
    shape.style.removeProperty("stroke-width");
  }
}

function mermaidNodeKey(
  node: Element,
  nodeByKey: ReadonlyMap<string, ProjectComponent>,
) {
  const dataId = node.getAttribute("data-id");
  if (dataId && nodeByKey.has(dataId)) return dataId;
  const renderedId = projectMapMermaidRenderedNodeId(node.id);
  return renderedId && nodeByKey.has(renderedId) ? renderedId : undefined;
}

function mermaidLayerKey(
  layer: Element,
  layerByKey: ReadonlyMap<string, ProjectComponent>,
) {
  const dataId = layer.getAttribute("data-id");
  if (dataId && layerByKey.has(dataId)) return dataId;
  if (layer.id && layerByKey.has(layer.id)) return layer.id;
  const renderedId = projectMapMermaidRenderedNodeId(layer.id);
  if (renderedId && layerByKey.has(renderedId)) return renderedId;
  return [...layerByKey.keys()].find((key) => layer.id.endsWith(`-${key}`));
}

function componentVisualFromEventTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  if (target.closest("[data-project-map-connection]")) return null;
  return (
    target.closest<SVGElement>("g.node") ??
    target.closest<SVGElement>("g.cluster[data-project-component-id]")
  );
}

function projectMapConnectionFromEventTarget(target: EventTarget | null) {
  return target instanceof Element
    ? target.closest<SVGElement>(`[${PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE}]`)
    : null;
}

function componentVisualFromPointer(
  container: Element,
  target: EventTarget | null,
  clientX: number,
  clientY: number,
) {
  if (!(target instanceof Element)) return null;
  if (target.closest("[data-project-map-connection]")) return null;
  const node = target.closest<SVGElement>("g.node");
  if (node) return node;
  const directRegion = target.closest<SVGElement>(
    "g.cluster[data-project-component-id]",
  );
  if (directRegion) return directRegion;

  let smallestRegion: { area: number; visual: SVGElement } | undefined;
  for (const region of container.querySelectorAll<SVGElement>(
    "g.cluster[data-project-component-id]",
  )) {
    const hitArea = region.querySelector<SVGGraphicsElement>(":scope > rect");
    const bounds = (hitArea ?? region).getBoundingClientRect();
    if (
      clientX < bounds.left ||
      clientX > bounds.right ||
      clientY < bounds.top ||
      clientY > bounds.bottom
    ) {
      continue;
    }
    const area = bounds.width * bounds.height;
    if (!smallestRegion || area < smallestRegion.area) {
      smallestRegion = { area, visual: region };
    }
  }
  return smallestRegion?.visual ?? componentVisualFromEventTarget(target);
}

function connectionAriaLabel(
  connection: ProjectMapMermaidConnection,
  graph: ProjectMapMermaidGraph,
) {
  const componentById = new Map(
    [...graph.nodeByKey.values(), ...graph.layerByKey.values()].map(
      (component) => [component.id, component],
    ),
  );
  const source = componentById.get(connection.source)?.label ?? connection.source;
  const target = componentById.get(connection.target)?.label ?? connection.target;
  const direction =
    connection.direction === "bidirectional"
      ? `between ${source} and ${target}`
      : `from ${source} to ${target}`;
  return `${connection.type} ${direction}.`;
}

function annotateMermaidConnections(
  parsed: Document,
  graph: ProjectMapMermaidGraph,
) {
  const allPaths = Array.from(
    parsed.querySelectorAll<SVGElement>(
      "path[data-edge='true'], .edgePath .flowchart-link",
    ),
  ).filter((path, index, all) => all.indexOf(path) === index);
  const edgeIdentity = (path: SVGElement) =>
    path.getAttribute("data-id") ?? path.id;
  const paths = allPaths;
  const labels = Array.from(
    parsed.querySelectorAll<SVGElement>(".edgeLabel"),
  ).filter((label) => (label.textContent ?? "").trim().length > 0);
  const usedConnectionIndexes = new Set<number>();
  const normalizeType = (value: string | null | undefined) =>
    (value ?? "").replace(/\s+/g, " ").trim();
  const edgeMatchesConnection = (
    path: SVGElement,
    connection: ProjectMapMermaidConnection,
  ) => {
    const identity = edgeIdentity(path);
    const direct = `L_${connection.renderedSource}_${connection.renderedTarget}_`;
    if (identity.startsWith(direct) || identity.includes(`-${direct}`)) {
      return true;
    }
    if (connection.direction !== "bidirectional") return false;
    const reverse = `L_${connection.renderedTarget}_${connection.renderedSource}_`;
    return identity.startsWith(reverse) || identity.includes(`-${reverse}`);
  };
  const connectionIndexFor = (
    path: SVGElement,
    label: SVGElement | undefined,
  ) => {
    const labelType = normalizeType(label?.textContent);
    const available = graph.connections
      .map((connection, index) => ({ connection, index }))
      .filter(({ index }) => !usedConnectionIndexes.has(index));
    const exact = available.find(
      ({ connection }) =>
        edgeMatchesConnection(path, connection) &&
        normalizeType(connection.type) === labelType,
    );
    if (exact) return exact.index;
    const byEdge = available.find(({ connection }) =>
      edgeMatchesConnection(path, connection),
    );
    if (byEdge) return byEdge.index;
    const byLabel = available.find(
      ({ connection }) => normalizeType(connection.type) === labelType,
    );
    return byLabel?.index;
  };

  paths.forEach((path, index) => {
    const label = labels[index];
    const connectionIndex = connectionIndexFor(path, label);
    if (connectionIndex === undefined) return;
    usedConnectionIndexes.add(connectionIndex);
    const connection = graph.connections[connectionIndex];
    const ariaLabel = connectionAriaLabel(connection, graph);
    const connectionKey = `connection-${connectionIndex}`;
    const edgeGroup = path.closest<SVGGElement>(".edgePath");
    const annotateConnectionElement = (element: SVGElement) => {
      element.setAttribute("data-project-map-connection", "true");
      element.setAttribute(PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE, connectionKey);
      element.setAttribute(
        PROJECT_MAP_CONNECTION_SOURCE_ATTRIBUTE,
        connection.source,
      );
      element.setAttribute(
        PROJECT_MAP_CONNECTION_TARGET_ATTRIBUTE,
        connection.target,
      );
      element.setAttribute("data-project-map-family", connection.family);
    };
    for (const element of [path, label, edgeGroup]) {
      if (!element) continue;
      annotateConnectionElement(element);
      element.setAttribute("aria-label", ariaLabel);
    }
    const hitPath = parsed.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    for (const attribute of ["d", "transform", "pathLength"]) {
      const value = path.getAttribute(attribute);
      if (value !== null) hitPath.setAttribute(attribute, value);
    }
    hitPath.setAttribute("class", "project-map-connection-hit");
    hitPath.setAttribute("aria-hidden", "true");
    annotateConnectionElement(hitPath);
    path.parentNode?.insertBefore(hitPath, path);
  });
}

interface ProjectMapSvgRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function unionProjectMapSvgRects(
  rectangles: readonly ProjectMapSvgRect[],
): ProjectMapSvgRect | undefined {
  if (rectangles.length === 0) return undefined;
  const left = Math.min(...rectangles.map((rectangle) => rectangle.x));
  const top = Math.min(...rectangles.map((rectangle) => rectangle.y));
  const right = Math.max(
    ...rectangles.map((rectangle) => rectangle.x + rectangle.width),
  );
  const bottom = Math.max(
    ...rectangles.map((rectangle) => rectangle.y + rectangle.height),
  );
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function elementRectInProjectMapSvg(
  element: Element,
  svgBounds: DOMRect,
  viewBox: ProjectMapSvgRect,
): ProjectMapSvgRect | undefined {
  if (svgBounds.width <= 0 || svgBounds.height <= 0) return undefined;
  const bounds = element.getBoundingClientRect();
  if (
    !Number.isFinite(bounds.left) ||
    !Number.isFinite(bounds.top) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height)
  ) {
    return undefined;
  }
  const scaleX = viewBox.width / svgBounds.width;
  const scaleY = viewBox.height / svgBounds.height;
  return {
    x: viewBox.x + (bounds.left - svgBounds.left) * scaleX,
    y: viewBox.y + (bounds.top - svgBounds.top) * scaleY,
    width: bounds.width * scaleX,
    height: bounds.height * scaleY,
  };
}

interface MeasuredProjectMapVisual {
  element: SVGElement;
  componentId: string;
  bounds: ProjectMapSvgRect;
}

interface ProjectMapVisualPackingGroup {
  id: string;
  visuals: Array<{
    element: SVGElement;
    bounds: ProjectMapSvgRect;
  }>;
  bounds: ProjectMapSvgRect;
}

function projectMapRectContainsCenter(
  container: ProjectMapSvgRect,
  contained: ProjectMapSvgRect,
) {
  const centerX = contained.x + contained.width / 2;
  const centerY = contained.y + contained.height / 2;
  const tolerance = 0.5;
  return (
    centerX >= container.x - tolerance &&
    centerX <= container.x + container.width + tolerance &&
    centerY >= container.y - tolerance &&
    centerY <= container.y + container.height + tolerance
  );
}

function prepareProjectMapVisualTranslation(
  element: SVGElement,
  svg: SVGSVGElement,
  x: number,
  y: number,
) {
  const parent = element.parentElement as unknown as SVGGraphicsElement;
  const parentMatrix = parent.getScreenCTM();
  const svgMatrix = svg.getScreenCTM();
  if (!parentMatrix || !svgMatrix) return () => {};
  const matrix = parentMatrix.inverse().multiply(svgMatrix);
  const dx = matrix.a * x + matrix.c * y;
  const dy = matrix.b * x + matrix.d * y;
  const current = element.getAttribute("transform")?.trim();
  return () => element.setAttribute("transform", `translate(${dx} ${dy})${current ? ` ${current}` : ""}`);
}

function foldMeasuredProjectMapChain(
  group: ProjectMapVisualPackingGroup,
  svg: SVGSVGElement,
  graph: ProjectMapMermaidGraph,
) {
  // Expanded containment and branching graphs keep their complete Dagre routes.
  if (graph.layerByKey.size > 0) return false;
  const nodes = group.visuals.filter(({ element }) => element.matches("g.node"));
  const byId = new Map(nodes.map((visual) => [
    visual.element.getAttribute("data-project-component-id")!, visual,
  ]));
  const order = projectMapDirectedChain([...byId.keys()], graph.connections);
  if (!order) return false;
  const connectionIndexBySource = new Map(graph.connections.map(({ source }, index) => [source, index]));
  const labelsByKey = new Map(group.visuals.filter(({ element }) => element.matches("g.edgeLabel"))
    .map((visual) => [visual.element.getAttribute(PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE), visual]));
  const pathsByKey = new Map<string, SVGPathElement[]>();
  for (const path of svg.querySelectorAll<SVGPathElement>(`path[${PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE}]`)) {
    const key = path.getAttribute(PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE)!;
    const paths = pathsByKey.get(key) ?? [];
    paths.push(path);
    pathsByKey.set(key, paths);
  }
  const edges = order.slice(0, -1).map((id) => {
    const index = connectionIndexBySource.get(id);
    const key = `connection-${index}`;
    const label = labelsByKey.get(key);
    const paths = pathsByKey.get(key) ?? [];
    return { label, paths };
  });
  if (edges.some(({ label, paths }) => !label || paths.length === 0)) return false;
  const folded = foldProjectMapChain(
    order.map((id) => ({ id, ...byId.get(id)!.bounds })),
    edges.map(({ label }) => label!.bounds),
    /^flowchart (BT|RL)$/m.test(graph.source),
  );
  if (!folded) return false;
  // Read coordinate transforms as one batch before changing any SVG geometry.
  const changes: Array<() => void> = [];
  for (const placement of folded.placements) {
    const node = byId.get(placement.id)!;
    changes.push(prepareProjectMapVisualTranslation(node.element, svg,
      group.bounds.x + placement.x - node.bounds.x,
      group.bounds.y + placement.y - node.bounds.y,
    ));
  }
  folded.routes.forEach((route, index) => {
    const { paths, label } = edges[index];
    for (const path of paths) {
      const parent = path.parentElement as unknown as SVGGraphicsElement;
      const parentMatrix = parent.getScreenCTM();
      const svgMatrix = svg.getScreenCTM();
      if (!parentMatrix || !svgMatrix) continue;
      const matrix = parentMatrix.inverse().multiply(svgMatrix)
        .translate(group.bounds.x, group.bounds.y);
      changes.push(() => {
        path.setAttribute("d", route.path);
        path.setAttribute("transform",
          `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`,
        );
      });
    }
    changes.push(prepareProjectMapVisualTranslation(label!.element, svg,
      group.bounds.x + route.label.x - label!.bounds.x,
      group.bounds.y + route.label.y - label!.bounds.y,
    ));
  });
  for (const change of changes) change();
  return true;
}

/**
 * Measure the finished SVG once, fold isolated simple chains, then pack weak
 * visual components (including real containment). Packing translates every
 * node, route, hit path, label, and real containment box together.
 */
async function packDisconnectedMermaidComponents(
  svg: SVGSVGElement,
  graph: ProjectMapMermaidGraph,
) {
  if (!document.body) return svg.outerHTML;
  const stage = document.createElement("div");
  stage.className = `project-map-mermaid project-map-mermaid--${graph.origin} project-map-mermaid__measurement`;
  stage.setAttribute("aria-hidden", "true");
  stage.style.cssText = [
    "position:fixed",
    "left:-100000px",
    "top:0",
    "opacity:0",
    "z-index:-1",
    "pointer-events:none",
    "overflow:visible",
  ].join(";");
  const wrapper = document.createElement("div");
  wrapper.className = "project-map-mermaid__svg";
  // Adopt the annotated SVG directly. Serializing and reparsing the complete
  // graph here duplicates a large DOM before any measurement has begun.
  wrapper.append(svg);
  stage.append(wrapper);
  document.body.append(stage);

  try {
    const rendered = svg;
    installProjectMapMetricCharts(rendered, graph);
    const rawViewBox = rendered.viewBox.baseVal;
    if (rawViewBox.width <= 0 || rawViewBox.height <= 0) return rendered.outerHTML;
    const viewBox: ProjectMapSvgRect = {
      x: rawViewBox.x,
      y: rawViewBox.y,
      width: rawViewBox.width,
      height: rawViewBox.height,
    };
    const originalStyle = rendered.getAttribute("style");
    const finishedSvg = () => {
      if (originalStyle === null) rendered.removeAttribute("style");
      else rendered.setAttribute("style", originalStyle);
      return rendered.outerHTML;
    };
    stage.style.width = `${viewBox.width}px`;
    stage.style.height = `${viewBox.height}px`;
    if (rendered.parentElement) {
      rendered.parentElement.style.width = `${viewBox.width}px`;
      rendered.parentElement.style.height = `${viewBox.height}px`;
    }
    rendered.style.width = `${viewBox.width}px`;
    rendered.style.height = `${viewBox.height}px`;
    rendered.style.maxWidth = "none";
    rendered.style.overflow = "visible";
    if (graph.layerByKey.size > 0) {
      const { reflowCompoundMermaidSvg } = await import("../projectMapCompoundLayout");
      if (reflowCompoundMermaidSvg(rendered, graph)) {
        if (originalStyle === null) rendered.removeAttribute("style");
        else rendered.setAttribute("style", originalStyle);
        return rendered.outerHTML;
      }
    }
    const svgBounds = rendered.getBoundingClientRect();
    const componentVisuals = Array.from(
      rendered.querySelectorAll<SVGElement>(
        "g.node[data-project-component-id], g.cluster[data-project-component-id]",
      ),
    ).flatMap((element): MeasuredProjectMapVisual[] => {
      const componentId = element.getAttribute("data-project-component-id");
      const bounds = elementRectInProjectMapSvg(element, svgBounds, viewBox);
      return componentId && bounds ? [{ element, componentId, bounds }] : [];
    });
    if (componentVisuals.length < 4) return finishedSvg();

    const parent = componentVisuals.map((_, index) => index);
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
    const visualIndexesByComponentId = new Map<string, number[]>();
    componentVisuals.forEach(({ componentId }, index) => {
      const indexes = visualIndexesByComponentId.get(componentId) ?? [];
      indexes.push(index);
      visualIndexesByComponentId.set(componentId, indexes);
    });
    for (const indexes of visualIndexesByComponentId.values()) {
      for (const index of indexes.slice(1)) unite(indexes[0], index);
    }
    for (const connection of graph.connections) {
      const sourceIndexes =
        visualIndexesByComponentId.get(connection.source) ?? [];
      const targetIndexes =
        visualIndexesByComponentId.get(connection.target) ?? [];
      if (sourceIndexes.length === 0 || targetIndexes.length === 0) continue;
      unite(sourceIndexes[0], targetIndexes[0]);
    }
    componentVisuals.forEach((cluster, clusterIndex) => {
      if (!cluster.element.matches("g.cluster")) return;
      componentVisuals.forEach((visual, visualIndex) => {
        if (
          visualIndex !== clusterIndex &&
          projectMapRectContainsCenter(cluster.bounds, visual.bounds)
        ) {
          unite(clusterIndex, visualIndex);
        }
      });
    });

    const groupVisuals = new Map<
      number,
      ProjectMapVisualPackingGroup["visuals"]
    >();
    componentVisuals.forEach(({ element, bounds }, index) => {
      const root = find(index);
      const visuals = groupVisuals.get(root) ?? [];
      visuals.push({ element, bounds });
      groupVisuals.set(root, visuals);
    });

    const connectionVisuals = [
      ...rendered.querySelectorAll<SVGElement>(
        `g.edgePath[${PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE}]`,
      ),
      ...rendered.querySelectorAll<SVGElement>(
        `g.edgeLabel[${PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE}]`,
      ),
      ...rendered.querySelectorAll<SVGElement>(
        `path[${PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE}]`,
      ),
    ].filter(
      (element, index, all) =>
        all.indexOf(element) === index &&
        !(
          element.matches("path") &&
          element.closest(
            `g.edgePath[${PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE}]`,
          )
        ),
    );
    for (const element of connectionVisuals) {
      const source = element.getAttribute(
        PROJECT_MAP_CONNECTION_SOURCE_ATTRIBUTE,
      );
      const target = element.getAttribute(
        PROJECT_MAP_CONNECTION_TARGET_ATTRIBUTE,
      );
      const endpointIndex =
        (source ? visualIndexesByComponentId.get(source)?.[0] : undefined) ??
        (target ? visualIndexesByComponentId.get(target)?.[0] : undefined);
      const bounds = elementRectInProjectMapSvg(element, svgBounds, viewBox);
      if (endpointIndex === undefined || !bounds) continue;
      const root = find(endpointIndex);
      groupVisuals.get(root)?.push({ element, bounds });
    }

    const groups = Array.from(groupVisuals, ([root, visuals]) => {
      const bounds = unionProjectMapSvgRects(
        visuals.map((visual) => visual.bounds),
      );
      return bounds
        ? ({
            id: String(root),
            visuals,
            bounds,
          } satisfies ProjectMapVisualPackingGroup)
        : undefined;
    }).filter(
      (group): group is ProjectMapVisualPackingGroup => group !== undefined,
    );
    let foldedChains = 0;
    const translations: Array<() => void> = [];
    for (const group of groups) {
      if (!foldMeasuredProjectMapChain(group, rendered, graph)) continue;
      foldedChains += 1;
      for (const visual of group.visuals) {
        visual.bounds = elementRectInProjectMapSvg(visual.element, svgBounds, viewBox) ?? visual.bounds;
      }
      group.bounds = unionProjectMapSvgRects(group.visuals.map(({ bounds }) => bounds)) ?? group.bounds;
    }
    if (groups.length < 4 && foldedChains === 0) return finishedSvg();

    const packing = packProjectMapDisconnectedComponents(
      // Put similarly sized chains together; small disconnected items must
      // not reserve a whole tall row beside each chain independently.
      (foldedChains > 0
        ? [...groups].sort((left, right) => right.bounds.height - left.bounds.height)
        : groups
      ).map(({ id, bounds }) => ({
        id,
        width: bounds.width,
        height: bounds.height,
      })),
    );
    const placementById = new Map(
      packing.placements.map((placement) => [placement.id, placement]),
    );
    const gridLeft = Math.min(...groups.map(({ bounds }) => bounds.x));
    const gridTop = Math.min(...groups.map(({ bounds }) => bounds.y));

    for (const group of groups) {
      const placement = placementById.get(group.id);
      if (!placement) continue;
      const translateX = gridLeft + placement.x - group.bounds.x;
      const translateY = gridTop + placement.y - group.bounds.y;
      for (const { element } of group.visuals) {
        translations.push(prepareProjectMapVisualTranslation(element, rendered, translateX, translateY));
      }
    }
    for (const translate of translations) translate();

    const finalBounds = unionProjectMapSvgRects(
      Array.from(
        new Set(
          groups.flatMap((group) =>
            group.visuals.map(({ element }) => element),
          ),
        ),
      ).flatMap((visual) => {
        const bounds = elementRectInProjectMapSvg(
          visual,
          svgBounds,
          viewBox,
        );
        return bounds ? [bounds] : [];
      }),
    );
    if (finalBounds && finalBounds.width > 0 && finalBounds.height > 0) {
      const margin = 20;
      const width = finalBounds.width + margin * 2;
      const height = finalBounds.height + margin * 2;
      rendered.setAttribute(
        "viewBox",
        [
          finalBounds.x - margin,
          finalBounds.y - margin,
          width,
          height,
        ]
          .map((value) => Number(value.toFixed(3)))
          .join(" "),
      );
      rendered.setAttribute("width", String(Number(width.toFixed(3))));
      rendered.setAttribute("height", String(Number(height.toFixed(3))));
    }
    rendered.setAttribute(
      "data-project-map-folded-chains",
      String(foldedChains),
    );
    rendered.setAttribute(
      "data-project-map-packed-components",
      String(groups.length),
    );
    rendered.setAttribute(
      "data-project-map-packed-columns",
      String(packing.columnCount),
    );
    rendered.setAttribute(
      "data-project-map-packed-rows",
      String(packing.rowCount),
    );
    if (originalStyle === null) rendered.removeAttribute("style");
    else rendered.setAttribute("style", originalStyle);
    return rendered.outerHTML;
  } finally {
    stage.remove();
  }
}

async function interactiveMermaidSvg(
  svg: string,
  graph: ProjectMapMermaidGraph,
  childrenByParent: ReadonlyMap<string, ProjectComponent[]>,
) {
  if (!svg) return "";
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (parsed.querySelector("parsererror")) return svg;
  // Node details use one accessible hover card. Native SVG/HTML titles would
  // create a second popup, including titles inherited from expanded parents.
  for (const title of parsed.querySelectorAll("g.node title, g.cluster title")) title.remove();
  for (const element of parsed.querySelectorAll("g.node[title], g.node [title], g.cluster[title], g.cluster [title]")) {
    element.removeAttribute("title");
  }
  annotateMermaidConnections(parsed, graph);
  for (const node of parsed.querySelectorAll<SVGGElement>("g.node")) {
    const key = mermaidNodeKey(node, graph.nodeByKey);
    const component = key ? graph.nodeByKey.get(key) : undefined;
    if (!component) continue;
    const action = componentAction(
      component,
      childrenByParent.get(component.id)?.length ?? 0,
    );
    const actionKind = componentActionKind(
      component,
      childrenByParent.get(component.id)?.length ?? 0,
    );
    const kindLabel = componentKindLabel(component);
    const openingCue = annotateOpeningCue(node, component);
    const metricDescription = annotateMetrics(node, component, graph);
    const roleLabel = projectMapRoleLabel(component, graph.effectiveRoles.get(component.id));
    releaseMermaidNodeShapeStyles(node);
    node.setAttribute("data-project-component-id", component.id);
    node.setAttribute("data-project-map-key", key!);
    node.setAttribute("data-project-component-kind", component.kind);
    node.setAttribute("data-project-map-action", actionKind);
    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
    node.setAttribute(
      "aria-label",
      `${kindLabel}: ${component.label}. ${roleLabel ? `${roleLabel}. ` : ""}${component.description ? `${component.description}. ` : ""}${openingCue ? `${openingCue}. ` : ""}${metricDescription ? `${metricDescription}. ` : ""}${action}.`,
    );
    node.classList.add(`project-map-node--${component.kind}`);
  }
  for (const layer of parsed.querySelectorAll<SVGGElement>("g.cluster")) {
    const key = mermaidLayerKey(layer, graph.layerByKey);
    const component = key ? graph.layerByKey.get(key) : undefined;
    if (!component) continue;
    const openingCue = annotateOpeningCue(layer, component);
    const metricDescription = annotateMetrics(layer, component, graph);
    const roleLabel = projectMapRoleLabel(component, graph.effectiveRoles.get(component.id));
    const visibleDepth = key
      ? graph.layerVisibleDepthByKey.get(key)
      : undefined;
    releaseMermaidNodeShapeStyles(layer);
    layer.setAttribute("data-project-component-id", component.id);
    layer.setAttribute("data-project-map-key", key!);
    layer.setAttribute("data-project-component-kind", component.kind);
    layer.setAttribute("data-project-map-action", "enter");
    layer.setAttribute("data-canvas-interactive", "true");
    layer.classList.add("project-map-layer-cluster");
    layer.classList.add(`project-map-node--${component.kind}`);
    const label = layer.querySelector<SVGElement>(":scope > .cluster-label");
    const activationTarget = label ?? layer;
    activationTarget.setAttribute("data-project-component-id", component.id);
    activationTarget.setAttribute("role", "button");
    activationTarget.setAttribute("tabindex", "0");
    activationTarget.setAttribute(
      "aria-label",
      `${componentKindLabel(component)}: ${component.label}. ${roleLabel ? `${roleLabel}. ` : ""}${component.description ? `${component.description}. ` : ""}${openingCue ? `${openingCue}. ` : ""}${metricDescription ? `${metricDescription}. ` : ""}Open as Structure layer${
        visibleDepth ? ` at depth ${visibleDepth}` : ""
      }.`,
    );
    activationTarget.classList.add("project-map-layer-cluster__label");
  }
  return packDisconnectedMermaidComponents(
    parsed.documentElement as unknown as SVGSVGElement,
    graph,
  );
}

interface ComponentTooltipState {
  key: string;
  component: ProjectComponent;
  metric?: ProjectMapMetric;
  comparison?: { ratio: number; maximumLines: number; peerCount: number };
  visual: SVGElement;
}

export const ProjectMapMermaidCanvas = memo(function ProjectMapMermaidCanvas({
  graph,
  matchingIds,
  selectedId,
  hoveredComponentId,
  onHoverComponent,
  textScale,
  childrenByParent,
  onActivate,
  preloadGraph,
  onPrepare,
  onRenderedGraphChange,
  onRenderStatusChange,
}: ProjectMapMermaidCanvasProps) {
  const reactId = useId();
  const diagramId = `mindflow-project-map-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const renderCacheRef = useRef(new Map<string, MermaidRenderState>());
  const layoutCacheRef = useRef(new Map<string, string>());
  const renderRequestsRef = useRef(
    new Map<string, { promise: Promise<MermaidRenderState>; controller: AbortController }>(),
  );
  const preloadRenderSequenceRef = useRef(0);
  const svgContainerRef = useRef<HTMLDivElement | null>(null);
  const linkedHoverRef = useRef<string | undefined>(undefined);
  const renderKey = useMemo(
    () => projectMapGraphRenderKey(graph, textScale, childrenByParent),
    [childrenByParent, graph, textScale],
  );
  const preloadRenderKey = useMemo(
    () =>
      preloadGraph
        ? projectMapGraphRenderKey(
            preloadGraph,
            textScale,
            childrenByParent,
          )
        : undefined,
    [childrenByParent, preloadGraph, textScale],
  );
  const activeRenderKeyRef = useRef(renderKey);
  useLayoutEffect(() => {
    activeRenderKeyRef.current = renderKey;
    for (const [key, request] of renderRequestsRef.current) {
      if (key !== renderKey && key !== preloadRenderKey) {
        request.controller.abort();
        renderRequestsRef.current.delete(key);
      }
    }
  }, [renderKey, preloadRenderKey]);
  useEffect(() => () => {
    for (const request of renderRequestsRef.current.values()) request.controller.abort();
    renderRequestsRef.current.clear();
  }, []);
  const tooltipId = `${diagramId}-node-tooltip`;
  const tooltipRef = useRef<HTMLDivElement>(null);
  const dismissedTooltipVisual = useRef<SVGElement | undefined>(undefined);
  const [componentTooltip, setComponentTooltip] = useState<ComponentTooltipState>();
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties>({ left: 8, top: 8, visibility: "hidden" });
  const tooltip = componentTooltip?.key === renderKey ? componentTooltip : undefined;
  const metricComparisons = useMemo(() => graph.metrics ? projectMapVolumeComparisons(graph.metrics,
    [...graph.nodeByKey.values(), ...graph.layerByKey.values()].map((component) => component.id)) : undefined, [graph]);
  useLayoutEffect(() => {
    if (!tooltip || !tooltipRef.current) return;
    const element = tooltipRef.current;
    const box = element.getBoundingClientRect();
    const anchor = tooltip.visual.getBoundingClientRect();
    const left = anchor.right + box.width + 12 <= window.innerWidth
      ? anchor.right + 12 : anchor.left - box.width - 12;
    setTooltipStyle({
      left: Math.max(8, Math.min(left, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(anchor.top, window.innerHeight - box.height - 8)),
      visibility: "visible",
    });
    const target = tooltip.visual.matches("g.cluster")
      ? tooltip.visual.querySelector(".project-map-layer-cluster__label") ?? tooltip.visual : tooltip.visual;
    const previousDescription = target.getAttribute("aria-describedby");
    target.setAttribute("aria-describedby", tooltipId);
    return () => {
      if (previousDescription) target.setAttribute("aria-describedby", previousDescription);
      else target.removeAttribute("aria-describedby");
    };
  }, [tooltip, tooltipId]);
  useEffect(() => {
    if (!tooltip) return;
    const dismiss = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dismissedTooltipVisual.current = tooltip.visual;
      setComponentTooltip(undefined);
    };
    const focusOutside = (event: globalThis.FocusEvent) => {
      if (event.target instanceof Node && !svgContainerRef.current?.contains(event.target)) setComponentTooltip(undefined);
    };
    const blurWindow = () => setComponentTooltip(undefined);
    window.addEventListener("keydown", dismiss, true);
    window.addEventListener("focusin", focusOutside);
    window.addEventListener("blur", blurWindow);
    return () => {
      window.removeEventListener("keydown", dismiss, true);
      window.removeEventListener("focusin", focusOutside);
      window.removeEventListener("blur", blurWindow);
    };
  }, [tooltip]);
  useEffect(() => {
    const dismiss = () => setComponentTooltip(undefined);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("wheel", dismiss, { passive: true, capture: true });
    return () => {
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("wheel", dismiss, true);
    };
  }, []);
  useLayoutEffect(() => {
    dismissedTooltipVisual.current = undefined;
    setComponentTooltip(undefined);
  }, [renderKey]);
  const graphLabel = "Structure";
  const [renderState, setRenderState] = useState<MermaidRenderState>(() => ({
    key: renderKey,
    source: graph.source,
    textScale,
    status: "loading",
  }));
  const [renderAttempt, setRenderAttempt] = useState(0);
  const cachedRenderState = renderCacheRef.current.get(renderKey);
  const currentState: MermaidRenderState =
    renderState.key === renderKey
      ? renderState
      : cachedRenderState ?? {
          key: renderKey,
          source: graph.source,
          textScale,
          status: "loading",
        };
  const contentSize = currentState.size ?? mermaidSvgSize("");
  const interactiveSvg = currentState.svg ?? "";
  // Preloading must not replace the live nodes between pointer-down and click.
  const svgMarkup = useMemo(
    () => ({ __html: interactiveSvg }),
    [interactiveSvg],
  );
  const requestRenderedGraph = (
    targetGraph: ProjectMapMermaidGraph,
    targetRenderKey: string,
    targetDiagramId: string,
  ) => {
    const cached = renderCacheRef.current.get(targetRenderKey);
    if (cached) return Promise.resolve(cached);
    const pending = renderRequestsRef.current.get(targetRenderKey);
    if (pending && !pending.controller.signal.aborted) return pending.promise;
    const controller = new AbortController();
    const layoutKey = mermaidRenderKey(targetGraph.source, textScale);
    const cachedLayout = layoutCacheRef.current.get(layoutKey);
    if (cachedLayout) {
      layoutCacheRef.current.delete(layoutKey);
      layoutCacheRef.current.set(layoutKey, cachedLayout);
    }
    // Metadata changes update exact labels/actions without repeating Dagre.
    const layout = cachedLayout ? Promise.resolve({ svg: cachedLayout }) : renderMermaid(
      targetDiagramId, targetGraph.source, textScale,
      { signal: controller.signal, priority: () => activeRenderKeyRef.current === targetRenderKey ? "foreground" : "background" },
    );
    const request = layout
      .then(async ({ svg }) => {
        if (controller.signal.aborted) throw mermaidRenderAborted();
        if (!cachedLayout && svg.length <= PROJECT_MAP_SVG_CACHE_CHARACTERS) {
          layoutCacheRef.current.set(layoutKey, svg);
          let characters = [...layoutCacheRef.current.values()].reduce((sum, value) => sum + value.length, 0);
          while (layoutCacheRef.current.size > PROJECT_MAP_LAYOUT_CACHE_LIMIT || characters > PROJECT_MAP_SVG_CACHE_CHARACTERS) {
            const oldest = layoutCacheRef.current.keys().next().value!;
            characters -= layoutCacheRef.current.get(oldest)!.length;
            layoutCacheRef.current.delete(oldest);
          }
        }
        const interactiveSvg = await interactiveMermaidSvg(
          svg,
          targetGraph,
          childrenByParent,
        );
        if (controller.signal.aborted) throw mermaidRenderAborted();
        const size = mermaidSvgSize(interactiveSvg);
        const nextState: MermaidRenderState = {
          key: targetRenderKey,
          source: targetGraph.source,
          textScale,
          status: "rendered",
          svg: interactiveSvg,
          size,
        };
        if (interactiveSvg.length <= PROJECT_MAP_SVG_CACHE_CHARACTERS) {
          renderCacheRef.current.set(targetRenderKey, nextState);
          let characters = [...renderCacheRef.current.values()].reduce((sum, value) => sum + (value.svg?.length ?? 0), 0);
          while (renderCacheRef.current.size > PROJECT_MAP_RENDER_CACHE_LIMIT || characters > PROJECT_MAP_SVG_CACHE_CHARACTERS) {
            const oldest = renderCacheRef.current.keys().next().value!;
            characters -= renderCacheRef.current.get(oldest)!.svg?.length ?? 0;
            renderCacheRef.current.delete(oldest);
          }
        }
        return nextState;
      })
      .finally(() => {
        if (renderRequestsRef.current.get(targetRenderKey)?.promise === request) {
          renderRequestsRef.current.delete(targetRenderKey);
        }
      });
    renderRequestsRef.current.set(targetRenderKey, { promise: request, controller });
    return request;
  };
  useEffect(() => {
    let active = true;
    const cached = renderCacheRef.current.get(renderKey);
    if (cached) {
      setRenderState(cached);
      return () => {
        active = false;
      };
    }
    setRenderState({
      key: renderKey,
      source: graph.source,
      textScale,
      status: "loading",
    });
    void requestRenderedGraph(graph, renderKey, diagramId)
      .then((nextState) => {
        if (active) {
          setRenderState(nextState);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setRenderState({
            key: renderKey,
            source: graph.source,
            textScale,
            status: "error",
            error: renderErrorMessage(error),
          });
        }
      });
    return () => {
      active = false;
    };
  }, [childrenByParent, diagramId, graph, renderKey, renderAttempt, textScale]);

  useLayoutEffect(() => {
    onRenderStatusChange(currentState.status);
  }, [currentState.status, onRenderStatusChange]);

  useEffect(() => {
    if (
      !preloadGraph ||
      !preloadRenderKey ||
      preloadRenderKey === renderKey ||
      renderCacheRef.current.has(preloadRenderKey) ||
      renderRequestsRef.current.has(preloadRenderKey) ||
      // Dense layouts remain available on activation; pointer travel should
      // not start an expensive synchronous layout speculatively.
      preloadGraph.layout.pressure.nodeCount > 48 ||
      preloadGraph.layout.pressure.connectionCount > 96
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      preloadRenderSequenceRef.current += 1;
      const preloadDiagramId = `${diagramId}-preload-${preloadRenderSequenceRef.current}`;
      const preloadStartedAt = performance.now();
      void requestRenderedGraph(
        preloadGraph,
        preloadRenderKey,
        preloadDiagramId,
      )
        .then(() => {
          performance.mark("mindflow:structure:destination-prepared");
          if (import.meta.env.DEV) {
            console.debug(
              `[mindflow-performance] mindflow:structure:destination-prepared ${(
                performance.now() - preloadStartedAt
              ).toFixed(1)}ms`,
            );
          }
        })
        .catch(() => {
          // Intent preloading is opportunistic; active rendering reports failures.
        });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [
    childrenByParent,
    diagramId,
    preloadGraph,
    preloadRenderKey,
    renderKey,
    textScale,
  ]);

  useLayoutEffect(() => {
    if (currentState.status !== "rendered" || !currentState.svg) return;
    onRenderedGraphChange({
      source: graph.source,
      svg: currentState.svg,
      size: contentSize,
      textScale,
    });
  }, [
    contentSize,
    currentState.status,
    currentState.svg,
    graph.source,
    onRenderedGraphChange,
    textScale,
  ]);

  useLayoutEffect(() => {
    const container = svgContainerRef.current;
    if (!container || currentState.status !== "rendered") return;
    setProjectMapPresentationState(
      container,
      selectedId,
      matchingIds,
    );
  }, [currentState.status, interactiveSvg, matchingIds, selectedId]);

  useLayoutEffect(() => {
    const container = svgContainerRef.current;
    if (!container || currentState.status !== "rendered") return;
    // The old hovered element may disappear without a pointer-out event. Its
    // container survives SVG replacement, so clear the old layer's emphasis.
    setProjectMapComponentHover(container, null);
    onHoverComponent?.(undefined);
  }, [currentState.status, interactiveSvg, onHoverComponent]);

  useLayoutEffect(() => {
    const container = svgContainerRef.current;
    if (!container || currentState.status !== "rendered") return;
    if (hoveredComponentId || linkedHoverRef.current) {
      const visual = [...container.querySelectorAll("[data-project-component-id]")]
        .find((element) => element.getAttribute("data-project-component-id") === hoveredComponentId);
      setProjectMapComponentHover(container, visual ?? null);
    }
    linkedHoverRef.current = hoveredComponentId;
  }, [currentState.status, hoveredComponentId, interactiveSvg]);

  const visualComponent = (visual: SVGElement) => {
    const nodeKey = visual.classList.contains("node")
      ? mermaidNodeKey(visual, graph.nodeByKey)
      : undefined;
    const layerKey = visual.classList.contains("cluster")
      ? mermaidLayerKey(visual, graph.layerByKey)
      : undefined;
    const component = nodeKey
      ? graph.nodeByKey.get(nodeKey)
      : layerKey
        ? graph.layerByKey.get(layerKey)
        : undefined;
    return component
      ? {
          component,
          expandedRegionDepth: layerKey
            ? graph.layerVisibleDepthByKey.get(layerKey)
            : undefined,
        }
      : undefined;
  };

  const showComponentTooltip = (visual: SVGElement | null) => {
    if (!visual) { setComponentTooltip(undefined); return; }
    if (dismissedTooltipVisual.current === visual) return;
    const resolved = visualComponent(visual);
    const metric = resolved ? graph.metrics?.byComponentId.get(resolved.component.id) : undefined;
    const comparison = resolved ? metricComparisons?.get(resolved.component.id) : undefined;
    if (!resolved) { setComponentTooltip(undefined); return; }
    setComponentTooltip((current) => current?.visual === visual && current.key === renderKey ? current
      : { key: renderKey, component: resolved.component, metric, comparison, visual });
  };

  const activateVisual = (
    visual: SVGElement,
    modifiers: ProjectMapActivationModifiers,
  ) => {
    const resolved = visualComponent(visual);
    if (!resolved) return;
    setComponentTooltip(undefined);
    onActivate(resolved.component, {
      ...modifiers,
      expandedRegionDepth: resolved.expandedRegionDepth,
    });
  };

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const visual = componentVisualFromPointer(
      event.currentTarget,
      event.target,
      event.clientX,
      event.clientY,
    );
    if (!visual) return;
    const bounds = visual.getBoundingClientRect();
    activateVisual(visual, {
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      origin: {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
      },
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && tooltip) {
      event.preventDefault();
      event.stopPropagation();
      dismissedTooltipVisual.current = tooltip.visual;
      setComponentTooltip(undefined);
      return;
    }
    if (event.key.startsWith("Arrow")) setComponentTooltip(undefined);
    if (event.key !== "Enter" && event.key !== " ") return;
    const visual = componentVisualFromEventTarget(event.target);
    if (!visual) return;
    event.preventDefault();
    const bounds = visual.getBoundingClientRect();
    activateVisual(visual, {
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      origin: {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
      },
    });
  };

  const handlePointerOver = (event: PointerEvent<HTMLDivElement>) => {
    linkedHoverRef.current = undefined;
    const connection = projectMapConnectionFromEventTarget(event.target);
    if (connection) {
      onPrepare?.(undefined);
      setComponentTooltip(undefined);
      setProjectMapConnectionHover(event.currentTarget, connection);
      onHoverComponent?.(undefined);
      return;
    }
    const visual = componentVisualFromEventTarget(event.target);
    const resolved = visual ? visualComponent(visual) : undefined;
    showComponentTooltip(visual);
    onPrepare?.(resolved?.component, resolved?.expandedRegionDepth);
    setProjectMapComponentHover(
      event.currentTarget,
      visual,
    );
    onHoverComponent?.(resolved?.component.id, resolved?.expandedRegionDepth !== undefined);
  };

  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    linkedHoverRef.current = undefined;
    dismissedTooltipVisual.current = undefined;
    const visual = componentVisualFromEventTarget(event.target);
    const resolved = visual ? visualComponent(visual) : undefined;
    showComponentTooltip(visual);
    if (resolved) {
      onPrepare?.(resolved.component, resolved.expandedRegionDepth);
    }
    setProjectMapComponentHover(event.currentTarget, visual);
    onHoverComponent?.(resolved?.component.id, resolved?.expandedRegionDepth !== undefined);
  };

  const handlePointerOut = (event: PointerEvent<HTMLDivElement>) => {
    linkedHoverRef.current = undefined;
    const connection = projectMapConnectionFromEventTarget(event.relatedTarget);
    if (connection) {
      onPrepare?.(undefined);
      setComponentTooltip(undefined);
      setProjectMapConnectionHover(event.currentTarget, connection);
      onHoverComponent?.(undefined);
      return;
    }
    const visual = event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)
      ? componentVisualFromEventTarget(event.relatedTarget) : null;
    if (visual !== componentTooltip?.visual) setComponentTooltip(undefined);
    if (visual !== dismissedTooltipVisual.current) dismissedTooltipVisual.current = undefined;
    setProjectMapComponentHover(
      event.currentTarget,
      visual,
    );
    const resolved = visual ? visualComponent(visual) : undefined;
    onPrepare?.(resolved?.component, resolved?.expandedRegionDepth);
    onHoverComponent?.(resolved?.component.id, resolved?.expandedRegionDepth !== undefined);
  };

  return (
    <div
      className={`project-map-mermaid project-map-mermaid--${graph.origin}`}
      data-graph-origin={graph.origin}
      data-layout-engine={graph.layout.engine}
      data-layout-reason={graph.layout.reason}
    >
      {currentState.status === "loading" ? (
        <div className="project-map-mermaid__status" role="status">
          Laying out {graphLabel} graph…
        </div>
      ) : currentState.status === "error" ? (
        <div className="project-map-mermaid__error" role="alert">
          <strong>
            {graphLabel} graph could not be rendered.
          </strong>
          <span>{currentState.error}</span>
          <button
            type="button"
            className="secondary-button"
            data-canvas-overlay
            onClick={() => setRenderAttempt((attempt) => attempt + 1)}
          >
            Retry graph
          </button>
        </div>
      ) : (
        <div
          className="project-map-mermaid__svg"
          ref={svgContainerRef}
          onClick={handleClick}
          onFocus={handleFocus}
          onBlur={(event) => {
            setComponentTooltip(undefined);
            dismissedTooltipVisual.current = undefined;
            if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
            onPrepare?.(undefined);
            if (linkedHoverRef.current) return;
            setProjectMapComponentHover(event.currentTarget, null);
            onHoverComponent?.(undefined);
          }}
          onKeyDown={handleKeyDown}
          onPointerOut={handlePointerOut}
          onPointerOver={handlePointerOver}
          dangerouslySetInnerHTML={svgMarkup}
        />
      )}
      {tooltip ? createPortal(<div id={tooltipId} ref={tooltipRef} className="structure-node-tooltip"
        role="tooltip" data-direction={tooltip.metric?.direction} style={tooltipStyle}>
        <strong className="structure-node-tooltip__title">{tooltip.component.label}</strong>
        <span className="structure-node-tooltip__path">{tooltip.component.binding?.value}</span>
        {tooltip.component.description ? <p>{tooltip.component.description}</p> : null}
        {tooltip.visual.getAttribute("data-project-map-opening") ? <small>{
          tooltip.visual.getAttribute("data-project-map-opening") === "member" ? "Opening member" : "Contains Opening documents"
        }</small> : null}
        {tooltip.metric ? <>
          <div className="structure-node-tooltip__stats">
            <span>Volume<strong>{tooltip.metric.lines} lines</strong><small>{tooltip.metric.bytes.toLocaleString()} bytes</small></span>
            <span>Net growth<strong>{tooltip.metric.signedGrowth} lines</strong><small>{tooltip.metric.growth === null ? "Comparison unavailable" :
              `${tooltip.metric.addedLines.toLocaleString()} added · ${tooltip.metric.deletedLines.toLocaleString()} deleted`}</small></span>
          </div>
          <p>{tooltip.metric.baseline ? <>Baseline <code>{tooltip.metric.baseline.commit?.slice(0, 7)}</code>
            {tooltip.metric.baseline.timestamp === null ? "" : ` · ${new Date(tooltip.metric.baseline.timestamp * 1000).toLocaleDateString()}`}</> : "No Git baseline"}<br />
            {tooltip.metric.commitsCovered ?? 0} commits{tooltip.metric.includesWorkingTree ? " + working edits" : ""}</p>
          {tooltip.comparison ? <HelpOnly><small>Size bar: {Math.round(tooltip.comparison.ratio * 100)}% of largest visible {tooltip.metric.kind === "file" ? "file" : "folder"}</small></HelpOnly> : null}
        </> : null}
        <HelpOnly><small>{componentAction(tooltip.component, childrenByParent.get(tooltip.component.id)?.length ?? 0)}</small></HelpOnly>
      </div>, document.body) : null}
    </div>
  );
});
