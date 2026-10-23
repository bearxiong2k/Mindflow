import { QC_PRESETS, type DocumentationQc } from "../documentationQc";
import { projectMapMetrics } from "../projectMapMetrics";
import "../structureMetrics.css";
import { HelpOnly } from "./InterfaceHelp";
import { projectMapFor } from "../projectMapNavigation.ts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type AnimationEvent,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";

import { normalizeCanvasTextScale } from "../canvasTextScale";
import {
  canvasViewportWindow,
  type CanvasPoint,
  type CanvasSize,
  type CanvasViewportTransform,
} from "../canvasViewport";
import {
  buildProjectMapMermaidGraph,
  reverseProjectMapDirection,
  type ProjectMapMermaidGraph,
} from "../projectMapMermaid";
import { projectMapMinimapImageSource } from "../projectMapMinimap";
import {
  createProjectMapLayerNavigationGate,
  DEFAULT_PROJECT_MAP_LAYER_ORIGIN,
  projectMapLayerGeometry,
  projectMapLayerOrigin,
  projectMapLayerSnapshotFrame,
  projectMapLayerTransitionMilliseconds,
  type ProjectMapLayerFrame,
  type ProjectMapLayerGeometry,
  type ProjectMapLayerOrigin,
  type ProjectMapLayerTransitionPhase,
} from "../projectMapLayerTransition";
import {
  deriveProjectMapFocusProjection,
  projectMapChildrenByParent,
  projectMapComponentActivation,
  projectMapComponentIsAggregate,
  projectMapMaximumDepth,
  projectMapViewingDepth,
  projectMapViewingDepthsWith,
} from "../projectMapNavigation";
import { readerNavigationMode } from "../readerNavigation";
import type { StructureNavigationPreferences } from "../presentationPreferences";
import type { ProjectMapNavigationRequest } from "../projectFilesNavigation";
import type {
  GraphData,
  Opening,
  ProjectComponent,
  ProjectMapDirection,
} from "../types";
import {
  DirectionSwapIcon,
  DocumentIcon,
  FolderIcon,
  MinusIcon,
  PlusIcon,
  ServerIcon,
} from "./Icons";
import { CanvasZoomControls } from "./CanvasZoomControls";
import {
  ProjectMapMermaidCanvas,
  type ProjectMapActivationModifiers,
  type ProjectMapRenderedGraph,
} from "./ProjectMapMermaidCanvas";
import {
  useCanvasViewport,
  type CanvasViewportSnapshot,
} from "./useCanvasViewport";
import { WorkspaceBanner } from "./WorkspaceBanner";

interface ProjectMapViewProps {
  metricsEnabled: boolean;
  metricsCommits: number;
  metricsReport?: DocumentationQc;
  metricsError?: string;
  metricsLoading: boolean;
  onToggleMetrics: () => void;
  onMetricsCommitsChange: (commits: number) => void;
  onRetryMetrics: () => void;
  graph: GraphData;
  opening: Opening;
  selectedPath: string;
  structureNavigation: StructureNavigationPreferences;
  navigationRequest?: ProjectMapNavigationRequest;
  hoveredComponentId?: string;
  onHoverComponent?: (componentId?: string, expandedRegion?: boolean) => void;
  toolbarHost?: HTMLElement | null;
  onStructureNavigationChange: (
    navigation: StructureNavigationPreferences,
  ) => void;
  onSelect: (path: string, mode?: "same-reader" | "new-reader") => void;
  onOpenExternalPath: (path: string) => void;
}

const DEFAULT_PROJECT_MAP_CONTENT_SIZE: CanvasSize = {
  width: 960,
  height: 540,
};

const PROJECT_MAP_MINIMUM_ZOOM = 0.08;
const PROJECT_MAP_LAYER_TRANSITION_FALLBACK_MS = 180;
const PROJECT_MAP_CANVAS_INTERACTION_SELECTOR =
  "[data-project-component-id], [data-project-map-connection], [data-canvas-overlay]";
const EMPTY_PROJECT_MAP_MATCHING_IDS = new Set<string>();
interface ProjectMapLayerSnapshot {
  metricsKey: string;
  frame: ProjectMapLayerFrame;
  markup: string;
  renderedGraph: ProjectMapRenderedGraph;
  transform?: CanvasViewportTransform;
}

interface ProjectMapLayerEntry {
  geometry?: ProjectMapLayerGeometry;
  origin: ProjectMapLayerOrigin;
  parentSelectedId: string;
  parentFocusId: string;
  snapshot?: ProjectMapLayerSnapshot;
}

interface ProjectMapLayerAnimation {
  geometry?: ProjectMapLayerGeometry;
  navigationRevision?: number;
  origin: ProjectMapLayerOrigin;
  phase: ProjectMapLayerTransitionPhase;
}

interface ProjectMapPreparedLayerSnapshot {
  markup: string;
  projectionKey: string;
  renderedGraph: ProjectMapRenderedGraph;
  selectedId: string;
}

function projectMapLayerAnimationStyle(
  animation: ProjectMapLayerAnimation | undefined,
) {
  if (!animation) return undefined;
  const geometry =
    animation.geometry ?? projectMapLayerGeometry(animation.origin);
  return {
    "--project-map-layer-scale-x": geometry.scaleX,
    "--project-map-layer-scale-y": geometry.scaleY,
    "--project-map-layer-translate-x": `${geometry.translateX * 100}%`,
    "--project-map-layer-translate-y": `${geometry.translateY * 100}%`,
    "--project-map-layer-duration": `${projectMapLayerTransitionMilliseconds(
      animation.phase,
    )}ms`,
  } as CSSProperties;
}

function projectMapLayerFrameStyle(frame: ProjectMapLayerFrame) {
  return {
    width: frame.width,
    height: frame.height,
    transform: frame.transform,
  } as CSSProperties;
}

function projectMapDirectionLabel(direction: ProjectMapDirection) {
  switch (direction) {
    case "lr":
      return "left to right";
    case "rl":
      return "right to left";
    case "bt":
      return "bottom to top";
    case "tb":
    case "td":
      return "top to bottom";
  }
}

function markStructureTiming(revision: number, phase: string) {
  performance.mark(`mindflow:structure:${revision}:${phase}`);
}

function measureStructureTiming(
  revision: number,
  name: string,
  start: string,
  end: string,
) {
  try {
    const measure = performance.measure(
      `mindflow:structure:${name}`,
      `mindflow:structure:${revision}:${start}`,
      `mindflow:structure:${revision}:${end}`,
    );
    if (import.meta.env.DEV) {
      console.debug(
        `[mindflow-performance] ${measure.name} ${measure.duration.toFixed(1)}ms`,
      );
    }
  } catch {
    // A cancelled navigation may remove or supersede one of the marks.
  }
}

