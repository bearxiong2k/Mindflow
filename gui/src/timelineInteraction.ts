// Presentation helpers retained from the original Timeline interaction.
export const DEFAULT_EVOLVE_RAIL_WIDTH = 188;

export interface TimelineViewport { left: number; top: number; width: number; height: number }
export const TIMELINE_RENDER_TILE = 64;

/** A small overscan window moves with native scrolling until the next tile.
 * Its SVG stays bounded independently of the length of project history. */
export function timelineRenderWindow(viewport: TimelineViewport): TimelineViewport {
  const tile = TIMELINE_RENDER_TILE;
  return {
    left: Math.max(0, Math.floor(viewport.left / tile) * tile - tile),
    top: Math.max(0, Math.floor(viewport.top / tile) * tile - tile),
    width: Math.ceil(viewport.width / tile) * tile + tile * 3,
    height: Math.ceil(viewport.height / tile) * tile + tile * 3,
  };
}
export function normalizeEvolveRailWidth(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.min(520, Math.max(132, value))) : DEFAULT_EVOLVE_RAIL_WIDTH;
}
export function resizeEvolveRail(width: number, movement: number, available: number) {
  return Math.min(normalizeEvolveRailWidth(width - movement), Math.max(132, available - 260));
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

export function timelineCommitTickGroups(
  positions: readonly TimelineCommitTickPosition[],
  maximumGroups = 512,
  minimumSpacing = 8,
): Array<{ first: number; last: number; x: number }> {
  if (!positions.length) return [];
  const budget = Math.max(1, Math.floor(maximumGroups));
  const step = Math.max(minimumSpacing, (positions.at(-1)!.x - positions[0].x) / budget);
  const groups: Array<{ first: number; last: number; x: number }> = [];
  for (let index = 0; index < positions.length; index += 1) {
    const previous = groups.at(-1);
    if (previous && (positions[index].x - previous.x < step || groups.length >= budget)) {
      previous.last = index;
    } else {
      groups.push({ first: index, last: index, x: positions[index].x });
    }
  }
  return groups;
}
