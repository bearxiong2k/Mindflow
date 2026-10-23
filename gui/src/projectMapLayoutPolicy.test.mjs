import assert from "node:assert/strict";
import test from "node:test";

import { buildProjectMapMermaidGraph } from "./projectMapMermaid.ts";
import {
  decideProjectMapLayout,
  foldProjectMapChain,
  packProjectMapDisconnectedComponents,
  projectMapDirectedChain,
  projectMapWeakComponentGroups,
} from "./projectMapLayoutPolicy.ts";
import { deriveProjectMapFocusProjection } from "./projectMapNavigation.ts";
import { layoutProjectMapCompound } from "./projectMapCompoundLayout.ts";

function component(id, kind, parent, order) {
  return {
    id,
    label: id.replaceAll("_", " "),
    kind,
    parent,
    binding:
      kind === "document"
        ? { kind: "path", value: `${id}.md` }
        : undefined,
    managed: true,
    order,
  };
}

const compoundComponents = [
  component("root", "directory", undefined, 0),
  component("role", "directory", "root", 1),
  component("aggregate", "directory", "role", 2),
  ...Array.from({ length: 5 }, (_, index) =>
    component(`document_${index + 1}`, "document", "aggregate", index + 3),
  ),
];

const compoundMap = {
  direction: "td",
  root: "root",
  components: compoundComponents,
  relationships: [],
};

test("the unified policy uses Dagre for a shallow role overview", () => {
  const projection = deriveProjectMapFocusProjection(
    compoundMap,
    "root",
    new Set(),
    true,
  );

  assert.deepEqual(decideProjectMapLayout(projection), {
    engine: "dagre",
    reason: "root-overview",
    pressure: {
      nodeCount: 1,
      connectionCount: 0,
      edgeDensity: 0,
      maximumBreadth: 1,
      expandedLayerCount: 0,
      cyclic: false,
    },
  });
});

const chainIds = Array.from({ length: 10 }, (_, index) => `evidence-${index}`);
const chainConnections = chainIds.slice(1).map((target, index) => ({
  source: chainIds[index], target, direction: "source-to-target",
}));

test("chain folding follows authored arrows independently of declaration order", () => {
  assert.deepEqual(projectMapDirectedChain([...chainIds].reverse(), [
    ...chainConnections.slice().reverse(),
    { source: "unrelated", target: "peer", direction: "source-to-target" },
  ]), chainIds);
  for (const extra of [
    { source: chainIds[0], target: chainIds[2], direction: "source-to-target" },
    { source: chainIds.at(-1), target: chainIds[0], direction: "source-to-target" },
    { source: chainIds[0], target: "outside", direction: "source-to-target" },
    chainConnections[0],
  ]) {
    assert.equal(projectMapDirectedChain(chainIds, [...chainConnections, extra]), undefined);
  }
  assert.equal(projectMapDirectedChain(chainIds, chainConnections.map((edge, i) =>
    i === 4 ? { ...edge, direction: "bidirectional" } : edge,
  )), undefined);
  assert.equal(projectMapDirectedChain(chainIds, chainConnections.slice(1)), undefined);
  assert.equal(projectMapDirectedChain(chainIds.slice(0, 4), chainConnections.slice(0, 3)), undefined);
});

