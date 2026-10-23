import assert from "node:assert/strict";
import test from "node:test";
import {
  nearestVisibleProjectPath,
  projectFilesAncestorPaths,
  projectFilesFocusedPaths,
  projectFilesNavigationIndex,
  projectFilesRevealScrollTop,
  sameProjectDirectoryEntries,
} from "./projectFilesNavigation.ts";

test("directory revalidation distinguishes additions, removals, renames, kind changes, and ordering", () => {
  const entries = [
    { path: "docs", name: "docs", kind: "directory" },
    { path: "README.md", name: "README.md", kind: "file" },
  ];
  assert.equal(sameProjectDirectoryEntries(entries, structuredClone(entries)), true);
  assert.equal(sameProjectDirectoryEntries(entries, entries.slice(1)), false);
  assert.equal(sameProjectDirectoryEntries(entries, [...entries, {path: "new.md", name: "new.md", kind: "file"}]), false);
  assert.equal(sameProjectDirectoryEntries(entries, entries.toReversed()), false);
  for (const change of [{path:"notes"}, {name:"notes"}, {kind:"file"}]) {
    assert.equal(sameProjectDirectoryEntries(entries, [{...entries[0], ...change}, entries[1]]), false);
  }
});

const component = (id, kind, parent, binding) => ({ id, kind, parent, binding });
const directory = (value) => ({ kind: "directory", value });
const path = (value) => ({ kind: "path", value });

test("folder navigation uses exact category bindings while hover also covers files and externals", () => {
  const index = projectFilesNavigationIndex({ root: "root", components: [
    component("root", "directory"),
    component("category", "directory", "root", directory("./docs/")),
    component("document", "document", "category", path("docs/intro.md")),
    component("external", "target", "directory", directory("src")),
    component("empty", "directory", "root", directory("empty")),
    component("url", "target", "directory", { kind: "url", value: "https://example.com" }),
    component("glob", "target", "directory", { kind: "glob", value: "notes/**" }),
    component("outside", "target", "directory", path("../other.md")),
    component("absolute", "target", "directory", path("/private/other.md")),
  ] });
  assert.deepEqual([...index.focusIdByDirectory], [["", "root"], ["docs", "category"]]);
  assert.equal(index.componentIdByPath.get("docs/intro.md"), "document");
  assert.equal(index.componentIdByPath.get("src"), "external");
  assert.equal(index.componentIdByPath.get("docs/unmapped.md"), undefined);
  for (const id of ["url", "glob", "outside", "absolute"]) {
    assert.equal(index.pathByComponentId.has(id), false);
  }
});

test("ambiguous directory bindings never choose an arbitrary map destination", () => {
  const index = projectFilesNavigationIndex({ root: "root", components: [
    component("root", "directory"),
    component("one", "directory", "root", directory("docs")),
    component("two", "directory", "root", directory("docs")),
    component("first", "document", "one", path("docs/a.md")),
    component("second", "document", "two", path("docs/b.md")),
  ] });
  assert.equal(index.componentIdByPath.has("docs"), false);
  assert.equal(index.focusIdByDirectory.has("docs"), false);
  assert.equal(index.pathByComponentId.get("one"), "docs");
});

test("a counterpart falls back to its visible ancestor while the exact row loads", () => {
  const visible = new Set(["", "docs", "docs/nested", "other"]);
  assert.equal(nearestVisibleProjectPath("docs/nested/a.md", visible), "docs/nested");
  assert.equal(nearestVisibleProjectPath("docs/closed/a.md", visible), "docs");
  assert.equal(nearestVisibleProjectPath("another/file.md", visible), "");
  assert.equal(nearestVisibleProjectPath(undefined, visible), undefined);
  assert.deepEqual(projectFilesAncestorPaths("docs/nested/a.md"), ["docs", "docs/nested"]);
  assert.deepEqual(projectFilesAncestorPaths(""), []);
});

test("automatic folding keeps only the active chain and the target's ancestors", () => {
  assert.deepEqual([...projectFilesFocusedPaths("docs/current", "specs/deep/a.md")],
    ["docs", "docs/current", "specs", "specs/deep"]);
  assert.deepEqual([...projectFilesFocusedPaths("docs/current", "docs/current/a.md")],
    ["docs", "docs/current"]);
  // Pointing at an inactive category exposes its row, not its contents.
  assert.deepEqual([...projectFilesFocusedPaths("docs", "specs/deep")], ["docs", "specs"]);
  assert.deepEqual([...projectFilesFocusedPaths("")], []);
  assert.deepEqual([...projectFilesFocusedPaths(undefined, "README.md")], []);
});

test("an obscured entry centers while a comfortably visible entry stays still", () => {
  assert.equal(projectFilesRevealScrollTop(200, 400, 280, 31, 2000), 200);
  assert.equal(projectFilesRevealScrollTop(200, 400, 190, 31, 2000), 5.5);
  assert.equal(projectFilesRevealScrollTop(200, 400, 590, 31, 2000), 405.5);
});

test("an expanded category preview opens its contents without retaining inactive lists", () => {
  assert.deepEqual([...projectFilesFocusedPaths("docs/current", "specs/deep", true)],
    ["docs", "docs/current", "specs", "specs/deep"]);
  assert.deepEqual([...projectFilesFocusedPaths("docs/current", "docs", true)],
    ["docs", "docs/current"]);
  assert.deepEqual([...projectFilesFocusedPaths("", "specs/deep", true)],
    ["specs", "specs/deep"]);
  assert.deepEqual([...projectFilesFocusedPaths("", undefined, true)], []);
});

test("centering converges to a fixed point, including short lists and both boundaries", () => {
  for (const [viewport, height] of [[400, 2000], [400, 250], [80, 500]]) {
    for (const position of [0, 15.25, height / 2, height - 31]) {
      for (const initial of [0, height / 3, height]) {
        const reveal = (top) => projectFilesRevealScrollTop(top, viewport, position, 31, height);
        const settled = reveal(initial);
        assert.ok(settled >= 0 && settled <= Math.max(0, height - viewport));
        assert.equal(reveal(settled), settled);
      }
    }
  }
});

test("small layout changes and repeated hover updates do not cause center drift", () => {
  let scroll = projectFilesRevealScrollTop(0, 400, 1000, 31, 2000);
  const settled = scroll;
  for (let tick = 0; tick < 100; tick += 1) {
    scroll = projectFilesRevealScrollTop(scroll, 400, 1000 + Math.sin(tick) * 20, 31, 2000);
    assert.equal(scroll, settled);
  }
});
