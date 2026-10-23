import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultPresentationPreferences,
  loadPresentationPreferences,
  MAXIMUM_INTERFACE_SCALE,
  MINIMUM_INTERFACE_SCALE,
  normalizeInterfaceScale,
  presentationPreferencesStorageKey,
  reconcilePresentationPreferences,
  reconcileTimelineFoldPreferences,
  savePresentationPreferences,
  stepInterfaceScale,
  timelineFoldPreferenceKey,
  timelineFoldRangesFromPreferences,
} from "./presentationPreferences.ts";

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, value);
  }
}

function graph(folderNames, relationshipTypeNames) {
  const nodes=[{path:".",name:"Project",kind:"directory",component:{id:"root",index:false}}];
  const documents=[];
  folderNames.forEach((name,index)=>{
    nodes.push({path:name,name,kind:"directory",parent_path:".",component:{id:`role-${index}`,index:false}});
    const parent=index===0?`${name}/group`:name;
    if(index===0) nodes.push({path:parent,name:"group",kind:"directory",parent_path:name,component:{id:`group-${index}`,index:false}});
    const path=`${parent}/file.md`;
    const document={component:`document-${index}`,path,index:false,content:{sha256:"test",bytes:0}};
    documents.push(document);
    nodes.push({path,name:"file.md",kind:"document",parent_path:parent,component:{id:document.component,index:false},document});
  });
  return {format:"2026-10-20",structure:{nodes,relationships:[]},documents,historical_components:{},relationship_types:Object.fromEntries(relationshipTypeNames.map(name=>[name,{description:name,direction:"directional"}])),anchor_connection_types:{},events:[],anchors:{}};
}

test("workspace modes are not retained or serialized", () => {
  const storage = new MemoryStorage();
  const currentGraph = graph(["authority"], []);
  const preferences = createDefaultPresentationPreferences(currentGraph);
  storage.setItem(
    presentationPreferencesStorageKey("/obsolete-region"),
    JSON.stringify({
      version: 3,
      workspaceMode: "obsolete",
      interfaceScale: 1,
    }),
  );

  const restored = loadPresentationPreferences(
    "/obsolete-region",
    currentGraph,
    storage,
  );
  assert.equal("workspaceMode" in restored, false);
  assert.equal("workspaceMode" in preferences, false);
  savePresentationPreferences(
    "/obsolete-region",
    { ...restored, workspaceMode: "opening-focus" },
    storage,
  );
  const stored = JSON.parse(
    storage.getItem(presentationPreferencesStorageKey("/obsolete-region")),
  );
  assert.equal("workspaceMode" in stored, false);
});

test("older preference versions are not restored", () => {
  const storage = new MemoryStorage();const root="/project";const currentGraph=graph(["docs"],[]);
  storage.setItem(`mindflow:presentation-preferences:v1:${encodeURIComponent(root)}`,JSON.stringify({version:1,interfaceScale:1.3}));
  assert.equal(loadPresentationPreferences(root,currentGraph,storage).interfaceScale,1);
  storage.setItem(presentationPreferencesStorageKey(root),JSON.stringify({version:7,interfaceScale:1.3}));
  assert.equal(loadPresentationPreferences(root,currentGraph,storage).interfaceScale,1);
});

function graphWithEvents(eventNames) {
  return {
    ...graph(["steering"], []),
    events: eventNames.map((name) => ({
      name,
      predecessors: [],
      successors: [],
    })),
  };
}

