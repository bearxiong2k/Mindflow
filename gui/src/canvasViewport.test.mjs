import assert from "node:assert/strict";
import test from "node:test";

import {
  CANVAS_POINTER_INTERACTIVE_SELECTOR,
  canvasDeltaFromClientRect,
  canvasPointFromClientRect,
  canvasTargetIsInteractiveControl,
  canvasViewportWindow,
  centerCanvasTransformAtContentRatio,
  constrainCanvasTransform,
  fitCanvasBoundsTransform,
  fitCanvasWidthZoom,
  fitCanvasZoom,
  panCanvasTransform,
  renderedCanvasSize,
  restoreCanvasViewportTransform,
  wheelDeltaInPixels,
  zoomCanvasTransformAt,
} from "./canvasViewport.ts";

const viewport = { width: 500, height: 300 };
const content = { width: 500, height: 300 };

test("client coordinates follow the rendered canvas across interface and canvas zoom", () => {
  const renderedBounds = {
    left: 240,
    top: 180,
    // 1.2 interface scale times 1.25 canvas zoom.
    width: 1_000 * 1.2 * 1.25,
    height: 600 * 1.2 * 1.25,
  };
  const viewBox = { x: 10, y: 20, width: 1_000, height: 600 };

  assert.deepEqual(
    canvasPointFromClientRect(
      { x: renderedBounds.left + 450, y: renderedBounds.top + 300 },
      renderedBounds,
      viewBox,
    ),
    { x: 310, y: 220 },
  );
  assert.deepEqual(
    canvasDeltaFromClientRect({ x: 150, y: -90 }, renderedBounds, viewBox),
    { x: 100, y: -60 },
  );
});

test("client coordinate conversion rejects unusable canvas geometry", () => {
  const viewBox = { x: 0, y: 0, width: 1_000, height: 600 };
  assert.equal(
    canvasPointFromClientRect(
      { x: 100, y: 100 },
      { left: 0, top: 0, width: 0, height: 600 },
      viewBox,
    ),
    undefined,
  );
  assert.equal(
    canvasDeltaFromClientRect(
      { x: Number.NaN, y: 10 },
      { left: 0, top: 0, width: 1_000, height: 600 },
      viewBox,
    ),
    undefined,
  );
});

test("the focusable viewport remains draggable while nested controls keep pointer ownership", () => {
  const viewport = { role: "canvas" };
  let matchedSelector;
  assert.equal(
    canvasTargetIsInteractiveControl(
      {
        closest(selector) {
          matchedSelector = selector;
          return viewport;
        },
      },
      viewport,
    ),
    false,
  );
  assert.equal(matchedSelector, CANVAS_POINTER_INTERACTIVE_SELECTOR);

  const button = { role: "button" };
  assert.equal(
    canvasTargetIsInteractiveControl({ closest: () => button }, viewport),
    true,
  );
  const expandedRegion = { canvasInteractive: true };
  assert.equal(
    canvasTargetIsInteractiveControl(
      { closest: () => expandedRegion },
      viewport,
    ),
    true,
  );
  assert.equal(
    canvasTargetIsInteractiveControl({ closest: () => null }, viewport),
    false,
  );
});

test("canvas transforms center fitted content and clamp panning at every edge", () => {
  assert.deepEqual(
    constrainCanvasTransform(
      { x: -200, y: 100, zoom: 0.5 },
      viewport,
      content,
    ),
    { x: 125, y: 75, zoom: 0.5 },
  );

  assert.deepEqual(
    panCanvasTransform(
      { x: 0, y: 0, zoom: 2 },
      { x: -900, y: -900 },
      viewport,
      content,
    ),
    { x: -500, y: -300, zoom: 2 },
  );
});

