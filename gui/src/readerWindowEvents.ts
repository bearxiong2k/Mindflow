import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import type { InspectionTarget } from "./types";

const readerStateChangedEvent = "mindflow-reader-state-changed";
const readerNavigationEvent = "mindflow-reader-navigation";
const readerInspectionEvent = "mindflow-reader-inspection";

export interface ReaderNavigationEvent {
  root: string;
  path: string;
}

export interface ReaderInspectionEvent {
  root: string;
  target: InspectionTarget | null;
}

export function listenForReaderStateChange(
  onChange: (target: ReaderNavigationEvent) => void,
): Promise<() => void> {
  return getCurrentWebviewWindow().listen<ReaderNavigationEvent>(readerStateChangedEvent,
    (event) => onChange(event.payload));
}

export async function listenForWorkspaceReaderEvents(
  onNavigation: (event: ReaderNavigationEvent) => void,
  onInspection: (event: ReaderInspectionEvent) => void,
): Promise<() => void> {
  const currentWindow = getCurrentWebviewWindow();
  const unlistenNavigation = await currentWindow.listen<ReaderNavigationEvent>(
    readerNavigationEvent,
    (event) => onNavigation(event.payload),
  );
  try {
    const unlistenInspection =
      await currentWindow.listen<ReaderInspectionEvent>(
        readerInspectionEvent,
        (event) => onInspection(event.payload),
      );
    return () => {
      unlistenNavigation();
      unlistenInspection();
    };
  } catch (error) {
    unlistenNavigation();
    throw error;
  }
}
