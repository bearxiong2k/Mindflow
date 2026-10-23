import { projectMapFor } from "./projectMapNavigation.ts";
import {
  timelineFoldRangeBetween,
  type TimelineFoldRange,
} from "./openingPresentation.ts";
import {
  MINIMUM_TIMELINE_INSPECTOR_HEIGHT,
  type TimelinePanelLayout,
} from "./timelineInteraction.ts";
import {
  projectMapChildrenByParent,
  projectMapComponentIsAggregate,
  projectMapMaximumDepth,
} from "./projectMapNavigation.ts";
import type { EvolveEvent, GraphData } from "./types.ts";
import { normalizeStructureMetricsCommits } from "./projectMapMetrics.ts";
import {
  DEFAULT_FILES_SIDEBAR_WIDTH,
  normalizeFilesSidebarWidth,
} from "./workspaceSidebar.ts";

export interface FilesNavigationPreferences {
  expandedPaths: Set<string>;
  selectedPath: string;
  scrollTop: number;
  sidebarWidth: number;
}

export interface StructureNavigationPreferences {
  focusId: string;
  depthsByFocusId: Map<string, number>;
  reversedLayoutFocusIds: Set<string>;
}

export interface TimelineFoldPreference {
  startEventName: string;
  endEventName: string;
}

export interface PresentationPreferences {
  interfaceScale: number;
  structure: StructureNavigationPreferences;
  structureMetrics: { enabled: boolean; commits: number };
  timelinePanels: TimelinePanelLayout;
  timelineFolds: TimelineFoldPreference[];
  files: FilesNavigationPreferences;
}

export interface PresentationPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const preferenceVersion = 8;
const storageKeyPrefix = "mindflow:presentation-preferences:v8:";
export const MINIMUM_INTERFACE_SCALE = 0.8;
export const MAXIMUM_INTERFACE_SCALE = 1.4;
export const INTERFACE_SCALE_STEP = 0.1;

