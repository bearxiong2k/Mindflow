import assert from "node:assert/strict";
import test from "node:test";
import { createDocumentationQcCache } from "./documentationQcCache.ts";
import { qcSummary } from "./documentationQc.ts";

const recent = (commits) => ({ kind: "recent", commits });
function report(root = "/a", snapshot = "a", window = recent(5)) {
  return { schema: "mindflow-documentation-qc/v2", root, snapshot: { id: snapshot }, window,
    history_truncated: false, shallow_history: false,
    points: [...Array.from({ length: window.commits ?? 2 }, (_, index) => ({ kind: "commit", commit: String(index) })), { kind: "working-tree" }],
    entries: [{ path: "", kind: "directory", samples: Array.from({ length: (window.commits ?? 2) + 1 }, (_, index) =>
      ({ documents: 1, lines: index + 10, bytes: 100, added_lines: index ? 3 : null, deleted_lines: index ? 2 : null })) }],
  };
}
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test("QC and graph share pending and completed observations across repeated opens", async () => {
  let calls = 0;
  const pending = deferred();
  const cache = createDocumentationQcCache(() => { calls++; return pending.promise; });
  const first = cache.load("/a", "a", recent(5));
  assert.equal(cache.load("/a", "a", recent(5)), first);
  pending.resolve(report());
  const result = await first;
  assert.equal(cache.peek("/a", "a", recent(5)), result);
  assert.equal(await cache.load("/a", "a", recent(5)), result);
  assert.equal(calls, 1);
});

test("smaller presets reuse exact suffix samples and reset baseline changes", async () => {
  let calls = 0;
  const cache = createDocumentationQcCache(async (...args) => { calls++; return report(...args); });
  const full = await cache.load("/a", "a", recent(10));
  const small = await cache.load("/a", "a", recent(5));
  assert.equal(calls, 1);
  assert.equal(small.points.length, 6);
  assert.equal(small.points[0].commit, "5");
  assert.equal(small.history_truncated, true);
  assert.equal(small.entries[0].samples[0].added_lines, null);
  assert.equal(qcSummary(small.entries[0]).added, 15);
  assert.equal(full.entries[0].samples[5].added_lines, 3);
  assert.equal(cache.peek("/a", "a", recent(5)), small);
});

test("refresh and new snapshots discard completed results and late responses", async () => {
  const pending = [];
  const cache = createDocumentationQcCache(() => { const next = deferred(); pending.push(next); return next.promise; });
  const old = cache.load("/a", "a", recent(5));
  cache.invalidate("/a");
  const refreshed = cache.load("/a", "a", recent(5));
  pending[0].resolve(report());
  await old;
  assert.equal(cache.peek("/a", "a", recent(5)), undefined);
  pending[1].resolve(report());
  await refreshed;
  const newer = cache.load("/a", "b", recent(5));
  assert.equal(cache.peek("/a", "a", recent(5)), undefined);
  pending[2].resolve(report("/a", "b"));
  await newer;
  assert.equal(cache.peek("/a", "b", recent(5)).snapshot.id, "b");
});

test("failed and mismatched responses remain retryable without poisoning other roots", async () => {
  let calls = 0;
  const cache = createDocumentationQcCache(async (...args) => {
    calls++;
    if (calls === 1) throw new Error("Unavailable Git history");
    if (calls === 2) return report("/wrong");
    return report(...args);
  });
  await assert.rejects(cache.load("/a", "a", recent(5)), /Unavailable/);
  await assert.rejects(cache.load("/a", "a", recent(5)), /no longer matches/);
  await cache.load("/b", "b", recent(5));
  assert.equal(cache.peek("/a", "a", recent(5)), undefined);
  assert.equal((await cache.load("/a", "a", recent(5))).root, "/a");
  assert.equal(cache.peek("/b", "b", recent(5)).root, "/b");
});

test("custom endpoints never reuse another range and completed observations stay bounded", async () => {
  let calls = 0;
  const cache = createDocumentationQcCache(async (...args) => { calls++; return report(...args); });
  const range = { kind: "range", start: "one", end: "two" };
  await cache.load("/a", "a", range);
  await cache.load("/a", "a", { ...range, end: "working-tree" });
  assert.equal(calls, 2);
  for (let n = 1; n <= 5; n++) await cache.load("/a", "a", recent(n));
  assert.equal(cache.peek("/a", "a", range), undefined);
  for (const root of ["/b", "/c", "/d", "/e"]) await cache.load(root, "a", recent(5));
  assert.equal(cache.peek("/a", "a", recent(5)), undefined);
});
