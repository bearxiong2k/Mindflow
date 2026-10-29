import type { ProjectEntry, ProjectMap } from "./types";

export function sameProjectDirectoryEntries(left: readonly ProjectEntry[], right: readonly ProjectEntry[]) {
  return left.length === right.length && left.every((entry, index) =>
    entry.path === right[index].path && entry.name === right[index].name && entry.kind === right[index].kind);
}

export interface ProjectMapNavigationRequest {
  focusId: string;
  revision: number;
  depth?: number;
  fitGraph?: boolean;
  fitComponentIds?: readonly string[];
}

// Bindings are root-relative. Never turn a URL, glob, or outside-root path into
// a Files target, or infer category membership from a filesystem descendant.
function projectRelativePath(value: string): string | undefined {
  if (value.startsWith("/") || /^[a-z]+:/i.test(value)) return undefined;
  const parts = value.split("/").filter((part) => part && part !== ".");
  if (parts.includes("..")) return undefined;
  return parts.join("/");
}

export function projectFilesNavigationIndex(map: ProjectMap) {
  const pathByComponentId = new Map<string, string>();
  const componentIdByPath = new Map<string, string>();
  const focusIdByDirectory = new Map<string, string>();
  const ambiguousPaths = new Set<string>();
  const parents = new Set(map.components.map((component) => component.parent));
  for (const component of map.components) {
    const binding = component.binding;
    const path = component.id === map.root
      ? ""
      : binding?.kind === "directory" || binding?.kind === "path"
        ? projectRelativePath(binding.value)
        : undefined;
    if (path === undefined) continue;
    pathByComponentId.set(component.id, path);
    if (componentIdByPath.has(path)) ambiguousPaths.add(path);
    componentIdByPath.set(path, component.id);
    if (
      component.id === map.root ||
      (binding?.kind === "directory" && parents.has(component.id) &&
        component.kind === "directory")
    ) {
      focusIdByDirectory.set(path, component.id);
    }
  }
  for (const path of ambiguousPaths) {
    componentIdByPath.delete(path);
    focusIdByDirectory.delete(path);
  }
  return { pathByComponentId, componentIdByPath, focusIdByDirectory };
}

export function projectFilesAncestorPaths(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
}

export function nearestVisibleProjectPath(
  path: string | undefined,
  visiblePaths: ReadonlySet<string>,
): string | undefined {
  while (path !== undefined) {
    if (visiblePaths.has(path)) return path;
    const separator = path.lastIndexOf("/");
    path = separator >= 0 ? path.slice(0, separator) : path ? "" : undefined;
  }
  return undefined;
}

export const PROJECT_FILES_NAVIGATION_MS = 100;
export const PROJECT_FILES_HOVER_INTENT_MS = 80;

// A collapsed category exposes its row; an expanded map region also exposes
// its folder contents. Both keep the active folder's ancestor chain open.
export function projectFilesFocusedPaths(
  activeDirectory: string | undefined,
  target?: string,
  expandTarget = false,
) {
  const paths = new Set<string>();
  if (activeDirectory) {
    for (const path of projectFilesAncestorPaths(activeDirectory)) paths.add(path);
    paths.add(activeDirectory);
  }
  if (target) {
    for (const path of projectFilesAncestorPaths(target)) paths.add(path);
    if (expandTarget) paths.add(target);
  }
  return paths;
}

export function projectFilesRevealScrollTop(
  scrollTop: number,
  viewportHeight: number,
  targetTop: number,
  targetHeight: number,
  contentHeight: number,
) {
  const maximum = Math.max(0, contentHeight - viewportHeight);
  const current = Math.min(maximum, Math.max(0, scrollTop));
  const margin = Math.min(32, viewportHeight / 10);
  // A comfortable visible band is the dead zone: small layout changes and
  // repeated hover events must not chase the exact center. At either end of the
  // list, the clamped center is also a fixed point, even outside this band.
  if (targetTop >= current + margin - 1 &&
      targetTop + targetHeight <= current + viewportHeight - margin + 1) {
    return current;
  }
  return Math.min(maximum, Math.max(0, targetTop + targetHeight / 2 - viewportHeight / 2));
}