interface StoredPresentationPreferences {
  version: typeof preferenceVersion;
  interfaceScale: number;
  structure?: {
    focusId?: string;
    depths?: Array<{ focusId: string; depth: number }>;
    reversedLayoutFocusIds?: string[];
  };
  structureMetrics?: { enabled?: boolean; commits?: number };
  timelinePanels?: TimelinePanelLayout;
  timelineFolds?: Array<{
    startEventName: string;
    endEventName: string;
  }>;
  files?: {
    expandedPaths?: string[];
    selectedPath?: string;
    scrollTop?: number;
    sidebarWidth?: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function storedStructureMetrics(value: unknown): PresentationPreferences["structureMetrics"] {
  const stored = isRecord(value) ? value : {};
  return { enabled: stored.enabled === true, commits: normalizeStructureMetricsCommits(stored.commits) };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function normalizedTimelinePanelHeight(
  value: unknown,
  minimum: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.round(Math.min(4_000, Math.max(minimum, value)) * 10) / 10;
}

function storedTimelinePanelLayout(value: unknown): TimelinePanelLayout {
  const stored = isRecord(value) ? value : {};
  return {
    inspectorHeight: normalizedTimelinePanelHeight(
      stored.inspectorHeight,
      MINIMUM_TIMELINE_INSPECTOR_HEIGHT,
    ),
  };
}

export function timelineFoldPreferenceKey(
  preference: TimelineFoldPreference,
): string {
  return JSON.stringify([
    preference.startEventName,
    preference.endEventName,
  ]);
}

export function timelineFoldPreferenceFromRange(
  range: TimelineFoldRange,
  events: readonly EvolveEvent[],
): TimelineFoldPreference | undefined {
  if (
    !Number.isInteger(range.startEventIndex) ||
    !Number.isInteger(range.endEventIndex) ||
    range.startEventIndex < 0 ||
    range.startEventIndex >= range.endEventIndex ||
    range.endEventIndex >= events.length
  ) {
    return undefined;
  }
  return {
    startEventName: events[range.startEventIndex].name,
    endEventName: events[range.endEventIndex].name,
  };
}

export function reconcileTimelineFoldPreferences(
  current: readonly TimelineFoldPreference[],
  events: readonly EvolveEvent[],
  protectedEventBoundaries: readonly number[] = [],
): TimelineFoldPreference[] {
  const eventIndexes = new Map(
    events.map((event, index) => [event.name, index]),
  );
  const candidates = current.flatMap((preference) => {
    if (
      typeof preference.startEventName !== "string" ||
      typeof preference.endEventName !== "string" ||
      preference.startEventName.length === 0 ||
      preference.endEventName.length === 0
    ) {
      return [];
    }
    const firstIndex = eventIndexes.get(preference.startEventName);
    const secondIndex = eventIndexes.get(preference.endEventName);
    if (
      firstIndex === undefined ||
      secondIndex === undefined ||
      firstIndex === secondIndex
    ) {
      return [];
    }
    const startEventIndex = Math.min(firstIndex, secondIndex);
    const endEventIndex = Math.max(firstIndex, secondIndex);
    return [
      {
        preference: {
          startEventName: events[startEventIndex].name,
          endEventName: events[endEventIndex].name,
        },
        range: { startEventIndex, endEventIndex },
      },
    ];
  }).sort(
    (left, right) =>
      left.range.startEventIndex - right.range.startEventIndex ||
      right.range.endEventIndex - left.range.endEventIndex,
  );

  const accepted: TimelineFoldPreference[] = [];
  const acceptedRanges: TimelineFoldRange[] = [];
  const acceptedKeys = new Set<string>();
  for (const candidate of candidates) {
    const result = timelineFoldRangeBetween(
      {
        startEventIndex: candidate.range.startEventIndex,
        endEventIndex: candidate.range.startEventIndex,
      },
      {
        startEventIndex: candidate.range.endEventIndex,
        endEventIndex: candidate.range.endEventIndex,
      },
      events.length,
      protectedEventBoundaries,
      acceptedRanges,
    );
    const key = timelineFoldPreferenceKey(candidate.preference);
    if (!result.ok || acceptedKeys.has(key)) continue;
    accepted.push(candidate.preference);
    acceptedRanges.push(result.range);
    acceptedKeys.add(key);
  }
  return accepted;
}

export function timelineFoldRangesFromPreferences(
  preferences: readonly TimelineFoldPreference[],
  events: readonly EvolveEvent[],
  protectedEventBoundaries: readonly number[] = [],
): TimelineFoldRange[] {
  const eventIndexes = new Map(
    events.map((event, index) => [event.name, index]),
  );
  return reconcileTimelineFoldPreferences(
    preferences,
    events,
    protectedEventBoundaries,
  ).flatMap((preference) => {
    const startEventIndex = eventIndexes.get(preference.startEventName);
    const endEventIndex = eventIndexes.get(preference.endEventName);
    return startEventIndex === undefined || endEventIndex === undefined
      ? []
      : [{ startEventIndex, endEventIndex }];
  });
}

function storedTimelineFolds(
  value: unknown,
  events: readonly EvolveEvent[],
): TimelineFoldPreference[] {
  if (!Array.isArray(value)) return [];
  const parsed = value.flatMap((entry) =>
    isRecord(entry) &&
      typeof entry.startEventName === "string" &&
      typeof entry.endEventName === "string"
      ? [
          {
            startEventName: entry.startEventName,
            endEventName: entry.endEventName,
          },
        ]
      : [],
  );
  return reconcileTimelineFoldPreferences(parsed, events);
}

function normalizedProjectPath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.startsWith("/")) {
    return undefined;
  }
  const parts = value.split("/");
  if (
    parts.some(
      (part) =>
        part.length === 0 || part === "." || part === ".." || part === ".git",
    )
  ) {
    return undefined;
  }
  return value;
}

function storedFilesNavigation(value: unknown): FilesNavigationPreferences {
  const stored = isRecord(value) ? value : {};
  const expandedPaths = new Set<string>();
  for (const path of stringArray(stored.expandedPaths)) {
    const normalized = normalizedProjectPath(path);
    if (normalized) expandedPaths.add(normalized);
  }
  const selectedPath = normalizedProjectPath(stored.selectedPath) ?? "";
  const scrollTop =
    typeof stored.scrollTop === "number" && Number.isFinite(stored.scrollTop)
      ? Math.round(Math.min(10_000_000, Math.max(0, stored.scrollTop)))
      : 0;
  return {
    expandedPaths,
    selectedPath,
    scrollTop,
    sidebarWidth: normalizeFilesSidebarWidth(stored.sidebarWidth),
  };
}

function structureFocusIds(graph: GraphData) {
  const childrenByParent = projectMapChildrenByParent(
    projectMapFor(graph).components,
  );
  return new Set(
    projectMapFor(graph).components
      .filter(
        (component) =>
          projectMapComponentIsAggregate(component) &&
          (component.id === projectMapFor(graph).root ||
            (childrenByParent.get(component.id)?.length ?? 0) > 0),
      )
      .map((component) => component.id),
  );
}

export function reconcileStructureNavigationPreferences(
  current: StructureNavigationPreferences,
  graph: GraphData,
): StructureNavigationPreferences {
  const childrenByParent = projectMapChildrenByParent(
    projectMapFor(graph).components,
  );
  const validFocusIds = structureFocusIds(graph);
  const focusId = validFocusIds.has(current.focusId)
    ? current.focusId
    : projectMapFor(graph).root;
  const depthsByFocusId = new Map<string, number>();
  for (const [candidateFocusId, candidateDepth] of current.depthsByFocusId) {
    if (
      !validFocusIds.has(candidateFocusId) ||
      typeof candidateDepth !== "number" ||
      !Number.isFinite(candidateDepth)
    ) {
      continue;
    }
    const maximumDepth = projectMapMaximumDepth(
      candidateFocusId,
      childrenByParent,
    );
    const depth = Math.max(
      1,
      Math.min(maximumDepth, Math.round(candidateDepth)),
    );
    if (depth > 1) depthsByFocusId.set(candidateFocusId, depth);
  }
  const reversedLayoutFocusIds = new Set(
    [...current.reversedLayoutFocusIds].filter((candidateFocusId) =>
      validFocusIds.has(candidateFocusId),
    ),
  );
  return { focusId, depthsByFocusId, reversedLayoutFocusIds };
}

function storedStructureNavigation(
  value: unknown,
  graph: GraphData,
): StructureNavigationPreferences {
  const stored = isRecord(value) ? value : {};
  const depthsByFocusId = new Map<string, number>();
  if (Array.isArray(stored.depths)) {
    for (const entry of stored.depths) {
      if (
        isRecord(entry) &&
        typeof entry.focusId === "string" &&
        typeof entry.depth === "number"
      ) {
        depthsByFocusId.set(entry.focusId, entry.depth);
      }
    }
  }
  return reconcileStructureNavigationPreferences(
    {
      focusId:
        typeof stored.focusId === "string"
          ? stored.focusId
          : projectMapFor(graph).root,
      depthsByFocusId,
      reversedLayoutFocusIds: new Set(
        stringArray(stored.reversedLayoutFocusIds),
      ),
    },
    graph,
  );
}

export function normalizeInterfaceScale(value: unknown, fallback = 1): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(
    Math.min(MAXIMUM_INTERFACE_SCALE, Math.max(MINIMUM_INTERFACE_SCALE, value)) *
      10,
  ) / 10;
}

