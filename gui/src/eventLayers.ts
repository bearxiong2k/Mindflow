import { eventGroupRanges, EVENT_CARD_WIDTH, EVENT_STEP, type EventPoint } from "./eventTimeline.ts";
import { eventNavigatorLens, eventLensScrollLeft } from "./eventNavigatorLens.ts";

const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
export const EVENT_LAYER_LEFT = 32;
export const EVENT_LAYER_RIGHT = 44;
export const EVENT_LAYERS_HEIGHT = 160;

/** Interpolate an ordered axis, including empty intervals between branches. */
function interpolate(from: readonly number[], to: readonly number[], value: number) {
  const x = clamp(value, from.at(-1)!);
  let low = 0, high = from.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >>> 1;
    if (from[mid] <= x) low = mid; else high = mid;
  }
  return to[low] + (to[high] - to[low]) * (x - from[low]) / (from[high] - from[low]);
}

/** A level's peers have equal weight, independent of their subtree sizes.
 * Gaps remain gaps: an uneven tree never invents Events in a missing level. */
export function eventLayers<T extends EventPoint>(points: readonly T[], worldWidth: number) {
  const ranges = eventGroupRanges(points);
  const levels: T[][] = [];
  for (const point of points) (levels[point.depth] ??= []).push(point);
  return levels.map((peers, depth) => {
    const world = [0], local = [0];
    const append = (end: number, span: number) => {
      if (end > world.at(-1)!) {world.push(end); local.push(local.at(-1)! + span);}
    };
    const items = peers.map(point => {
      const range = ranges.get(point.event.component);
      const start = range?.start ?? point.x - 10;
      const end = range?.end ?? start + EVENT_CARD_WIDTH;
      append(start, Math.min(30, start - world.at(-1)!));
      const localStart = local.at(-1)!;
      append(end, EVENT_CARD_WIDTH);
      return {point, start, end, localStart, localEnd: local.at(-1)!, expanded: Boolean(range)};
    });
    append(worldWidth, Math.min(30, worldWidth - world.at(-1)!));
    const intervals: {start: number; end: number; parent?: string}[] = [];
    for (const item of items) {
      const previous = intervals.at(-1);
      if (previous && previous.parent === item.point.parent) previous.end = item.end;
      else intervals.push({start: item.start, end: item.end, parent: item.point.parent});
    }
    return {depth, items, intervals, total: local.at(-1)!, worldWidth,
      toLocal: (x: number) => interpolate(world, local, x),
      toWorld: (x: number) => interpolate(local, world, x)};
  });
}

export type EventLayer<T extends EventPoint = EventPoint> = ReturnType<typeof eventLayers<T>>[number];

interface NavigationAxis { toLocal: (x: number) => number; toWorld: (x: number) => number }

/** Scrolling uses the child scale only where expanded parents supply children.
 * Empty stretches inherit the parent's navigation axis, recursively. Integrating
 * the distances makes crossing a boundary reversible and independent of how
 * the device splits a gesture into wheel events. The visual lens stays intact. */
export function eventLayerNavigation(layers: readonly EventLayer[], width: number, zooms: Readonly<Record<number, number>>) {
  const axes: NavigationAxis[] = [];
  return layers.map(layer => {
    const scale = Math.max(width, Math.max(width, layer.total) * (zooms[layer.depth] ?? 1)) / layer.total;
    const own: NavigationAxis = {toLocal: x => layer.toLocal(x) * scale, toWorld: x => layer.toWorld(x / scale)};
    let axis = own;
    const parent = axes[layer.depth - 1];
    if (parent) {
      const segments: {end: number; offset: number; limit: number; origin: number; source: NavigationAxis}[] = [];
      let end = 0, offset = 0;
      const append = (next: number, source: NavigationAxis) => {
        if (next <= end) return;
        const origin = source.toLocal(end), limit = offset + source.toLocal(next) - origin;
        segments.push({end: next, offset, limit, origin, source});
        end = next; offset = limit;
      };
      for (const interval of layer.intervals) {
        append(interval.start, parent);
        append(interval.end, own);
      }
      append(layer.worldWidth, parent);
      const find = (x: number, world: boolean) => {
        let low = 0, high = segments.length - 1;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if ((world ? segments[mid].end : segments[mid].limit) < x) low = mid + 1; else high = mid;
        }
        return segments[low];
      };
      axis = {
        toLocal: value => {
          const x = clamp(value, layer.worldWidth), segment = find(x, true);
          return segment.offset + segment.source.toLocal(x) - segment.origin;
        },
        toWorld: value => {
          const x = clamp(value, offset), segment = find(x, false);
          return segment.source.toWorld(segment.origin + x - segment.offset);
        },
      };
    }
    axes.push(axis);
    return {pan: (focus: number, pixels: number) => axis.toWorld(axis.toLocal(focus) + pixels)};
  });
}

/** Each level magnifies its own axis; all lenses refer to one history position.
 * Zoom changes density, not position, selection, or the other levels' scales. */
export function eventLayerLens(layer: EventLayer, viewportWidth: number, focus: number, zoom = 1) {
  const width = Math.max(1, viewportWidth);
  const total = Math.max(width, Math.max(width, layer.total) * zoom);
  const scale = total / layer.total;
  const localFocus = layer.toLocal(focus) * scale;
  const lens = eventNavigatorLens(total, width, eventLensScrollLeft(localFocus, width, total));
  const position = localFocus / total * width;
  return {width, total, scale, focus: clamp(focus, layer.worldWidth),
    position, local: {position, project: (x: number) => lens.project(x * scale)},
    project: (x: number) => lens.project(layer.toLocal(x) * scale),
    unproject: (x: number) => layer.toWorld(lens.unproject(x) / scale),
    pan: (pixels: number) => layer.toWorld((localFocus + pixels) / scale)};
}

export function eventLayerSelectionFocus(layer: EventLayer, id: string) {
  const item = layer.items.find(item => item.point.event.component === id);
  if (!item) return undefined;
  const span = item.localEnd - item.localStart;
  return layer.toWorld(span < layer.total ? item.localStart / (1 - span / layer.total) : layer.total / 2);
}

/** Caption pools move by a whole local slot, not by scroll pixels. Compact
 * canvas marks retain the complete level outside this bounded reading pool. */
export function eventLayerWindow(layer: EventLayer, width: number, column: number, zoom: number) {
  const total = Math.max(width, Math.max(width, layer.total) * zoom);
  const padding = width * layer.total / total + EVENT_STEP;
  return {start: column * EVENT_STEP - padding, end: (column + 1) * EVENT_STEP + padding};
}

export function visibleLayerEvents<T extends EventPoint>(layer: EventLayer<T>, start: number, end: number) {
  let low = 0, high = layer.items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (layer.items[mid].localEnd < start) low = mid + 1; else high = mid;
  }
  const result: T[] = [];
  for (let i = low; i < layer.items.length && layer.items[i].localStart <= end; i++) result.push(layer.items[i].point);
  return result;
}
