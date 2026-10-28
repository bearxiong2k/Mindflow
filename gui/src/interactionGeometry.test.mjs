import {documentDirectory} from "./types.ts";
import assert from "node:assert/strict";
import test from "node:test";

import {
  classicalClientToLocalScale,
  classicalRelationshipLaneX,
  classicalRelationshipPath,
  layoutMapNodeLabels,
  resolveTextBoxSize,
  routeClassicalRelationships,
} from "./interactionGeometry.ts";
import {
  classicalDirectoryExpanded,
  classicalDirectoryShowsAllChildren,
  initialClassicalExpansion,
  toggleClassicalDirectoryExpansion,
} from "./classicalTreeState.ts";
import {
  buildGraphLayout,
  buildRadialLayout,
  buildRadialRoleLabelLayout,
  compareRoleCollections,
  EXTERNAL_RADIUS,
  externalTargetKey,
  GRAPH_CENTER,
  LEAF_RADIUS,
  MAP_NODE_LABEL_FONT_SIZE,
  MAP_ROLE_LABEL_FONT_SIZE,
  orderDocumentsByRole,
  pointAt,
  RADIAL_RELATIONSHIP_MARKER_SIZES,
  relationshipPath,
  relationshipTypeSections,
  reorderLayerOrder,
  RING_EXTERNAL_NODE_RADIUS,
  RING_LEAF_NODE_SIZES,
  ROLE_INNER_RADIUS,
  roleColorStyle,
} from "./graph.ts";
import { buildRelationshipContext } from "./inspection.ts";
import {
  mermaidCodeBlockSource,
  mermaidSvgSize,
} from "./mermaidRendering.ts";
import { readerNavigationMode } from "./readerNavigation.ts";
import { resolveApplicationSurface } from "./readerSurface.ts";
import { managedFileName } from "./types.ts";

test("Reader recognizes only exact Mermaid fenced-code language blocks", () => {
  const source = "flowchart LR\n  present --> opening\n";
  assert.equal(
    mermaidCodeBlockSource("language-mermaid", source),
    source,
  );
  assert.equal(
    mermaidCodeBlockSource("highlight language-mermaid", [
      "sequenceDiagram\n",
      "  Human->>Mindflow: inspect\n",
    ]),
    "sequenceDiagram\n  Human->>Mindflow: inspect\n",
  );
  assert.equal(
    mermaidCodeBlockSource("language-typescript", source),
    undefined,
  );
  assert.equal(mermaidCodeBlockSource(undefined, source), undefined);
});

test("Mermaid examination uses the exact vector view-box dimensions", () => {
  assert.deepEqual(
    mermaidSvgSize('<svg viewBox="0 0 2770.5 650"></svg>'),
    { width: 2770.5, height: 650 },
  );
  assert.deepEqual(
    mermaidSvgSize("<svg viewBox='-20,-10,1200,800'></svg>"),
    { width: 1200, height: 800 },
  );
  assert.deepEqual(mermaidSvgSize("<svg></svg>"), {
    width: 960,
    height: 540,
  });
});

test("managed-file activation reserves the primary modifier for a new Reader", () => {
  assert.equal(
    readerNavigationMode({ metaKey: false, ctrlKey: false }),
    "same-reader",
  );
  assert.equal(
    readerNavigationMode({ metaKey: true, ctrlKey: false }),
    "new-reader",
  );
  assert.equal(
    readerNavigationMode({ metaKey: false, ctrlKey: true }),
    "new-reader",
  );
});

test("Reader windows resolve to their dedicated native frontend surface", () => {
  assert.equal(resolveApplicationSurface("", "main"), "workspace");
  assert.equal(resolveApplicationSurface("", "workspace-2"), "workspace");
  assert.equal(resolveApplicationSurface("", "reader-1"), "reader");
  assert.equal(resolveApplicationSurface("?surface=reader", undefined), "reader");
});

