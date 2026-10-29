import { documentDirectory, documentRelationships } from "./types.ts";
import { projectMapFor, projectMapOpeningFocus } from "./projectMapNavigation.ts";
import { HelpOnly } from "./components/InterfaceHelp";
import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  closeProject,
  browserFixtureActive,
  chooseRegion,
  createProjectWindow,
  initializeRegion,
  listProjectDirectory,
  loadStartupRegions,
  openRegions,
  openSshRegion,
  presentReaderWindow,
  reconcileReaderWindows,
  refreshProject,
  invalidateDocumentationQc,
  reloadProject,
  relaunchRegions,
  takePendingOpenRegions,
  updateReaderWindowScale,
  updateWindowSession,
} from "./api";
import { ControlBar } from "./components/ControlBar";
import { ProjectFilesView } from "./components/ProjectFilesView";
import { ProjectMapView } from "./components/ProjectMapView";
import { useTimelineHistory } from "./useTimelineHistory";
import { useStructureMetrics } from "./useStructureMetrics";
import { useWorkspaceReload } from "./workspaceReload";
import { RegionOverview } from "./components/RegionOverview";
import { ProjectTabs } from "./components/ProjectTabs";
import { SshOpenDialog } from "./components/SshOpenDialog";
import { WorkspaceSplitView } from "./components/WorkspaceSplitView";
import { CloseIcon, FolderIcon, MindflowMark } from "./components/Icons";
import { buildRelationshipContext } from "./inspection";
import {
  createDefaultPresentationPreferences,
  loadPresentationPreferences,
  normalizeInterfaceScale,
  reconcilePresentationPreferences,
  savePresentationPreferences,
  stepInterfaceScale,
  type StructureNavigationPreferences,
} from "./presentationPreferences";
import type { ReaderNavigationMode } from "./readerNavigation";
import {
  projectFilesAncestorPaths as expandedParentPaths,
  projectFilesNavigationIndex,
  type ProjectMapNavigationRequest,
} from "./projectFilesNavigation";
import { listenForWorkspaceReaderEvents } from "./readerWindowEvents";
import {
  clearProjectTabOpenError,
  closeProjectTab,
  emptyProjectTabState,
  mergeProjectTabs,
  isSshProjectRoot,
  projectTabCanRefresh,
  projectTabDomId,
  projectTabFromResponse,
  projectTabLaunchPath,
  projectTabPanelDomId,
  projectTabRelaunchPaths,
  replaceProjectTab,
  type ProjectTab,
} from "./projectTabs";
import type {
  FolderResponse,
  InspectionTarget,
  GraphData,
  OpenRegionResponse,
  RegionResponse,
} from "./types";
import { CURRENT_PROJECT_FORMAT } from "./types";

const unregisteredGraph: GraphData = {
  format: CURRENT_PROJECT_FORMAT, structure: {nodes: [],relationships: []}, documents: [],
  historical_components: {}, relationship_types: {}, anchor_connection_types: {}, events: [], anchors: {},
};
const TimelineView = lazy(() =>
  import("./components/TimelineView").then((module) => ({
    default: module.TimelineView,
  })),
);
const DocumentationQcView = lazy(() => import("./components/DocumentationQcView")
  .then((module) => ({ default: module.DocumentationQcView })));
let startupRegionsRequest: Promise<OpenRegionResponse[][]> | undefined;

function requestStartupRegions(): Promise<OpenRegionResponse[][]> {
  startupRegionsRequest ??= loadStartupRegions();
  return startupRegionsRequest;
}

function defaultDocumentPath(response: RegionResponse): string {
  return (
    response.graph.documents.find((document) => document.index)?.path ??
    response.graph.documents[0]?.path ??
    ""
  );
}

function LoadingScreen() {
  return (
    <main className="centered-state">
      <div className="loading-orbit" aria-hidden="true"><span /></div>
      <h1>Opening Mindflow</h1>
    </main>
  );
}

function EmptyRegionScreen({
  error,
  opening,
  onOpen,
  onOpenSsh,
}: {
  error?: string;
  opening: boolean;
  onOpen: () => void;
  onOpenSsh?: () => void;
}) {
  return (
    <main className="centered-state centered-state--empty">
      <div className="empty-region-mark" aria-hidden="true">
        <MindflowMark size={44} />
      </div>
      <h1>{error ? "The region could not be opened" : "Open a Mindflow region"}</h1>
      {error ? <p role="alert">{error}</p> : <HelpOnly><p>Choose a project containing MINDFLOW.yaml.</p></HelpOnly>}
      <div className="centered-state__actions">
        <button
          type="button"
          className="primary-button"
          onClick={onOpen}
          disabled={opening}
        >
          <FolderIcon />
          <span>{opening ? "Opening…" : "Open local region"}</span>
        </button>
        {onOpenSsh ? (
          <button
            type="button"
            className="secondary-button"
            onClick={onOpenSsh}
            disabled={opening}
          >
            <span>Open over SSH</span>
          </button>
        ) : null}
      </div>
    </main>
  );
}

function FailedRegionScreen({
  tab,
  opening,
  onRetry,
  onOpen,
}: {
  tab: Extract<ProjectTab, { kind: "error" }>;
  opening: boolean;
  onRetry: () => void;
  onOpen: () => void;
}) {
  return (
    <main className="centered-state centered-state--empty">
      <div className="empty-region-mark empty-region-mark--error" aria-hidden="true">
        <MindflowMark size={44} />
      </div>
      <h1>{tab.label} could not be opened</h1>
      <code className="centered-state__path">{tab.requestedPath}</code>
      <p className="centered-state__diagnostic" role="alert">
        {tab.error}
      </p>
      <div className="centered-state__actions">
        <button
          type="button"
          className="primary-button"
          onClick={onRetry}
          disabled={opening}
        >
          <span>{opening ? "Retrying…" : "Retry"}</span>
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={onOpen}
          disabled={opening}
        >
          <FolderIcon />
          <span>Open another region</span>
        </button>
      </div>
    </main>
  );
}

