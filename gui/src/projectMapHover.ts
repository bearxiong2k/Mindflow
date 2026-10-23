export const PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE =
  "data-project-map-connection-key";
export const PROJECT_MAP_CONNECTION_SOURCE_ATTRIBUTE =
  "data-project-map-source-id";
export const PROJECT_MAP_CONNECTION_TARGET_ATTRIBUTE =
  "data-project-map-target-id";
export const PROJECT_MAP_CONNECTION_HOVERED_CLASS =
  "is-project-map-connection-hovered";
export const PROJECT_MAP_CONNECTION_NEIGHBOR_CLASS =
  "is-project-map-connection-neighbor";
export const PROJECT_MAP_CONNECTION_RELATED_CLASS =
  "is-project-map-connection-related";
export const PROJECT_MAP_COMPONENT_HOVERED_CLASS =
  "is-project-map-component-hovered";

const PROJECT_MAP_HOVERED_CONNECTION_ATTRIBUTE =
  "data-project-map-hovered-connection";
const PROJECT_MAP_HOVERED_COMPONENT_ATTRIBUTE =
  "data-project-map-hovered-component";

const PROJECT_MAP_COMPONENT_SELECTOR =
  "g.node[data-project-component-id], g.cluster[data-project-component-id]";

interface ProjectMapDomIndex {
  root: Element | null;
  componentsById: Map<string, Element[]>;
  connectionsByKey: Map<string, Element[]>;
  incidentConnectionsById: Map<string, Set<Element>>;
  neighborIdsById: Map<string, Set<string>>;
  hoverElements: Set<Element>;
  matchElements: Set<Element>;
  selectedElements: Set<Element>;
}

const projectMapDomIndices = new WeakMap<Element, ProjectMapDomIndex>();

function appendIndexedElement(
  index: Map<string, Element[]>,
  key: string | null,
  element: Element,
) {
  if (!key) return;
  const current = index.get(key);
  if (current) current.push(element);
  else index.set(key, [element]);
}

function appendIndexedSet(
  index: Map<string, Set<Element>>,
  key: string | null,
  element: Element,
) {
  if (!key) return;
  const current = index.get(key);
  if (current) current.add(element);
  else index.set(key, new Set([element]));
}

function appendNeighbor(
  index: Map<string, Set<string>>,
  sourceId: string | null,
  targetId: string | null,
) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const current = index.get(sourceId);
  if (current) current.add(targetId);
  else index.set(sourceId, new Set([targetId]));
}

function createProjectMapDomIndex(container: Element): ProjectMapDomIndex {
  const index: ProjectMapDomIndex = {
    root: container.firstElementChild,
    componentsById: new Map(),
    connectionsByKey: new Map(),
    incidentConnectionsById: new Map(),
    neighborIdsById: new Map(),
    hoverElements: new Set(),
    matchElements: new Set(),
    selectedElements: new Set(),
  };
  const elements = container.querySelectorAll(
    `${PROJECT_MAP_COMPONENT_SELECTOR}, [${PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE}]`,
  );
  for (const element of elements) {
    appendIndexedElement(
      index.componentsById,
      element.getAttribute("data-project-component-id"),
      element,
    );
    const connectionKey = element.getAttribute(
      PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE,
    );
    if (!connectionKey) continue;
    appendIndexedElement(index.connectionsByKey, connectionKey, element);
    const sourceId = element.getAttribute(
      PROJECT_MAP_CONNECTION_SOURCE_ATTRIBUTE,
    );
    const targetId = element.getAttribute(
      PROJECT_MAP_CONNECTION_TARGET_ATTRIBUTE,
    );
    appendIndexedSet(index.incidentConnectionsById, sourceId, element);
    appendIndexedSet(index.incidentConnectionsById, targetId, element);
    appendNeighbor(index.neighborIdsById, sourceId, targetId);
    appendNeighbor(index.neighborIdsById, targetId, sourceId);
  }
  projectMapDomIndices.set(container, index);
  return index;
}

function projectMapDomIndex(container: Element) {
  const current = projectMapDomIndices.get(container);
  if (current && current.root === container.firstElementChild) return current;
  return createProjectMapDomIndex(container);
}

function addHoverClass(
  index: ProjectMapDomIndex,
  element: Element,
  className: string,
) {
  element.classList.add(className);
  index.hoverElements.add(element);
}

