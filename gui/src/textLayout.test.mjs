import assert from "node:assert/strict";
import test from "node:test";
import { wrapLabelText } from "./textLayout.ts";

test("graph filenames break at name segments and keep their final extension", () => {
  for (const [value, expected] of [
    ["structuralist-artifact-recognition.md", ["structuralist-artifact-", "recognition.md"]],
    ["historical_region_inspection.md", ["historical_region_", "inspection.md"]],
    ["com.example.very.long.component.identifier.ts", ["com.example.very.long.", "component.identifier.ts"]],
    ["canonical_docs/10-human-interface.md", ["canonical_docs/10-", "human-interface.md"]],
  ]) {
    const lines = wrapLabelText(value, 13.6);
    assert.deepEqual(lines, expected);
    assert.equal(lines.join(""), value);
  }
});

test("prose balances natural words and preserves all words beyond two lines", () => {
  assert.deepEqual(wrapLabelText("records accepted reasoning for", 12),
    ["records accepted", "reasoning for"]);
  assert.deepEqual(wrapLabelText("applies decision pressure to", 12),
    ["applies decision", "pressure to"]);
  assert.deepEqual(wrapLabelText("tracks development of", 12 / 1.4),
    ["tracks", "development of"]);
  const value = "Each ordinary entry has exact authored language that remains available in full";
  const lines = wrapLabelText(value, 12);
  assert.ok(lines.length > 2);
  assert.equal(lines.join(" "), value);
});

test("oversized identifiers use balanced fallback without orphaning an extension", () => {
  const value = "a".repeat(80) + ".md";
  const lines = wrapLabelText(value, 10);
  assert.equal(lines.join(""), value);
  assert.ok(lines.every((line) => line.length > 5 && line.length < 20));
  assert.match(lines.at(-1), /a\.md$/);
});

test("emergency wrapping keeps combining marks and emoji sequences together", () => {
  for (const grapheme of ["e\u0301", "👨‍👩‍👧‍👦", "🇨🇳", "👍🏽"]) {
    const value = grapheme.repeat(30);
    const lines = wrapLabelText(value, 8);
    assert.equal(lines.join(""), value);
    for (const line of lines) assert.equal(line.replaceAll(grapheme, ""), "");
  }
});

test("mixed CJK text does not start lines with closing punctuation or end with opening punctuation", () => {
  const value = "这是一个（中文标点）需要保持正确换行的文件.md";
  const lines = wrapLabelText(value, 8);
  assert.equal(lines.join(""), value);
  assert.ok(lines.every((line) => !/^[）。，]/u.test(line) && !/[（]$/u.test(line)));
});

test("wrapping long values remains bounded and empty labels remain empty", () => {
  assert.deepEqual(wrapLabelText(" \n ", 12), []);
  const value = "long_name-".repeat(1000) + "file.md";
  const lines = wrapLabelText(value, 13.6);
  assert.equal(lines.join(""), value);
  assert.ok(lines.length > 100);
});
