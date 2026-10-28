import assert from "node:assert/strict";
import test from "node:test";
import { eventNavigatorLens, eventLensPlacement, eventLensScrollLeft, eventLensSelectionLeft } from "./eventNavigatorLens.ts";

const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test("the lens peak follows absolute scroll progress and keeps both endpoints fixed", () => {
  for (const progress of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
    const lens = eventNavigatorLens(10000, 900, progress * 9100);
    near(lens.position, progress * 900);
    near(lens.focus, progress * 10000);
    near(lens.project(lens.focus), lens.position);
    near(lens.project(lens.focus), lens.focus - lens.left);
    near(lens.project(0), 0);
    near(lens.project(10000), 900);
    near(eventLensScrollLeft(lens.focus, 900, 10000), lens.left);
  }
});

test("magnification tapers continuously on both sides, without a flat window", () => {
  const lens = eventNavigatorLens(10000, 900, 3000);
  const step = 0.001;
  near((lens.project(lens.focus) - lens.project(lens.focus - step)) / step, lens.peak, 0.0001);
  near((lens.project(lens.focus + step) - lens.project(lens.focus)) / step, lens.peak, 0.0001);
  for (const side of [-1, 1]) {
    const scales = [0, 25, 100, 250, 500, 1000].map(d => lens.scale(lens.focus + side * d));
    assert.ok(scales.every((value, i) => !i || value < scales[i - 1]));
    near(lens.scale(lens.focus + side * step), lens.peak, 1e-8);
  }
});

test("the full history preserves order and precise inverse navigation across lengths and focus positions", () => {
  for (const total of [320, 900, 1200, 10000, 1000000]) {
    for (const width of [260, 900, 1440]) {
      for (const progress of [0, 0.001, 0.01, 0.5, 0.99, 0.999, 1]) {
        const lens = eventNavigatorLens(total, width, Math.max(0, total - width) * progress);
        let last = -1;
        for (let i = 0; i <= 100; i++) {
          const x = lens.total * i / 100;
          const screen = lens.project(x);
          assert.ok(screen > last);
          assert.ok(screen >= -1e-6 && screen <= width + 1e-6);
          // Strong magnification leaves extreme context below screen-pixel
          // precision; even a million-pixel history must round-trip to 0.1 px.
          near(lens.unproject(screen), x, 0.1);
          last = screen;
        }
      }
    }
  }
});

test("a short history remains undistorted and out-of-range navigation clamps safely", () => {
  const lens = eventNavigatorLens(320, 900, 500);
  assert.equal(lens.left, 0);
  for (const x of [0, 56, 150, 320]) {
    near(lens.project(x), x);
    near(lens.scale(x), 1);
  }
  near(lens.unproject(-100), 0);
  near(lens.unproject(1000), 900);
  assert.equal(eventLensScrollLeft(1000, 900, 320), 0);
  assert.equal(eventLensScrollLeft(-1, 900, 10000), 0);
  assert.equal(eventLensScrollLeft(20000, 900, 10000), 9100);
});

test("captions stay in their groups and leaf labels grow progressively toward focus", () => {
  const lens = eventNavigatorLens(10000, 900, 4550);
  const group = eventLensPlacement(lens, 100, 9000);
  assert.ok(group.caption > 0);
  assert.ok(group.caption + group.labelWidth * group.scale <= group.width - 2);
  near(group.x + 1 + group.caption + group.labelWidth * group.scale / 2, lens.position);
  for (const left of [0, 9000]) {
    const edge = eventLensPlacement(eventNavigatorLens(10000, 900, left), 100, 9000);
    assert.ok(edge.caption >= 0);
    assert.ok(edge.caption + edge.labelWidth * edge.scale <= Math.max(0, edge.width - 2) + 1e-6);
  }
  const leaves = [0, 100, 300, 600, 1000].map(distance => eventLensPlacement(lens, lens.focus + distance, lens.focus + distance + 140));
  assert.ok(leaves.every((item, i) => !i || item.width < leaves[i - 1].width));
  assert.ok(leaves.every((item, i) => !i || item.opacity <= leaves[i - 1].opacity));
  assert.ok(leaves.every((item, i) => !i || item.scale <= leaves[i - 1].scale));
  assert.equal(leaves.at(-1).opacity, 0);
});