test("map labels remain bounded with compact non-overlapping spacing on each side", () => {
  const labels = layoutMapNodeLabels(
    [
      { key: "left-a", label: "profiles/a.md", point: { x: 80, y: 50 } },
      { key: "left-b", label: "profiles/b.md", point: { x: 90, y: 54 } },
      { key: "right-a", label: "canonical_docs/a.md", point: { x: 720, y: 190 } },
      { key: "right-b", label: "canonical_docs/b.md", point: { x: 730, y: 194 } },
    ],
    { width: 800, height: 260 },
  );

  for (const label of labels) {
    assert.ok(label.x >= 8);
    assert.ok(label.y >= 8);
    assert.ok(label.x + label.width <= 792);
    assert.ok(label.y + label.height <= 252);
  }
  for (const side of ["left", "right"]) {
    const ordered = labels
      .filter((label) => label.side === side)
      .sort((left, right) => left.y - right.y);
    assert.equal(
      ordered[1].y - (ordered[0].y + ordered[0].height),
      2,
    );
  }
});

test("selected map label stays aligned while neighboring labels yield", () => {
  const labels = layoutMapNodeLabels(
    [
      { key: "before", label: "before.md", point: { x: 650, y: 98 } },
      { key: "selected", label: "selected.md", point: { x: 660, y: 100 } },
      { key: "after", label: "after.md", point: { x: 670, y: 102 } },
    ],
    { width: 800, height: 260 },
    new Map([
      ["before", { width: 90, height: 28 }],
      ["selected", { width: 90, height: 28 }],
      ["after", { width: 90, height: 28 }],
    ]),
    "selected",
  );
  const byKey = new Map(labels.map((label) => [label.key, label]));
  const before = byKey.get("before");
  const selected = byKey.get("selected");
  const after = byKey.get("after");

  assert.ok(before);
  assert.ok(selected);
  assert.ok(after);
  assert.equal(selected.y + selected.height / 2, selected.point.y);
  assert.equal(selected.y - (before.y + before.height), 2);
  assert.equal(after.y - (selected.y + selected.height), 2);
});

test("selected map label yields only enough to keep its neighbors bounded", () => {
  const labels = layoutMapNodeLabels(
    [
      { key: "before", label: "before.md", point: { x: 650, y: 10 } },
      { key: "selected", label: "selected.md", point: { x: 660, y: 20 } },
      { key: "after", label: "after.md", point: { x: 670, y: 24 } },
    ],
    { width: 800, height: 260 },
    new Map([
      ["before", { width: 90, height: 28 }],
      ["selected", { width: 90, height: 28 }],
      ["after", { width: 90, height: 28 }],
    ]),
    "selected",
  );
  const byKey = new Map(labels.map((label) => [label.key, label]));
  const before = byKey.get("before");
  const selected = byKey.get("selected");

  assert.ok(before);
  assert.ok(selected);
  assert.equal(before.y, 8);
  assert.equal(selected.y, before.y + before.height + 2);
});

test("measured long map labels use their complete one-line width", () => {
  const candidate = {
    key: "long",
    label:
      "a-deliberately-long-file-name-that-must-remain-fully-visible-without-wrapping.md",
    point: { x: 400, y: 130 },
  };
  const [estimated] = layoutMapNodeLabels(
    [candidate],
    { width: 800, height: 260 },
  );
  const [measured] = layoutMapNodeLabels(
    [candidate],
    { width: 800, height: 260 },
    new Map([[candidate.key, { width: 438, height: 23 }]]),
  );

  assert.equal(estimated.width, 320);
  assert.equal(estimated.height, 28);
  assert.equal(measured.width, 438);
  assert.equal(measured.height, 23);
});

test("measured map labels can shrink below an oversized estimate", () => {
  const candidate = {
    key: "document:architecture",
    label: "architecture-and-boundaries.md",
    point: { x: 400, y: 130 },
  };
  const [estimated] = layoutMapNodeLabels(
    [candidate],
    { width: 800, height: 260 },
  );
  const [singleLine] = layoutMapNodeLabels(
    [candidate],
    { width: 800, height: 260 },
    new Map([[candidate.key, { width: 162, height: 23 }]]),
  );
  assert.ok(estimated.width > singleLine.width);
  assert.equal(singleLine.width, 162);
  assert.equal(estimated.height, 28);
  assert.equal(singleLine.height, 23);
});

test("Structure and Timeline text boxes share intrinsic measured sizing", () => {
  const label = "canonical_docs/10-human-interface.md";
  const measured = { width: 207, height: 15 };
  assert.deepEqual(resolveTextBoxSize(label, measured), {
    width: 207,
    height: 15,
  });

  const [structureLabel] = layoutMapNodeLabels(
    [{ key: "shared", label, point: { x: 400, y: 130 } }],
    { width: 800, height: 260 },
    new Map([["shared", measured]]),
  );
  assert.deepEqual(
    { width: structureLabel.width, height: structureLabel.height },
    resolveTextBoxSize(label, measured),
  );
});