export function stepInterfaceScale(
  current: number,
  direction: -1 | 1,
): number {
  return normalizeInterfaceScale(current + direction * INTERFACE_SCALE_STEP);
}

function localPreferenceStorage(): PresentationPreferenceStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function presentationPreferencesStorageKey(root: string): string {
  return `${storageKeyPrefix}${encodeURIComponent(root)}`;
}

export function createDefaultPresentationPreferences(
  graph: GraphData,
): PresentationPreferences {
  return {
    interfaceScale: 1,
    structure: {
      focusId: projectMapFor(graph).root,
      depthsByFocusId: new Map(),
      reversedLayoutFocusIds: new Set(),
    },
    structureMetrics: { enabled: false, commits: 30 },
    timelinePanels: {},
    timelineFolds: [],
    files: {
      expandedPaths: new Set(),
      selectedPath: "",
      scrollTop: 0,
      sidebarWidth: DEFAULT_FILES_SIDEBAR_WIDTH,
    },
  };
}

export function reconcilePresentationPreferences(
  current: PresentationPreferences,
  graph: GraphData,
  protectedTimelineEventBoundaries: readonly number[] = [],
): PresentationPreferences {
  return {
    ...current,
    structure: reconcileStructureNavigationPreferences(
      current.structure,
      graph,
    ),
    files: {
      ...current.files,
      expandedPaths: new Set(current.files.expandedPaths),
      sidebarWidth: normalizeFilesSidebarWidth(current.files.sidebarWidth),
    },
    structureMetrics: storedStructureMetrics(current.structureMetrics),
    timelineFolds: reconcileTimelineFoldPreferences(
      current.timelineFolds,
      graph.events,
      protectedTimelineEventBoundaries,
    ),
  };
}