test("selected captions remain readable at either endpoint and in the middle", () => {
  for (const total of [1000, 10000, 1000000]) {
    for (const start of [46, total / 2, total - 178]) {
      const left = eventLensSelectionLeft(start, start + 140, 900, total);
      const lens = eventNavigatorLens(total, 900, left);
      const placed = eventLensPlacement(lens, start, start + 140);
      assert.ok(placed.width > 130, `selected caption shrank to ${placed.width}`);
      assert.equal(placed.opacity, 1);
      assert.ok(placed.x >= 0 && placed.x + placed.width <= 900 + 1e-6);
    }
  }
});

test("the focus leaves room for a full title throughout a scrolling interval", () => {
  for (const width of [427, 900, 1440]) {
    for (const start of [2500, 5000, 7500]) {
      const left = eventLensSelectionLeft(start, start + 140, width, 10000);
      for (const offset of [-20, 0, 20]) {
        const lens = eventNavigatorLens(10000, width, left + offset);
        const placed = eventLensPlacement(lens, start, start + 140);
        // A long title plus its Event number and affordances stay readable
        // over multiple scroll frames, without growing the text itself.
        assert.ok(placed.labelWidth > 310);
        assert.equal(placed.scale, 1);
        assert.equal(placed.opacity, 1);
      }
    }
  }
});

test("parent titles remain inside their own mapped spans through edge contraction", () => {
  for (const width of [260, 427, 900]) {
    for (let left = 0; left <= 10000 - width; left += 13) {
      const lens = eventNavigatorLens(10000, width, left);
      for (const [start, end] of [[46, 7000], [7100, 7800], [8000, 9960]]) {
        const parent = eventLensPlacement(lens, start, end, 220);
        near(parent.x, lens.project(start));
        near(parent.width, lens.project(end) - lens.project(start));
        assert.ok(parent.caption >= 0);
        assert.ok(parent.caption + parent.labelWidth * parent.scale <= Math.max(0, parent.width - 2) + 1e-6);
        assert.ok(parent.labelWidth <= 220);
        if (parent.width < 24) assert.equal(parent.opacity, 0);
      }
    }
  }
});

test("selected Events and their ancestors remain readable with the same label layout", () => {
  for (const width of [427, 900]) {
    for (const start of [46, 5000, 9820]) {
      const lens = eventNavigatorLens(10000, width, eventLensSelectionLeft(start, start + 140, width, 10000));
      const folded = eventLensPlacement(lens, start, start + 140, 180);
      assert.equal(folded.opacity, 1);
      assert.ok(folded.caption >= 0 && folded.caption + folded.labelWidth * folded.scale <= folded.width - 2 + 1e-6);
      const parent = eventLensPlacement(lens, Math.max(0, start - 1500), Math.min(10000, start + 2000), 220);
      assert.equal(parent.opacity, 1);
      assert.equal(parent.scale, 1);
      assert.equal(parent.labelWidth, 220);
    }
  }
});

test("captions settle at interval edges smoothly and follow the lens in the interior", () => {
  const base = eventNavigatorLens(900, 900, 0);
  const place = position => eventLensPlacement({...base, position}, 100, 700, 220);
  near(place(400).x + 1 + place(400).caption + 110, 400);
  const left = 100 + 1 + 110, right = 700 - 1 - 110;
  near(place(left).caption, 0);
  near(place(left - 10).caption, 0);
  assert.ok(place(left + 0.01).caption < 0.00001);
  const end = place(right).caption;
  near(place(right + 10).caption, end);
  assert.ok(end - place(right - 0.01).caption < 0.00001);
  let before = place(0).caption;
  for (let position = 1; position <= 900; position++) {
    const current = place(position).caption;
    assert.ok(current >= before && current - before < 1.34);
    before = current;
  }
});
