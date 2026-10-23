import type { EvolveEvent } from "./types";

export interface TimelineIntentSpan {
  id: string;
  path: string;
  startColumn: number;
  endColumn: number;
  lane: number;
}

export interface TimelineIntentConnector {
  id: string;
  eventId: string;
  column: number;
  path: string;
  spanId?: string;
  lane: number;
  junctionLane: number;
  side: "predecessor" | "successor";
}

export interface TimelineEventMarker {
  id: string;
  column: number;
  junctionLane: number;
  event: EvolveEvent;
  events: EvolveEvent[];
  startEventIndex: number;
  endEventIndex: number;
  foldRange?: TimelineFoldRange;
}

export interface TimelineFoldRange {
  startEventIndex: number;
  endEventIndex: number;
}

export type TimelineFoldRangeResult =
  | { ok: true; range: TimelineFoldRange }
  | {
      ok: false;
      reason: "requires-two-events" | "crosses-anchor" | "overlaps-fold";
    };

export interface TimelinePresentation {
  events: TimelineEventMarker[];
  spans: TimelineIntentSpan[];
  connectors: TimelineIntentConnector[];
  paths: string[];
  columnCount: number;
  laneCount: number;
  focusedSlice?: TimelineFocusedSlice;
}

export interface TimelineFocusBoundaryStop {
  column: number;
  eventBoundary: number;
}

export interface TimelinePresentationTopology {
  eventCount: number;
  visibleFoldRanges: TimelineFoldRange[];
  projectedEvents: TimelineProjectedEvent[];
  projectedEventValues: EvolveEvent[];
  baselinePaths: string[];
  eventGroups: TimelineProjectedEvent[];
  trackSchedule: TimelineTrackSchedule;
  focusBoundaryStops: TimelineFocusBoundaryStop[];
}

export interface TimelineTrackSchedule {
  boundaryTracks: Map<string, number>[];
  trackCount: number;
}

export interface TimelineFocusedSlice {
  eventBoundary: number;
  openPaths: string[];
  retiredPaths: string[];
}

export interface TimelineSliceLaneState extends TimelineFocusedSlice {
  paths: string[];
}

export interface TimelineFocusedRetirement {
  path: string;
  marker: TimelineEventMarker;
  span?: TimelineIntentSpan;
}

export interface TimelineCrossedRetirement
  extends TimelineFocusedRetirement {
  eventBoundary: number;
}

export type TimelineSelectionTarget =
  | { kind: "event"; eventId: string }
  | { kind: "intent"; path: string; spanId: string };

export interface TimelineSelectionTrace {
  spanIds: Set<string>;
  connectorIds: Set<string>;
  eventIds: Set<string>;
  paths: Set<string>;
  pastPaths: string[];
  futurePaths: string[];
}

export interface TimelineHoverTrace {
  spanIds: Set<string>;
  connectorIds: Set<string>;
  eventIds: Set<string>;
}

export interface TimelineSelectionResolver {
  resolve: (
    target: TimelineSelectionTarget | undefined,
  ) => TimelineSelectionTrace;
  resolveHover: (
    target: TimelineSelectionTarget | undefined,
  ) => TimelineHoverTrace;
}

export const TIMELINE_TOP_PADDING = 30;
export const TIMELINE_LANE_GAP = 16;
export const TIMELINE_BOTTOM_PADDING = 26;
export const TIMELINE_HORIZONTAL_PADDING = 56;
export const TIMELINE_COLUMN_WIDTH = 150;
export const TIMELINE_JUNCTION_GAP = 28;

export interface TimelineLaneHitRegion {
  y: number;
  height: number;
}

export function timelineLaneHitRegion(lane: number): TimelineLaneHitRegion {
  return {
    y:
      TIMELINE_TOP_PADDING +
      lane * TIMELINE_LANE_GAP -
      TIMELINE_LANE_GAP / 2,
    height: TIMELINE_LANE_GAP,
  };
}

const TIMELINE_MIN_CANVAS_WIDTH = 800;
const TIMELINE_TRAILING_PADDING = 24;
export const TIMELINE_ENTRY_RAIL_DEFAULT_WIDTH = 188;
const TIMELINE_ENTRY_RAIL_RESIZE_MIN_WIDTH = 132;
const TIMELINE_ENTRY_RAIL_RESIZE_MAX_WIDTH = 520;
const TIMELINE_ENTRY_RAIL_MIN_CANVAS_VIEWPORT = 260;

export function timelineCanvasWidth(
  columnCount: number,
  presentLabelWidth: number,
): number {
  const presentColumn = Math.max(1, columnCount - 1) * TIMELINE_COLUMN_WIDTH;
  return Math.max(
    TIMELINE_MIN_CANVAS_WIDTH,
    TIMELINE_HORIZONTAL_PADDING +
      presentColumn +
      Math.max(0, presentLabelWidth) +
      TIMELINE_TRAILING_PADDING,
  );
}

export function timelineCanvasHeight(laneCount: number): number {
  return Math.max(
    340,
    TIMELINE_TOP_PADDING +
      Math.max(0, laneCount - 1) * TIMELINE_LANE_GAP +
      TIMELINE_BOTTOM_PADDING,
  );
}

export function resizeTimelineEntryRail(
  startWidth: number,
  horizontalMovement: number,
  availableWidth: number,
): number {
  const maximumWidth = Math.max(
    TIMELINE_ENTRY_RAIL_RESIZE_MIN_WIDTH,
    Math.min(
      Math.max(TIMELINE_ENTRY_RAIL_RESIZE_MAX_WIDTH, startWidth),
      Math.max(0, availableWidth) - TIMELINE_ENTRY_RAIL_MIN_CANVAS_VIEWPORT,
    ),
  );
  return Math.round(
    Math.min(
      maximumWidth,
      Math.max(
        TIMELINE_ENTRY_RAIL_RESIZE_MIN_WIDTH,
        Math.max(0, startWidth) - horizontalMovement,
      ),
    ),
  );
}

