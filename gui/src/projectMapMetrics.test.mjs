import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStructureMetricsCommits, projectMapMetric, projectMapMetrics, projectMapMetricTextBounds, projectMapTrendGeometry, projectMapVolumeComparisons } from "./projectMapMetrics.ts";

const sample = (lines, added_lines = null, deleted_lines = null) => ({ lines, bytes: lines * 12, documents: 1, added_lines, deleted_lines });

test("chart footer uses row glyph extents when WebKit reports the whole label as each tspan's box", () => {
  const row = (glyphs) => ({
    getBBox: () => ({ x: -69, y: 1.5, width: 138, height: 123.5 }),
    getNumberOfChars: () => glyphs.length,
    getExtentOfChar: (index) => glyphs[index],
  });
  const first = row([
    { x: -58, y: 89.5, width: 11, height: 18 },
    { x: -47, y: 90, width: 35, height: 17.5 },
    { x: -12, y: 89.5, width: 70, height: 18 },
  ]);
  const last = row([{ x: -54, y: 107.1, width: 108, height: 18 }]);
  assert.deepEqual(first.getBBox(), last.getBBox());
  assert.deepEqual(projectMapMetricTextBounds(first), { x: -58, y: 89.5, width: 116, height: 18 });
  assert.deepEqual(projectMapMetricTextBounds(last), { x: -54, y: 107.1, width: 108, height: 18 });
  // The volume row ends at 71.9; the chart starts below it, not halfway through
  // the whole 123.5px label as the enclosing-box measurement would place it.
  assert.ok(projectMapMetricTextBounds(first).y > 71.9);
});

test("chart row bounds reject absent or nonfinite glyph geometry", () => {
  assert.equal(projectMapMetricTextBounds({ getNumberOfChars: () => 0 }), undefined);
  assert.equal(projectMapMetricTextBounds({
    getNumberOfChars: () => 1,
    getExtentOfChar: () => ({ x: 0, y: NaN, width: 12, height: 18 }),
  }), undefined);
});

test("Structure metrics preserve unknown growth without a Git baseline", () => {
  const metric = projectMapMetric({ path: "docs/new.md", kind: "file", samples: [sample(12)] });
  assert.equal(metric.lines, "12");
  assert.equal(metric.growth, null);
  assert.equal(metric.signedGrowth, "—");
  assert.equal(metric.direction, "unknown");
  assert.equal(metric.currentLines, 12);
  assert.equal(metric.bytes, 144);
  assert.match(metric.description, /No Git growth baseline/);
  assert.doesNotMatch(metric.description, /0 lines net growth/);
});

test("Structure numbers preserve shrinking, flat rewrites, and folder scope", () => {
  const shrinking = projectMapMetric({ path: "docs", kind: "directory", samples: [sample(20), sample(20, 8, 8), sample(10, 0, 10)] });
  assert.equal(shrinking.signedGrowth, "-10");
  assert.equal(shrinking.direction, "shrink");
  assert.equal(shrinking.addedLines, 8);
  assert.equal(shrinking.deletedLines, 18);
  assert.match(shrinking.description, /registered documents beneath this folder/);
  assert.match(shrinking.description, /8 added and 18 deleted/);
  const empty = projectMapMetric({ path: "docs/empty.md", kind: "file", samples: [sample(0), sample(0, 0, 0)] });
  assert.equal(empty.signedGrowth, "0");
  assert.equal(empty.volumeLabel, "0 lines · 0 B");
  assert.equal(empty.growthLabel, "Δ 0 · +0 / −0");
  assert.equal(empty.direction, "flat");
});

test("Structure trends distinguish absent history from an observed flat or empty file", () => {
  const absent = projectMapTrendGeometry([]);
  assert.equal(absent.hasHistory, false);
  assert.deepEqual(absent.samples, []);
  assert.equal(absent.points, "");
  assert.equal(absent.areaPath, "");
  assert.equal(absent.endpoint, null);
  const single = projectMapTrendGeometry([120]);
  assert.equal(single.hasHistory, false);
  assert.equal(single.samples[0].x, single.width / 2);
  assert.equal(single.baselineY, null);
  assert.equal(single.areaPath, "");
  const zero = projectMapTrendGeometry([0, 0, 0]);
  assert.equal(zero.hasHistory, true);
  assert.equal(zero.minLines, 0);
  assert.ok(zero.maxLines > 0);
  assert.ok(zero.samples.every(({ y }) => y === zero.baselineY && Number.isFinite(y)));
  assert.match(zero.areaPath, / Z$/);
  const flat = projectMapTrendGeometry([120, 120, 120]);
  assert.ok(flat.samples.every(({ y }) => y === flat.baselineY));
  assert.ok(flat.maxLines - flat.minLines >= 12);
});