test("long evidence chains fit multiple rows without node or label collisions", () => {
  for (const count of [5, 7, 10, 18, 30]) {
    for (const scale of [0.8, 1, 1.8]) {
      const nodes = Array.from({ length: count }, (_, index) => ({
        id: `case-${index}`, width: (180 + index % 3 * 24) * scale,
        height: (52 + index % 2 * 20) * scale,
      }));
      const labels = nodes.slice(1).map((_, index) => ({
        width: (index % 3 === 0 ? 180 : 110) * scale,
        height: (index % 3 === 0 ? 44 : 22) * scale,
      }));
      const layout = foldProjectMapChain(nodes, labels);
      assert.ok(layout.rowCount > 1);
      assert.ok(layout.columnCount > 1);
      assert.ok(layout.height < count * (72 + 96) * scale * 0.75);
      assert.deepEqual(layout.placements.map(({ id }) => id), nodes.map(({ id }) => id));
      assert.deepEqual(layout.routes.map(({ source, target }) => [source, target]),
        nodes.slice(1).map((node, index) => [nodes[index].id, node.id]));
      const rectangles = [...layout.placements, ...layout.routes.map(({ label }) => label)];
      for (const [index, rectangle] of rectangles.entries()) {
        assert.ok(rectangle.x >= 0 && rectangle.y >= 0);
        assert.ok(rectangle.x + rectangle.width <= layout.width + 0.001);
        assert.ok(rectangle.y + rectangle.height <= layout.height + 0.001);
        for (const other of rectangles.slice(index + 1)) {
          assert.ok(rectangle.x + rectangle.width <= other.x ||
            other.x + other.width <= rectangle.x ||
            rectangle.y + rectangle.height <= other.y ||
            other.y + other.height <= rectangle.y, "folded node or label overlaps");
        }
      }
      assert.deepEqual(foldProjectMapChain(nodes, labels), layout);
      const reverse = foldProjectMapChain(nodes, labels, true);
      layout.placements.forEach((node, index) => {
        assert.equal(reverse.placements[index].x, node.x);
        assert.equal(reverse.placements[index].y, layout.height - node.y - node.height);
      });
      assert.deepEqual(reverse.routes.map(({ source, target }) => [source, target]),
        layout.routes.map(({ source, target }) => [source, target]));
    }
  }
});

test("folded routes keep tall relationship labels within their measured bounds", () => {
  const nodes = chainIds.map((id) => ({ id, width: 200, height: 40 }));
  const labels = chainConnections.map(() => ({ width: 170, height: 120 }));
  const layout = foldProjectMapChain(nodes, labels);
  assert.ok(layout);
  for (const { label } of layout.routes) {
    assert.ok(label.y >= 0 && label.y + label.height <= layout.height);
    for (const node of layout.placements) {
      assert.ok(label.x + label.width <= node.x || node.x + node.width <= label.x ||
        label.y + label.height <= node.y || node.y + node.height <= label.y);
    }
  }
  assert.equal(foldProjectMapChain(nodes, labels.slice(1)), undefined);
  assert.equal(foldProjectMapChain(nodes, labels.map(() => ({ width: NaN, height: 20 }))), undefined);
});

test("nested sparse hierarchy uses only Dagre-native semantic containment", () => {
  const projection = deriveProjectMapFocusProjection(
    compoundMap,
    "role",
    new Set(),
    true,
    undefined,
    2,
  );
  const decision = decideProjectMapLayout(projection);
  const graph = buildProjectMapMermaidGraph(projection);

  assert.equal(decision.engine, "dagre");
  assert.equal(decision.reason, "nested");
  assert.equal(decision.pressure.expandedLayerCount, 1);
  assert.equal(graph.layout.engine, "dagre");
  assert.doesNotMatch(graph.source, /"layout": "elk"/);
  assert.match(graph.source, /"curve": "basis"/);
  assert.match(graph.source, /subgraph pm\d+\["aggregate"\]/);
  assert.doesNotMatch(graph.source, /pm_layout_/);
  assert.doesNotMatch(graph.source, / ~~~ /);
  for (const component of compoundComponents.slice(3)) {
    assert.match(graph.source, new RegExp(`label: "${component.label}"`));
  }
  assert.equal(graph.connections.length, 0);
  const aggregateKey = graph.keyByComponentId.get("aggregate");
  assert.equal(graph.parentLayerByKey.get(aggregateKey), undefined);
  for (const component of compoundComponents.slice(3)) {
    assert.equal(graph.parentLayerByKey.get(graph.keyByComponentId.get(component.id)), aggregateKey);
  }
});