function InitializeRegionScreen({
  project,
  root,
  remote,
  initializing,
  onInitialize,
}: {
  project: string;
  root: string;
  remote: boolean;
  initializing: boolean;
  onInitialize: () => void;
}) {
  return (
    <section className="centered-state centered-state--empty">
      <div className="empty-region-mark" aria-hidden="true">
        <MindflowMark size={44} />
      </div>
      <h1>{project} has no Mindflow region</h1>
      <code className="centered-state__path" title={root}>{root}</code>
      <HelpOnly><p>
        {remote
          ? "Initialize with the server’s Mindflow CLI to use Structure. Files and Reader are available."
          : "Create MINDFLOW.yaml to use Structure. Files and folders stay unregistered."}
      </p></HelpOnly>
      {!remote ? (
        <button
          type="button"
          className="primary-button"
          onClick={onInitialize}
          disabled={initializing}
        >
          <MindflowMark size={14} />
          <span>
            {initializing
              ? "Initializing Mindflow region…"
              : "Initialize Mindflow"}
          </span>
        </button>
      ) : null}
    </section>
  );
}

function InitializedEmptyRegionScreen() {
  return (
    <section className="centered-state centered-state--empty">
      <div className="empty-region-mark" aria-hidden="true">
        <MindflowMark size={44} />
      </div>
      <h1>No registered files or folders</h1>
      <HelpOnly><p>
        Browse with Files or register files and folders to populate Structure.
      </p></HelpOnly>
    </section>
  );
}

interface WorkspaceHandle {
  refresh: () => Promise<void>;
  reload: () => Promise<void>;
}

interface FolderWorkspaceProps {
  tab: Extract<ProjectTab, { kind: "folder" }>;
  onInitialized: (tabId: string, region: RegionResponse) => void;
  onInterfaceScaleChange: (tabId: string, scale: number) => void;
  onRefreshingChange: (tabId: string, refreshing: boolean) => void;
  onRelaunch: () => Promise<void>;
}

const FolderWorkspace = forwardRef<
  WorkspaceHandle,
  FolderWorkspaceProps