test("presentation preferences round-trip independently for each project root", () => {
  const storage = new MemoryStorage();
  const currentGraph = graph(
    ["authority", "steering"],
    ["supports", "implements"],
  );
  const preferences = createDefaultPresentationPreferences(currentGraph);
  preferences.interfaceScale = 1.2;
  preferences.structure.focusId = "role-0";
  preferences.structure.depthsByFocusId = new Map([
    ["root", 3],
    ["role-0", 2],
  ]);
  preferences.structure.reversedLayoutFocusIds = new Set([
    "root",
    "role-0",
  ]);
  preferences.timelinePanels = {
    inspectorHeight: 128.76,
  };
  preferences.files.expandedPaths = new Set(["canonical_docs", "profiles"]);
  preferences.files.selectedPath = "profiles/gui.md";
  preferences.files.scrollTop = 418.6;
  preferences.files.sidebarWidth = 336.4;
  preferences.structureMetrics.enabled = true;
  preferences.structureMetrics.commits = 50;
  savePresentationPreferences("/projects/one", preferences, storage);
  const restored = loadPresentationPreferences(
    "/projects/one",
    currentGraph,
    storage,
  );

  assert.equal("workspaceMode" in restored, false);
  assert.equal(restored.interfaceScale, 1.2);
  assert.equal(restored.structure.focusId, "role-0");
  assert.deepEqual([...restored.structure.depthsByFocusId], [
    ["role-0", 2],
    ["root", 3],
  ]);
  assert.deepEqual([...restored.structure.reversedLayoutFocusIds], [
    "role-0",
    "root",
  ]);
  assert.equal("readerEnabled" in restored, false);
  assert.deepEqual(restored.timelinePanels, {
    inspectorHeight: 128.8,
  });
  assert.deepEqual([...restored.files.expandedPaths], [
    "canonical_docs",
    "profiles",
  ]);
  assert.equal(restored.files.selectedPath, "profiles/gui.md");
  assert.equal(restored.files.scrollTop, 419);
  assert.equal(restored.files.sidebarWidth, 336);
  assert.equal(restored.structureMetrics.enabled, true);
  assert.equal(restored.structureMetrics.commits, 50);
  const otherRoot = loadPresentationPreferences(
    "/projects/two",
    currentGraph,
    storage,
  );
  assert.equal(otherRoot.interfaceScale, 1);
  assert.equal(otherRoot.structure.focusId, "root");
  assert.deepEqual([...otherRoot.structure.depthsByFocusId], []);
  assert.deepEqual([...otherRoot.structure.reversedLayoutFocusIds], []);
  assert.equal("readerEnabled" in otherRoot, false);
  assert.deepEqual(otherRoot.timelinePanels, {});
  assert.deepEqual(otherRoot.timelineFolds, []);
  assert.deepEqual([...otherRoot.files.expandedPaths], []);
  assert.equal(otherRoot.files.selectedPath, "");
  assert.equal(otherRoot.files.scrollTop, 0);
  assert.equal(otherRoot.files.sidebarWidth, 280);
  assert.equal(otherRoot.structureMetrics.enabled, false);
  assert.equal(otherRoot.structureMetrics.commits, 30);
});

test("Structure metrics preferences reject malformed or unsupported windows", () => {
  const storage = new MemoryStorage();
  const currentGraph = graph(["docs"], []);
  const preferences = createDefaultPresentationPreferences(currentGraph);
  for (const value of [0, 101, 50.5, "50", null]) {
    savePresentationPreferences("/project", {
      ...preferences,
      structureMetrics: { enabled: "yes", commits: value },
    }, storage);
    const restored = loadPresentationPreferences("/project", currentGraph, storage);
    assert.equal(restored.structureMetrics.enabled, false);
    assert.equal(restored.structureMetrics.commits, 30);
  }
  const corrupted = { ...preferences, structureMetrics: { enabled: false, commits: Number.NaN } };
  assert.equal(reconcilePresentationPreferences(corrupted, currentGraph).structureMetrics.commits, 30);
});

