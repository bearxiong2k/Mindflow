import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTimelineSelectionOverlay,
  timelineSelectionTargetKey,
} from "./timelineSelectionOverlay.ts";

function eventSource(index) {
  return {
    marker: {
      id: `event-${index}`,
      column: index,
      junctionLane: index % 8,
      event: {
        name: `event-${index}`,
        predecessors: [],
        successors: [],
      },
      events: [
        {
          name: `event-${index}`,
          predecessors: [],
          successors: [],
        },
      ],
      startEventIndex: index,
      endEventIndex: index,
    },
    transform: `translate(${index * 10} ${index * 4})`,
  };
}

test("Timeline selection overlay groups a dense trace without losing identity", () => {
  const colors = Array.from(
    { length: 33 },
    (_, index) => `hsl(${index * 11} 60% 45%)`,
  );
  const spans = Array.from({ length: 428 }, (_, index) => ({
    span: { id: `span-${index}` },
    linePath: `M ${index} ${index % 33} L ${index + 8} ${index % 33}`,
    color: colors[index % colors.length],
    open: index % 41 === 0,
    hitRegion: {
      x: index,
      y: index % 33,
      width: 8,
      height: 12,
    },
  }));
  const connectors = Array.from({ length: 829 }, (_, index) => ({
    connector: { id: `connector-${index}` },
    pathData: `M ${index} 0 C ${index + 2} 2 ${index + 4} 4 ${index + 6} 6`,
    color: colors[index % colors.length],
  }));
  const events = Array.from({ length: 59 }, (_, index) => eventSource(index));
  const trace = {
    spanIds: new Set(spans.slice(0, 174).map((item) => item.span.id)),
    connectorIds: new Set(
      connectors.slice(0, 342).map((item) => item.connector.id),
    ),
    eventIds: new Set(events.slice(0, 12).map((item) => item.marker.id)),
    paths: new Set(),
    pastPaths: [],
    futurePaths: [],
  };
  const target = {
    kind: "intent",
    path: "opening/intent.md",
    spanId: "span-37",
  };

  const overlay = buildTimelineSelectionOverlay(
    { spans, connectors, events },
    trace,
    target,
  );

  assert.equal(overlay.activeSpanCount, 174);
  assert.equal(overlay.activeConnectorCount, 342);
  assert.equal(overlay.activeEventCount, 12);
  assert.equal(
    overlay.spanPaths.reduce((sum, path) => sum + path.memberCount, 0),
    174,
  );
  assert.equal(
    overlay.connectorPaths.reduce((sum, path) => sum + path.memberCount, 0),
    342,
  );
  assert.ok(overlay.spanPaths.length <= colors.length);
  assert.ok(overlay.connectorPaths.length <= colors.length);
  assert.ok(
    overlay.spanPaths.length + overlay.connectorPaths.length <
      (overlay.activeSpanCount + overlay.activeConnectorCount) / 6,
  );
  assert.deepEqual(overlay.primarySpan, {
    color: colors[37 % colors.length],
    pathData: spans[37].linePath,
  });
  assert.ok(overlay.openEnds.every((end) => trace.spanIds.has(end.id)));
  assert.equal(timelineSelectionTargetKey(target), "intent:span-37");
});

test("Timeline selection overlay preserves event order and primary identity", () => {
  const events = [eventSource(0), eventSource(1), eventSource(2)];
  const trace = {
    spanIds: new Set(),
    connectorIds: new Set(),
    eventIds: new Set(["event-0", "event-2"]),
    paths: new Set(),
    pastPaths: [],
    futurePaths: [],
  };
  const target = { kind: "event", eventId: "event-2" };

  const overlay = buildTimelineSelectionOverlay(
    { spans: [], connectors: [], events },
    trace,
    target,
  );

  assert.deepEqual(
    overlay.events.map((event) => [event.marker.id, event.primary]),
    [
      ["event-0", false],
      ["event-2", true],
    ],
  );
  assert.equal(timelineSelectionTargetKey(target), "event:event-2");
  assert.equal(timelineSelectionTargetKey(undefined), undefined);
});
