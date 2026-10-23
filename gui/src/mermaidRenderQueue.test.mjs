import assert from "node:assert/strict";
import test from "node:test";
import { createMermaidRenderQueue } from "./mermaidRenderQueue.ts";

function gate() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

test("foreground graphs pass queued preloads while Mermaid stays serialized", async () => {
  const enqueue = createMermaidRenderQueue();
  const started = gate();
  const finish = gate();
  const order = [];
  const first = enqueue(async () => { order.push("running"); started.release(); await finish.promise; });
  await started.promise;
  const background = enqueue(async () => { order.push("preload"); }, { priority: () => "background" });
  const foreground = enqueue(async () => { order.push("active"); });
  assert.deepEqual(order, ["running"]);
  finish.release();
  await Promise.all([first, background, foreground]);
  assert.deepEqual(order, ["running", "active", "preload"]);
});

test("obsolete queued graphs never reach the layout engine", async () => {
  const enqueue = createMermaidRenderQueue();
  const started = gate();
  const finish = gate();
  const first = enqueue(async () => { started.release(); await finish.promise; });
  await started.promise;
  const obsolete = Array.from({ length: 10 }, () => new AbortController());
  let layouts = 0;
  const outcomes = obsolete.map((controller) => assert.rejects(
    enqueue(async () => { layouts++; }, { signal: controller.signal }), { name: "AbortError" },
  ));
  obsolete.forEach((controller) => controller.abort());
  const active = enqueue(async () => { layouts++; return "current"; });
  finish.release();
  assert.equal(await active, "current");
  await Promise.all([first, ...outcomes]);
  assert.equal(layouts, 1);
});

test("a preload becomes foreground when navigation chooses it", async () => {
  const enqueue = createMermaidRenderQueue();
  const order = [];
  let selected = "other";
  const stalePreload = enqueue(async () => { order.push("other"); }, { priority: () => "background" });
  const chosen = enqueue(async () => { order.push("chosen"); }, {
    priority: () => selected === "chosen" ? "foreground" : "background",
  });
  selected = "chosen";
  await Promise.all([stalePreload, chosen]);
  assert.deepEqual(order, ["chosen", "other"]);
});

test("aborted running layouts settle before another layout starts and failures do not poison the queue", async () => {
  const enqueue = createMermaidRenderQueue();
  const controller = new AbortController();
  const started = gate();
  const finish = gate();
  let nextStarted = false;
  const first = assert.rejects(enqueue(async () => {
    started.release(); await finish.promise; return "obsolete";
  }, { signal: controller.signal }), { name: "AbortError" });
  await started.promise;
  controller.abort();
  const next = enqueue(async () => { nextStarted = true; throw new Error("bad graph"); });
  const failed = assert.rejects(next, /bad graph/);
  assert.equal(nextStarted, false);
  finish.release();
  await Promise.all([first, failed]);
  assert.equal(await enqueue(async () => "valid"), "valid");
});