test("the minimap window follows the exact visible portion of the canvas", () => {
  assert.deepEqual(
    canvasViewportWindow(
      { x: -250, y: -150, zoom: 1 },
      viewport,
      { width: 1_000, height: 600 },
    ),
    { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
  );
  assert.deepEqual(
    canvasViewportWindow(
      { x: 50, y: 50, zoom: 1 },
      viewport,
      { width: 400, height: 200 },
    ),
    { x: 0, y: 0, width: 1, height: 1 },
  );
});

test("dragging the minimap window recenters the live canvas at the same ratio", () => {
  assert.deepEqual(
    centerCanvasTransformAtContentRatio(
      { x: 0, y: 0, zoom: 1 },
      { x: 0.75, y: 0.5 },
      viewport,
      { width: 1_000, height: 600 },
    ),
    { x: -500, y: -150, zoom: 1 },
  );
  assert.deepEqual(
    centerCanvasTransformAtContentRatio(
      { x: 0, y: 0, zoom: 1 },
      { x: Number.NaN, y: 2 },
      viewport,
      { width: 1_000, height: 600 },
    ),
    { x: -250, y: -300, zoom: 1 },
  );
});

test("a saved canvas viewport transform survives a presentation remount", () => {
  const pannedTransform = { x: -420, y: -680, zoom: 1.3 };
  assert.deepEqual(
    restoreCanvasViewportTransform(pannedTransform, 1),
    pannedTransform,
  );
  assert.deepEqual(
    restoreCanvasViewportTransform(
      { x: Number.NaN, y: -680, zoom: 1.3 },
      1.1,
    ),
    { x: 0, y: 0, zoom: 1.1 },
  );
});

test("cursor-anchored zoom preserves the content point under the cursor", () => {
  const next = zoomCanvasTransformAt(
    { x: 0, y: 0, zoom: 1 },
    2,
    { x: 100, y: 80 },
    viewport,
    content,
  );
  assert.deepEqual(next, { x: -100, y: -80, zoom: 2 });
  assert.equal((100 - next.x) / next.zoom, 100);
  assert.equal((80 - next.y) / next.zoom, 80);
});

test("canvas zoom changes the live render dimensions instead of scaling a finished layer", () => {
  assert.deepEqual(renderedCanvasSize(content, 1.5), {
    width: 750,
    height: 450,
  });
  assert.deepEqual(renderedCanvasSize(content, 99), {
    width: 1_250,
    height: 750,
  });
});

test("fit zoom respects content aspect and shared zoom bounds", () => {
  assert.equal(fitCanvasZoom(viewport, content), 1);
  assert.equal(
    fitCanvasZoom(viewport, { width: 1_000, height: 900 }, 0.2),
    1 / 3,
  );
  assert.equal(
    fitCanvasZoom(viewport, { width: 10_000, height: 10_000 }),
    0.5,
  );
});

test("fitting one canvas region centers it at a readable bounded zoom", () => {
  const focused = fitCanvasBoundsTransform(
    viewport,
    { width: 1_000, height: 600 },
    { x: 250, y: 150, width: 500, height: 300 },
    20,
  );
  assert.equal(focused.zoom, 13 / 15);
  assert.ok(Math.abs(focused.x + 183.33333333333331) < 0.000001);
  assert.equal(focused.y, -110);

  assert.deepEqual(
    fitCanvasBoundsTransform(
      viewport,
      { width: 1_000, height: 600 },
      { x: 400, y: 250, width: 100, height: 50 },
    ),
    { x: -200, y: -125, zoom: 1 },
  );
});

test("width fit fills the viewport initially without inheriting height fit", () => {
  assert.equal(
    fitCanvasWidthZoom(
      { width: 1_200, height: 700 },
      { width: 2_400, height: 3_000 },
      0.1,
      5,
    ),
    0.5,
  );
  assert.equal(
    fitCanvasWidthZoom(
      { width: 1_200, height: 700 },
      { width: 600, height: 300 },
      0.1,
      5,
    ),
    2,
  );
  assert.equal(
    fitCanvasWidthZoom(
      { width: 1_200, height: 700 },
      { width: 100, height: 300 },
      0.1,
      5,
    ),
    5,
  );
});

test("wheel deltas normalize lines and pages for the shared touchpad path", () => {
  assert.equal(wheelDeltaInPixels(3, 0, 400), 3);
  assert.equal(wheelDeltaInPixels(3, 1, 400), 48);
  assert.equal(wheelDeltaInPixels(2, 2, 400), 800);
});