function assertCompoundGeometry(nodes, edges, result) {
  const placements = new Map(result.placements.map((node) => [node.id, node]));
  assert.equal(placements.size, nodes.length);
  assert.deepEqual(new Set(result.routes.map(({ id }) => id)), new Set(edges.map(({ id }) => id)));
  for (const node of nodes) {
    const placed = placements.get(node.id);
    const container = placements.get(node.parent) ?? { x: 0, y: 0, width: result.width, height: result.height };
    assert.ok(placed.x >= container.x - 0.01 && placed.y >= container.y - 0.01);
    assert.ok(placed.x + placed.width <= container.x + container.width + 0.01);
    assert.ok(placed.y + placed.height <= container.y + container.height + 0.01);
    for (const sibling of nodes.filter((other) => other.parent === node.parent && other.id !== node.id)) {
      const other = placements.get(sibling.id);
      assert.ok(placed.x + placed.width <= other.x + 0.01 || other.x + other.width <= placed.x + 0.01 ||
        placed.y + placed.height <= other.y + 0.01 || other.y + other.height <= placed.y + 0.01,
      `${node.id} overlaps ${sibling.id}`);
    }
  }
  for (const route of result.routes) {
    assert.doesNotMatch(route.path, /NaN|Infinity/);
    const { label } = route;
    assert.ok(label.x >= -0.01 && label.y >= -0.01);
    assert.ok(label.x + label.width <= result.width + 0.01);
    assert.ok(label.y + label.height <= result.height + 0.01);
  }
}

test("nested layout packs disconnected contents before measuring their parent, at every depth", () => {
  const nodes = [
    { id: "outer", width: 9000, height: 180, title: { width: 170, height: 20 } },
    { id: "inner", parent: "outer", width: 8500, height: 100, title: { width: 220, height: 40 } },
    ...Array.from({ length: 18 }, (_, index) => ({
      id: `item-${index}`, parent: "inner", width: 200 + index % 3 * 20, height: 60,
    })),
  ];
  const layout = layoutProjectMapCompound(nodes, []);
  assertCompoundGeometry(nodes, [], layout);
  assert.ok(layout.width < 1600, "an expanded parent must discard the original unbounded width");
  assert.ok(layout.height > 300 && layout.height < 1000);
  assert.equal(layout.packedScopes, 1);
  assert.ok(new Set(layout.placements.filter(({ id }) => id.startsWith("item-")).map(({ y }) => y)).size > 1);
  assert.deepEqual(layoutProjectMapCompound(nodes, []), layout);
});

test("chains of expanded categories fold while keeping nested chains and every route inside its owner", () => {
  const nodes = [{ id: "outer", width: 1, height: 1, title: { width: 200, height: 20 } }];
  const edges = [];
  for (let category = 0; category < 7; category++) {
    const id = `category-${category}`;
    nodes.push({ id, parent: "outer", width: 1, height: 1, title: { width: 240, height: 40 } });
    if (category > 0) edges.push({ id: `outer-${category}`, source: `category-${category - 1}`, target: id,
      direction: "source-to-target", width: 130, height: 30 });
    for (let item = 0; item < 7; item++) {
      const child = `${id}-${item}`;
      nodes.push({ id: child, parent: id, width: 180, height: 60 });
      if (item > 0) edges.push({ id: child, source: `${id}-${item - 1}`, target: child,
        direction: "source-to-target", width: 100, height: 20 });
    }
  }
  for (const direction of ["TB", "BT"]) {
    const layout = layoutProjectMapCompound(nodes, edges, direction);
    assertCompoundGeometry(nodes, edges, layout);
    assert.equal(layout.foldedChains, 8);
    assert.ok(layout.width / layout.height < 3);
  }
});

test("nested branching, cycles, parallel edges and contextual occurrences keep exact endpoints", () => {
  const nodes = [
    { id: "one", width: 1, height: 1, title: { width: 100, height: 20 } },
    { id: "two", width: 1, height: 1, title: { width: 100, height: 20 } },
    ...["a", "b", "c", "context-1"].map((id) => ({ id, parent: "one", width: 180, height: 60 })),
    { id: "context-2", parent: "two", width: 180, height: 60 },
  ];
  const edges = [["a", "b"], ["a", "b"], ["a", "c"], ["c", "a"], ["c", "context-1"], ["one", "two"]]
    .map(([source, target], index) => ({ id: `edge-${index}`, source, target,
      direction: index === 4 ? "bidirectional" : "source-to-target", width: 120, height: 40 }));
  for (const direction of ["TB", "BT", "LR", "RL"]) {
    const layout = layoutProjectMapCompound(nodes, edges, direction);
    assertCompoundGeometry(nodes, edges, layout);
    assert.equal(layout.foldedChains, 0);
    assert.notEqual(layout.routes[0].path, layout.routes[1].path, "parallel routes remain distinct");
  }
});