function scheduleProjectMapSnapshotPreparation(callback: () => void) {
  const idleWindow = window as Window & {
    requestIdleCallback?: (
      callback: () => void,
      options?: { timeout: number },
    ) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 500 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(callback, 120);
  return () => window.clearTimeout(handle);
}

let projectMapLayerSnapshotSequence = 0;

function projectMapLayerSnapshotMarkup(content: HTMLElement) {
  const clone = content.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll(
      ".is-project-map-component-hovered, .is-project-map-connection-hovered, .is-project-map-connection-neighbor, .is-project-map-connection-related",
    )
    .forEach((element) =>
      element.classList.remove(
        "is-project-map-component-hovered",
        "is-project-map-connection-hovered",
        "is-project-map-connection-neighbor",
        "is-project-map-connection-related",
      ),
    );
  projectMapLayerSnapshotSequence += 1;
  const prefix = `mindflow-project-map-snapshot-${projectMapLayerSnapshotSequence}`;
  const renamedIds = new Map<string, string>();
  for (const element of clone.querySelectorAll<HTMLElement | SVGElement>(
    "[id]",
  )) {
    const id = element.id;
    if (!id) continue;
    const renamed = `${prefix}-${id}`;
    renamedIds.set(id, renamed);
    element.id = renamed;
  }
  const renamedIdEntries = Array.from(renamedIds).sort(
    ([left], [right]) => right.length - left.length,
  );
  for (const style of clone.querySelectorAll("style")) {
    let css = style.textContent ?? "";
    for (const [id, renamed] of renamedIdEntries) {
      css = css.replaceAll(`#${id}`, `#${renamed}`);
    }
    style.textContent = css;
  }
  for (const element of clone.querySelectorAll<HTMLElement | SVGElement>("*")) {
    for (const attribute of Array.from(element.attributes)) {
      let value = attribute.value.replace(
        /url\(#([^)]+)\)/g,
        (match, id: string) =>
          renamedIds.has(id) ? `url(#${renamedIds.get(id)})` : match,
      );
      if (value.startsWith("#")) {
        const renamed = renamedIds.get(value.slice(1));
        if (renamed) value = `#${renamed}`;
      }
      if (
        attribute.name === "aria-labelledby" ||
        attribute.name === "aria-describedby"
      ) {
        value = value
          .split(/\s+/)
          .map((id) => renamedIds.get(id) ?? id)
          .join(" ");
      }
      if (value !== attribute.value) element.setAttribute(attribute.name, value);
    }
  }
  return clone.innerHTML;
}

interface ProjectMapMinimapDrag {
  pointerId: number;
  startPoint: CanvasPoint;
  startCenter: CanvasPoint;
}

interface ProjectMapMinimapProps {
  svg: string;
  contentSize: CanvasSize;
  getViewportSnapshot: () => CanvasViewportSnapshot;
  centerAtContentRatio: (point: CanvasPoint) => void;
  onIndicatorRef: (element: HTMLButtonElement | null) => void;
}

function ProjectMapMinimap({
  svg,
  contentSize,
  getViewportSnapshot,
  centerAtContentRatio,
  onIndicatorRef,
}: ProjectMapMinimapProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<ProjectMapMinimapDrag | undefined>(undefined);
  const imageSource = useMemo(
    () => projectMapMinimapImageSource(svg),
    [svg],
  );

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const surface = surfaceRef.current;
    if (!frame || !surface) return;
    const layoutSurface = () => {
      const availableWidth = Math.max(1, frame.clientWidth);
      const availableHeight = Math.max(1, frame.clientHeight);
      const contentAspect =
        Math.max(1, contentSize.width) / Math.max(1, contentSize.height);
      const availableAspect = availableWidth / availableHeight;
      const width =
        contentAspect >= availableAspect
          ? availableWidth
          : availableHeight * contentAspect;
      const height =
        contentAspect >= availableAspect
          ? availableWidth / contentAspect
          : availableHeight;
      surface.style.width = `${width}px`;
      surface.style.height = `${height}px`;
    };
    layoutSurface();
    const observer = new ResizeObserver(layoutSurface);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [contentSize.height, contentSize.width]);

  const surfacePoint = useCallback((clientX: number, clientY: number) => {
    const surface = surfaceRef.current;
    if (!surface) return undefined;
    const bounds = surface.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return undefined;
    return {
      x: (clientX - bounds.left) / bounds.width,
      y: (clientY - bounds.top) / bounds.height,
    };
  }, []);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (!event.isPrimary || event.button !== 0) return;
      const point = surfacePoint(event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      const snapshot = getViewportSnapshot();
      const visible = canvasViewportWindow(
        snapshot.transform,
        snapshot.viewport,
        snapshot.content,
        PROJECT_MAP_MINIMUM_ZOOM,
      );
      dragRef.current = {
        pointerId: event.pointerId,
        startPoint: point,
        startCenter: {
          x: visible.x + visible.width / 2,
          y: visible.y + visible.height / 2,
        },
      };
      event.currentTarget.classList.add("is-dragging");
    },
    [getViewportSnapshot, surfacePoint],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const point = surfacePoint(event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      event.stopPropagation();
      centerAtContentRatio({
        x: drag.startCenter.x + point.x - drag.startPoint.x,
        y: drag.startCenter.y + point.y - drag.startPoint.y,
      });
    },
    [centerAtContentRatio, surfacePoint],
  );

  const finishPointerDrag = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = undefined;
      event.preventDefault();
      event.stopPropagation();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      event.currentTarget.classList.remove("is-dragging");
    },
    [],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      const step = event.shiftKey ? 0.12 : 0.035;
      const delta =
        event.key === "ArrowLeft"
          ? { x: -step, y: 0 }
          : event.key === "ArrowRight"
            ? { x: step, y: 0 }
            : event.key === "ArrowUp"
              ? { x: 0, y: -step }
              : event.key === "ArrowDown"
                ? { x: 0, y: step }
                : undefined;
      if (!delta) return;
      event.preventDefault();
      event.stopPropagation();
      const snapshot = getViewportSnapshot();
      const visible = canvasViewportWindow(
        snapshot.transform,
        snapshot.viewport,
        snapshot.content,
        PROJECT_MAP_MINIMUM_ZOOM,
      );
      centerAtContentRatio({
        x: visible.x + visible.width / 2 + delta.x,
        y: visible.y + visible.height / 2 + delta.y,
      });
    },
    [centerAtContentRatio, getViewportSnapshot],
  );

  return (
    <div
      className="project-map-minimap"
      ref={frameRef}
      data-canvas-overlay
      role="group"
      aria-label="Structure minimap"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="project-map-minimap__surface" ref={surfaceRef}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0 ||
              (event.target instanceof Element && event.target.closest("button"))) return;
          const point = surfacePoint(event.clientX, event.clientY);
          if (!point) return;
          event.preventDefault();
          event.stopPropagation();
          centerAtContentRatio(point);
          event.currentTarget.querySelector("button")?.focus({ preventScroll: true });
        }}>
        <img src={imageSource} alt="" draggable={false} />
        <button
          type="button"
          ref={onIndicatorRef}
          className="project-map-minimap__viewport"
          aria-label="Visible map region. Drag or use arrow keys to move the Structure canvas."
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
          title="Drag the visible region to move the canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointerDrag}
          onPointerCancel={finishPointerDrag}
          onKeyDown={handleKeyDown}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        />
      </div>
    </div>
  );
}

