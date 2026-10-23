export type TimelineIntentActivationSurface = "timeline" | "file-entry";

export type TimelinePanelBoundary = "timeline-information";

export interface TimelinePanelLayout {
  inspectorHeight?: number;
}

export interface TimelinePanelSizes {
  ordinaryHeight: number;
  inspectorHeight: number;
}

export const MINIMUM_TIMELINE_ORDINARY_HEIGHT = 180;
export const MINIMUM_TIMELINE_INSPECTOR_HEIGHT = 72;
export const TIMELINE_PANEL_DRAG_THRESHOLD = 2;
export const TIMELINE_REORDER_DURATION_MS = 160;
export const TIMELINE_RETIREMENT_MOVE_DURATION_MS = 280;
export const TIMELINE_RETIREMENT_HOLD_DURATION_MS = 180;
export const TIMELINE_RETIREMENT_FADE_DURATION_MS = 420;
export const TIMELINE_RETIREMENT_TOTAL_DURATION_MS =
  TIMELINE_RETIREMENT_MOVE_DURATION_MS +
  TIMELINE_RETIREMENT_HOLD_DURATION_MS +
  TIMELINE_RETIREMENT_FADE_DURATION_MS;

export function timelineReorderProgress(elapsedMs: number): number {
  if (Number.isNaN(elapsedMs) || elapsedMs <= 0) return 0;
  if (!Number.isFinite(elapsedMs) || elapsedMs >= TIMELINE_REORDER_DURATION_MS) {
    return 1;
  }
  const linearProgress = elapsedMs / TIMELINE_REORDER_DURATION_MS;
  return 1 - Math.pow(1 - linearProgress, 3);
}

export function timelineReorderValue(
  start: number,
  target: number,
  elapsedMs: number,
): number {
  if (!Number.isFinite(start) || !Number.isFinite(target)) return target;
  return start + (target - start) * timelineReorderProgress(elapsedMs);
}

export type TimelineRetirementMotionPhase =
  | "moving"
  | "holding"
  | "fading"
  | "settled";

export function timelineRetirementMotionPhase(
  elapsedMs: number,
): TimelineRetirementMotionPhase {
  if (Number.isNaN(elapsedMs) || elapsedMs <= 0) return "moving";
  if (elapsedMs < TIMELINE_RETIREMENT_MOVE_DURATION_MS) return "moving";
  if (
    elapsedMs <
    TIMELINE_RETIREMENT_MOVE_DURATION_MS +
      TIMELINE_RETIREMENT_HOLD_DURATION_MS
  ) {
    return "holding";
  }
  if (
    elapsedMs <
    TIMELINE_RETIREMENT_MOVE_DURATION_MS +
      TIMELINE_RETIREMENT_HOLD_DURATION_MS +
      TIMELINE_RETIREMENT_FADE_DURATION_MS
  ) {
    return "fading";
  }
  return "settled";
}

export function timelineRetirementMotionPhaseAt(
  startedAt: number,
  now: number,
): TimelineRetirementMotionPhase {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return "settled";
  return timelineRetirementMotionPhase(now - startedAt);
}

export interface TimelineCommitTickPosition {
  x: number;
}

export interface TimelineAnchorPosition {
  x: number;
  kind: "event-boundary" | "commit";
}

export function timelineAnchorPosition(
  eventBoundaryX: number | undefined,
  commit: string,
  commits: readonly { commit: string }[],
  commitPositions: readonly TimelineCommitTickPosition[],
): TimelineAnchorPosition | undefined {
  if (eventBoundaryX !== undefined && Number.isFinite(eventBoundaryX)) {
    return { x: eventBoundaryX, kind: "event-boundary" };
  }
  const index = commits.findIndex((entry) => entry.commit === commit);
  const position = commitPositions[index];
  return position && Number.isFinite(position.x)
    ? { x: position.x, kind: "commit" }
    : undefined;
}

export interface TimelineEventBoundaryStop {
  x: number;
  eventBoundary: number;
}

export function timelineFocusedEventBoundary(
  stops: readonly TimelineEventBoundaryStop[],
  focusX: number,
): number {
  if (!Number.isFinite(focusX)) return 0;
  let eventBoundary = 0;
  for (const stop of stops) {
    if (!Number.isFinite(stop.x) || stop.x > focusX) break;
    if (Number.isFinite(stop.eventBoundary)) {
      eventBoundary = Math.max(0, Math.trunc(stop.eventBoundary));
    }
  }
  return eventBoundary;
}

export function timelineLeadingScrollInset(
  viewportWidth: number,
  originX: number,
): number {
  const width = Number.isFinite(viewportWidth)
    ? Math.max(0, viewportWidth)
    : 0;
  const origin = Number.isFinite(originX) ? Math.max(0, originX) : 0;
  return Math.max(0, width - origin);
}

export function timelineFocusedEventBoundaryAtCanvasOrigin(
  stops: readonly TimelineEventBoundaryStop[],
  scrollLeft: number,
  viewportWidth: number,
  originX: number,
): number {
  const left = Number.isFinite(scrollLeft) ? Math.max(0, scrollLeft) : 0;
  const width = Number.isFinite(viewportWidth)
    ? Math.max(0, viewportWidth)
    : 0;
  const origin = Number.isFinite(originX) ? Math.max(0, originX) : 0;
  return timelineFocusedEventBoundary(stops, left + Math.min(width, origin));
}

export function timelineScrollLeftForLeadingInset(
  scrollLeft: number,
  leadingInset: number,
  initialized: boolean,
): number {
  const left = Number.isFinite(scrollLeft) ? Math.max(0, scrollLeft) : 0;
  if (initialized) return left;
  return Number.isFinite(leadingInset) ? Math.max(0, leadingInset) : 0;
}

