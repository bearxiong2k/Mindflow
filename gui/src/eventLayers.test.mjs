import assert from "node:assert/strict";
import test from "node:test";
import { eventRows, eventTimelineLayout, EVENT_STEP } from "./eventTimeline.ts";
import { eventLayers, eventLayerLens, eventLayerNavigation, eventLayerSelectionFocus, eventLayerWindow, visibleLayerEvents } from "./eventLayers.ts";
import { eventLensPlacement } from "./eventNavigatorLens.ts";

const event = (id, children = []) => ({component: id, name: id, file: `${id}.md`, children});
const many = Array.from({length: 700}, (_, i) => event(`leaf${i}`));
const events = [event("small", ["nested"]), event("nested", ["deep"]), event("deep"), event("gap"),
  event("large", many.map(item => item.component)), ...many, event("last")];
const layout = eventTimelineLayout(eventRows(events, new Set(events.map(item => item.component))));
const layers = eventLayers(layout.points, layout.width);
const near = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test("each depth shows all its peers and weights parents independently of descendant count", () => {
  assert.deepEqual(layers[0].items.map(item => item.point.event.component), ["small", "gap", "large", "last"]);
  assert.equal(layers[1].items.length, 701);
  assert.deepEqual(layers[2].items.map(item => item.point.event.component), ["deep"]);
  const [small, , large] = layers[0].items;
  assert.ok(large.end - large.start > 200 * (small.end - small.start));
  near(small.localEnd - small.localStart, large.localEnd - large.localStart);
});

test("layer axes preserve empty branches and invert the whole shared history", () => {
  const gap = layout.byId.get("gap");
  for (const layer of layers) {
    let previous = -1;
    for (let i = 0; i <= 1000; i++) {
      const world = layout.width * i / 1000;
      const local = layer.toLocal(world);
      assert.ok(local > previous);
      near(layer.toWorld(local), world);
      previous = local;
    }
    const localGap = layer.toLocal(gap.x);
    if (layer.depth) assert.ok(!layer.items.some(item => item.localStart <= localGap && item.localEnd >= localGap));
  }
});

test("row lenses coordinate one position with reversible projections at every zoom", () => {
  for (const width of [260, 900]) for (const zoom of [0.25, 1, 4, 8]) for (const layer of layers) {
    for (const progress of [0, 0.01, 0.4, 0.99, 1]) {
      const focus = layout.width * progress;
      const lens = eventLayerLens(layer, width, focus, zoom);
      near(lens.project(focus), lens.position);
      near(lens.position / width, layer.toLocal(focus) / layer.total);
      near(lens.project(0), 0); near(lens.project(layout.width), width);
      for (let i = 0; i <= 100; i++) {
        const x = layout.width * i / 100;
        near(lens.unproject(lens.project(x)), x, 0.1);
      }
    }
  }
});

test("the same row gesture travels coarsely through parents and finely through children", () => {
  const large = layers[0].items[2];
  const focus = (large.start + large.end) / 2;
  const coarse = eventLayerLens(layers[0], 900, focus);
  const fine = eventLayerLens(layers[1], 900, focus);
  assert.ok(coarse.pan(20) - focus > 100 * (fine.pan(20) - focus));
  const zoomed = eventLayerLens(layers[0], 900, focus, 2);
  near(coarse.position, zoomed.position);
  assert.ok(zoomed.pan(20) - focus < coarse.pan(20) - focus);
});

test("short histories have a movable shared position even without native overflow", () => {
  const short = eventTimelineLayout(eventRows([event("a"), event("b")], new Set()));
  const [layer] = eventLayers(short.points, short.width);
  const before = eventLayerLens(layer, 900, 0), after = eventLayerLens(layer, 900, 200);
  near(before.total, 900); near(after.total, 900);
  assert.ok(after.position > before.position);
  near(after.project(200), after.position);
  assert.ok(after.pan(20) > 200);
});

test("keyboard-selected peers stay readable at each level's edges and center", () => {
  for (const layer of layers) for (const item of [layer.items[0], layer.items[Math.floor(layer.items.length / 2)], layer.items.at(-1)]) {
    for (const width of [427, 900]) {
      const focus = eventLayerSelectionFocus(layer, item.point.event.component);
      const lens = eventLayerLens(layer, width, focus);
      const placed = eventLensPlacement(lens, item.start, item.end, 220);
      assert.equal(placed.opacity, 1);
      assert.ok(placed.width >= 100);
      assert.ok(placed.x >= 0 && placed.x + placed.width <= width + 1e-6);
    }
  }
});

