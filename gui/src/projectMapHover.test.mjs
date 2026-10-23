import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PROJECT_MAP_CONNECTION_HOVERED_CLASS,
  PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE,
  PROJECT_MAP_CONNECTION_NEIGHBOR_CLASS,
  PROJECT_MAP_CONNECTION_RELATED_CLASS,
  PROJECT_MAP_CONNECTION_SOURCE_ATTRIBUTE,
  PROJECT_MAP_CONNECTION_TARGET_ATTRIBUTE,
  PROJECT_MAP_COMPONENT_HOVERED_CLASS,
  setProjectMapComponentHover,
  setProjectMapConnectionHover,
  setProjectMapPresentationState,
} from "./projectMapHover.ts";

function fakeElement(attributes = {}) {
  const values = new Map(Object.entries(attributes));
  const classes = new Set();
  return {
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      contains: (name) => classes.has(name),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
    },
    getAttribute: (name) => values.get(name) ?? null,
    removeAttribute: (name) => values.delete(name),
    setAttribute: (name, value) => values.set(name, value),
  };
}

test("relationship hover follows the edge, label, and both manifested endpoints", () => {
  const connectionAttributes = {
    [PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE]: "relationship-3",
    [PROJECT_MAP_CONNECTION_SOURCE_ATTRIBUTE]: "source",
    [PROJECT_MAP_CONNECTION_TARGET_ATTRIBUTE]: "target",
  };
  const edge = fakeElement(connectionAttributes);
  const label = fakeElement(connectionAttributes);
  const source = fakeElement({ "data-project-component-id": "source" });
  const target = fakeElement({ "data-project-component-id": "target" });
  const unrelated = fakeElement({ "data-project-component-id": "other" });
  const elements = [edge, label, source, target, unrelated];
  const container = fakeElement();
  container.querySelectorAll = () => elements;

  assert.equal(setProjectMapConnectionHover(container, edge), "relationship-3");
  assert.equal(edge.classList.contains(PROJECT_MAP_CONNECTION_HOVERED_CLASS), true);
  assert.equal(label.classList.contains(PROJECT_MAP_CONNECTION_HOVERED_CLASS), true);
  assert.equal(source.classList.contains(PROJECT_MAP_CONNECTION_RELATED_CLASS), true);
  assert.equal(target.classList.contains(PROJECT_MAP_CONNECTION_RELATED_CLASS), true);
  assert.equal(unrelated.classList.contains(PROJECT_MAP_CONNECTION_RELATED_CLASS), false);

  assert.equal(setProjectMapConnectionHover(container, null), null);
  for (const element of elements) {
    assert.equal(
      element.classList.contains(PROJECT_MAP_CONNECTION_HOVERED_CLASS),
      false,
    );
    assert.equal(
      element.classList.contains(PROJECT_MAP_CONNECTION_RELATED_CLASS),
      false,
    );
  }
});