interface TimelineLaneContext {
  event: EvolveEvent;
  openBefore: string[];
  openAfter: string[];
  participants: Set<string>;
}

interface TimelineLaneScore {
  overlaps: number;
  displacement: number;
}

function timelineLaneContexts(events: EvolveEvent[]): TimelineLaneContext[] {
  const open = new Set<string>();
  return events.map((event) => {
    const openBefore = [...open];
    for (const path of event.predecessors) open.delete(path);
    for (const path of event.successors) open.add(path);
    return {
      event,
      openBefore,
      openAfter: [...open],
      participants: new Set([
        ...event.predecessors,
        ...event.successors,
      ]),
    };
  });
}

function timelineJunctionLane(
  event: EvolveEvent,
  laneByPath: ReadonlyMap<string, number>,
): number {
  const participantLanes = [
    ...event.predecessors,
    ...event.successors,
  ].flatMap((path) => {
    const lane = laneByPath.get(path);
    return lane === undefined ? [] : [lane];
  });
  return participantLanes.length
    ? participantLanes.reduce((sum, lane) => sum + lane, 0) /
        participantLanes.length
    : 0;
}

function upperBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function connectorOverlapCount(
  connectorPaths: readonly string[],
  activePaths: readonly string[],
  participants: ReadonlySet<string>,
  laneByPath: ReadonlyMap<string, number>,
  junctionLane: number,
): number {
  const blockerLanes = activePaths
    .flatMap((path) => {
      if (participants.has(path)) return [];
      const lane = laneByPath.get(path);
      return lane === undefined ? [] : [lane];
    })
    .sort((left, right) => left - right);

  return connectorPaths.reduce((count, path) => {
    const lane = laneByPath.get(path);
    if (lane === undefined || lane === junctionLane) return count;
    const lower = Math.min(lane, junctionLane);
    const upper = Math.max(lane, junctionLane);
    return count + upperBound(blockerLanes, upper) - upperBound(blockerLanes, lower);
  }, 0);
}

function timelineBranchOverlapCount(
  contexts: readonly TimelineLaneContext[],
  laneByPath: ReadonlyMap<string, number>,
): number {
  return contexts.reduce((count, context) => {
    const junctionLane = timelineJunctionLane(context.event, laneByPath);
    return (
      count +
      connectorOverlapCount(
        context.event.predecessors,
        context.openBefore,
        context.participants,
        laneByPath,
        junctionLane,
      ) +
      connectorOverlapCount(
        context.event.successors,
        context.openAfter,
        context.participants,
        laneByPath,
        junctionLane,
      )
    );
  }, 0);
}

export function countTimelineBranchOverlaps(
  events: EvolveEvent[],
  paths: string[],
): number {
  const laneByPath = new Map(paths.map((path, lane) => [path, lane]));
  return timelineBranchOverlapCount(timelineLaneContexts(events), laneByPath);
}

function timelineLaneScore(
  order: readonly string[],
  contexts: readonly TimelineLaneContext[],
  discoveryLaneByPath: ReadonlyMap<string, number>,
): TimelineLaneScore {
  const laneByPath = new Map(order.map((path, lane) => [path, lane]));
  const displacement = order.reduce(
    (sum, path, lane) =>
      sum + Math.abs(lane - (discoveryLaneByPath.get(path) ?? lane)),
    0,
  );
  return {
    overlaps: timelineBranchOverlapCount(contexts, laneByPath),
    displacement,
  };
}

function compareTimelineLaneScores(
  left: TimelineLaneScore,
  right: TimelineLaneScore,
): number {
  if (left.overlaps !== right.overlaps) return left.overlaps - right.overlaps;
  if (left.displacement !== right.displacement) {
    return left.displacement - right.displacement;
  }
  return 0;
}

function improveTimelineLaneOrder(
  seed: readonly string[],
  contexts: readonly TimelineLaneContext[],
  discoveryLaneByPath: ReadonlyMap<string, number>,
): { order: string[]; score: TimelineLaneScore } {
  let order = [...seed];
  let score = timelineLaneScore(order, contexts, discoveryLaneByPath);
  let unchangedSweeps = 0;
  const sweepCount = Math.min(12, Math.max(2, order.length));

  for (let sweep = 0; sweep < sweepCount; sweep += 1) {
    let changed = false;
    const forward = sweep % 2 === 0;
    for (
      let index = forward ? 0 : order.length - 2;
      forward ? index < order.length - 1 : index >= 0;
      index += forward ? 1 : -1
    ) {
      const candidate = [...order];
      [candidate[index], candidate[index + 1]] = [
        candidate[index + 1],
        candidate[index],
      ];
      const candidateScore = timelineLaneScore(
        candidate,
        contexts,
        discoveryLaneByPath,
      );
      if (compareTimelineLaneScores(candidateScore, score) < 0) {
        order = candidate;
        score = candidateScore;
        changed = true;
      }
    }
    unchangedSweeps = changed ? 0 : unchangedSweeps + 1;
    if (unchangedSweeps >= 2) break;
  }

  return { order, score };
}

function optimizedTimelineLaneOrder(
  events: EvolveEvent[],
  discoveredPaths: string[],
): string[] {
  if (discoveredPaths.length < 3) return discoveredPaths;
  const contexts = timelineLaneContexts(events);
  const discoveryLaneByPath = new Map(
    discoveredPaths.map((path, lane) => [path, lane]),
  );
  return improveTimelineLaneOrder(
    discoveredPaths,
    contexts,
    discoveryLaneByPath,
  ).order;
}

