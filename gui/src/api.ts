import { invoke } from "@tauri-apps/api/core";

import type {
  DocumentResponse,
  FolderPickerResponse,
  InspectionTarget,
  OpenRegionResponse,
  ProjectDirectoryResponse,
  ReaderWindowSnapshot,
  RefreshProjectResponse,
  RegionResponse,
} from "./types";
import type { ReaderNavigationMode } from "./readerNavigation";
import type { DesktopVersionInfo } from "./versionInfo";
import { qcSameWindow, type DocumentationQc, type QcHistory, type QcWindow } from "./documentationQc";

const qcRequests = new Map<string, Promise<DocumentationQc>>();
export function loadDocumentationQc(root: string, snapshot: string, window: QcWindow): Promise<DocumentationQc> {
  const key = JSON.stringify([root, snapshot, window]);
  const pending = qcRequests.get(key);
  if (pending) return pending;
  const request = requestDocumentationQc(root, snapshot, window).finally(() => { qcRequests.delete(key); });
  qcRequests.set(key, request);
  return request;
}
async function requestDocumentationQc(root: string, snapshot: string, window: QcWindow): Promise<DocumentationQc> {
  const query = new URLSearchParams(window.kind === "recent"
    ? { commits: String(window.commits) } : { from: window.start, to: window.end });
  const report: DocumentationQc = browserFixtureActive
    ? await fetch(`/__mindflow_fixture_qc?${query}`).then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      })
    : await invoke<DocumentationQc>("documentation_qc", { root, snapshot, window });
  if (report.root !== root || report.snapshot.id !== snapshot
    || report.schema !== "mindflow-documentation-qc/v2" || !qcSameWindow(report.window, window)) {
    throw new Error("QC observation no longer matches this Region. Refresh the project and try again.");
  }
  return report;
}

export async function loadDocumentationQcHistory(root: string, snapshot: string, offset: number): Promise<QcHistory> {
  const report: QcHistory = browserFixtureActive
    ? await fetch(`/__mindflow_fixture_qc_history?offset=${offset}`).then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      })
    : await invoke<QcHistory>("documentation_qc_history", { root, snapshot, offset });
  if (report.root !== root || report.snapshot.id !== snapshot || report.offset !== offset
    || report.schema !== "mindflow-documentation-qc-history/v1") {
    throw new Error("QC commit choices no longer match this Region. Refresh the project and try again.");
  }
  return report;
}

export const browserFixtureActive =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("browser-fixture");

export async function loadVersionInfo(root?: string): Promise<DesktopVersionInfo> {
  if (browserFixtureActive) {
    const response = await fetch("/__mindflow_fixture_versions");
    if (!response.ok) throw new Error("Version information unavailable");
    return response.json() as Promise<DesktopVersionInfo>;
  }
  return invoke<DesktopVersionInfo>("version_info", { root: root ?? null });
}

async function browserFixtureRegions(): Promise<OpenRegionResponse[][]> {
  const response = await fetch("/__mindflow_fixture");
  if (!response.ok) {
    throw new Error(`Browser fixture failed with HTTP ${response.status}`);
  }
  return response.json() as Promise<OpenRegionResponse[][]>;
}

export function loadStartupRegions(): Promise<OpenRegionResponse[][]> {
  if (browserFixtureActive) return browserFixtureRegions();
  return invoke<OpenRegionResponse[][]>("startup_regions");
}

export function openRegions(paths: string[]): Promise<OpenRegionResponse[]> {
  return invoke<OpenRegionResponse[]>("open_regions", { arguments: paths });
}

export function openSshRegion(
  destination: string,
  path: string,
): Promise<OpenRegionResponse> {
  return invoke<OpenRegionResponse>("open_ssh_region", { destination, path });
}

export function listSshDestinations(): Promise<string[]> {
  return invoke<string[]>("list_ssh_destinations");
}

export function browseSshDirectory(
  destination: string,
  path: string,
  connectIfMissing: boolean,
): Promise<FolderPickerResponse> {
  return invoke<FolderPickerResponse>("browse_ssh_directory", {
    destination,
    path,
    connectIfMissing,
  });
}

