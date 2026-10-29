import type {
  Opening,
  GraphData,
  ProjectComponent,
  ProjectMap,
  ProjectMapRelationship,
} from "./types";

export interface ProjectMapProjectionLayer {
  focus: ProjectComponent;
  primary: ProjectComponent[];
  context: ProjectComponent[];
  relationships: ProjectMapRelationship[];
  openingComponentIds: string[];
  expanded: ProjectMapProjectionLayer[];
}

export interface ProjectMapFocusProjection extends ProjectMapProjectionLayer {
  direction: ProjectMap["direction"];
  depth: number;
  effectiveRoles: ReadonlyMap<string, string>;
}

export type ProjectMapComponentActivation =
  | { kind: "hierarchy"; componentId: string }
  | { kind: "reader"; path: string }
  | { kind: "external-path"; path: string }
  | { kind: "selection"; componentId: string };

const AGGREGATE_KINDS = new Set(["directory"]);

export function projectMapComponentIsAggregate(component: ProjectComponent) {
  return AGGREGATE_KINDS.has(component.kind);
}

export function projectMapComponentActivation(
  component: ProjectComponent,
  childrenCount: number,
): ProjectMapComponentActivation {
  if (projectMapComponentIsAggregate(component) && childrenCount > 0) {
    return { kind: "hierarchy", componentId: component.id };
  }
  if (component.kind === "document" && component.binding?.kind === "path") {
    return { kind: "reader", path: component.binding.value };
  }
  if (
    component.binding?.kind === "directory" ||
    component.binding?.kind === "path"
  ) {
    return { kind: "external-path", path: component.binding.value };
  }
  return { kind: "selection", componentId: component.id };
}

export function projectMapChildrenByParent(
  components: readonly ProjectComponent[],
) {
  const result = new Map<string, ProjectComponent[]>();
  for (const component of components) {
    if (!component.parent) continue;
    const children = result.get(component.parent) ?? [];
    children.push(component);
    result.set(component.parent, children);
  }
  for (const children of result.values()) {
    children.sort((left, right) => left.order - right.order);
  }
  return result;
}

// Folder context is derived from actual containment, with no role overrides.
export function projectMapEffectiveRoles(map: ProjectMap) {
  const byId = new Map(map.components.map(component => [component.id, component]));
  return new Map(map.components.flatMap(component => {
    const directory = component.kind === "directory" ? component : byId.get(component.parent ?? "");
    return directory ? [[component.id, directory.label] as const] : [];
  }));
}

const canvasMaps = new WeakMap<GraphData, ProjectMap>();
export function projectMapFor(graph: GraphData): ProjectMap {
  const cached = canvasMaps.get(graph);
  if (cached) return cached;
  const nodeId = new Map(graph.structure.nodes.map(node => [node.path, node.component?.id ?? `context:${node.path}`]));
  const map: ProjectMap = {
    direction: "td", root: nodeId.get(".") ?? "context:.",
    components: graph.structure.nodes.map((node,order) => ({
      id: nodeId.get(node.path)!, label: node.name, kind: node.kind,
      parent: node.parent_path ? nodeId.get(node.parent_path) : undefined,
      description: node.component?.description, index: node.component?.index,
      managed: !!node.component, componentId: node.component?.id,
      binding: {kind: node.kind === "directory" ? "directory" : "path", value: node.path}, order,
    })), relationships: graph.structure.relationships,
  };
  canvasMaps.set(graph,map);
  return map;
}

/** An explicit navigation action: reveal Opening in its ordinary hierarchy. */
export function projectMapOpeningFocus(map: ProjectMap, opening: Opening) {
  if (!opening.files.length) return undefined;
  const byId = new Map(map.components.map(component => [component.id, component]));
  const ancestors: string[][] = [];
  for (const file of opening.files) {
    const component = byId.get(file.component);
    if (component?.kind !== "document") return undefined;
    const chain: string[] = [];
    const visited = new Set<string>();
    let parent = component.parent;
    while (parent && !visited.has(parent)) {
      visited.add(parent);
      chain.push(parent);
      parent = byId.get(parent)?.parent;
    }
    if (chain.at(-1) !== map.root) return undefined;
    ancestors.push(chain);
  }
  const focusId = ancestors[0].find(id => ancestors.every(chain => chain.includes(id)))!;
  return {
    focusId,
    depth: Math.max(...ancestors.map(chain => chain.indexOf(focusId) + 1)),
    fitComponentIds: opening.files.map(file => file.component),
  };
}

export function projectMapMaximumDepth(
  focusId: string,
  childrenByParent: ReadonlyMap<string, readonly ProjectComponent[]>,
) {
  const visit = (componentId: string, ancestry: ReadonlySet<string>): number => {
    if (ancestry.has(componentId)) return 0;
    const children = childrenByParent.get(componentId) ?? [];
    if (children.length === 0) return 0;
    const nextAncestry = new Set(ancestry).add(componentId);
    return (
      1 +
      Math.max(
        0,
        ...children.map((child) =>
          projectMapComponentIsAggregate(child)
            ? visit(child.id, nextAncestry)
            : 0,
        ),
      )
    );
  };

  return Math.max(1, visit(focusId, new Set()));
}