export function bundleTimelinePaths(
  paths: readonly string[],
  bundledPaths: readonly string[],
): string[] {
  const pathSet = new Set(paths);
  const seenBundledPaths = new Set<string>();
  const bundle: string[] = [];
  for (const path of bundledPaths) {
    if (!pathSet.has(path) || seenBundledPaths.has(path)) continue;
    seenBundledPaths.add(path);
    bundle.push(path);
  }
  if (bundle.length < 2) return [...paths];

  const bundledSet = new Set(bundle);
  const remaining = paths.filter((path) => !bundledSet.has(path));
  const originalLane = new Map(paths.map((path, lane) => [path, lane]));
  let bestOrder: string[] | undefined;
  let bestDisplacement = Number.POSITIVE_INFINITY;

  for (let insertion = 0; insertion <= remaining.length; insertion += 1) {
    const candidate = [
      ...remaining.slice(0, insertion),
      ...bundle,
      ...remaining.slice(insertion),
    ];
    const displacement = candidate.reduce(
      (sum, path, lane) => sum + Math.abs(lane - (originalLane.get(path) ?? lane)),
      0,
    );
    if (displacement < bestDisplacement) {
      bestOrder = candidate;
      bestDisplacement = displacement;
    }
  }

  return bestOrder ?? [...paths];
}

function timelinePathsMatch(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((path, index) => path === right[index])
  );
}

function timelineEventsSharePresentationNode(
  left: EvolveEvent,
  right: EvolveEvent,
): boolean {
  return (
    timelinePathsMatch(left.predecessors, left.successors) &&
    timelinePathsMatch(left.predecessors, right.predecessors) &&
    timelinePathsMatch(left.successors, right.successors)
  );
}

export interface TimelineProjectedEvent {
  event: EvolveEvent;
  events: EvolveEvent[];
  startEventIndex: number;
  endEventIndex: number;
  foldRange?: TimelineFoldRange;
}

function timelineFoldRangeIsValid(
  range: TimelineFoldRange,
  eventCount: number,
): boolean {
  return (
    Number.isInteger(range.startEventIndex) &&
    Number.isInteger(range.endEventIndex) &&
    range.startEventIndex >= 0 &&
    range.endEventIndex < eventCount &&
    range.startEventIndex < range.endEventIndex
  );
}

export function timelineFoldRangeKey(range: TimelineFoldRange): string {
  return `${range.startEventIndex}:${range.endEventIndex}`;
}

function timelineFoldContains(
  outer: TimelineFoldRange,
  inner: TimelineFoldRange,
): boolean {
  return (
    outer.startEventIndex <= inner.startEventIndex &&
    outer.endEventIndex >= inner.endEventIndex
  );
}

export function timelineFoldRangeBetween(
  first: Pick<TimelineEventMarker, "startEventIndex" | "endEventIndex">,
  second: Pick<TimelineEventMarker, "startEventIndex" | "endEventIndex">,
  eventCount: number,
  protectedEventBoundaries: readonly number[] = [],
  existingRanges: readonly TimelineFoldRange[] = [],
): TimelineFoldRangeResult {
  if (
    first.startEventIndex === second.startEventIndex &&
    first.endEventIndex === second.endEventIndex
  ) {
    return { ok: false, reason: "requires-two-events" };
  }
  const range = {
    startEventIndex: Math.min(
      first.startEventIndex,
      second.startEventIndex,
    ),
    endEventIndex: Math.max(first.endEventIndex, second.endEventIndex),
  };
  if (!timelineFoldRangeIsValid(range, eventCount)) {
    return { ok: false, reason: "requires-two-events" };
  }
  if (
    protectedEventBoundaries.some(
      (boundary) =>
        Number.isInteger(boundary) &&
        boundary > range.startEventIndex &&
        boundary <= range.endEventIndex,
    )
  ) {
    return { ok: false, reason: "crosses-anchor" };
  }
  if (
    existingRanges.some(
      (existing) =>
        range.startEventIndex <= existing.endEventIndex &&
        range.endEventIndex >= existing.startEventIndex &&
        !timelineFoldContains(range, existing) &&
        !timelineFoldContains(existing, range),
    )
  ) {
    return { ok: false, reason: "overlaps-fold" };
  }
  return { ok: true, range };
}

function visibleTimelineFoldRanges(
  ranges: readonly TimelineFoldRange[],
  eventCount: number,
  protectedEventBoundaries: readonly number[],
): TimelineFoldRange[] {
  const protectedBoundaries = new Set(
    protectedEventBoundaries.filter(
      (boundary) =>
        Number.isInteger(boundary) && boundary > 0 && boundary < eventCount,
    ),
  );
  const normalized: TimelineFoldRange[] = [];
  for (const range of [...ranges].sort(
    (left, right) =>
      left.startEventIndex - right.startEventIndex ||
      right.endEventIndex - left.endEventIndex,
  )) {
    // Project only the outermost folds. Inner folds remain in preferences and
    // become visible again when their enclosing fold is removed.
    if (
      !timelineFoldRangeIsValid(range, eventCount) ||
      [...protectedBoundaries].some(
        (boundary) =>
          boundary > range.startEventIndex &&
          boundary <= range.endEventIndex,
      ) ||
      normalized.some(
        (existing) => range.startEventIndex <= existing.endEventIndex,
      )
    ) {
      continue;
    }
    normalized.push({ ...range });
  }
  return normalized;
}

function applyTimelineEvent(
  openPaths: Set<string>,
  event: EvolveEvent,
): void {
  for (const path of event.predecessors) openPaths.delete(path);
  for (const path of event.successors) openPaths.add(path);
}

