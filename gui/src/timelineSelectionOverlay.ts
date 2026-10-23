import type {
  TimelineEventMarker,
  TimelineIntentConnector,
  TimelineIntentSpan,
  TimelineSelectionTarget,
  TimelineSelectionTrace,
} from "./openingPresentation";

export interface TimelineSelectionOverlaySpanSource {
  span: Pick<TimelineIntentSpan, "id">;
  linePath: string;
  color: string;
  open: boolean;
  hitRegion: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface TimelineSelectionOverlayConnectorSource {
  connector: Pick<TimelineIntentConnector, "id">;
  pathData: string;
  color: string;
}

export interface TimelineSelectionOverlayEventSource {
  marker: TimelineEventMarker;
  transform: string;
}

export interface TimelineSelectionOverlaySource {
  spans: readonly TimelineSelectionOverlaySpanSource[];
  connectors: readonly TimelineSelectionOverlayConnectorSource[];
  events: readonly TimelineSelectionOverlayEventSource[];
}

export interface TimelineSelectionOverlayPath {
  color: string;
  pathData: string;
  memberCount: number;
}

export interface TimelineSelectionOverlayOpenEnd {
  id: string;
  color: string;
  cx: number;
  cy: number;
}

export interface TimelineSelectionOverlayEvent {
  marker: TimelineEventMarker;
  transform: string;
  primary: boolean;
}

export interface TimelineSelectionOverlayModel {
  spanPaths: TimelineSelectionOverlayPath[];
  connectorPaths: TimelineSelectionOverlayPath[];
  openEnds: TimelineSelectionOverlayOpenEnd[];
  events: TimelineSelectionOverlayEvent[];
  primarySpan?: {
    color: string;
    pathData: string;
  };
  activeSpanCount: number;
  activeConnectorCount: number;
  activeEventCount: number;
}

export function timelineSelectionTargetKey(
  target: TimelineSelectionTarget | undefined,
) {
  if (!target) return undefined;
  return target.kind === "event"
    ? `event:${target.eventId}`
    : `intent:${target.spanId}`;
}

function appendGroupedPath(
  groups: Map<string, { segments: string[]; memberCount: number }>,
  color: string,
  pathData: string,
) {
  const group = groups.get(color);
  if (group) {
    group.segments.push(pathData);
    group.memberCount += 1;
    return;
  }
  groups.set(color, { segments: [pathData], memberCount: 1 });
}

function finishGroupedPaths(
  groups: Map<string, { segments: string[]; memberCount: number }>,
) {
  return [...groups].map(([color, group]) => ({
    color,
    pathData: group.segments.join(" "),
    memberCount: group.memberCount,
  }));
}

export function buildTimelineSelectionOverlay(
  source: TimelineSelectionOverlaySource,
  trace: TimelineSelectionTrace,
  target: TimelineSelectionTarget | undefined,
): TimelineSelectionOverlayModel {
  const spanGroups = new Map<
    string,
    { segments: string[]; memberCount: number }
  >();
  const connectorGroups = new Map<
    string,
    { segments: string[]; memberCount: number }
  >();
  const openEnds: TimelineSelectionOverlayOpenEnd[] = [];
  let primarySpan: TimelineSelectionOverlayModel["primarySpan"];
  let activeSpanCount = 0;

  for (const item of source.spans) {
    if (!trace.spanIds.has(item.span.id)) continue;
    activeSpanCount += 1;
    appendGroupedPath(spanGroups, item.color, item.linePath);
    if (item.open) {
      openEnds.push({
        id: item.span.id,
        color: item.color,
        cx: item.hitRegion.x + item.hitRegion.width,
        cy: item.hitRegion.y + item.hitRegion.height / 2,
      });
    }
    if (target?.kind === "intent" && target.spanId === item.span.id) {
      primarySpan = {
        color: item.color,
        pathData: item.linePath,
      };
    }
  }

  let activeConnectorCount = 0;
  for (const item of source.connectors) {
    if (!trace.connectorIds.has(item.connector.id)) continue;
    activeConnectorCount += 1;
    appendGroupedPath(connectorGroups, item.color, item.pathData);
  }

  const primaryEventId = target?.kind === "event" ? target.eventId : undefined;
  const events = source.events.flatMap((item) =>
    trace.eventIds.has(item.marker.id)
      ? [
          {
            marker: item.marker,
            transform: item.transform,
            primary: item.marker.id === primaryEventId,
          },
        ]
      : [],
  );

  return {
    spanPaths: finishGroupedPaths(spanGroups),
    connectorPaths: finishGroupedPaths(connectorGroups),
    openEnds,
    events,
    primarySpan,
    activeSpanCount,
    activeConnectorCount,
    activeEventCount: events.length,
  };
}