test("component hover reveals every incident connection and one-hop neighbor", () => {
  const firstConnection = {
    [PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE]: "relationship-1",
    [PROJECT_MAP_CONNECTION_SOURCE_ATTRIBUTE]: "focus",
    [PROJECT_MAP_CONNECTION_TARGET_ATTRIBUTE]: "first",
  };
  const secondConnection = {
    [PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE]: "relationship-2",
    [PROJECT_MAP_CONNECTION_SOURCE_ATTRIBUTE]: "second",
    [PROJECT_MAP_CONNECTION_TARGET_ATTRIBUTE]: "focus",
  };
  const unrelatedConnection = {
    [PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE]: "relationship-3",
    [PROJECT_MAP_CONNECTION_SOURCE_ATTRIBUTE]: "first",
    [PROJECT_MAP_CONNECTION_TARGET_ATTRIBUTE]: "other",
  };
  const firstPath = fakeElement(firstConnection);
  const firstLabel = fakeElement(firstConnection);
  const secondPath = fakeElement(secondConnection);
  const unrelatedPath = fakeElement(unrelatedConnection);
  const focus = fakeElement({ "data-project-component-id": "focus" });
  const first = fakeElement({ "data-project-component-id": "first" });
  const second = fakeElement({ "data-project-component-id": "second" });
  const other = fakeElement({ "data-project-component-id": "other" });
  const elements = [
    firstPath,
    firstLabel,
    secondPath,
    unrelatedPath,
    focus,
    first,
    second,
    other,
  ];
  const container = fakeElement();
  container.querySelectorAll = () => elements;

  assert.equal(setProjectMapComponentHover(container, focus), "focus");
  assert.equal(
    focus.classList.contains(PROJECT_MAP_COMPONENT_HOVERED_CLASS),
    true,
  );
  assert.equal(
    firstPath.classList.contains(PROJECT_MAP_CONNECTION_NEIGHBOR_CLASS),
    true,
  );
  assert.equal(
    firstLabel.classList.contains(PROJECT_MAP_CONNECTION_NEIGHBOR_CLASS),
    true,
  );
  assert.equal(
    secondPath.classList.contains(PROJECT_MAP_CONNECTION_NEIGHBOR_CLASS),
    true,
  );
  assert.equal(
    unrelatedPath.classList.contains(PROJECT_MAP_CONNECTION_NEIGHBOR_CLASS),
    false,
  );
  assert.equal(
    first.classList.contains(PROJECT_MAP_CONNECTION_RELATED_CLASS),
    true,
  );
  assert.equal(
    second.classList.contains(PROJECT_MAP_CONNECTION_RELATED_CLASS),
    true,
  );
  assert.equal(
    other.classList.contains(PROJECT_MAP_CONNECTION_RELATED_CLASS),
    false,
  );

  assert.equal(setProjectMapComponentHover(container, null), null);
  for (const element of elements) {
    assert.equal(
      element.classList.contains(PROJECT_MAP_COMPONENT_HOVERED_CLASS),
      false,
    );
    assert.equal(
      element.classList.contains(PROJECT_MAP_CONNECTION_NEIGHBOR_CLASS),
      false,
    );
    assert.equal(
      element.classList.contains(PROJECT_MAP_CONNECTION_RELATED_CLASS),
      false,
    );
  }
});

test("direct relationship hover replaces a component neighborhood", () => {
  const connectionAttributes = {
    [PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE]: "relationship-1",
    [PROJECT_MAP_CONNECTION_SOURCE_ATTRIBUTE]: "focus",
    [PROJECT_MAP_CONNECTION_TARGET_ATTRIBUTE]: "related",
  };
  const connection = fakeElement(connectionAttributes);
  const focus = fakeElement({ "data-project-component-id": "focus" });
  const related = fakeElement({ "data-project-component-id": "related" });
  const elements = [connection, focus, related];
  const container = fakeElement();
  container.querySelectorAll = () => elements;

  setProjectMapComponentHover(container, focus);
  assert.equal(
    connection.classList.contains(PROJECT_MAP_CONNECTION_NEIGHBOR_CLASS),
    true,
  );

  setProjectMapConnectionHover(container, connection);
  assert.equal(
    connection.classList.contains(PROJECT_MAP_CONNECTION_NEIGHBOR_CLASS),
    false,
  );
  assert.equal(
    connection.classList.contains(PROJECT_MAP_CONNECTION_HOVERED_CLASS),
    true,
  );
  assert.equal(
    focus.classList.contains(PROJECT_MAP_COMPONENT_HOVERED_CLASS),
    false,
  );
  assert.equal(
    focus.classList.contains(PROJECT_MAP_CONNECTION_RELATED_CLASS),
    true,
  );
});

test("leaving an edge or component clears the other hover family too", () => {
  const connection = fakeElement({
    [PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE]: "edge",
    [PROJECT_MAP_CONNECTION_SOURCE_ATTRIBUTE]: "focus",
    [PROJECT_MAP_CONNECTION_TARGET_ATTRIBUTE]: "related",
  });
  const focus = fakeElement({ "data-project-component-id": "focus" });
  const container = fakeElement();
  container.querySelectorAll = () => [connection, focus];
  setProjectMapConnectionHover(container, connection);
  setProjectMapComponentHover(container, null);
  assert.equal(connection.classList.contains(PROJECT_MAP_CONNECTION_HOVERED_CLASS), false);
  setProjectMapComponentHover(container, focus);
  setProjectMapConnectionHover(container, null);
  assert.equal(focus.classList.contains(PROJECT_MAP_COMPONENT_HOVERED_CLASS), false);
});

