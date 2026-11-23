import assert from "node:assert/strict";
import test from "node:test";
import {
  clampReaderFontSize, defaultReaderFontSize, loadReaderFontSize,
  maxReaderFontSize, minReaderFontSize, readerFontSizeStorageKey, saveReaderFontSize,
} from "./readerPreferences.ts";

test("Reader font size defaults to 15px and rejects invalid stored sizes", () => {
  assert.equal(defaultReaderFontSize, 15);
  for (const value of [null, "", "bad", "NaN", "Infinity", "0", "11", "25", "15.5", '{"size":18}']) {
    assert.equal(loadReaderFontSize({ getItem: () => value }), 15, String(value));
  }
  for (let size = minReaderFontSize; size <= maxReaderFontSize; size += 1) {
    assert.equal(loadReaderFontSize({ getItem: () => String(size) }), size);
  }
});

test("Reader size adjustments stay within integer bounds", () => {
  for (const size of [-100, 11, 12]) assert.equal(clampReaderFontSize(size), 12);
  for (const size of [24, 25, 100]) assert.equal(clampReaderFontSize(size), 24);
  assert.equal(clampReaderFontSize(16.7), 17);
  for (const size of [NaN, Infinity, -Infinity]) assert.equal(clampReaderFontSize(size), 15);
});

test("Reader size persists separately from project preferences, including reset", () => {
  const projectKey = "mindflow:presentation-preferences:v8:project";
  const entries = new Map([[projectKey, "unchanged"]]);
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  assert.equal(saveReaderFontSize(18, storage), true);
  assert.equal(loadReaderFontSize(storage), 18);
  saveReaderFontSize(100, storage);
  assert.equal(loadReaderFontSize(storage), 24);
  saveReaderFontSize(defaultReaderFontSize, storage);
  assert.deepEqual([...entries], [[projectKey, "unchanged"], [readerFontSizeStorageKey, "15"]]);
});

test("Unavailable Reader preference storage can be distinguished from a default", () => {
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
  assert.equal(loadReaderFontSize(blocked), undefined);
  assert.equal(saveReaderFontSize(18, blocked), false);
  assert.equal(loadReaderFontSize(), undefined);
  assert.equal(saveReaderFontSize(18), false);
});
