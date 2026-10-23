import {documentDirectory} from "./types.ts";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
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
  buildTimelinePresentation,
  buildTimelinePresentationFromTopology,
  buildTimelinePresentationTopology,
  buildTimelineSelectionTrace,
  bundleTimelinePaths,
  countTimelineBranchOverlaps,
  createTimelineSelectionResolver,
  timelineCanvasHeight,
  timelineCanvasWidth,
  timelineEventLogEntries,
  timelineEventMarkerLabel,
  timelineFoldRangeBetween,
  timelineFoldRangeKey,
  timelineFocusedIntentSpans,
  timelineFocusedRetirements,
  timelineIntentConnectorIsActive,
  timelineLaneHitRegion,
  timelineRetirementsCrossed,
  timelineSliceLaneState,
  resizeTimelineEntryRail,
  TIMELINE_COLUMN_WIDTH,
  TIMELINE_ENTRY_RAIL_DEFAULT_WIDTH,
  TIMELINE_JUNCTION_GAP,
  TIMELINE_LANE_GAP,
  TIMELINE_TOP_PADDING,
} from "./openingPresentation.ts";
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
import {
  centeredTimelineScrollLeft,
  MINIMUM_TIMELINE_INSPECTOR_HEIGHT,
  MINIMUM_TIMELINE_ORDINARY_HEIGHT,
  TIMELINE_PANEL_DRAG_THRESHOLD,
  resizeTimelinePanels,
  timelinePanelClientToLocalScale,
  timelinePanelDragMovement,
  timelinePanelLocalLength,
  timelineCommitTickPositions,
  timelineAnchorPosition,
  timelineFocusedEventBoundary,
  timelineFocusedEventBoundaryAtCanvasOrigin,
  timelineIntentOpensReader,
  timelineLeadingScrollInset,
  timelineScrollLeftForLeadingInset,
  timelineReorderProgress,
  timelineReorderValue,
  timelineRetirementMotionPhase,
  timelineRetirementMotionPhaseAt,
  TIMELINE_REORDER_DURATION_MS,
  TIMELINE_RETIREMENT_FADE_DURATION_MS,
  TIMELINE_RETIREMENT_HOLD_DURATION_MS,
  TIMELINE_RETIREMENT_MOVE_DURATION_MS,
  TIMELINE_RETIREMENT_TOTAL_DURATION_MS,
} from "./timelineInteraction.ts";
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
    format: "2026-10-20",
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

test("continuous events remain unified transitions of opening intents", () => {
  const presentation = buildTimelinePresentation([
    {
      name: "establish-root",
      predecessors: [],
      successors: ["root.md"],
    },
    {
      name: "open-child",
      predecessors: ["root.md"],
      successors: ["root.md", "child.md"],
    },
  ]);

  assert.deepEqual(
    presentation.events.map((marker) => marker.event.name),
    [
      "establish-root",
      "open-child",
    ],
  );
  assert.equal(presentation.connectors.length, 4);
  assert.ok(presentation.connectors.every((connector) => connector.path));
});

test("Timeline branches and merges intent lifelines through event junctions", () => {
  const presentation = buildTimelinePresentation([
    {
      name: "establish-root",
      predecessors: [],
      successors: ["root.md"],
    },
    {
      name: "branch-work",
      predecessors: ["root.md"],
      successors: ["root.md", "a.md", "b.md"],
    },
    {
      name: "merge-a",
      predecessors: ["root.md", "a.md"],
      successors: ["root.md"],
    },
  ]);

  assert.equal(presentation.columnCount, 4);
  assert.deepEqual(presentation.paths, ["root.md", "a.md", "b.md"]);
  assert.equal(presentation.spans.length, 5);
  assert.equal(presentation.connectors.length, 8);
  assert.deepEqual(
    presentation.events[1].event.successors,
    ["root.md", "a.md", "b.md"],
  );
});

test("Timeline slice ordering keeps open intents compact and retires only at the nearby boundary", () => {
  const events = [
    {
      name: "open-initial-intents",
      predecessors: [],
      successors: ["active.md", "legacy.md"],
    },
    {
      name: "open-future-current-intent",
      predecessors: ["active.md"],
      successors: ["active.md", "future.md"],
    },
    {
      name: "retire-legacy-intent",
      predecessors: ["legacy.md"],
      successors: [],
    },
    {
      name: "open-late-intent",
      predecessors: [],
      successors: ["late.md"],
    },
  ];
  const baselinePaths = [
    "active.md",
    "legacy.md",
    "future.md",
    "late.md",
  ];

  assert.deepEqual(timelineSliceLaneState(events, baselinePaths, 2), {
    eventBoundary: 2,
    openPaths: ["active.md", "legacy.md", "future.md"],
    retiredPaths: [],
    paths: ["active.md", "legacy.md", "future.md", "late.md"],
  });
  assert.deepEqual(timelineSliceLaneState(events, baselinePaths, 3), {
    eventBoundary: 3,
    openPaths: ["active.md", "future.md"],
    retiredPaths: ["legacy.md"],
    paths: ["active.md", "future.md", "late.md", "legacy.md"],
  });
  assert.deepEqual(timelineSliceLaneState(events, baselinePaths, 4), {
    eventBoundary: 4,
    openPaths: ["active.md", "future.md", "late.md"],
    retiredPaths: [],
    paths: ["active.md", "future.md", "late.md", "legacy.md"],
  });

  const beforeRetirement = buildTimelinePresentation(events, [], [], 2);
  const beforeRetirementSpans = timelineFocusedIntentSpans(beforeRetirement);
  assert.deepEqual(
    beforeRetirementSpans.map((span) => span.path),
    beforeRetirement.focusedSlice.openPaths,
  );
  assert.deepEqual(
    new Set(beforeRetirementSpans.map((span) => span.path)),
    new Set(["active.md", "legacy.md", "future.md"]),
  );
  assert.deepEqual(
    beforeRetirementSpans.map((span) => span.lane),
    [0, 1, 2],
  );
  assert.deepEqual(timelineFocusedRetirements(beforeRetirement), []);

  const atRetirement = buildTimelinePresentation(events, [], [], 3);
  const atRetirementSpans = timelineFocusedIntentSpans(atRetirement);
  assert.deepEqual(
    atRetirementSpans.map((span) => span.path),
    atRetirement.focusedSlice.openPaths,
  );
  assert.deepEqual(
    new Set(atRetirementSpans.map((span) => span.path)),
    new Set(["active.md", "future.md"]),
  );
  assert.deepEqual(
    atRetirementSpans.map((span) => span.lane),
    [0, 1],
  );
  assert.deepEqual(
    timelineFocusedRetirements(atRetirement).map(({ path, marker, span }) => ({
      path,
      event: marker.event.name,
      span: span?.path,
    })),
    [
      {
        path: "legacy.md",
        event: "retire-legacy-intent",
        span: "legacy.md",
      },
    ],
  );
  assert.deepEqual(timelineFocusedRetirements(
    buildTimelinePresentation(events, [], [], 4),
  ), []);
});

