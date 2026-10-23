import assert from "node:assert/strict";
import test from "node:test";

import {
  filterSshDestinations,
  remoteFolderName,
  remotePathBreadcrumbs,
} from "./sshBrowser.ts";

test("SSH server filtering preserves configured source order", () => {
  const destinations = ["github.com", "A520", "server-proxy", "server"];
  assert.deepEqual(filterSshDestinations(destinations, "server"), [
    "server-proxy",
    "server",
  ]);
  assert.deepEqual(filterSshDestinations(destinations, ""), destinations);
});

test("remote folder breadcrumbs retain exact absolute navigation paths", () => {
  assert.deepEqual(remotePathBreadcrumbs("/home/xzj/coding/Mindflow"), [
    { label: "/", path: "/" },
    { label: "home", path: "/home" },
    { label: "xzj", path: "/home/xzj" },
    { label: "coding", path: "/home/xzj/coding" },
    { label: "Mindflow", path: "/home/xzj/coding/Mindflow" },
  ]);
  assert.deepEqual(remotePathBreadcrumbs("relative/path"), []);
  assert.equal(remoteFolderName("/home/xzj/coding/Mindflow"), "Mindflow");
  assert.equal(remoteFolderName("/"), "/");
});
