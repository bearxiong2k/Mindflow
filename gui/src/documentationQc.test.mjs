import assert from "node:assert/strict";
import test from "node:test";
import { qcRows, qcSummary, qcSameWindow, qcHasWorkingTree, QC_PRESETS } from "./documentationQc.ts";

const sample = (lines, added_lines = null, deleted_lines = null) => ({ lines, bytes: lines * 12, documents: 1, added_lines, deleted_lines });
const file = (path, samples) => ({ path, kind: "file", samples });

test("QC keeps equal-size rewrites visible and separates working edits from changed commits", () => {
  const summary = qcSummary(file("docs/a.md", [sample(10), sample(10, 8, 8), sample(12, 2, 0)]));
  assert.equal(summary.growth, 2);
  assert.equal(summary.churn, 18);
  assert.equal(summary.changedCommits, 1);
  assert.equal(qcSummary(file("new.md", [sample(20)])).growth, null);
});

test("QC folder filtering respects path boundaries, avoids nested totals, and ranks activity independently of size", () => {
  const report = { points: [{ kind: "working-tree" }], entries: [
    { path: "docs", kind: "directory", samples: [sample(12)] },
    { path: "docs/deep", kind: "directory", samples: [sample(2)] },
    { path: "docs/deep/nested", kind: "directory", samples: [sample(1)] },
    file("docs/a.md", [sample(10), sample(10, 8, 8), sample(10, 0, 0)]),
    file("docs/deep/b.md", [sample(20), sample(21, 1, 0), sample(21, 0, 0)]),
    file("docs-other/c.md", [sample(90)]),
  ] };
  assert.deepEqual(qcRows(report, "docs", "file", "", "churn").map(({ entry }) => entry.path), ["docs/a.md", "docs/deep/b.md"]);
  assert.deepEqual(qcRows(report, "docs", "directory", "", "volume").map(({ entry }) => entry.path), ["docs/deep"]);
  assert.deepEqual(qcRows(report, "docs", "file", "B.MD", "volume").map(({ entry }) => entry.path), ["docs/deep/b.md"]);
});


test("QC historical endpoints include the final commit in change frequency", () => {
  const entry = file("docs/a.md", [sample(10), sample(12, 3, 1), sample(11, 0, 1)]);
  const result = qcSummary(entry, false);
  assert.equal(result.changedCommits, 2);
  assert.equal(result.growth, 1);
  assert.equal(result.added, 3);
  assert.equal(result.deleted, 2);
  assert.equal(qcSummary(file("docs/a.md", [sample(10)]), false).growth, null);
  assert.equal(qcHasWorkingTree({ points: [{ kind: "commit" }] }), false);
  assert.equal(qcHasWorkingTree({ points: [{ kind: "commit" }, { kind: "working-tree" }] }), true);
});

test("QC window identity separates presets, endpoints, and working edits", () => {
  assert.deepEqual(QC_PRESETS, [5, 10, 20, 30, 50, 100]);
  assert.equal(qcSameWindow({ kind: "recent", commits: 30 }, { kind: "recent", commits: 30 }), true);
  assert.equal(qcSameWindow({ kind: "recent", commits: 5 }, { kind: "recent", commits: 30 }), false);
  assert.equal(qcSameWindow({ kind: "range", start: "a", end: "b" }, { kind: "range", start: "a", end: "working-tree" }), false);
  assert.equal(qcSameWindow({ kind: "range", start: "a", end: "b" }, { kind: "range", start: "a", end: "b" }), true);
  assert.equal(qcSameWindow({ kind: "recent", commits: 5 }, { kind: "range", start: "a", end: "b" }), false);
});
