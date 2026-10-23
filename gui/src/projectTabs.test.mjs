import assert from "node:assert/strict";
import test from "node:test";

import {
  clearProjectTabOpenError,
  closeProjectTab,
  emptyProjectTabState,
  mergeProjectTabs,
  isSshProjectRoot,
  projectTabCanRefresh,
  projectTabFromResponse,
  projectTabRelaunchPaths,
  replaceProjectTab,
  sshDestinationFromRoot,
} from "./projectTabs.ts";

function regionResponse(root, project) {
  return {
    status: "region",
    region: { root, project },
  };
}

function folderResponse(root, project) {
  return { status: "folder", root, project };
}

function errorResponse(requestedPath, project, root) {
  return {
    status: "error",
    requested_path: requestedPath,
    root,
    project,
    message: `${project} is invalid`,
  };
}

test("project roots become peer tabs in request order and focus the first request", () => {
  const incoming = [
    projectTabFromResponse(regionResponse("/first", "First")),
    projectTabFromResponse(regionResponse("/second", "Second")),
  ];
  const state = mergeProjectTabs(emptyProjectTabState, incoming);

  assert.deepEqual(
    state.tabs.map((tab) => tab.label),
    ["First", "Second"],
  );
  assert.equal(state.activeId, "root:/first");
});

test("SSH roots remain access-qualified and visibly name their destination", () => {
  const root = "ssh://server/home/user/coding/Mindflow";
  const tab = projectTabFromResponse(regionResponse(root, "Mindflow"));

  assert.equal(tab.id, `root:${root}`);
  assert.equal(tab.label, "Mindflow @ server");
  assert.equal(sshDestinationFromRoot(root), "server");
  assert.equal(isSshProjectRoot(root), true);
  assert.equal(isSshProjectRoot("/local/Mindflow"), false);
  assert.deepEqual(projectTabRelaunchPaths({ tabs: [tab], activeId: tab.id }), [
    root,
  ]);
});

test("opening an existing root focuses it without replacing its workspace", () => {
  const first = projectTabFromResponse(regionResponse("/first", "First"));
  const initial = mergeProjectTabs(emptyProjectTabState, [first]);
  const duplicate = projectTabFromResponse(
    regionResponse("/first", "Changed on disk"),
  );
  const reopened = mergeProjectTabs(initial, [duplicate]);

  assert.equal(reopened.tabs.length, 1);
  assert.equal(reopened.tabs[0], first);
  assert.equal(reopened.activeId, first.id);
});

test("an unregistered folder becomes a tab and initialization upgrades it in place", () => {
  const folder = projectTabFromResponse(folderResponse("/first", "First"));
  const initial = mergeProjectTabs(emptyProjectTabState, [folder]);
  assert.equal(initial.tabs[0].kind, "folder");
  assert.equal(initial.tabs[0].root, "/first");

  const region = projectTabFromResponse(regionResponse("/first", "First"));
  const initialized = mergeProjectTabs(initial, [region]);
  assert.equal(initialized.tabs.length, 1);
  assert.equal(initialized.tabs[0].kind, "region");
  assert.equal(initialized.activeId, "root:/first");

  const staleFolder = projectTabFromResponse(folderResponse("/first", "First"));
  const preserved = mergeProjectTabs(initialized, [staleFolder]);
  assert.equal(preserved.tabs[0], initialized.tabs[0]);
});

test("valid regions and unregistered folders both expose Refresh", () => {
  const region = projectTabFromResponse(regionResponse("/first", "First"));
  const folder = projectTabFromResponse(folderResponse("/second", "Second"));
  const error = projectTabFromResponse(errorResponse("/third", "Third"));

  assert.equal(projectTabCanRefresh(region), true);
  assert.equal(projectTabCanRefresh(folder), true);
  assert.equal(projectTabCanRefresh(error), false);
  assert.equal(projectTabCanRefresh(undefined), false);
});

test("Refresh can replace a folder with a region and a carrierless region with a folder", () => {
  const folder = projectTabFromResponse(folderResponse("/first", "First"));
  const region = projectTabFromResponse(regionResponse("/first", "First"));
  const initial = mergeProjectTabs(emptyProjectTabState, [folder]);

  const upgraded = replaceProjectTab(initial, folder.id, region);
  assert.equal(upgraded.tabs[0].kind, "region");
  assert.equal(upgraded.activeId, region.id);

  const downgraded = replaceProjectTab(upgraded, region.id, folder);
  assert.equal(downgraded.tabs[0].kind, "folder");
  assert.equal(downgraded.activeId, folder.id);
});

test("a valid retry replaces its root-local error, while a later error preserves the valid presentation", () => {
  const failed = projectTabFromResponse(
    errorResponse("/first/nested", "First", "/first"),
  );
  const failedState = mergeProjectTabs(emptyProjectTabState, [failed]);
  const valid = projectTabFromResponse(regionResponse("/first", "First"));
  const recovered = mergeProjectTabs(failedState, [valid]);

  assert.equal(recovered.tabs.length, 1);
  assert.equal(recovered.tabs[0].kind, "region");

  const failedAgain = projectTabFromResponse(
    errorResponse("/first", "First", "/first"),
  );
  const preserved = mergeProjectTabs(recovered, [failedAgain]);
  assert.equal(preserved.tabs[0].kind, "region");
  assert.equal(preserved.tabs[0].region, valid.region);
  assert.equal(preserved.tabs[0].openError, "First is invalid");
  assert.equal(preserved.activeId, valid.id);

  const revalidated = clearProjectTabOpenError(preserved, valid.id);
  assert.equal(revalidated.tabs[0].kind, "region");
  assert.equal(revalidated.tabs[0].openError, undefined);
  assert.equal(revalidated.tabs[0].region, valid.region);
});

test("closing only the named tab preserves peers and chooses the adjacent active tab", () => {
  const tabs = ["/first", "/second", "/third"].map((root) =>
    projectTabFromResponse(regionResponse(root, root.slice(1))),
  );
  const initial = {
    tabs,
    activeId: "root:/second",
  };
  const afterActiveClose = closeProjectTab(initial, "root:/second");

  assert.deepEqual(
    afterActiveClose.tabs.map((tab) => tab.id),
    ["root:/first", "root:/third"],
  );
  assert.equal(afterActiveClose.activeId, "root:/first");

  const afterInactiveClose = closeProjectTab(
    afterActiveClose,
    "root:/third",
  );
  assert.equal(afterInactiveClose.activeId, "root:/first");
});

test("build activation reopens every tab with the active project first", () => {
  const tabs = [
    projectTabFromResponse(regionResponse("/first", "first")),
    projectTabFromResponse(folderResponse("/second", "second")),
    projectTabFromResponse(regionResponse("/third", "third")),
  ];

  assert.deepEqual(
    projectTabRelaunchPaths({ tabs, activeId: "root:/second" }),
    ["/second", "/first", "/third"],
  );
});
