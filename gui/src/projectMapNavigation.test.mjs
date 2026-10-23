import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProjectMapMermaidGraph,
  projectMapMermaidRenderedNodeId,
  reverseProjectMapDirection,
} from "./projectMapMermaid.ts";
import {
  deriveProjectMapFocusProjection,
  projectMapComponentActivation,
  projectMapMaximumDepth,
  projectMapChildrenByParent,
  projectMapViewingDepth,
  projectMapViewingDepthsWith,
} from "./projectMapNavigation.ts";

const components = [
  {
    id: "root",
    label: "Project",
    kind: "directory",
    managed: true,
    order: 0,
  },
  {
    id: "profiles",
    label: "Profile",
    kind: "directory",
    parent: "root",
    managed: true,
    order: 1,
  },
  {
    id: "canonical",
    label: "Canonical documentation",
    kind: "directory",
    parent: "root",
    managed: true,
    order: 2,
  },
  {
    id: "practice",
    label: "Reference note",
    kind: "directory",
    parent: "root",
    managed: true,
    order: 3,
  },
  {
    id: "substrate",
    label: "Project Map substrate",
    kind: "directory",
    parent: "canonical",
    managed: true,
    order: 4,
  },
  {
    id: "document",
    label: "Structure",
    kind: "document",
    parent: "substrate",
    binding: { kind: "path", value: "document.md" },
    managed: true,
    order: 5,
  },
  {
    id: "code",
    label: "Code",
    kind: "target",
    binding: { kind: "directory", value: "src" },
    managed: true,
    order: 6,
  },
];

const map = {
  direction: "td",
  root: "root",
  components,
  relationships: [
    {
      source: "profiles",
      type: "governs",
      direction: "source-to-target",
      target: "canonical",
    },
    {
      source: "canonical",
      type: "implements",
      direction: "source-to-target",
      target: "code",
    },
    {
      source: "document",
      type: "verifies",
      direction: "source-to-target",
      target: "code",
    },
  ],
};

test("the root projection retains existing directory scopes", () => {
  const projection = deriveProjectMapFocusProjection(
    map,
    "root",
    new Set(["governs", "implements", "verifies"]),
    true,
  );

  assert.equal(projection.focus.id, "root");
  assert.deepEqual(
    projection.primary.map((component) => component.id),
    ["profiles", "canonical", "practice"],
  );
  assert.deepEqual(projection.context, []);
  assert.deepEqual(projection.relationships, [map.relationships[0]]);
  assert.deepEqual(projection.expanded, []);
});

test("filesystem Structure derives canvas names and context without role overrides", async () => {
  const {projectMapFor} = await import("./projectMapNavigation.ts");
  const graph = {structure:{nodes:[
    {path:".",name:"Project",kind:"directory"},
    {path:"docs",name:"docs",kind:"directory",parent_path:"."},
    {path:"docs/a.md",name:"a.md",kind:"document",parent_path:"docs",component:{id:"a",index:false,description:"Exact purpose"}},
    {path:"docs/nested",name:"nested",kind:"directory",parent_path:"docs"},
    {path:"docs/nested/b.md",name:"b.md",kind:"document",parent_path:"docs/nested",component:{id:"b",index:false}},
  ],relationships:[]}};
  const map = projectMapFor(graph);
  assert.equal(projectMapFor(graph),map);
  assert.equal(map.root,"context:.");
  assert.equal(map.components[2].label,"a.md");
  assert.equal(map.components[2].parent,"context:docs");
  assert.equal(map.components[1].managed,false);
  const projection=deriveProjectMapFocusProjection(map,"context:docs",new Set(),true,{files:[{component:"b",path:"docs/nested/b.md"}]},2);
  assert.deepEqual(projection.openingComponentIds,["context:docs/nested"]);
  assert.equal(projection.effectiveRoles.get("a"),"docs");
  assert.equal(projection.effectiveRoles.get("b"),"nested");
  const rendered=buildProjectMapMermaidGraph(projection);
  assert.doesNotMatch(rendered.source,/Exact purpose|Unmanaged folder context/);
  assert.equal(rendered.nodeByKey.get(rendered.keyByComponentId.get("a")).description,"Exact purpose");
  assert.doesNotMatch(rendered.source,/Default role|Role:/);
});