test("large levels retain a bounded caption pool across zooms and shared positions", () => {
  for (const zoom of [0.25, 1, 8]) for (const progress of [0, 0.25, 0.5, 0.99, 1]) for (const layer of layers) {
    const focus = layout.width * progress;
    const window = eventLayerWindow(layer, 900, Math.floor(layer.toLocal(focus) / EVENT_STEP), zoom);
    const shown = visibleLayerEvents(layer, window.start, window.end);
    assert.ok(shown.length <= 54, `${shown.length} mounted at depth ${layer.depth}`);
    const local = layer.toLocal(focus);
    const focused = layer.items.find(item => local >= item.localStart && local <= item.localEnd);
    if (focused) assert.ok(shown.includes(focused.point));
  }
  assert.deepEqual(eventLayers([], 320), []);
});

test("folded groups remain readable and retain their peer position at the parent level", () => {
  const folded = eventTimelineLayout(eventRows(events, new Set(["small", "nested"])));
  const root = eventLayers(folded.points, folded.width)[0];
  const item = root.items.find(item => item.point.event.component === "large");
  near(item.localStart, layers[0].items[2].localStart);
  near(item.localEnd, layers[0].items[2].localEnd);
  const focus = eventLayerSelectionFocus(root, "large");
  const lens = eventLayerLens(root, 427, focus);
  const placed = eventLensPlacement(lens, item.start, item.end, 220);
  assert.equal(placed.opacity, 1);
  assert.ok(placed.x >= 0 && placed.x + placed.width <= 427 + 1e-6);
  assert.ok(focus <= folded.width);
});


test("childless history inherits the nearest ancestor's scroll scale, regardless of child zoom", () => {
  for (const childZoom of [0.25, 1, 8]) {
    const navigation = eventLayerNavigation(layers, 900, {0: 2, 1: childZoom, 2: 4});
    const gap = layout.byId.get("gap").x + 50;
    for (const delta of [-10, 10]) {
      near(navigation[1].pan(gap, delta), navigation[0].pan(gap, delta));
      near(navigation[2].pan(gap, delta), navigation[0].pan(gap, delta));
    }
    const child = layout.byId.get("leaf300").x + 50;
    near(navigation[2].pan(child, 10), navigation[1].pan(child, 10));
    near(navigation[1].pan(child, 10), eventLayerLens(layers[1], 900, child, childZoom).pan(10));
  }
});

test("leaving the last child splits the scroll at the boundary instead of leaping across the empty tail", () => {
  const children = Array.from({length: 60}, (_, i) => event(`c${i}`));
  const sparse = [event("group", children.map(item => item.component)), ...children,
    ...Array.from({length: 250}, (_, i) => event(`root${i}`))];
  const tree = eventTimelineLayout(eventRows(sparse, new Set(["group"])));
  const levels = eventLayers(tree.points, tree.width);
  const navigation = eventLayerNavigation(levels, 900, {});
  const edge = levels[1].intervals[0].end;
  const scale = eventLayerLens(levels[1], 900, edge).scale;
  const before = levels[1].toWorld(levels[1].toLocal(edge) - 2 / scale);
  const after = navigation[1].pan(before, 12);
  near(after, navigation[0].pan(edge, 10));
  near(navigation[1].pan(after, -12), before);
  assert.ok(after - before < 50);
  assert.ok(eventLayerLens(levels[1], 900, before).pan(12) - before > 1000);
  let chunked = before;
  for (let i = 0; i < 12; i++) chunked = navigation[1].pan(chunked, 1);
  near(chunked, after);
});

test("crossing gaps in either direction is reversible and independent of wheel-event batching", () => {
  const navigation = eventLayerNavigation(layers, 427, {0: 1.5, 1: 2, 2: 3});
  for (const layer of layers) {
    for (const interval of layer.intervals) for (const edge of [interval.start, interval.end]) {
      const before = navigation[layer.depth].pan(edge, -15);
      const after = navigation[layer.depth].pan(before, 30);
      near(navigation[layer.depth].pan(after, -30), before);
      let chunked = before;
      for (let i = 0; i < 6; i++) chunked = navigation[layer.depth].pan(chunked, 5);
      near(chunked, after);
    }
  }
});

test("navigation traverses gaps between siblings at the child scale and clamps at history ends", () => {
  const navigation = eventLayerNavigation(layers, 900, {});
  const gap = (layers[1].items[200].end + layers[1].items[201].start) / 2;
  near(navigation[1].pan(gap, 2), eventLayerLens(layers[1], 900, gap).pan(2));
  for (const nav of navigation) {
    near(nav.pan(0, -500), 0);
    near(nav.pan(layout.width, 500), layout.width);
  }
  assert.deepEqual(eventLayerNavigation([], 900, {}), []);
});
