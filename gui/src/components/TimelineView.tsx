import { timelineIdentitiesForPaths } from "../types.ts";
import { HelpOnly } from "./InterfaceHelp";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  buildTimelinePresentationFromTopology,
  buildTimelinePresentationTopology,
  createTimelineSelectionResolver,
  timelineCanvasHeight,
  timelineCanvasWidth,
  timelineEventLogEntries,
  timelineEventMarkerLabel,
  timelineFoldRangeKey,
  timelineFocusedIntentSpans,
  timelineFocusedRetirements,
  timelineIntentSpanAtBoundary,
  timelineRetirementsCrossed,
  timelineLaneHitRegion,
  resizeTimelineEntryRail,
  TIMELINE_COLUMN_WIDTH,
  TIMELINE_ENTRY_RAIL_DEFAULT_WIDTH,
  TIMELINE_HORIZONTAL_PADDING,
  TIMELINE_JUNCTION_GAP,
  TIMELINE_LANE_GAP,
  TIMELINE_TOP_PADDING,
  type TimelineCrossedRetirement,
  type TimelineEventMarker,
  type TimelineFoldRange,
  type TimelineIntentConnector,
  type TimelineIntentSpan,
  type TimelinePresentation,
  type TimelineSelectionTarget,
  type TimelineSelectionTrace,
} from "../openingPresentation";
import { relationshipStyle } from "../graph";
import {
  readerNavigationMode,
  type ReaderDocumentActivation,
  type ReaderNavigationMode,
} from "../readerNavigation";
import {
  centeredTimelineScrollLeft,
  resizeTimelinePanels,
  timelineAnchorPosition,
  timelineCommitTickPositions,
  timelineFocusedEventBoundaryAtCanvasOrigin,
  timelineLeadingScrollInset,
  timelineScrollLeftForLeadingInset,
  timelinePanelClientToLocalScale,
  timelinePanelDragMovement,
  timelinePanelLocalLength,
  timelineIntentOpensReader,
  timelineReorderValue,
  timelineRetirementMotionPhaseAt,
  TIMELINE_REORDER_DURATION_MS,
  TIMELINE_RETIREMENT_FADE_DURATION_MS,
  TIMELINE_RETIREMENT_HOLD_DURATION_MS,
  TIMELINE_RETIREMENT_MOVE_DURATION_MS,
  TIMELINE_RETIREMENT_TOTAL_DURATION_MS,
  type TimelineAnchorPosition,
  type TimelineCommitTickPosition,
  type TimelineIntentActivationSurface,
  type TimelinePanelBoundary,
  type TimelinePanelLayout,
  type TimelinePanelSizes,
} from "../timelineInteraction";
import {
  buildTimelineSelectionOverlay,
  timelineSelectionTargetKey,
} from "../timelineSelectionOverlay";
import type {
  AnchorDefinition,
  AnchorTimelineSlice,
  GraphData,
  TimelineCommit,
} from "../types";
import { WorkspaceBanner } from "./WorkspaceBanner";
import { CloseIcon } from "./Icons";

interface TimelineViewProps {
  graph: GraphData;
  anchorTimeline: AnchorTimelineSlice[];
  commits: TimelineCommit[];
  panelLayout: TimelinePanelLayout;
  foldRanges: TimelineFoldRange[];
  foldSelection: {
    active: boolean;
    firstEndpoint?: TimelineFoldRange;
  };
  selectedFoldRange?: TimelineFoldRange;
  protectedEventBoundaries: number[];
  foldNotice?: string;
  onPanelLayoutChange: (layout: TimelinePanelLayout) => void;
  onFoldEndpoint: (endpoint: TimelineFoldRange) => void;
  onSelectedFoldRangeChange: (range: TimelineFoldRange | undefined) => void;
  onSelect: ReaderDocumentActivation;
  onClose: () => void;
}

interface TimelineAnchorEntry {
  name: string;
  definition: AnchorDefinition;
  slice?: AnchorTimelineSlice;
}

function timelineAnchorEntryKey(name: string) {
  return `timeline-anchor-entry:${name}`;
}

function timelineDimensions(columnCount: number, laneCount: number) {
  return {
    width: timelineCanvasWidth(columnCount, 0),
    height: timelineCanvasHeight(laneCount),
  };
}

function timelineXForColumn(column: number) {
  return TIMELINE_HORIZONTAL_PADDING + column * TIMELINE_COLUMN_WIDTH;
}

function timelineYForLane(lane: number) {
  return TIMELINE_TOP_PADDING + lane * TIMELINE_LANE_GAP;
}

interface TimelineRailResizeInteraction {
  pointerId: number;
  captureTarget: HTMLButtonElement;
  startClientX: number;
  startWidth: number;
  availableWidth: number;
}

interface TimelinePanelResizeInteraction {
  pointerId: number;
  captureTarget: HTMLButtonElement;
  boundary: TimelinePanelBoundary;
  startClientY: number;
  clientToLocalY: number;
  startSizes: TimelinePanelSizes;
  latestSizes: TimelinePanelSizes;
  engaged: boolean;
}

const TimelineReorderStartedAtContext = createContext<number | undefined>(
  undefined,
);

function useTimelineReorderAnimation(
  targetValues: readonly number[],
  applyValues: (values: readonly number[]) => void,
  initialValues: readonly number[] = targetValues,
) {
  const coordinatedStartedAt = useContext(TimelineReorderStartedAtContext);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const renderedValuesRef = useRef<number[]>([...initialValues]);
  const targetValuesRef = useRef(targetValues);
  const applyValuesRef = useRef(applyValues);
  targetValuesRef.current = targetValues;
  applyValuesRef.current = applyValues;
  const targetKey = targetValues.join(":");

  useLayoutEffect(() => {
    if (animationFrameRef.current !== undefined) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }

    const target = [...targetValuesRef.current];
    const from = target.map(
      (value, index) => renderedValuesRef.current[index] ?? value,
    );
    const unchanged = target.every(
      (value, index) => Math.abs(value - from[index]) < 0.001,
    );
    if (
      unchanged ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      renderedValuesRef.current = target;
      applyValuesRef.current(target);
      return;
    }

    applyValuesRef.current(from);
    const startedAt = coordinatedStartedAt ?? performance.now();
    const animate = (now: number) => {
      const elapsed = now - startedAt;
      const values = target.map((value, index) =>
        timelineReorderValue(from[index], value, elapsed),
      );
      renderedValuesRef.current = values;
      applyValuesRef.current(values);
      if (elapsed < TIMELINE_REORDER_DURATION_MS) {
        animationFrameRef.current = window.requestAnimationFrame(animate);
      } else {
        animationFrameRef.current = undefined;
      }
    };
    animationFrameRef.current = window.requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current !== undefined) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
    };
  }, [coordinatedStartedAt, targetKey]);
}

type TimelineEntryRetirementPhase = "moving" | "holding" | "fading";

interface TimelineQueuedRetirement extends TimelineCrossedRetirement {
  id: string;
  managed: boolean;
  color: string;
  startedAt: number;
  initialY: number;
  phase: TimelineEntryRetirementPhase;
}

type TimelineRetirementQueueItem = Omit<TimelineQueuedRetirement, "phase">;

interface TimelineRailEntry {
  span: TimelineIntentSpan;
  managed: boolean;
  color: string;
  initialY?: number;
  retirementPhase?: TimelineEntryRetirementPhase;
}

function useTimelineRetirementQueue(
  boundary: number,
  presentation: TimelinePresentation,
  initialYByPath: ReadonlyMap<string, number>,
  currentYByPath: ReadonlyMap<string, number>,
  managedPaths: ReadonlySet<string>,
  colorByPath: ReadonlyMap<string, string>,
): readonly TimelineQueuedRetirement[] {
  const committedBoundaryRef = useRef(boundary);
  const [queue, setQueue] = useState<TimelineRetirementQueueItem[]>([]);
  const [sampledAt, setSampledAt] = useState(() => performance.now());
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useLayoutEffect(() => {
    const previousBoundary = committedBoundaryRef.current;
    committedBoundaryRef.current = boundary;
    if (reducedMotion || boundary <= previousBoundary) return;

    const openPaths = new Set(presentation.focusedSlice?.openPaths ?? []);
    const crossed = timelineRetirementsCrossed(
      presentation,
      previousBoundary,
      boundary,
    ).filter(
      (retirement) => retirement.span && !openPaths.has(retirement.path),
    );
    if (crossed.length === 0) return;

    const startedAt = performance.now();
    setQueue((current) => {
      const stillActive = current.filter(
        (item) =>
          startedAt - item.startedAt < TIMELINE_RETIREMENT_TOTAL_DURATION_MS,
      );
      const queuedPaths = new Set(stillActive.map((item) => item.path));
      const additions = crossed.flatMap<TimelineRetirementQueueItem>(
        (retirement) => {
          const span = retirement.span;
          if (!span || queuedPaths.has(retirement.path)) return [];
          queuedPaths.add(retirement.path);
          return [
            {
              ...retirement,
              id: `${retirement.eventBoundary}:${retirement.path}`,
              managed: managedPaths.has(retirement.path),
              color: colorByPath.get(retirement.path) ?? "currentColor",
              startedAt,
              initialY:
                initialYByPath.get(retirement.path) ??
                currentYByPath.get(retirement.path) ??
                timelineYForLane(span.lane),
            },
          ];
        },
      );
      return additions.length > 0 ? [...stillActive, ...additions] : stillActive;
    });
    setSampledAt(startedAt);
  }, [
    boundary,
    colorByPath,
    currentYByPath,
    initialYByPath,
    managedPaths,
    presentation,
    reducedMotion,
  ]);

  useEffect(() => {
    const now = performance.now();
    if (
      queue.some(
        (item) =>
          now - item.startedAt >= TIMELINE_RETIREMENT_TOTAL_DURATION_MS,
      )
    ) {
      setQueue((current) =>
        current.filter(
          (item) =>
            performance.now() - item.startedAt <
            TIMELINE_RETIREMENT_TOTAL_DURATION_MS,
        ),
      );
      return;
    }
    let nextTransitionAt = Number.POSITIVE_INFINITY;
    for (const item of queue) {
      const movingEndsAt =
        item.startedAt + TIMELINE_RETIREMENT_MOVE_DURATION_MS;
      const holdingEndsAt =
        movingEndsAt + TIMELINE_RETIREMENT_HOLD_DURATION_MS;
      const fadeEndsAt =
        item.startedAt + TIMELINE_RETIREMENT_TOTAL_DURATION_MS;
      for (const transitionAt of [movingEndsAt, holdingEndsAt, fadeEndsAt]) {
        if (transitionAt > now && transitionAt < nextTransitionAt) {
          nextTransitionAt = transitionAt;
        }
      }
    }
    if (!Number.isFinite(nextTransitionAt)) return;
    const timeout = window.setTimeout(
      () => setSampledAt(performance.now()),
      Math.max(0, nextTransitionAt - performance.now()) + 1,
    );
    return () => window.clearTimeout(timeout);
  }, [queue, sampledAt]);

  return queue.flatMap<TimelineQueuedRetirement>((item) => {
    const phase = timelineRetirementMotionPhaseAt(item.startedAt, sampledAt);
    return phase === "settled" ? [] : [{ ...item, phase }];
  });
}

interface TimelinePanelMetrics {
  sizes: TimelinePanelSizes;
  clientToLocalY: number;
}

function releaseTimelinePanelPointerCapture(
  resize: TimelinePanelResizeInteraction | undefined,
) {
  if (!resize) return;
  try {
    if (resize.captureTarget.hasPointerCapture(resize.pointerId)) {
      resize.captureTarget.releasePointerCapture(resize.pointerId);
    }
  } catch {
    // The global drag listeners do not depend on element-level capture.
  }
}

interface TimelineRailResizeControlProps {
  width: number;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onReset: () => void;
}

interface TimelinePanelResizeControlProps {
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onLostPointerCapture: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onReset: () => void;
}