test("Structure depth recursively expands every available lower aggregate", () => {
  const childrenByParent = projectMapChildrenByParent(map.components);
  assert.equal(projectMapMaximumDepth("root", childrenByParent), 3);
  assert.equal(projectMapMaximumDepth("canonical", childrenByParent), 2);

  const projection = deriveProjectMapFocusProjection(
    map,
    "root",
    new Set(["governs", "implements", "verifies"]),
    true,
    undefined,
    99,
  );

  assert.equal(projection.depth, 3);
  assert.deepEqual(
    projection.expanded.map((layer) => layer.focus.id),
    ["canonical"],
  );
  assert.deepEqual(
    projection.expanded[0].expanded.map((layer) => layer.focus.id),
    ["substrate"],
  );
  assert.deepEqual(projection.expanded[0].context, []);
  assert.deepEqual(projection.expanded[0].relationships, []);

  const graph = buildProjectMapMermaidGraph(projection);
  assert.deepEqual(
    [...graph.layerByKey.values()].map((component) => component.id),
    ["canonical", "substrate"],
  );
  const layerKeyFor = (componentId) =>
    [...graph.layerByKey].find(
      ([, component]) => component.id === componentId,
    )?.[0];
  assert.equal(graph.layerVisibleDepthByKey.get(layerKeyFor("canonical")), 2);
  assert.equal(graph.layerVisibleDepthByKey.get(layerKeyFor("substrate")), 1);
  assert.equal(
    [...graph.nodeByKey.values()].some(
      (component) => component.id === "canonical",
    ),
    false,
  );
  assert.equal(
    [...graph.nodeByKey.values()].some(
      (component) => component.id === "document",
    ),
    true,
  );
  assert.match(graph.source, /subgraph pm\d+\["Canonical documentation"\]/);
  assert.match(graph.source, /subgraph pm\d+\["Project Map substrate"\]/);
  assert.match(graph.source, /stroke-dasharray:7 5/);
  const governs = graph.connections.find(
    (connection) => connection.type === "governs",
  );
  const componentAtRenderedKey = (key) =>
    graph.nodeByKey.get(key) ?? graph.layerByKey.get(key);
  assert.equal(componentAtRenderedKey(governs.renderedSource).id, "profiles");
  assert.equal(componentAtRenderedKey(governs.renderedTarget).id, "canonical");
});

test("expanded-region drill-in depth is bounded by a shallow layer", () => {
  const shallowMap = {
    ...map,
    components: [
      ...map.components,
      {
        id: "shallow",
        label: "Shallow role",
        kind: "directory",
        parent: "root",
        managed: true,
        order: 7,
      },
      {
        id: "shallow_document",
        label: "Shallow document",
        kind: "document",
        parent: "shallow",
        binding: { kind: "path", value: "shallow.md" },
        managed: true,
        order: 8,
      },
    ],
  };
  const projection = deriveProjectMapFocusProjection(
    shallowMap,
    "root",
    new Set(["governs", "implements", "verifies"]),
    true,
    undefined,
    3,
  );
  const graph = buildProjectMapMermaidGraph(projection);
  const shallowKey = [...graph.layerByKey].find(
    ([, component]) => component.id === "shallow",
  )?.[0];

  assert.equal(graph.layerVisibleDepthByKey.get(shallowKey), 1);
});

test("Structure keeps an independent bounded viewing depth for every focus", () => {
  let depthsByFocusId = new Map();
  depthsByFocusId = projectMapViewingDepthsWith(
    depthsByFocusId,
    "root",
    3,
    3,
  );
  depthsByFocusId = projectMapViewingDepthsWith(
    depthsByFocusId,
    "canonical",
    2,
    2,
  );

  assert.equal(projectMapViewingDepth("root", 3, depthsByFocusId), 3);
  assert.equal(projectMapViewingDepth("canonical", 2, depthsByFocusId), 2);
  assert.equal(projectMapViewingDepth("profiles", 1, depthsByFocusId), 1);

  depthsByFocusId = projectMapViewingDepthsWith(
    depthsByFocusId,
    "canonical",
    1,
    2,
  );
  assert.equal(projectMapViewingDepth("root", 3, depthsByFocusId), 3);
  assert.equal(projectMapViewingDepth("canonical", 2, depthsByFocusId), 1);
  assert.equal(depthsByFocusId.has("canonical"), false);
  assert.equal(projectMapViewingDepth("root", 2, depthsByFocusId), 2);
});