test("Timeline horizontal focus changes only after crossing an event marker", () => {
  const stops = [
    { x: 56, eventBoundary: 1 },
    { x: 206, eventBoundary: 2 },
    { x: 356, eventBoundary: 5 },
  ];

  assert.equal(timelineFocusedEventBoundary(stops, 55.9), 0);
  assert.equal(timelineFocusedEventBoundary(stops, 56), 1);
  assert.equal(timelineFocusedEventBoundary(stops, 205.9), 1);
  assert.equal(timelineFocusedEventBoundary(stops, 206), 2);
  assert.equal(timelineFocusedEventBoundary(stops, 1000), 5);
});

test("Timeline fast-scroll retirement collection keeps every crossed file in lane order", () => {
  const events = [
    {
      name: "open-work",
      predecessors: [],
      successors: ["active.md", "first.md", "second.md", "third.md"],
    },
    {
      name: "retire-first",
      predecessors: ["first.md"],
      successors: [],
    },
    {
      name: "retire-second-and-third",
      predecessors: ["second.md", "third.md"],
      successors: [],
    },
  ];
  const presentation = buildTimelinePresentation(events, [], [], 3);
  const retirements = timelineRetirementsCrossed(presentation, 1, 3);

  assert.deepEqual(
    retirements.map(({ path, eventBoundary }) => ({ path, eventBoundary })),
    presentation.paths
      .filter((path) => path !== "active.md")
      .map((path) => ({
        path,
        eventBoundary: path === "first.md" ? 2 : 3,
      })),
  );
  assert.deepEqual(
    new Set(retirements.map((retirement) => retirement.path)),
    new Set(["first.md", "second.md", "third.md"]),
  );
  assert.ok(retirements.every((retirement) => retirement.span));
  assert.deepEqual(timelineRetirementsCrossed(presentation, 3, 1), []);
});

test("Timeline lane focus follows the canvas edge until its origin is reachable", () => {
  const stops = [
    { x: 56, eventBoundary: 1 },
    { x: 206, eventBoundary: 2 },
    { x: 356, eventBoundary: 5 },
  ];
  const originX = 206;

  assert.equal(
    timelineFocusedEventBoundaryAtCanvasOrigin(stops, 0, 205.9, originX),
    1,
  );
  assert.equal(
    timelineFocusedEventBoundaryAtCanvasOrigin(stops, 0, 206, originX),
    2,
  );
  assert.equal(
    timelineFocusedEventBoundaryAtCanvasOrigin(stops, 150, 55.9, originX),
    1,
  );
  assert.equal(
    timelineFocusedEventBoundaryAtCanvasOrigin(stops, 150, 56, originX),
    2,
  );
  assert.equal(
    timelineFocusedEventBoundaryAtCanvasOrigin(
      stops,
      Number.NaN,
      356,
      356,
    ),
    5,
  );
});

test("Timeline leading travel lets the first event reach the entry rail", () => {
  const stops = [
    { x: 56, eventBoundary: 1 },
    { x: 206, eventBoundary: 2 },
  ];
  const viewportWidth = 640;
  const leadingInset = timelineLeadingScrollInset(viewportWidth, 56);

  assert.equal(leadingInset, 584);
  assert.equal(
    timelineFocusedEventBoundaryAtCanvasOrigin(
      stops,
      0,
      viewportWidth,
      56,
    ),
    1,
  );
  assert.equal(
    timelineFocusedEventBoundaryAtCanvasOrigin(
      stops,
      150,
      viewportWidth,
      56,
    ),
    2,
  );
  assert.equal(timelineLeadingScrollInset(40, 56), 0);
});

test("Timeline rail resizing cannot feed stale geometry across E11-E12", () => {
  const stops = [
    { x: 1406, eventBoundary: 10 },
    { x: 1556, eventBoundary: 11 },
    { x: 1706, eventBoundary: 12 },
  ];
  const originX = 56;
  const e11RailViewportWidth = 850;
  const e12RailViewportWidth = 730;
  const e11LeadingInset = timelineLeadingScrollInset(
    e11RailViewportWidth,
    originX,
  );
  const e12LeadingInset = timelineLeadingScrollInset(
    e12RailViewportWidth,
    originX,
  );
  const scrollLeftAtE12 = 1650;

  const preservedScrollLeft = timelineScrollLeftForLeadingInset(
    scrollLeftAtE12,
    e12LeadingInset,
    true,
  );
  assert.equal(preservedScrollLeft, scrollLeftAtE12);

  assert.equal(
    timelineFocusedEventBoundaryAtCanvasOrigin(
      stops,
      preservedScrollLeft,
      e11RailViewportWidth,
      originX,
    ),
    12,
  );
  assert.equal(
    timelineFocusedEventBoundary(
      stops,
      preservedScrollLeft + e12RailViewportWidth - e11LeadingInset,
    ),
    11,
  );
  assert.equal(
    timelineFocusedEventBoundaryAtCanvasOrigin(
      stops,
      preservedScrollLeft,
      e12RailViewportWidth,
      originX,
    ),
    12,
  );
  assert.equal(
    timelineFocusedEventBoundary(
      stops,
      preservedScrollLeft + e11RailViewportWidth - e12LeadingInset,
    ),
    12,
  );
});