test("Structure navigation reconciles stale focus, depth, and direction without sharing layers", () => {
  const currentGraph = graph(["authority", "steering"], []);
  const preferences = createDefaultPresentationPreferences(currentGraph);
  preferences.structure = {
    focusId: "role-0",
    depthsByFocusId: new Map([
      ["root", 99],
      ["role-0", 99],
      ["missing", 2],
    ]),
    reversedLayoutFocusIds: new Set(["root", "role-0", "missing"]),
  };

  const bounded = reconcilePresentationPreferences(preferences, currentGraph);
  assert.equal(bounded.structure.focusId, "role-0");
  assert.deepEqual([...bounded.structure.depthsByFocusId], [
    ["root", 3],
    ["role-0", 2],
  ]);
  assert.deepEqual([...bounded.structure.reversedLayoutFocusIds], [
    "root",
    "role-0",
  ]);

  const rootOnlyGraph = {
    ...currentGraph,
    structure: {
      ...currentGraph.structure,
      nodes: [currentGraph.structure.nodes[0]],
    },
  };
  const pruned = reconcilePresentationPreferences(bounded, rootOnlyGraph);
  assert.equal(pruned.structure.focusId, "root");
  assert.deepEqual([...pruned.structure.depthsByFocusId], []);
  assert.deepEqual([...pruned.structure.reversedLayoutFocusIds], ["root"]);
});

test("Timeline folds persist by event identity and reconcile a changed sequence", () => {
  const storage = new MemoryStorage();
  const initialGraph = graphWithEvents([
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
  ]);
  const preferences = createDefaultPresentationPreferences(initialGraph);
  preferences.timelineFolds = [
    { startEventName: "one", endEventName: "three" },
    { startEventName: "five", endEventName: "six" },
  ];

  savePresentationPreferences("/project", preferences, storage);
  const restored = loadPresentationPreferences(
    "/project",
    initialGraph,
    storage,
  );
  assert.deepEqual(restored.timelineFolds, preferences.timelineFolds);
  assert.deepEqual(
    timelineFoldRangesFromPreferences(
      restored.timelineFolds,
      initialGraph.events,
    ),
    [
      { startEventIndex: 0, endEventIndex: 2 },
      { startEventIndex: 4, endEventIndex: 5 },
    ],
  );

  const insertedGraph = graphWithEvents([
    "zero",
    "one",
    "inserted",
    "two",
    "three",
    "four",
    "five",
    "six",
  ]);
  const reopened = loadPresentationPreferences(
    "/project",
    insertedGraph,
    storage,
  );
  assert.deepEqual(
    timelineFoldRangesFromPreferences(
      reopened.timelineFolds,
      insertedGraph.events,
    ),
    [
      { startEventIndex: 1, endEventIndex: 4 },
      { startEventIndex: 6, endEventIndex: 7 },
    ],
  );

  const anchorReconciled = reconcilePresentationPreferences(
    reopened,
    insertedGraph,
    [3],
  );
  assert.deepEqual(anchorReconciled.timelineFolds, [
    { startEventName: "five", endEventName: "six" },
  ]);

  const withoutEndpoint = reconcilePresentationPreferences(
    restored,
    graphWithEvents(["one", "two", "four", "five", "six"]),
  );
  assert.deepEqual(withoutEndpoint.timelineFolds, [
    { startEventName: "five", endEventName: "six" },
  ]);

  const unfolded = {
    ...restored,
    timelineFolds: restored.timelineFolds.filter(
      (preference) =>
        timelineFoldPreferenceKey(preference) !==
          timelineFoldPreferenceKey({
            startEventName: "one",
            endEventName: "three",
          }),
    ),
  };
  savePresentationPreferences("/project", unfolded, storage);
  assert.deepEqual(
    loadPresentationPreferences("/project", initialGraph, storage)
      .timelineFolds,
    [{ startEventName: "five", endEventName: "six" }],
  );
});