test("the root overview never lifts deep or external incidence", () => {
  const withExternalTargets = deriveProjectMapFocusProjection(
    map,
    "root",
    new Set(["implements", "verifies"]),
    true,
  );
  const withoutExternalTargets = deriveProjectMapFocusProjection(
    map,
    "root",
    new Set(["implements", "verifies"]),
    false,
  );

  assert.deepEqual(withExternalTargets.relationships, []);
  assert.deepEqual(withExternalTargets.context, []);
  assert.deepEqual(withoutExternalTargets.relationships, []);
  assert.deepEqual(withoutExternalTargets.context, []);
});

test("entering a role keeps its internal graph and omits same-level peers", () => {
  const projection = deriveProjectMapFocusProjection(
    map,
    "canonical",
    new Set(["governs", "implements", "verifies"]),
    true,
  );

  assert.equal(projection.focus.id, "canonical");
  assert.deepEqual(
    projection.primary.map((component) => component.id),
    ["substrate"],
  );
  assert.deepEqual(
    projection.context.map((component) => component.id),
    ["code"],
  );
  assert.deepEqual(projection.relationships, [
    { ...map.relationships[2], source: "substrate" },
  ]);
});

test("relationship filters never alter authored containment", () => {
  const projection = deriveProjectMapFocusProjection(
    map,
    "canonical",
    new Set(["governs"]),
    false,
  );

  assert.deepEqual(
    projection.primary.map((component) => component.id),
    ["substrate"],
  );
  assert.deepEqual(projection.context, []);
  assert.deepEqual(projection.relationships, []);
});

test("Opening cues preserve the requested Structure focus, depth, and topology", () => {
  const regionalMap = {
    ...map,
    components: [
      ...map.components,
      {
        id: "implementation",
        label: "Implementation contract",
        kind: "document",
        parent: "canonical",
        binding: { kind: "path", value: "implementation.md" },
        managed: true,
        order: 7,
      },
    ],
  };
  const opening = {
    files: [
      { path: "document.md", role: "canonical" },
      { path: "implementation.md", role: "canonical" },
    ],
  };

  const activeTypes = new Set(["governs", "implements", "verifies"]);
  const plain = deriveProjectMapFocusProjection(
    regionalMap,
    "root",
    activeTypes,
    true,
  );
  const marked = deriveProjectMapFocusProjection(
    regionalMap,
    "root",
    activeTypes,
    true,
    opening,
  );
  assert.deepEqual(marked, { ...plain, openingComponentIds: ["canonical"] });
  assert.equal(marked.focus.id, "root");
  assert.equal(marked.depth, 1);
  assert.deepEqual(
    deriveProjectMapFocusProjection(regionalMap, "root", activeTypes, true, {
      files: [],
    }),
    plain,
  );
});