test("Timeline lane reordering keeps the fast interruptible ease-out", () => {
  assert.equal(TIMELINE_REORDER_DURATION_MS, 160);
  assert.equal(timelineReorderProgress(-1), 0);
  assert.equal(timelineReorderProgress(0), 0);
  assert.equal(timelineReorderProgress(80), 0.875);
  assert.equal(timelineReorderProgress(160), 1);
  assert.equal(timelineReorderProgress(Number.POSITIVE_INFINITY), 1);
  assert.equal(timelineReorderValue(30, 78, 0), 30);
  assert.equal(timelineReorderValue(30, 78, 80), 72);
  assert.equal(timelineReorderValue(30, 78, 160), 78);
});

test("Timeline retirement reorders, pauses, then fades on an independent clock", () => {
  assert.equal(TIMELINE_RETIREMENT_MOVE_DURATION_MS, 280);
  assert.equal(TIMELINE_RETIREMENT_HOLD_DURATION_MS, 180);
  assert.equal(TIMELINE_RETIREMENT_FADE_DURATION_MS, 420);
  assert.equal(TIMELINE_RETIREMENT_TOTAL_DURATION_MS, 880);
  assert.equal(timelineRetirementMotionPhase(-1), "moving");
  assert.equal(timelineRetirementMotionPhase(0), "moving");
  assert.equal(timelineRetirementMotionPhase(279), "moving");
  assert.equal(timelineRetirementMotionPhase(280), "holding");
  assert.equal(timelineRetirementMotionPhase(459), "holding");
  assert.equal(timelineRetirementMotionPhase(460), "fading");
  assert.equal(timelineRetirementMotionPhase(879), "fading");
  assert.equal(timelineRetirementMotionPhase(880), "settled");
  assert.equal(
    timelineRetirementMotionPhase(Number.POSITIVE_INFINITY),
    "settled",
  );
  assert.equal(timelineRetirementMotionPhaseAt(1_000, 1_700), "fading");
  assert.equal(timelineRetirementMotionPhaseAt(1_600, 1_700), "moving");
  assert.equal(timelineRetirementMotionPhaseAt(1_000, 1_880), "settled");
});

test("Timeline merges adjacent events with the same continuation files", () => {
  const presentation = buildTimelinePresentation([
    {
      name: "open-shared-work",
      description: "Open the shared files.",
      predecessors: [],
      successors: ["a.md", "b.md"],
    },
    {
      name: "first-checkpoint",
      description: "Record the first checkpoint.",
      predecessors: ["a.md", "b.md"],
      successors: ["a.md", "b.md"],
    },
    {
      name: "second-checkpoint",
      description: "Record the second checkpoint.",
      predecessors: ["a.md", "b.md"],
      successors: ["a.md", "b.md"],
    },
    {
      name: "third-checkpoint",
      description: "Record the third checkpoint.",
      predecessors: ["a.md", "b.md"],
      successors: ["a.md", "b.md"],
    },
    {
      name: "branch-shared-work",
      description: "Open a new branch.",
      predecessors: ["a.md", "b.md"],
      successors: ["a.md", "b.md", "c.md"],
    },
  ]);

  assert.equal(presentation.events.length, 3);
  assert.equal(presentation.columnCount, 4);
  assert.deepEqual(
    presentation.events.map(timelineEventMarkerLabel),
    ["E1", "E2\u2013E4", "E5"],
  );
  assert.deepEqual(
    presentation.events[1].events.map((event) => [
      event.name,
      event.description,
    ]),
    [
      ["first-checkpoint", "Record the first checkpoint."],
      ["second-checkpoint", "Record the second checkpoint."],
      ["third-checkpoint", "Record the third checkpoint."],
    ],
  );
  assert.deepEqual(presentation.events[1].event.predecessors, ["a.md", "b.md"]);
  assert.deepEqual(presentation.events[1].event.successors, ["a.md", "b.md"]);
});

test("Timeline event logs cover both single and compacted nodes", () => {
  const presentation = buildTimelinePresentation([
    {
      name: "open-shared-work",
      description: "Open the shared files.",
      predecessors: [],
      successors: ["a.md", "b.md"],
    },
    {
      name: "first-checkpoint",
      description: "Record the first checkpoint.",
      predecessors: ["a.md", "b.md"],
      successors: ["a.md", "b.md"],
    },
    {
      name: "second-checkpoint",
      description: "Record the second checkpoint.",
      predecessors: ["a.md", "b.md"],
      successors: ["a.md", "b.md"],
    },
  ]);

  assert.deepEqual(
    timelineEventLogEntries(presentation.events[0]).map(
      ({ eventNumber, event }) => [
        eventNumber,
        event.name,
        event.description,
      ],
    ),
    [[1, "open-shared-work", "Open the shared files."]],
  );
  assert.deepEqual(
    timelineEventLogEntries(presentation.events[1]).map(
      ({ eventNumber, event }) => [
        eventNumber,
        event.name,
        event.description,
      ],
    ),
    [
      [2, "first-checkpoint", "Record the first checkpoint."],
      [3, "second-checkpoint", "Record the second checkpoint."],
    ],
  );
});

test("Timeline event grouping preserves aligned anchor boundaries", () => {
  const events = [
    {
      name: "open-shared-work",
      predecessors: [],
      successors: ["a.md", "b.md"],
    },
    ...["first", "second", "third"].map((name) => ({
      name,
      predecessors: ["a.md", "b.md"],
      successors: ["a.md", "b.md"],
    })),
  ];
  const presentation = buildTimelinePresentation(events, [], [3]);

  assert.deepEqual(
    presentation.events.map(timelineEventMarkerLabel),
    ["E1", "E2\u2013E3", "E4"],
  );
  assert.equal(presentation.events[1].endEventIndex + 1, 3);
  assert.equal(presentation.events[2].startEventIndex, 3);
});

