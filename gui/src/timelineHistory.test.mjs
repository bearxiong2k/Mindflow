import assert from "node:assert/strict";
import test from "node:test";
import { timelineCommitTickGroups, timelineCommitPage } from "./timelineInteraction.ts";

test("dense history uses bounded markers whose ranges preserve every exact commit", () => {
  const positions = Array.from({ length: 10000 }, (_, index) => ({ x: index / 10 }));
  const groups = timelineCommitTickGroups(positions);
  assert.ok(groups.length <= 126);
  assert.equal(groups[0].first, 0);
  assert.equal(groups.at(-1).last, 9999);
  assert.equal(groups.reduce((sum, group) => sum + group.last - group.first + 1, 0), 10000);
  groups.forEach((group, index) => {
    assert.equal(group.x, positions[group.first].x);
    if (index) assert.equal(groups[index - 1].last + 1, group.first);
  });
});

test("wide history remains bounded; empty and sparse strips retain exact positions", () => {
  assert.deepEqual(timelineCommitTickGroups([]), []);
  assert.deepEqual(timelineCommitTickGroups([{ x: 12 }, { x: 40 }]), [
    { first: 0, last: 0, x: 12 }, { first: 1, last: 1, x: 40 },
  ]);
  assert.ok(timelineCommitTickGroups(Array.from({ length: 10000 }, (_, i) => ({ x: i * 100 }))).length <= 512);
});

test("every exact commit remains reachable in a bounded inspector page", () => {
  for (let index = 0; index < 10000; index += 1) {
    const page = timelineCommitPage(10000, index);
    assert.ok(page.start <= index && page.end > index);
    assert.ok(page.end - page.start <= 32);
  }
  assert.deepEqual(timelineCommitPage(10000, 9999), { start: 9984, end: 10000 });
});