function projectTimelineEvents(
  events: EvolveEvent[],
  foldRanges: readonly TimelineFoldRange[],
): TimelineProjectedEvent[] {
  const rangeByStart = new Map(
    foldRanges.map((range) => [range.startEventIndex, range]),
  );
  const projected: TimelineProjectedEvent[] = [];
  const openPaths = new Set<string>();

  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const range = rangeByStart.get(eventIndex);
    if (!range) {
      const event = events[eventIndex];
      projected.push({
        event,
        events: [event],
        startEventIndex: eventIndex,
        endEventIndex: eventIndex,
      });
      applyTimelineEvent(openPaths, event);
      continue;
    }

    const predecessors = [...openPaths];
    const foldedEvents = events.slice(
      range.startEventIndex,
      range.endEventIndex + 1,
    );
    for (const event of foldedEvents) applyTimelineEvent(openPaths, event);
    projected.push({
      event: {
        name: `folded-events-${range.startEventIndex + 1}-${
          range.endEventIndex + 1
        }`,
        predecessors,
        successors: [...openPaths],
      },
      events: foldedEvents,
      startEventIndex: range.startEventIndex,
      endEventIndex: range.endEventIndex,
      foldRange: range,
    });
    eventIndex = range.endEventIndex;
  }

  return projected;
}

function groupTimelineEvents(
  events: TimelineProjectedEvent[],
  protectedEventBoundaries: readonly number[],
  eventCount: number,
): TimelineProjectedEvent[] {
  const protectedBoundaries = new Set(
    protectedEventBoundaries.filter(
      (boundary) =>
        Number.isInteger(boundary) && boundary > 0 && boundary < eventCount,
    ),
  );
  const groups: TimelineProjectedEvent[] = [];

  events.forEach((projectedEvent) => {
    const previous = groups[groups.length - 1];
    if (
      previous &&
      !previous.foldRange &&
      !projectedEvent.foldRange &&
      !protectedBoundaries.has(projectedEvent.startEventIndex) &&
      timelineEventsSharePresentationNode(
        previous.event,
        projectedEvent.event,
      )
    ) {
      previous.events.push(...projectedEvent.events);
      previous.endEventIndex = projectedEvent.endEventIndex;
      return;
    }
    groups.push({
      ...projectedEvent,
      events: [...projectedEvent.events],
      ...(projectedEvent.foldRange
        ? { foldRange: { ...projectedEvent.foldRange } }
        : {}),
    });
  });

  return groups;
}

export function timelineEventMarkerLabel(
  marker: Pick<TimelineEventMarker, "startEventIndex" | "endEventIndex">,
): string {
  const start = `E${marker.startEventIndex + 1}`;
  return marker.startEventIndex === marker.endEventIndex
    ? start
    : `${start}\u2013E${marker.endEventIndex + 1}`;
}

export interface TimelineEventLogEntry {
  event: EvolveEvent;
  eventNumber: number;
}

export function timelineEventLogEntries(
  marker: Pick<TimelineEventMarker, "events" | "startEventIndex">,
): TimelineEventLogEntry[] {
  return marker.events.map((event, offset) => ({
    event,
    eventNumber: marker.startEventIndex + offset + 1,
  }));
}

export function timelineSliceLaneState(
  events: EvolveEvent[],
  paths: readonly string[],
  requestedEventBoundary: number,
): TimelineSliceLaneState {
  const eventBoundary = Number.isFinite(requestedEventBoundary)
    ? Math.max(0, Math.min(events.length, Math.trunc(requestedEventBoundary)))
    : events.length;
  const open = new Set<string>();
  const seen = new Set<string>();
  let retiredPaths: string[] = [];

  for (let eventIndex = 0; eventIndex < eventBoundary; eventIndex += 1) {
    const event = events[eventIndex];
    const successors = new Set(event.successors);
    if (eventIndex === eventBoundary - 1) {
      retiredPaths = event.predecessors.filter(
        (path) => !successors.has(path),
      );
    }
    for (const path of event.predecessors) {
      seen.add(path);
      open.delete(path);
    }
    for (const path of event.successors) {
      seen.add(path);
      open.add(path);
    }
  }

  const pathSet = new Set(paths);
  retiredPaths = retiredPaths.filter((path) => pathSet.has(path));
  const retiredSet = new Set(retiredPaths);
  const openPaths: string[] = [];
  const futurePaths: string[] = [];
  const inactivePaths: string[] = [];

  for (const path of paths) {
    if (open.has(path)) openPaths.push(path);
    else if (retiredSet.has(path)) continue;
    else if (seen.has(path)) inactivePaths.push(path);
    else futurePaths.push(path);
  }

  return {
    eventBoundary,
    openPaths,
    retiredPaths,
    paths: [
      ...openPaths,
      ...futurePaths,
      ...inactivePaths,
      ...retiredPaths,
    ],
  };
}

function timelineOpenPathOrders(
  events: readonly EvolveEvent[],
  baselinePaths: readonly string[],
): string[][] {
  const open = new Set<string>();
  const orders: string[][] = [[]];
  for (const event of events) {
    applyTimelineEvent(open, event);
    orders.push(baselinePaths.filter((path) => open.has(path)));
  }
  return orders;
}

function timelineActiveTrackAssignment(
  paths: readonly string[],
  previousTracks: ReadonlyMap<string, number>,
): Map<string, number> {
  const pathSet = new Set(paths);
  const tracks = new Map<string, number>();
  const usedTracks = new Set<number>();

  for (const [path, track] of previousTracks) {
    if (!pathSet.has(path)) continue;
    tracks.set(path, track);
    usedTracks.add(track);
  }

  // A track is occupied only by a lifeline that is open at this boundary.
  // Once a path retires, later branches may reuse its first available track;
  // historical path order must not reserve otherwise empty canvas rows.
  let firstAvailableTrack = 0;
  for (const path of paths) {
    if (tracks.has(path)) continue;
    while (usedTracks.has(firstAvailableTrack)) firstAvailableTrack += 1;
    tracks.set(path, firstAvailableTrack);
    usedTracks.add(firstAvailableTrack);
  }

  return tracks;
}