test("Timeline fold endpoints form one inclusive range without crossing protected slices", () => {
  const later = { startEventIndex: 6, endEventIndex: 6 };
  const earlier = { startEventIndex: 2, endEventIndex: 2 };
  assert.deepEqual(
    timelineFoldRangeBetween(later, earlier, 9),
    {
      ok: true,
      range: { startEventIndex: 2, endEventIndex: 6 },
    },
  );
  assert.equal(
    timelineFoldRangeKey({ startEventIndex: 2, endEventIndex: 6 }),
    "2:6",
  );
  assert.deepEqual(
    timelineFoldRangeBetween(later, earlier, 9, [4]),
    { ok: false, reason: "crosses-anchor" },
  );
  assert.deepEqual(
    timelineFoldRangeBetween(later, earlier, 9, [], [
      { startEventIndex: 4, endEventIndex: 7 },
    ]),
    { ok: false, reason: "overlaps-fold" },
  );
  assert.deepEqual(
    timelineFoldRangeBetween(earlier, earlier, 9),
    { ok: false, reason: "requires-two-events" },
  );
  assert.deepEqual(
    timelineFoldRangeBetween(
      { startEventIndex: 2, endEventIndex: 4 },
      { startEventIndex: 2, endEventIndex: 4 },
      9,
    ),
    { ok: false, reason: "requires-two-events" },
  );
});

test("Timeline fold endpoints include whole existing folds in either selection order", () => {
  const left = { startEventIndex: 1, endEventIndex: 3 };
  const right = { startEventIndex: 5, endEventIndex: 7 };
  const inner = { startEventIndex: 2, endEventIndex: 3 };
  const ranges = [left, inner, right];
  for (const [first, second, expected] of [
    [left, right, { startEventIndex: 1, endEventIndex: 7 }],
    [left, { startEventIndex: 4, endEventIndex: 4 }, { startEventIndex: 1, endEventIndex: 4 }],
    [{ startEventIndex: 0, endEventIndex: 0 }, left, { startEventIndex: 0, endEventIndex: 3 }],
    [{ startEventIndex: 0, endEventIndex: 0 }, { startEventIndex: 8, endEventIndex: 8 }, { startEventIndex: 0, endEventIndex: 8 }],
  ]) {
    assert.deepEqual(timelineFoldRangeBetween(first, second, 9, [], ranges), {
      ok: true, range: expected,
    });
    assert.deepEqual(timelineFoldRangeBetween(second, first, 9, [], ranges), {
      ok: true, range: expected,
    });
  }
  assert.deepEqual(timelineFoldRangeBetween(left, left, 9, [], ranges), {
    ok: false, reason: "requires-two-events",
  });
  assert.deepEqual(timelineFoldRangeBetween(left, right, 9, [5], ranges), {
    ok: false, reason: "crosses-anchor",
  });
  assert.deepEqual(timelineFoldRangeBetween(left, right, 9, [1, 8], ranges), {
    ok: true, range: { startEventIndex: 1, endEventIndex: 7 },
  });
});

test("Nested Timeline folds project once and unfold one layer at a time", () => {
  const events = Array.from({ length: 10 }, (_, index) => ({
    name: `event-${index + 1}`,
    predecessors: index === 0 ? [] : [`file-${index}.md`],
    successors: [`file-${index + 1}.md`],
  }));
  const ranges = [[1, 8], [1, 6], [1, 3], [2, 3], [4, 6], [7, 8]].map(
    ([startEventIndex, endEventIndex]) => ({ startEventIndex, endEventIndex }),
  );
  const expectedLabels = [
    ["E1", "E2–E9", "E10"],
    ["E1", "E2–E7", "E8–E9", "E10"],
    ["E1", "E2–E4", "E5–E7", "E8–E9", "E10"],
    ["E1", "E2", "E3–E4", "E5–E7", "E8–E9", "E10"],
  ];
  for (let layer = 0; layer < expectedLabels.length; layer += 1) {
    const remaining = ranges.slice(layer);
    const topology = buildTimelinePresentationTopology(events, [], [], remaining);
    const presentation = buildTimelinePresentationFromTopology(topology, 3);
    assert.deepEqual(presentation.events.map(timelineEventMarkerLabel), expectedLabels[layer]);
    assert.deepEqual(presentation.events.flatMap((marker) => marker.events), events);
    assert.equal(presentation.focusedSlice.eventBoundary, [9, 7, 4, 4][layer]);
    assert.equal(presentation.events.filter((marker) => marker.foldRange).length,
      topology.visibleFoldRanges.length);
    assert.deepEqual(
      buildTimelinePresentation(events, [], [], 3, remaining.toReversed()),
      presentation,
      "shared-start folds must project the outermost interval regardless of storage order",
    );
    const restored = buildTimelinePresentation(events, [], [], undefined, []);
    assert.deepEqual(restored.events.flatMap((marker) => marker.events), events);
  }
  const folded = buildTimelinePresentation(events, [], [], undefined, ranges);
  assert.deepEqual(folded.events[1].event.predecessors, ["file-1.md"]);
  assert.deepEqual(folded.events[1].event.successors, ["file-9.md"]);
  assert.deepEqual(timelineEventLogEntries(folded.events[1]).map(({ eventNumber }) => eventNumber),
    [2, 3, 4, 5, 6, 7, 8, 9]);
});