export function projectMapViewingDepth(
  focusId: string,
  maximumDepth: number,
  depthsByFocusId: ReadonlyMap<string, number>,
) {
  const requestedDepth = depthsByFocusId.get(focusId) ?? 1;
  return Math.max(1, Math.min(Math.max(1, maximumDepth), requestedDepth));
}

export function projectMapViewingDepthsWith(
  depthsByFocusId: Map<string, number>,
  focusId: string,
  nextDepth: number,
  maximumDepth: number,
) {
  const boundedDepth = Math.max(
    1,
    Math.min(Math.max(1, maximumDepth), nextDepth),
  );
  const currentDepth = projectMapViewingDepth(
    focusId,
    maximumDepth,
    depthsByFocusId,
  );
  if (currentDepth === boundedDepth) return depthsByFocusId;

  const next = new Map(depthsByFocusId);
  if (boundedDepth === 1) next.delete(focusId);
  else next.set(focusId, boundedDepth);
  return next;
}

function relationshipIsVisible(
  relationship: ProjectMapRelationship,
  componentById: ReadonlyMap<string, ProjectComponent>,
  activeTypes: ReadonlySet<string>,
  showExternalTargets: boolean,
) {
  if (!activeTypes.has(relationship.type)) return false;
  if (showExternalTargets) return true;
  return (
    componentById.get(relationship.source)?.kind !== "target" &&
    componentById.get(relationship.target)?.kind !== "target"
  );
}

function orderedComponents(
  ids: ReadonlySet<string>,
  components: readonly ProjectComponent[],
) {
  return components.filter((component) => ids.has(component.id));
}

function componentIsWithin(
  componentId: string,
  ancestorId: string,
  componentById: ReadonlyMap<string, ProjectComponent>,
) {
  let cursor = componentById.get(componentId);
  while (cursor) {
    if (cursor.id === ancestorId) return true;
    cursor = cursor.parent ? componentById.get(cursor.parent) : undefined;
  }
  return false;
}

function firstChildWithinFocus(
  componentId: string,
  focusId: string,
  componentById: ReadonlyMap<string, ProjectComponent>,
) {
  if (componentId === focusId) return focusId;
  let cursor = componentById.get(componentId);
  while (cursor?.parent && cursor.parent !== focusId) {
    cursor = componentById.get(cursor.parent);
  }
  return cursor?.parent === focusId ? cursor.id : undefined;
}

function componentDepth(
  componentId: string,
  componentById: ReadonlyMap<string, ProjectComponent>,
) {
  let depth = 0;
  let cursor = componentById.get(componentId);
  const visited = new Set<string>();
  while (cursor?.parent && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    depth += 1;
    cursor = componentById.get(cursor.parent);
  }
  return depth;
}

function contextIdAtDepth(
  componentId: string,
  maximumDepth: number,
  componentById: ReadonlyMap<string, ProjectComponent>,
) {
  const component = componentById.get(componentId);
  if (!component || component.kind === "target") return componentId;
  let cursor = component;
  let depth = componentDepth(componentId, componentById);
  while (cursor.parent && depth > maximumDepth) {
    const parent = componentById.get(cursor.parent);
    if (!parent) break;
    cursor = parent;
    depth -= 1;
  }
  return cursor.id;
}

function projectedRelationshipKey(relationship: ProjectMapRelationship) {
  const endpoints =
    relationship.direction === "bidirectional"
      ? [relationship.source, relationship.target].sort()
      : [relationship.source, relationship.target];
  return [
    endpoints[0],
    relationship.type,
    relationship.direction,
    endpoints[1],
  ].join("\u0000");
}

function boundDocumentComponentByPath(map: ProjectMap) {
  return new Map(
    map.components.flatMap((component) =>
      component.kind === "document" && component.binding?.kind === "path"
        ? [[component.binding.value, component] as const]
        : [],
    ),
  );
}

function projectRelationshipsToFocus(
  relationships: readonly ProjectMapRelationship[],
  focusId: string,
  componentById: ReadonlyMap<string, ProjectComponent>,
) {
  const result: ProjectMapRelationship[] = [];
  const seen = new Set<string>();
  const focusDepth = componentDepth(focusId, componentById);

  for (const relationship of relationships) {
    const sourceInFocus = componentIsWithin(
      relationship.source,
      focusId,
      componentById,
    );
    const targetInFocus = componentIsWithin(
      relationship.target,
      focusId,
      componentById,
    );
    if (!sourceInFocus && !targetInFocus) continue;

    const source = sourceInFocus
      ? firstChildWithinFocus(relationship.source, focusId, componentById)
      : contextIdAtDepth(relationship.source, focusDepth, componentById);
    const target = targetInFocus
      ? firstChildWithinFocus(relationship.target, focusId, componentById)
      : contextIdAtDepth(relationship.target, focusDepth, componentById);
    if (!source || !target || source === target) continue;

    const projected = { ...relationship, source, target };
    const key = projectedRelationshipKey(projected);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(projected);
  }

  return result;
}