function TimelineRailResizeHandle({
  width,
  onPointerDown,
  onKeyDown,
  onReset,
}: TimelineRailResizeControlProps) {
  return (
    <button
      className="timeline-entry-rail__resize"
      type="button"
      aria-label={`Resize Timeline entry rail, currently ${Math.round(
        width,
      )} pixels`}
      aria-keyshortcuts="ArrowLeft ArrowRight Enter Space"
      title="Drag to resize the Timeline entry rail. Arrow keys resize; Shift and an arrow resizes farther. Enter or Space restores the default width."
      data-timeline-rail-resize="timeline"
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}

function TimelinePanelResizeHandle({
  boundary,
  onPointerDown,
  onLostPointerCapture,
  onKeyDown,
  onReset,
}: TimelinePanelResizeControlProps & {
  boundary: TimelinePanelBoundary;
}) {
  const label = "Resize Timeline and information panels";
  return (
    <button
      className="timeline-panel-resize timeline-panel-resize--information"
      type="button"
      aria-label={label}
      aria-keyshortcuts="ArrowUp ArrowDown Enter Space"
      title={`${label}. Drag vertically; Arrow keys resize, Shift resizes farther, and Enter or Space restores the default panel sizes.`}
      data-timeline-panel-resize={boundary}
      onPointerDown={onPointerDown}
      onLostPointerCapture={onLostPointerCapture}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}

function TimelineEntryBox({
  label,
  meta,
}: {
  label: string;
  meta?: string;
}) {
  return (
    <div className="interface-text-box timeline-entry__box">
      <span className="timeline-entry__label">{label}</span>
      {meta ? <span className="timeline-entry__meta">{meta}</span> : null}
    </div>
  );
}

const TimelineFileEntry = memo(function TimelineFileEntry({
  span,
  label,
  target,
  y,
  initialY,
  retirementPhase,
  active,
  primary,
  anchored,
  pressed,
  managed,
  color,
  onHover,
  onActivate,
}: {
  span: TimelineIntentSpan;
  label?: string;
  target: Extract<TimelineSelectionTarget, { kind: "intent" }>;
  y: number;
  initialY?: number;
  retirementPhase?: TimelineEntryRetirementPhase;
  active: boolean;
  primary: boolean;
  anchored: boolean;
  pressed: boolean;
  managed: boolean;
  color: string;
  onHover: TimelineTargetInteraction;
  onActivate: TimelineIntentInteraction;
}) {
  const path = span.path;
  const entryRef = useRef<HTMLButtonElement>(null);
  useTimelineReorderAnimation(
    [y],
    ([animatedY]) => {
      if (animatedY === undefined || !entryRef.current) return;
      entryRef.current.style.transform = `translateY(calc(${animatedY}px - 50%))`;
    },
    [initialY ?? y],
  );

  return (
    <button
      ref={entryRef}
      className={`timeline-entry timeline-file-entry${
        active ? " is-active" : ""
      }${primary ? " is-primary" : ""}${anchored ? " is-anchor-tied" : ""}${
        managed ? "" : " is-timeline-only"
      }${retirementPhase ? " is-retiring" : ""}${
        retirementPhase === "moving" ? " is-retirement-moving" : ""
      }${
        retirementPhase === "fading" ? " is-retirement-fading" : ""
      }`}
      type="button"
      style={
        {
          top: 0,
          transform: `translateY(calc(${y}px - 50%))`,
          "--timeline-entry-color": color,
        } as CSSProperties
      }
      aria-pressed={pressed}
      aria-label={
        managed
          ? `Focused intent ${path}; activate its current managed file`
          : `Focused historical intent ${path}; current managed prose is unavailable, activate to select its lifeline`
      }
      title={
        managed
          ? path
          : `${path} · Timeline intent only; no current managed file`
      }
      data-timeline-entry="ordinary"
      data-retirement-phase={retirementPhase}
      data-path={path}
      onMouseEnter={() => onHover(target)}
      onMouseLeave={() => onHover(undefined)}
      onFocus={() => onHover(target)}
      onBlur={() => onHover(undefined)}
      onClick={(event) =>
        onActivate(span, "file-entry", readerNavigationMode(event))
      }
    >
      <TimelineEntryBox label={label ?? path} meta={label ? path : undefined} />
    </button>
  );
});

function TimelineAnchorDockRow({
  entry,
  boundary,
  selected,
  mapped,
  onSelect,
  onActivate,
}: {
  entry: TimelineAnchorEntry;
  boundary: string;
  selected: boolean;
  mapped: boolean;
  onSelect: () => void;
  onActivate: (mode: ReaderNavigationMode) => void;
}) {
  const path = entry.definition.file;
  const connectionCount = entry.definition.connections.length;

  return (
    <div
      className={`timeline-anchor-dock__row${
        selected ? " is-selected" : ""
      }${mapped ? "" : " is-unmapped"}`}
      style={
        {
          "--timeline-entry-color": mapped
            ? "var(--color-relationship)"
            : "#a77965",
        } as CSSProperties
      }
      data-anchor={entry.name}
    >
      <button
        className="timeline-anchor-dock__locate"
        type="button"
        aria-pressed={selected}
        aria-label={`Visualize anchor ${entry.name}, ${connectionCount} historical connections, ${boundary}`}
        title={`Locate ${entry.name} in the ordinary Timeline · ${boundary}`}
        onClick={onSelect}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="3" r="1.8" />
          <path d="M8 4.8v7.5M4.1 8.1v1.1a3.9 3.9 0 0 0 7.8 0V8.1M2.8 8.2h2.7M10.5 8.2h2.7" />
        </svg>
      </button>
      <button
        className="timeline-entry timeline-anchor-file-entry timeline-anchor-dock__file"
        type="button"
        aria-label={`Open current anchor file ${path} for ${entry.name}, ${boundary}`}
        title={`${path} · current file for ${entry.name}`}
        data-timeline-entry="anchor"
        data-anchor={entry.name}
        data-path={path}
        onClick={(event) => onActivate(readerNavigationMode(event))}
      >
        <TimelineEntryBox label={path} />
      </button>
    </div>
  );
}

function handleTimelineKey(
  event: KeyboardEvent<SVGGElement>,
  select: () => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  select();
}

function connectorPathAtY(
  connector: TimelineIntentConnector,
  xForColumn: (column: number) => number,
  laneY: number,
  junctionY: number,
) {
  const eventX = xForColumn(connector.column);
  const side = connector.side === "predecessor" ? -1 : 1;
  const outerX = eventX + side * TIMELINE_JUNCTION_GAP;
  const control = TIMELINE_JUNCTION_GAP * 0.58;
  if (connector.side === "predecessor") {
    return `M ${outerX} ${laneY} C ${outerX + control} ${laneY}, ${
      eventX - control
    } ${junctionY}, ${eventX} ${junctionY}`;
  }
  return `M ${eventX} ${junctionY} C ${eventX + control} ${junctionY}, ${
    outerX - control
  } ${laneY}, ${outerX} ${laneY}`;
}

function anchorSliceX(
  eventBoundary: number | null | undefined,
  eventCount: number,
  eventMarkers: TimelineEventMarker[],
  xForColumn: (column: number) => number,
): number | undefined {
  if (
    eventBoundary === null ||
    eventBoundary === undefined ||
    eventBoundary < 0 ||
    eventBoundary > eventCount
  ) {
    return undefined;
  }
  if (eventCount === 0) return xForColumn(0);
  if (eventBoundary === eventCount) return xForColumn(eventMarkers.length);
  if (eventBoundary === 0) return xForColumn(-0.22);

  const precedingMarker = eventMarkers.find(
    (marker) =>
      marker.startEventIndex <= eventBoundary - 1 &&
      marker.endEventIndex >= eventBoundary - 1,
  );
  const followingMarker = eventMarkers.find(
    (marker) => marker.startEventIndex === eventBoundary,
  );
  if (!precedingMarker) return undefined;
  return xForColumn(
    followingMarker
      ? (precedingMarker.column + followingMarker.column) / 2
      : precedingMarker.column,
  );
}

function commitEventBoundaryX(
  eventBoundary: number,
  eventCount: number,
  eventMarkers: TimelineEventMarker[],
  xForColumn: (column: number) => number,
): number | undefined {
  if (eventBoundary < 0 || eventBoundary > eventCount) return undefined;
  if (eventBoundary === 0) return xForColumn(-0.18);
  const marker = eventMarkers.find(
    (candidate) =>
      candidate.startEventIndex <= eventBoundary - 1 &&
      candidate.endEventIndex >= eventBoundary - 1,
  );
  return marker ? xForColumn(marker.column) : undefined;
}

function anchorBoundaryLabel(
  eventBoundary: number | null | undefined,
  eventCount: number,
  position?: TimelineAnchorPosition,
): string {
  if (eventBoundary === null || eventBoundary === undefined) {
    return position?.kind === "commit"
      ? "at its Git commit; Event boundary unknown"
      : "position unavailable in the current Timeline";
  }
  if (eventCount === 0 || eventBoundary === eventCount) {
    return "at the present registered flow";
  }
  if (eventBoundary === 0) return "before E1";
  return `after E${eventBoundary}`;
}

async function copyTimelineText(value: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Fall through to the local selection path for native WebViews that deny
    // the asynchronous Clipboard API.
  }

  const field = document.createElement("textarea");
  field.value = value;
  field.readOnly = true;
  field.style.position = "fixed";
  field.style.opacity = "0";
  field.style.pointerEvents = "none";
  document.body.append(field);
  field.select();
  try {
    if (!document.execCommand("copy")) {
      throw new Error("The native clipboard rejected the copy request.");
    }
  } finally {
    field.remove();
  }
}

interface TimelineSpanRenderItem {
  span: TimelineIntentSpan;
  target: Extract<TimelineSelectionTarget, { kind: "intent" }>;
  hitRegion: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  linePath: string;
  lineStartX: number;
  lineEndX: number;
  y: number;
  color: string;
  open: boolean;
}

interface TimelineConnectorRenderItem {
  connector: TimelineIntentConnector;
  pathData: string;
  laneY: number;
  junctionY: number;
  color: string;
  span?: TimelineIntentSpan;
  target?: Extract<TimelineSelectionTarget, { kind: "intent" }>;
}

interface TimelineEventRenderItem {
  marker: TimelineEventMarker;
  transform: string;
  x: number;
  y: number;
  target: Extract<TimelineSelectionTarget, { kind: "event" }>;
}

interface TimelineRenderData {
  spans: TimelineSpanRenderItem[];
  connectors: TimelineConnectorRenderItem[];
  events: TimelineEventRenderItem[];
  spanRenderById: Map<string, TimelineSpanRenderItem>;
  connectorRenderById: Map<string, TimelineConnectorRenderItem>;
  eventRenderById: Map<string, TimelineEventRenderItem>;
  eventById: Map<string, TimelineEventMarker>;
  spanById: Map<string, TimelineIntentSpan>;
  targetBySpanId: Map<
    string,
    Extract<TimelineSelectionTarget, { kind: "intent" }>
  >;
  colorByPath: Map<string, string>;
  laneByPath: Map<string, number>;
}

type TimelineTargetInteraction = (
  target: TimelineSelectionTarget | undefined,
) => void;

type TimelineSelectableElementRegistrar = (
  key: string,
  element: SVGGElement | null,
) => void;

function setTimelineHoverVisibility(
  element: SVGElement | null,
  visible: boolean,
) {
  if (!element) return;
  if (visible) element.setAttribute("data-timeline-hover-visible", "true");
  else element.removeAttribute("data-timeline-hover-visible");
}

function setTimelineHoverPath(
  element: SVGPathElement | null,
  pathData: string | undefined,
  color: string | undefined,
) {
  if (!element || !pathData || !color) {
    setTimelineHoverVisibility(element, false);
    return;
  }
  element.setAttribute("d", pathData);
  element.style.color = color;
  setTimelineHoverVisibility(element, true);
}

function setTimelineHoverOpenEnd(
  element: SVGCircleElement | null,
  item: TimelineSpanRenderItem | undefined,
) {
  if (!element || !item?.open) {
    setTimelineHoverVisibility(element, false);
    return;
  }
  element.setAttribute("cx", `${item.hitRegion.x + item.hitRegion.width}`);
  element.setAttribute(
    "cy",
    `${item.hitRegion.y + item.hitRegion.height / 2}`,
  );
  element.style.color = item.color;
  setTimelineHoverVisibility(element, true);
}

function setTimelineHoverEvent(
  element: SVGGElement | null,
  item: TimelineEventRenderItem | undefined,
) {
  if (!element || !item) {
    setTimelineHoverVisibility(element, false);
    return;
  }
  element.setAttribute("transform", item.transform);
  const collected = Boolean(item.marker.foldRange) || item.marker.events.length > 1;
  element.classList.toggle("is-folded", Boolean(item.marker.foldRange));
  element
    .querySelector(".timeline-hover-overlay__event-ring")
    ?.setAttribute("r", collected ? "6.5" : "5.5");
  const dot = element.querySelector<SVGCircleElement>(
    ".timeline-hover-overlay__event-dot",
  );
  if (dot) dot.style.display = collected ? "none" : "";
  const count = element.querySelector(".timeline-hover-overlay__event-count");
  if (count) count.textContent = collected ? String(item.marker.events.length) : "";
  const label = element.lastElementChild;
  if (label) label.textContent = timelineEventMarkerLabel(item.marker);
  setTimelineHoverVisibility(element, true);
}

type TimelineIntentInteraction = (
  span: TimelineIntentSpan,
  surface: TimelineIntentActivationSurface,
  mode?: ReaderNavigationMode,
) => void;

const TimelineSpanGlyph = memo(function TimelineSpanGlyph({
  item,
  anchored,
  onElement,
  onActivate,
  onHover,
}: {
  item: TimelineSpanRenderItem;
  anchored: boolean;
  onElement: TimelineSelectableElementRegistrar;
  onActivate: TimelineIntentInteraction;
  onHover: TimelineTargetInteraction;
}) {
  const { span, target } = item;
  const selectionKey = timelineSelectionTargetKey(target) ?? span.id;
  const registerElement = useCallback(
    (element: SVGGElement | null) => onElement(selectionKey, element),
    [onElement, selectionKey],
  );
  const hitRef = useRef<SVGRectElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const openEndRef = useRef<SVGCircleElement>(null);
  useTimelineReorderAnimation([item.y], ([y]) => {
    if (y === undefined) return;
    hitRef.current?.setAttribute(
      "y",
      `${y - item.hitRegion.height / 2}`,
    );
    lineRef.current?.setAttribute(
      "d",
      `M ${item.lineStartX} ${y} L ${item.lineEndX} ${y}`,
    );
    openEndRef.current?.setAttribute("cy", `${y}`);
  });
  return (
    <g
      ref={registerElement}
      className={`timeline-file-segment${
        anchored ? " is-anchor-tied" : ""
      }`}
      style={{ "--file-color": item.color } as CSSProperties}
      role="button"
      tabIndex={0}
      aria-pressed={false}
      aria-label={`Intent lifeline ${span.path}; select its source lineage and later influence`}
      data-timeline-selection-key={selectionKey}
      onClick={() => onActivate(span, "timeline")}
      onFocus={() => onHover(target)}
      onBlur={() => onHover(undefined)}
      onMouseEnter={() => onHover(target)}
      onMouseLeave={() => onHover(undefined)}
      onKeyDown={(event) =>
        handleTimelineKey(event, () => onActivate(span, "timeline"))
      }
    >
      <rect
        ref={hitRef}
        className="timeline-file-segment__hit"
        {...item.hitRegion}
      />
      <path
        ref={lineRef}
        className="timeline-file-segment__line"
        d={item.linePath}
      />
      {item.open ? (
        <circle
          ref={openEndRef}
          className="timeline-file-segment__open-end"
          cx={timelineXForColumn(span.endColumn) - TIMELINE_JUNCTION_GAP}
          cy={timelineYForLane(span.lane)}
          r="4"
        />
      ) : null}
    </g>
  );
});

const TimelineConnectorGlyph = memo(function TimelineConnectorGlyph({
  item,
  anchored,
  onActivate,
  onHover,
}: {
  item: TimelineConnectorRenderItem;
  anchored: boolean;
  onActivate: TimelineIntentInteraction;
  onHover: TimelineTargetInteraction;
}) {
  const { connector } = item;
  const span = item.span;
  const hitRef = useRef<SVGPathElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  useTimelineReorderAnimation(
    [item.laneY, item.junctionY],
    ([laneY, junctionY]) => {
      if (laneY === undefined || junctionY === undefined) return;
      const pathData = connectorPathAtY(
        item.connector,
        timelineXForColumn,
        laneY,
        junctionY,
      );
      hitRef.current?.setAttribute("d", pathData);
      lineRef.current?.setAttribute("d", pathData);
    },
  );
  return (
    <g
      className={`timeline-intent-connector${
        anchored ? " is-anchor-tied" : ""
      }`}
      style={{ "--file-color": item.color } as CSSProperties}
      onClick={
        span
          ? () => onActivate(span, "timeline")
          : undefined
      }
      onMouseEnter={
        item.target ? () => onHover(item.target) : undefined
      }
      onMouseLeave={() => onHover(undefined)}
    >
      <path
        ref={hitRef}
        className="timeline-intent-connector__hit"
        d={item.pathData}
      />
      <path
        ref={lineRef}
        className="timeline-file-segment__line"
        d={item.pathData}
      />
    </g>
  );
});

const TimelineEventGlyph = memo(function TimelineEventGlyph({
  item,
  foldBoundary,
  foldSelecting,
  onElement,
  onSelect,
  onHover,
}: {
  item: TimelineEventRenderItem;
  foldBoundary: boolean;
  foldSelecting: boolean;
  onElement: TimelineSelectableElementRegistrar;
  onSelect: (target: Extract<TimelineSelectionTarget, { kind: "event" }>) => void;
  onHover: TimelineTargetInteraction;
}) {
  const selectEvent = () => onSelect(item.target);
  const selectionKey = timelineSelectionTargetKey(item.target) ?? item.marker.id;
  const folded = Boolean(item.marker.foldRange);
  const grouped = !folded && item.marker.events.length > 1;
  const collected = folded || grouped;
  const markerLabel = timelineEventMarkerLabel(item.marker);
  const markerRef = useRef<SVGGElement>(null);
  const registerElement = useCallback(
    (element: SVGGElement | null) => {
      markerRef.current = element;
      onElement(selectionKey, element);
    },
    [onElement, selectionKey],
  );
  useTimelineReorderAnimation([item.y], ([y]) => {
    if (y === undefined) return;
    markerRef.current?.setAttribute(
      "transform",
      `translate(${item.x} ${y})`,
    );
  });
  return (
    <g
      ref={registerElement}
      className={`timeline-event-marker${grouped ? " is-grouped" : ""}${
        folded ? " is-folded" : ""
      }${foldBoundary ? " is-fold-boundary" : ""}${
        foldSelecting ? " is-fold-selectable" : ""
      }`}
      role="button"
      tabIndex={0}
      aria-pressed={false}
      aria-label={
        folded
          ? `${markerLabel}, folded region containing ${
              item.marker.events.length
            } original events: ${item.marker.events
              .map((event) => event.name)
              .join("; ")}`
          : grouped
          ? `${markerLabel}, ${
              item.marker.events.length
            } events sharing the same ordered predecessor and successor files: ${item.marker.events
              .map((event) => event.name)
              .join("; ")}`
          : `${markerLabel}: ${item.marker.event.name}`
      }
      onClick={selectEvent}
      onFocus={() => onHover(item.target)}
      onBlur={() => onHover(undefined)}
      onMouseEnter={() => onHover(item.target)}
      onMouseLeave={() => onHover(undefined)}
      onKeyDown={(event) => handleTimelineKey(event, selectEvent)}
      transform={item.transform}
      data-timeline-fold-range={
        item.marker.foldRange
          ? timelineFoldRangeKey(item.marker.foldRange)
          : undefined
      }
      data-timeline-selection-key={selectionKey}
    >
      <circle className="timeline-event-marker__hit" r={collected ? 11 : 9} />
      <circle className="timeline-event-marker__ring" r={collected ? 6.5 : 5.5} />
      {collected ? (
        <text
          className="timeline-event-marker__count"
          y="2.1"
          textAnchor="middle"
        >
          {item.marker.events.length}
        </text>
      ) : (
        <circle className="timeline-event-marker__dot" r="2.75" />
      )}
      <text className="timeline-event-marker__label" y="-10" textAnchor="middle">
        {markerLabel}
      </text>
    </g>
  );
});

const TimelineBaseLifelines = memo(function TimelineBaseLifelines({
  renderData,
  anchoredPaths,
  onElement,
  onActivate,
  onHover,
}: {
  renderData: TimelineRenderData;
  anchoredPaths: ReadonlySet<string>;
  onElement: TimelineSelectableElementRegistrar;
  onActivate: TimelineIntentInteraction;
  onHover: TimelineTargetInteraction;
}) {
  return (
    <>
      {renderData.spans.map((item) => (
        <TimelineSpanGlyph
          key={item.span.id}
          item={item}
          anchored={anchoredPaths.has(item.span.path)}
          onElement={onElement}
          onActivate={onActivate}
          onHover={onHover}
        />
      ))}
      {renderData.connectors.map((item) => (
        <TimelineConnectorGlyph
          key={item.connector.id}
          item={item}
          anchored={anchoredPaths.has(item.connector.path)}
          onActivate={onActivate}
          onHover={onHover}
        />
      ))}
    </>
  );
});

const TimelineBaseEvents = memo(function TimelineBaseEvents({
  renderData,
  foldBoundaryKey,
  foldSelecting,
  onElement,
  onSelect,
  onHover,
}: {
  renderData: TimelineRenderData;
  foldBoundaryKey?: string;
  foldSelecting: boolean;
  onElement: TimelineSelectableElementRegistrar;
  onSelect: (target: Extract<TimelineSelectionTarget, { kind: "event" }>) => void;
  onHover: TimelineTargetInteraction;
}) {
  return (
    <>
      {renderData.events.map((item) => (
        <TimelineEventGlyph
          key={item.marker.id}
          item={item}
          foldBoundary={
            foldBoundaryKey === timelineFoldRangeKey(item.marker)
          }
          foldSelecting={foldSelecting}
          onElement={onElement}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}
    </>
  );
});

const TimelineSelectionOverlayGlyph = memo(
  function TimelineSelectionOverlayGlyph({
    renderData,
    trace,
    target,
  }: {
    renderData: TimelineRenderData;
    trace: TimelineSelectionTrace;
    target: TimelineSelectionTarget | undefined;
  }) {
    const overlay = useMemo(
      () => buildTimelineSelectionOverlay(renderData, trace, target),
      [renderData, target, trace],
    );
    const targetKey = timelineSelectionTargetKey(target);
    if (!targetKey) return null;

    return (
      <g
        className="timeline-selection-overlay"
        aria-hidden="true"
        data-timeline-selection-target={targetKey}
        data-active-spans={overlay.activeSpanCount}
        data-active-connectors={overlay.activeConnectorCount}
        data-active-events={overlay.activeEventCount}
        data-draw-paths={
          overlay.spanPaths.length + overlay.connectorPaths.length
        }
      >
        {overlay.spanPaths.map((path) => (
          <path
            key={`span:${path.color}`}
            className="timeline-selection-overlay__span"
            d={path.pathData}
            style={{ color: path.color }}
            data-members={path.memberCount}
          />
        ))}
        {overlay.connectorPaths.map((path) => (
          <path
            key={`connector:${path.color}`}
            className="timeline-selection-overlay__connector"
            d={path.pathData}
            style={{ color: path.color }}
            data-members={path.memberCount}
          />
        ))}
        {overlay.openEnds.map((end) => (
          <circle
            key={end.id}
            className="timeline-selection-overlay__open-end"
            cx={end.cx}
            cy={end.cy}
            r="4"
            style={{ color: end.color }}
          />
        ))}
        {overlay.primarySpan ? (
          <path
            className="timeline-selection-overlay__primary-span"
            d={overlay.primarySpan.pathData}
            style={{ color: overlay.primarySpan.color }}
          />
        ) : null}
        {overlay.events.map(({ marker, transform, primary }) => {
          const folded = Boolean(marker.foldRange);
          const grouped = !folded && marker.events.length > 1;
          const collected = folded || grouped;
          return (
            <g
              key={marker.id}
              className={`timeline-selection-overlay__event${
                primary ? " is-primary" : ""
              }${folded ? " is-folded" : ""}`}
              transform={transform}
            >
              <circle
                className="timeline-selection-overlay__event-ring"
                r={collected ? 6.5 : 5.5}
              />
              {collected ? (
                <text
                  className="timeline-selection-overlay__event-count"
                  y="2.1"
                  textAnchor="middle"
                >
                  {marker.events.length}
                </text>
              ) : (
                <circle
                  className="timeline-selection-overlay__event-dot"
                  r="2.75"
                />
              )}
              <text y="-10" textAnchor="middle">
                {timelineEventMarkerLabel(marker)}
              </text>
            </g>
          );
        })}
      </g>
    );
  },
);

const TimelineAnchorTieGlyph = memo(function TimelineAnchorTieGlyph({
  x,
  points,
}: {
  x: number;
  points: ReadonlyArray<{ path: string; y: number }>;
}) {
  const bracketRef = useRef<SVGPathElement>(null);
  const circleRefs = useRef(new Map<string, SVGCircleElement>());
  useTimelineReorderAnimation(
    [x, ...points.map((point) => point.y)],
    ([animatedX, ...animatedYs]) => {
      if (animatedX === undefined) return;
      if (bracketRef.current && animatedYs.length > 1) {
        const minimumY = Math.min(...animatedYs);
        const maximumY = Math.max(...animatedYs);
        bracketRef.current.setAttribute(
          "d",
          `M ${animatedX + 6} ${minimumY} h 8 M ${
            animatedX + 6
          } ${minimumY} V ${maximumY} M ${
            animatedX + 6
          } ${maximumY} h 8`,
        );
      }
      points.forEach((point, index) => {
        const circle = circleRefs.current.get(point.path);
        const y = animatedYs[index];
        if (!circle || y === undefined) return;
        circle.setAttribute("cx", `${animatedX + 14}`);
        circle.setAttribute("cy", `${y}`);
      });
    },
  );

  const pointYs = points.map((point) => point.y);
  const minimumY = Math.min(...pointYs);
  const maximumY = Math.max(...pointYs);
  return (
    <g className="timeline-anchor-tie" aria-hidden="true">
      {points.length > 1 ? (
        <path
          ref={bracketRef}
          d={`M ${x + 6} ${minimumY} h 8 M ${x + 6} ${minimumY} V ${
            maximumY
          } M ${x + 6} ${maximumY} h 8`}
        />
      ) : null}
      {points.map((point) => (
        <circle
          key={`anchor-tie:${point.path}`}
          ref={(element) => {
            if (element) circleRefs.current.set(point.path, element);
            else circleRefs.current.delete(point.path);
          }}
          cx={x + 14}
          cy={point.y}
          r={2.8}
        />
      ))}
    </g>
  );
});

const TimelineCommitStrip = memo(function TimelineCommitStrip({
  commits,
  positions,
  selectedHash,
  onSelect,
}: {
  commits: TimelineCommit[];
  positions: TimelineCommitTickPosition[];
  selectedHash?: string;
  onSelect: (commit: string) => void;
}) {
  return (
    <g
      className="timeline-commit-strip"
      role="group"
      aria-label={`${commits.length} Git commits in the current first-parent history`}
    >
      {commits.map((entry, index) => {
        const position = positions[index];
        if (!position) return null;
        const selected = entry.commit === selectedHash;
        const shortCommit = entry.commit.slice(0, 8);
        const select = () => onSelect(entry.commit);
        return (
          <g
            className={`timeline-commit-tick${selected ? " is-selected" : ""}`}
            key={entry.commit}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={`Git commit ${index + 1} of ${commits.length}: ${entry.commit}`}
            transform={`translate(${position.x} 0)`}
            onClick={select}
            onKeyDown={(event) => handleTimelineKey(event, select)}
          >
            <title>{shortCommit}</title>
            <rect
              className="timeline-commit-tick__hit"
              x="-4"
              y="1"
              width="8"
              height="16"
            />
            <line
              className="timeline-commit-tick__mark"
              x1="0"
              x2="0"
              y1={selected ? 2 : 5}
              y2={selected ? 16 : 12}
            />
          </g>
        );
      })}
    </g>
  );
});

const TimelineGuides = memo(function TimelineGuides({
  events,
  height,
  presentX,
}: {
  events: TimelineEventMarker[];
  height: number;
  presentX: number;
}) {
  return (
    <>
      {events.map((marker) => {
        const x = timelineXForColumn(marker.column);
        return (
          <g className="timeline-revision" key={`guide:${marker.id}`}>
            <line x1={x} x2={x} y1="18" y2={height - 25} />
            <text x={x} y={height - 10} textAnchor="middle">
              {timelineEventMarkerLabel(marker)}
            </text>
          </g>
        );
      })}
      <g className="timeline-revision is-current">
        <line x1={presentX} x2={presentX} y1="18" y2={height - 25} />
        <text x={presentX} y={height - 10} textAnchor="middle">
          present
        </text>
      </g>
    </>
  );
});

export function TimelineView({
  graph,
  anchorTimeline,
  commits,
  panelLayout,
  foldRanges,
  foldSelection,
  selectedFoldRange,
  protectedEventBoundaries,
  foldNotice,
  onPanelLayoutChange,
  onFoldEndpoint,
  onSelectedFoldRangeChange,
  onSelect: onSelectDocument,
  onClose,
}: TimelineViewProps) {
  const currentPaths = useMemo(() => new Map(graph.documents.map(document => [document.component, document.path])), [graph.documents]);
  const displayPaths = useMemo(() => new Map([
    ...Object.entries(graph.historical_components).map(([id, record]) => [id, record.path] as const),
    ...currentPaths,
  ]), [currentPaths, graph.historical_components]);
  const onSelect = useCallback<ReaderDocumentActivation>((identityOrPath, mode) => {
    onSelectDocument(currentPaths.get(identityOrPath) ?? identityOrPath, mode);
  }, [currentPaths, onSelectDocument]);
  const timelineWorkspaceRef = useRef<HTMLElement>(null);
  const timelineCanvasScrollRef = useRef<HTMLDivElement>(null);
  const timelineHoverOverlayRef = useRef<SVGGElement>(null);
  const timelineHoverSpanOverlayRef = useRef<SVGPathElement>(null);
  const timelineHoverOpenEndOverlayRef = useRef<SVGCircleElement>(null);
  const timelineHoverConnectorOverlayRefs = [
    useRef<SVGPathElement>(null),
    useRef<SVGPathElement>(null),
  ] as const;
  const timelineHoverEventOverlayRefs = [
    useRef<SVGGElement>(null),
    useRef<SVGGElement>(null),
  ] as const;
  const timelineSelectableElementsRef = useRef(
    new Map<string, SVGGElement>(),
  );
  const appliedTimelineSelectionElementRef =
    useRef<SVGGElement | undefined>(undefined);
  const appliedTimelineHoverKeyRef = useRef<string | undefined>(undefined);
  const pendingTimelineHoverTargetRef =
    useRef<TimelineSelectionTarget | undefined>(undefined);
  const timelineHoverFrameRef = useRef<number | undefined>(undefined);
  const timelineFocusFrameRef = useRef<number | undefined>(undefined);
  const timelineScrollInitializedRef = useRef(false);
  const entryRailResizeRef = useRef<TimelineRailResizeInteraction | undefined>(
    undefined,
  );
  const entryRailWidthRef = useRef(TIMELINE_ENTRY_RAIL_DEFAULT_WIDTH);
  const panelResizeRef = useRef<TimelinePanelResizeInteraction | undefined>(
    undefined,
  );
  const panelResizeCleanupRef = useRef<(() => void) | undefined>(undefined);
  const registerTimelineSelectableElement =
    useCallback<TimelineSelectableElementRegistrar>((key, element) => {
      if (element) timelineSelectableElementsRef.current.set(key, element);
      else timelineSelectableElementsRef.current.delete(key);
    }, []);
  const [entryRailWidth, setEntryRailWidth] = useState(
    TIMELINE_ENTRY_RAIL_DEFAULT_WIDTH,
  );
  const [selectedAnchorName, setSelectedAnchorName] = useState<string>();
  const [selectedCommitHash, setSelectedCommitHash] = useState<string>();
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);
  const [focusedEventBoundary, setFocusedEventBoundary] = useState(
    graph.events.length,
  );
  const timelineLeadingInset = timelineLeadingScrollInset(
    timelineViewportWidth,
    TIMELINE_HORIZONTAL_PADDING,
  );
  const selectedAnchor = selectedAnchorName
    ? graph.anchors[selectedAnchorName]
    : undefined;
  const selectedCommit = selectedCommitHash
    ? commits.find((entry) => entry.commit === selectedCommitHash)
    : undefined;
  const selectedAnchorTargets = useMemo(
    () => selectedAnchor ? timelineIdentitiesForPaths(graph, selectedAnchor.connections.map(connection => connection.target)) : undefined,
    [graph, selectedAnchor],
  );
  const presentationTopology = useMemo(
    () =>
      buildTimelinePresentationTopology(
        graph.events,
        selectedAnchorTargets,
        protectedEventBoundaries,
        foldRanges,
      ),
    [
      foldRanges,
      graph.events,
      protectedEventBoundaries,
      selectedAnchorTargets,
    ],
  );
  const focusBoundaryStops = useMemo(
    () =>
      presentationTopology.focusBoundaryStops.map((stop) => ({
        x: timelineXForColumn(stop.column),
        eventBoundary: stop.eventBoundary,
      })),
    [presentationTopology],
  );
  const effectiveFocusedEventBoundary = Math.max(
    0,
    Math.min(graph.events.length, focusedEventBoundary),
  );
  const presentation = useMemo(
    () =>
      buildTimelinePresentationFromTopology(
        presentationTopology,
        effectiveFocusedEventBoundary,
      ),
    [effectiveFocusedEventBoundary, presentationTopology],
  );
  const visibleFocusedEventBoundary =
    presentation.focusedSlice?.eventBoundary ?? effectiveFocusedEventBoundary;
  const updateFocusedSlice = useCallback(() => {
    const scrollContainer = timelineCanvasScrollRef.current;
    if (!scrollContainer || !timelineScrollInitializedRef.current) return;
    if (scrollContainer.clientWidth <= 0) return;
    const nextBoundary = timelineFocusedEventBoundaryAtCanvasOrigin(
      focusBoundaryStops,
      scrollContainer.scrollLeft,
      scrollContainer.clientWidth,
      TIMELINE_HORIZONTAL_PADDING,
    );
    setFocusedEventBoundary((current) =>
      current === nextBoundary ? current : nextBoundary,
    );
  }, [focusBoundaryStops]);
  useLayoutEffect(() => {
    const scrollContainer = timelineCanvasScrollRef.current;
    if (!scrollContainer) return;
    const measureViewport = () => {
      const nextWidth = Math.max(
        0,
        Math.round(scrollContainer.clientWidth * 10) / 10,
      );
      setTimelineViewportWidth((current) =>
        current === nextWidth ? current : nextWidth,
      );
    };
    measureViewport();
    const resizeObserver = new ResizeObserver(measureViewport);
    resizeObserver.observe(scrollContainer);
    return () => resizeObserver.disconnect();
  }, []);
  useLayoutEffect(() => {
    const scrollContainer = timelineCanvasScrollRef.current;
    if (!scrollContainer) return;
    if (timelineScrollInitializedRef.current) return;
    const measuredInset = timelineLeadingScrollInset(
      scrollContainer.clientWidth,
      TIMELINE_HORIZONTAL_PADDING,
    );
    if (Math.abs(measuredInset - timelineLeadingInset) > 0.5) return;

    const nextScrollLeft = timelineScrollLeftForLeadingInset(
      scrollContainer.scrollLeft,
      timelineLeadingInset,
      timelineScrollInitializedRef.current,
    );
    if (Math.abs(nextScrollLeft - scrollContainer.scrollLeft) > 0.5) {
      scrollContainer.scrollLeft = nextScrollLeft;
    }
    timelineScrollInitializedRef.current = true;
    updateFocusedSlice();
  }, [timelineLeadingInset, updateFocusedSlice]);

  useLayoutEffect(() => {
    const scrollContainer = timelineCanvasScrollRef.current;
    if (!scrollContainer) return;
    const scheduleFocusedSliceUpdate = () => {
      if (timelineFocusFrameRef.current !== undefined) return;
      timelineFocusFrameRef.current = window.requestAnimationFrame(() => {
        timelineFocusFrameRef.current = undefined;
        updateFocusedSlice();
      });
    };

    updateFocusedSlice();
    scrollContainer.addEventListener("scroll", scheduleFocusedSliceUpdate, {
      passive: true,
    });
    return () => {
      scrollContainer.removeEventListener(
        "scroll",
        scheduleFocusedSliceUpdate,
      );
      if (timelineFocusFrameRef.current !== undefined) {
        window.cancelAnimationFrame(timelineFocusFrameRef.current);
        timelineFocusFrameRef.current = undefined;
      }
    };
  }, [updateFocusedSlice]);
  const selectionResolver = useMemo(
    () => createTimelineSelectionResolver(presentation),
    [presentation],
  );
  const renderData = useMemo<TimelineRenderData>(() => {
    const colorByPath = new Map(
      presentation.paths.map((path) => [
        path,
        relationshipStyle(`intent:${path}`).color,
      ]),
    );
    const laneByPath = new Map<string, number>();
    for (const span of presentation.spans) laneByPath.set(span.path, span.lane);
    for (const span of timelineFocusedIntentSpans(presentation)) {
      laneByPath.set(span.path, span.lane);
    }
    for (const retirement of timelineFocusedRetirements(presentation)) {
      if (retirement.span) {
        laneByPath.set(retirement.path, retirement.span.lane);
      }
    }
    const eventById = new Map(
      presentation.events.map((marker) => [marker.id, marker]),
    );
    const spanById = new Map(
      presentation.spans.map((span) => [span.id, span]),
    );
    const targetBySpanId = new Map<
      string,
      Extract<TimelineSelectionTarget, { kind: "intent" }>
    >();
    const spans = presentation.spans.map((span) => {
      const startX =
        timelineXForColumn(span.startColumn) + TIMELINE_JUNCTION_GAP;
      const endX =
        timelineXForColumn(span.endColumn) - TIMELINE_JUNCTION_GAP;
      const y = timelineYForLane(span.lane);
      const laneHitRegion = timelineLaneHitRegion(span.lane);
      const target = {
        kind: "intent" as const,
        path: span.path,
        spanId: span.id,
      };
      targetBySpanId.set(span.id, target);
      return {
        span,
        target,
        hitRegion: {
          x: startX,
          y: laneHitRegion.y,
          width: endX - startX,
          height: laneHitRegion.height,
        },
        linePath: `M ${startX} ${y} L ${endX} ${y}`,
        lineStartX: startX,
        lineEndX: endX,
        y,
        color: colorByPath.get(span.path) ?? "currentColor",
        open: span.endColumn === presentation.columnCount - 1,
      };
    });
    const connectors = presentation.connectors.map((connector) => {
      const span = connector.spanId
        ? spanById.get(connector.spanId)
        : undefined;
      const laneY = timelineYForLane(connector.lane);
      const junctionY = timelineYForLane(connector.junctionLane);
      return {
        connector,
        pathData: connectorPathAtY(
          connector,
          timelineXForColumn,
          laneY,
          junctionY,
        ),
        laneY,
        junctionY,
        color: colorByPath.get(connector.path) ?? "currentColor",
        span,
        target: span ? targetBySpanId.get(span.id) : undefined,
      };
    });
    const events = presentation.events.map((marker) => {
      const x = timelineXForColumn(marker.column);
      const y = timelineYForLane(marker.junctionLane);
      return {
        marker,
        transform: `translate(${x} ${y})`,
        x,
        y,
        target: { kind: "event" as const, eventId: marker.id },
      };
    });
    const spanRenderById = new Map(spans.map((item) => [item.span.id, item]));
    const connectorRenderById = new Map(
      connectors.map((item) => [item.connector.id, item]),
    );
    const eventRenderById = new Map(
      events.map((item) => [item.marker.id, item]),
    );
    return {
      spans,
      connectors,
      events,
      spanRenderById,
      connectorRenderById,
      eventRenderById,
      eventById,
      spanById,
      targetBySpanId,
      colorByPath,
      laneByPath,
    };
  }, [presentation]);
  const timelineReorderKey = presentation.paths
    .map((path) => `${path}:${renderData.laneByPath.get(path) ?? ""}`)
    .join("\u0000");
  const timelineReorderStartedAt = useMemo(
    () => performance.now(),
    [timelineReorderKey],
  );
  const currentLaneYByPath = useMemo(
    () =>
      new Map(
        [...renderData.laneByPath].map(([path, lane]) => [
          path,
          timelineYForLane(lane),
        ]),
      ),
    [renderData.laneByPath],
  );
  const committedLaneYByPathRef = useRef(currentLaneYByPath);
  const initialEntryYByPath = committedLaneYByPathRef.current;
  useLayoutEffect(() => {
    committedLaneYByPathRef.current = currentLaneYByPath;
  }, [currentLaneYByPath]);
  const [selectedTarget, setSelectedTarget] =
    useState<TimelineSelectionTarget>();
  const fallbackTarget = useMemo<TimelineSelectionTarget | undefined>(
    () =>
      presentation.events[0]
        ? { kind: "event", eventId: presentation.events[0].id }
        : undefined,
    [presentation.events],
  );
  const selectedFoldMarker = selectedFoldRange
    ? presentation.events.find(
        (marker) =>
          marker.foldRange &&
          timelineFoldRangeKey(marker.foldRange) ===
            timelineFoldRangeKey(selectedFoldRange),
      )
    : undefined;
  const selectedFoldTarget: TimelineSelectionTarget | undefined =
    selectedFoldMarker
      ? { kind: "event", eventId: selectedFoldMarker.id }
      : undefined;
  useLayoutEffect(() => {
    if (!selectedFoldMarker) return;
    const scrollContainer = timelineCanvasScrollRef.current;
    if (!scrollContainer) return;
    scrollContainer.scrollTo({
      left: centeredTimelineScrollLeft(
        timelineXForColumn(selectedFoldMarker.column) + timelineLeadingInset,
        scrollContainer.clientWidth,
        scrollContainer.scrollWidth,
      ),
      behavior: "auto",
    });
  }, [selectedFoldMarker?.id, timelineLeadingInset]);
  const selectedTargetIsValid = selectedTarget
    ? selectedTarget.kind === "event"
      ? renderData.eventById.has(selectedTarget.eventId)
      : renderData.spanById.get(selectedTarget.spanId)?.path ===
        selectedTarget.path
    : false;
  const stableSelectedTarget = foldSelection.active
    ? undefined
    : selectedFoldTarget
      ? selectedFoldTarget
      : selectedTargetIsValid
        ? selectedTarget
        : selectedAnchor || selectedCommit
          ? undefined
          : fallbackTarget;
  const selectedTrace = useMemo(
    () => selectionResolver.resolve(stableSelectedTarget),
    [selectionResolver, stableSelectedTarget],
  );
  const stableSelectedTargetKey = timelineSelectionTargetKey(
    stableSelectedTarget,
  );
  useLayoutEffect(() => {
    const previous = appliedTimelineSelectionElementRef.current;
    const next = stableSelectedTargetKey
      ? timelineSelectableElementsRef.current.get(stableSelectedTargetKey)
      : undefined;
    if (previous && previous !== next) {
      previous.setAttribute("aria-pressed", "false");
    }
    if (next) next.setAttribute("aria-pressed", "true");
    appliedTimelineSelectionElementRef.current = next;
  }, [renderData, stableSelectedTargetKey]);
  const selectedEvent =
    stableSelectedTarget?.kind === "event"
      ? renderData.eventById.get(stableSelectedTarget.eventId)
      : undefined;
  const selectedIntentCandidate =
    stableSelectedTarget?.kind === "intent"
      ? renderData.spanById.get(stableSelectedTarget.spanId)
      : undefined;
  const selectedIntent =
    stableSelectedTarget?.kind === "intent" &&
    selectedIntentCandidate?.path === stableSelectedTarget.path
      ? selectedIntentCandidate
      : undefined;
  const managedPaths = useMemo(
    () => new Set(graph.documents.map((document) => document.component)),
    [graph.documents],
  );
  const focusedIntentSpans = useMemo(
    () => timelineFocusedIntentSpans(presentation),
    [presentation],
  );
  const queuedRetirements = useTimelineRetirementQueue(
    visibleFocusedEventBoundary,
    presentation,
    initialEntryYByPath,
    currentLaneYByPath,
    managedPaths,
    renderData.colorByPath,
  );
  const timelineRailEntries = useMemo<TimelineRailEntry[]>(() => {
    const entries: TimelineRailEntry[] = focusedIntentSpans.map((span) => ({
      span,
      managed: managedPaths.has(span.path),
      color: renderData.colorByPath.get(span.path) ?? "currentColor",
    }));
    const focusedPaths = new Set(focusedIntentSpans.map((span) => span.path));
    for (const entry of queuedRetirements) {
      if (focusedPaths.has(entry.path) || !entry.span) continue;
      entries.push({
        span: entry.span,
        managed: entry.managed,
        color: entry.color,
        initialY: entry.initialY,
        retirementPhase: entry.phase,
      });
    }
    return entries.sort(
      (left, right) =>
        left.span.lane - right.span.lane ||
        left.span.path.localeCompare(right.span.path),
    );
  }, [
    focusedIntentSpans,
    managedPaths,
    renderData.colorByPath,
    queuedRetirements,
  ]);
  const anchorEntries = useMemo<TimelineAnchorEntry[]>(() => {
    const sliceByName = new Map(
      anchorTimeline.map((slice) => [slice.name, slice]),
    );
    return Object.entries(graph.anchors)
      .map(([name, definition]) => ({
        name,
        definition,
        slice: sliceByName.get(name),
      }))
      .sort((left, right) => {
        const leftBoundary = left.slice?.event_boundary ?? Number.POSITIVE_INFINITY;
        const rightBoundary = right.slice?.event_boundary ?? Number.POSITIVE_INFINITY;
        return leftBoundary - rightBoundary || left.name.localeCompare(right.name);
      });
  }, [anchorTimeline, graph.anchors]);
  const selectedAnchorSlice = selectedAnchorName
    ? anchorEntries.find((entry) => entry.name === selectedAnchorName)?.slice
    : undefined;
  if (!entryRailResizeRef.current) entryRailWidthRef.current = entryRailWidth;
  const availableTimelineWidth = useCallback(
    () =>
      timelineWorkspaceRef.current?.clientWidth ??
      (typeof document === "undefined"
        ? 780
        : document.documentElement.clientWidth),
    [],
  );
  const applyLiveEntryRailWidth = useCallback((width: number) => {
    entryRailWidthRef.current = width;
    timelineWorkspaceRef.current?.style.setProperty(
      "--timeline-entry-rail-width",
      `${width}px`,
    );
  }, []);
  const beginEntryRailResize = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      entryRailResizeRef.current = {
        pointerId: event.pointerId,
        captureTarget: event.currentTarget,
        startClientX: event.clientX,
        startWidth: entryRailWidthRef.current,
        availableWidth: availableTimelineWidth(),
      };
    },
    [availableTimelineWidth],
  );
  const moveEntryRailResize = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const resize = entryRailResizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      event.preventDefault();
      applyLiveEntryRailWidth(
        resizeTimelineEntryRail(
          resize.startWidth,
          event.clientX - resize.startClientX,
          resize.availableWidth,
        ),
      );
    },
    [applyLiveEntryRailWidth],
  );
  const finishEntryRailResize = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const resize = entryRailResizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      entryRailResizeRef.current = undefined;
      if (resize.captureTarget.hasPointerCapture(event.pointerId)) {
        resize.captureTarget.releasePointerCapture(event.pointerId);
      }
      setEntryRailWidth(entryRailWidthRef.current);
    },
    [],
  );
  const resetEntryRailWidth = useCallback(() => {
    entryRailResizeRef.current = undefined;
    applyLiveEntryRailWidth(TIMELINE_ENTRY_RAIL_DEFAULT_WIDTH);
    setEntryRailWidth(TIMELINE_ENTRY_RAIL_DEFAULT_WIDTH);
  }, [applyLiveEntryRailWidth]);
  const resizeEntryRailWithKeyboard = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        resetEntryRailWidth();
        return;
      }
      const step = event.shiftKey ? 32 : 8;
      const horizontalMovement =
        event.key === "ArrowLeft"
          ? -step
          : event.key === "ArrowRight"
            ? step
            : undefined;
      if (horizontalMovement === undefined) return;
      event.preventDefault();
      const nextWidth = resizeTimelineEntryRail(
        entryRailWidthRef.current,
        horizontalMovement,
        availableTimelineWidth(),
      );
      applyLiveEntryRailWidth(nextWidth);
      setEntryRailWidth(nextWidth);
    },
    [
      applyLiveEntryRailWidth,
      availableTimelineWidth,
      resetEntryRailWidth,
    ],
  );
  const railResizeControl = useMemo<TimelineRailResizeControlProps>(
    () => ({
      width: entryRailWidth,
      onPointerDown: beginEntryRailResize,
      onKeyDown: resizeEntryRailWithKeyboard,
      onReset: resetEntryRailWidth,
    }),
    [
      beginEntryRailResize,
      entryRailWidth,
      resetEntryRailWidth,
      resizeEntryRailWithKeyboard,
    ],
  );
  const readPanelMetrics = useCallback((): TimelinePanelMetrics | undefined => {
    const workspace = timelineWorkspaceRef.current;
    const ordinary = workspace?.querySelector<HTMLElement>(".timeline-result");
    const inspector = workspace?.querySelector<HTMLElement>(
      ".timeline-inspector",
    );
    if (!workspace || !ordinary || !inspector) return undefined;
    const declaredInterfaceScale = Number.parseFloat(
      window
        .getComputedStyle(workspace)
        .getPropertyValue("--interface-scale"),
    );
    const clientToLocalY = timelinePanelClientToLocalScale(
      workspace.clientHeight,
      workspace.getBoundingClientRect().height,
      declaredInterfaceScale,
    );
    return {
      clientToLocalY,
      sizes: {
        ordinaryHeight: timelinePanelLocalLength(
          ordinary.getBoundingClientRect().height,
          clientToLocalY,
        ),
        inspectorHeight: timelinePanelLocalLength(
          inspector.getBoundingClientRect().height,
          clientToLocalY,
        ),
      },
    };
  }, []);
  const applyLivePanelSizes = useCallback(
    (_boundary: TimelinePanelBoundary, sizes: TimelinePanelSizes) => {
      const workspace = timelineWorkspaceRef.current;
      workspace?.style.setProperty(
        "--timeline-inspector-panel-height",
        `${sizes.inspectorHeight}px`,
      );
    },
    [],
  );
  const restoreCommittedPanelStyles = useCallback(() => {
    const workspace = timelineWorkspaceRef.current;
    if (!workspace) return;
    if (panelLayout.inspectorHeight === undefined) {
      workspace.style.removeProperty("--timeline-inspector-panel-height");
    } else {
      workspace.style.setProperty(
        "--timeline-inspector-panel-height",
        `${panelLayout.inspectorHeight}px`,
      );
    }
  }, [panelLayout.inspectorHeight]);
  const commitPanelSizes = useCallback(
    (_boundary: TimelinePanelBoundary, sizes: TimelinePanelSizes) => {
      onPanelLayoutChange({
        inspectorHeight: sizes.inspectorHeight,
      });
    },
    [onPanelLayoutChange],
  );
  const movePanelResize = useCallback(
    (event: PointerEvent) => {
      const resize = panelResizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      const movement = timelinePanelDragMovement(
        resize.startClientY,
        event.clientY,
        resize.clientToLocalY,
        resize.engaged,
      );
      if (movement === undefined) return;
      event.preventDefault();
      resize.engaged = true;
      resize.latestSizes = resizeTimelinePanels(
        resize.startSizes,
        resize.boundary,
        movement,
      );
      applyLivePanelSizes(resize.boundary, resize.latestSizes);
    },
    [applyLivePanelSizes],
  );
  const finishPanelResize = useCallback(
    (pointerId: number, cancelled = false) => {
      const resize = panelResizeRef.current;
      if (!resize || resize.pointerId !== pointerId) return;
      panelResizeCleanupRef.current?.();
      panelResizeCleanupRef.current = undefined;
      panelResizeRef.current = undefined;
      timelineWorkspaceRef.current?.removeAttribute(
        "data-timeline-panel-resizing",
      );
      releaseTimelinePanelPointerCapture(resize);
      if (cancelled) {
        restoreCommittedPanelStyles();
        return;
      }
      if (!resize.engaged) return;
      const changed =
        Math.abs(
          resize.latestSizes.ordinaryHeight -
            resize.startSizes.ordinaryHeight,
        ) >= 0.05;
      if (!changed) {
        restoreCommittedPanelStyles();
        return;
      }
      commitPanelSizes(resize.boundary, resize.latestSizes);
    },
    [commitPanelSizes, restoreCommittedPanelStyles],
  );
  const beginPanelResize = useCallback(
    (boundary: TimelinePanelBoundary) =>
      (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (
          !event.isPrimary ||
          event.button !== 0 ||
          panelResizeRef.current
        ) {
          return;
        }
        const metrics = readPanelMetrics();
        if (!metrics) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        panelResizeRef.current = {
          pointerId: event.pointerId,
          captureTarget: event.currentTarget,
          boundary,
          startClientY: event.clientY,
          clientToLocalY: metrics.clientToLocalY,
          startSizes: metrics.sizes,
          latestSizes: metrics.sizes,
          engaged: false,
        };
        timelineWorkspaceRef.current?.setAttribute(
          "data-timeline-panel-resizing",
          boundary,
        );
        const pointerId = event.pointerId;
        const move = (pointerEvent: PointerEvent) =>
          movePanelResize(pointerEvent);
        const finish = (pointerEvent: PointerEvent) =>
          finishPanelResize(pointerEvent.pointerId);
        const cancel = (pointerEvent: PointerEvent) =>
          finishPanelResize(pointerEvent.pointerId, true);
        const cancelOnBlur = () => finishPanelResize(pointerId, true);
        const cleanup = () => {
          window.removeEventListener("pointermove", move, true);
          window.removeEventListener("pointerup", finish, true);
          window.removeEventListener("pointercancel", cancel, true);
          window.removeEventListener("blur", cancelOnBlur);
        };
        panelResizeCleanupRef.current = cleanup;
        window.addEventListener("pointermove", move, true);
        window.addEventListener("pointerup", finish, true);
        window.addEventListener("pointercancel", cancel, true);
        window.addEventListener("blur", cancelOnBlur);
        try {
          event.currentTarget.setPointerCapture(pointerId);
        } catch {
          // Window listeners retain drag ownership on engines without capture.
        }
      },
    [finishPanelResize, movePanelResize, readPanelMetrics],
  );
  const resetPanelLayout = useCallback(() => {
    const resize = panelResizeRef.current;
    panelResizeCleanupRef.current?.();
    panelResizeCleanupRef.current = undefined;
    panelResizeRef.current = undefined;
    releaseTimelinePanelPointerCapture(resize);
    const workspace = timelineWorkspaceRef.current;
    workspace?.removeAttribute("data-timeline-panel-resizing");
    workspace?.style.removeProperty("--timeline-inspector-panel-height");
    onPanelLayoutChange({});
  }, [onPanelLayoutChange]);
  useEffect(
    () => () => {
      panelResizeCleanupRef.current?.();
      panelResizeCleanupRef.current = undefined;
      const resize = panelResizeRef.current;
      panelResizeRef.current = undefined;
      releaseTimelinePanelPointerCapture(resize);
    },
    [],
  );
  const resizePanelWithKeyboard = useCallback(
    (boundary: TimelinePanelBoundary) =>
      (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          resetPanelLayout();
          return;
        }
        const movement =
          event.key === "ArrowUp"
            ? -(event.shiftKey ? 36 : 12)
            : event.key === "ArrowDown"
              ? event.shiftKey
                ? 36
                : 12
              : undefined;
        if (movement === undefined) return;
        const metrics = readPanelMetrics();
        if (!metrics) return;
        event.preventDefault();
        event.stopPropagation();
        const sizes = resizeTimelinePanels(
          metrics.sizes,
          boundary,
          movement,
        );
        applyLivePanelSizes(boundary, sizes);
        commitPanelSizes(boundary, sizes);
      },
    [
      applyLivePanelSizes,
      commitPanelSizes,
      readPanelMetrics,
      resetPanelLayout,
    ],
  );
  const dimensions = timelineDimensions(
    presentation.columnCount,
    presentation.laneCount,
  );
  const timelineCanvasRenderedWidth = Math.max(
    dimensions.width,
    timelineViewportWidth,
  );
  const xForColumn = timelineXForColumn;
  const yForLane = timelineYForLane;
  const presentX = xForColumn(presentation.columnCount - 1);
  const commitEventBoundaryXs = useMemo(
    () =>
      Array.from({ length: graph.events.length + 1 }, (_, boundary) =>
        commitEventBoundaryX(
          boundary,
          graph.events.length,
          presentation.events,
          xForColumn,
        ),
      ),
    [graph.events.length, presentation.events],
  );
  const commitTickPositions = useMemo(() => {
    const startX = xForColumn(-0.18);
    return timelineCommitTickPositions(
      commits.map((commit) => commit.event_boundary),
      commitEventBoundaryXs,
      startX,
      Math.max(startX, presentX - 16),
    );
  }, [commitEventBoundaryXs, commits, presentX]);
  const anchorPositions = useMemo(
    () =>
      new Map(
        anchorEntries.map((entry) => [
          entry.name,
          timelineAnchorPosition(
            anchorSliceX(
              entry.slice?.event_boundary,
              graph.events.length,
              presentation.events,
              timelineXForColumn,
            ),
            entry.definition.commit,
            commits,
            commitTickPositions,
          ),
        ]),
      ),
    [
      anchorEntries,
      graph.events.length,
      presentation.events,
      commits,
      commitTickPositions,
    ],
  );
  const selectedAnchorPosition = selectedAnchorName
    ? anchorPositions.get(selectedAnchorName)
    : undefined;
  const selectedAnchorX = selectedAnchorPosition?.x;
  const anchoredTimelinePaths = useMemo(() => {
    if (!selectedAnchor) return [];
    const timelinePaths = new Set(presentation.paths);
    return timelineIdentitiesForPaths(graph, selectedAnchor.connections.map(connection => connection.target))
      .filter(identity => timelinePaths.has(identity));
  }, [graph, presentation.paths, selectedAnchor]);
  const anchoredTimelinePathSet = useMemo(
    () => new Set(anchoredTimelinePaths),
    [anchoredTimelinePaths],
  );
  const selectedAnchorBoundary = selectedAnchorSlice?.event_boundary;
  const anchorTiePoints =
    selectedAnchorBoundary == null
      ? []
      : anchoredTimelinePaths.flatMap((path) => {
          const span = timelineIntentSpanAtBoundary(
            presentation,
            path,
            selectedAnchorBoundary,
          );
          return span ? [{ path, y: yForLane(span.lane) }] : [];
        });
  const clearTimelineHover = useCallback(() => {
    setTimelineHoverPath(
      timelineHoverSpanOverlayRef.current,
      undefined,
      undefined,
    );
    setTimelineHoverOpenEnd(timelineHoverOpenEndOverlayRef.current, undefined);
    for (const ref of timelineHoverConnectorOverlayRefs) {
      setTimelineHoverPath(ref.current, undefined, undefined);
    }
    for (const ref of timelineHoverEventOverlayRefs) {
      setTimelineHoverEvent(ref.current, undefined);
    }
    timelineHoverOverlayRef.current?.removeAttribute(
      "data-timeline-hover-target",
    );
    appliedTimelineHoverKeyRef.current = undefined;
  }, []);
  const applyTimelineHoverTarget = useCallback(
    (target: TimelineSelectionTarget | undefined) => {
      const targetKey = target
        ? target.kind === "event"
          ? `event:${target.eventId}`
          : `intent:${target.spanId}\u0000${target.path}`
        : undefined;
      if (targetKey === appliedTimelineHoverKeyRef.current) return;

      const trace = selectionResolver.resolveHover(target);
      const spanId = trace.spanIds.values().next().value;
      const spanItem = spanId
        ? renderData.spanRenderById.get(spanId)
        : undefined;
      setTimelineHoverPath(
        timelineHoverSpanOverlayRef.current,
        spanItem?.linePath,
        spanItem?.color,
      );
      setTimelineHoverOpenEnd(
        timelineHoverOpenEndOverlayRef.current,
        spanItem,
      );

      let connectorIndex = 0;
      for (const connectorId of trace.connectorIds) {
        const ref = timelineHoverConnectorOverlayRefs[connectorIndex];
        if (!ref) break;
        const item = renderData.connectorRenderById.get(connectorId);
        setTimelineHoverPath(ref.current, item?.pathData, item?.color);
        connectorIndex += 1;
      }
      for (
        ;
        connectorIndex < timelineHoverConnectorOverlayRefs.length;
        connectorIndex += 1
      ) {
        setTimelineHoverPath(
          timelineHoverConnectorOverlayRefs[connectorIndex].current,
          undefined,
          undefined,
        );
      }

      let eventIndex = 0;
      for (const eventId of trace.eventIds) {
        const ref = timelineHoverEventOverlayRefs[eventIndex];
        if (!ref) break;
        setTimelineHoverEvent(
          ref.current,
          renderData.eventRenderById.get(eventId),
        );
        eventIndex += 1;
      }
      for (
        ;
        eventIndex < timelineHoverEventOverlayRefs.length;
        eventIndex += 1
      ) {
        setTimelineHoverEvent(
          timelineHoverEventOverlayRefs[eventIndex].current,
          undefined,
        );
      }
      if (targetKey) {
        timelineHoverOverlayRef.current?.setAttribute(
          "data-timeline-hover-target",
          targetKey,
        );
      } else {
        timelineHoverOverlayRef.current?.removeAttribute(
          "data-timeline-hover-target",
        );
      }
      appliedTimelineHoverKeyRef.current = targetKey;
    },
    [renderData, selectionResolver],
  );
  const handleTimelineTargetHover = useCallback<TimelineTargetInteraction>(
    (target) => {
      pendingTimelineHoverTargetRef.current = target;
      if (timelineHoverFrameRef.current !== undefined) return;
      timelineHoverFrameRef.current = window.requestAnimationFrame(() => {
        timelineHoverFrameRef.current = undefined;
        applyTimelineHoverTarget(pendingTimelineHoverTargetRef.current);
      });
    },
    [applyTimelineHoverTarget],
  );
  useEffect(() => {
    pendingTimelineHoverTargetRef.current = undefined;
    if (timelineHoverFrameRef.current !== undefined) {
      window.cancelAnimationFrame(timelineHoverFrameRef.current);
      timelineHoverFrameRef.current = undefined;
    }
    clearTimelineHover();
    return () => {
      if (timelineHoverFrameRef.current !== undefined) {
        window.cancelAnimationFrame(timelineHoverFrameRef.current);
        timelineHoverFrameRef.current = undefined;
      }
      clearTimelineHover();
    };
  }, [clearTimelineHover, selectionResolver]);
  const activateIntent = useCallback<TimelineIntentInteraction>(
    (span, surface, mode = "same-reader") => {
      if (foldSelection.active) return;
      setSelectedCommitHash(undefined);
      onSelectedFoldRangeChange(undefined);
      setSelectedTarget({
        kind: "intent",
        path: span.path,
        spanId: span.id,
      });
      if (timelineIntentOpensReader(surface, managedPaths.has(span.path))) {
        onSelect(span.path, mode);
      }
    },
    [
      foldSelection.active,
      managedPaths,
      onSelect,
      onSelectedFoldRangeChange,
    ],
  );
  const selectEventTarget = useCallback(
    (target: Extract<TimelineSelectionTarget, { kind: "event" }>) => {
      const marker = renderData.eventById.get(target.eventId);
      if (!marker) return;
      if (foldSelection.active) {
        onFoldEndpoint({
          startEventIndex: marker.startEventIndex,
          endEventIndex: marker.endEventIndex,
        });
        return;
      }
      setSelectedCommitHash(undefined);
      setSelectedTarget(target);
      onSelectedFoldRangeChange(marker.foldRange);
    },
    [
      foldSelection.active,
      onFoldEndpoint,
      onSelectedFoldRangeChange,
      renderData.eventById,
    ],
  );
  const selectAnchor = useCallback(
    (name: string) => {
      setSelectedCommitHash(undefined);
      onSelectedFoldRangeChange(undefined);
      const targetX = anchorPositions.get(name)?.x;
      const scrollContainer = timelineCanvasScrollRef.current;
      if (targetX !== undefined && scrollContainer) {
        scrollContainer.scrollTo({
          left: centeredTimelineScrollLeft(
            targetX + timelineLeadingInset,
            scrollContainer.clientWidth,
            scrollContainer.scrollWidth,
          ),
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "auto"
            : "smooth",
        });
      }
      setSelectedAnchorName((current) =>
        current === name ? undefined : name,
      );
      setSelectedTarget(undefined);
    },
    [
      anchorPositions,
      timelineLeadingInset,
      onSelectedFoldRangeChange,
    ],
  );
  const selectCommit = useCallback((commit: string) => {
    setSelectedCommitHash(commit);
    setSelectedAnchorName(undefined);
    setSelectedTarget(undefined);
    onSelectedFoldRangeChange(undefined);
  }, [onSelectedFoldRangeChange]);
  const inspector = foldSelection.active ? null : selectedEvent ? (
    <TimelineEventInspector
      marker={selectedEvent}
      managedPaths={managedPaths}
      displayPaths={displayPaths}
      onSelect={onSelect}
    />
  ) : selectedIntent ? (
    <TimelineIntentInspector
      span={selectedIntent}
      trace={selectedTrace}
      managedPaths={managedPaths}
      displayPaths={displayPaths}
      onSelect={onSelect}
    />
  ) : selectedAnchor && selectedAnchorName ? (
    <TimelineAnchorInspector
      name={selectedAnchorName}
      anchor={selectedAnchor}
      slice={selectedAnchorSlice}
      position={selectedAnchorPosition}
      eventCount={graph.events.length}
      onSelect={onSelect}
    />
  ) : selectedCommit ? (
    <TimelineCommitInspector commit={selectedCommit.commit} />
  ) : null;
  const hasInspector = inspector !== null;
  const panelResizeControl = useMemo<TimelinePanelResizeControlProps>(
    () => ({
      onPointerDown: beginPanelResize("timeline-information"),
      onLostPointerCapture: (
        event: ReactPointerEvent<HTMLButtonElement>,
      ) => finishPanelResize(event.pointerId, true),
      onKeyDown: resizePanelWithKeyboard("timeline-information"),
      onReset: resetPanelLayout,
    }),
    [
      beginPanelResize,
      finishPanelResize,
      resetPanelLayout,
      resizePanelWithKeyboard,
    ],
  );
  const workspaceStyle = {
    "--timeline-entry-rail-width": `${entryRailWidth}px`,
    "--timeline-retirement-fade-duration": `${TIMELINE_RETIREMENT_FADE_DURATION_MS}ms`,
    ...(panelLayout.inspectorHeight === undefined
      ? {}
      : {
          "--timeline-inspector-panel-height": `${
            panelLayout.inspectorHeight
          }px`,
      }),
  } as CSSProperties;
  const entryDockRowCount = anchorEntries.length;
  const entryDockHeight =
    entryDockRowCount === 0
      ? 0
      : Math.min(140, 8 + entryDockRowCount * 24);
  const visibleFoldCount = presentationTopology.visibleFoldRanges.length;
  const nestedFoldCount = foldRanges.length - visibleFoldCount;
  const foldedEventCount = presentationTopology.visibleFoldRanges.reduce(
    (count, range) =>
      count + range.endEventIndex - range.startEventIndex + 1,
    0,
  );
  const timelineResultStyle = {
    "--timeline-entry-dock-height": `${entryDockHeight}px`,
  } as CSSProperties;

  return (
    <section
      ref={timelineWorkspaceRef}
      className={`timeline-workspace${hasInspector ? " has-information" : ""}`}
      aria-label="Registered opening-intent timeline"
      data-timeline-focus-boundary={visibleFocusedEventBoundary}
      style={workspaceStyle}
      onPointerMove={moveEntryRailResize}
      onPointerUp={finishEntryRailResize}
      onPointerCancel={finishEntryRailResize}
      onLostPointerCapture={finishEntryRailResize}
    >
      <WorkspaceBanner ariaLabel="Timeline summary" className="timeline-summary" multiline
        trailing={
          <button type="button" className="timeline-close" onClick={onClose}
            aria-label="Close Timeline and return to Structure" title="Return to Structure">
            <CloseIcon /><span>Structure</span>
          </button>
        }>
        <div className="timeline-summary__content">
          <div className="timeline-summary__overview">
            <strong className="timeline-summary__title">Timeline</strong>
            <div className="timeline-summary__scope">
              <span><strong>{graph.events.length}</strong> events</span>
              <span><strong>{commits.length}</strong> {commits.length === 1 ? "commit" : "commits"}</span>
              <span><strong>{anchorEntries.length}</strong> {anchorEntries.length === 1 ? "anchor" : "anchors"}</span>
              {visibleFoldCount > 0 ? <>
                <span><strong>{visibleFoldCount}</strong> {visibleFoldCount === 1 ? "fold" : "folds"}</span>
                {nestedFoldCount > 0 ? <span><strong>{nestedFoldCount}</strong> nested</span> : null}
                <span><strong>{foldedEventCount}</strong> folded events</span>
              </> : null}
            </div>
          </div>
          <HelpOnly><p className="timeline-summary__help">
            Events follow authored order across {presentation.events.length} visible nodes.
            Select an event or lifeline to inspect it, or an Anchor to pin its position.
          </p></HelpOnly>
          {foldNotice ? (
            <span className="timeline-summary__fold-state is-warning" role="status">
              {foldNotice}
            </span>
          ) : foldSelection.active ? (
            <span className="timeline-summary__fold-state" role="status">
              <HelpOnly fallback={foldSelection.firstEndpoint ? `Start: ${timelineEventMarkerLabel(foldSelection.firstEndpoint)} · Select end` : "Select start"}>
                {foldSelection.firstEndpoint
                ? `Select a second event or folded region; the first endpoint is ${timelineEventMarkerLabel(
                    foldSelection.firstEndpoint,
                  )}.`
                : "Select the first event or folded region."}
              </HelpOnly>
            </span>
          ) : null}
        </div>
      </WorkspaceBanner>

      {inspector}

      <TimelineReorderStartedAtContext.Provider
        value={timelineReorderStartedAt}
      >
        <div
          className={`timeline-result${
            entryDockRowCount > 0 ? " has-entry-dock" : ""
          }`}
          style={timelineResultStyle}
        >
          <div className="timeline-result__scroll">
          <div className="timeline-result__content">
            <div
              ref={timelineCanvasScrollRef}
              className="timeline-canvas-scroll"
              data-timeline-scroll="ordinary"
              style={{ height: dimensions.height }}
            >
              <div className="timeline-canvas-scroll__content">
                <div
                  className="timeline-canvas-scroll__leading-space"
                  style={{ width: timelineLeadingInset }}
                  aria-hidden="true"
                />
                <svg
                  className="timeline-canvas"
                  viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
                  width={timelineCanvasRenderedWidth}
                  height={dimensions.height}
                  preserveAspectRatio="xMinYMin meet"
                  role="group"
                  aria-label={`${graph.events.length} registered opening-intent events in ${
                    presentation.events.length
                  } timeline nodes`}
                >
            {selectedAnchorX !== undefined && selectedAnchorName ? (
              <g
                className="timeline-anchor-slice"
                data-position-kind={selectedAnchorPosition?.kind}
                aria-hidden="true"
              >
                <rect
                  x={selectedAnchorX - 10}
                  y={18}
                  width={20}
                  height={dimensions.height - 40}
                  rx={7}
                />
                <line
                  x1={selectedAnchorX}
                  x2={selectedAnchorX}
                  y1={19}
                  y2={dimensions.height - 22}
                />
                <text x={selectedAnchorX + 6} y={26}>
                  {selectedAnchorName}
                </text>
              </g>
            ) : null}
            <TimelineGuides
              events={presentation.events}
              height={dimensions.height}
              presentX={presentX}
            />
            <TimelineCommitStrip
              commits={commits}
              positions={commitTickPositions}
              selectedHash={selectedCommit?.commit}
              onSelect={selectCommit}
            />

            <g
              className={`timeline-lifeline-layer${
                stableSelectedTargetKey ? " has-selection" : ""
              }`}
            >
              <TimelineBaseLifelines
                renderData={renderData}
                anchoredPaths={anchoredTimelinePathSet}
                onElement={registerTimelineSelectableElement}
                onActivate={activateIntent}
                onHover={handleTimelineTargetHover}
              />
            </g>

            <g
              className={`timeline-event-layer${
                stableSelectedTargetKey ? " has-selection" : ""
              }`}
            >
              <TimelineBaseEvents
                renderData={renderData}
                foldBoundaryKey={
                  foldSelection.firstEndpoint
                    ? timelineFoldRangeKey(foldSelection.firstEndpoint)
                    : undefined
                }
                foldSelecting={foldSelection.active}
                onElement={registerTimelineSelectableElement}
                onSelect={selectEventTarget}
                onHover={handleTimelineTargetHover}
              />
            </g>

            <TimelineSelectionOverlayGlyph
              renderData={renderData}
              trace={selectedTrace}
              target={stableSelectedTarget}
            />

            {selectedAnchorX !== undefined && anchorTiePoints.length > 0 ? (
              <TimelineAnchorTieGlyph
                x={selectedAnchorX}
                points={anchorTiePoints}
              />
            ) : null}
            <g
              ref={timelineHoverOverlayRef}
              className="timeline-hover-overlay"
              aria-hidden="true"
            >
              <path
                ref={timelineHoverSpanOverlayRef}
                className="timeline-hover-overlay__span"
              />
              <circle
                ref={timelineHoverOpenEndOverlayRef}
                className="timeline-hover-overlay__open-end"
                r="4"
              />
              {timelineHoverConnectorOverlayRefs.map((ref, index) => (
                <path
                  key={`timeline-hover-connector:${index}`}
                  ref={ref}
                  className="timeline-hover-overlay__connector"
                />
              ))}
              {timelineHoverEventOverlayRefs.map((ref, index) => (
                <g
                  key={`timeline-hover-event:${index}`}
                  ref={ref}
                  className="timeline-hover-overlay__event"
                >
                  <circle
                    className="timeline-hover-overlay__event-ring"
                    r="5.5"
                  />
                  <circle
                    className="timeline-hover-overlay__event-dot"
                    r="2.75"
                  />
                  <text
                    className="timeline-hover-overlay__event-count"
                    y="2.1"
                    textAnchor="middle"
                  />
                  <text y="-10" textAnchor="middle" />
                </g>
              ))}
            </g>
                </svg>
              </div>
            </div>

            <aside
              className="timeline-entry-rail"
              aria-label={`Intent entries open after ${
                visibleFocusedEventBoundary === 0
                  ? "the start of the registered flow"
                  : `E${visibleFocusedEventBoundary}`
              }`}
            >
              <div
                className="timeline-entry-rail__rows"
                style={{ height: dimensions.height }}
              >
                {timelineRailEntries.map((entry) => {
                  const { span } = entry;
                  const path = span.path;
                  const target = renderData.targetBySpanId.get(span.id);
                  if (!target) return null;
                  const active = selectedTrace.paths.has(path);
                  const primary =
                    stableSelectedTarget?.kind === "intent" &&
                    stableSelectedTarget.path === path;
                  return (
                    <TimelineFileEntry
                      key={path}
                      span={span}
                      label={displayPaths.get(span.path) ?? span.path}
                      target={target}
                      y={yForLane(span.lane)}
                      initialY={
                        entry.initialY ?? initialEntryYByPath.get(path)
                      }
                      retirementPhase={entry.retirementPhase}
                      active={active}
                      primary={primary}
                      anchored={anchoredTimelinePathSet.has(path)}
                      pressed={
                        stableSelectedTarget?.kind === "intent" &&
                        stableSelectedTarget.spanId === span.id
                      }
                      managed={entry.managed}
                      color={entry.color}
                      onHover={handleTimelineTargetHover}
                      onActivate={activateIntent}
                    />
                  );
                })}
              </div>
            </aside>
          </div>
        </div>

        <TimelineRailResizeHandle {...railResizeControl} />

        {entryDockRowCount > 0 ? (
          <TimelineAnchorEntryDock
            anchorEntries={anchorEntries}
            positions={anchorPositions}
            eventCount={graph.events.length}
            selectedName={selectedAnchorName}
            onSelect={selectAnchor}
            onOpen={onSelect}
          />
        ) : null}

        {hasInspector ? (
          <TimelinePanelResizeHandle
            boundary="timeline-information"
            {...panelResizeControl}
          />
        ) : null}

        {presentation.events.length === 0 ? (
          <div className="timeline-unchanged">
            No opening-intent event is registered.
          </div>
        ) : null}
        </div>
      </TimelineReorderStartedAtContext.Provider>
    </section>
  );
}