test("Timeline folds project an event interval before lane and SVG geometry", () => {
  const events = [
    {
      name: "establish-root",
      predecessors: [],
      successors: ["root.md"],
    },
    {
      name: "branch-work",
      predecessors: ["root.md"],
      successors: ["root.md", "branch.md"],
    },
    {
      name: "open-temporary-work",
      predecessors: ["branch.md"],
      successors: ["branch.md", "temporary.md"],
    },
    {
      name: "merge-work",
      predecessors: ["branch.md", "temporary.md"],
      successors: ["joined.md"],
    },
    {
      name: "continue-joined-work",
      predecessors: ["joined.md"],
      successors: ["joined.md"],
    },
  ];
  const full = buildTimelinePresentation(events);
  const folded = buildTimelinePresentation(
    events,
    [],
    [],
    2,
    [{ startEventIndex: 1, endEventIndex: 3 }],
  );

  assert.deepEqual(
    folded.events.map(timelineEventMarkerLabel),
    ["E1", "E2\u2013E4", "E5"],
  );
  assert.deepEqual(folded.events[1].foldRange, {
    startEventIndex: 1,
    endEventIndex: 3,
  });
  assert.deepEqual(
    folded.events[1].events.map((event) => event.name),
    ["branch-work", "open-temporary-work", "merge-work"],
  );
  assert.deepEqual(folded.events[1].event.predecessors, ["root.md"]);
  assert.deepEqual(folded.events[1].event.successors, ["root.md", "joined.md"]);
  assert.deepEqual(folded.paths, ["root.md", "joined.md"]);
  assert.equal(folded.paths.includes("branch.md"), false);
  assert.equal(folded.paths.includes("temporary.md"), false);
  assert.ok(folded.spans.length < full.spans.length);
  assert.ok(folded.connectors.length < full.connectors.length);
  assert.equal(folded.focusedSlice.eventBoundary, 4);
  assert.deepEqual(timelineRetirementsCrossed(folded, 1, 4), []);

  const resolver = createTimelineSelectionResolver(folded);
  const foldedTrace = resolver.resolve({
    kind: "event",
    eventId: folded.events[1].id,
  });
  assert.deepEqual([...foldedTrace.eventIds], [folded.events[1].id]);
  assert.equal(foldedTrace.paths.size, 0);
  assert.equal(foldedTrace.spanIds.size, 0);
  assert.equal(foldedTrace.connectorIds.size, 0);

  const joinedSpan = folded.spans.find(
    (span) => span.path === "joined.md" && span.startColumn === 1,
  );
  assert.ok(joinedSpan);
  const joinedTrace = resolver.resolve({
    kind: "intent",
    path: joinedSpan.path,
    spanId: joinedSpan.id,
  });
  assert.equal(joinedTrace.eventIds.has(folded.events[1].id), true);
  assert.equal(joinedTrace.eventIds.has(folded.events[0].id), false);
  assert.deepEqual(joinedTrace.pastPaths, []);
});

test("Timeline intent paths open Readers only from managed file-entry boxes", () => {
  assert.equal(timelineIntentOpensReader("timeline", true), false);
  assert.equal(timelineIntentOpensReader("timeline", false), false);
  assert.equal(timelineIntentOpensReader("file-entry", true), true);
  assert.equal(timelineIntentOpensReader("file-entry", false), false);
});

test("Timeline keeps unaffected intent lifelines continuous", () => {
  const presentation = buildTimelinePresentation([
    {
      name: "open-parallel-intents",
      predecessors: [],
      successors: ["a.md", "b.md"],
    },
    {
      name: "branch-a",
      predecessors: ["a.md"],
      successors: ["a.md", "a-child.md"],
    },
    {
      name: "branch-a-child",
      predecessors: ["a-child.md"],
      successors: ["a-child.md", "a-grandchild.md"],
    },
  ]);

  assert.deepEqual(
    presentation.spans
      .filter((span) => span.path === "b.md")
      .map((span) => [span.startColumn, span.endColumn]),
    [[0, 3]],
  );
  assert.deepEqual(
    presentation.spans
      .filter((span) => span.path === "a.md")
      .map((span) => [span.startColumn, span.endColumn]),
    [
      [0, 1],
      [1, 3],
    ],
  );
});

test("Timeline lifeline selection traces past sources and future influence", () => {
  const presentation = buildTimelinePresentation([
    {
      name: "establish-root",
      predecessors: [],
      successors: ["root.md"],
    },
    {
      name: "branch-root",
      predecessors: ["root.md"],
      successors: ["root.md", "a.md", "b.md"],
    },
    {
      name: "branch-a",
      predecessors: ["a.md"],
      successors: ["a.md", "a-child.md"],
    },
    {
      name: "merge-influence",
      predecessors: ["b.md", "a-child.md"],
      successors: ["joined.md"],
    },
    {
      name: "continue-root",
      predecessors: ["root.md"],
      successors: ["root.md"],
    },
  ]);
  const selectedSpan = presentation.spans.find(
    (span) => span.path === "a.md" && span.startColumn === 1,
  );
  const target = {
    kind: "intent",
    path: selectedSpan.path,
    spanId: selectedSpan.id,
  };
  const resolver = createTimelineSelectionResolver(presentation);
  const trace = resolver.resolve(target);
  const hoverTrace = resolver.resolveHover(target);

  assert.strictEqual(resolver.resolve({ ...target }), trace);
  assert.strictEqual(resolver.resolveHover({ ...target }), hoverTrace);
  assert.deepEqual(buildTimelineSelectionTrace(presentation, target), trace);
  assert.deepEqual([...hoverTrace.spanIds], [selectedSpan.id]);
  const attachedConnectors = presentation.connectors.filter(
    (connector) => connector.spanId === selectedSpan.id,
  );
  assert.deepEqual(
    [...hoverTrace.connectorIds].sort(),
    attachedConnectors.map((connector) => connector.id).sort(),
  );
  assert.deepEqual(
    [...hoverTrace.eventIds].sort(),
    attachedConnectors.map((connector) => connector.eventId).sort(),
  );

  const selectedTraceSnapshot = {
    spanIds: [...trace.spanIds],
    connectorIds: [...trace.connectorIds],
    eventIds: [...trace.eventIds],
    paths: [...trace.paths],
  };
  const unrelatedSpan = presentation.spans.find(
    (span) => span.path === "b.md",
  );
  const unrelatedHoverTrace = resolver.resolveHover({
    kind: "intent",
    path: unrelatedSpan.path,
    spanId: unrelatedSpan.id,
  });
  assert.strictEqual(resolver.resolve(target), trace);
  assert.deepEqual(
    {
      spanIds: [...trace.spanIds],
      connectorIds: [...trace.connectorIds],
      eventIds: [...trace.eventIds],
      paths: [...trace.paths],
    },
    selectedTraceSnapshot,
  );
  assert.deepEqual([...unrelatedHoverTrace.spanIds], [unrelatedSpan.id]);
  assert.equal(unrelatedHoverTrace.spanIds.has(selectedSpan.id), false);

  assert.deepEqual(
    [...trace.paths].sort(),
    ["root.md", "a.md", "a-child.md", "joined.md"].sort(),
  );
  assert.deepEqual(trace.pastPaths, ["root.md"]);
  assert.deepEqual(trace.futurePaths, ["a-child.md", "joined.md"]);
  assert.deepEqual(
    [...trace.eventIds],
    presentation.events.slice(0, 4).map((event) => event.id),
  );
  assert.equal(
    trace.connectorIds.has(
      presentation.connectors.find(
        (connector) =>
          connector.eventId === presentation.events[1].id &&
          connector.side === "successor" &&
          connector.path === "b.md",
      ).id,
    ),
    false,
  );
  assert.equal(
    trace.connectorIds.has(
      presentation.connectors.find(
        (connector) =>
          connector.eventId === presentation.events[3].id &&
          connector.side === "predecessor" &&
          connector.path === "b.md",
      ).id,
    ),
    false,
  );
  assert.equal(
    trace.eventIds.has(presentation.events[4].id),
    false,
  );
});