test("measured map labels keep a compact minimum width", () => {
  const [label] = layoutMapNodeLabels(
    [{ key: "short", label: "a.md", point: { x: 400, y: 130 } }],
    { width: 800, height: 260 },
    new Map([["short", { width: 31, height: 23 }]]),
  );

  assert.equal(label.width, 40);
});

test("map document labels use the file name while preserving path identity elsewhere", () => {
  assert.equal(
    managedFileName("long_term_steering/local-toolchain.md"),
    "local-toolchain.md",
  );
  assert.equal(managedFileName("Documentation.md"), "Documentation.md");
});

test("Ring relationship arrowheads are smaller than Graph arrowheads", () => {
  assert.equal(RADIAL_RELATIONSHIP_MARKER_SIZES.ring, 6);
  assert.equal(RADIAL_RELATIONSHIP_MARKER_SIZES.graph, 8);
  assert.ok(
    RADIAL_RELATIONSHIP_MARKER_SIZES.ring <
      RADIAL_RELATIONSHIP_MARKER_SIZES.graph,
  );
});

test("Ring relationship arrows stop outside the emphasized target node", () => {
  for (const targetAngle of [0, Math.PI / 4, Math.PI / 2, Math.PI * 1.35]) {
    const source = {
      document: { path: "source.md", role: "source" },
      directory: ".",
      angle: targetAngle + Math.PI,
      interval: 0,
      point: pointAt(targetAngle + Math.PI, LEAF_RADIUS),
    };
    const target = {
      document: { path: "target.md", role: "target" },
      directory: ".",
      angle: targetAngle,
      interval: 0,
      point: pointAt(targetAngle, LEAF_RADIUS),
    };
    const layout = {
      leaves: [source, target],
      leafByPath: new Map([
        [source.document.path, source],
        [target.document.path, target],
      ]),
      externalTargets: [],
      externalByKey: new Map(),
    };
    const path = relationshipPath(
      {
        source: source.document.path,
        target: target.document.path,
        type: "guides",
        direction: "source-to-target",
      },
      layout,
      "ring",
    );

    assert.ok(path);
    const endpoint = path.match(/, ([^ ]+) ([^ ]+)$/);
    assert.ok(endpoint);
    const endX = Number(endpoint[1]);
    const endY = Number(endpoint[2]);
    const maximumAxisInset = Math.max(
      Math.abs(endX - target.point.x),
      Math.abs(endY - target.point.y),
    );

    assert.ok(maximumAxisInset > RING_LEAF_NODE_SIZES.emphasized / 2);
    assert.ok(maximumAxisInset < RING_LEAF_NODE_SIZES.emphasized / 2 + 4);
  }
});

test("Ring relationship arrows stop outside external target nodes", () => {
  const source = {
    document: { path: "source.md", role: "source" },
    directory: ".",
    angle: Math.PI,
    interval: 0,
    point: pointAt(Math.PI, LEAF_RADIUS),
  };
  const externalTarget = { path: "src/lib.rs" };
  const external = {
    key: externalTargetKey(externalTarget),
    target: externalTarget,
    label: externalTarget.path,
    angle: 0,
    point: pointAt(0, EXTERNAL_RADIUS),
  };
  const path = relationshipPath(
    {
      source: source.document.path,
      target: externalTarget,
      type: "implements",
      direction: "source-to-target",
    },
    {
      leaves: [source],
      leafByPath: new Map([[source.document.path, source]]),
      externalTargets: [external],
      externalByKey: new Map([[external.key, external]]),
    },
    "ring",
  );

  assert.ok(path);
  const endpoint = path.match(/, ([^ ]+) ([^ ]+)$/);
  assert.ok(endpoint);
  const endpointDistance = Math.hypot(
    Number(endpoint[1]) - external.point.x,
    Number(endpoint[2]) - external.point.y,
  );

  assert.ok(endpointDistance > RING_EXTERNAL_NODE_RADIUS);
  assert.ok(endpointDistance < RING_EXTERNAL_NODE_RADIUS + 4);
});