function clearProjectMapHover(container: Element) {
  const index = projectMapDomIndex(container);
  for (const element of index.hoverElements) {
    element.classList.remove(
      PROJECT_MAP_CONNECTION_HOVERED_CLASS,
      PROJECT_MAP_CONNECTION_NEIGHBOR_CLASS,
      PROJECT_MAP_CONNECTION_RELATED_CLASS,
      PROJECT_MAP_COMPONENT_HOVERED_CLASS,
    );
  }
  index.hoverElements.clear();
  container.removeAttribute(PROJECT_MAP_HOVERED_CONNECTION_ATTRIBUTE);
  container.removeAttribute(PROJECT_MAP_HOVERED_COMPONENT_ATTRIBUTE);
}

export function setProjectMapPresentationState(
  container: Element,
  selectedId: string,
  matchingIds: ReadonlySet<string>,
) {
  const index = projectMapDomIndex(container);
  for (const element of index.selectedElements) {
    element.classList.remove("is-selected");
  }
  index.selectedElements.clear();
  for (const element of index.componentsById.get(selectedId) ?? []) {
    element.classList.add("is-selected");
    index.selectedElements.add(element);
  }

  for (const element of index.matchElements) {
    element.classList.remove("is-match");
  }
  index.matchElements.clear();
  for (const componentId of matchingIds) {
    for (const element of index.componentsById.get(componentId) ?? []) {
      element.classList.add("is-match");
      index.matchElements.add(element);
    }
  }
}

export function setProjectMapConnectionHover(
  container: Element,
  connection: Element | null,
) {
  const nextKey =
    connection?.getAttribute(PROJECT_MAP_CONNECTION_KEY_ATTRIBUTE) ?? null;
  const currentKey = container.getAttribute(
    PROJECT_MAP_HOVERED_CONNECTION_ATTRIBUTE,
  );
  if (
    currentKey === nextKey &&
    ((nextKey === null && !container.getAttribute(PROJECT_MAP_HOVERED_COMPONENT_ATTRIBUTE)) ||
      connection?.classList.contains(PROJECT_MAP_CONNECTION_HOVERED_CLASS))
  ) {
    return nextKey;
  }

  clearProjectMapHover(container);

  if (!connection || nextKey === null) return null;
  const index = projectMapDomIndex(container);
  const sourceId = connection.getAttribute(
    PROJECT_MAP_CONNECTION_SOURCE_ATTRIBUTE,
  );
  const targetId = connection.getAttribute(
    PROJECT_MAP_CONNECTION_TARGET_ATTRIBUTE,
  );

  for (const element of index.connectionsByKey.get(nextKey) ?? []) {
    addHoverClass(index, element, PROJECT_MAP_CONNECTION_HOVERED_CLASS);
  }

  for (const componentId of [sourceId, targetId]) {
    if (!componentId) continue;
    for (const element of index.componentsById.get(componentId) ?? []) {
      addHoverClass(index, element, PROJECT_MAP_CONNECTION_RELATED_CLASS);
    }
  }
  container.setAttribute(PROJECT_MAP_HOVERED_CONNECTION_ATTRIBUTE, nextKey);
  return nextKey;
}

export function setProjectMapComponentHover(
  container: Element,
  component: Element | null,
) {
  const nextId = component?.getAttribute("data-project-component-id") ?? null;
  const currentId = container.getAttribute(
    PROJECT_MAP_HOVERED_COMPONENT_ATTRIBUTE,
  );
  if (
    currentId === nextId &&
    ((nextId === null && !container.getAttribute(PROJECT_MAP_HOVERED_CONNECTION_ATTRIBUTE)) ||
      component?.classList.contains(PROJECT_MAP_COMPONENT_HOVERED_CLASS))
  ) {
    return nextId;
  }

  clearProjectMapHover(container);
  if (!component || nextId === null) return null;

  const index = projectMapDomIndex(container);
  for (const element of index.incidentConnectionsById.get(nextId) ?? []) {
    addHoverClass(index, element, PROJECT_MAP_CONNECTION_NEIGHBOR_CLASS);
  }

  for (const element of index.componentsById.get(nextId) ?? []) {
    addHoverClass(index, element, PROJECT_MAP_COMPONENT_HOVERED_CLASS);
  }
  for (const relatedId of index.neighborIdsById.get(nextId) ?? []) {
    for (const element of index.componentsById.get(relatedId) ?? []) {
      addHoverClass(index, element, PROJECT_MAP_CONNECTION_RELATED_CLASS);
    }
  }

  container.setAttribute(PROJECT_MAP_HOVERED_COMPONENT_ATTRIBUTE, nextId);
  return nextId;
}
