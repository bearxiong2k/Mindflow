import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_FILES_SIDEBAR_WIDTH,
  filesSidebarWidthFromPointer,
  MAXIMUM_FILES_SIDEBAR_WIDTH,
  MINIMUM_FILES_SIDEBAR_WIDTH,
  normalizeFilesSidebarWidth,
} from "./workspaceSidebar.ts";

test("Files sidebar width remains bounded and rejects corrupt preferences", () => {
  assert.equal(normalizeFilesSidebarWidth(undefined), DEFAULT_FILES_SIDEBAR_WIDTH);
  assert.equal(normalizeFilesSidebarWidth(Number.NaN), DEFAULT_FILES_SIDEBAR_WIDTH);
  assert.equal(normalizeFilesSidebarWidth(40), MINIMUM_FILES_SIDEBAR_WIDTH);
  assert.equal(normalizeFilesSidebarWidth(900), MAXIMUM_FILES_SIDEBAR_WIDTH);
  assert.equal(normalizeFilesSidebarWidth(317.7), 318);
});

test("Files sidebar pointer resizing preserves room for the semantic workspace", () => {
  assert.equal(filesSidebarWidthFromPointer(280, 300, 360, 1200), 340);
  assert.equal(
    filesSidebarWidthFromPointer(280, 300, -100, 1200),
    MINIMUM_FILES_SIDEBAR_WIDTH,
  );
  assert.equal(filesSidebarWidthFromPointer(280, 300, 900, 760), 400);
  assert.equal(
    filesSidebarWidthFromPointer(280, 300, 900, 500),
    MINIMUM_FILES_SIDEBAR_WIDTH,
  );
});
