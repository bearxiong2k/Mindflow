import { eventRows, eventTimelineLayout, type EventPoint } from "./eventTimeline.ts";
import { relationshipStyle } from "./graph.ts";
import type { GraphData, Opening } from "./types.ts";

export const FILE_LANE_HEIGHT = 18;
export const FILE_TOP = 32;
const JUNCTION_GAP = 28;

export interface OpeningFileLane {
  component: string;
  path: string;
  name: string;
  managed: boolean;
  current: boolean;
  recorded: boolean;
  lane: number;
  y: number;
  color: string;
  interval?: string;
}

export interface OpeningEventPoint extends EventPoint {
  start: number;
  end: number;
  subtreeEnd: number;
  predecessors: string[];
  successors: string[];
  junctionY?: number;
  incoming: string[];
  outgoing: string[];
}

export interface OpeningLine {
  key: string;
  component: string;
  start: number;
  end: number;
  y: number;
  targetY: number;
  kind: "span" | "predecessor" | "successor" | "current";
  event?: string;
  track: number;
  interval: string;
}

export interface OpeningInterval {
  id: string;
  component: string;
  track: number;
  start: number;
  end: number;
  from?: string;
  to?: string;
}

/** Compose a folded group's boundary effect from its complete authored subtree. */
export function buildOpeningTimeline(graph: GraphData, opening: Opening, expanded: ReadonlySet<string>) {
  const events = graph.events;
  const full = eventRows(events, new Set(events.map(event => event.component)));
  const indices = new Map(full.map((row, index) => [row.event.component, index]));
  const ends = new Map<string, number>();
  const ancestors: typeof full = [];
  full.forEach((row, index) => {
    while (ancestors.length && ancestors.at(-1)!.depth >= row.depth) ends.set(ancestors.pop()!.event.component, index);
    ancestors.push(row);
  });
  for (const row of ancestors) ends.set(row.event.component, full.length);

  const mentioned = new Set<string>();
  const initial = new Set<string>();
  for (const {event} of full) {
    for (const id of event.opening?.predecessors ?? []) { if (!mentioned.has(id)) initial.add(id); mentioned.add(id); }
    for (const id of event.opening?.successors ?? []) mentioned.add(id);
  }
  const visible = eventTimelineLayout(eventRows(events, expanded));
  const open = new Set(initial);
  const points: OpeningEventPoint[] = visible.points.map(point => {
    const start = indices.get(point.event.component)!;
    const end = expanded.has(point.event.component) ? start + 1 : ends.get(point.event.component)!;
    const before = new Map<string, boolean>();
    const touched = new Set<string>();
    const touch = (id: string) => { if (!before.has(id)) before.set(id, open.has(id)); touched.add(id); };
    for (let index = start; index < end; index++) {
      const change = full[index].event.opening;
      for (const id of change?.predecessors ?? []) { touch(id); open.delete(id); }
      for (const id of change?.successors ?? []) { touch(id); open.add(id); }
    }
    return {...point, start, end, subtreeEnd: ends.get(point.event.component)!, incoming: [], outgoing: [],
      predecessors: [...touched].filter(id => before.get(id)),
      successors: [...touched].filter(id => open.has(id))};
  });
  const final = new Set(open);
  const current = new Set(opening.files.map(file => file.component));
  const paths = new Map(graph.documents.map(document => [document.component, document.path]));
  const ids = new Set<string>();
  for (const id of initial) ids.add(id);
  for (const point of points) for (const id of [...point.predecessors, ...point.successors]) ids.add(id);
  for (const id of current) ids.add(id);
  const intervals: OpeningInterval[] = [];
  const intervalById = new Map<string, OpeningInterval>();
  const active = new Map<string, OpeningInterval>();
  let trackCount = 0;
  const createInterval = (component: string, track: number, start: number, from?: string) => {
    const interval = {id: JSON.stringify(from === undefined ? [start === 0 ? "initial" : "present", component] : ["event", from, component]), component, track, start, end: Infinity, from};
    intervals.push(interval);
    intervalById.set(interval.id, interval);
    active.set(component, interval);
    trackCount = Math.max(trackCount, track + 1);
    return interval;
  };
  for (const id of initial) createInterval(id, active.size, 0);
  for (const point of points) {
    const previous = new Map<string, number>();
    for (const id of point.predecessors) {
      const interval = active.get(id)!;
      interval.end = point.x;
      interval.to = point.event.component;
      point.incoming.push(interval.id);
      previous.set(id, interval.track);
      active.delete(id);
    }
    const used = new Set([...active.values()].map(interval => interval.track));
    const allocated = new Map<string, number>();
    // Retain continuing tracks before new branches reuse retired lanes.
    for (const id of point.successors) {
      const track = previous.get(id);
      if (track !== undefined) { allocated.set(id, track); used.add(track); }
    }
    let firstFree = 0;
    for (const id of point.successors) {
      let track = allocated.get(id);
      if (track === undefined) {
        while (used.has(firstFree)) firstFree++;
        track = firstFree;
        used.add(track);
      }
      point.outgoing.push(createInterval(id, track, point.x, point.event.component).id);
    }
  }
  const presentX = Math.max(280, (points.at(-1)?.x ?? 56) + 130);
  const used = new Set([...active.values()].map(interval => interval.track));
  const currentIntervals = new Map<string, OpeningInterval>();
  for (const id of current) {
    let interval = active.get(id);
    if (!interval) {
      let track = 0;
      while (used.has(track)) track++;
      used.add(track);
      interval = createInterval(id, track, presentX - 16);
    }
    currentIntervals.set(id, interval);
  }
  const lastByFile = new Map(intervals.map(interval => [interval.component, interval]));
  const files: OpeningFileLane[] = [...ids].map(id => {
    const path = paths.get(id) ?? graph.historical_components?.[id]?.path ?? id;
    const lane = lastByFile.get(id)?.track ?? 0;
    return {component: id, path, name: path.split("/").at(-1)!, managed: paths.has(id), current: current.has(id),
      recorded: mentioned.has(id), lane, y: FILE_TOP + lane * FILE_LANE_HEIGHT, color: relationshipStyle(`intent:${id}`).color};
  });
  const fileById = new Map(files.map(file => [file.component, file]));
  const byId = new Map(points.map(point => [point.event.component, point]));
  for (const point of points) {
    const tracks = [...point.incoming, ...point.outgoing].map(id => intervalById.get(id)!.track);
    if (tracks.length) point.junctionY = FILE_TOP + tracks.reduce((a, b) => a + b, 0) / tracks.length * FILE_LANE_HEIGHT;
  }
  const lines: OpeningLine[] = [];
  for (const interval of intervals) {
    const {id, component, track, from, to} = interval;
    const y = FILE_TOP + track * FILE_LANE_HEIGHT;
    const start = from ? interval.start + JUNCTION_GAP : interval.start;
    const end = to ? interval.end - JUNCTION_GAP : presentX - 24;
    if (end > start) lines.push({key: `span:${id}`, component, interval: id, track, start, end, y, targetY: y, kind: "span"});
    if (from) lines.push({key: `out:${id}`, component, interval: id, track, start: interval.start, end: start,
      y: byId.get(from)!.junctionY!, targetY: y, kind: "successor", event: from});
    if (to) lines.push({key: `in:${id}`, component, interval: id, track, start: end, end: interval.end,
      y, targetY: byId.get(to)!.junctionY!, kind: "predecessor", event: to});
  }
  for (const [id, interval] of currentIntervals) {
    const y = FILE_TOP + interval.track * FILE_LANE_HEIGHT;
    lines.push({key: `current:${id}`, component: id, interval: interval.id, track: interval.track,
      start: presentX - 16, end: presentX + 8, y, targetY: y, kind: "current"});
  }
  const unrecorded = [...current].some(id => !final.has(id)) || [...final].some(id => !current.has(id));
  return {points, byId, files, fileById, lines, intervals, intervalById, trackCount,
    fullOrder: full.map(row => row.event.component), registryOrder: events.map(event => event.component),
    initial, final, unrecorded, presentX, width: presentX + 38,
    headerHeight: visible.height,
    height: Math.max(160, FILE_TOP + (trackCount + 1) * FILE_LANE_HEIGHT)};
}