test("Timeline event selection carries only its direct lanes through past and future", () => {
  const presentation = buildTimelinePresentation([
    {
      name: "establish-root",
      predecessors: [],
      successors: ["root.md"],
    },
    {
      name: "branch-root",
      predecessors: ["root.md"],
      successors: ["root.md", "a.md", "b.md"],
    },
    {
      name: "branch-a",
      predecessors: ["a.md"],
      successors: ["a.md", "a-child.md"],
    },
    {
      name: "merge-influence",
      predecessors: ["b.md", "a-child.md"],
      successors: ["joined.md"],
    },
  ]);
  const selectedEvent = presentation.events[3];
  const target = {
    kind: "event",
    eventId: selectedEvent.id,
  };
  const resolver = createTimelineSelectionResolver(presentation);
  const trace = resolver.resolve(target);
  const hoverTrace = resolver.resolveHover(target);

  assert.strictEqual(resolver.resolve({ ...target }), trace);
  assert.strictEqual(resolver.resolveHover({ ...target }), hoverTrace);
  assert.deepEqual(buildTimelineSelectionTrace(presentation, target), trace);
  assert.deepEqual([...hoverTrace.eventIds], [selectedEvent.id]);
  assert.equal(hoverTrace.spanIds.size, 0);
  assert.equal(hoverTrace.connectorIds.size, 0);

  assert.deepEqual(
    [...trace.paths].sort(),
    ["b.md", "a-child.md", "joined.md"].sort(),
  );
  assert.deepEqual([...trace.eventIds], [selectedEvent.id]);
  assert.deepEqual(trace.pastPaths, ["b.md", "a-child.md"]);
  assert.deepEqual(trace.futurePaths, ["joined.md"]);
  assert.ok(
    presentation.spans
      .filter((span) => trace.paths.has(span.path))
      .every((span) => trace.spanIds.has(span.id)),
  );
  assert.ok(
    presentation.connectors
      .filter((connector) => trace.paths.has(connector.path))
      .every((connector) =>
        timelineIntentConnectorIsActive(connector, trace.connectorIds),
      ),
  );
  assert.equal(trace.paths.has("a.md"), false);
  assert.equal(trace.paths.has("root.md"), false);
});

test("Timeline lane ordering removes avoidable branch overlap", () => {
  const events = [
    {
      name: "open-parallel-intents",
      predecessors: [],
      successors: ["root.md", "a.md", "b.md"],
    },
    {
      name: "branch-a",
      predecessors: ["a.md"],
      successors: ["a.md", "a-child.md"],
    },
    {
      name: "branch-b",
      predecessors: ["b.md"],
      successors: ["b.md", "b-child.md"],
    },
  ];
  const discoveryOrder = [
    "root.md",
    "a.md",
    "b.md",
    "a-child.md",
    "b-child.md",
  ];
  const presentation = buildTimelinePresentation(events);

  assert.ok(countTimelineBranchOverlaps(events, discoveryOrder) > 0);
  assert.equal(countTimelineBranchOverlaps(events, presentation.paths), 0);
  assert.deepEqual(presentation.paths, [
    "root.md",
    "a.md",
    "a-child.md",
    "b.md",
    "b-child.md",
  ]);
  assert.deepEqual(
    presentation.events.map((marker) => marker.event.successors),
    events.map((event) => event.successors),
  );
});