export function takePendingOpenRegions(): Promise<OpenRegionResponse[][]> {
  if (browserFixtureActive) return Promise.resolve([]);
  return invoke<OpenRegionResponse[][]>("take_pending_open_regions");
}

export function createProjectWindow(paths: string[] = []): Promise<string> {
  return invoke<string>("create_project_window", { arguments: paths });
}

export function presentReaderWindow(
  root: string,
  path: string,
  interfaceScale: number,
  mode: ReaderNavigationMode = "same-reader",
  fragment?: string,
  snapshot?: string,
): Promise<string> {
  if (browserFixtureActive) {
    document.documentElement.dataset.mindflowFixtureReaderPath = path;
    document.documentElement.dataset.mindflowFixtureReaderMode = mode;
    return Promise.resolve("browser-fixture-reader");
  }
  return invoke<string>("present_reader_window", {
    root,
    path,
    interfaceScale,
    mode,
    fragment: fragment ?? null,
    snapshot: snapshot ?? null,
  });
}

export function loadReaderWindow(): Promise<ReaderWindowSnapshot> {
  return invoke<ReaderWindowSnapshot>("reader_window_snapshot");
}

export function loadReaderImage(path: string): Promise<string> {
  return invoke<string>("reader_image_data_url", { path });
}

export function inspectReaderTarget(target?: InspectionTarget): Promise<void> {
  return invoke<void>("inspect_reader_target", { target: target ?? null });
}

export function updateReaderWindowScale(
  root: string,
  interfaceScale: number,
): Promise<void> {
  if (browserFixtureActive) return Promise.resolve();
  return invoke<void>("update_reader_window_scale", {
    root,
    interfaceScale,
  });
}

export function reconcileReaderWindows(
  root: string,
  snapshot?: string,
): Promise<void> {
  if (browserFixtureActive) return Promise.resolve();
  return invoke<void>("reconcile_reader_windows", {
    root,
    snapshot: snapshot ?? null,
  });
}

export function closeReaderWindows(root: string): Promise<void> {
  if (browserFixtureActive) return Promise.resolve();
  return invoke<void>("close_reader_windows", { root });
}

export function updateWindowSession(
  paths: string[],
  activeProject: string | undefined,
): Promise<void> {
  if (browserFixtureActive) return Promise.resolve();
  return invoke<void>("update_window_session", {
    paths,
    activeProject,
  });
}

function reconstructProject(
  root: string,
  activateSynchronizedBuild: boolean,
): Promise<RefreshProjectResponse> {
  if (browserFixtureActive) {
    return browserFixtureRegions().then((batches) => {
      const response = batches[0]?.[0];
      if (!response || response.status !== "region") {
        throw new Error("Browser fixture returned no Region");
      }
      return { action: "region", region: response.region };
    });
  }
  return invoke<RefreshProjectResponse>("refresh_project", {
    root,
    activateSynchronizedBuild,
  });
}

export function refreshProject(root: string): Promise<RefreshProjectResponse> {
  return reconstructProject(root, true);
}

export function reloadProject(root: string): Promise<RefreshProjectResponse> {
  return reconstructProject(root, false);
}

export function relaunchRegions(paths: string[]): Promise<void> {
  return invoke<void>("relaunch_regions", { paths });
}

export function chooseRegion(): Promise<OpenRegionResponse | null> {
  return invoke<OpenRegionResponse | null>("choose_region");
}

export function initializeRegion(root: string): Promise<RegionResponse> {
  return invoke<RegionResponse>("initialize_region", { root });
}

export function listProjectDirectory(
  root: string,
  path: string,
): Promise<ProjectDirectoryResponse> {
  if (browserFixtureActive) {
    return fetch(
      `/__mindflow_fixture_directory?path=${encodeURIComponent(path)}`,
    ).then((response) => {
      if (!response.ok) {
        throw new Error(`Browser fixture failed with HTTP ${response.status}`);
      }
      return response.json() as Promise<ProjectDirectoryResponse>;
    });
  }
  return invoke<ProjectDirectoryResponse>("list_project_directory", {
    root,
    path,
  });
}

export function loadDocument(
  root: string,
  path: string,
): Promise<DocumentResponse> {
  return invoke<DocumentResponse>("read_document", { root, path });
}
