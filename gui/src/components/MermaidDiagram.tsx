import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { normalizeCanvasTextScale } from "../canvasTextScale";
import { mermaidSvgSize } from "../mermaidRendering";
import { renderMermaid } from "../mermaidRuntime";
import { CanvasZoomControls } from "./CanvasZoomControls";
import { CloseIcon, ExpandIcon } from "./Icons";
import { useCanvasViewport } from "./useCanvasViewport";
import { HelpOnly, HelpToggle } from "./InterfaceHelp";

interface MermaidDiagramProps {
  source: string;
}

interface MermaidRenderState {
  source: string;
  status: "loading" | "rendered" | "error";
  svg?: string;
  error?: string;
}

interface FullscreenSession {
  exit: () => Promise<void>;
}

let readerFullscreenOperation: Promise<void> = Promise.resolve();

function serializeReaderFullscreen<T>(operation: () => Promise<T>): Promise<T> {
  const result = readerFullscreenOperation.then(operation, operation);
  readerFullscreenOperation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}


function renderErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function svgImageSource(svg: string | undefined): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg ?? "")}`;
}

const MERMAID_MINIMUM_ZOOM = 0.1;
const MERMAID_MAXIMUM_ZOOM = 5;

const MermaidExaminerViewport = memo(function MermaidExaminerViewport({
  svg,
  source,
  diagramId,
}: {
  svg: string;
  source: string;
  diagramId: string;
}) {
  const [renderedSvg, setRenderedSvg] = useState(svg);
  const [textScale, setTextScale] = useState(1);
  const [textScaleError, setTextScaleError] = useState<string>();
  const [textRenderPending, setTextRenderPending] = useState(false);
  const textRenderRequestRef = useRef(0);
  const renderedTextScaleRef = useRef(1);
  const initialWidthFitActiveRef = useRef(true);
  const contentSize = useMemo(() => mermaidSvgSize(renderedSvg), [renderedSvg]);
  const diagramImageSource = useMemo(
    () => svgImageSource(renderedSvg),
    [renderedSvg],
  );
  const [zoom, setZoom] = useState(1);
  const [maximumZoom, setMaximumZoom] = useState(MERMAID_MAXIMUM_ZOOM);
  const {
    viewportRef,
    contentRef,
    viewportHandlers,
    zoomIn,
    zoomOut,
    fit,
    fitWidth,
  } = useCanvasViewport({
    zoom,
    onZoomCommit: setZoom,
    contentSize,
    minimumZoom: MERMAID_MINIMUM_ZOOM,
    maximumZoom,
  });

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const fitToCurrentWidth = () => {
      if (!initialWidthFitActiveRef.current) return;
      setMaximumZoom((currentMaximum) =>
        Math.max(
          currentMaximum,
          viewport.clientWidth / Math.max(1, contentSize.width),
        ),
      );
      fitWidth();
    };
    const stopInitialWidthFit = () => {
      initialWidthFitActiveRef.current = false;
      observer.disconnect();
    };
    const observer = new ResizeObserver(fitToCurrentWidth);

    fitToCurrentWidth();
    observer.observe(viewport);
    viewport.addEventListener("pointerdown", stopInitialWidthFit, true);
    viewport.addEventListener("wheel", stopInitialWidthFit, true);
    viewport.addEventListener("keydown", stopInitialWidthFit, true);

    return () => {
      observer.disconnect();
      viewport.removeEventListener("pointerdown", stopInitialWidthFit, true);
      viewport.removeEventListener("wheel", stopInitialWidthFit, true);
      viewport.removeEventListener("keydown", stopInitialWidthFit, true);
    };
  }, [contentSize.width, fitWidth, viewportRef]);

  const changeTextScale = useCallback(
    (nextTextScale: number) => {
      const normalizedTextScale = normalizeCanvasTextScale(nextTextScale);
      const request = textRenderRequestRef.current + 1;
      textRenderRequestRef.current = request;
      initialWidthFitActiveRef.current = false;
      setTextScale(normalizedTextScale);
      setTextScaleError(undefined);
      setTextRenderPending(true);
      void renderMermaid(
        `${diagramId}-text-${request}`,
        source,
        normalizedTextScale,
      )
        .then(({ svg: nextSvg }) => {
          if (textRenderRequestRef.current !== request) return;
          renderedTextScaleRef.current = normalizedTextScale;
          setRenderedSvg(nextSvg);
          setTextRenderPending(false);
        })
        .catch((error: unknown) => {
          if (textRenderRequestRef.current !== request) return;
          setTextScale(renderedTextScaleRef.current);
          setTextScaleError(
            `Text size could not be changed: ${renderErrorMessage(error)}`,
          );
          setTextRenderPending(false);
        });
    },
    [diagramId, source],
  );

  useEffect(
    () => () => {
      textRenderRequestRef.current += 1;
    },
    [],
  );

  return (
    <div
      ref={viewportRef}
      className="mermaid-examiner__viewport"
      role="region"
      aria-label="Mermaid examination canvas. Two-finger scroll moves the diagram and pinch zooms it."
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight + - 0"
      aria-busy={textRenderPending}
      tabIndex={0}
      {...viewportHandlers}
    >
      <div
        ref={contentRef}
        className="mermaid-examiner__content canvas-viewport__content"
        style={{ width: contentSize.width, height: contentSize.height }}
      >
        <img
          className="mermaid-examiner__image"
          src={diagramImageSource}
          alt="Full-screen Mermaid diagram"
          draggable={false}
        />
      </div>
      {textScaleError ? <p className="mermaid-examiner__navigation-hint" role="status">{textScaleError}</p> : (
        <HelpOnly><p className="mermaid-examiner__navigation-hint">Scroll or drag to pan · pinch to zoom</p></HelpOnly>
      )}
      <CanvasZoomControls
        label="Mermaid diagram zoom"
        textScale={textScale}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFit={fit}
        onTextScaleChange={changeTextScale}
      />
    </div>
  );
});

async function enterReaderFullscreen(
  isCurrent: () => boolean,
): Promise<FullscreenSession> {
  if (!isTauri() || !isCurrent()) {
    return { exit: async () => undefined };
  }

  return serializeReaderFullscreen(async () => {
    if (!isCurrent()) return { exit: async () => undefined };
    const readerWindow = getCurrentWindow();
    const alreadyFullscreen = await readerWindow.isFullscreen();
    if (!isCurrent() || alreadyFullscreen) {
      return { exit: async () => undefined };
    }

    await readerWindow.setSimpleFullscreen(true);
    if (!isCurrent()) {
      await readerWindow.setSimpleFullscreen(false);
      return { exit: async () => undefined };
    }

    let active = true;
    return {
      exit: async () => {
        if (!active) return;
        active = false;
        await serializeReaderFullscreen(() =>
          readerWindow.setSimpleFullscreen(false),
        );
      },
    };
  });
}

export const MermaidDiagram = memo(function MermaidDiagram({
  source,
}: MermaidDiagramProps) {
  const reactId = useId();
  const diagramId = `mindflow-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const examinerLabelId = `${diagramId}-examiner-label`;
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const fullscreenRequestRef = useRef(0);
  const fullscreenSessionRef = useRef<FullscreenSession | undefined>(undefined);
  const [renderState, setRenderState] = useState<MermaidRenderState>(() => ({
    source,
    status: "loading",
  }));
  const [examinerRenderState, setExaminerRenderState] =
    useState<MermaidRenderState>();
  const [expanded, setExpanded] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string>();
  const currentState: MermaidRenderState =
    renderState.source === source
      ? renderState
      : { source, status: "loading" };

  const closeExaminer = useCallback(() => {
    fullscreenRequestRef.current += 1;
    const session = fullscreenSessionRef.current;
    fullscreenSessionRef.current = undefined;
    setExpanded(false);
    setExaminerRenderState(undefined);
    setFullscreenError(undefined);
    if (session) void session.exit().catch(() => undefined);
    window.requestAnimationFrame(() => expandButtonRef.current?.focus());
  }, []);

  const openExaminer = useCallback(() => {
    const request = fullscreenRequestRef.current + 1;
    fullscreenRequestRef.current = request;
    setExpanded(true);
    setExaminerRenderState({ source, status: "loading" });
    setFullscreenError(undefined);
    void renderMermaid(`${diagramId}-examiner-${request}`, source)
      .then(({ svg }) => {
        if (fullscreenRequestRef.current === request) {
          setExaminerRenderState({ source, status: "rendered", svg });
        }
      })
      .catch((error: unknown) => {
        if (fullscreenRequestRef.current === request) {
          setExaminerRenderState({
            source,
            status: "error",
            error: renderErrorMessage(error),
          });
        }
      });
    void enterReaderFullscreen(() => fullscreenRequestRef.current === request)
      .then((session) => {
        if (fullscreenRequestRef.current !== request) {
          void session.exit().catch(() => undefined);
          return;
        }
        fullscreenSessionRef.current = session;
        window.requestAnimationFrame(() => {
          if (fullscreenRequestRef.current !== request) return;
          closeButtonRef.current?.focus();
        });
      })
      .catch((error: unknown) => {
        if (fullscreenRequestRef.current === request) {
          setFullscreenError(
            `Native fullscreen was unavailable: ${renderErrorMessage(error)}`,
          );
        }
      });
  }, [diagramId, source]);

  useEffect(() => {
    let active = true;
    setRenderState({ source, status: "loading" });
    void renderMermaid(diagramId, source)
      .then(({ svg }) => {
        if (active) setRenderState({ source, status: "rendered", svg });
      })
      .catch((error: unknown) => {
        if (active) {
          setRenderState({
            source,
            status: "error",
            error: renderErrorMessage(error),
          });
        }
      });
    return () => {
      active = false;
    };
  }, [diagramId, source]);

  useEffect(() => {
    if (!expanded) return;
    const applicationRoot = document.getElementById("root");
    const wasInert = applicationRoot?.hasAttribute("inert") ?? false;
    const previousAriaHidden = applicationRoot?.getAttribute("aria-hidden");
    applicationRoot?.setAttribute("inert", "");
    applicationRoot?.setAttribute("aria-hidden", "true");
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeExaminer();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      if (applicationRoot && !wasInert) applicationRoot.removeAttribute("inert");
      if (applicationRoot) {
        if (previousAriaHidden === null) {
          applicationRoot.removeAttribute("aria-hidden");
        } else if (previousAriaHidden !== undefined) {
          applicationRoot.setAttribute("aria-hidden", previousAriaHidden);
        }
      }
    };
  }, [closeExaminer, expanded]);

  useEffect(() => {
    if (expanded && currentState.status !== "rendered") closeExaminer();
  }, [closeExaminer, currentState.status, expanded]);

  useEffect(
    () => () => {
      fullscreenRequestRef.current += 1;
      const session = fullscreenSessionRef.current;
      fullscreenSessionRef.current = undefined;
      if (session) void session.exit().catch(() => undefined);
    },
    [],
  );

  return (
    <figure
      className="mermaid-diagram"
      aria-label="Mermaid diagram"
      aria-busy={currentState.status === "loading"}
    >
      <div className="mermaid-diagram__canvas">
        {currentState.status === "loading" ? (
          <div className="mermaid-diagram__status" role="status">
            Rendering Mermaid diagram…
          </div>
        ) : currentState.status === "error" ? (
          <div className="mermaid-diagram__error" role="alert">
            <strong>Mermaid diagram could not be rendered.</strong>
            <span>{currentState.error}</span>
          </div>
        ) : (
          <>
            <button
              ref={expandButtonRef}
              type="button"
              className="mermaid-diagram__expand"
              aria-haspopup="dialog"
              aria-label="Examine Mermaid diagram full screen"
              title="Examine full screen"
              onClick={openExaminer}
            >
              <ExpandIcon aria-hidden="true" />
            </button>
            <img
              className="mermaid-diagram__svg"
              src={svgImageSource(currentState.svg)}
              alt="Mermaid diagram"
            />
          </>
        )}
      </div>
      <details
        className="mermaid-diagram__source"
        open={currentState.status === "error"}
      >
        <summary>Mermaid source</summary>
        <pre>
          <code>{source}</code>
        </pre>
      </details>
      {expanded && currentState.status === "rendered"
        ? createPortal(
            <section
              className="mermaid-examiner"
              role="dialog"
              aria-modal="true"
              aria-labelledby={examinerLabelId}
            >
              <h2 id={examinerLabelId}>Mermaid diagram examination</h2>
              <div className="mermaid-examiner__actions">
                <HelpToggle />
                <button
                  ref={closeButtonRef}
                  type="button"
                  className="mermaid-examiner__close"
                  aria-label="Close full-screen Mermaid diagram"
                  title="Close full screen"
                  autoFocus
                  onClick={closeExaminer}
                >
                  <CloseIcon aria-hidden="true" />
                </button>
              </div>
              {!examinerRenderState || examinerRenderState.status === "loading" ? (
                <div className="mermaid-examiner__stage">
                  <div className="mermaid-examiner__status" role="status">
                    Preparing full-screen diagram…
                  </div>
                </div>
              ) : examinerRenderState.status === "error" ? (
                <div className="mermaid-examiner__stage">
                  <div className="mermaid-examiner__error" role="alert">
                    <strong>Full-screen diagram could not be rendered.</strong>
                    <span>{examinerRenderState.error}</span>
                  </div>
                </div>
              ) : (
                <MermaidExaminerViewport
                  svg={examinerRenderState.svg ?? ""}
                  source={source}
                  diagramId={`${diagramId}-examiner`}
                />
              )}
              {fullscreenError ? (
                <div className="mermaid-examiner__notice" role="status">
                  {fullscreenError}
                </div>
              ) : null}
            </section>,
            document.body,
          )
        : null}
    </figure>
  );
});