export type OpeningTimeline = ReturnType<typeof buildOpeningTimeline>;
type LaneGeometry = Pick<OpeningTimeline, "points" | "byId" | "lines">;
// One alternate lane order per immutable topology. Natural order already has
// geometry; neither scrolling history nor discarded projects accumulate here.
const laneGeometry = new WeakMap<OpeningTimeline, {tracks: number[]; geometry: LaneGeometry}>();

/** Focus only changes lane presentation; it never rebuilds or edits the authored flow. */
export function projectOpeningTimeline(timeline: OpeningTimeline, boundary: number) {
  const focusX = boundary > timeline.points.length ? timeline.presentX
    : boundary > 0 ? timeline.points[boundary - 1].x : 0;
  const active = timeline.intervals.filter(interval => interval.start <= focusX && interval.end > focusX);
  const tracks = [...new Set(active.map(interval => interval.track))];
  const activeTracks = new Set(tracks);
  for (let track = 0; track < timeline.trackCount; track++) if (!activeTracks.has(track)) tracks.push(track);
  const laneByTrack = new Map(tracks.map((track, lane) => [track, lane]));
  const y = (track: number) => FILE_TOP + laneByTrack.get(track)! * FILE_LANE_HEIGHT;
  const cached = laneGeometry.get(timeline);
  let geometry: LaneGeometry;
  if (tracks.every((track, index) => track === index)) geometry = timeline;
  else if (cached && tracks.every((track, index) => track === cached.tracks[index])) geometry = cached.geometry;
  else {
    const points = timeline.points.map(point => {
      const participants = [...point.incoming, ...point.outgoing];
      return {...point, junctionY: participants.length
        ? participants.reduce((sum, id) => sum + y(timeline.intervalById.get(id)!.track), 0) / participants.length : undefined};
    });
    const byId = new Map(points.map(point => [point.event.component, point]));
    const lines = timeline.lines.map(line => ({...line,
      y: line.kind === "successor" ? byId.get(line.event!)!.junctionY! : y(line.track),
      targetY: line.kind === "predecessor" ? byId.get(line.event!)!.junctionY! : y(line.track)}));
    geometry = {points, byId, lines};
    laneGeometry.set(timeline, {tracks, geometry});
  }
  const files = active.map(interval => ({...timeline.fileById.get(interval.component)!,
    lane: laneByTrack.get(interval.track)!, y: y(interval.track), interval: interval.id}));
  return {...timeline, points: geometry.points, byId: geometry.byId, lines: geometry.lines, files};
}