test("nested semantic containment follows a reversed Dagre flow", () => {
  const projection = deriveProjectMapFocusProjection(
    compoundMap,
    "role",
    new Set(),
    true,
    undefined,
    2,
  );
  const graph = buildProjectMapMermaidGraph(projection, "bt");

  assert.match(graph.source, /flowchart BT/);
  assert.match(graph.source, /subgraph pm\d+\["aggregate"\]\n\s+direction BT/);
  assert.doesNotMatch(graph.source, /pm_layout_/);
});

test("Dagre preserves relationship-connected groups without layout-only edges", () => {
  const groupedMap = {
    direction: "td",
    root: "root",
    components: [
      component("root", "directory", undefined, 0),
      component("role", "directory", "root", 1),
      ...["a", "b", "c", "d", "e", "f"].map((id, index) =>
        component(id, "document", "role", index + 2),
      ),
    ],
    relationships: [
      { source: "a", type: "governs", direction: "source-to-target", target: "b" },
      { source: "c", type: "implements", direction: "source-to-target", target: "d" },
      { source: "e", type: "verifies", direction: "source-to-target", target: "f" },
    ],
  };
  const projection = deriveProjectMapFocusProjection(
    groupedMap,
    "role",
    new Set(["governs", "implements", "verifies"]),
    true,
  );
  const decision = decideProjectMapLayout(projection);
  const graph = buildProjectMapMermaidGraph(projection);

  assert.deepEqual(
    projectMapWeakComponentGroups(projection).map((group) =>
      group.map(({ id }) => id),
    ),
    [
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ],
  );
  assert.equal(decision.engine, "dagre");
  assert.equal(decision.reason, "sparse-wide");
  assert.equal(graph.connections.length, 3);
  assert.doesNotMatch(graph.source, / ~~~ /);
  assert.doesNotMatch(graph.source, /pm_layout_/);
  assert.match(graph.source, /pm\d+ -->\|"governs"\| pm\d+/);
  assert.match(graph.source, /pm\d+ -->\|"implements"\| pm\d+/);
  assert.match(graph.source, /pm\d+ -->\|"verifies"\| pm\d+/);
});

test("a small cyclic scope retains Dagre without layout-only edges", () => {
  const cyclicMap = {
    direction: "td",
    root: "root",
    components: [
      component("root", "directory", undefined, 0),
      component("role", "directory", "root", 1),
      component("a", "document", "role", 2),
      component("b", "document", "role", 3),
    ],
    relationships: [
      {
        source: "a",
        type: "pressures",
        direction: "source-to-target",
        target: "b",
      },
      {
        source: "b",
        type: "returns",
        direction: "source-to-target",
        target: "a",
      },
    ],
  };
  const projection = deriveProjectMapFocusProjection(
    cyclicMap,
    "role",
    new Set(["pressures", "returns"]),
    true,
  );
  const decision = decideProjectMapLayout(projection);

  assert.equal(decision.engine, "dagre");
  assert.equal(decision.reason, "cycle");
});

test("disconnected Dagre components pack into deterministic rows", () => {
  const rectangles = Array.from({ length: 18 }, (_, index) => ({
    id: `island-${index + 1}`,
    width: 184 + (index % 3) * 18,
    height: 52 + (index % 2) * 8,
  }));
  const packing = packProjectMapDisconnectedComponents(rectangles);

  assert.ok(packing.rowCount > 1);
  assert.ok(packing.columnCount < rectangles.length);
  assert.ok(new Set(packing.placements.map(({ y }) => y)).size > 1);
  assert.deepEqual(
    packing.placements.map(({ id }) => id),
    rectangles.map(({ id }) => id),
  );
  assert.deepEqual(
    packProjectMapDisconnectedComponents(rectangles),
    packing,
  );

  for (const [index, left] of packing.placements.entries()) {
    for (const right of packing.placements.slice(index + 1)) {
      const separated =
        left.x + left.width <= right.x ||
        right.x + right.width <= left.x ||
        left.y + left.height <= right.y ||
        right.y + right.height <= left.y;
      assert.ok(separated, `${left.id} overlaps ${right.id}`);
    }
  }
});