test("Nested Timeline fold preferences survive restoration and removal of an outer layer", () => {
  const storage = new MemoryStorage();
  const currentGraph = graphWithEvents(["one", "two", "three", "four", "five", "six", "seven", "eight"]);
  const preferences = createDefaultPresentationPreferences(currentGraph);
  const outer = { startEventName: "one", endEventName: "eight" };
  const children = [
    { startEventName: "one", endEventName: "three" },
    { startEventName: "two", endEventName: "three" },
    { startEventName: "five", endEventName: "six" },
  ];
  // The outer range is created later; matching starts must not discard it.
  preferences.timelineFolds = [...children, outer];
  savePresentationPreferences("/project", preferences, storage);
  const restored = loadPresentationPreferences("/project", currentGraph, storage);
  assert.deepEqual(restored.timelineFolds, [outer, ...children]);
  assert.deepEqual(timelineFoldRangesFromPreferences(restored.timelineFolds, currentGraph.events), [
    { startEventIndex: 0, endEventIndex: 7 },
    { startEventIndex: 0, endEventIndex: 2 },
    { startEventIndex: 1, endEventIndex: 2 },
    { startEventIndex: 4, endEventIndex: 5 },
  ]);
  assert.deepEqual(
    reconcilePresentationPreferences(restored, currentGraph, [4]).timelineFolds,
    children,
    "an Anchor that invalidates an enclosing range must preserve its valid children",
  );
  const withoutOuterEndpoint = graphWithEvents(currentGraph.events.slice(0, -1).map((event) => event.name));
  assert.deepEqual(reconcilePresentationPreferences(restored, withoutOuterEndpoint).timelineFolds, children);
  const insertedGraph = graphWithEvents(["zero", ...currentGraph.events.map((event) => event.name)]);
  const inserted = loadPresentationPreferences("/project", insertedGraph, storage);
  assert.deepEqual(inserted.timelineFolds, [outer, ...children]);
  assert.deepEqual(timelineFoldRangesFromPreferences(inserted.timelineFolds, insertedGraph.events), [
    { startEventIndex: 1, endEventIndex: 8 },
    { startEventIndex: 1, endEventIndex: 3 },
    { startEventIndex: 2, endEventIndex: 3 },
    { startEventIndex: 5, endEventIndex: 6 },
  ]);
  restored.timelineFolds = restored.timelineFolds.filter(
    (preference) => timelineFoldPreferenceKey(preference) !== timelineFoldPreferenceKey(outer),
  );
  savePresentationPreferences("/project", restored, storage);
  assert.deepEqual(loadPresentationPreferences("/project", currentGraph, storage).timelineFolds, children);
});

test("Timeline fold reconciliation rejects partial overlaps between nested siblings", () => {
  const currentGraph = graphWithEvents(["one", "two", "three", "four", "five", "six"]);
  const outer = { startEventName: "one", endEventName: "six" };
  const child = { startEventName: "two", endEventName: "four" };
  const crossing = { startEventName: "three", endEventName: "five" };
  assert.deepEqual(reconcileTimelineFoldPreferences([
    crossing, child, outer,
    { startEventName: "four", endEventName: "two" },
  ], currentGraph.events), [outer, child]);
});

test("Timeline fold reconciliation rejects corrupt, duplicate, and partially overlapping ranges", () => {
  const currentGraph = graphWithEvents(["one", "two", "three", "four"]);
  assert.deepEqual(
    reconcileTimelineFoldPreferences(
      [
        { startEventName: "three", endEventName: "one" },
        { startEventName: "one", endEventName: "three" },
        { startEventName: "two", endEventName: "four" },
        { startEventName: "missing", endEventName: "four" },
        { startEventName: "four", endEventName: "four" },
      ],
      currentGraph.events,
    ),
    [{ startEventName: "one", endEventName: "three" }],
  );
});

test("unsupported preference versions start from current defaults", () => {
  const storage = new MemoryStorage();
  const currentGraph = graph(["authority"], []);
  for (const [version, legacyMode] of [
    [1, "timeline"],
    [2, "tension"],
    [3, "structure"],
    [4, "dashboard"],
    [4, "files"],
    [5, "opening"],
    [6, "overview"],
    [6, "opening-focus"],
  ]) {
    storage.setItem(
      `mindflow:presentation-preferences:v${version}:${encodeURIComponent(`/project/${legacyMode}`)}`,
      JSON.stringify({
        version,
        workspaceMode: legacyMode,
        interfaceScale: 1.2,
        structure: {
          focusId: "role-0",
          depths: [{ focusId: "role-0", depth: 2 }],
          reversedLayoutFocusIds: ["role-0"],
        },
      }),
    );
    const restored = loadPresentationPreferences(
      `/project/${legacyMode}`,
      currentGraph,
      storage,
    );
    assert.equal("workspaceMode" in restored, false);
    assert.equal(restored.interfaceScale, 1);
    assert.equal(restored.structure.focusId, "root");
    assert.deepEqual([...restored.structure.depthsByFocusId], []);
    assert.deepEqual([...restored.structure.reversedLayoutFocusIds], []);
    assert.deepEqual(
      reconcilePresentationPreferences(restored, currentGraph),
      restored,
    );
  }
});

