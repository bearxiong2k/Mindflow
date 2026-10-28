import assert from "node:assert/strict";
import test from "node:test";
import {
  eventRows, visibleEventSelection, eventTimelineLayout, visibleEventPoints,
  EVENT_STEP, EVENT_LANE_HEIGHT, EVENT_CARD_WIDTH, evolveInspectorHeight, normalizeEvolveInspectorHeight,
  eventGroupRanges,
} from "./eventTimeline.ts";
const event = (id, children = []) => ({component: id, name: `${id}.md`, file: `events/${id}.md`, content: {sha256: "test", bytes: 0}, children});
const events = [event("summary", ["second", "nested"]), event("first"), event("leaf"), event("nested", ["leaf"]), event("second")];

test("summary folding uses authored root/child order and preserves nested expansion", () => {
  assert.deepEqual(eventRows(events, new Set()).map(row => row.event.component), ["summary", "first"]);
  assert.deepEqual(eventRows(events, new Set(["summary"])).map(row => [row.event.component, row.depth]), [["summary",0],["second",1],["nested",1],["first",0]]);
  const expanded = new Set(["summary", "nested"]);
  assert.deepEqual(eventRows(events, expanded).map(row => row.event.component), ["summary", "second", "nested", "leaf", "first"]);
  expanded.delete("summary");
  assert.deepEqual(eventRows(events, expanded).map(row => row.event.component), ["summary", "first"]);
  expanded.add("summary");
  assert.ok(eventRows(events, expanded).some(row => row.event.component === "leaf"));
});

test("collapsing selected descendants selects their nearest visible summary", () => {
  const collapsed = eventRows(events, new Set());
  assert.equal(visibleEventSelection(collapsed, events, "leaf"), "summary");
  assert.equal(visibleEventSelection(eventRows(events, new Set(["summary"])), events, "leaf"), "nested");
  assert.equal(visibleEventSelection(collapsed, events, "gone"), "summary");
  assert.equal(visibleEventSelection([], [], "gone"), undefined);
});

test("expanded summaries keep authored sequence and place children one lane below", () => {
  const layout = eventTimelineLayout(eventRows(events, new Set(["summary", "nested"])));
  assert.deepEqual(layout.points.map(point => point.event.component), ["summary", "second", "nested", "leaf", "first"]);
  const summary = layout.byId.get("summary"), nested = layout.byId.get("nested"), leaf = layout.byId.get("leaf");
  assert.equal(nested.y - summary.y, EVENT_LANE_HEIGHT);
  assert.equal(leaf.y - nested.y, EVENT_LANE_HEIGHT);
  assert.deepEqual(layout.points.map(point => [point.position, point.siblings]), [[1,2],[1,2],[2,2],[1,1],[2,2]]);
  const collapsed = eventTimelineLayout(eventRows(events, new Set()));
  assert.equal(collapsed.points[1].x - collapsed.points[0].x, EVENT_STEP);
  assert.ok(collapsed.width < layout.width);
});

test("large Event histories keep rendering bounded at both ends and after collapse", () => {
  const many = Array.from({length: 4096}, (_, i) => event(`e${i}`));
  const layout = eventTimelineLayout(eventRows(many, new Set()));
  for (const left of [0, 20000, 4090 * EVENT_STEP]) {
    const visible = visibleEventPoints(layout.points, left, 900);
    assert.ok(visible.length <= 10);
  }
  assert.deepEqual(visibleEventPoints([], 10000, 900), []);
});

test("the reading panel remains bounded with room for the timeline canvas", () => {
  assert.equal(normalizeEvolveInspectorHeight(undefined), 220);
  assert.equal(normalizeEvolveInspectorHeight(NaN), 220);
  assert.equal(evolveInspectorHeight(600, 500), 320);
  assert.equal(evolveInspectorHeight(-1, 500), 120);
  assert.equal(evolveInspectorHeight(220, 160), 120);
});

test("the deepest supported summary remains reachable in both scroll dimensions", () => {
  const nested = Array.from({length: 32}, (_, i) => event(`d${i}`, i < 31 ? [`d${i+1}`] : []));
  const layout = eventTimelineLayout(eventRows(nested, new Set(nested.map(event => event.component))));
  const last = layout.points.at(-1);
  const bottom = visibleEventPoints(layout.points, last.x - 200, 800);
  assert.ok(bottom.some(point => point.event.component === "d31"));
  assert.ok(!bottom.some(point => point.event.component === "d0"));
  assert.ok(layout.height > last.y + 26);
  assert.equal(visibleEventSelection(eventRows(nested, new Set(["d0"])), nested, "d31"), "d1");
});


test("expanded summary spans end at their last visible child", () => {
  const layout = eventTimelineLayout(eventRows(events, new Set(["summary", "nested"])));
  const ranges = eventGroupRanges(layout.points);
  assert.equal(ranges.get("summary").end, layout.byId.get("leaf").x - 10 + EVENT_CARD_WIDTH);
  assert.equal(ranges.get("nested").end, ranges.get("summary").end);
  assert.equal(ranges.has("first"), false);
  const many = [event("group", Array.from({length:4096}, (_, i) => `e${i}`)), ...Array.from({length:4096}, (_, i) => event(`e${i}`))];
  const folded = eventTimelineLayout(eventRows(many, new Set()));
  assert.equal(eventGroupRanges(folded.points).size, 0);
});
