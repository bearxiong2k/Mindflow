import { documentDirectory, documentRelationships } from "./types.ts";
import { externalTargetKey } from "./graph.ts";
import type { GraphData } from "./types.ts";

export interface RelationshipContext {
  focusPath: string;
  documentPaths: Set<string>;
  externalKeys: Set<string>;
  relationshipIndexes: Set<number>;
}

export function buildRelationshipContext(
  graph: GraphData,
  focusPath: string,
  activeTypes: Set<string>,
  includeExternalTargets = true,
  visibleRoles?: ReadonlySet<string>,
): RelationshipContext {
  const visiblePaths = visibleRoles
    ? new Set(
        graph.documents
          .filter((document) => visibleRoles.has(documentDirectory(document)))
          .map((document) => document.path),
      )
    : undefined;
  const documentPaths = new Set<string>(
    visiblePaths === undefined || visiblePaths.has(focusPath)
      ? [focusPath]
      : [],
  );
  const externalKeys = new Set<string>();
  const relationshipIndexes = new Set<number>();

  for (const [index, relationship] of documentRelationships(graph).entries()) {
    if (!activeTypes.has(relationship.type)) continue;
    if (visiblePaths && !visiblePaths.has(relationship.source)) continue;
    if (
      visiblePaths &&
      typeof relationship.target === "string" &&
      !visiblePaths.has(relationship.target)
    ) {
      continue;
    }
    if (!includeExternalTargets && typeof relationship.target !== "string") {
      continue;
    }
    const outgoing = relationship.source === focusPath;
    const incoming = relationship.target === focusPath;
    if (!outgoing && !incoming) continue;

    relationshipIndexes.add(index);
    documentPaths.add(relationship.source);
    if (typeof relationship.target === "string") {
      documentPaths.add(relationship.target);
    } else {
      externalKeys.add(externalTargetKey(relationship.target));
    }
  }

  return {
    focusPath,
    documentPaths,
    externalKeys,
    relationshipIndexes,
  };
}