test("Classical lanes cluster equal relationship types", () => {
  const routing = routeClassicalRelationships([
    { index: 1, type: "governs", source: "a.md", target: "b.md" },
    { index: 3, type: "realizes", source: "a.md", target: "d.md" },
    { index: 2, type: "governs", source: "a.md", target: "c.md" },
  ]);

  assert.deepEqual(
    routing.routes.map((route) => route.index),
    [1, 2, 3],
  );
  assert.equal(routing.routes[1].laneOffset - routing.routes[0].laneOffset, 7);
  assert.equal(routing.routes[2].laneOffset - routing.routes[1].laneOffset, 19);
  assert.ok(routing.laneWidth > routing.routes[2].laneOffset);
  assert.ok(
    Math.abs(routing.routes[1].sourceOffset - routing.routes[0].sourceOffset) <
      Math.abs(routing.routes[2].sourceOffset - routing.routes[1].sourceOffset),
  );
});

test("Classical relationship paths are straight vertical arrows", () => {
  const path = classicalRelationshipPath(280, 42.3333, 148.8888);
  assert.equal(path, "M 280 42.3 V 148.9");
  assert.ok(!path.includes("42.3333"));
});

test("Classical relationship measurements return to local SVG coordinates after interface scaling", () => {
  const localHeight = 720;
  const localRowCenter = 315.5;

  for (const interfaceScale of [0.8, 1, 1.2, 1.4]) {
    const clientToLocal = classicalClientToLocalScale(
      localHeight,
      localHeight * interfaceScale,
    );
    const measuredRowCenter = localRowCenter * interfaceScale;
    assert.ok(
      Math.abs(measuredRowCenter * clientToLocal - localRowCenter) < 0.000001,
    );
  }

  assert.equal(classicalClientToLocalScale(0, 864), 1);
  assert.equal(classicalClientToLocalScale(720, Number.NaN), 1);
});

test("Classical relationship lanes stay inside the visible tree viewport", () => {
  const visibleRightX = 410;
  const laneWidth = 58;
  const laneOriginX = classicalRelationshipLaneX(visibleRightX, laneWidth);

  assert.equal(laneOriginX, 352);
  assert.ok(laneOriginX + 14 < visibleRightX);
  assert.equal(classicalRelationshipLaneX(620, laneWidth), 562);
});

test("Classical suspends contextual folding while the tree is active", () => {
  const relevant = new Set(["profiles", "profiles/history"]);
  const revealed = new Set(["canonical_docs"]);
  const manual = initialClassicalExpansion(
    ["profiles", "profiles/history", "canonical_docs", "notes"],
    true,
    relevant,
    revealed,
  );

  assert.deepEqual([...manual], [
    "profiles",
    "profiles/history",
    "canonical_docs",
  ]);
  assert.equal(
    classicalDirectoryExpanded(
      "profiles",
      true,
      false,
      relevant,
      revealed,
      new Set(),
    ),
    true,
  );
  assert.equal(
    classicalDirectoryExpanded(
      "profiles",
      true,
      true,
      relevant,
      revealed,
      new Set(),
    ),
    false,
  );
  assert.equal(
    classicalDirectoryShowsAllChildren("profiles", true, false, revealed),
    false,
  );
  assert.equal(
    classicalDirectoryShowsAllChildren("profiles", true, true, revealed),
    true,
  );
  assert.deepEqual(
    [...toggleClassicalDirectoryExpansion(undefined, manual, "notes")],
    ["profiles", "profiles/history", "canonical_docs", "notes"],
  );
});

