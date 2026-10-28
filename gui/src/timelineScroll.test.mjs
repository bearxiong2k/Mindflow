import assert from "node:assert/strict";
import test from "node:test";
import { createTimelineScrollSync } from "./timelineScroll.ts";

const initial = {left: 0, top: 0, width: 900, height: 500};
const ports = () => ({
  canvas: {scrollLeft: 0, scrollTop: 0, clientWidth: 900, clientHeight: 500},
  events: {scrollLeft: 0}, files: {scrollTop: 0},
});

test("an echoed canvas event cannot overwrite newer Event-bar input", () => {
  const view = ports(), sync = createTimelineScrollSync(initial);
  view.events.scrollLeft = 100;
  assert.equal(sync.scroll("events", view).left, 100);
  assert.equal(view.canvas.scrollLeft, 100);
  // The canvas acknowledgement arrives after the next bar movement, before
  // the bar's new event is delivered. This used to drop every other update.
  view.events.scrollLeft = 200;
  assert.equal(sync.scroll("canvas", view), undefined);
  assert.equal(view.events.scrollLeft, 200);
  assert.equal(sync.scroll("events", view).left, 200);
  assert.equal(view.canvas.scrollLeft, 200);
});

test("echo suppression works in both directions and on the file rail", () => {
  const view = ports(), sync = createTimelineScrollSync(initial);
  view.canvas.scrollLeft = 100;
  sync.scroll("canvas", view);
  view.canvas.scrollLeft = 200;
  assert.equal(sync.scroll("events", view), undefined);
  assert.equal(view.canvas.scrollLeft, 200);
  sync.scroll("canvas", view);
  assert.equal(view.events.scrollLeft, 200);

  view.files.scrollTop = 40;
  sync.scroll("files", view);
  view.files.scrollTop = 60;
  assert.equal(sync.scroll("canvas", view), undefined);
  assert.equal(sync.scroll("files", view).top, 60);
  assert.equal(view.canvas.scrollTop, 60);
  assert.equal(view.events.scrollLeft, 200);
});

test("scroll updates preserve every input without remeasuring geometry", () => {
  const view = ports(), sync = createTimelineScrollSync(initial);
  let reads = 0;
  Object.defineProperties(view.canvas, {
    clientWidth: {get() { reads++; return 800; }},
    clientHeight: {get() { reads++; return 400; }},
  });
  assert.deepEqual(sync.measure(view), {...initial, width: 800, height: 400});
  assert.equal(reads, 2);
  for (let index = 1; index <= 200; index++) {
    const source = index % 2 ? "canvas" : "events";
    view[source].scrollLeft = index * 10;
    const next = sync.scroll(source, view);
    assert.deepEqual(next, {left: index * 10, top: 0, width: 800, height: 400});
    assert.equal(view.canvas.scrollLeft, view.events.scrollLeft);
    assert.equal(sync.scroll(source === "canvas" ? "events" : "canvas", view), undefined);
  }
  assert.equal(reads, 2, "native scrolling forced a geometry read");
});

test("fold and resize measurement adopts clamped offsets before synchronizing", () => {
  const view = ports(), sync = createTimelineScrollSync(initial);
  view.canvas.scrollLeft = 8000;
  view.canvas.scrollTop = 600;
  sync.scroll("canvas", view);
  Object.assign(view.canvas, {scrollLeft: 80, scrollTop: 20, clientWidth: 700, clientHeight: 300});
  assert.deepEqual(sync.measure(view), {left: 80, top: 20, width: 700, height: 300});
  assert.equal(view.events.scrollLeft, 80);
  assert.equal(view.files.scrollTop, 20);
  assert.equal(sync.scroll("events", view), undefined);
  assert.equal(sync.scroll("files", view), undefined);
});

test("explicit navigation can restore the same canvas position before a pending bar event", () => {
  const view = ports(), sync = createTimelineScrollSync(initial);
  view.events.scrollLeft = 100;
  view.files.scrollTop = 40;
  // First Event targets the already-visible canvas origin. Synchronize the
  // pending peers even though no React viewport update is needed.
  assert.equal(sync.measure(view), undefined);
  assert.equal(view.events.scrollLeft, 0);
  assert.equal(view.files.scrollTop, 0);
  assert.equal(sync.scroll("events", view), undefined);
  assert.equal(sync.scroll("files", view), undefined);
});

test("continuous scrubbing cancels pending peer movement without measuring layout", () => {
  const view = ports(), sync = createTimelineScrollSync(initial);
  Object.defineProperties(view.canvas, {
    clientWidth: {get() { throw new Error("scrubbing measured canvas width"); }},
    clientHeight: {get() { throw new Error("scrubbing measured canvas height"); }},
  });
  view.events.scrollLeft = 100;
  assert.equal(sync.align(view), undefined);
  assert.equal(view.events.scrollLeft, 0);
  assert.equal(sync.scroll("events", view), undefined);
  for (let left = 50; left <= 500; left += 50) {
    view.canvas.scrollLeft = left;
    assert.equal(sync.align(view).left, left);
    assert.equal(view.events.scrollLeft, left);
    assert.equal(sync.scroll("canvas", view), undefined);
  }
});