function buildTimelineTrackSchedule(
  events: readonly EvolveEvent[],
  baselinePaths: readonly string[],
): TimelineTrackSchedule {
  const pathOrders = timelineOpenPathOrders(events, baselinePaths);
  const boundaryTracks = Array.from(
    { length: pathOrders.length },
    () => new Map<string, number>(),
  );

  for (let boundary = 1; boundary < boundaryTracks.length; boundary += 1) {
    boundaryTracks[boundary] = timelineActiveTrackAssignment(
      pathOrders[boundary],
      boundaryTracks[boundary - 1],
    );
  }

  let highestTrack = -1;
  for (const tracks of boundaryTracks) {
    for (const track of tracks.values()) {
      highestTrack = Math.max(highestTrack, track);
    }
  }
  return {
    boundaryTracks,
    trackCount: highestTrack + 1,
  };
}

export function buildTimelinePresentationTopology(
  events: EvolveEvent[],
  bundledPaths: readonly string[] = [],
  protectedEventBoundaries: readonly number[] = [],
  foldRanges: readonly TimelineFoldRange[] = [],
): TimelinePresentationTopology {
  const visibleFoldRanges = visibleTimelineFoldRanges(
    foldRanges,
    events.length,
    protectedEventBoundaries,
  );
  const projectedEvents = projectTimelineEvents(events, visibleFoldRanges);
  const projectedEventValues = projectedEvents.map(({ event }) => event);
  const discoveredPaths: string[] = [];
  const seenPaths = new Set<string>();
  for (const event of projectedEventValues) {
    for (const path of [...event.predecessors, ...event.successors]) {
      if (!seenPaths.has(path)) {
        seenPaths.add(path);
        discoveredPaths.push(path);
      }
    }
  }
  const baselinePaths = bundleTimelinePaths(
    optimizedTimelineLaneOrder(projectedEventValues, discoveredPaths),
    bundledPaths,
  );
  const eventGroups = groupTimelineEvents(
    projectedEvents,
    protectedEventBoundaries,
    events.length,
  );
  const trackSchedule = buildTimelineTrackSchedule(
    eventGroups.map((group) => group.event),
    baselinePaths,
  );

  return {
    eventCount: events.length,
    visibleFoldRanges,
    projectedEvents,
    projectedEventValues,
    baselinePaths,
    eventGroups,
    trackSchedule,
    focusBoundaryStops: eventGroups.map((group, column) => ({
      column,
      eventBoundary: group.endEventIndex + 1,
    })),
  };
}

export function buildTimelinePresentationFromTopology(
  topology: TimelinePresentationTopology,
  focusedEventBoundary?: number,
): TimelinePresentation {
  const {
    eventCount,
    visibleFoldRanges,
    projectedEvents,
    projectedEventValues,
    baselinePaths,
    eventGroups,
    trackSchedule,
  } = topology;
  const requestedFocusedBoundary =
    focusedEventBoundary === undefined
      ? undefined
      : Number.isFinite(focusedEventBoundary)
        ? Math.max(
            0,
            Math.min(eventCount, Math.trunc(focusedEventBoundary)),
          )
        : eventCount;
  const effectiveFocusedBoundary =
    requestedFocusedBoundary === undefined
      ? undefined
      : (visibleFoldRanges.find(
          (range) =>
            requestedFocusedBoundary > range.startEventIndex &&
            requestedFocusedBoundary <= range.endEventIndex,
        )?.endEventIndex ??
          requestedFocusedBoundary - 1) + 1;
  const projectedFocusedBoundary =
    effectiveFocusedBoundary === undefined
      ? undefined
      : projectedEvents.filter(
          (event) => event.endEventIndex < effectiveFocusedBoundary,
        ).length;
  const focusedSliceState =
    projectedFocusedBoundary === undefined
      ? undefined
      : timelineSliceLaneState(
          projectedEventValues,
          baselinePaths,
          projectedFocusedBoundary,
        );
  const paths = focusedSliceState?.paths ?? baselinePaths;
  const layoutFocusedBoundary =
    effectiveFocusedBoundary === undefined
      ? eventGroups.length
      : eventGroups.filter(
          (group) => group.endEventIndex < effectiveFocusedBoundary,
        ).length;
  const focusedTracks = trackSchedule.boundaryTracks[layoutFocusedBoundary];
  const orderedTracks: number[] = [];
  const seenTracks = new Set<number>();
  for (const path of focusedSliceState?.openPaths ?? baselinePaths) {
    const track = focusedTracks.get(path);
    if (track === undefined || seenTracks.has(track)) continue;
    seenTracks.add(track);
    orderedTracks.push(track);
  }
  for (let track = 0; track < trackSchedule.trackCount; track += 1) {
    if (seenTracks.has(track)) continue;
    orderedTracks.push(track);
  }
  const laneByTrack = new Map(
    orderedTracks.map((track, lane) => [track, lane]),
  );
  const laneAtBoundary = (boundary: number, path: string) => {
    const track = trackSchedule.boundaryTracks[boundary].get(path);
    return track === undefined ? undefined : laneByTrack.get(track);
  };
  const spans: TimelineIntentSpan[] = [];
  const activeSpanByPath = new Map<string, TimelineIntentSpan>();
  const connectors: TimelineIntentConnector[] = [];
  const markers: TimelineEventMarker[] = [];

  eventGroups.forEach((group, column) => {
    const event = group.event;
    const eventId = group.foldRange
      ? `fold:${timelineFoldRangeKey(group.foldRange)}`
      : `${group.startEventIndex}:${event.name}`;
    const participantLanes = [
      ...event.predecessors.map(
        (path) =>
          laneAtBoundary(column, path) ??
          laneAtBoundary(column + 1, path) ??
          0,
      ),
      ...event.successors.map(
        (path) =>
          laneAtBoundary(column + 1, path) ??
          laneAtBoundary(column, path) ??
          0,
      ),
    ];
    const junctionLane = participantLanes.length
      ? participantLanes.reduce((sum, lane) => sum + lane, 0) /
        participantLanes.length
      : 0;
    markers.push({
      id: eventId,
      column,
      junctionLane,
      event,
      events: group.events,
      startEventIndex: group.startEventIndex,
      endEventIndex: group.endEventIndex,
      ...(group.foldRange ? { foldRange: group.foldRange } : {}),
    });

    event.predecessors.forEach((path, index) => {
      connectors.push({
        id: `${eventId}:predecessor:${index}:${path}`,
        eventId,
        column,
        path,
        spanId: activeSpanByPath.get(path)?.id,
        lane:
          laneAtBoundary(column, path) ??
          laneAtBoundary(column + 1, path) ??
          0,
        junctionLane,
        side: "predecessor",
      });
    });

    for (const path of event.predecessors) activeSpanByPath.delete(path);
    const nextColumn = column + 1;
    event.successors.forEach((path, index) => {
      const lane =
        laneAtBoundary(column + 1, path) ??
        laneAtBoundary(column, path) ??
        0;
      const span = {
        id: `${column}:${path}`,
        path,
        startColumn: column,
        endColumn: nextColumn,
        lane,
      };
      spans.push(span);
      activeSpanByPath.set(path, span);
      connectors.push({
        id: `${eventId}:successor:${index}:${path}`,
        eventId,
        column,
        path,
        spanId: span.id,
        lane,
        junctionLane,
        side: "successor",
      });
    });
    for (const span of activeSpanByPath.values()) {
      span.endColumn = nextColumn;
    }
  });

  return {
    events: markers,
    spans,
    connectors,
    paths,
    columnCount: Math.max(1, eventGroups.length + 1),
    laneCount: trackSchedule.trackCount,
    ...(focusedSliceState
      ? {
          focusedSlice: {
            eventBoundary:
              effectiveFocusedBoundary ?? focusedSliceState.eventBoundary,
            openPaths: focusedSliceState.openPaths,
            retiredPaths: focusedSliceState.retiredPaths,
          },
        }
      : {}),
  };
}