test("Graph places every document in one deterministic role layer", () => {
  const fixture = {
    format: "2026-10-27",
    documents: [
      {
        path: "authority/a.md",
        role: "authority",
        relationships: [],
        groups: {},
        values: {},
      },
      {
        path: "authority/z.md",
        role: "authority",
        relationships: [],
        groups: {},
        values: {},
      },
      {
        path: "steering/a.md",
        role: "steering",
        relationships: [],
        groups: {},
        values: {},
      },
      {
        path: "steering/z.md",
        role: "steering",
        relationships: [],
        groups: {},
        values: {},
      },
    ],
    relationships: [
      {
        source: "steering/a.md",
        type: "targets",
        direction: "source-to-target",
        target: "authority/z.md",
      },
      {
        source: "steering/z.md",
        type: "targets",
        direction: "source-to-target",
        target: "authority/a.md",
      },
      {
        source: "authority/a.md",
        type: "realizes",
        direction: "source-to-target",
        target: { path: "src/lib.rs" },
      },
    ],
    roles: {
      authority: { description: "Owns the current contract." },
      steering: { description: "Carries developing intent." },
    },
    relationship_types: {},
    group_kinds: {},
    groups: [],
    events: [],
    anchors: {},
  };
  const graph = filesystemGraph(fixture.documents,fixture.relationships);

  const first = buildGraphLayout(graph);
  const second = buildGraphLayout(graph);
  assert.deepEqual(
    first.roleLayers?.map(({ key, count }) => ({ key, count })),
    [
      { key: "role:authority", count: 2 },
      { key: "role:steering", count: 2 },
      { key: "external-targets", count: 1 },
    ],
  );

  for (const document of graph.documents) {
    const layer = first.roleLayers?.find(
      (candidate) => candidate.key === `role:${documentDirectory(document)}`,
    );
    const point = first.leafByPath.get(document.path)?.point;
    assert.ok(layer);
    assert.ok(point);
    assert.ok(point.x > layer.bounds.left && point.x < layer.bounds.right);
    assert.ok(point.y > layer.bounds.top && point.y < layer.bounds.bottom);
  }

  assert.ok(
    first.leafByPath.get("authority/z.md").point.x <
      first.leafByPath.get("authority/a.md").point.x,
  );

  assert.deepEqual(
    first.leaves.map(({ document, point }) => [document.path, point]),
    second.leaves.map(({ document, point }) => [document.path, point]),
  );

  const reordered = buildGraphLayout(graph, {
    roleOrder: ["steering", "authority"],
    visibleRoles: new Set(["steering", "authority"]),
  });
  assert.deepEqual(
    reordered.roleLayers?.map(({ key }) => key),
    ["role:steering", "role:authority", "external-targets"],
  );

  const filtered = buildGraphLayout(graph, {
    roleOrder: ["steering", "authority"],
    visibleRoles: new Set(["steering"]),
  });
  assert.deepEqual(
    filtered.roleLayers?.map(({ key, count }) => ({ key, count })),
    [{ key: "role:steering", count: 2 }],
  );
  assert.deepEqual(
    filtered.leaves.map(({ document }) => document.path),
    ["steering/a.md", "steering/z.md"],
  );
  assert.equal(filtered.externalTargets.length, 0);

  const withoutExternalTargets = buildGraphLayout(graph, {
    roleOrder: ["steering", "authority"],
    visibleRoles: new Set(["steering", "authority"]),
    includeExternalTargets: false,
  });
  assert.deepEqual(
    withoutExternalTargets.roleLayers?.map(({ key }) => key),
    ["role:steering", "role:authority"],
  );
  assert.equal(withoutExternalTargets.externalTargets.length, 0);

  const radialWithoutExternalTargets = buildRadialLayout(graph, {
    includeExternalTargets: false,
  });
  assert.equal(radialWithoutExternalTargets.externalTargets.length, 0);
  assert.equal(radialWithoutExternalTargets.leaves.length, 4);

  const radialSteeringOnly = buildRadialLayout(graph, {
    roleOrder: ["steering", "authority"],
    visibleRoles: new Set(["steering"]),
  });
  assert.deepEqual(
    radialSteeringOnly.leaves.map(({ document }) => document.path),
    ["steering/a.md", "steering/z.md"],
  );
  assert.equal(radialSteeringOnly.externalTargets.length, 0);

  const reorderedRadial = buildRadialLayout(graph, {
    roleOrder: ["steering", "authority"],
    visibleRoles: new Set(["steering", "authority"]),
  });
  assert.deepEqual(
    reorderedRadial.cyclicRoleLayers.map(({ role }) => role),
    ["steering", "authority"],
  );
  for (const leaf of reorderedRadial.leaves) {
    const layer = reorderedRadial.cyclicRoleLayers.find(
      (candidate) => candidate.role === leaf.document.role,
    );
    assert.ok(layer);
    assert.ok(leaf.angle >= layer.startAngle);
    assert.ok(leaf.angle <= layer.endAngle);
  }

  assert.deepEqual(roleColorStyle("authority"), roleColorStyle("authority"));
  assert.notDeepEqual(roleColorStyle("authority"), roleColorStyle("steering"));
});