>(function FolderWorkspace(
  {
    tab,
    onInitialized,
    onInterfaceScaleChange,
    onRefreshingChange,
    onRelaunch,
  },
  ref,
) {
  const [presentationPreferences, setPresentationPreferences] = useState(() =>
    loadPresentationPreferences(tab.root, unregisteredGraph),
  );
  const [initializing, setInitializing] = useState(false);
  const [error, setError] = useState<string>();
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const ignore = useCallback(() => {}, []);
  const { interfaceScale, files } =
    presentationPreferences;

  useEffect(() => {
    savePresentationPreferences(tab.root, presentationPreferences);
  }, [presentationPreferences, tab.root]);

  useEffect(() => {
    onInterfaceScaleChange(tab.id, interfaceScale);
    void updateReaderWindowScale(tab.root, interfaceScale).catch(
      (scaleError: unknown) => setError(errorMessage(scaleError)),
    );
  }, [interfaceScale, onInterfaceScaleChange, tab.id, tab.root]);

  useEffect(() => {
    if (browserFixtureActive) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenForWorkspaceReaderEvents(
      (event) => {
        if (event.root !== tab.root) return;
        setPresentationPreferences((current) => {
          const expandedPaths = new Set(current.files.expandedPaths);
          for (const path of expandedParentPaths(event.path)) {
            expandedPaths.add(path);
          }
          return {
            ...current,
            files: {
              ...current.files,
              expandedPaths,
              selectedPath: event.path,
            },
          };
        });
      },
      () => {},
    )
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      })
      .catch((listenerError: unknown) => {
        if (!disposed) setError(errorMessage(listenerError));
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [tab.root]);

  const changeInterfaceScale = useCallback(
    (change: "decrease" | "increase" | "reset") => {
      setPresentationPreferences((current) => ({
        ...current,
        interfaceScale:
          change === "reset"
            ? 1
            : stepInterfaceScale(
                current.interfaceScale,
                change === "increase" ? 1 : -1,
              ),
      }));
    },
    [],
  );

  const initialize = useCallback(async () => {
    if (initializing) return;
    setInitializing(true);
    setError(undefined);
    try {
      onInitialized(tab.id, await initializeRegion(tab.root));
    } catch (initializationError) {
      setError(errorMessage(initializationError));
    } finally {
      setInitializing(false);
    }
  }, [initializing, onInitialized, tab.id, tab.root]);

  const reconstruct = useWorkspaceReload(
    async (activateSynchronizedBuild: boolean) => {
      try {
        const response = activateSynchronizedBuild
          ? await refreshProject(tab.root)
          : await reloadProject(tab.root);
        if (response.action === "relaunch") {
          await onRelaunch();
          return;
        }
        if (response.action === "region") {
          onInitialized(tab.id, response.region);
          return;
        }
        setError(undefined);
        setRefreshGeneration((current) => current + 1);
        void reconcileReaderWindows(response.root).catch(
          (readerError: unknown) => setError(errorMessage(readerError)),
        );
      } catch (refreshError) {
        setRefreshGeneration((current) => current + 1);
        setError(errorMessage(refreshError));
      }
    },
    (refreshing) => onRefreshingChange(tab.id, refreshing),
  );

  const refresh = useCallback(() => reconstruct(true), [reconstruct]);
  const reload = useCallback(() => reconstruct(false), [reconstruct]);

  useImperativeHandle(ref, () => ({ refresh, reload }), [refresh, reload]);

  const selectProjectFile = useCallback(
    (path: string, mode: ReaderNavigationMode = "same-reader") => {
      setPresentationPreferences((current) => ({
        ...current,
        files: { ...current.files, selectedPath: path },
      }));
      void presentReaderWindow(tab.root, path, interfaceScale, mode).catch(
        (readerError: unknown) => setError(errorMessage(readerError)),
      );
    },
    [interfaceScale, tab.root],
  );

  const updateFilesExpandedPaths = useCallback((expandedPaths: Set<string>) => {
    setPresentationPreferences((current) => ({
      ...current,
      files: { ...current.files, expandedPaths },
    }));
  }, []);

  const updateFilesScrollTop = useCallback((scrollTop: number) => {
    setPresentationPreferences((current) => ({
      ...current,
      files: { ...current.files, scrollTop },
    }));
  }, []);

  const updateFilesSidebarWidth = useCallback((sidebarWidth: number) => {
    setPresentationPreferences((current) => ({
      ...current,
      files: { ...current.files, sidebarWidth },
    }));
  }, []);

  return (
    <div className="app-shell">
      {error ? (
        <div className="app-alert" role="alert">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(undefined)}
            aria-label="Dismiss folder workspace error"
          >
            <CloseIcon />
          </button>
        </div>
      ) : null}
      <div className="workspace">
        <main className="map-workspace" aria-label="Unregistered project folder">
          <ControlBar
            regionAvailable={false}
            regionOverviewOpen={false}
            interfaceScale={interfaceScale}
            onInterfaceScaleChange={changeInterfaceScale}
            onToggleRegionOverview={ignore}
          />
          <WorkspaceSplitView
            files={
              <ProjectFilesView
                root={tab.root}
                project={tab.label}
                graph={unregisteredGraph}
                refreshGeneration={refreshGeneration}
                expandedPaths={files.expandedPaths}
                selectedPath={files.selectedPath}
                scrollTop={files.scrollTop}
                onExpandedPathsChange={updateFilesExpandedPaths}
                onScrollTopChange={updateFilesScrollTop}
                onSelect={selectProjectFile}
              />
            }
            filesWidth={files.sidebarWidth}
            onFilesWidthChange={updateFilesSidebarWidth}
          >
            <InitializeRegionScreen
              project={tab.label}
              root={tab.root}
              remote={isSshProjectRoot(tab.root)}
              initializing={initializing}
              onInitialize={() => void initialize()}
            />
          </WorkspaceSplitView>
        </main>
      </div>
    </div>
  );
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface RegionWorkspaceProps {
  tabId: string;
  initialRegion: RegionResponse;
  openError?: string;
  openErrorVersion?: number;
  opening: boolean;
  onOpenRegion: () => void;
  onInterfaceScaleChange: (tabId: string, scale: number) => void;
  onRefreshingChange: (tabId: string, refreshing: boolean) => void;
  onRelaunch: () => Promise<void>;
  onUnregistered: (tabId: string, folder: FolderResponse) => void;
  onValidated: () => void;
}

const RegionWorkspace = forwardRef<
  WorkspaceHandle,
  RegionWorkspaceProps
>(function RegionWorkspace({
  tabId,
  initialRegion,
  openError,
  openErrorVersion,
  opening,
  onOpenRegion,
  onInterfaceScaleChange,
  onRefreshingChange,
  onRelaunch,
  onUnregistered,
  onValidated,
}, ref) {
  const [region, setRegion] = useState(initialRegion);
  const graph = region.graph;
  const snapshotId = region.status.snapshot.id;
  const [measurementGeneration, setMeasurementGeneration] = useState(1);
  const [filesGeneration, setFilesGeneration] = useState(1);
  const [regionError, setRegionError] = useState<string>();
  const [selectedPath, setSelectedPath] = useState(() =>
    defaultDocumentPath(initialRegion),
  );
  const [inspectionFocusPath, setInspectionFocusPath] =
    useState(() => defaultDocumentPath(initialRegion));
  const [hoveredInspection, setHoveredInspection] = useState<InspectionTarget>();
  const [presentationPreferences, setPresentationPreferences] = useState(() =>
    reconcilePresentationPreferences(
      loadPresentationPreferences(
        initialRegion.root,
        initialRegion.graph,
      ),
      initialRegion.graph,
    ),
  );
  const {
    interfaceScale,
    structure: structureNavigation,
    structureMetrics,
    expandedEvents,
    evolveInspectorHeight,
    evolveRailWidth,
    files,
  } = presentationPreferences;
  const metrics = useStructureMetrics(region.root, snapshotId, measurementGeneration,
    structureMetrics.enabled, structureMetrics.commits);
  const filesNavigationIndex = useMemo(
    () => projectFilesNavigationIndex(projectMapFor(graph)),
    [projectMapFor(graph)],
  );
  const [mapNavigationRequest, setMapNavigationRequest] =
    useState<ProjectMapNavigationRequest>();
  const [navigationHover, setNavigationHover] = useState<{
    source: "map" | "files";
    componentId: string;
    expandedRegion?: boolean;
  }>();
  const hoverMapComponent = useCallback((componentId?: string, expandedRegion = false) => {
    setNavigationHover((current) => componentId
      ? current?.source === "map" && current.componentId === componentId &&
          current.expandedRegion === expandedRegion
        ? current : { source: "map", componentId, expandedRegion }
      : current?.source === "map" ? undefined : current);
  }, []);
  const hoverFilePath = useCallback((path?: string) => {
    const componentId = path === undefined
      ? undefined : filesNavigationIndex.componentIdByPath.get(path);
    setNavigationHover((current) => componentId
      ? current?.source === "files" && current.componentId === componentId
        ? current : { source: "files", componentId }
      : current?.source === "files" ? undefined : current);
  }, [filesNavigationIndex]);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const timelineHistory = useTimelineHistory(region, timelineOpen);
  const [qcOpen, setQcOpen] = useState(false);
  const workspaceElement = useRef<HTMLDivElement>(null);
  const navigateFromFiles = useCallback((path: string) => {
    const focusId = filesNavigationIndex.focusIdByDirectory.get(path);
    if (!focusId) return;
    setNavigationHover(undefined);
    // Files browsing remains available without dismissing Evolve or moving
    // the covered Structure canvas. The user explicitly closes that layer.
    if (timelineOpen || qcOpen) return;
    setMapNavigationRequest((current) => ({
      focusId,
      revision: (current?.revision ?? 0) + 1,
    }));
  }, [filesNavigationIndex, timelineOpen, qcOpen]);
  const [regionOverviewOpen, setRegionOverviewOpen] = useState(false);
  const [structureToolbarHost, setStructureToolbarHost] =
    useState<HTMLDivElement | null>(null);

  useEffect(() => {
    setRegionError(openError);
  }, [openError, openErrorVersion]);

  useEffect(() => {
    savePresentationPreferences(region.root, presentationPreferences);
  }, [presentationPreferences, region.root]);

  useEffect(() => {
    onInterfaceScaleChange(tabId, interfaceScale);
    void updateReaderWindowScale(region.root, interfaceScale).catch(
      (error: unknown) => setRegionError(errorMessage(error)),
    );
  }, [interfaceScale, onInterfaceScaleChange, region.root, tabId]);

  const acceptRegion = useCallback(
    (response: RegionResponse, preservePresentation: boolean) => {
      const fallbackPath = defaultDocumentPath(response);
      const isManaged = (path: string) =>
        response.graph.documents.some((document) => document.path === path);
      setRegion(response);
      setMeasurementGeneration((current) => current + 1);
      setRegionError(undefined);
      setHoveredInspection(undefined);
      setNavigationHover(undefined);
      setMapNavigationRequest(undefined);
      if (!preservePresentation) setTimelineOpen(false);
      setSelectedPath((current) =>
        preservePresentation && isManaged(current) ? current : fallbackPath,
      );
      setInspectionFocusPath((current) =>
        preservePresentation && isManaged(current) ? current : fallbackPath,
      );
      setPresentationPreferences((current) =>
        preservePresentation
          ? reconcilePresentationPreferences(
              current,
              response.graph,
            )
          : createDefaultPresentationPreferences(response.graph),
      );
      if (!preservePresentation) {
        setRegionOverviewOpen(false);
      }
    },
    [],
  );

  const currentRoot = region.root;
  const changeInterfaceScale = useCallback(
    (change: "decrease" | "increase" | "reset") => {
      setPresentationPreferences((current) => ({
        ...current,
        interfaceScale:
          change === "reset"
            ? 1
            : stepInterfaceScale(
                current.interfaceScale,
                change === "increase" ? 1 : -1,
              ),
      }));
    },
    [],
  );
  const reconstruct = useWorkspaceReload(async (activateSynchronizedBuild: boolean) => {
    try {
      const response = activateSynchronizedBuild
        ? await refreshProject(currentRoot)
        : await reloadProject(currentRoot);
      if (response.action === "relaunch") {
        await onRelaunch();
        return;
      }
      if (response.action === "folder") {
        onUnregistered(tabId, response);
        return;
      }
      // The file browser can include entries outside the managed snapshot.
      // Refocus checks those entries without discarding unchanged charts or
      // navigation. Snapshot identity includes registered content and Git HEAD.
      setFilesGeneration((current) => current + 1);
      if (activateSynchronizedBuild || response.region.root !== currentRoot ||
          response.region.status.snapshot.id !== snapshotId) {
        invalidateDocumentationQc(currentRoot);
        acceptRegion(response.region, true);
      }
      setRegionError(undefined);
      void reconcileReaderWindows(
        response.region.root,
        response.region.status.snapshot.id,
      ).catch(
        (error: unknown) => setRegionError(errorMessage(error)),
      );
      onValidated();
    } catch (error) {
      setRegionError(error instanceof Error ? error.message : String(error));
    }
  }, (refreshing) => onRefreshingChange(tabId, refreshing));

  const refresh = useCallback(() => reconstruct(true), [reconstruct]);
  const reload = useCallback(() => reconstruct(false), [reconstruct]);

  useImperativeHandle(
    ref,
    () => ({ refresh, reload }),
    [refresh, reload],
  );

  const allTypes = useMemo(
    () => new Set(graph ? Object.keys(graph.relationship_types) : []),
    [graph],
  );
  const documentByPath = useMemo(
    () => new Map(graph?.documents.map((document) => [document.path, document])),
    [graph],
  );
  const selectedDocument = documentByPath.get(selectedPath);
  const focusRelationshipContext = useMemo(
    () =>
      graph
        ? buildRelationshipContext(
            graph,
            inspectionFocusPath,
            allTypes,
            true,
          )
        : {
            focusPath: inspectionFocusPath,
            documentPaths: new Set([inspectionFocusPath]),
            externalKeys: new Set<string>(),
            relationshipIndexes: new Set<number>(),
          },
    [allTypes, graph, inspectionFocusPath],
  );

  const handleInspect = useCallback(
    (target?: InspectionTarget) => {
      setHoveredInspection(target);
      if (!target || !graph) return;
      if (target.kind === "document") {
        if (target.path !== focusRelationshipContext.focusPath) {
          setInspectionFocusPath(target.path);
        }
        return;
      }
      if (focusRelationshipContext.relationshipIndexes.has(target.index)) return;
      const relationship = documentRelationships(graph)[target.index];
      if (relationship) setInspectionFocusPath(relationship.source);
    },
    [focusRelationshipContext, graph],
  );

  useEffect(() => {
    if (browserFixtureActive) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenForWorkspaceReaderEvents(
      (event) => {
        if (event.root !== region.root) return;
        setPresentationPreferences((current) => {
          const expandedPaths = new Set(current.files.expandedPaths);
          for (const path of expandedParentPaths(event.path)) {
            expandedPaths.add(path);
          }
          return {
            ...current,
            files: {
              ...current.files,
              expandedPaths,
              selectedPath: event.path,
            },
          };
        });
        if (
          region.graph.documents.some(
            (document) => document.path === event.path,
          )
        ) {
          setSelectedPath(event.path);
          setInspectionFocusPath(event.path);
          setHoveredInspection(undefined);
        }
      },
      (event) => {
        if (event.root === region.root) {
          handleInspect(event.target ?? undefined);
        }
      },
    )
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      })
      .catch((error: unknown) => {
        if (!disposed) setRegionError(errorMessage(error));
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [handleInspect, region.graph.documents, region.root]);

  const selectDocument = useCallback(
    (path: string, mode: ReaderNavigationMode = "same-reader") => {
      setSelectedPath(path);
      setInspectionFocusPath(path);
      setHoveredInspection(undefined);
      void presentReaderWindow(
        region.root,
        path,
        interfaceScale,
        mode,
        undefined,
        snapshotId,
      ).catch((error: unknown) => setRegionError(errorMessage(error)));
    },
    [interfaceScale, region.root, snapshotId],
  );

  const selectProjectFile = useCallback(
    (path: string, mode: ReaderNavigationMode = "same-reader") => {
      setPresentationPreferences((current) => ({
        ...current,
        files: { ...current.files, selectedPath: path },
      }));
      if (documentByPath.has(path)) {
        setSelectedPath(path);
        setInspectionFocusPath(path);
        setHoveredInspection(undefined);
      }
      void presentReaderWindow(
        region.root,
        path,
        interfaceScale,
        mode,
        undefined,
        snapshotId,
      ).catch((error: unknown) => setRegionError(errorMessage(error)));
    },
    [documentByPath, interfaceScale, region.root, snapshotId],
  );

  const openExternalPath = useCallback(
    (path: string) => {
      const showInFiles = (directory: boolean) => {
        setPresentationPreferences((current) => {
          const expandedPaths = new Set(current.files.expandedPaths);
          for (const parent of expandedParentPaths(path)) {
            expandedPaths.add(parent);
          }
          if (directory) expandedPaths.add(path);
          return {
            ...current,
            files: {
              ...current.files,
              expandedPaths,
              selectedPath: directory ? "" : path,
            },
          };
        });
      };

      void listProjectDirectory(region.root, path)
        .then(() => showInFiles(true))
        .catch(() => {
          showInFiles(false);
          void presentReaderWindow(
            region.root,
            path,
            interfaceScale,
            "same-reader",
            undefined,
            snapshotId,
          ).catch((error: unknown) => setRegionError(errorMessage(error)));
        });
    },
    [interfaceScale, region.root, snapshotId],
  );

  const updateFilesExpandedPaths = useCallback((expandedPaths: Set<string>) => {
    setPresentationPreferences((current) => ({
      ...current,
      files: { ...current.files, expandedPaths },
    }));
  }, []);

  const updateFilesScrollTop = useCallback((scrollTop: number) => {
    setPresentationPreferences((current) =>
      current.files.scrollTop === scrollTop
        ? current
        : {
            ...current,
            files: { ...current.files, scrollTop },
          },
    );
  }, []);

  const updateFilesSidebarWidth = useCallback((sidebarWidth: number) => {
    setPresentationPreferences((current) => ({
      ...current,
      files: { ...current.files, sidebarWidth },
    }));
  }, []);

  const toggleStructureMetrics = useCallback(() => {
    setPresentationPreferences((current) => ({
      ...current,
      structureMetrics: { ...current.structureMetrics, enabled: !current.structureMetrics.enabled },
    }));
  }, []);

  const updateStructureMetricsCommits = useCallback((commits: number) => {
    setPresentationPreferences((current) => ({
      ...current,
      structureMetrics: { ...current.structureMetrics, commits },
    }));
  }, []);

  const updateExpandedEvents = useCallback((expandedEvents: string[]) => {
    setPresentationPreferences(current => ({ ...current, expandedEvents }));
  }, []);

  const updateEvolveInspectorHeight = useCallback((evolveInspectorHeight: number) => {
    setPresentationPreferences(current => ({ ...current, evolveInspectorHeight }));
  }, []);

  const updateEvolveRailWidth = useCallback((evolveRailWidth: number) => {
    setPresentationPreferences(current => ({ ...current, evolveRailWidth }));
  }, []);

  const updateStructureNavigation = useCallback(
    (structure: StructureNavigationPreferences) => {
      setPresentationPreferences((current) => ({
        ...current,
        structure: {
          focusId: structure.focusId,
          depthsByFocusId: new Map(structure.depthsByFocusId),
          reversedLayoutFocusIds: new Set(
            structure.reversedLayoutFocusIds,
          ),
        },
      }));
    },
    [],
  );

  const toggleQc = useCallback(() => {
    setQcOpen((current) => !current);
    workspaceElement.current?.querySelector<HTMLButtonElement>("[data-qc-toggle]")?.focus();
  }, []);

  const showStructure = useCallback(() => {
    setQcOpen(false);
    setTimelineOpen(false);
    setRegionOverviewOpen(false);
    workspaceElement.current?.querySelector<HTMLButtonElement>("[data-structure-toggle]")?.focus();
  }, []);

  const goToStructureHome = useCallback(() => {
    showStructure();
    setNavigationHover(undefined);
    setMapNavigationRequest(current => ({
      focusId: projectMapFor(graph).root,
      depth: 1,
      fitGraph: true,
      revision: (current?.revision ?? 0) + 1,
    }));
  }, [graph, showStructure]);

  const focusOpening = useCallback(() => {
    const target = projectMapOpeningFocus(projectMapFor(graph), region.opening);
    if (!target) return;
    showStructure();
    setNavigationHover(undefined);
    setMapNavigationRequest(current => ({ ...target, revision: (current?.revision ?? 0) + 1 }));
  }, [graph, region.opening, showStructure]);

  const openEvolve = useCallback(() => {
    setQcOpen(false);
    setRegionOverviewOpen(false);
    setTimelineOpen(true);
  }, []);

  const regionIsEmpty = !graph.structure.nodes.some((node) => node.component);
  if (graph.documents.length > 0 && !selectedDocument) {
    return (
      <EmptyRegionScreen
        error="The selected document is no longer managed. Reopen the region to form a current graph."
        opening={opening}
        onOpen={onOpenRegion}
      />
    );
  }

  return (
    <div className="app-shell" ref={workspaceElement}>
      {regionError ? (
        <div className="app-alert" role="alert">
          <span>{regionError}</span>
          <button
            type="button"
            onClick={() => setRegionError(undefined)}
            aria-label="Dismiss error"
          >
            <CloseIcon />
          </button>
        </div>
      ) : null}

      <div className="workspace">
        <main
          className="map-workspace"
          aria-label="Mindflow Structure workspace"
        >
          <ControlBar
            hasOpening={region.opening.files.length > 0}
            regionOverviewOpen={regionOverviewOpen}
            interfaceScale={interfaceScale}
            timelineAvailable={
              timelineOpen || graph.events.length > 0 || region.opening.files.length > 0 || Object.keys(graph.anchors).length > 0
            }
            timelineOpen={timelineOpen && !qcOpen}
            qcOpen={qcOpen}
            onToggleQc={toggleQc}
            onStructureToolbarHost={setStructureToolbarHost}
            onInterfaceScaleChange={changeInterfaceScale}
            onStructureHome={goToStructureHome}
            onFocusOpening={focusOpening}
            onOpenEvolve={openEvolve}
            onToggleRegionOverview={() =>
              setRegionOverviewOpen((current) => !current)
            }
          />
          <WorkspaceSplitView
            files={
              <ProjectFilesView
                root={region.root}
                project={region.project}
                graph={graph}
                refreshGeneration={filesGeneration}
                expandedPaths={files.expandedPaths}
                selectedPath={files.selectedPath}
                scrollTop={files.scrollTop}
                activeDirectoryPath={filesNavigationIndex.pathByComponentId.get(structureNavigation.focusId)}
                navigableDirectories={filesNavigationIndex.focusIdByDirectory}
                hoveredPath={navigationHover?.source === "map"
                  ? filesNavigationIndex.pathByComponentId.get(navigationHover.componentId)
                  : undefined}
                expandHoveredDirectory={navigationHover?.source === "map" && navigationHover.expandedRegion}
                onHoverPath={hoverFilePath}
                onNavigateDirectory={navigateFromFiles}
                onExpandedPathsChange={updateFilesExpandedPaths}
                onScrollTopChange={updateFilesScrollTop}
                onSelect={selectProjectFile}
              />
            }
            filesWidth={files.sidebarWidth}
            onFilesWidthChange={updateFilesSidebarWidth}
          >
            <div className="structure-regional-workspace">
              <div
                className="structure-canvas-layer"
                aria-hidden={timelineOpen || qcOpen || undefined}
                inert={timelineOpen || qcOpen || undefined}
              >
                {regionIsEmpty ? (
                  <InitializedEmptyRegionScreen />
                ) : (
                  <ProjectMapView
                    metricsEnabled={structureMetrics.enabled}
                    metricsCommits={structureMetrics.commits}
                    metricsReport={metrics.report}
                    metricsError={metrics.error}
                    metricsLoading={metrics.loading}
                    onToggleMetrics={toggleStructureMetrics}
                    onMetricsCommitsChange={updateStructureMetricsCommits}
                    onRetryMetrics={metrics.retry}
                    graph={graph}
                    opening={region.opening}
                    selectedPath={selectedPath}
                    structureNavigation={structureNavigation}
                    navigationRequest={mapNavigationRequest}
                    hoveredComponentId={navigationHover?.source === "files"
                      ? navigationHover.componentId : undefined}
                    onHoverComponent={hoverMapComponent}
                    toolbarHost={structureToolbarHost}
                    onStructureNavigationChange={updateStructureNavigation}
                    onSelect={selectProjectFile}
                    onOpenExternalPath={openExternalPath}
                  />
                )}
              </div>
              {timelineOpen ? (
                <section
                  className="structure-timeline-layer"
                  aria-label="Evolve workspace"
                  aria-hidden={qcOpen || undefined}
                  inert={qcOpen || undefined}
                >
                  <Suspense
                    fallback={
                      <div className="workspace-layer-loading" role="status">
                        Forming Evolve…
                      </div>
                    }
                  >
                    <TimelineView
                      graph={graph}
                      opening={region.opening}
                      anchorTimeline={region.anchor_timeline}
                      commits={timelineHistory.commits}
                      historyLoading={timelineHistory.loading}
                      historyError={timelineHistory.error}
                      onRetryHistory={timelineHistory.retry}
                      root={region.root}
                      snapshot={snapshotId}
                      expandedEvents={expandedEvents}
                      onExpandedEventsChange={updateExpandedEvents}
                      railWidth={evolveRailWidth}
                      onRailWidthChange={updateEvolveRailWidth}
                      inspectorHeight={evolveInspectorHeight}
                      onInspectorHeightChange={updateEvolveInspectorHeight}
                      onSelect={selectDocument}
                      onClose={showStructure}
                    />
                  </Suspense>
                </section>
              ) : null}
              {qcOpen ? (
                <div className="structure-qc-layer">
                  <Suspense fallback={<div className="workspace-layer-loading" role="status">Opening Documentation QC…</div>}>
                    <DocumentationQcView root={region.root} snapshot={snapshotId} generation={measurementGeneration}
                      onClose={toggleQc} onRead={selectProjectFile} />
                  </Suspense>
                </div>
              ) : null}
            </div>
          </WorkspaceSplitView>
        </main>
      </div>

      {regionOverviewOpen ? (
        <RegionOverview
          region={region}
          onClose={() => setRegionOverviewOpen(false)}
        />
      ) : null}
    </div>
  );
});

export default function App() {
  const [tabState, setTabState] = useState(() => ({
    ...emptyProjectTabState,
  }));
  const [initializing, setInitializing] = useState(true);
  const [opening, setOpening] = useState(false);
  const [sshDialogOpen, setSshDialogOpen] = useState(false);
  const [sshError, setSshError] = useState<string>();
  const [creatingWindow, setCreatingWindow] = useState(false);
  const [refreshingTabIds, setRefreshingTabIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [appError, setAppError] = useState<string>();
  const [interfaceScaleByTab, setInterfaceScaleByTab] = useState<
    Map<string, number>
  >(() => new Map());
  const openRequestQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activeWorkspaceRef = useRef<WorkspaceHandle>(null);

  useEffect(() => {
    const activeTab = tabState.tabs.find(
      (tab) => tab.id === tabState.activeId,
    );
    void updateWindowSession(
      projectTabRelaunchPaths(tabState),
      activeTab?.label,
    ).catch((error: unknown) => setAppError(errorMessage(error)));
  }, [tabState.activeId, tabState.tabs]);

  const acceptResponses = useCallback((responses: OpenRegionResponse[]) => {
    const tabs = responses.map(projectTabFromResponse);
    setTabState((current) => mergeProjectTabs(current, tabs));
  }, []);

  const replaceTabFromResponse = useCallback(
    (tabId: string, response: OpenRegionResponse) => {
      const replacement = projectTabFromResponse(response);
      setTabState((current) => replaceProjectTab(current, tabId, replacement));
    },
    [],
  );

  const acceptInitializedRegion = useCallback(
    (tabId: string, region: RegionResponse) => {
      replaceTabFromResponse(tabId, { status: "region", region });
    },
    [replaceTabFromResponse],
  );

  const acceptUnregisteredFolder = useCallback(
    (tabId: string, folder: FolderResponse) => {
      void reconcileReaderWindows(folder.root).catch((error: unknown) =>
        setAppError(errorMessage(error)),
      );
      replaceTabFromResponse(tabId, { status: "folder", ...folder });
    },
    [replaceTabFromResponse],
  );

  const queuePendingOpenRequests = useCallback(() => {
    openRequestQueueRef.current = openRequestQueueRef.current
      .then(async () => {
        const batches = await takePendingOpenRegions();
        for (const responses of batches) {
          acceptResponses(responses);
        }
      })
      .catch((error: unknown) => setAppError(errorMessage(error)));
  }, [acceptResponses]);

  useEffect(() => {
    let active = true;
    let pendingRequestPoll: number | undefined;

    void (async () => {
      try {
        const batches = await requestStartupRegions();
        if (active) {
          for (const responses of batches) acceptResponses(responses);
        }
      } catch (error) {
        if (active) setAppError(errorMessage(error));
      } finally {
        if (active) {
          setInitializing(false);
          queuePendingOpenRequests();
          // The single-instance callback only appends to the authoritative
          // backend queue so it can immediately accept the next launch.
          pendingRequestPoll = window.setInterval(
            queuePendingOpenRequests,
            1_000,
          );
        }
      }
    })();

    return () => {
      active = false;
      if (pendingRequestPoll !== undefined) {
        window.clearInterval(pendingRequestPoll);
      }
    };
  }, [acceptResponses, queuePendingOpenRequests]);

  const openRegion = useCallback(async () => {
    setOpening(true);
    setAppError(undefined);
    try {
      const response = await chooseRegion();
      if (response) acceptResponses([response]);
    } catch (error) {
      setAppError(errorMessage(error));
    } finally {
      setOpening(false);
    }
  }, [acceptResponses]);

  const showSshDialog = useCallback(() => {
    setSshError(undefined);
    setSshDialogOpen(true);
  }, []);

  const closeSshDialog = useCallback(() => {
    if (!opening) setSshDialogOpen(false);
  }, [opening]);

  const clearSshError = useCallback(() => setSshError(undefined), []);

  const openRemoteRegion = useCallback(
    async (destination: string, path: string) => {
      setOpening(true);
      setSshError(undefined);
      try {
        acceptResponses([await openSshRegion(destination, path)]);
        setSshDialogOpen(false);
      } catch (error) {
        setSshError(errorMessage(error));
      } finally {
        setOpening(false);
      }
    },
    [acceptResponses],
  );

  const retryTab = useCallback(async (tab: ProjectTab) => {
    setOpening(true);
    setAppError(undefined);
    try {
      const incoming = (await openRegions([projectTabLaunchPath(tab)])).map(
        projectTabFromResponse,
      );
      setTabState((current) =>
        mergeProjectTabs(closeProjectTab(current, tab.id), incoming),
      );
    } catch (error) {
      setAppError(errorMessage(error));
    } finally {
      setOpening(false);
    }
  }, []);

  const newWindow = useCallback(async () => {
    setCreatingWindow(true);
    setAppError(undefined);
    try {
      await createProjectWindow();
    } catch (error) {
      setAppError(errorMessage(error));
    } finally {
      setCreatingWindow(false);
    }
  }, []);

  useEffect(() => {
    const handleNewWindowShortcut = (event: KeyboardEvent) => {
      const primaryModifier =
        navigator.platform.toLowerCase().includes("mac")
          ? event.metaKey
          : event.ctrlKey;
      if (
        primaryModifier &&
        event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "n"
      ) {
        event.preventDefault();
        void newWindow();
      }
    };
    window.addEventListener("keydown", handleNewWindowShortcut);
    return () => window.removeEventListener("keydown", handleNewWindowShortcut);
  }, [newWindow]);

  const relaunchOpenTabs = useCallback(
    () => relaunchRegions(projectTabRelaunchPaths(tabState)),
    [tabState],
  );

  const setTabRefreshing = useCallback(
    (tabId: string, refreshing: boolean) => {
      setRefreshingTabIds((current) => {
        if (current.has(tabId) === refreshing) return current;
        const next = new Set(current);
        if (refreshing) next.add(tabId);
        else next.delete(tabId);
        return next;
      });
    },
    [],
  );

  const refreshActiveRegion = useCallback(() => {
    void activeWorkspaceRef.current?.refresh();
  }, []);

  const reloadActiveRegion = useCallback(() => {
    void activeWorkspaceRef.current?.reload();
  }, []);

  useEffect(() => {
    if (browserFixtureActive) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) reloadActiveRegion();
      })
      .then((dispose) => {
        if (disposed) dispose();
        else unlisten = dispose;
      })
      .catch((error: unknown) => {
        if (!disposed) setAppError(errorMessage(error));
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [reloadActiveRegion]);

  const closeTab = useCallback(
    (tabId: string) => {
      const tab = tabState.tabs.find((candidate) => candidate.id === tabId);
      if (tab?.kind === "region" || tab?.kind === "folder") {
        void closeProject(tab.root).catch((error: unknown) =>
          setAppError(errorMessage(error)),
        );
      }
      setTabState((current) => closeProjectTab(current, tabId));
    },
    [tabState.tabs],
  );

  const recordInterfaceScale = useCallback((tabId: string, scale: number) => {
    setInterfaceScaleByTab((current) => {
      if (current.get(tabId) === scale) return current;
      const next = new Map(current);
      next.set(tabId, scale);
      return next;
    });
  }, []);

  const activeTab = tabState.tabs.find((tab) => tab.id === tabState.activeId);
  const activeInterfaceScale = normalizeInterfaceScale(
    tabState.activeId === undefined
      ? 1
      : (interfaceScaleByTab.get(tabState.activeId) ??
          (activeTab?.kind === "region"
            ? loadPresentationPreferences(
                activeTab.root,
                activeTab.region.graph,
              ).interfaceScale
            : activeTab?.kind === "folder"
              ? loadPresentationPreferences(
                  activeTab.root,
                  unregisteredGraph,
                ).interfaceScale
              : 1)),
  );
  const shellStyle = {
    "--interface-scale": activeInterfaceScale,
    "--interface-shell-height": `${100 / activeInterfaceScale}dvh`,
    "--interface-viewport-width": `${100 / activeInterfaceScale}vw`,
    "--interface-viewport-height": `${100 / activeInterfaceScale}dvh`,
    "--interface-viewport-height-80": `${80 / activeInterfaceScale}dvh`,
  } as CSSProperties;

  return (
    <div className="multi-project-shell" style={shellStyle}>
      <ProjectTabs
        tabs={tabState.tabs}
        activeId={tabState.activeId}
        opening={opening || initializing}
        creatingWindow={creatingWindow}
        canRefresh={projectTabCanRefresh(activeTab)}
        refreshing={
          tabState.activeId !== undefined &&
          refreshingTabIds.has(tabState.activeId)
        }
        onActivate={(activeId) =>
          setTabState((current) => ({ ...current, activeId }))
        }
        onClose={closeTab}
        onOpen={openRegion}
        onOpenSsh={showSshDialog}
        onNewWindow={() => void newWindow()}
        onRefresh={refreshActiveRegion}
      />

      <div className="project-tab-panels">
        {initializing ? <LoadingScreen /> : null}
        {!initializing && tabState.tabs.length === 0 ? (
          <EmptyRegionScreen
            error={appError}
            opening={opening}
            onOpen={openRegion}
            onOpenSsh={showSshDialog}
          />
        ) : null}
        {!initializing
          ? tabState.tabs.map((tab) => (
              <section
                key={tab.id}
                id={projectTabPanelDomId(tab.id)}
                className="project-tab-panel"
                role="tabpanel"
                aria-labelledby={projectTabDomId(tab.id)}
                hidden={tab.id !== tabState.activeId}
              >
                {tab.kind === "region" ? (
                  <RegionWorkspace
                    ref={
                      tab.id === tabState.activeId
                        ? activeWorkspaceRef
                        : undefined
                    }
                    tabId={tab.id}
                    initialRegion={tab.region}
                    openError={tab.openError}
                    openErrorVersion={tab.openErrorVersion}
                    opening={opening}
                    onOpenRegion={openRegion}
                    onInterfaceScaleChange={recordInterfaceScale}
                    onRefreshingChange={setTabRefreshing}
                    onRelaunch={relaunchOpenTabs}
                    onUnregistered={acceptUnregisteredFolder}
                    onValidated={() =>
                      setTabState((current) =>
                        clearProjectTabOpenError(current, tab.id),
                      )
                    }
                  />
                ) : tab.kind === "folder" ? (
                  <FolderWorkspace
                    ref={
                      tab.id === tabState.activeId
                        ? activeWorkspaceRef
                        : undefined
                    }
                    tab={tab}
                    onInitialized={acceptInitializedRegion}
                    onInterfaceScaleChange={recordInterfaceScale}
                    onRefreshingChange={setTabRefreshing}
                    onRelaunch={relaunchOpenTabs}
                  />
                ) : (
                  <FailedRegionScreen
                    tab={tab}
                    opening={opening}
                    onRetry={() => void retryTab(tab)}
                    onOpen={openRegion}
                  />
                )}
              </section>
            ))
          : null}
      </div>

      {appError && tabState.tabs.length > 0 ? (
        <div className="app-alert app-alert--global" role="alert">
          <span>{appError}</span>
          <button
            type="button"
            onClick={() => setAppError(undefined)}
            aria-label="Dismiss error"
          >
            <CloseIcon />
          </button>
        </div>
      ) : null}
      {sshDialogOpen ? (
        <SshOpenDialog
          opening={opening}
          error={sshError}
          onClearError={clearSshError}
          onClose={closeSshDialog}
          onSubmit={openRemoteRegion}
        />
      ) : null}
    </div>
  );
}