const TimelineAnchorEntryDock = memo(function TimelineAnchorEntryDock({
  anchorEntries,
  positions,
  eventCount,
  selectedName,
  onSelect,
  onOpen,
}: {
  anchorEntries: TimelineAnchorEntry[];
  positions: ReadonlyMap<string, TimelineAnchorPosition | undefined>;
  eventCount: number;
  selectedName?: string;
  onSelect: (name: string) => void;
  onOpen: ReaderDocumentActivation;
}) {
  return (
    <aside
      className="timeline-special-entry-dock"
      aria-label="Current stable anchors"
    >
      {anchorEntries.length > 0 ? (
        <div
          className="timeline-special-entry-dock__section timeline-anchor-dock__rows"
          role="group"
          aria-label="Current stable anchors"
        >
          {anchorEntries.map((entry) => {
            const position = positions.get(entry.name);
            const boundary = anchorBoundaryLabel(
              entry.slice?.event_boundary,
              eventCount,
              position,
            );
            return (
              <TimelineAnchorDockRow
                key={timelineAnchorEntryKey(entry.name)}
                entry={entry}
                boundary={boundary}
                selected={selectedName === entry.name}
                mapped={position !== undefined}
                onSelect={() => onSelect(entry.name)}
                onActivate={(mode) => onOpen(entry.definition.file, mode)}
              />
            );
          })}
        </div>
      ) : null}
    </aside>
  );
});