test("Ring role color is stable when cyclic layer order changes", () => {
  const roles = ["authority", "steering", "profile"];
  const before = new Map(roles.map((role) => [role, roleColorStyle(role)]));
  const after = new Map(
    [...roles].reverse().map((role) => [role, roleColorStyle(role)]),
  );

  for (const role of roles) {
    assert.deepEqual(after.get(role), before.get(role));
  }
});

test("Structural role names use a larger typographic step than node names", () => {
  assert.ok(MAP_ROLE_LABEL_FONT_SIZE > MAP_NODE_LABEL_FONT_SIZE);
});

test("Ring role labels remain horizontal and attach directly to their sectors", () => {
  const roleNames = [
    "canonical documentation",
    "deferred question",
    "design discussion",
    "documentation governance",
    "profile",
    "steering plan",
    "trim manual",
  ];
  const layers = roleNames.map((role, index) => ({
    role,
    startAngle: -0.9 + index * 0.13,
    endAngle: -0.79 + index * 0.13,
    index,
    count: 1,
  }));
  const labels = buildRadialRoleLabelLayout(layers);
  const enlargedLabels = buildRadialRoleLabelLayout(layers, 1.4);

  assert.deepEqual(labels.map((label) => label.role), roleNames);
  assert.equal(enlargedLabels[0].height, labels[0].height * 1.4);
  assert.ok(enlargedLabels[0].width > labels[0].width);
  for (const label of labels) {
    assert.ok(
      Math.abs(
        Math.hypot(
          label.x - GRAPH_CENTER.x,
          label.y - GRAPH_CENTER.y,
        ) -
          ROLE_INNER_RADIUS,
      ) < 0.001,
    );
  }
  for (let leftIndex = 0; leftIndex < labels.length; leftIndex += 1) {
    const left = labels[leftIndex];
    const leftBounds = {
      left: left.side === "left" ? left.x : left.x - left.width,
      right: left.side === "left" ? left.x + left.width : left.x,
      top: left.y - left.height / 2,
      bottom: left.y + left.height / 2,
    };
    for (const right of labels.slice(leftIndex + 1)) {
      const rightBounds = {
        left: right.side === "left" ? right.x : right.x - right.width,
        right: right.side === "left" ? right.x + right.width : right.x,
        top: right.y - right.height / 2,
        bottom: right.y + right.height / 2,
      };
      assert.ok(
        leftBounds.right + 3 <= rightBounds.left ||
          rightBounds.right + 3 <= leftBounds.left ||
          leftBounds.bottom + 3 <= rightBounds.top ||
          rightBounds.bottom + 3 <= leftBounds.top,
      );
    }
  }
});

test("Ring moves a spacious role label away from a crowded inner sector", () => {
  const profileStart = 1.278;
  const profileEnd = 2.655;
  const labels = buildRadialRoleLabelLayout([
    {
      role: "canonical documentation",
      startAngle: 0.469,
      endAngle: 0.666,
      index: 0,
      count: 1,
    },
    {
      role: "deferred question",
      startAngle: 0.738,
      endAngle: 0.935,
      index: 1,
      count: 1,
    },
    {
      role: "documentation governance",
      startAngle: 1.008,
      endAngle: 1.205,
      index: 2,
      count: 1,
    },
    {
      role: "profile",
      startAngle: profileStart,
      endAngle: profileEnd,
      index: 3,
      count: 8,
    },
  ]);
  const profile = labels.find((label) => label.role === "profile");
  const midpoint = (profileStart + profileEnd) / 2;
  const midpointX = GRAPH_CENTER.x + Math.cos(midpoint) * ROLE_INNER_RADIUS;

  assert.ok(profile);
  assert.ok(profile.x < midpointX - 20);
});

test("Role order ranks documents deterministically", () => {
  const documents = [
    { path: "same/a.md", role: "authority" },
    { path: "same/index.md", role: "steering", index: true },
    { path: "same/z.md", role: "steering" },
    { path: "same/b.md", role: "steering" },
  ];
  assert.deepEqual(
    orderDocumentsByRole(documents, ["steering", "authority"]).map(
      ({ path }) => path,
    ),
    ["same/a.md", "same/b.md", "same/index.md", "same/z.md"],
  );
});