test("Structure trend preserves local peaks and equal sample spacing with an honest small-change scale", () => {
  const peak = projectMapTrendGeometry([10, 40, 10, 20]);
  assert.ok(peak.samples[1].y < peak.samples[0].y);
  assert.equal(peak.samples[0].y, peak.samples[2].y);
  assert.ok(peak.samples[3].y > peak.samples[1].y);
  assert.ok(peak.samples[3].y < peak.samples[2].y);
  assert.equal(peak.samples[1].x - peak.samples[0].x, peak.samples[2].x - peak.samples[1].x);
  assert.deepEqual(peak.endpoint, { x: peak.samples[3].x, y: peak.samples[3].y });
  const small = projectMapTrendGeometry([1000, 1001]);
  assert.ok(small.maxLines - small.minLines >= 100.1);
  assert.ok(Math.abs(small.samples[1].y - small.samples[0].y) < 1);
  const large = projectMapTrendGeometry([1000, 2000]);
  assert.ok(Math.abs(large.samples[1].y - large.samples[0].y) > large.height / 2);
  const scaled = projectMapTrendGeometry([10, 40, 10], 200, 48);
  assert.equal(scaled.width, 200);
  assert.equal(scaled.height, 48);
  assert.ok(scaled.samples.every(({ x, y }) => x >= 0 && x <= 200 && y >= 0 && y <= 48));
  assert.throws(() => projectMapTrendGeometry([1, Infinity]), /finite/);
  assert.throws(() => projectMapTrendGeometry([1], 0), /positive/);
});

test("Structure volume bars compare only visible same-kind peers without double-counting IDs", () => {
  const entries = [
    ["a", "file", 100], ["b", "file", 50], ["hidden", "file", 10000],
    ["folder", "directory", 5000], ["hidden-folder", "directory", 20000],
  ];
  const metrics = { key: "snapshot", byComponentId: new Map(entries.map(([id, kind, lines]) =>
    [id, projectMapMetric({ path: id, kind, samples: [sample(lines)] })])) };
  const bars = projectMapVolumeComparisons(metrics, ["a", "b", "folder", "a", "missing"]);
  assert.deepEqual([...bars.keys()], ["a", "b", "folder"]);
  assert.deepEqual(bars.get("a"), { maximumLines: 100, peerCount: 2, ratio: 1 });
  assert.deepEqual(bars.get("b"), { maximumLines: 100, peerCount: 2, ratio: 0.5 });
  assert.deepEqual(bars.get("folder"), { maximumLines: 5000, peerCount: 1, ratio: 1 });
  assert.equal(projectMapVolumeComparisons(metrics, []).size, 0);
  const zeros = { key: "zero", byComponentId: new Map([["a", projectMapMetric({ path: "a", kind: "file", samples: [sample(0)] })]]) };
  assert.deepEqual(projectMapVolumeComparisons(zeros, ["a"]).get("a"), { maximumLines: 0, peerCount: 1, ratio: 0 });
});

test("Structure metric details retain exact baseline/end identities and historical-end exclusions", () => {
  const baseline = { kind: "commit", commit: "a".repeat(40), timestamp: 0, subject: "Initial volume" };
  const end = { kind: "commit", commit: "b".repeat(40), timestamp: 60, subject: "Reworked volume" };
  const report = { points: [baseline, end], shallow_history: true, history_truncated: true };
  const entry = { path: "docs/a.md", kind: "file", samples: [sample(10), sample(12, 5, 3)] };
  const metric = projectMapMetric(entry, report);
  assert.equal(metric.direction, "growth");
  assert.equal(metric.includesWorkingTree, false);
  assert.equal(metric.commitsCovered, 2);
  assert.deepEqual(metric.baseline, baseline);
  assert.deepEqual(metric.end, end);
  assert.ok(metric.description.includes(baseline.commit));
  assert.ok(metric.description.includes(end.commit));
  assert.match(metric.description, /1970-01-01T00:00:00.000Z/);
  assert.match(metric.description, /Shallow Git history/);
  assert.match(metric.description, /Current registered document paths only; renames are not followed/);
  assert.doesNotMatch(metric.description, /including captured working edits/);
  const withWorking = projectMapMetric(entry, { ...report, points: [baseline, { kind: "working-tree", commit: null, timestamp: null, subject: "Working tree" }] });
  assert.equal(withWorking.includesWorkingTree, true);
  assert.match(withWorking.description, /including uncommitted edits/);
});

test("Structure window uses only the six independent recent presets", () => {
  for (const value of [5, 10, 20, 30, 50, 100]) assert.equal(normalizeStructureMetricsCommits(value), value);
  for (const value of [undefined, "10", 0, 200, Infinity, NaN]) assert.equal(normalizeStructureMetricsCommits(value), 30);
});