function TimelineEventInspector({
  marker,
  managedPaths,
  displayPaths,
  onSelect,
}: {
  marker: TimelineEventMarker;
  managedPaths: Set<string>;
  displayPaths: ReadonlyMap<string, string>;
  onSelect: ReaderDocumentActivation;
}) {
  const folded = Boolean(marker.foldRange);
  const grouped = !folded && marker.events.length > 1;
  const markerLabel = timelineEventMarkerLabel(marker);
  const eventLog = timelineEventLogEntries(marker);
  return (
    <div
      className={`timeline-inspector timeline-event-inspector${
        folded ? " is-folded" : ""
      }`}
      aria-live="polite"
    >
      <header className="timeline-inspector__event">
        <div>
          <span>
            {folded
              ? "Fold"
              : grouped
                ? "Events"
                : "Event"}
          </span>
          <strong>{markerLabel}</strong>
          {folded || grouped ? <small>
            {marker.events.length} events
            <HelpOnly> · {folded ? "exact collection" : "shared file collection"}</HelpOnly>
          </small> : null}
        </div>
      </header>
      <div
        className="timeline-inspector__event-details"
        aria-label={`${eventLog.length} event log ${
          eventLog.length === 1 ? "entry" : "entries"
        }`}
      >
        {eventLog.map(({ event, eventNumber }) => (
          <article key={`${eventNumber}:${event.name}`}>
            <header>
              <span>E{eventNumber}</span>
              <strong>{event.name}</strong>
            </header>
            {event.description ? <p>{event.description}</p> : (
              <HelpOnly><p className="is-empty">No event description.</p></HelpOnly>
            )}
          </article>
        ))}
      </div>
      {folded ? null : (
        <div className="timeline-inspector__changes">
          <IntentList
            label={grouped ? "Shared predecessors" : "Predecessors"}
            paths={marker.event.predecessors}
            managedPaths={managedPaths}
            displayPaths={displayPaths}
            onSelect={onSelect}
          />
          <IntentList
            label={grouped ? "Shared successors" : "Successors"}
            paths={marker.event.successors}
            managedPaths={managedPaths}
            displayPaths={displayPaths}
            onSelect={onSelect}
          />
        </div>
      )}
    </div>
  );
}