export function buildTimelinePresentation(
  events: EvolveEvent[],
  bundledPaths: readonly string[] = [],
  protectedEventBoundaries: readonly number[] = [],
  focusedEventBoundary?: number,
  foldRanges: readonly TimelineFoldRange[] = [],
): TimelinePresentation {
  return buildTimelinePresentationFromTopology(
    buildTimelinePresentationTopology(
      events,
      bundledPaths,
      protectedEventBoundaries,
      foldRanges,
    ),
    focusedEventBoundary,
  );
}

function timelineMarkerAtBoundary(
  presentation: TimelinePresentation,
  eventBoundary: number,
): TimelineEventMarker | undefined {
  if (eventBoundary <= 0) return undefined;
  const eventIndex = eventBoundary - 1;
  return presentation.events.find(
    (marker) =>
      marker.startEventIndex <= eventIndex && marker.endEventIndex >= eventIndex,
  );
}

export function timelineIntentSpanAtBoundary(
  presentation: TimelinePresentation,
  path: string,
  eventBoundary: number,
): TimelineIntentSpan | undefined {
  const marker = timelineMarkerAtBoundary(presentation, eventBoundary);
  if (!marker) return undefined;

  let matchedSpan: TimelineIntentSpan | undefined;
  for (const span of presentation.spans) {
    if (
      span.path !== path ||
      span.startColumn > marker.column ||
      span.endColumn <= marker.column
    ) {
      continue;
    }
    if (!matchedSpan || span.startColumn > matchedSpan.startColumn) {
      matchedSpan = span;
    }
  }
  return matchedSpan;
}

export function timelineFocusedIntentSpans(
  presentation: TimelinePresentation,
): TimelineIntentSpan[] {
  const focusedSlice = presentation.focusedSlice;
  if (!focusedSlice || focusedSlice.openPaths.length === 0) return [];
  const marker = timelineMarkerAtBoundary(
    presentation,
    focusedSlice.eventBoundary,
  );
  if (!marker) return [];

  const openPathSet = new Set(focusedSlice.openPaths);
  const spanByPath = new Map<string, TimelineIntentSpan>();
  for (const span of presentation.spans) {
    if (
      !openPathSet.has(span.path) ||
      span.startColumn > marker.column ||
      span.endColumn <= marker.column
    ) {
      continue;
    }
    const current = spanByPath.get(span.path);
    if (!current || span.startColumn > current.startColumn) {
      spanByPath.set(span.path, span);
    }
  }
  return focusedSlice.openPaths.flatMap((path) => {
    const span = spanByPath.get(path);
    return span ? [span] : [];
  });
}

export function timelineFocusedRetirements(
  presentation: TimelinePresentation,
): TimelineFocusedRetirement[] {
  const focusedSlice = presentation.focusedSlice;
  if (!focusedSlice || focusedSlice.retiredPaths.length === 0) return [];
  const marker = timelineMarkerAtBoundary(
    presentation,
    focusedSlice.eventBoundary,
  );
  if (!marker) return [];

  const spanById = new Map(
    presentation.spans.map((span) => [span.id, span]),
  );
  const retiredSet = new Set(focusedSlice.retiredPaths);
  const spanByPath = new Map<string, TimelineIntentSpan>();
  for (const connector of presentation.connectors) {
    if (
      connector.eventId !== marker.id ||
      connector.side !== "predecessor" ||
      !retiredSet.has(connector.path) ||
      !connector.spanId
    ) {
      continue;
    }
    const span = spanById.get(connector.spanId);
    if (span) spanByPath.set(connector.path, span);
  }

  return focusedSlice.retiredPaths.map((path) => ({
    path,
    marker,
    span: spanByPath.get(path),
  }));
}