test("Structure metrics map only measured documents and folder totals to ordinary paths", () => {
  const report = {snapshot: {id: "snapshot-a"}, window: {kind: "recent", commits: 30}, entries: [
    {path: "", kind: "directory", samples: [sample(12)]},
    {path: "docs", kind: "directory", samples: [sample(12)]},
    {path: "docs/a.md", kind: "file", samples: [sample(12)]},
  ]};
  const components = [
    {id: "root", kind: "directory", binding: {kind: "directory", value: "."}},
    {id: "context", kind: "directory", binding: {kind: "directory", value: "docs"}, managed: false},
    {id: "doc", kind: "document", binding: {kind: "path", value: "docs/a.md"}, managed: true},
    {id: "unmeasured", kind: "document", binding: {kind: "path", value: "docs/b.md"}, managed: true},
    {id: "unmanaged", kind: "document", binding: {kind: "path", value: "docs/a.md"}, managed: false},
    {id: "external", kind: "target", binding: {kind: "path", value: "docs/a.md"}, managed: true},
  ];
  assert.equal(projectMapMetrics(components, undefined), undefined);
  const metrics = projectMapMetrics(components, report);
  assert.deepEqual([...metrics.byComponentId.keys()], ["root", "context", "doc"]);
  assert.notEqual(metrics.key, projectMapMetrics(components, {...report, window: {kind: "recent", commits: 10}}).key);
  assert.notEqual(metrics.key, projectMapMetrics(components, {...report, snapshot: {id: "snapshot-b"}}).key);
});

test("metrics reach overview, projected, and expanded charts while off restores original source", async () => {
  const { projectMapFor, deriveProjectMapFocusProjection } = await import("./projectMapNavigation.ts");
  const { buildProjectMapMermaidGraph, PROJECT_MAP_METRIC_TREND_SPACE, PROJECT_MAP_METRIC_SIZE_SPACE } = await import("./projectMapMermaid.ts");
  const map = projectMapFor({ structure: { nodes: [
    {path: ".", name: "Project", kind: "directory"},
    {path: "docs", name: "docs", kind: "directory", parent_path: ".", component: {id: "docs", description: "Folder description stays in the hover card", index: false}},
    {path: "docs/a.md", name: "a.md", kind: "document", parent_path: "docs", component: {id: "a", description: "Document description stays in the hover card", index: false}},
  ], relationships: []}});
  const report = {snapshot: {id: "snapshot-a"}, window: {kind: "recent", commits: 30}, entries: [
    {path: "", kind: "directory", samples: [sample(10), sample(12, 4, 2)]},
    {path: "docs", kind: "directory", samples: [sample(10), sample(12, 4, 2)]},
    {path: "docs/a.md", kind: "file", samples: [sample(10), sample(12, 4, 2)]},
  ]};
  const metrics = projectMapMetrics(map.components, report);
  for (const [focus, depth] of [[map.root, 1], ["docs", 1], [map.root, 2]]) {
    const projection = deriveProjectMapFocusProjection(map, focus, new Set(), true, undefined, depth);
    const plain = buildProjectMapMermaidGraph(projection, "td", 1);
    const measured = buildProjectMapMermaidGraph(projection, "td", 1, metrics);
    assert.ok(measured.source.includes(`${PROJECT_MAP_METRIC_TREND_SPACE}<br/>${PROJECT_MAP_METRIC_SIZE_SPACE}`));
    assert.equal(measured.metrics.byComponentId.get("a").currentLines, 12);
    assert.equal(measured.metrics.byComponentId.get("a").growth, 2);
    assert.equal(measured.metrics.byComponentId.get("a").trend.samples.length, 2);
    assert.doesNotMatch(plain.source, /description stays in the hover card|Unmanaged folder context/);
    assert.doesNotMatch(measured.source, /description stays in the hover card|Unmanaged folder context/);
    for (const component of [...measured.nodeByKey.values(), ...measured.layerByKey.values()]) {
      if (component.managed) assert.match(component.description, /description stays in the hover card/);
    }
    assert.match(measured.source, /%% QC snapshot-a/);
    assert.doesNotMatch(plain.source, /lines ·|%% QC/);
    assert.equal(plain.source, buildProjectMapMermaidGraph(projection, "td", 1, undefined).source);
    const nextWindow = projectMapMetrics(map.components, {...report, window: {kind: "recent", commits: 10}});
    assert.notEqual(measured.source, buildProjectMapMermaidGraph(projection, "td", 1, nextWindow).source);
    if (depth === 2) {
      assert.equal(measured.layerByKey.size, 1);
      assert.ok(measured.source.split("\n").some((line) => line.includes("subgraph") && line.includes(PROJECT_MAP_METRIC_TREND_SPACE)));
    }
  }
});
