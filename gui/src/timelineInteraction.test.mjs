import assert from "node:assert/strict";
import test from "node:test";
import {normalizeEvolveRailWidth, resizeEvolveRail, timelineAnchorPosition, timelineCommitTickPositions, timelineCommitTickGroups, timelineRenderWindow} from "./timelineInteraction.ts";

test("native scrolling reuses a bounded render window that always covers the viewport", () => {
  const first = timelineRenderWindow({left: 260, top: 390, width: 967, height: 585});
  assert.deepEqual(timelineRenderWindow({left: 319, top: 447, width: 967, height: 585}), first);
  for (const width of [260, 967, 1440]) for (const height of [180, 585, 1000]) {
    for (const offset of [0, 127.5, 128, 255, 256, 9000, 1_000_000]) {
      const viewport = {left: offset, top: offset / 2, width, height};
      const render = timelineRenderWindow(viewport);
      assert.ok(render.left >= 0 && render.top >= 0);
      assert.ok(render.left <= viewport.left && render.top <= viewport.top);
      assert.ok(render.left + render.width >= viewport.left + width);
      assert.ok(render.top + render.height >= viewport.top + height);
      assert.ok(render.width < width + 256 && render.height < height + 256);
    }
  }
});

test("rail resizing preserves room for the canvas and rejects corrupt stored sizes", () => {
  assert.equal(normalizeEvolveRailWidth(NaN), 188);
  assert.equal(normalizeEvolveRailWidth(999), 520);
  assert.equal(resizeEvolveRail(188, -60, 900), 248);
  assert.equal(resizeEvolveRail(500, 0, 600), 340);
  assert.equal(resizeEvolveRail(50, 0, 300), 132);
});

test("an Anchor uses an explicit Event boundary, otherwise its exact commit, never an inferred Event", () => {
  const commits = [{commit:"a"}, {commit:"b"}, {commit:"c"}];
  const positions = timelineCommitTickPositions([null,null,null], [], 0, 900);
  assert.deepEqual(timelineAnchorPosition(80,"b",commits,positions), {x:80,kind:"event-boundary"});
  assert.deepEqual(timelineAnchorPosition(undefined,"b",commits,positions), {x:450,kind:"commit"});
  assert.equal(timelineAnchorPosition(undefined,"missing",commits,positions), undefined);
  const dense = timelineCommitTickGroups(timelineCommitTickPositions(Array(1000).fill(null), [], 0, 400));
  assert.ok(dense.length < 150);
  assert.equal(dense.reduce((n,group) => n + group.last - group.first + 1, 0), 1000);
});