export function openingFocusBoundary(timeline: OpeningTimeline, x: number) {
  if (x >= timeline.presentX - 16) return timeline.points.length + 1;
  let lo = 0, hi = timeline.points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (timeline.points[mid].x <= x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export type OpeningTraceTarget = {kind: "event"; component: string}
  | {kind: "file"; component: string; interval?: string};

export function openingTrace(timeline: OpeningTimeline, target?: OpeningTraceTarget, hover = false) {
  const files = new Set<string>(), events = new Set<string>(), intervals = new Set<string>();
  const add = (id: string) => {
    const interval = timeline.intervalById.get(id);
    if (interval) { intervals.add(id); files.add(interval.component); }
    return interval;
  };
  if (target?.kind === "event") {
    const point = timeline.byId.get(target.component);
    if (point) {
      events.add(target.component);
      for (const id of [...point.incoming, ...point.outgoing]) add(id);
      if (point.event.children.length && point.end === point.start + 1) {
        for (const child of timeline.points) if (child.start > point.start && child.start < point.subtreeEnd) {
          events.add(child.event.component);
          for (const id of [...child.incoming, ...child.outgoing]) add(id);
        }
      }
      if (!hover) for (const interval of timeline.intervals) if (files.has(interval.component)) add(interval.id);
    }
  } else if (target) {
    const candidates = target.interval && timeline.intervalById.has(target.interval) ? [target.interval]
      : timeline.intervals.filter(interval => interval.component === target.component).map(interval => interval.id);
    for (const direction of ["from", "to"] as const) {
      const queue = [...candidates], seen = new Set<string>();
      while (queue.length) {
        const id = queue.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        const interval = add(id), event = interval?.[direction];
        if (!event) continue;
        events.add(event);
        if (hover) continue;
        const point = timeline.byId.get(event)!;
        queue.push(...(direction === "from" ? point.incoming : point.outgoing));
      }
    }
  }
  return {files, events, intervals};
}

export function openingLinePath(line: OpeningLine): string {
  return line.y === line.targetY ? `M ${line.start} ${line.y} H ${line.end}`
    : `M ${line.start} ${line.y} C ${(line.start + line.end) / 2} ${line.y}, ${(line.start + line.end) / 2} ${line.targetY}, ${line.end} ${line.targetY}`;
}

export function visibleOpeningLines(lines: readonly OpeningLine[], left: number, top: number, width: number, height: number) {
  return lines.filter(line => line.end >= left - 40 && line.start <= left + width + 40
    && Math.max(line.y, line.targetY) >= top - FILE_LANE_HEIGHT
    && Math.min(line.y, line.targetY) <= top + height + FILE_LANE_HEIGHT);
}

/** Registry-prefix evidence locates a boundary only when it is also a full reading-order prefix. */
export function openingEvidenceBoundaries(timeline: OpeningTimeline) {
  const indices = new Map(timeline.fullOrder.map((id, index) => [id, index]));
  const xs = new Map(timeline.points.map(point => [point.end, point.x]));
  const components: (string | undefined)[] = [undefined];
  const positions: (number | undefined)[] = [8];
  let maximum = -1;
  timeline.registryOrder.forEach((id, index) => {
    maximum = Math.max(maximum, indices.get(id)!);
    components.push(maximum === index ? timeline.fullOrder[index] : undefined);
    positions.push(maximum === index ? xs.get(index + 1) : undefined);
  });
  return {components, positions};
}