test("Classical folder order follows the earliest represented role layer", () => {
  const folders = [
    { path: "canonical_docs", roles: ["canonical"] },
    { path: "profiles", roles: ["profile"] },
    { path: "long_term_steering", roles: ["steering"] },
  ];
  const orderFolders = (roleOrder) =>
    [...folders]
      .sort(
        (left, right) =>
          compareRoleCollections(left.roles, right.roles, roleOrder) ||
          left.path.localeCompare(right.path),
      )
      .map(({ path }) => path);

  assert.deepEqual(
    orderFolders(["profile", "canonical", "steering"]),
    ["profiles", "canonical_docs", "long_term_steering"],
  );
  assert.deepEqual(
    orderFolders(["steering", "canonical", "profile"]),
    ["long_term_steering", "canonical_docs", "profiles"],
  );
});

test("Role layers reorder by a before or after drop position", () => {
  const order = ["profile", "canonical", "steering", "history"];
  assert.deepEqual(
    reorderLayerOrder(order, "profile", "steering", "after"),
    ["canonical", "steering", "profile", "history"],
  );
  assert.deepEqual(
    reorderLayerOrder(order, "history", "canonical", "before"),
    ["profile", "history", "canonical", "steering"],
  );
  assert.equal(
    reorderLayerOrder(order, "profile", "canonical", "before"),
    order,
  );
});

test("Structure exposes one relationship glossary", () => {
  assert.deepEqual(
    relationshipTypeSections({
      "indexes": {
        description: "Provides navigation.",
        direction: "directional",
      },
      "is governed by": {
        description: "Names governing authority.",
        direction: "directional",
      },
    }),
    {
      relationships: ["indexes", "is governed by"],
    },
  );
});

test("External-target visibility removes external context without hiding internal context", () => {
  const fixture = {
    documents: [{path:"a.md"},{path:"b.md"}],
    relationships: [
      {
        source: "a.md",
        type: "governs",
        direction: "source-to-target",
        target: "b.md",
      },
      {
        source: "a.md",
        type: "implements",
        direction: "source-to-target",
        target: { path: "src/lib.rs" },
      },
    ],
  };
  const graph = filesystemGraph(fixture.documents,fixture.relationships);
  const context = buildRelationshipContext(
    graph,
    "a.md",
    new Set(["governs", "implements"]),
    false,
  );

  assert.deepEqual([...context.relationshipIndexes], [0]);
  assert.deepEqual([...context.documentPaths], ["a.md", "b.md"]);
  assert.equal(context.externalKeys.size, 0);
});

test("Role visibility removes hidden endpoints and incident lines", () => {
  const fixture = {
    documents: [
      { path: "visible/a.md", role: "visible" },
      { path: "hidden/b.md", role: "hidden" },
    ],
    relationships: [
      {
        source: "visible/a.md",
        type: "governs",
        direction: "source-to-target",
        target: "hidden/b.md",
      },
      {
        source: "visible/a.md",
        type: "implements",
        direction: "source-to-target",
        target: { path: "src/lib.rs" },
      },
    ],
  };
  const graph = filesystemGraph(fixture.documents,fixture.relationships);
  const context = buildRelationshipContext(
    graph,
    "visible/a.md",
    new Set(["governs", "implements"]),
    true,
    new Set(["visible"]),
  );

  assert.deepEqual([...context.documentPaths], ["visible/a.md"]);
  assert.deepEqual([...context.relationshipIndexes], [1]);
  assert.deepEqual([...context.externalKeys], ["path:src/lib.rs"]);
});

function filesystemGraph(documents, relationships) {
  const paths = [...new Set([...documents.map(d=>d.path),...relationships.flatMap(r=>[r.source,typeof r.target==="string"?r.target:r.target.path])])];
  const ids=new Map(paths.map((path,index)=>[path,`entry_${index}`]));
  return {format:"2026-10-27", documents:documents.map(d=>({...d,component:ids.get(d.path)})), structure:{nodes:paths.map(path=>({path,name:path.split("/").at(-1),kind:path.endsWith(".md")?"document":"target",component:{id:ids.get(path),index:false}})),relationships:relationships.map(r=>({...r,source:ids.get(r.source),target:ids.get(typeof r.target==="string"?r.target:r.target.path)}))},relationship_types:{},anchor_connection_types:{},events:[],anchors:{}};
}