test("Opening cues follow nested Structure while leaving unselected documents unmarked", () => {
  const regionalMap = {
    ...map,
    components: [
      ...map.components,
      {
        id: "document-two",
        label: "Structure companion",
        kind: "document",
        parent: "substrate",
        binding: { kind: "path", value: "document-two.md" },
        managed: true,
        order: 7,
      },
      {
        id: "contracts",
        label: "Exact contracts",
        kind: "directory",
        parent: "canonical",
        managed: true,
        order: 8,
      },
      {
        id: "implementation",
        label: "Implementation contract",
        kind: "document",
        parent: "contracts",
        binding: { kind: "path", value: "implementation.md" },
        managed: true,
        order: 9,
      },
      {
        id: "implementation-two",
        label: "Implementation companion",
        kind: "document",
        parent: "contracts",
        binding: { kind: "path", value: "implementation-two.md" },
        managed: true,
        order: 10,
      },
      {
        id: "unselected",
        label: "Unselected document",
        kind: "document",
        parent: "contracts",
        binding: { kind: "path", value: "unselected.md" },
        managed: true,
        order: 11,
      },
    ],
  };
  const opening = {
    files: [
      { path: "document.md", role: "canonical" },
      { path: "document-two.md", role: "canonical" },
      { path: "implementation.md", role: "canonical" },
      { path: "implementation-two.md", role: "canonical" },
    ],
  };
  const projection = deriveProjectMapFocusProjection(
    regionalMap,
    "canonical",
    new Set(["governs", "implements", "verifies"]),
    true,
    opening,
    2,
  );

  assert.deepEqual(projection.openingComponentIds, [
    "substrate",
    "contracts",
  ]);
  const graph = buildProjectMapMermaidGraph(projection);
  assert.match(
    graph.source,
    new RegExp(`class ${graph.keyByComponentId.get("substrate")} opening;`),
  );
  assert.match(
    graph.source,
    new RegExp(`class ${graph.keyByComponentId.get("contracts")} opening;`),
  );
  for (const componentId of [
    "document",
    "document-two",
    "implementation",
    "implementation-two",
  ]) {
    assert.match(
      graph.source,
      new RegExp(`class ${graph.keyByComponentId.get(componentId)} opening;`),
    );
  }
  assert.doesNotMatch(
    graph.source,
    new RegExp(`class ${graph.keyByComponentId.get("unselected")} [^;\\n]*opening;`),
  );
  assert.match(graph.source, /classDef opening [^;]*stroke-dasharray:6 2;/);

  const rootProjection = deriveProjectMapFocusProjection(
    regionalMap,
    "root",
    new Set(["governs"]),
    true,
    opening,
  );
  assert.deepEqual(rootProjection.openingComponentIds, ["canonical"]);
});

test("Opening cues mark each containing role without creating cross-role relationships", () => {
  const regionalMap = {
    ...map,
    components: [
      ...map.components,
      {
        id: "profile-document",
        label: "Product",
        kind: "document",
        parent: "profiles",
        binding: { kind: "path", value: "product.md" },
        managed: true,
        order: 7,
      },
    ],
  };
  const activeTypes = new Set(["governs"]);
  const plain = deriveProjectMapFocusProjection(
    regionalMap,
    "root",
    activeTypes,
    true,
  );
  const marked = deriveProjectMapFocusProjection(
    regionalMap,
    "root",
    activeTypes,
    true,
    {
      files: [
        { path: "document.md", role: "canonical" },
        { path: "product.md", role: "profile" },
      ],
    },
  );
  assert.deepEqual(marked.openingComponentIds, ["profiles", "canonical"]);
  assert.deepEqual(marked.relationships, plain.relationships);
  const source = buildProjectMapMermaidGraph(marked).source;
  assert.match(source, /class pm0 opening;/);
  assert.match(source, /class pm1 opening;/);
  assert.doesNotMatch(source, /class practice opening;/);
});

test("Structure activation enters aggregates and opens document leaves in Reader", () => {
  assert.deepEqual(projectMapComponentActivation(components[1], 3), {
    kind: "hierarchy",
    componentId: "profiles",
  });
  assert.deepEqual(projectMapComponentActivation(components[5], 0), {
    kind: "reader",
    path: "document.md",
  });
  assert.deepEqual(projectMapComponentActivation(components[6], 0), {
    kind: "external-path",
    path: "src",
  });
});

test("an unconnected role remains present in the Mermaid overview", () => {
  const projection = deriveProjectMapFocusProjection(
    map,
    "root",
    new Set(),
    false,
  );
  const graph = buildProjectMapMermaidGraph(projection);

  assert.equal(graph.origin, "root-overview");
  assert.equal(graph.keyByComponentId.has("root"), false);
  assert.equal(graph.keyByComponentId.has("profiles"), true);
  assert.equal(graph.keyByComponentId.has("canonical"), true);
  assert.equal(graph.keyByComponentId.has("practice"), true);
  assert.doesNotMatch(graph.source, /-\.->/);
});

