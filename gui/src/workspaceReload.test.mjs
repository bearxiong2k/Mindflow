import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceReloadQueue } from "./workspaceReload.ts";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test("focus checks coalesce without foreground loading state", async () => {
  const gate = deferred();
  const calls = [];
  const indicators = [];
  const reload = createWorkspaceReloadQueue(async (activate) => {
    calls.push(activate);
    await gate.promise;
  }, (busy) => indicators.push(busy));
  const first = reload(false);
  assert.equal(reload(false), first);
  gate.resolve();
  await first;
  assert.deepEqual(calls, [false]);
  assert.deepEqual(indicators, []);
  await reload(false);
  assert.deepEqual(calls, [false, false]);
});

test("explicit Refresh waits behind a focus check, with one stable foreground indicator", async () => {
  const background = deferred();
  const foreground = deferred();
  const started = deferred();
  const calls = [];
  const indicators = [];
  const reload = createWorkspaceReloadQueue(async (activate) => {
    calls.push(activate);
    if (activate) { started.resolve(); await foreground.promise; }
    else await background.promise;
  }, (busy) => indicators.push(busy));
  const passive = reload(false);
  const explicit = reload(true);
  assert.notEqual(explicit, passive);
  assert.equal(reload(true), explicit);
  assert.equal(reload(false), explicit);
  assert.deepEqual(indicators, [true]);
  background.resolve();
  await started.promise;
  assert.deepEqual(calls, [false, true]);
  assert.deepEqual(indicators, [true]);
  foreground.resolve();
  await explicit;
  assert.deepEqual(indicators, [true, false]);
});

test("failed passive checks cannot swallow an explicit Refresh or leave its indicator stuck", async () => {
  const gate = deferred();
  const calls = [];
  const indicators = [];
  const reload = createWorkspaceReloadQueue(async (activate) => {
    calls.push(activate);
    if (!activate) await gate.promise;
    else throw new Error("Refresh failed");
  }, (busy) => indicators.push(busy));
  const passive = reload(false);
  const explicit = reload(true);
  gate.reject(new Error("Passive check failed"));
  await assert.rejects(passive, /Passive check failed/);
  await assert.rejects(explicit, /Refresh failed/);
  assert.deepEqual(calls, [false, true]);
  assert.deepEqual(indicators, [true, false]);
});