test("selection and search update classes through one stable DOM index", () => {
  const first = fakeElement({ "data-project-component-id": "first" });
  const second = fakeElement({ "data-project-component-id": "second" });
  const third = fakeElement({ "data-project-component-id": "third" });
  const container = fakeElement();
  container.firstElementChild = fakeElement();
  let scans = 0;
  container.querySelectorAll = () => {
    scans += 1;
    return [first, second, third];
  };

  setProjectMapPresentationState(container, "first", new Set(["second"]));
  assert.equal(first.classList.contains("is-selected"), true);
  assert.equal(second.classList.contains("is-match"), true);
  assert.equal(scans, 1);

  setProjectMapPresentationState(
    container,
    "third",
    new Set(["first", "third"]),
  );
  assert.equal(first.classList.contains("is-selected"), false);
  assert.equal(first.classList.contains("is-match"), true);
  assert.equal(second.classList.contains("is-match"), false);
  assert.equal(third.classList.contains("is-selected"), true);
  assert.equal(third.classList.contains("is-match"), true);
  assert.equal(scans, 1);
});

test("hover reuses the presentation index instead of rescanning the graph", () => {
  const connectionAttributes = {
    [PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE]: "relationship-1",
    [PROJECT_MAP_CONNECTION_SOURCE_ATTRIBUTE]: "first",
    [PROJECT_MAP_CONNECTION_TARGET_ATTRIBUTE]: "second",
  };
  const connection = fakeElement(connectionAttributes);
  const first = fakeElement({ "data-project-component-id": "first" });
  const second = fakeElement({ "data-project-component-id": "second" });
  const container = fakeElement();
  container.firstElementChild = fakeElement();
  let scans = 0;
  container.querySelectorAll = () => {
    scans += 1;
    return [connection, first, second];
  };

  setProjectMapPresentationState(container, "first", new Set());
  setProjectMapComponentHover(container, first);
  setProjectMapConnectionHover(container, connection);

  assert.equal(scans, 1);
  assert.equal(
    connection.classList.contains(PROJECT_MAP_CONNECTION_HOVERED_CLASS),
    true,
  );
});

test("related component emphasis preserves each node's semantic colors", async () => {
  const styles = await readFile(
    new URL("./styles.css", import.meta.url),
    "utf8",
  );
  const relatedNodeStart = styles.indexOf(
    ".node.is-project-map-connection-related\n  > rect",
  );
  const relatedNodeEnd = styles.indexOf(
    ".project-map-mermaid__svg .project-map-layer-cluster {",
    relatedNodeStart,
  );
  const relatedNodeRules = styles.slice(relatedNodeStart, relatedNodeEnd);
  const relatedLayerStart = styles.indexOf(
    ".project-map-layer-cluster.is-project-map-connection-related",
  );
  const relatedLayerEnd = styles.indexOf(
    ".project-map-mermaid__svg .project-map-layer-cluster__label",
    relatedLayerStart,
  );
  const relatedLayerRules = styles.slice(relatedLayerStart, relatedLayerEnd);

  assert.notEqual(relatedNodeStart, -1);
  assert.notEqual(relatedNodeEnd, -1);
  assert.notEqual(relatedLayerStart, -1);
  assert.notEqual(relatedLayerEnd, -1);
  assert.doesNotMatch(relatedNodeRules, /(?:fill|stroke|color)\s*:/);
  assert.doesNotMatch(relatedLayerRules, /(?:fill|stroke|color)\s*:/);
  assert.match(relatedNodeRules, /stroke-width:\s*2\.4px/);
  assert.match(relatedNodeRules, /drop-shadow/);
  assert.match(relatedLayerRules, /stroke-width:\s*2\.2px/);
  assert.match(relatedLayerRules, /drop-shadow/);
});