export function ProjectMapView({
  metricsEnabled,
  metricsCommits,
  metricsReport,
  metricsError,
  metricsLoading,
  onToggleMetrics,
  onMetricsCommitsChange,
  onRetryMetrics,
  graph,
  opening,
  selectedPath,
  structureNavigation,
  navigationRequest,
  hoveredComponentId,
  onHoverComponent,
  toolbarHost,
  onStructureNavigationChange,
  onSelect,
  onOpenExternalPath,
}: ProjectMapViewProps) {
  const map = projectMapFor(graph);
  const metrics = useMemo(() => projectMapMetrics(map.components, metricsEnabled ? metricsReport : undefined),
    [map.components, metricsEnabled, metricsReport]);
  const metricsKey = metricsEnabled ? `${metricsCommits}:${metrics?.key ?? "pending"}` : "off";
  const componentById = useMemo(
    () => new Map(map.components.map((component) => [component.id, component])),
    [map.components],
  );
  const childrenByParent = useMemo(
    () => projectMapChildrenByParent(map.components),
    [map.components],
  );
  const root = componentById.get(map.root) ?? map.components[0];
  const relationshipTypes = useMemo(
    () => new Set(map.relationships.map((relationship) => relationship.type)),
    [map.relationships],
  );
  const initialSelectedId =
    map.components.find(
      (component) =>
        component.binding?.kind === "path" &&
        component.binding.value === selectedPath,
    )?.id ?? structureNavigation.focusId;
  const [focusId, setFocusId] = useState(structureNavigation.focusId);
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [viewingDepthsByFocusId, setViewingDepthsByFocusId] = useState(
    () => new Map(structureNavigation.depthsByFocusId),
  );
  const [reversedLayoutFocusIds, setReversedLayoutFocusIds] = useState(
    () => new Set(structureNavigation.reversedLayoutFocusIds),
  );
  const [zoom, setZoom] = useState(0.82);
  const [textScale, setTextScale] = useState(1);
  const [renderedGraph, setRenderedGraph] =
    useState<ProjectMapRenderedGraph>();
  const [renderStatus, setRenderStatus] = useState<"loading" | "rendered" | "error">("loading");
  const [intentPreloadGraph, setIntentPreloadGraph] =
    useState<ProjectMapMermaidGraph>();
  const [layerEntries, setLayerEntries] = useState(
    () => new Map<string, ProjectMapLayerEntry>(),
  );
  const [layerAnimation, setLayerAnimation] =
    useState<ProjectMapLayerAnimation>();
  const stageRef = useRef<HTMLDivElement>(null);
  const layerTransitionTimerRef = useRef<number | undefined>(undefined);
  const layerTransitionCompletionRef = useRef<(() => void) | undefined>(
    undefined,
  );
  const preparedLayerSnapshotRef =
    useRef<ProjectMapPreparedLayerSnapshot | undefined>(undefined);
  const preparedLayerSnapshotRevisionRef = useRef(0);
  const [layerNavigationGate] = useState(
    createProjectMapLayerNavigationGate,
  );
  const automaticFitFrameRef = useRef<number | undefined>(undefined);
  const viewportTransformRef = useRef<CanvasViewportTransform | undefined>(
    undefined,
  );
  const skipAutomaticFitFocusIdRef = useRef<string | undefined>(undefined);
  const pendingViewportRestoreRef = useRef<
    | {
        focusId: string;
        transform: CanvasViewportTransform;
      }
    | undefined
  >(undefined);
  const initializedProjectionKeyRef = useRef<string | undefined>(undefined);
  const previousSelectedPathRef = useRef(selectedPath);
  const receivedNavigationRequestRef = useRef<ProjectMapNavigationRequest | undefined>(undefined);
  const minimapIndicatorRef = useRef<HTMLButtonElement | null>(null);
  const minimapSnapshotRef = useRef<CanvasViewportSnapshot | undefined>(
    undefined,
  );
  const cancelPendingLayerNavigation = useCallback(() => {
    layerNavigationGate.cancel();
  }, [layerNavigationGate]);

  useEffect(() => {
    onStructureNavigationChange({
      focusId,
      depthsByFocusId: new Map(viewingDepthsByFocusId),
      reversedLayoutFocusIds: new Set(reversedLayoutFocusIds),
    });
  }, [
    focusId,
    onStructureNavigationChange,
    reversedLayoutFocusIds,
    viewingDepthsByFocusId,
  ]);

  const maximumDepth = useMemo(
    () => projectMapMaximumDepth(focusId, childrenByParent),
    [childrenByParent, focusId],
  );
  const visibleDepth = projectMapViewingDepth(
    focusId,
    maximumDepth,
    viewingDepthsByFocusId,
  );
  const projection = useMemo(
    () =>
      deriveProjectMapFocusProjection(
        map,
        focusId,
        relationshipTypes,
        true,
        opening,
        visibleDepth,
      ),
    [focusId, map, opening, relationshipTypes, visibleDepth],
  );
  const baseLayoutDirection: ProjectMapDirection =
    projection.focus.parent === undefined ? projection.direction : "td";
  const layoutDirectionReversed = reversedLayoutFocusIds.has(
    projection.focus.id,
  );
  const layoutDirection = layoutDirectionReversed
    ? reverseProjectMapDirection(baseLayoutDirection)
    : baseLayoutDirection;
  const mermaidGraph = useMemo(
    () =>
      buildProjectMapMermaidGraph(
        projection,
        layoutDirection,
        textScale,
        metrics,
      ),
    [layoutDirection, projection, textScale, metrics],
  );
  const prepareComponentGraph = useCallback(
    (component: ProjectComponent, expandedRegionDepth?: number) => {
      if (
        component.id === focusId ||
        !projectMapComponentIsAggregate(component) ||
        (childrenByParent.get(component.id)?.length ?? 0) === 0
      ) {
        return;
      }
      const maximumDepth = projectMapMaximumDepth(
        component.id,
        childrenByParent,
      );
      const depth =
        expandedRegionDepth ??
        projectMapViewingDepth(
          component.id,
          maximumDepth,
          viewingDepthsByFocusId,
        );
      const preparedProjection = deriveProjectMapFocusProjection(
        map,
        component.id,
        relationshipTypes,
        true,
        opening,
        depth,
      );
      const baseDirection: ProjectMapDirection =
        preparedProjection.focus.parent === undefined
          ? preparedProjection.direction
          : "td";
      const direction = reversedLayoutFocusIds.has(component.id)
        ? reverseProjectMapDirection(baseDirection)
        : baseDirection;
      const preparedGraph = buildProjectMapMermaidGraph(
        preparedProjection,
        direction,
        textScale,
        metrics,
      );
      setIntentPreloadGraph((current) =>
        current?.source === preparedGraph.source ? current : preparedGraph,
      );
    },
    [
      childrenByParent,
      focusId,
      map,
      opening,
      relationshipTypes,
      reversedLayoutFocusIds,
      textScale,
      viewingDepthsByFocusId,
      metrics,
    ],
  );
  const currentRenderedGraph =
    renderedGraph?.source === mermaidGraph.source &&
    renderedGraph.textScale === textScale
      ? renderedGraph
      : undefined;
  const projectionKey = `${projection.focus.id}\u0000${projection.depth}\u0000${layoutDirection}\u0000${metricsKey}`;
  const contentSize =
    currentRenderedGraph?.size ?? DEFAULT_PROJECT_MAP_CONTENT_SIZE;
  const handleRenderedGraphChange = useCallback(
    (next: ProjectMapRenderedGraph) => {
      setRenderedGraph((current) =>
        current?.source === next.source &&
        current.textScale === next.textScale &&
        current.svg === next.svg
          ? current
          : next,
      );
    },
    [],
  );
  const changeTextScale = useCallback(
    (nextTextScale: number) => {
      cancelPendingLayerNavigation();
      setTextScale(normalizeCanvasTextScale(nextTextScale));
    },
    [cancelPendingLayerNavigation],
  );
  const updateMinimapViewport = useCallback(
    (snapshot: CanvasViewportSnapshot) => {
      minimapSnapshotRef.current = snapshot;
      const indicator = minimapIndicatorRef.current;
      if (!indicator) return;
      const visible = canvasViewportWindow(
        snapshot.transform,
        snapshot.viewport,
        snapshot.content,
        PROJECT_MAP_MINIMUM_ZOOM,
      );
      indicator.style.cssText = [
        `--project-map-minimap-x:${visible.x * 100}%`,
        `--project-map-minimap-y:${visible.y * 100}%`,
        `--project-map-minimap-width:${visible.width * 100}%`,
        `--project-map-minimap-height:${visible.height * 100}%`,
      ].join(";");
      indicator.dataset.viewportX = visible.x.toFixed(4);
      indicator.dataset.viewportY = visible.y.toFixed(4);
      indicator.dataset.viewportWidth = visible.width.toFixed(4);
      indicator.dataset.viewportHeight = visible.height.toFixed(4);
    },
    [],
  );
  const setMinimapIndicator = useCallback(
    (element: HTMLButtonElement | null) => {
      minimapIndicatorRef.current = element;
      if (element && minimapSnapshotRef.current) {
        updateMinimapViewport(minimapSnapshotRef.current);
      }
    },
    [updateMinimapViewport],
  );
  const handleViewportTransformChange = useCallback(
    (snapshot: CanvasViewportSnapshot) => {
      cancelPendingLayerNavigation();
      updateMinimapViewport(snapshot);
    },
    [cancelPendingLayerNavigation, updateMinimapViewport],
  );
  const {
    viewportRef,
    contentRef,
    viewportHandlers,
    zoomIn,
    zoomOut,
    fit,
    restore,
    centerAtContentRatio,
    getViewportSnapshot,
  } = useCanvasViewport({
    zoom,
    onZoomCommit: setZoom,
    contentSize,
    minimumZoom: PROJECT_MAP_MINIMUM_ZOOM,
    transformStateRef: viewportTransformRef,
    onTransformChange: handleViewportTransformChange,
  });

  const clearLayerTransitionTimer = useCallback(() => {
    if (layerTransitionTimerRef.current !== undefined) {
      window.clearTimeout(layerTransitionTimerRef.current);
      layerTransitionTimerRef.current = undefined;
    }
    layerTransitionCompletionRef.current = undefined;
  }, []);

  const handleRenderStatusChange = useCallback((status: "loading" | "rendered" | "error") => {
    setRenderStatus(status);
    if (status !== "error") return;
    cancelPendingLayerNavigation();
    clearLayerTransitionTimer();
    // A failed destination must become visible and release navigation controls.
    setLayerAnimation(undefined);
  }, [cancelPendingLayerNavigation, clearLayerTransitionTimer]);

  useLayoutEffect(() => {
    cancelPendingLayerNavigation();
    clearLayerTransitionTimer();
    pendingViewportRestoreRef.current = undefined;
    skipAutomaticFitFocusIdRef.current = undefined;
    preparedLayerSnapshotRevisionRef.current += 1;
    preparedLayerSnapshotRef.current = undefined;
    setIntentPreloadGraph(undefined);
    setLayerAnimation(undefined);
    setLayerEntries((current) => new Map([...current].map(([id, entry]) =>
      [id, { ...entry, snapshot: undefined, geometry: undefined }])));
  }, [metricsKey, cancelPendingLayerNavigation, clearLayerTransitionTimer]);

  const completeLayerTransition = useCallback(() => {
    const completion = layerTransitionCompletionRef.current;
    if (!completion) return;
    layerTransitionCompletionRef.current = undefined;
    if (layerTransitionTimerRef.current !== undefined) {
      window.clearTimeout(layerTransitionTimerRef.current);
      layerTransitionTimerRef.current = undefined;
    }
    completion();
  }, []);

  const armLayerTransition = useCallback(
    (completion: () => void, duration: number) => {
      clearLayerTransitionTimer();
      if (duration === 0) {
        completion();
        return;
      }
      layerTransitionCompletionRef.current = completion;
      layerTransitionTimerRef.current = window.setTimeout(
        completeLayerTransition,
        duration + PROJECT_MAP_LAYER_TRANSITION_FALLBACK_MS,
      );
    },
    [clearLayerTransitionTimer, completeLayerTransition],
  );

  const transitionDuration = useCallback(
    (phase: ProjectMapLayerTransitionPhase) => {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : projectMapLayerTransitionMilliseconds(phase);
    },
    [],
  );

  useEffect(() => {
    preparedLayerSnapshotRevisionRef.current += 1;
    const revision = preparedLayerSnapshotRevisionRef.current;
    preparedLayerSnapshotRef.current = undefined;
    if (!currentRenderedGraph || layerAnimation) return;
    return scheduleProjectMapSnapshotPreparation(() => {
      const content = contentRef.current;
      if (
        revision !== preparedLayerSnapshotRevisionRef.current ||
        !content
      ) {
        return;
      }
      const markup = projectMapLayerSnapshotMarkup(content);
      if (revision !== preparedLayerSnapshotRevisionRef.current) return;
      preparedLayerSnapshotRef.current = {
        markup,
        projectionKey,
        renderedGraph: currentRenderedGraph,
        selectedId,
      };
      performance.mark("mindflow:structure:snapshot-prepared");
    });
  }, [contentRef, currentRenderedGraph, layerAnimation, projectionKey, selectedId]);

  const captureCurrentLayer = useCallback(
    (): ProjectMapLayerSnapshot | undefined => {
      const stage = stageRef.current;
      const content = contentRef.current;
      if (!stage || !content || !currentRenderedGraph) return undefined;
      const prepared = preparedLayerSnapshotRef.current;
      const markup =
        prepared?.projectionKey === projectionKey &&
        prepared.renderedGraph.source === currentRenderedGraph.source &&
        prepared.renderedGraph.svg === currentRenderedGraph.svg &&
        prepared.renderedGraph.textScale === currentRenderedGraph.textScale &&
        prepared.selectedId === selectedId
          ? prepared.markup
          : projectMapLayerSnapshotMarkup(content);
      return {
        metricsKey,
        markup,
        renderedGraph: currentRenderedGraph,
        transform: viewportTransformRef.current,
        frame: projectMapLayerSnapshotFrame(
          {
            height: content.style.height,
            transform: content.style.transform,
            width: content.style.width,
          },
          { height: content.offsetHeight, width: content.offsetWidth },
        ),
      };
    },
    [contentRef, currentRenderedGraph, projectionKey, selectedId, metricsKey],
  );

  useEffect(
    () => () => {
      cancelPendingLayerNavigation();
      clearLayerTransitionTimer();
    },
    [cancelPendingLayerNavigation, clearLayerTransitionTimer],
  );

  useEffect(() => {
    if (
      !currentRenderedGraph ||
      initializedProjectionKeyRef.current === projectionKey
    ) {
      return;
    }
    initializedProjectionKeyRef.current = projectionKey;
    if (skipAutomaticFitFocusIdRef.current === projection.focus.id) {
      skipAutomaticFitFocusIdRef.current = undefined;
      return;
    }
    automaticFitFrameRef.current = window.requestAnimationFrame(() => {
      automaticFitFrameRef.current = undefined;
      fit();
    });
    return () => {
      if (automaticFitFrameRef.current === undefined) return;
      window.cancelAnimationFrame(automaticFitFrameRef.current);
      automaticFitFrameRef.current = undefined;
    };
  }, [currentRenderedGraph, fit, projection.focus.id, projectionKey]);

  useLayoutEffect(() => {
    const pending = pendingViewportRestoreRef.current;
    if (
      !currentRenderedGraph ||
      !pending ||
      pending.focusId !== projection.focus.id
    ) {
      return;
    }
    pendingViewportRestoreRef.current = undefined;
    restore(pending.transform);
  }, [currentRenderedGraph, projection.focus.id, restore]);

  useLayoutEffect(() => {
    if (
      layerAnimation?.phase !== "preparing" ||
      layerAnimation.geometry ||
      !currentRenderedGraph
    ) {
      return;
    }
    initializedProjectionKeyRef.current = projectionKey;
    fit();
    if (layerAnimation.navigationRevision !== undefined) {
      markStructureTiming(
        layerAnimation.navigationRevision,
        "destination-layout-ready",
      );
    }
    const geometry = projectMapLayerGeometry(layerAnimation.origin);
    setLayerEntries((current) => {
      const entry = current.get(projection.focus.id);
      if (!entry) return current;
      const next = new Map(current);
      next.set(projection.focus.id, { ...entry, geometry });
      return next;
    });
    setLayerAnimation((current) =>
      current?.phase === "preparing" ? { ...current, geometry } : current,
    );
  }, [
    currentRenderedGraph,
    fit,
    layerAnimation?.geometry,
    layerAnimation?.navigationRevision,
    layerAnimation?.origin,
    layerAnimation?.phase,
    projection.focus.id,
    projectionKey,
  ]);

  useLayoutEffect(() => {
    if (
      layerAnimation?.phase !== "preparing" ||
      !layerAnimation.geometry
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      if (layerAnimation.navigationRevision !== undefined) {
        markStructureTiming(layerAnimation.navigationRevision, "animation-start");
        measureStructureTiming(
          layerAnimation.navigationRevision,
          "activation-to-animation",
          "activation",
          "animation-start",
        );
      }
      setLayerAnimation((current) =>
        current?.phase === "preparing"
          ? { ...current, phase: "entering" }
          : current,
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    layerAnimation?.geometry,
    layerAnimation?.navigationRevision,
    layerAnimation?.phase,
  ]);

  useEffect(() => {
    if (layerAnimation?.phase !== "entering") return;
    armLayerTransition(
      () => {
        const revision = layerAnimation.navigationRevision;
        if (revision !== undefined) {
          markStructureTiming(revision, "animation-complete");
          measureStructureTiming(
            revision,
            "activation-to-settled",
            "activation",
            "animation-complete",
          );
        }
        setLayerAnimation(undefined);
      },
      transitionDuration("entering"),
    );
  }, [
    armLayerTransition,
    layerAnimation?.navigationRevision,
    layerAnimation?.phase,
    transitionDuration,
  ]);

  const changeProjectionDepth = useCallback(
    (nextDepth: number) => {
      const boundedDepth = Math.max(1, Math.min(maximumDepth, nextDepth));
      if (boundedDepth === visibleDepth) return;
      cancelPendingLayerNavigation();
      clearLayerTransitionTimer();
      pendingViewportRestoreRef.current = undefined;
      skipAutomaticFitFocusIdRef.current = undefined;
      setLayerAnimation(undefined);
      setViewingDepthsByFocusId((current) =>
        projectMapViewingDepthsWith(
          current,
          projection.focus.id,
          boundedDepth,
          maximumDepth,
        ),
      );
    },
    [
      cancelPendingLayerNavigation,
      clearLayerTransitionTimer,
      maximumDepth,
      projection.focus.id,
      visibleDepth,
    ],
  );

  const toggleLayoutDirection = useCallback(() => {
    if (layerAnimation) return;
    cancelPendingLayerNavigation();
    pendingViewportRestoreRef.current = undefined;
    skipAutomaticFitFocusIdRef.current = undefined;
    setReversedLayoutFocusIds((current) => {
      const next = new Set(current);
      if (next.has(projection.focus.id)) next.delete(projection.focus.id);
      else next.add(projection.focus.id);
      return next;
    });
  }, [cancelPendingLayerNavigation, layerAnimation, projection.focus.id]);

  useEffect(() => {
    cancelPendingLayerNavigation();
    clearLayerTransitionTimer();
    pendingViewportRestoreRef.current = undefined;
    skipAutomaticFitFocusIdRef.current = undefined;
    setLayerAnimation(undefined);
    setLayerEntries(new Map());
    setFocusId((current) => {
      const component = componentById.get(current);
      return component && projectMapComponentIsAggregate(component)
        ? current
        : map.root;
    });
    setSelectedId((current) =>
      componentById.has(current) ? current : map.root,
    );
    setViewingDepthsByFocusId((current) => {
      const next = new Map<string, number>();
      for (const [candidateFocusId, candidateDepth] of current) {
        const component = componentById.get(candidateFocusId);
        if (!component || !projectMapComponentIsAggregate(component)) continue;
        const boundedDepth = Math.max(
          1,
          Math.min(
            projectMapMaximumDepth(candidateFocusId, childrenByParent),
            Math.round(candidateDepth),
          ),
        );
        if (boundedDepth > 1) next.set(candidateFocusId, boundedDepth);
      }
      return next;
    });
    setReversedLayoutFocusIds((current) =>
      new Set(
        [...current].filter((candidateFocusId) => {
          const component = componentById.get(candidateFocusId);
          return Boolean(
            component && projectMapComponentIsAggregate(component),
          );
        }),
      ),
    );
  }, [
    cancelPendingLayerNavigation,
    childrenByParent,
    clearLayerTransitionTimer,
    componentById,
    map.root,
  ]);

  useEffect(() => {
    const previousPath = previousSelectedPathRef.current;
    previousSelectedPathRef.current = selectedPath;
    if (previousPath === selectedPath) return;
    const selectedComponent = map.components.find(
      (component) =>
        component.binding?.kind === "path" &&
        component.binding.value === selectedPath,
    );
    if (!selectedComponent) return;
    setSelectedId(selectedComponent.id);
  }, [map.components, selectedPath]);

  const selectComponent = useCallback(
    (id: string) => {
      cancelPendingLayerNavigation();
      setSelectedId(id);
    },
    [cancelPendingLayerNavigation],
  );

  // Files can select a sibling or a distant folder while a canvas transition
  // is still running. Cancel that transition and use the authored parent chain;
  // the previously viewed folder must never become a synthetic parent.
  useEffect(() => {
    if (!navigationRequest || receivedNavigationRequestRef.current === navigationRequest) return;
    receivedNavigationRequestRef.current = navigationRequest;
    const component = componentById.get(navigationRequest.focusId);
    if (!component || !projectMapComponentIsAggregate(component)) return;
    cancelPendingLayerNavigation();
    clearLayerTransitionTimer();
    pendingViewportRestoreRef.current = undefined;
    skipAutomaticFitFocusIdRef.current = undefined;
    setLayerAnimation(undefined);
    setLayerEntries(new Map());
    setFocusId(component.id);
    setSelectedId(component.id);
  }, [navigationRequest, componentById, cancelPendingLayerNavigation, clearLayerTransitionTimer]);

  useEffect(() => {
    onHoverComponent?.(undefined);
  }, [focusId, onHoverComponent]);

  const visibleHoverId = useMemo(() => {
    const visible = new Set([
      projection.focus.id,
      ...[...mermaidGraph.nodeByKey.values()].map((component) => component.id),
      ...[...mermaidGraph.layerByKey.values()].map((component) => component.id),
    ]);
    const visited = new Set<string>();
    let id = hoveredComponentId;
    while (id && !visited.has(id)) {
      if (visible.has(id)) return id;
      visited.add(id);
      id = componentById.get(id)?.parent;
    }
    return undefined;
  }, [componentById, hoveredComponentId, mermaidGraph, projection.focus.id]);

  const enterFocus = useCallback(
    (
      id: string,
      origin?: ProjectMapActivationModifiers["origin"],
      expandedRegionDepth?: number,
    ) => {
      const component = componentById.get(id);
      if (
        layerAnimation ||
        !component ||
        !projectMapComponentIsAggregate(component) ||
        (childrenByParent.get(id)?.length ?? 0) === 0
      ) {
        if (component) selectComponent(id);
        return;
      }
      if (id === focusId) {
        selectComponent(id);
        return;
      }

      const stage = stageRef.current;
      const layerOrigin = stage
        ? projectMapLayerOrigin(origin, stage.getBoundingClientRect())
        : DEFAULT_PROJECT_MAP_LAYER_ORIGIN;
      const navigationRevision = layerNavigationGate.begin();
      markStructureTiming(navigationRevision, "activation");
      const parentSelectedId = selectedId;
      const snapshot = captureCurrentLayer();
      markStructureTiming(navigationRevision, "snapshot-ready");
      measureStructureTiming(
        navigationRevision,
        "activation-to-snapshot",
        "activation",
        "snapshot-ready",
      );
      const commitNavigation = () => {
        if (expandedRegionDepth !== undefined) {
          setViewingDepthsByFocusId((current) =>
            projectMapViewingDepthsWith(
              current,
              id,
              expandedRegionDepth,
              projectMapMaximumDepth(id, childrenByParent),
            ),
          );
        }
        setLayerEntries((current) => {
          const next = new Map(current);
          next.set(id, {
            parentFocusId: focusId,
            parentSelectedId,
            origin: layerOrigin,
            snapshot,
          });
          return next;
        });

        clearLayerTransitionTimer();
        pendingViewportRestoreRef.current = undefined;
        setFocusId(id);
        setSelectedId(id);
        setLayerAnimation({
          phase: "preparing",
          navigationRevision,
          origin: layerOrigin,
        });
      };

      void layerNavigationGate.commitWhenReady(
        navigationRevision,
        Promise.resolve(),
        commitNavigation,
      );
    },
    [
      captureCurrentLayer,
      childrenByParent,
      clearLayerTransitionTimer,
      componentById,
      focusId,
      layerAnimation,
      layerNavigationGate,
      selectComponent,
      selectedId,
    ],
  );

  const activateComponent = useCallback(
    (
      component: ProjectComponent,
      modifiers: ProjectMapActivationModifiers,
    ) => {
      const activation = projectMapComponentActivation(
        component,
        childrenByParent.get(component.id)?.length ?? 0,
      );
      switch (activation.kind) {
        case "hierarchy":
          enterFocus(
            activation.componentId,
            modifiers.origin,
            modifiers.expandedRegionDepth,
          );
          return;
        case "reader":
          cancelPendingLayerNavigation();
          setSelectedId(component.id);
          onSelect(activation.path, readerNavigationMode(modifiers));
          return;
        case "external-path":
          cancelPendingLayerNavigation();
          setSelectedId(component.id);
          onOpenExternalPath(activation.path);
          return;
        case "selection":
          cancelPendingLayerNavigation();
          setSelectedId(component.id);
          return;
      }
    },
    [
      cancelPendingLayerNavigation,
      childrenByParent,
      enterFocus,
      onOpenExternalPath,
      onSelect,
    ],
  );

  const storedLayerEntry = layerEntries.get(projection.focus.id);
  const parentFocusId =
    storedLayerEntry?.parentFocusId ?? projection.focus.parent;
  const parentFocus = parentFocusId
    ? componentById.get(parentFocusId)
    : undefined;
  const currentLayerEntry =
    parentFocus && storedLayerEntry?.parentFocusId === parentFocus.id
      ? storedLayerEntry.snapshot && storedLayerEntry.snapshot.metricsKey !== metricsKey
        ? { ...storedLayerEntry, snapshot: undefined, geometry: undefined }
        : storedLayerEntry
      : undefined;
  // Animation phases change only the wrapper's geometry. Replacing this SVG
  // would reparse and restyle the supposedly frozen parent on every phase.
  const backdropMarkup = useMemo(
    () => ({ __html: currentLayerEntry?.snapshot?.markup ?? "" }),
    [currentLayerEntry?.snapshot?.markup],
  );
  const bannerFocus =
    layerAnimation && parentFocus ? parentFocus : projection.focus;
  const bannerMaximumDepth = projectMapMaximumDepth(
    bannerFocus.id,
    childrenByParent,
  );
  const bannerVisibleDepth = projectMapViewingDepth(
    bannerFocus.id,
    bannerMaximumDepth,
    viewingDepthsByFocusId,
  );
  const bannerProjection = useMemo(
    () =>
      bannerFocus.id === projection.focus.id
        ? projection
        : deriveProjectMapFocusProjection(
            map,
            bannerFocus.id,
            relationshipTypes,
            true,
            opening,
            bannerVisibleDepth,
          ),
    [
      bannerFocus.id,
      bannerVisibleDepth,
      map,
      opening,
      projection,
      relationshipTypes,
    ],
  );
  const bannerBaseLayoutDirection: ProjectMapDirection =
    bannerProjection.focus.parent === undefined ? bannerProjection.direction : "td";
  const bannerLayoutDirectionReversed = reversedLayoutFocusIds.has(
    bannerProjection.focus.id,
  );
  const bannerLayoutDirection = bannerLayoutDirectionReversed
    ? reverseProjectMapDirection(bannerBaseLayoutDirection)
    : bannerBaseLayoutDirection;
  const returnToParent = useCallback(() => {
    if (!parentFocus || layerAnimation) return;
    cancelPendingLayerNavigation();
    const returningFocusId = projection.focus.id;
    const finishReturn = () => {
      clearLayerTransitionTimer();
      if (currentLayerEntry?.snapshot?.transform) {
        skipAutomaticFitFocusIdRef.current = parentFocus.id;
        pendingViewportRestoreRef.current = {
          focusId: parentFocus.id,
          transform: currentLayerEntry.snapshot.transform,
        };
      } else {
        skipAutomaticFitFocusIdRef.current = undefined;
        pendingViewportRestoreRef.current = undefined;
      }
      if (currentLayerEntry?.snapshot?.renderedGraph) {
        setRenderedGraph(currentLayerEntry.snapshot.renderedGraph);
      }
      setLayerEntries((current) => {
        const next = new Map(current);
        next.delete(returningFocusId);
        return next;
      });
      setFocusId(parentFocus.id);
      setSelectedId(currentLayerEntry?.parentSelectedId ?? returningFocusId);
      setLayerAnimation(undefined);
    };
    const duration = transitionDuration("closing");
    if (duration === 0) {
      finishReturn();
      return;
    }
    clearLayerTransitionTimer();
    setLayerAnimation({
      geometry: currentLayerEntry?.geometry,
      phase: "closing",
      origin: currentLayerEntry?.origin ?? DEFAULT_PROJECT_MAP_LAYER_ORIGIN,
    });
    armLayerTransition(finishReturn, duration);
  }, [
    armLayerTransition,
    cancelPendingLayerNavigation,
    clearLayerTransitionTimer,
    currentLayerEntry,
    layerAnimation,
    parentFocus,
    projection.focus.id,
    transitionDuration,
  ]);

  const handleLayerAnimationEnd = useCallback(
    (event: AnimationEvent<HTMLDivElement>) => {
      if (
        event.target !== event.currentTarget ||
        (event.animationName !== "project-map-layer-zoom" &&
          event.animationName !== "project-map-layer-zoom-out")
      ) {
        return;
      }
      completeLayerTransition();
    },
    [completeLayerTransition],
  );

  const handleViewportKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (
        parentFocus &&
        (event.key === "Escape" || event.key === "Backspace")
      ) {
        event.preventDefault();
        event.stopPropagation();
        returnToParent();
        return;
      }
      viewportHandlers.onKeyDown(event);
    },
    [parentFocus, returnToParent, viewportHandlers],
  );

  const handleStageClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!parentFocus || layerAnimation) return;
      if (
        event.target instanceof Element &&
        event.target.closest(PROJECT_MAP_CANVAS_INTERACTION_SELECTOR)
      ) {
        return;
      }
      returnToParent();
    },
    [layerAnimation, parentFocus, returnToParent],
  );

  const layerAnimationClass = layerAnimation
    ? ` is-${layerAnimation.phase}`
    : "";
  const layerAnimationStyle = projectMapLayerAnimationStyle(layerAnimation);
  if (!root) return null;

  const focusMetric = metrics?.byComponentId.get(bannerProjection.focus.id);
  const baseline = metricsReport?.points.find((point) => point.kind === "commit");
  const metricCommitsCovered = metricsReport?.points.filter((point) => point.kind === "commit").length ?? 0;
  const structureToolbar = (
    <div
      className="project-map-layer-tools"
      data-project-map-toolbar
      data-focus-id={bannerProjection.focus.id}
      role="group"
      aria-label={`${bannerProjection.focus.label} Structure view controls`}
    >
      <button type="button" className={`project-map-layer-tool structure-metrics-toggle${metricsEnabled ? " is-active" : ""}`}
        aria-label="Show document volume and growth" aria-pressed={metricsEnabled}
        title="Document volume and growth"
        disabled={Boolean(layerAnimation)} onClick={onToggleMetrics}>Volume</button>
      <div
        className="project-map-depth-control"
        role="group"
        aria-label={`Visible Structure depth ${bannerVisibleDepth} of ${bannerMaximumDepth} for ${bannerProjection.focus.label}`}
      >
        <span>Depth</span>
        <button
          type="button"
          aria-label="Show fewer Structure levels"
          title="Decrease visible depth"
          disabled={Boolean(layerAnimation) || bannerVisibleDepth <= 1}
          onClick={() => changeProjectionDepth(bannerVisibleDepth - 1)}
        >
          <MinusIcon />
        </button>
        <output aria-live="polite">{bannerVisibleDepth}</output>
        <button
          type="button"
          aria-label="Show more Structure levels"
          title="Increase visible depth"
          disabled={
            Boolean(layerAnimation) ||
            bannerVisibleDepth >= bannerMaximumDepth
          }
          onClick={() => changeProjectionDepth(bannerVisibleDepth + 1)}
        >
          <PlusIcon />
        </button>
      </div>
      <button
        className={`project-map-layer-tool project-map-direction-tool${
          bannerLayoutDirectionReversed ? " is-active" : ""
        }`}
        type="button"
        aria-label={`Reverse graph layout direction; currently ${projectMapDirectionLabel(
          bannerLayoutDirection,
        )}`}
        aria-pressed={bannerLayoutDirectionReversed}
        title={`Graph layout is ${projectMapDirectionLabel(
          bannerLayoutDirection,
        )}; preserve arrows and reverse the layout`}
        disabled={Boolean(layerAnimation)}
        onClick={toggleLayoutDirection}
      >
        <DirectionSwapIcon />
        <span>Reverse</span>
      </button>
    </div>
  );

  return (
    <div className="project-map-view">
      <section className={`project-map-canvas${metricsEnabled ? " has-structure-metrics" : ""}`} aria-label="Progressive Project Map">
        <WorkspaceBanner
          ariaLabel={`${bannerProjection.focus.label} Structure controls`}
          className="project-map-banner"
        >
          <div
            className={`project-map-banner__identity${visibleHoverId === bannerProjection.focus.id ? " is-linked-hover" : ""}`}
            data-project-map-layer-title
            data-focus-id={bannerProjection.focus.id}
            onPointerEnter={() => onHoverComponent?.(bannerProjection.focus.id)}
            onPointerLeave={() => onHoverComponent?.(undefined)}
          >
            <span>Structure</span>
            <h3>{bannerProjection.focus.label}</h3>
          </div>
          <div
            className="project-map-node-legend"
            role="group"
            aria-label="Structure node types"
          >
            <span title="Directory: opens another Structure layer">
              <FolderIcon />
              Directory
            </span>
            <span title="File: opens in Reader">
              <DocumentIcon />
              File
            </span>
            <span title="External target: opens outside Structure">
              <ServerIcon />
              External
            </span>
          </div>
        </WorkspaceBanner>
        {toolbarHost ? createPortal(structureToolbar, toolbarHost) : null}
        {metricsEnabled ? <div className="structure-metrics-bar" data-canvas-overlay>
          <label>Growth window<select aria-label="Structure growth window" value={metricsCommits}
            onChange={(event) => onMetricsCommitsChange(Number(event.target.value))}>
            {QC_PRESETS.map((count) => <option key={count} value={count}>Last {count} commits</option>)}
          </select></label>
          <div className="structure-metrics-status" aria-live="polite">
            {metricsLoading ? <span role="status">Measuring documentation…</span> : metricsError ?
              <span role="alert">{metricsError} <button onClick={onRetryMetrics}>Retry</button></span> : metricsReport ? <>
                {focusMetric ? <span className="structure-metrics-total">
                  <strong>{focusMetric.volumeLabel}</strong><span>{focusMetric.growthLabel}</span>
                </span> : <span>No measured documents</span>}
                <HelpOnly>
                  <small>Registered documents · {baseline ? `${metricCommitsCovered} commits + working edits` : "No Git baseline"}</small>
                  <small>Trends: per-node scale · Bars: relative size</small>
                </HelpOnly>
                {metricsReport.shallow_history ? <small role="status">Shallow Git history</small> : null}
              </> : null}
          </div>
          {metricsReport ? <div className="structure-metrics-key" aria-label="Document trend colors and directions">
            <span data-trend="growth">↗ Growth</span>
            <span data-trend="shrink">↘ Reduction</span>
            <span data-trend="flat">→ Unchanged</span>
          </div> : null}
        </div> : null}
        <div
          className="project-map-canvas__stage"
          ref={stageRef}
          data-focus-id={projection.focus.id}
          data-layout-direction={layoutDirection}
          data-projection-depth={projection.depth}
          onClick={handleStageClick}
        >
          {parentFocus ? (
            <div
              className={`project-map-focus-backdrop${layerAnimationClass}`}
              data-parent-focus-id={parentFocus.id}
              style={layerAnimationStyle}
              aria-hidden="true"
            >
              {currentLayerEntry?.snapshot ? (
                <div
                  className="project-map-focus-backdrop__surface project-map-canvas__content"
                  style={projectMapLayerFrameStyle(
                    currentLayerEntry.snapshot.frame,
                  )}
                  dangerouslySetInnerHTML={backdropMarkup}
                />
              ) : null}
            </div>
          ) : null}
          <div
            className={`project-map-focus-layer${
              parentFocus ? "" : " is-root"
            }${layerAnimationClass}`}
            data-layer-phase={layerAnimation?.phase ?? "settled"}
            style={layerAnimationStyle}
            onAnimationEnd={handleLayerAnimationEnd}
          >
            <div
              className="project-map-canvas__viewport"
              ref={viewportRef}
              role="region"
              aria-label={`${projection.focus.label} Structure canvas at depth ${projection.depth}. Two-finger scroll moves the graph and pinch zooms it.${
                parentFocus
                  ? " Click blank canvas space, Escape, or Backspace to return to the former canvas."
                  : ""
              }`}
              aria-keyshortcuts={`ArrowUp ArrowDown ArrowLeft ArrowRight + - 0${
                parentFocus ? " Escape Backspace" : ""
              }`}
              aria-busy={!currentRenderedGraph && renderStatus !== "error"}
              tabIndex={0}
              {...viewportHandlers}
              onKeyDown={handleViewportKeyDown}
            >
              <div
                className="project-map-canvas__content canvas-viewport__content"
                ref={contentRef}
                style={{ width: contentSize.width, height: contentSize.height }}
              >
                <ProjectMapMermaidCanvas
                  graph={mermaidGraph}
                  matchingIds={EMPTY_PROJECT_MAP_MATCHING_IDS}
                  selectedId={selectedId}
                  hoveredComponentId={visibleHoverId}
                  onHoverComponent={onHoverComponent}
                  textScale={textScale}
                  childrenByParent={childrenByParent}
                  onActivate={activateComponent}
                  preloadGraph={intentPreloadGraph}
                  onPrepare={prepareComponentGraph}
                  onRenderedGraphChange={handleRenderedGraphChange}
                  onRenderStatusChange={handleRenderStatusChange}
                />
              </div>
              {currentRenderedGraph ? (
                <ProjectMapMinimap
                  svg={currentRenderedGraph.svg}
                  contentSize={contentSize}
                  getViewportSnapshot={getViewportSnapshot}
                  centerAtContentRatio={centerAtContentRatio}
                  onIndicatorRef={setMinimapIndicator}
                />
              ) : null}
              <CanvasZoomControls
                label="Structure canvas zoom"
                textScale={textScale}
                onZoomIn={zoomIn}
                onZoomOut={zoomOut}
                onFit={fit}
                onTextScaleChange={changeTextScale}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