export function timelineCommitTickPositions(
  eventBoundaries: readonly (number | null | undefined)[],
  eventBoundaryXs: readonly (number | undefined)[],
  startX: number,
  endX: number,
): TimelineCommitTickPosition[] {
  const total = eventBoundaries.length;
  if (total === 0) return [];
  const start = Number.isFinite(startX) ? startX : 0;
  const end = Number.isFinite(endX) ? Math.max(start, endX) : start;
  const round = (value: number) => Math.round(value * 10) / 10;
  if (total === 1) {
    const boundary = eventBoundaries[0];
    const boundaryX =
      boundary !== null && boundary !== undefined
        ? eventBoundaryXs[boundary]
        : undefined;
    return [{ x: round(boundaryX ?? end) }];
  }

  const anchors: Array<{ index: number; x: number }> = [];
  let lastAnchorX = Number.NEGATIVE_INFINITY;
  eventBoundaries.forEach((boundary, index) => {
    if (boundary === null || boundary === undefined) return;
    const x = eventBoundaryXs[boundary];
    if (x === undefined || !Number.isFinite(x) || x <= lastAnchorX) return;
    anchors.push({ index, x: Math.min(end, Math.max(start, x)) });
    lastAnchorX = x;
  });

  if (anchors.length === 0) {
    const step = (end - start) / (total - 1);
    return Array.from({ length: total }, (_, index) => ({
      x: round(start + step * index),
    }));
  }

  const positions = Array.from({ length: total }, () => ({ x: start }));
  const first = anchors[0];
  for (let index = 0; index < first.index; index += 1) {
    const progress = (index + 1) / (first.index + 1);
    positions[index].x = start + (first.x - start) * progress;
  }
  positions[first.index].x = first.x;

  for (let anchorIndex = 1; anchorIndex < anchors.length; anchorIndex += 1) {
    const previous = anchors[anchorIndex - 1];
    const current = anchors[anchorIndex];
    const span = current.index - previous.index;
    for (let index = previous.index + 1; index <= current.index; index += 1) {
      const progress = (index - previous.index) / span;
      positions[index].x = previous.x + (current.x - previous.x) * progress;
    }
  }

  const last = anchors[anchors.length - 1];
  const trailing = total - 1 - last.index;
  for (let index = last.index + 1; index < total; index += 1) {
    const progress = (index - last.index) / trailing;
    positions[index].x = last.x + (end - last.x) * progress;
  }

  return positions.map(({ x }) => ({ x: round(x) }));
}

export function centeredTimelineScrollLeft(
  targetX: number,
  viewportWidth: number,
  scrollWidth: number,
): number {
  if (
    !Number.isFinite(targetX) ||
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(scrollWidth)
  ) {
    return 0;
  }
  const usableViewportWidth = Math.max(0, viewportWidth);
  const maximumScrollLeft = Math.max(0, scrollWidth - usableViewportWidth);
  return Math.min(
    maximumScrollLeft,
    Math.max(0, targetX - usableViewportWidth / 2),
  );
}

function roundedPanelSize(value: number): number {
  return Math.round(value * 10) / 10;
}

export function timelinePanelClientToLocalScale(
  localLength: number,
  renderedLength: number,
  interfaceScale?: number,
): number {
  if (
    typeof interfaceScale === "number" &&
    Number.isFinite(interfaceScale) &&
    interfaceScale > 0
  ) {
    return 1 / interfaceScale;
  }
  if (
    !Number.isFinite(localLength) ||
    !Number.isFinite(renderedLength) ||
    localLength <= 0 ||
    renderedLength <= 0
  ) {
    return 1;
  }
  return localLength / renderedLength;
}

export function timelinePanelLocalLength(
  renderedLength: number,
  clientToLocalScale: number,
): number {
  if (!Number.isFinite(renderedLength)) return 0;
  const scale =
    Number.isFinite(clientToLocalScale) && clientToLocalScale > 0
      ? clientToLocalScale
      : 1;
  return renderedLength * scale;
}

export function timelinePanelDragMovement(
  startClientY: number,
  clientY: number,
  clientToLocalScale: number,
  engaged: boolean,
): number | undefined {
  const renderedMovement = clientY - startClientY;
  if (!Number.isFinite(renderedMovement)) return undefined;
  if (
    !engaged &&
    Math.abs(renderedMovement) < TIMELINE_PANEL_DRAG_THRESHOLD
  ) {
    return undefined;
  }
  return timelinePanelLocalLength(renderedMovement, clientToLocalScale);
}

export function resizeTimelinePanels(
  current: TimelinePanelSizes,
  _boundary: TimelinePanelBoundary,
  movement: number,
): TimelinePanelSizes {
  if (!Number.isFinite(movement)) return current;

  const minimumMovement =
    MINIMUM_TIMELINE_INSPECTOR_HEIGHT - current.inspectorHeight;
  const maximumMovement =
    current.ordinaryHeight - MINIMUM_TIMELINE_ORDINARY_HEIGHT;
  if (minimumMovement > maximumMovement) return current;
  const boundedMovement = Math.min(
    maximumMovement,
    Math.max(minimumMovement, movement),
  );
  return {
    ordinaryHeight: roundedPanelSize(
      current.ordinaryHeight - boundedMovement,
    ),
    inspectorHeight: roundedPanelSize(
      current.inspectorHeight + boundedMovement,
    ),
  };
}

export function timelineIntentOpensReader(
  surface: TimelineIntentActivationSurface,
  managed: boolean,
): boolean {
  return surface === "file-entry" && managed;
}