test("Timeline lanes reuse space after earlier intents have ended", () => {
  const events = [
    {
      name: "open-current-and-former-intents",
      predecessors: [],
      successors: ["root.md", "peer.md", "former.md"],
    },
    {
      name: "retire-former-intent",
      predecessors: ["former.md"],
      successors: [],
    },
    {
      name: "open-first-short-branch",
      predecessors: ["root.md"],
      successors: ["root.md", "first-branch.md"],
    },
    {
      name: "merge-first-short-branch",
      predecessors: ["first-branch.md"],
      successors: [],
    },
    {
      name: "open-second-short-branch",
      predecessors: ["root.md"],
      successors: ["root.md", "second-branch.md"],
    },
    {
      name: "merge-second-short-branch",
      predecessors: ["second-branch.md"],
      successors: [],
    },
  ];
  const presentation = buildTimelinePresentation(events, [], [], events.length);
  const laneFor = (path) => {
    const span = presentation.spans.find((candidate) => candidate.path === path);
    assert.ok(span, `missing span for ${path}`);
    return span.lane;
  };

  assert.equal(presentation.laneCount, 3);
  assert.equal(laneFor("former.md"), 2);
  assert.equal(laneFor("first-branch.md"), 2);
  assert.equal(laneFor("second-branch.md"), 2);
  const focusedSpans = timelineFocusedIntentSpans(presentation);
  assert.deepEqual(
    focusedSpans.map((span) => span.lane),
    [0, 1],
  );
  assert.deepEqual(
    new Set(focusedSpans.map((span) => span.path)),
    new Set(["root.md", "peer.md"]),
  );

  for (let column = 0; column < presentation.columnCount; column += 1) {
    const activeSpans = presentation.spans.filter(
      (span) => span.startColumn <= column && span.endColumn > column,
    );
    assert.equal(
      new Set(activeSpans.map((span) => span.lane)).size,
      activeSpans.length,
      `column ${column} assigned one lane to overlapping lifelines`,
    );
  }
});

test("Timeline focus projection reuses one stable dense topology", () => {
  const paths = Array.from(
    { length: 33 },
    (_, index) => `opening/intent-${String(index + 1).padStart(2, "0")}.md`,
  );
  const events = [
    {
      name: "open-dense-opening",
      predecessors: [],
      successors: paths,
    },
    ...Array.from({ length: 109 }, (_, index) => {
      const first = paths[index % paths.length];
      const second = paths[(index * 7 + 5) % paths.length];
      const participants = first === second ? [first] : [first, second];
      return {
        name: `continue-dense-opening-${index + 1}`,
        predecessors: participants,
        successors: participants,
      };
    }),
  ];
  const topology = buildTimelinePresentationTopology(events);
  const topologyBeforeFocus = structuredClone(topology);

  assert.deepEqual(
    buildTimelinePresentationFromTopology(topology, 37),
    buildTimelinePresentation(events, [], [], 37),
  );
  assert.deepEqual(topology, topologyBeforeFocus);
  assert.deepEqual(
    topology.focusBoundaryStops.map((stop) => stop.eventBoundary),
    events.map((_, index) => index + 1),
  );

  const startedAt = performance.now();
  for (let boundary = 0; boundary <= events.length; boundary += 10) {
    buildTimelinePresentationFromTopology(topology, boundary);
  }
  const elapsed = performance.now() - startedAt;
  assert.ok(
    elapsed < 1_000,
    `focus-only projection took ${elapsed.toFixed(1)}ms and likely repeated stable topology work`,
  );
});

test("Anchor historical connections bundle timeline lanes in declared order", () => {
  assert.deepEqual(
    bundleTimelinePaths(
      ["root.md", "a.md", "a-child.md", "b.md", "b-child.md"],
      ["b-child.md", "a.md", "missing.md", "a.md"],
    ),
    ["root.md", "b-child.md", "a.md", "a-child.md", "b.md"],
  );

  const presentation = buildTimelinePresentation(
    [
      {
        name: "open",
        predecessors: [],
        successors: ["root.md", "a.md", "b.md"],
      },
      {
        name: "branch",
        predecessors: ["a.md"],
        successors: ["a.md", "a-child.md"],
      },
    ],
    ["b.md", "a-child.md"],
  );
  const firstBundledLane = presentation.paths.indexOf("b.md");
  assert.deepEqual(
    presentation.paths.slice(firstBundledLane, firstBundledLane + 2),
    ["b.md", "a-child.md"],
  );
});

test("Timeline default density fits about thirty intent lanes", () => {
  assert.equal(timelineCanvasHeight(1), 340);
  assert.ok(timelineCanvasHeight(30) <= 520);
  assert.ok(timelineCanvasHeight(31) > timelineCanvasHeight(30));
});

test("Timeline lifeline hit regions meet at neighboring lane midpoints", () => {
  const first = timelineLaneHitRegion(0);
  const second = timelineLaneHitRegion(1);
  const third = timelineLaneHitRegion(2);

  assert.deepEqual(first, {
    y: TIMELINE_TOP_PADDING - TIMELINE_LANE_GAP / 2,
    height: TIMELINE_LANE_GAP,
  });
  assert.equal(first.y + first.height, second.y);
  assert.equal(second.y + second.height, third.y);
});

test("Timeline event columns keep a compact usable horizontal rhythm", () => {
  assert.ok(timelineCanvasWidth(7, 320) <= 1320);
  assert.ok(TIMELINE_COLUMN_WIDTH - TIMELINE_JUNCTION_GAP * 2 >= 90);
  assert.ok(TIMELINE_JUNCTION_GAP >= 24);
});

test("Timeline file-entry rail resize is bounded and keeps canvas room", () => {
  assert.equal(TIMELINE_ENTRY_RAIL_DEFAULT_WIDTH, 188);
  assert.equal(
    resizeTimelineEntryRail(TIMELINE_ENTRY_RAIL_DEFAULT_WIDTH, -48, 1200),
    236,
  );
  assert.equal(
    resizeTimelineEntryRail(TIMELINE_ENTRY_RAIL_DEFAULT_WIDTH, 80, 1200),
    132,
  );
  assert.equal(
    resizeTimelineEntryRail(TIMELINE_ENTRY_RAIL_DEFAULT_WIDTH, -800, 1200),
    520,
  );
  assert.equal(
    resizeTimelineEntryRail(TIMELINE_ENTRY_RAIL_DEFAULT_WIDTH, -800, 360),
    132,
  );
  assert.equal(resizeTimelineEntryRail(640, 20, 1200), 620);
});

