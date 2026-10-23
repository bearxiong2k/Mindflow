import assert from "node:assert/strict";
import test from "node:test";
import { interfaceHelpStorageKey, loadInterfaceHelp, saveInterfaceHelp } from "./interfaceHelp.ts";

test("Help defaults off for missing or malformed local preferences", () => {
  for (const value of [null, "", "false", "1", "TRUE", "{broken", '{"enabled":true}']) {
    assert.equal(loadInterfaceHelp({ getItem: () => value }), false);
  }
  assert.equal(loadInterfaceHelp({ getItem: () => "true" }), true);
});

test("Help persists independently of project preferences and tolerates blocked storage", () => {
  const entries = new Map([["mindflow:presentation-preferences:v8:project", "unchanged"]]);
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  saveInterfaceHelp(true, storage);
  assert.equal(loadInterfaceHelp(storage), true);
  saveInterfaceHelp(false, storage);
  assert.equal(loadInterfaceHelp(storage), false);
  assert.deepEqual([...entries], [["mindflow:presentation-preferences:v8:project", "unchanged"], [interfaceHelpStorageKey, "false"]]);
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(loadInterfaceHelp(blocked), undefined);
  assert.equal(saveInterfaceHelp(true, blocked), false);
});