function rootScopeRelationships(
  relationships: readonly ProjectMapRelationship[],
  componentIds: ReadonlySet<string>,
) {
  return relationships.filter(
    (relationship) =>
      componentIds.has(relationship.source) && componentIds.has(relationship.target),
  );
}

function isSameHierarchyPeer(
  componentId: string,
  focus: ProjectComponent,
  componentById: ReadonlyMap<string, ProjectComponent>,
) {
  const component = componentById.get(componentId);
  return Boolean(
    focus.parent &&
      component?.parent &&
      component.parent === focus.parent &&
      component.id !== focus.id,
  );
}

function deriveProjectMapProjectionLayer(
  map: ProjectMap,
  focus: ProjectComponent,
  componentById: ReadonlyMap<string, ProjectComponent>,
  childrenByParent: ReadonlyMap<string, ProjectComponent[]>,
  visibleRelationships: readonly ProjectMapRelationship[],
  openingCueIds: ReadonlySet<string>,
  remainingDepth: number,
  includeContext: boolean,
): ProjectMapProjectionLayer {
  const children = childrenByParent.get(focus.id) ?? [];
  const primaryIds = new Set(children.map((child) => child.id));
  const projectedRelationships =
    focus.parent === undefined
      ? rootScopeRelationships(
          visibleRelationships,
          primaryIds,
        )
      : projectRelationshipsToFocus(
          visibleRelationships,
          focus.id,
          componentById,
        );

  const scopeIds = new Set(children.map((child) => child.id));
  const contextIds = new Set<string>();
  if (includeContext) {
    for (const relationship of projectedRelationships) {
      const sourceInScope = scopeIds.has(relationship.source);
      const targetInScope = scopeIds.has(relationship.target);
      if (sourceInScope === targetInScope) continue;
      const contextId = sourceInScope
        ? relationship.target
        : relationship.source;
      if (
        contextId === focus.id ||
        isSameHierarchyPeer(contextId, focus, componentById)
      ) {
        continue;
      }
      contextIds.add(contextId);
    }
  }
  const visibleIds = new Set([...scopeIds, ...contextIds]);
  const openingComponentIds = [...visibleIds].filter((visibleId) =>
    openingCueIds.has(visibleId),
  );

  const expanded =
    remainingDepth > 1
      ? children.flatMap((child) =>
          projectMapComponentIsAggregate(child) &&
          (childrenByParent.get(child.id)?.length ?? 0) > 0
            ? [
                deriveProjectMapProjectionLayer(
                  map,
                  child,
                  componentById,
                  childrenByParent,
                  visibleRelationships,
                  openingCueIds,
                  remainingDepth - 1,
                  false,
                ),
              ]
            : [],
        )
      : [];

  return {
    focus,
    primary: children,
    context: orderedComponents(contextIds, map.components),
    relationships: projectedRelationships.filter(
      (relationship) =>
        visibleIds.has(relationship.source) &&
        visibleIds.has(relationship.target) &&
        (scopeIds.has(relationship.source) || scopeIds.has(relationship.target)),
    ),
    openingComponentIds,
    expanded,
  };
}

export function deriveProjectMapFocusProjection(
  map: ProjectMap,
  requestedFocusId: string,
  activeTypes: ReadonlySet<string>,
  showExternalTargets: boolean,
  opening?: Opening,
  depth = 1,
): ProjectMapFocusProjection {
  const componentById = new Map(
    map.components.map((component) => [component.id, component]),
  );
  const childrenByParent = projectMapChildrenByParent(map.components);
  const documentByPath = boundDocumentComponentByPath(map);
  const openingCueIds = new Set<string>();
  for (const file of opening?.files ?? []) {
    let component = documentByPath.get(file.path);
    while (component && !openingCueIds.has(component.id)) {
      openingCueIds.add(component.id);
      component = component.parent
        ? componentById.get(component.parent)
        : undefined;
    }
  }
  const requestedFocus = componentById.get(requestedFocusId);
  const root = componentById.get(map.root) ?? map.components[0];
  const focus =
    requestedFocus && projectMapComponentIsAggregate(requestedFocus)
      ? requestedFocus
      : root;
  const maximumDepth = projectMapMaximumDepth(focus.id, childrenByParent);
  const normalizedDepth = Math.min(
    maximumDepth,
    Math.max(1, Math.floor(Number.isFinite(depth) ? depth : 1)),
  );
  const visibleRelationships = map.relationships.filter((relationship) =>
    relationshipIsVisible(
      relationship,
      componentById,
      activeTypes,
      showExternalTargets,
    ),
  );

  return {
    direction: map.direction,
    depth: normalizedDepth,
    effectiveRoles: projectMapEffectiveRoles(map),
    ...deriveProjectMapProjectionLayer(
      map,
      focus,
      componentById,
      childrenByParent,
      visibleRelationships,
      openingCueIds,
      normalizedDepth,
      true,
    ),
  };
}
