export interface GeometryPoint {
  x: number;
  y: number;
}

export interface MapNodeLabelCandidate {
  key: string;
  label: string;
  point: GeometryPoint;
}

export interface MapNodeLabelLayout extends MapNodeLabelCandidate {
  side: "left" | "right";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextBoxMeasurement {
  width: number;
  height: number;
}

export interface GeometryBounds {
  width: number;
  height: number;
}

export interface ClassicalRelationshipInput {
  index: number;
  type: string;
  source: string;
  target: string;
}

export interface ClassicalRelationshipRoute
  extends ClassicalRelationshipInput {
  laneOffset: number;
  sourceOffset: number;
  targetOffset: number;
}

export interface ClassicalRelationshipRouting {
  routes: ClassicalRelationshipRoute[];
  laneWidth: number;
}

export function classicalClientToLocalScale(
  localExtent: number,
  renderedExtent: number,
): number {
  if (
    !Number.isFinite(localExtent) ||
    !Number.isFinite(renderedExtent) ||
    localExtent <= 0 ||
    renderedExtent <= 0
  ) {
    return 1;
  }
  return localExtent / renderedExtent;
}

const labelMargin = 8;
const labelGap = 2;
const nodeLabelGap = 14;
const estimatedTextBoxHeight = 28;
const estimatedTextBoxMinWidth = 112;
const estimatedTextBoxMaxWidth = 320;
const measuredTextBoxMinWidth = 40;
const measuredTextBoxMinHeight = 1;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function resolveTextBoxSize(
  label: string,
  measured: TextBoxMeasurement | undefined,
  maximumWidth = Number.POSITIVE_INFINITY,
): TextBoxMeasurement {
  const estimatedWidth = clamp(
    24 + label.length * 5.8,
    estimatedTextBoxMinWidth,
    estimatedTextBoxMaxWidth,
  );
  return {
    width: Math.min(
      measured === undefined
        ? estimatedWidth
        : Math.max(measuredTextBoxMinWidth, measured.width),
      maximumWidth,
    ),
    height:
      measured === undefined
        ? estimatedTextBoxHeight
        : Math.max(measuredTextBoxMinHeight, measured.height),
  };
}

function arrangeLabelRange(
  labels: MapNodeLabelLayout[],
  minimumY: number,
  maximumY: number,
  gap: number,
): void {
  if (labels.length === 0) return;

  let cursor = minimumY;
  for (const label of labels) {
    const desired = clamp(
      label.point.y - label.height / 2,
      minimumY,
      maximumY - label.height,
    );
    label.y = Math.max(desired, cursor);
    cursor = label.y + label.height + gap;
  }

  for (let index = labels.length - 1; index >= 0; index -= 1) {
    const label = labels[index];
    const maximum =
      index === labels.length - 1
        ? maximumY - label.height
        : labels[index + 1].y - gap - label.height;
    label.y = Math.min(label.y, maximum);
  }

  if (labels[0].y < minimumY) {
    const shift = minimumY - labels[0].y;
    for (const label of labels) label.y += shift;
  }
}

function arrangeLabelSide(
  labels: MapNodeLabelLayout[],
  bounds: GeometryBounds,
  priorityKey?: string,
): void {
  if (labels.length === 0) return;
  labels.sort(
    (left, right) =>
      left.point.y - right.point.y || left.key.localeCompare(right.key),
  );

  const availableHeight = bounds.height - labelMargin * 2;
  const contentHeight = labels.reduce((sum, label) => sum + label.height, 0);
  const gap =
    labels.length === 1
      ? 0
      : Math.max(
          1,
          Math.min(
            labelGap,
            (availableHeight - contentHeight) / (labels.length - 1),
          ),
        );
  const priorityIndex = priorityKey === undefined
    ? -1
    : labels.findIndex((label) => label.key === priorityKey);
  const minimumY = labelMargin;
  const maximumY = bounds.height - labelMargin;

  if (priorityIndex < 0) {
    arrangeLabelRange(labels, minimumY, maximumY, gap);
    return;
  }

  const priority = labels[priorityIndex];
  const before = labels.slice(0, priorityIndex);
  const after = labels.slice(priorityIndex + 1);
  const beforeSpan = before.reduce(
    (sum, label) => sum + label.height + gap,
    0,
  );
  const afterSpan = after.reduce(
    (sum, label) => sum + label.height + gap,
    0,
  );
  const earliestPriorityY = minimumY + beforeSpan;
  const latestPriorityY = maximumY - priority.height - afterSpan;

  if (earliestPriorityY > latestPriorityY) {
    arrangeLabelRange(labels, minimumY, maximumY, gap);
    return;
  }

  priority.y = clamp(
    priority.point.y - priority.height / 2,
    earliestPriorityY,
    latestPriorityY,
  );
  arrangeLabelRange(before, minimumY, priority.y - gap, gap);
  arrangeLabelRange(
    after,
    priority.y + priority.height + gap,
    maximumY,
    gap,
  );
}

export function layoutMapNodeLabels(
  candidates: MapNodeLabelCandidate[],
  bounds: GeometryBounds,
  measuredSizes: ReadonlyMap<string, TextBoxMeasurement> = new Map(),
  priorityKey?: string,
): MapNodeLabelLayout[] {
  const labels = candidates.map<MapNodeLabelLayout>((candidate) => {
    const { width, height } = resolveTextBoxSize(
      candidate.label,
      measuredSizes.get(candidate.key),
      bounds.width - labelMargin * 2,
    );
    const side = candidate.point.x < bounds.width / 2 ? "left" : "right";
    const desiredX =
      side === "left"
        ? candidate.point.x - nodeLabelGap - width
        : candidate.point.x + nodeLabelGap;
    return {
      ...candidate,
      side,
      x: clamp(desiredX, labelMargin, bounds.width - labelMargin - width),
      y: candidate.point.y - height / 2,
      width,
      height,
    };
  });

  arrangeLabelSide(
    labels.filter((label) => label.side === "left"),
    bounds,
    priorityKey,
  );
  arrangeLabelSide(
    labels.filter((label) => label.side === "right"),
    bounds,
    priorityKey,
  );
  return labels;
}

interface EndpointSlot {
  key: string;
  type: string;
}

function endpointOffsets(
  routes: Array<ClassicalRelationshipInput & { laneOffset: number }>,
): Map<string, number> {
  const byPath = new Map<string, EndpointSlot[]>();
  for (const route of routes) {
    const source = byPath.get(route.source) ?? [];
    source.push({ key: `${route.index}:source`, type: route.type });
    byPath.set(route.source, source);

    const target = byPath.get(route.target) ?? [];
    target.push({ key: `${route.index}:target`, type: route.type });
    byPath.set(route.target, target);
  }

  const offsets = new Map<string, number>();
  for (const slots of byPath.values()) {
    if (slots.length === 1) {
      offsets.set(slots[0].key, 0);
      continue;
    }

    const positions: number[] = [];
    let cursor = 0;
    let previousType: string | undefined;
    for (const slot of slots) {
      if (previousType !== undefined && slot.type !== previousType) cursor += 3.8;
      positions.push(cursor);
      cursor += 2.8;
      previousType = slot.type;
    }
    const center = (positions[0] + positions.at(-1)!) / 2;
    const span = positions.at(-1)! - positions[0];
    const scale = span > 18 ? 18 / span : 1;
    for (const [index, slot] of slots.entries()) {
      offsets.set(slot.key, (positions[index] - center) * scale);
    }
  }
  return offsets;
}

export function routeClassicalRelationships(
  relationships: ClassicalRelationshipInput[],
): ClassicalRelationshipRouting {
  const groups = new Map<string, ClassicalRelationshipInput[]>();
  for (const relationship of relationships) {
    const group = groups.get(relationship.type);
    if (group) group.push(relationship);
    else groups.set(relationship.type, [relationship]);
  }

  const provisional: Array<ClassicalRelationshipInput & { laneOffset: number }> = [];
  let laneOffset = 14;
  let groupIndex = 0;
  for (const group of groups.values()) {
    if (groupIndex > 0) laneOffset += 12;
    for (const relationship of group) {
      provisional.push({ ...relationship, laneOffset });
      laneOffset += 7;
    }
    groupIndex += 1;
  }

  const offsets = endpointOffsets(provisional);
  return {
    routes: provisional.map((relationship) => ({
      ...relationship,
      sourceOffset: offsets.get(`${relationship.index}:source`) ?? 0,
      targetOffset: offsets.get(`${relationship.index}:target`) ?? 0,
    })),
    laneWidth: Math.max(58, laneOffset + 18),
  };
}

export function classicalRelationshipLaneX(
  visibleRightX: number,
  laneWidth: number,
): number {
  return Math.max(96, visibleRightX - laneWidth);
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

export function classicalRelationshipPath(
  laneX: number,
  sourceY: number,
  targetY: number,
): string {
  let adjustedTargetY = targetY;
  if (Math.abs(adjustedTargetY - sourceY) < 2) adjustedTargetY = sourceY + 8;
  return `M ${rounded(laneX)} ${rounded(sourceY)} V ${rounded(adjustedTargetY)}`;
}