test("Timeline information separator resizes its adjacent panels and stays bounded", () => {
  const initial = {
    ordinaryHeight: 420,
    inspectorHeight: 150,
  };

  assert.deepEqual(
    resizeTimelinePanels(initial, "timeline-information", 30),
    {
      ordinaryHeight: 390,
      inspectorHeight: 180,
    },
  );
  assert.deepEqual(
    resizeTimelinePanels(initial, "timeline-information", -20),
    {
      ordinaryHeight: 440,
      inspectorHeight: 130,
    },
  );

  const lowerBounded = resizeTimelinePanels(
    initial,
    "timeline-information",
    1_000,
  );
  assert.equal(
    lowerBounded.ordinaryHeight,
    MINIMUM_TIMELINE_ORDINARY_HEIGHT,
  );

  const upperBounded = resizeTimelinePanels(
    initial,
    "timeline-information",
    -1_000,
  );
  assert.equal(
    upperBounded.inspectorHeight,
    MINIMUM_TIMELINE_INSPECTOR_HEIGHT,
  );
});

test("Timeline anchor centering stays centered when possible and clamps at both ends", () => {
  assert.equal(centeredTimelineScrollLeft(1_000, 600, 2_000), 700);
  assert.equal(centeredTimelineScrollLeft(120, 600, 2_000), 0);
  assert.equal(centeredTimelineScrollLeft(1_900, 600, 2_000), 1_400);
  assert.equal(centeredTimelineScrollLeft(400, 900, 800), 0);
});

test("Timeline anchors without Event alignment pin to their exact Git commit", () => {
  const commits = [{ commit: "older" }, { commit: "anchor" }, { commit: "current" }];
  const positions = timelineCommitTickPositions([null, null, 2], [20, 100, 200], 20, 220);
  assert.deepEqual(
    timelineAnchorPosition(undefined, "anchor", commits, positions),
    { x: positions[1].x, kind: "commit" },
  );
  assert.deepEqual(
    timelineAnchorPosition(100, "anchor", commits, positions),
    { x: 100, kind: "event-boundary" },
  );
  assert.deepEqual(
    timelineAnchorPosition(0, "not-on-first-parent", commits, positions),
    { x: 0, kind: "event-boundary" },
  );
  assert.equal(timelineAnchorPosition(undefined, "absent", commits, positions), undefined);
  assert.equal(timelineAnchorPosition(undefined, "anc", commits, positions), undefined);
  assert.equal(timelineAnchorPosition(undefined, "anchor", commits, []), undefined);
});

test("Timeline commit ticks align to event anchors while preserving Git order", () => {
  assert.deepEqual(timelineCommitTickPositions([], [], 24, 480), []);
  assert.deepEqual(timelineCommitTickPositions([1], [24, 180], 24, 480), [
    { x: 180 },
  ]);
  assert.deepEqual(
    timelineCommitTickPositions(
      [0, 0, 1, 1, 1, 2],
      [30, 60, 120],
      30,
      150,
    ),
    [
      { x: 30 },
      { x: 45 },
      { x: 60 },
      { x: 80 },
      { x: 100 },
      { x: 120 },
    ],
  );
  assert.deepEqual(timelineCommitTickPositions([0, 1, 1, 1], [30, 60], 30, 120), [
    { x: 30 },
    { x: 60 },
    { x: 90 },
    { x: 120 },
  ]);
});

test("Timeline panel dragging stays in local layout coordinates under interface zoom", () => {
  const measuredFallback = timelinePanelClientToLocalScale(556, 667.2);
  assert.ok(Math.abs(measuredFallback - 1 / 1.2) < 0.001);
  const clientToLocalY = timelinePanelClientToLocalScale(556, 667.2, 1.2);
  assert.equal(clientToLocalY, 1 / 1.2);
  assert.equal(
    timelinePanelDragMovement(400, 400, clientToLocalY, false),
    undefined,
  );
  assert.equal(
    timelinePanelDragMovement(
      400,
      400 + TIMELINE_PANEL_DRAG_THRESHOLD - 0.1,
      clientToLocalY,
      false,
    ),
    undefined,
  );

  const localMovement = timelinePanelDragMovement(
    400,
    424,
    clientToLocalY,
    false,
  );
  assert.ok(localMovement !== undefined);
  assert.ok(Math.abs(localMovement - 20) < 0.02);
  assert.equal(
    timelinePanelDragMovement(400, 400, clientToLocalY, true),
    0,
  );

  const localSizes = {
    ordinaryHeight: timelinePanelLocalLength(347.04, clientToLocalY),
    inspectorHeight: timelinePanelLocalLength(115.2, clientToLocalY),
  };
  const resized = resizeTimelinePanels(
    localSizes,
    "timeline-information",
    localMovement,
  );
  assert.ok(Math.abs(resized.ordinaryHeight - 269.2) < 0.05);
  assert.ok(Math.abs(resized.inspectorHeight - 116) < 0.05);
});

test("Timeline presentation stays empty without events", () => {
  assert.deepEqual(buildTimelinePresentation([]), {
    events: [],
    spans: [],
    connectors: [],
    paths: [],
    columnCount: 1,
    laneCount: 0,
  });
});

function filesystemGraph(documents, relationships) {
  const paths = [...new Set([...documents.map(d=>d.path),...relationships.flatMap(r=>[r.source,typeof r.target==="string"?r.target:r.target.path])])];
  const ids=new Map(paths.map((path,index)=>[path,`entry_${index}`]));
  return {format:"2026-10-20", documents:documents.map(d=>({...d,component:ids.get(d.path)})), structure:{nodes:paths.map(path=>({path,name:path.split("/").at(-1),kind:path.endsWith(".md")?"document":"target",component:{id:ids.get(path),index:false}})),relationships:relationships.map(r=>({...r,source:ids.get(r.source),target:ids.get(typeof r.target==="string"?r.target:r.target.path)}))},relationship_types:{},anchor_connection_types:{},historical_components:{},events:[],anchors:{}};
}
