export interface RemotePathBreadcrumb {
  label: string;
  path: string;
}

export function filterSshDestinations(
  destinations: string[],
  query: string,
): string[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return destinations;
  return destinations.filter((destination) =>
    destination.toLocaleLowerCase().includes(normalized),
  );
}

export function remotePathBreadcrumbs(path: string): RemotePathBreadcrumb[] {
  if (!path.startsWith("/")) return [];
  const breadcrumbs: RemotePathBreadcrumb[] = [{ label: "/", path: "/" }];
  let current = "";
  for (const part of path.split("/").filter(Boolean)) {
    current += `/${part}`;
    breadcrumbs.push({ label: part, path: current });
  }
  return breadcrumbs;
}

export function remoteFolderName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? "/";
}