test("the root overview emits a smooth Dagre Mermaid relationship graph", () => {
  const projection = deriveProjectMapFocusProjection(
    map,
    "root",
    new Set(["governs", "implements", "verifies"]),
    true,
  );
  const graph = buildProjectMapMermaidGraph(projection);

  assert.equal(graph.origin, "root-overview");
  assert.equal(
    graph.source,
    `%%{init: {
  "flowchart": {
    "curve": "basis",
    "padding": 20
  }
}}%%
flowchart TD
  pm0@{ shape: rounded, label: "Profile" } -->|"governs"| pm1@{ shape: rounded, label: "Canonical documentation" }
  pm2@{ shape: rounded, label: "Reference note" }
`,
  );
  assert.doesNotMatch(graph.source, /durable purpose and design boundaries/);
  assert.doesNotMatch(graph.source, /implementation-facing contracts/);
  assert.equal(graph.keyByComponentId.has("root"), false);
  assert.equal(graph.keyByComponentId.has("substrate"), false);
  assert.equal(graph.keyByComponentId.has("document"), false);
  assert.equal(graph.keyByComponentId.has("code"), false);
});

test("Structure layout reversal changes placement without reversing authored arrows", () => {
  assert.equal(reverseProjectMapDirection("td"), "bt");
  assert.equal(reverseProjectMapDirection("tb"), "bt");
  assert.equal(reverseProjectMapDirection("bt"), "tb");
  assert.equal(reverseProjectMapDirection("lr"), "rl");
  assert.equal(reverseProjectMapDirection("rl"), "lr");

  const projection = deriveProjectMapFocusProjection(
    map,
    "root",
    new Set(["governs"]),
    true,
  );
  const graph = buildProjectMapMermaidGraph(projection, "bt");

  assert.match(graph.source, /^%%\{init:[\s\S]*\nflowchart BT\n/);
  assert.match(
    graph.source,
    /pm0@\{ shape: rounded, label: "Profile" \} -->\|"governs"\| pm1@\{ shape: rounded, label: "Canonical documentation" \}/,
  );
});

test("reversed recursive Structure projections orient nested layers bottom-up", () => {
  const projection = deriveProjectMapFocusProjection(
    map,
    "root",
    new Set(["governs"]),
    true,
    undefined,
    2,
  );
  const graph = buildProjectMapMermaidGraph(projection, "bt");

  assert.match(graph.source, /flowchart BT/);
  assert.match(graph.source, /subgraph pm\d+\[/);
  assert.match(graph.source, /direction BT/);
});

test("the root overview preserves dotted authored relationships", () => {
  const dottedMap = {
    ...map,
    relationships: [
      {
        source: "practice",
        type: "supports interpretation of",
        direction: "source-to-target",
        target: "profiles",
        line: "dotted",
      },
    ],
  };
  const projection = deriveProjectMapFocusProjection(
    dottedMap,
    "root",
    new Set(["supports interpretation of"]),
    true,
  );
  const graph = buildProjectMapMermaidGraph(projection);

  assert.match(
    graph.source,
    /pm2@\{ shape: rounded, label: "Reference note" \} -\. "supports interpretation of" \.-> pm0@\{/,
  );
  assert.equal(graph.keyByComponentId.has("canonical"), true);
});

test("folded relationship labels balance their lines instead of orphaning a final word", () => {
  const balancedMap = {
    ...map,
    relationships: [
      {
        source: "profiles",
        type: "records accepted reasoning for",
        direction: "source-to-target",
        target: "canonical",
      },
      {
        source: "profiles",
        type: "applies decision pressure to",
        direction: "source-to-target",
        target: "canonical",
      },
      {
        source: "profiles",
        type: "tracks development of",
        direction: "source-to-target",
        target: "canonical",
      },
    ],
  };
  const projection = deriveProjectMapFocusProjection(
    balancedMap,
    "root",
    new Set([
      "records accepted reasoning for",
      "applies decision pressure to",
      "tracks development of",
    ]),
    true,
  );
  const graph = buildProjectMapMermaidGraph(projection);

  assert.match(
    graph.source,
    /\|"records accepted<br\/>reasoning for"\|/,
  );
  assert.doesNotMatch(
    graph.source,
    /records accepted reasoning<br\/>for/,
  );
  assert.match(
    graph.source,
    /\|"applies decision<br\/>pressure to"\|/,
  );
  assert.doesNotMatch(
    graph.source,
    /applies decision pressure<br\/>to/,
  );
  assert.match(graph.source, /\|"tracks development of"\|/);

  const enlargedGraph = buildProjectMapMermaidGraph(
    projection,
    "td",
    1.4,
  );
  assert.match(
    enlargedGraph.source,
    /\|"applies decision<br\/>pressure to"\|/,
  );
  assert.match(
    enlargedGraph.source,
    /\|"tracks<br\/>development of"\|/,
  );
  assert.doesNotMatch(
    enlargedGraph.source,
    /tracks development<br\/>of/,
  );
});

test("interactive nodes recover authored IDs from Mermaid's diagram-prefixed SVG IDs", () => {
  assert.equal(
    projectMapMermaidRenderedNodeId(
      "mindflow-project-map-_r_0_-flowchart-continuous_trace_scaffold-22",
    ),
    "continuous_trace_scaffold",
  );
  assert.equal(projectMapMermaidRenderedNodeId("unrelated-node"), undefined);
});

test("a focused Mermaid graph contains children and projected edges without repeating its layer identity", () => {
  const projection = deriveProjectMapFocusProjection(
    map,
    "canonical",
    new Set(["governs", "implements", "verifies"]),
    true,
  );
  const graph = buildProjectMapMermaidGraph(projection);
  const substrate = graph.keyByComponentId.get("substrate");

  assert.match(graph.source, /"padding": 20/);
  assert.equal(graph.keyByComponentId.has("canonical"), false);
  assert.doesNotMatch(graph.source, /Canonical documentation/);
  assert.doesNotMatch(graph.source, /-\.->/);
  assert.match(graph.source, new RegExp(`class ${substrate} aggregate`));
  assert.doesNotMatch(graph.source, /implementation-facing contracts/);
  assert.equal(
    [...graph.nodeByKey.values()].filter(
      (component) => component.id === "substrate",
    ).length,
    1,
  );
});

test("Mermaid gives categories, files, and external targets distinct native shapes", () => {
  const projection = deriveProjectMapFocusProjection(
    map,
    "substrate",
    new Set(["verifies"]),
    true,
  );
  const graph = buildProjectMapMermaidGraph(projection);
  const documentKey = graph.keyByComponentId.get("document");
  const externalKey = graph.keyByComponentId.get("code");

  assert.match(graph.source, new RegExp(`${documentKey}@\\{ shape: doc,`));
  assert.match(
    graph.source,
    new RegExp(`${externalKey}@\\{ shape: notch-rect,`),
  );
  assert.match(graph.source, /class pm\d+ document/);
  assert.match(graph.source, /class pm\d+ external/);
});

test("Mermaid node and relationship text cannot escape generated labels", () => {
  const unsafeMap = {
    ...map,
    components: map.components.map((component) =>
      component.id === "canonical"
        ? { ...component, label: 'Canonical "quoted" <unsafe>' }
        : component,
    ),
    relationships: [
      {
        source: "profiles",
        type: "governs|unexpected",
        direction: "source-to-target",
        target: "canonical",
      },
    ],
  };
  const projection = deriveProjectMapFocusProjection(
    unsafeMap,
    "root",
    new Set(["governs|unexpected"]),
    true,
  );
  const graph = buildProjectMapMermaidGraph(projection);

  assert.doesNotMatch(graph.source, /<unsafe>/);
  assert.doesNotMatch(graph.source, /"quoted"/);
  assert.doesNotMatch(graph.source, /"governs\|unexpected"/);
  assert.match(graph.source, /Canonical &quot;quoted&quot; &lt;unsafe&gt;/);
  assert.match(graph.source, /governs&#124;unexpected/);
});


test("Anchor path correspondence preserves distinct current and historical Timeline identities", async () => {
  const {timelineIdentitiesForPaths} = await import("./types.ts");
  const graph = {documents:[
    {component:"current",path:"docs/reused.md"},
    {component:"another",path:"docs/other.md"},
  ],historical_components:{
    retired: {path:"docs/reused.md"},
    old: {path:"gone.md"},
  }};
  assert.deepEqual(timelineIdentitiesForPaths(graph, ["docs/reused.md", "gone.md", "docs/reused.md"]),
    ["current", "retired", "old"]);
  assert.deepEqual(timelineIdentitiesForPaths(graph, ["unmanaged.md"]), []);
});
