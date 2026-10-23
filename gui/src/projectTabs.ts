import type { OpenRegionResponse, RegionResponse } from "./types";

export type ProjectTab =
  | {
      kind: "region";
      id: string;
      label: string;
      root: string;
      region: RegionResponse;
      openError?: string;
      openErrorVersion?: number;
    }
  | {
      kind: "folder";
      id: string;
      label: string;
      root: string;
      openError?: string;
      openErrorVersion?: number;
    }
  | {
      kind: "error";
      id: string;
      label: string;
      requestedPath: string;
      root?: string;
      error: string;
    };

export interface ProjectTabState {
  tabs: ProjectTab[];
  activeId?: string;
}

export const emptyProjectTabState: ProjectTabState = { tabs: [] };

export function sshDestinationFromRoot(root: string): string | undefined {
  if (!root.startsWith("ssh://")) return undefined;
  const pathStart = root.indexOf("/", "ssh://".length);
  return pathStart > "ssh://".length
    ? root.slice("ssh://".length, pathStart)
    : undefined;
}

export function isSshProjectRoot(root: string): boolean {
  return sshDestinationFromRoot(root) !== undefined;
}

function accessQualifiedLabel(project: string, root: string): string {
  const destination = sshDestinationFromRoot(root);
  return destination ? `${project} @ ${destination}` : project;
}

export function projectTabFromResponse(
  response: OpenRegionResponse,
): ProjectTab {
  if (response.status === "region") {
    return {
      kind: "region",
      id: `root:${response.region.root}`,
      label: accessQualifiedLabel(response.region.project, response.region.root),
      root: response.region.root,
      region: response.region,
    };
  }

  if (response.status === "folder") {
    return {
      kind: "folder",
      id: `root:${response.root}`,
      label: accessQualifiedLabel(response.project, response.root),
      root: response.root,
    };
  }

  return {
    kind: "error",
    id: response.root
      ? `root:${response.root}`
      : `request:${response.requested_path}`,
    label: response.root
      ? accessQualifiedLabel(response.project, response.root)
      : response.project,
    requestedPath: response.requested_path,
    root: response.root,
    error: response.message,
  };
}

export function mergeProjectTabs(
  current: ProjectTabState,
  incoming: ProjectTab[],
): ProjectTabState {
  if (incoming.length === 0) return current;

  const tabs = [...current.tabs];
  const indexById = new Map(tabs.map((tab, index) => [tab.id, index]));

  for (const tab of incoming) {
    const existingIndex = indexById.get(tab.id);
    if (existingIndex === undefined) {
      indexById.set(tab.id, tabs.length);
      tabs.push(tab);
      continue;
    }

    const existing = tabs[existingIndex];
    if (existing.kind === "error") {
      tabs[existingIndex] = tab;
    } else if (existing.kind === "folder" && tab.kind === "region") {
      tabs[existingIndex] = tab;
    } else if (existing.kind === "region" && tab.kind === "folder") {
      continue;
    } else if (tab.kind === "error") {
      tabs[existingIndex] = {
        ...existing,
        openError: tab.error,
        openErrorVersion: (existing.openErrorVersion ?? 0) + 1,
      };
    } else if (existing.openError) {
      tabs[existingIndex] = {
        ...existing,
        openError: undefined,
        openErrorVersion: undefined,
      };
    }
  }

  return { tabs, activeId: incoming[0].id };
}

export function closeProjectTab(
  current: ProjectTabState,
  tabId: string,
): ProjectTabState {
  const closingIndex = current.tabs.findIndex((tab) => tab.id === tabId);
  if (closingIndex < 0) return current;

  const tabs = current.tabs.filter((tab) => tab.id !== tabId);
  if (current.activeId !== tabId) return { ...current, tabs };

  const nextActiveIndex = Math.max(0, closingIndex - 1);
  return {
    tabs,
    activeId: tabs[nextActiveIndex]?.id,
  };
}

export function replaceProjectTab(
  current: ProjectTabState,
  tabId: string,
  replacement: ProjectTab,
): ProjectTabState {
  const replacementIndex = current.tabs.findIndex((tab) => tab.id === tabId);
  if (replacementIndex < 0) return current;

  const duplicateIndex = current.tabs.findIndex(
    (tab, index) => index !== replacementIndex && tab.id === replacement.id,
  );
  const tabs =
    duplicateIndex >= 0
      ? current.tabs.filter((_, index) => index !== replacementIndex)
      : current.tabs.map((tab, index) =>
          index === replacementIndex ? replacement : tab,
        );
  return {
    tabs,
    activeId: current.activeId === tabId ? replacement.id : current.activeId,
  };
}

export function clearProjectTabOpenError(
  current: ProjectTabState,
  tabId: string,
): ProjectTabState {
  const index = current.tabs.findIndex((tab) => tab.id === tabId);
  const tab = current.tabs[index];
  if (!tab || tab.kind === "error" || !tab.openError) return current;

  const tabs = [...current.tabs];
  tabs[index] = {
    ...tab,
    openError: undefined,
    openErrorVersion: undefined,
  };
  return { ...current, tabs };
}

export function projectTabDomId(id: string): string {
  return `project-tab-${encodeURIComponent(id)}`;
}

export function projectTabPanelDomId(id: string): string {
  return `project-panel-${encodeURIComponent(id)}`;
}

export function projectTabLaunchPath(tab: ProjectTab): string {
  return tab.kind === "error" ? (tab.root ?? tab.requestedPath) : tab.root;
}

export function projectTabCanRefresh(tab: ProjectTab | undefined): boolean {
  return tab?.kind === "region" || tab?.kind === "folder";
}

export function projectTabRelaunchPaths(state: ProjectTabState): string[] {
  const active = state.tabs.find((tab) => tab.id === state.activeId);
  const orderedTabs = active
    ? [active, ...state.tabs.filter((tab) => tab.id !== active.id)]
    : state.tabs;
  return orderedTabs.map(projectTabLaunchPath);
}
