import assert from "node:assert/strict";
import test from "node:test";
import { timelineCommitPage } from "./eventTimeline.ts";

test("every exact commit remains reachable in a bounded inspector page", () => {
  for (let index = 0; index < 10000; index += 1) {
    const page = timelineCommitPage(10000, index);
    assert.ok(page.start <= index && page.end > index);
    assert.ok(page.end - page.start <= 32);
  }
  assert.deepEqual(timelineCommitPage(10000, 9999), { start: 9984, end: 10000 });
});
