import type { EvolveEvent } from "./types.ts";

export interface EventRow { event: EvolveEvent; depth: number; parent?: string }

/** Authored root order and child order, with local summary expansion. */
export function eventRows(events: readonly EvolveEvent[], expanded: ReadonlySet<string>): EventRow[] {
  const byId = new Map(events.map(event => [event.component, event]));
  const parents = new Map<string, string>();
  for (const event of events) for (const child of event.children) parents.set(child, event.component);
  const rows: EventRow[] = [];
  const visited = new Set<string>();
  const stack: EventRow[] = events.filter(event => !parents.has(event.component))
    .map(event => ({event, depth: 0})).reverse();
  while (stack.length) {
    const row = stack.pop()!;
    const id = row.event.component;
    if (visited.has(id)) continue;
    visited.add(id);
    rows.push(row);
    if (!expanded.has(id)) continue;
    for (const child of [...row.event.children].reverse()) {
      const event = byId.get(child);
      if (event) stack.push({event, depth: row.depth + 1, parent: id});
    }
  }
  return rows;
}

export function visibleEventSelection(rows: readonly EventRow[], events: readonly EvolveEvent[], selected?: string): string | undefined {
  const visible = new Set(rows.map(row => row.event.component));
  const parents = new Map<string, string>();
  for (const event of events) for (const child of event.children) parents.set(child, event.component);
  const seen = new Set<string>();
  while (selected && !seen.has(selected)) {
    if (visible.has(selected)) return selected;
    seen.add(selected);
    selected = parents.get(selected);
  }
  return rows[0]?.event.component;
}

export const EVENT_STEP = 150;
export const EVENT_LANE_HEIGHT = 32;
export const EVENT_LEFT = 56;
export const EVENT_TOP = 8;
export const EVENT_CARD_WIDTH = 140;

export interface EventPoint extends EventRow {
  x: number;
  y: number;
  ordinal: number;
  position: number;
  siblings: number;
}

/** Horizontal authored order, with each expanded generation on the next lane. */
export function eventTimelineLayout(rows: readonly EventRow[]) {
  const siblingCounts = new Map<string | undefined, number>();
  const siblingPositions = new Map<string | undefined, number>();
  for (const row of rows) siblingCounts.set(row.parent, (siblingCounts.get(row.parent) ?? 0) + 1);
  const points = rows.map((row, index): EventPoint => {
    const position = (siblingPositions.get(row.parent) ?? 0) + 1;
    siblingPositions.set(row.parent, position);
    return {...row, x: EVENT_LEFT + index * EVENT_STEP,
      y: EVENT_TOP + row.depth * EVENT_LANE_HEIGHT, ordinal: index + 1,
      position, siblings: siblingCounts.get(row.parent)!};
  });
  const byId = new Map(points.map(point => [point.event.component, point]));
  return {points, byId,
    width: Math.max(320, points.length * EVENT_STEP + EVENT_LEFT),
    height: 48 + Math.max(0, ...points.map(point => point.depth)) * EVENT_LANE_HEIGHT};
}

/** Expanded summaries span precisely their visible descendants, including nested groups. */
export function eventGroupRanges<T extends EventPoint>(points: readonly T[]) {
  const ranges = new Map<string, {point: T; start: number; end: number}>();
  const stack: T[] = [];
  const close = (last: T) => {
    const point = stack.pop()!;
    ranges.set(point.event.component, {point, start: point.x - 10, end: last.x - 10 + EVENT_CARD_WIDTH});
  };
  points.forEach((point, index) => {
    while (stack.length && stack.at(-1)!.depth >= point.depth) close(points[index - 1]);
    if (points[index + 1]?.depth > point.depth) stack.push(point);
  });
  while (stack.length) close(points.at(-1)!);
  return ranges;
}

/** The file flow only mounts Event junctions near its horizontal viewport. */
export function visibleEventPoints<T extends EventPoint>(points: readonly T[], left: number, width: number) {
  const start = Math.max(0, Math.floor((left - EVENT_STEP - EVENT_LEFT) / EVENT_STEP));
  const end = Math.min(points.length, Math.ceil((left + width + EVENT_STEP - EVENT_LEFT) / EVENT_STEP) + 1);
  return points.slice(start, end);
}

export const DEFAULT_EVOLVE_INSPECTOR_HEIGHT = 220;
export function normalizeEvolveInspectorHeight(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(120, Math.min(800, Math.round(value))) : DEFAULT_EVOLVE_INSPECTOR_HEIGHT;
}

export function evolveInspectorHeight(value: unknown, availableHeight: number): number {
  return Math.min(normalizeEvolveInspectorHeight(value), Math.max(120, availableHeight - 180));
}

export function timelineCommitPage(count: number, index: number) {
  const start = Math.floor(Math.max(0, Math.min(count - 1, index)) / 32) * 32;
  return { start, end: Math.min(count, start + 32) };
}
