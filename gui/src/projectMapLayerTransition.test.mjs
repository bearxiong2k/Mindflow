import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createProjectMapLayerNavigationGate,
  DEFAULT_PROJECT_MAP_LAYER_ORIGIN,
  PROJECT_MAP_LAYER_ENTRY_TRANSITION_MS,
  PROJECT_MAP_LAYER_EXIT_TRANSITION_MS,
  projectMapLayerGeometry,
  projectMapLayerOrigin,
  projectMapLayerSnapshotFrame,
  projectMapLayerTransitionMilliseconds,
} from "./projectMapLayerTransition.ts";

function assertNear(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < 1e-12,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

test("Structure return is a slightly quicker inverse transition", () => {
  assert.equal(PROJECT_MAP_LAYER_ENTRY_TRANSITION_MS, 160);
  assert.equal(PROJECT_MAP_LAYER_EXIT_TRANSITION_MS, 140);
  assert.equal(projectMapLayerTransitionMilliseconds("preparing"), 160);
  assert.equal(projectMapLayerTransitionMilliseconds("entering"), 160);
  assert.equal(projectMapLayerTransitionMilliseconds("closing"), 140);
  assert.ok(
    PROJECT_MAP_LAYER_EXIT_TRANSITION_MS <
      PROJECT_MAP_LAYER_ENTRY_TRANSITION_MS,
  );
});

test("Structure return crossfades the outgoing canvas before its handoff", async () => {
  const styles = await readFile(
    new URL("./styles.css", import.meta.url),
    "utf8",
  );
  const zoomOutStart = styles.indexOf(
    "@keyframes project-map-layer-zoom-out",
  );
  const zoomOutEnd = styles.indexOf(
    "@keyframes project-map-backdrop-surface",
    zoomOutStart,
  );
  const zoomOutKeyframes = styles.slice(zoomOutStart, zoomOutEnd);

  assert.notEqual(zoomOutStart, -1);
  assert.notEqual(zoomOutEnd, -1);
  assert.match(
    zoomOutKeyframes,
    /@keyframes project-map-layer-handoff\s*\{[\s\S]*52%\s*\{\s*opacity:\s*1;[\s\S]*to\s*\{\s*opacity:\s*0;/,
  );
  assert.match(
    styles,
    /\.project-map-focus-layer\.is-entering,\s*\.project-map-focus-layer\.is-closing\s*\{\s*will-change:\s*transform, opacity;/,
  );
  assert.match(
    styles,
    /project-map-layer-handoff var\(--project-map-layer-duration, 140ms\)\s*cubic-bezier\(0\.42, 0, 1, 1\) both;/,
  );
});

test("only the latest prepared Structure navigation can commit", async () => {
  const gate = createProjectMapLayerNavigationGate();
  const committed = [];
  let releaseFirst;
  let releaseSecond;
  const firstReady = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const secondReady = new Promise((resolve) => {
    releaseSecond = resolve;
  });

  const firstRevision = gate.begin();
  const firstCommit = gate.commitWhenReady(firstRevision, firstReady, () => {
    committed.push("first");
  });
  const secondRevision = gate.begin();
  const secondCommit = gate.commitWhenReady(
    secondRevision,
    secondReady,
    () => {
      committed.push("second");
    },
  );

  releaseFirst();
  assert.equal(await firstCommit, false);
  releaseSecond();
  assert.equal(await secondCommit, true);
  assert.deepEqual(committed, ["second"]);
});

test("cancelled Structure navigation cannot commit after preparation", async () => {
  const gate = createProjectMapLayerNavigationGate();
  const revision = gate.begin();
  gate.cancel();
  let committed = false;

  assert.equal(
    await gate.commitWhenReady(revision, Promise.resolve(), () => {
      committed = true;
    }),
    false,
  );
  assert.equal(committed, false);
});

test("Structure focus layers originate at the activated node rectangle", () => {
  assert.deepEqual(
    projectMapLayerOrigin(
      { left: 300, top: 150, width: 200, height: 100 },
      { left: 100, top: 50, width: 1_000, height: 500 },
    ),
    { left: 0.2, top: 0.2, width: 0.2, height: 0.2 },
  );
});

test("Structure entry maps the whole child canvas center onto the activated node center", () => {
  const origin = { left: 0.2, top: 0.1, width: 0.15, height: 0.08 };
  const geometry = projectMapLayerGeometry(origin);

  assertNear(
    geometry.translateX + geometry.scaleX / 2,
    origin.left + origin.width / 2,
    "mapped horizontal center",
  );
  assertNear(
    geometry.translateY + geometry.scaleY / 2,
    origin.top + origin.height / 2,
    "mapped vertical center",
  );
  assertNear(geometry.scaleX, geometry.scaleY, "uniform zoom scale");
  assert.equal(geometry.clipBottom, 0);
  assert.equal(geometry.clipLeft, 0);
  assert.equal(geometry.clipRight, 0);
  assert.equal(geometry.clipTop, 0);
});

test("Structure entry geometry is invariant under interface scaling", () => {
  const origin = { left: 0.2, top: 0.1, width: 0.15, height: 0.08 };
  const base = projectMapLayerGeometry(origin);
  const scaled = projectMapLayerGeometry({ ...origin });

  assert.deepEqual(scaled, base);
});

test("Structure snapshots preserve exact rendered CSS geometry without a zoom round trip", () => {
  assert.deepEqual(
    projectMapLayerSnapshotFrame(
      {
        height: "423.3px",
        transform: "translate3d(0px, 46.8501px, 0px)",
        width: "787px",
      },
      { height: 423, width: 787 },
    ),
    {
      height: "423.3px",
      transform: "translate3d(0px, 46.8501px, 0px)",
      width: "787px",
    },
  );
});

test("Structure snapshots have a deterministic untransformed frame fallback", () => {
  assert.deepEqual(
    projectMapLayerSnapshotFrame(
      { height: "", transform: "", width: "" },
      { height: 423, width: 787 },
    ),
    {
      height: "423px",
      transform: "translate3d(0, 0, 0)",
      width: "787px",
    },
  );
});

test("Structure entry keeps the whole child canvas uniformly inside the activated node", () => {
  const origin = { left: 0.2, top: 0.1, width: 0.15, height: 0.08 };

  assert.deepEqual(
    projectMapLayerGeometry(origin),
    {
      clipBottom: 0,
      clipLeft: 0,
      clipRight: 0,
      clipTop: 0,
      scaleX: 0.08,
      scaleY: 0.08,
      translateX: 0.23500000000000001,
      translateY: 0.1,
    },
  );
});

test("Structure focus layers use only the visible portion of a clipped node", () => {
  assert.deepEqual(
    projectMapLayerOrigin(
      { left: 40, top: 20, width: 120, height: 90 },
      { left: 100, top: 50, width: 1_000, height: 500 },
    ),
    { left: 0, top: 0, width: 0.06, height: 0.12 },
  );
});

test("non-pointer Structure entry keeps a bounded central fallback", () => {
  assert.deepEqual(
    projectMapLayerOrigin(undefined, {
      left: 100,
      top: 50,
      width: 1_000,
      height: 500,
    }),
    DEFAULT_PROJECT_MAP_LAYER_ORIGIN,
  );
});

test("Structure prepares the inert snapshot during idle time and reuses it on activation", async () => {
  const source = await readFile(
    new URL("./components/ProjectMapView.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /scheduleProjectMapSnapshotPreparation\(\(\) => \{[\s\S]*projectMapLayerSnapshotMarkup\(content\)[\s\S]*preparedLayerSnapshotRef\.current =/,
  );
  assert.match(
    source,
    /prepared\?\.projectionKey === projectionKey[\s\S]*\? prepared\.markup[\s\S]*: projectMapLayerSnapshotMarkup\(content\)/,
  );
  assert.match(
    source,
    /markStructureTiming\(navigationRevision, "activation"\);[\s\S]*captureCurrentLayer\(\);[\s\S]*"snapshot-ready"/,
  );
});

test("Structure caches the annotated interactive SVG and measured size", async () => {
  const source = await readFile(
    new URL("./components/ProjectMapMermaidCanvas.tsx", import.meta.url),
    "utf8",
  );
  const renderCompletion = source.slice(
    source.indexOf(".then(async ({ svg }) =>"),
    source.indexOf(".catch((error: unknown)", source.indexOf(".then(async ({ svg }) =>")),
  );

  assert.match(
    renderCompletion,
    /const interactiveSvg = await interactiveMermaidSvg\([\s\S]*const size = mermaidSvgSize\(interactiveSvg\)/,
  );
  assert.match(
    renderCompletion,
    /svg: interactiveSvg,[\s\S]*size,[\s\S]*renderCacheRef\.current\.set\(targetRenderKey, nextState\)/,
  );
  assert.doesNotMatch(
    source,
    /useMemo\(\s*\(\) =>\s*interactiveMermaidSvg/,
  );
  assert.match(
    source,
    /requestRenderedGraph\(\s*preloadGraph,[\s\S]*mindflow:structure:destination-prepared/,
  );

  const view = await readFile(
    new URL("./components/ProjectMapView.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    view,
    /const prepareComponentGraph = useCallback[\s\S]*preloadGraph=\{intentPreloadGraph\}[\s\S]*onPrepare=\{prepareComponentGraph\}/,
  );
});

test("Structure keeps one frozen backdrop DOM through every transition phase", async () => {
  const source = await readFile(
    new URL("./components/ProjectMapView.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /const backdropMarkup = useMemo\([\s\S]*\[currentLayerEntry\?\.snapshot\?\.markup\]/,
  );
  assert.match(source, /dangerouslySetInnerHTML=\{backdropMarkup\}/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML=\{\{/);
  assert.match(source, /if \(!currentRenderedGraph \|\| layerAnimation\) return;/);
});