function TimelineIntentInspector({
  span,
  trace,
  managedPaths,
  displayPaths,
  onSelect,
}: {
  span: TimelineIntentSpan;
  trace: TimelineSelectionTrace;
  managedPaths: Set<string>;
  displayPaths: ReadonlyMap<string, string>;
  onSelect: ReaderDocumentActivation;
}) {
  return (
    <div className="timeline-inspector" aria-live="polite">
      <header className="timeline-inspector__event">
        <div>
          <span>Intent lifeline</span>
          <strong title={span.path}>{displayPaths.get(span.path) ?? span.path}</strong>
        </div>
        {managedPaths.has(span.path) ? (
          <button
            className="timeline-inspector__open"
            type="button"
            onClick={(event) =>
              onSelect(span.path, readerNavigationMode(event))
            }
          >
            Open file
          </button>
        ) : null}
      </header>
      <div className="timeline-inspector__changes">
        <IntentList
          label="Past sources"
          paths={trace.pastPaths}
          managedPaths={managedPaths}
          displayPaths={displayPaths}
          onSelect={onSelect}
        />
        <IntentList
          label="Future branches"
          paths={trace.futurePaths}
          managedPaths={managedPaths}
          displayPaths={displayPaths}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

function TimelineAnchorInspector({
  name,
  anchor,
  slice,
  position,
  eventCount,
  onSelect,
}: {
  name: string;
  anchor: AnchorDefinition;
  slice?: AnchorTimelineSlice;
  position?: TimelineAnchorPosition;
  eventCount: number;
  onSelect: ReaderDocumentActivation;
}) {
  const boundary = anchorBoundaryLabel(
    slice?.event_boundary,
    eventCount,
    position,
  );
  return (
    <div className="timeline-inspector timeline-anchor-inspector" aria-live="polite">
      <header className="timeline-inspector__event">
        <div>
          <span>Anchor</span>
          <strong>{name}</strong>
          <code title={anchor.commit}>{anchor.commit}</code>
        </div>
      </header>
      <p className="timeline-inspector__description">
        <strong>{boundary}</strong>
        {anchor.description ? <span>{anchor.description}</span> : null}
      </p>
      <div className="timeline-inspector__changes">
        <section>
          <h2>Document</h2>
          <button
            className="timeline-intent-row"
            type="button"
            onClick={(event) =>
              onSelect(anchor.file, readerNavigationMode(event))
            }
          >
            {anchor.file}
          </button>
          <h2>
            Historical connections <span>{anchor.connections.length}</span>
          </h2>
          {anchor.connections.length === 0 ? (
            <p className="timeline-intent-empty">None</p>
          ) : null}
          {anchor.connections.map((connection) => (
            <div
              className="timeline-intent-row timeline-anchor-connection"
              key={`${connection.type}\u0000${connection.target}`}
            >
              <strong>{connection.type}</strong>
              <code>{connection.target}</code>
            </div>
          ))}
        </section>
        <HelpOnly><section className="timeline-anchor-inspector__meaning">
          <h2>Timeline cue</h2>
          <p>
            {position?.kind === "event-boundary"
              ? "Pinned at the Event boundary; matching lifelines are linked."
              : position?.kind === "commit"
                ? "Pinned to its Git commit; Event position is unknown."
                : "No matching Event boundary or commit in this view."}
          </p>
        </section></HelpOnly>
      </div>
    </div>
  );
}

function TimelineCommitInspector({ commit }: { commit: string }) {
  const [copyStatus, setCopyStatus] = useState<
    "idle" | "copied" | "failed"
  >("idle");
  const shortCommit = commit.slice(0, 8);
  useEffect(() => setCopyStatus("idle"), [commit]);
  const copyCommit = useCallback(async () => {
    try {
      await copyTimelineText(commit);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }, [commit]);

  return (
    <div
      className="timeline-inspector timeline-commit-inspector"
      aria-live="polite"
    >
      <header className="timeline-inspector__event">
        <div>
          <span>Git commit</span>
          <strong>{shortCommit}</strong>
        </div>
      </header>
      <div className="timeline-commit-inspector__identity">
        <div>
          <span>Full commit ID</span>
          <code title={commit}>{commit}</code>
        </div>
        <button type="button" onClick={copyCommit}>
          {copyStatus === "copied"
            ? "Copied"
            : copyStatus === "failed"
              ? "Copy failed"
              : "Copy full ID"}
        </button>
      </div>
    </div>
  );
}

function IntentList({
  label,
  paths,
  managedPaths,
  displayPaths,
  onSelect,
}: {
  label: string;
  paths: string[];
  managedPaths: Set<string>;
  displayPaths: ReadonlyMap<string, string>;
  onSelect: ReaderDocumentActivation;
}) {
  return (
    <section>
      <h2>{label} <span>{paths.length}</span></h2>
      {paths.length === 0 ? <p className="timeline-intent-empty">None</p> : null}
      {paths.map((path) =>
        managedPaths.has(path) ? (
          <button
            className="timeline-intent-row"
            type="button"
            key={path}
            title={path}
            onClick={(event) => onSelect(path, readerNavigationMode(event))}
          >
            {displayPaths.get(path) ?? path}
          </button>
        ) : (
          <strong className="timeline-intent-row" key={path} title={path}>{displayPaths.get(path) ?? path}</strong>
        ),
      )}
    </section>
  );
}