test("invalid, unsupported, or unavailable storage falls back without blocking", () => {
  const storage = new MemoryStorage();
  const currentGraph = graph(["authority"], ["supports"]);
  const key = presentationPreferencesStorageKey("/project");

  storage.setItem(key, "not json");
  assert.deepEqual(
    loadPresentationPreferences("/project", currentGraph, storage),
    createDefaultPresentationPreferences(currentGraph),
  );

  storage.setItem(key, JSON.stringify({ version: 99, readerEnabled: true }));
  const unsupported = loadPresentationPreferences(
    "/project",
    currentGraph,
    storage,
  );
  assert.deepEqual(
    unsupported,
    createDefaultPresentationPreferences(currentGraph),
  );
  assert.equal("readerEnabled" in unsupported, false);

  const unavailableStorage = {
    getItem() {
      throw new Error("storage unavailable");
    },
    setItem() {
      throw new Error("storage unavailable");
    },
  };
  assert.deepEqual(
    loadPresentationPreferences(
      "/project",
      currentGraph,
      unavailableStorage,
    ),
    createDefaultPresentationPreferences(currentGraph),
  );
  assert.doesNotThrow(() =>
    savePresentationPreferences(
      "/project",
      createDefaultPresentationPreferences(currentGraph),
      unavailableStorage,
    ),
  );
});

test("partially corrupt current and obsolete fields are validated without restoring old views", () => {
  const storage = new MemoryStorage();
  const currentGraph = graph(
    ["authority", "steering"],
    ["supports"],
  );
  storage.setItem(
    presentationPreferencesStorageKey("/project"),
    JSON.stringify({
      version: 8,
      hiddenRelationshipTypes: ["missing", 12],
      rolePresentations: {
        ring: {
          order: ["steering", "missing", "steering"],
          hidden: ["steering"],
        },
      },
      showExternalTargets: "no",
      openViews: ["missing"],
      workspaceMode: "missing",
      mapZoom: { ring: -10, graph: 20 },
      canvasTextScale: { ring: -10, graph: 20, tension: "large" },
      interfaceScale: 8,
      readerEnabled: "yes",
      timelinePanels: {
        // Retained versions may still contain the removed anchor-panel size.
        anchorHeight: -10,
        inspectorHeight: "large",
      },
    }),
  );

  const restored = loadPresentationPreferences(
    "/project",
    currentGraph,
    storage,
  );
  assert.equal("workspaceMode" in restored, false);
  assert.equal(restored.interfaceScale, MAXIMUM_INTERFACE_SCALE);
  assert.equal("hiddenRelationshipTypes" in restored, false);
  assert.equal("showExternalTargets" in restored, false);
  assert.equal("canvasTextScale" in restored, false);
  assert.equal("tensionLayout" in restored, false);
  assert.equal("readerEnabled" in restored, false);
  assert.deepEqual(restored.timelinePanels, {
    inspectorHeight: undefined,
  });
});

test("interface scale steps predictably and clamps malformed or extreme values", () => {
  assert.equal(stepInterfaceScale(1, 1), 1.1);
  assert.equal(stepInterfaceScale(1, -1), 0.9);
  assert.equal(stepInterfaceScale(MAXIMUM_INTERFACE_SCALE, 1), 1.4);
  assert.equal(stepInterfaceScale(MINIMUM_INTERFACE_SCALE, -1), 0.8);
  assert.equal(normalizeInterfaceScale(Number.NaN), 1);
  assert.equal(normalizeInterfaceScale("large"), 1);
});