export function timelineRetirementsCrossed(
  presentation: TimelinePresentation,
  previousEventBoundary: number,
  nextEventBoundary: number,
): TimelineCrossedRetirement[] {
  const previousBoundary = Number.isFinite(previousEventBoundary)
    ? Math.max(0, Math.trunc(previousEventBoundary))
    : 0;
  const nextBoundary = Number.isFinite(nextEventBoundary)
    ? Math.max(0, Math.trunc(nextEventBoundary))
    : 0;
  if (nextBoundary <= previousBoundary) return [];

  const spanById = new Map(
    presentation.spans.map((span) => [span.id, span]),
  );
  const predecessorSpanByMarkerAndPath = new Map<string, TimelineIntentSpan>();
  for (const connector of presentation.connectors) {
    if (connector.side !== "predecessor" || !connector.spanId) continue;
    const span = spanById.get(connector.spanId);
    if (span) {
      predecessorSpanByMarkerAndPath.set(
        `${connector.eventId}\u0000${connector.path}`,
        span,
      );
    }
  }

  const retirements: TimelineCrossedRetirement[] = [];
  const seenPaths = new Set<string>();
  for (const marker of presentation.events) {
    if (marker.foldRange) {
      const boundary = marker.endEventIndex + 1;
      if (boundary <= previousBoundary || boundary > nextBoundary) continue;
      const successorSet = new Set(marker.event.successors);
      for (const path of marker.event.predecessors) {
        if (successorSet.has(path) || seenPaths.has(path)) continue;
        seenPaths.add(path);
        retirements.push({
          path,
          marker,
          eventBoundary: boundary,
          span: predecessorSpanByMarkerAndPath.get(
            `${marker.id}\u0000${path}`,
          ),
        });
      }
      continue;
    }
    const firstEventIndex = Math.max(
      marker.startEventIndex,
      previousBoundary,
    );
    const finalEventIndex = Math.min(
      marker.endEventIndex,
      nextBoundary - 1,
    );
    for (
      let eventIndex = firstEventIndex;
      eventIndex <= finalEventIndex;
      eventIndex += 1
    ) {
      const event = marker.events[eventIndex - marker.startEventIndex];
      if (!event) continue;
      const successorSet = new Set(event.successors);
      for (const path of event.predecessors) {
        if (successorSet.has(path) || seenPaths.has(path)) continue;
        seenPaths.add(path);
        retirements.push({
          path,
          marker,
          eventBoundary: eventIndex + 1,
          span: predecessorSpanByMarkerAndPath.get(
            `${marker.id}\u0000${path}`,
          ),
        });
      }
    }
  }
  return retirements.sort(
    (left, right) =>
      left.eventBoundary - right.eventBoundary ||
      (left.span?.lane ?? Number.POSITIVE_INFINITY) -
        (right.span?.lane ?? Number.POSITIVE_INFINITY) ||
      left.path.localeCompare(right.path),
  );
}

function emptyTimelineSelectionTrace(): TimelineSelectionTrace {
  return {
    spanIds: new Set(),
    connectorIds: new Set(),
    eventIds: new Set(),
    paths: new Set(),
    pastPaths: [],
    futurePaths: [],
  };
}

function emptyTimelineHoverTrace(): TimelineHoverTrace {
  return {
    spanIds: new Set(),
    connectorIds: new Set(),
    eventIds: new Set(),
  };
}

export function buildTimelineSelectionTrace(
  presentation: TimelinePresentation,
  target: TimelineSelectionTarget | undefined,
): TimelineSelectionTrace {
  return createTimelineSelectionResolver(presentation).resolve(target);
}

