import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  inspectReaderTarget,
  loadReaderWindow,
  presentReaderWindow,
} from "./api";
import { readerContentId, type ReaderNavigationMode } from "./readerNavigation";
import { listenForReaderStateChange, type ReaderNavigationEvent } from "./readerWindowEvents";
import type {
  InspectionTarget,
  ReaderWindowSnapshot,
} from "./types";
import { managedFileName } from "./types";

const documentInspectorRequest = import("./components/DocumentInspector");
type DocumentInspectors = Awaited<typeof documentInspectorRequest>;

interface ReaderLoadState {
  loading: boolean;
  snapshot?: ReaderWindowSnapshot;
  imageGeneration?: number;
  error?: string;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ReaderApp() {
  const requestIdRef = useRef(0);
  const acceptedSnapshotRef = useRef<{ serialized: string; snapshot: ReaderWindowSnapshot } | undefined>(undefined);
  const contentRef = useRef<HTMLElement>(null);
  const previousTargetRef = useRef<string | undefined>(undefined);
  const [loadState, setLoadState] = useState<ReaderLoadState>({
    loading: true,
  });
  const [navigationError, setNavigationError] = useState<string>();
  const [documentInspectors, setDocumentInspectors] = useState<DocumentInspectors>();
  const [presentationError, setPresentationError] = useState<string>();
  const [hoveredInspection, setHoveredInspection] =
    useState<InspectionTarget>();
  const [linkPreviews, setLinkPreviews] = useState<{
    pointer?: string;
    focus?: string;
  }>({});

  useEffect(() => {
    performance.mark("mindflow:reader:shell-mounted");
    let active = true;
    // Reveal the renderer as soon as it arrives, without a Suspense retry's
    // minimum fallback interval. Its import and the exact snapshot run in parallel.
    void documentInspectorRequest.then(
      (module) => {
        if (active) setDocumentInspectors(module);
      },
      (error: unknown) => {
        if (active) setPresentationError(message(error));
      },
    );
    return () => { active = false; };
  }, []);

  const refresh = useCallback(async (target?: ReaderNavigationEvent) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const timingStart = `mindflow:reader:${requestId}:snapshot-request`;
    const timingEnd = `mindflow:reader:${requestId}:snapshot-loaded`;
    performance.mark(timingStart);
    setLoadState((current) => current.snapshot && (!target ||
      (target.root === current.snapshot.root && target.path === current.snapshot.path))
      ? current : { ...current, loading: true, error: undefined });
    try {
      const snapshot = await loadReaderWindow();
      if (requestId !== requestIdRef.current) return;
      performance.mark(timingEnd);
      performance.measure(
        "mindflow:reader:snapshot-load",
        timingStart,
        timingEnd,
      );
      const serialized = JSON.stringify(snapshot);
      const previous = acceptedSnapshotRef.current;
      const unchanged = previous?.serialized === serialized;
      const accepted = unchanged ? previous.snapshot : snapshot;
      acceptedSnapshotRef.current = { serialized, snapshot: accepted };
      // Inline and standalone images have independent byte requests. Advancing
      // their context leaves the accepted prose, selection, and DOM intact.
      setLoadState({ loading: false, snapshot: accepted, imageGeneration: requestId });
      if (!unchanged) {
        setHoveredInspection(undefined);
        setLinkPreviews({});
        document.title = `${managedFileName(snapshot.path)} — ${snapshot.project} — Mindflow Reader`;
      }
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      acceptedSnapshotRef.current = undefined;
      setLoadState({ loading: false, error: message(error) });
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void refresh();
    void listenForReaderStateChange((target) => {
      void refresh(target);
    })
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      })
      .catch((error: unknown) => {
        if (!disposed) setNavigationError(message(error));
      });
    return () => {
      disposed = true;
      requestIdRef.current += 1;
      unlisten?.();
    };
  }, [refresh]);

  const snapshot = loadState.snapshot;
  const DocumentInspector = documentInspectors?.DocumentInspector;
  const ProjectDocumentInspector = documentInspectors?.ProjectDocumentInspector;
  const ImageRefreshProvider = documentInspectors?.ReaderImageRefreshContext.Provider;
  const navigate = useCallback(
    async (
      path: string,
      mode: ReaderNavigationMode = "same-reader",
      fragment?: string,
    ) => {
      if (!snapshot) return;
      setNavigationError(undefined);
      try {
        await presentReaderWindow(
          snapshot.root,
          path,
          snapshot.interfaceScale,
          mode,
          fragment,
          snapshot.snapshot?.id,
        );
      } catch (error) {
        setNavigationError(message(error));
      }
    },
    [snapshot],
  );
  const selectDocument = useCallback(
    (path: string, mode?: ReaderNavigationMode, fragment?: string) => {
      void navigate(path, mode, fragment);
    },
    [navigate],
  );

  const handleInspect = useCallback((target?: InspectionTarget) => {
    setHoveredInspection(target);
    void inspectReaderTarget(target).catch(() => undefined);
  }, []);

  useEffect(() => {
    const clearInspection = () => handleInspect(undefined);
    window.addEventListener("blur", clearInspection);
    return () => window.removeEventListener("blur", clearInspection);
  }, [handleInspect]);

  const previewLink = useCallback(
    (source: "pointer" | "focus", address?: string) => {
      setLinkPreviews((current) =>
        current[source] === address
          ? current
          : { ...current, [source]: address },
      );
    },
    [],
  );
  const linkPreview = linkPreviews.pointer ?? linkPreviews.focus;
  const inspection = useMemo<InspectionTarget | undefined>(
    () =>
      hoveredInspection ??
      (snapshot ? { kind: "document", path: snapshot.path } : undefined),
    [hoveredInspection, snapshot],
  );
  const managedDocument = snapshot?.graph.documents.find(
    (document) => document.path === snapshot.path,
  );
  useEffect(() => {
    if (!snapshot) return;
    const targetKey = `${snapshot.root}:${snapshot.path}#${snapshot.fragment ?? ""}`;
    if (previousTargetRef.current === targetKey) return;
    previousTargetRef.current = targetKey;
    const content = contentRef.current;
    if (!content) return;
    if (!snapshot.fragment) {
      content.scrollTo({ top: 0, left: 0 });
      return;
    }

    const targetId = readerContentId(snapshot.fragment);
    const revealTarget = () => {
      const target =
        document.getElementById(targetId) ??
        document.getElementsByName(targetId).item(0);
      if (!target) return false;
      target.scrollIntoView({ block: "start" });
      return true;
    };
    if (revealTarget()) return;
    const observer = new MutationObserver(() => {
      if (revealTarget()) observer.disconnect();
    });
    observer.observe(content, { childList: true, subtree: true });
    const timeout = window.setTimeout(() => observer.disconnect(), 3000);
    return () => {
      window.clearTimeout(timeout);
      observer.disconnect();
    };
  }, [snapshot]);
  const interfaceScale = snapshot?.interfaceScale ?? 1;
  const shellStyle = {
    "--reader-interface-scale": interfaceScale,
    "--reader-shell-height": `${100 / interfaceScale}dvh`,
  } as CSSProperties;

  return (
    <div className="native-reader-shell" style={shellStyle}>
      {navigationError ? (
        <div className="native-reader-alert" role="alert">
          {navigationError}
        </div>
      ) : null}
      {snapshot ? (
        <main
          ref={contentRef}
          className="native-reader-content"
          aria-label={`${snapshot.kind === "managed" ? "Reader" : "Project Reader"}: ${snapshot.path}`}
        >
          {presentationError ? (
            <section className="project-text-reader">
              <p className="reader-message reader-message--error" role="alert">
                Document presentation could not load: {presentationError}
              </p>
              {snapshot.document.content ? <pre>{snapshot.document.content}</pre> : null}
            </section>
          ) : !documentInspectors || !ImageRefreshProvider ? (
            <div className="reader-message" role="status" aria-live="polite">
              Preparing document presentation…
            </div>
          ) : (
            <ImageRefreshProvider value={loadState.imageGeneration ?? 0}>
              {snapshot.kind === "managed" && managedDocument && inspection && DocumentInspector ? (
                <DocumentInspector
                  key={snapshot.path}
                  graph={snapshot.graph}
                  document={managedDocument}
                  inspection={inspection}
                  onInspect={handleInspect}
                  content={snapshot.document.content}
                  loading={loadState.loading}
                  error={loadState.error}
                  onSelect={selectDocument}
                  onPreviewLink={previewLink}
                />
              ) : snapshot.kind === "project" && ProjectDocumentInspector ? (
                <ProjectDocumentInspector
                  key={snapshot.path}
                  path={snapshot.path}
                  document={snapshot.document}
                  imageGeneration={loadState.imageGeneration}
                  loading={loadState.loading}
                  error={loadState.error}
                  onSelect={selectDocument}
                  onPreviewLink={previewLink}
                />
              ) : (
                <div className="reader-message reader-message--error" role="alert">
                  This document is unavailable in the Reader snapshot.
                </div>
              )}
            </ImageRefreshProvider>
          )}
        </main>
      ) : (
        <main className="native-reader-state" aria-live="polite">
          {loadState.loading ? "Opening Reader…" : loadState.error}
        </main>
      )}
      {linkPreview ? (
        <output className="reader-link-preview" aria-live="polite">
          {linkPreview}
        </output>
      ) : null}
    </div>
  );
}