export function loadPresentationPreferences(
  root: string,
  graph: GraphData,
  storage = localPreferenceStorage(),
): PresentationPreferences {
  const defaults = createDefaultPresentationPreferences(graph);
  if (!storage) return defaults;

  try {
    const serialized = storage.getItem(presentationPreferencesStorageKey(root));
    if (!serialized) return defaults;
    const value: unknown = JSON.parse(serialized);
    if (
      !isRecord(value) ||
      value.version !== preferenceVersion
    ) {
      return defaults;
    }

    return {
      interfaceScale: normalizeInterfaceScale(
        value.interfaceScale,
        defaults.interfaceScale,
      ),
      structure: storedStructureNavigation(value.structure, graph),
      structureMetrics: storedStructureMetrics(value.structureMetrics),
      timelinePanels: storedTimelinePanelLayout(value.timelinePanels),
      timelineFolds: storedTimelineFolds(value.timelineFolds, graph.events),
      files: storedFilesNavigation(value.files),
    };
  } catch {
    return defaults;
  }
}

export function savePresentationPreferences(
  root: string,
  preferences: PresentationPreferences,
  storage = localPreferenceStorage(),
): void {
  if (!storage) return;

  const value: StoredPresentationPreferences = {
    version: preferenceVersion,
    interfaceScale: normalizeInterfaceScale(preferences.interfaceScale),
    structure: {
      focusId: preferences.structure.focusId,
      depths: [...preferences.structure.depthsByFocusId]
        .filter(
          ([focusId, depth]) =>
            focusId.length > 0 && Number.isFinite(depth) && depth > 1,
        )
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([focusId, depth]) => ({
          focusId,
          depth: Math.round(depth),
        })),
      reversedLayoutFocusIds: [
        ...preferences.structure.reversedLayoutFocusIds,
      ].sort(),
    },
    structureMetrics: storedStructureMetrics(preferences.structureMetrics),
    timelinePanels: {
      inspectorHeight: normalizedTimelinePanelHeight(
        preferences.timelinePanels.inspectorHeight,
        MINIMUM_TIMELINE_INSPECTOR_HEIGHT,
      ),
    },
    timelineFolds: preferences.timelineFolds.map((preference) => ({
      startEventName: preference.startEventName,
      endEventName: preference.endEventName,
    })),
    files: {
      expandedPaths: [...preferences.files.expandedPaths].sort(),
      selectedPath: normalizedProjectPath(preferences.files.selectedPath) ?? "",
      scrollTop: Math.round(
        Math.min(10_000_000, Math.max(0, preferences.files.scrollTop)),
      ),
      sidebarWidth: normalizeFilesSidebarWidth(preferences.files.sidebarWidth),
    },
  };

  try {
    storage.setItem(
      presentationPreferencesStorageKey(root),
      JSON.stringify(value),
    );
  } catch {
    // Presentation preferences are optional; storage failure cannot block a region.
  }
}