export function createTimelineSelectionResolver(
  presentation: TimelinePresentation,
): TimelineSelectionResolver {
  const eventById = new Map(
    presentation.events.map((marker) => [marker.id, marker]),
  );
  const markerByColumn = new Map(
    presentation.events.map((marker) => [marker.column, marker]),
  );
  const spanById = new Map(
    presentation.spans.map((span) => [span.id, span]),
  );
  const spanIdsByPath = new Map<string, string[]>();
  for (const span of presentation.spans) {
    const ids = spanIdsByPath.get(span.path);
    if (ids) ids.push(span.id);
    else spanIdsByPath.set(span.path, [span.id]);
  }
  const connectorIdsByPath = new Map<string, string[]>();
  const connectorsByEvent = new Map<
    string,
    {
      predecessors: TimelineIntentConnector[];
      successors: TimelineIntentConnector[];
    }
  >();
  const predecessorBySpanId = new Map<string, TimelineIntentConnector>();
  const successorBySpanId = new Map<string, TimelineIntentConnector>();
  for (const connector of presentation.connectors) {
    const pathIds = connectorIdsByPath.get(connector.path);
    if (pathIds) pathIds.push(connector.id);
    else connectorIdsByPath.set(connector.path, [connector.id]);

    const eventConnectors = connectorsByEvent.get(connector.eventId) ?? {
      predecessors: [],
      successors: [],
    };
    eventConnectors[
      connector.side === "predecessor" ? "predecessors" : "successors"
    ].push(connector);
    connectorsByEvent.set(connector.eventId, eventConnectors);
    if (!connector.spanId) continue;
    if (connector.side === "predecessor") {
      predecessorBySpanId.set(connector.spanId, connector);
    } else {
      successorBySpanId.set(connector.spanId, connector);
    }
  }
  const traceByTarget = new Map<string, TimelineSelectionTrace>();
  const hoverTraceByTarget = new Map<string, TimelineHoverTrace>();

  const resolveEvent = (eventId: string): TimelineSelectionTrace => {
    const cacheKey = `event:${eventId}`;
    const cached = traceByTarget.get(cacheKey);
    if (cached) return cached;
    const trace = emptyTimelineSelectionTrace();
    const marker = eventById.get(eventId);
    if (!marker) return trace;
    if (marker.foldRange) {
      trace.eventIds.add(marker.id);
      traceByTarget.set(cacheKey, trace);
      return trace;
    }
    const paths = new Set([
      ...marker.event.predecessors,
      ...marker.event.successors,
    ]);
    trace.eventIds.add(marker.id);
    for (const path of paths) {
      trace.paths.add(path);
      for (const spanId of spanIdsByPath.get(path) ?? []) {
        trace.spanIds.add(spanId);
      }
      for (const connectorId of connectorIdsByPath.get(path) ?? []) {
        trace.connectorIds.add(connectorId);
      }
    }
    trace.pastPaths = [...marker.event.predecessors];
    trace.futurePaths = [...marker.event.successors];
    traceByTarget.set(cacheKey, trace);
    return trace;
  };

  const resolveIntent = (
    path: string,
    spanId: string,
  ): TimelineSelectionTrace => {
    const cacheKey = `intent:${spanId}\u0000${path}`;
    const cached = traceByTarget.get(cacheKey);
    if (cached) return cached;
    const trace = emptyTimelineSelectionTrace();
    const selectedSpan = spanById.get(spanId);
    if (!selectedSpan || selectedSpan.path !== path) return trace;

    const pastPathSet = new Set<string>();
    const futurePathSet = new Set<string>();
    const pastVisited = new Set<string>();
    const futureVisited = new Set<string>();

    const visitPast = (span: TimelineIntentSpan) => {
      if (pastVisited.has(span.id)) return;
      pastVisited.add(span.id);
      trace.spanIds.add(span.id);
      trace.paths.add(span.path);

      const marker = markerByColumn.get(span.startColumn);
      if (!marker) return;
      const eventConnectors = connectorsByEvent.get(marker.id);
      const successor = successorBySpanId.get(span.id);
      if (!successor) return;
      trace.connectorIds.add(successor.id);
      trace.eventIds.add(marker.id);
      if (marker.foldRange) return;

      for (const predecessor of eventConnectors?.predecessors ?? []) {
        trace.connectorIds.add(predecessor.id);
        trace.paths.add(predecessor.path);
        pastPathSet.add(predecessor.path);
        const previousSpan = predecessor.spanId
          ? spanById.get(predecessor.spanId)
          : undefined;
        if (previousSpan) visitPast(previousSpan);
      }
    };

    const visitFuture = (span: TimelineIntentSpan) => {
      if (futureVisited.has(span.id)) return;
      futureVisited.add(span.id);
      trace.spanIds.add(span.id);
      trace.paths.add(span.path);

      const marker = markerByColumn.get(span.endColumn);
      if (!marker) return;
      const eventConnectors = connectorsByEvent.get(marker.id);
      const predecessor = predecessorBySpanId.get(span.id);
      if (!predecessor) return;
      trace.connectorIds.add(predecessor.id);
      trace.eventIds.add(marker.id);
      if (marker.foldRange) return;

      for (const successor of eventConnectors?.successors ?? []) {
        trace.connectorIds.add(successor.id);
        trace.paths.add(successor.path);
        futurePathSet.add(successor.path);
        const nextSpan = successor.spanId
          ? spanById.get(successor.spanId)
          : undefined;
        if (nextSpan) visitFuture(nextSpan);
      }
    };

    visitPast(selectedSpan);
    visitFuture(selectedSpan);
    pastPathSet.delete(path);
    futurePathSet.delete(path);
    trace.eventIds = new Set(
      presentation.events
        .filter((marker) => trace.eventIds.has(marker.id))
        .map((marker) => marker.id),
    );
    trace.pastPaths = presentation.paths.filter((candidate) =>
      pastPathSet.has(candidate),
    );
    trace.futurePaths = presentation.paths.filter((candidate) =>
      futurePathSet.has(candidate),
    );
    traceByTarget.set(cacheKey, trace);
    return trace;
  };

  const resolveEventHover = (eventId: string): TimelineHoverTrace => {
    const cacheKey = `event:${eventId}`;
    const cached = hoverTraceByTarget.get(cacheKey);
    if (cached) return cached;
    const trace = emptyTimelineHoverTrace();
    const marker = eventById.get(eventId);
    if (!marker) return trace;
    trace.eventIds.add(marker.id);
    hoverTraceByTarget.set(cacheKey, trace);
    return trace;
  };

  const resolveIntentHover = (
    path: string,
    spanId: string,
  ): TimelineHoverTrace => {
    const cacheKey = `intent:${spanId}\u0000${path}`;
    const cached = hoverTraceByTarget.get(cacheKey);
    if (cached) return cached;
    const trace = emptyTimelineHoverTrace();
    const span = spanById.get(spanId);
    if (!span || span.path !== path) return trace;
    trace.spanIds.add(span.id);
    for (const connector of [
      successorBySpanId.get(span.id),
      predecessorBySpanId.get(span.id),
    ]) {
      if (!connector) continue;
      trace.connectorIds.add(connector.id);
      trace.eventIds.add(connector.eventId);
    }
    hoverTraceByTarget.set(cacheKey, trace);
    return trace;
  };

  return {
    resolve(target) {
      if (!target) return emptyTimelineSelectionTrace();
      return target.kind === "event"
        ? resolveEvent(target.eventId)
        : resolveIntent(target.path, target.spanId);
    },
    resolveHover(target) {
      if (!target) return emptyTimelineHoverTrace();
      return target.kind === "event"
        ? resolveEventHover(target.eventId)
        : resolveIntentHover(target.path, target.spanId);
    },
  };
}

export function timelineIntentConnectorIsActive(
  connector: Pick<TimelineIntentConnector, "id">,
  activeConnectorIds: ReadonlySet<string>,
) {
  return activeConnectorIds.has(connector.id);
}
