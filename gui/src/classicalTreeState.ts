export function initialClassicalExpansion(
  directoryKeys: Iterable<string>,
  automaticFolding: boolean,
  relevantDirectories: ReadonlySet<string>,
  revealedDirectories: ReadonlySet<string>,
): Set<string> {
  const expanded = new Set<string>();
  for (const directory of directoryKeys) {
    if (
      !automaticFolding ||
      relevantDirectories.has(directory) ||
      revealedDirectories.has(directory)
    ) {
      expanded.add(directory);
    }
  }
  return expanded;
}

export function classicalDirectoryExpanded(
  directory: string,
  automaticFolding: boolean,
  locallyActive: boolean,
  relevantDirectories: ReadonlySet<string>,
  revealedDirectories: ReadonlySet<string>,
  manuallyExpandedDirectories: ReadonlySet<string>,
): boolean {
  if (locallyActive) return manuallyExpandedDirectories.has(directory);
  return (
    !automaticFolding ||
    relevantDirectories.has(directory) ||
    revealedDirectories.has(directory)
  );
}

export function classicalDirectoryShowsAllChildren(
  directory: string,
  automaticFolding: boolean,
  locallyActive: boolean,
  revealedDirectories: ReadonlySet<string>,
): boolean {
  return (
    locallyActive ||
    !automaticFolding ||
    revealedDirectories.has(directory)
  );
}

export function toggleClassicalDirectoryExpansion(
  current: ReadonlySet<string> | undefined,
  initial: ReadonlySet<string>,
  directory: string,
): Set<string> {
  const next = new Set(current ?? initial);
  if (next.has(directory)) next.delete(directory);
  else next.add(directory);
  return next;
}
