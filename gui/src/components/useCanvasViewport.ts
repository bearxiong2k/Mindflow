import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type MutableRefObject,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";

import {
  MAXIMUM_CANVAS_ZOOM,
  MINIMUM_CANVAS_ZOOM,
  canvasTargetIsInteractiveControl,
  centerCanvasTransformAtContentRatio,
  clampCanvasZoom,
  constrainCanvasTransform,
  fitCanvasBoundsTransform,
  fitCanvasWidthZoom,
  fitCanvasZoom,
  panCanvasTransform,
  renderedCanvasSize,
  restoreCanvasViewportTransform,
  wheelDeltaInPixels,
  zoomCanvasTransformAt,
  type CanvasBounds,
  type CanvasPoint,
  type CanvasSize,
  type CanvasViewportTransform,
} from "../canvasViewport";

interface UseCanvasViewportOptions {
  zoom: number;
  onZoomCommit: (zoom: number) => void;
  contentSize?: CanvasSize;
  fitRequest?: number;
  minimumZoom?: number;
  maximumZoom?: number;
  transformStateRef?: MutableRefObject<CanvasViewportTransform | undefined>;
  onTransformChange?: (snapshot: CanvasViewportSnapshot) => void;
}

export interface CanvasViewportSnapshot {
  transform: CanvasViewportTransform;
  viewport: CanvasSize;
  content: CanvasSize;
}

interface ActivePointerPan {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startTransform: CanvasViewportTransform;
  moved: boolean;
}

interface ActiveGestureZoom {
  anchor: CanvasPoint;
  startTransform: CanvasViewportTransform;
}

interface WebKitGestureEvent extends Event {
  clientX?: number;
  clientY?: number;
  scale: number;
}

const POINTER_PAN_THRESHOLD = 3;
const WHEEL_ZOOM_SENSITIVITY = 0.004;
const BUTTON_ZOOM_STEP = 0.1;
const ZOOM_COMMIT_DELAY = 140;
const WHEEL_OVERLAY_SELECTOR =
  "button, input, textarea, select, .zoom-controls, .role-layer-controls, [data-canvas-overlay]";

export function useCanvasViewport({
  zoom,
  onZoomCommit,
  contentSize,
  fitRequest,
  minimumZoom = MINIMUM_CANVAS_ZOOM,
  maximumZoom = MAXIMUM_CANVAS_ZOOM,
  transformStateRef,
  onTransformChange,
}: UseCanvasViewportOptions) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<CanvasViewportTransform>(
    restoreCanvasViewportTransform(
      transformStateRef?.current,
      zoom,
      minimumZoom,
      maximumZoom,
    ),
  );
  const onZoomCommitRef = useRef(onZoomCommit);
  const onTransformChangeRef = useRef(onTransformChange);
  const pointerPanRef = useRef<ActivePointerPan | undefined>(undefined);
  const gestureZoomRef = useRef<ActiveGestureZoom | undefined>(undefined);
  const zoomCommitTimerRef = useRef<number | undefined>(undefined);
  const suppressClickRef = useRef(false);
  const previousFitRequestRef = useRef(fitRequest);
  const contentWidth = contentSize?.width;
  const contentHeight = contentSize?.height;

  useLayoutEffect(() => {
    onZoomCommitRef.current = onZoomCommit;
  }, [onZoomCommit]);

  useLayoutEffect(() => {
    onTransformChangeRef.current = onTransformChange;
  }, [onTransformChange]);

  const geometry = useCallback((): {
    viewport: CanvasSize;
    content: CanvasSize;
  } => {
    const viewport = viewportRef.current;
    const viewportWidth = Math.max(1, viewport?.clientWidth ?? 1);
    const viewportHeight = Math.max(1, viewport?.clientHeight ?? 1);
    return {
      viewport: {
        width: viewportWidth,
        height: viewportHeight,
      },
      content: {
        width: Math.max(1, contentWidth ?? viewportWidth),
        height: Math.max(1, contentHeight ?? viewportHeight),
      },
    };
  }, [contentHeight, contentWidth]);

  const renderTransform = useCallback(
    (requested: CanvasViewportTransform): CanvasViewportTransform => {
      const elements = {
        viewport: viewportRef.current,
        content: contentRef.current,
      };
      const sizes = geometry();
      const next = constrainCanvasTransform(
        requested,
        sizes.viewport,
        sizes.content,
        minimumZoom,
        maximumZoom,
      );
      transformRef.current = next;
      if (transformStateRef) transformStateRef.current = next;
      if (elements.content) {
        const renderedSize = renderedCanvasSize(
          sizes.content,
          next.zoom,
          minimumZoom,
          maximumZoom,
        );
        elements.content.style.width = `${renderedSize.width}px`;
        elements.content.style.height = `${renderedSize.height}px`;
        elements.content.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
      }
      if (elements.viewport) {
        elements.viewport.dataset.canvasZoom = next.zoom.toFixed(3);
        elements.viewport.dataset.canvasZoomLabel = `${Math.round(next.zoom * 100)}%`;
      }
      onTransformChangeRef.current?.({
        transform: next,
        viewport: sizes.viewport,
        content: sizes.content,
      });
      return next;
    },
    [geometry, maximumZoom, minimumZoom, transformStateRef],
  );

  const commitZoom = useCallback((nextZoom: number) => {
    if (zoomCommitTimerRef.current !== undefined) {
      window.clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = undefined;
    }
    onZoomCommitRef.current(nextZoom);
  }, []);

  const scheduleZoomCommit = useCallback((nextZoom: number) => {
    if (zoomCommitTimerRef.current !== undefined) {
      window.clearTimeout(zoomCommitTimerRef.current);
    }
    zoomCommitTimerRef.current = window.setTimeout(() => {
      zoomCommitTimerRef.current = undefined;
      onZoomCommitRef.current(nextZoom);
    }, ZOOM_COMMIT_DELAY);
  }, []);

  const localPoint = useCallback((clientX: number, clientY: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return { x: 0, y: 0 };
    const bounds = viewport.getBoundingClientRect();
    const scaleX = viewport.clientWidth / Math.max(1, bounds.width);
    const scaleY = viewport.clientHeight / Math.max(1, bounds.height);
    return {
      x: (clientX - bounds.left) * scaleX,
      y: (clientY - bounds.top) * scaleY,
    };
  }, []);

  const zoomAt = useCallback(
    (nextZoom: number, anchor: CanvasPoint, commit: "now" | "later") => {
      const sizes = geometry();
      const next = renderTransform(
        zoomCanvasTransformAt(
          transformRef.current,
          nextZoom,
          anchor,
          sizes.viewport,
          sizes.content,
          minimumZoom,
          maximumZoom,
        ),
      );
      if (commit === "now") commitZoom(next.zoom);
      else scheduleZoomCommit(next.zoom);
    },
    [
      commitZoom,
      geometry,
      maximumZoom,
      minimumZoom,
      renderTransform,
      scheduleZoomCommit,
    ],
  );

  const stepZoom = useCallback(
    (step: number) => {
      const sizes = geometry();
      zoomAt(
        transformRef.current.zoom + step,
        { x: sizes.viewport.width / 2, y: sizes.viewport.height / 2 },
        "now",
      );
    },
    [geometry, zoomAt],
  );

  const fit = useCallback(() => {
    const sizes = geometry();
    const fittedZoom = fitCanvasZoom(
      sizes.viewport,
      sizes.content,
      minimumZoom,
      maximumZoom,
    );
    const next = renderTransform({ x: 0, y: 0, zoom: fittedZoom });
    commitZoom(next.zoom);
  }, [commitZoom, geometry, maximumZoom, minimumZoom, renderTransform]);

  const fitWidth = useCallback(() => {
    const sizes = geometry();
    const fittedZoom = fitCanvasWidthZoom(
      sizes.viewport,
      sizes.content,
      minimumZoom,
      maximumZoom,
    );
    const next = renderTransform({ x: 0, y: 0, zoom: fittedZoom });
    commitZoom(next.zoom);
  }, [commitZoom, geometry, maximumZoom, minimumZoom, renderTransform]);

  const fitBounds = useCallback(
    (bounds: CanvasBounds, padding = 24) => {
      const sizes = geometry();
      const next = renderTransform(
        fitCanvasBoundsTransform(
          sizes.viewport,
          sizes.content,
          bounds,
          padding,
          minimumZoom,
          maximumZoom,
        ),
      );
      commitZoom(next.zoom);
    },
    [commitZoom, geometry, maximumZoom, minimumZoom, renderTransform],
  );

  const reset = useCallback(
    (nextZoom = 1) => {
      const next = renderTransform({ x: 0, y: 0, zoom: nextZoom });
      commitZoom(next.zoom);
    },
    [commitZoom, renderTransform],
  );

  const restore = useCallback(
    (transform: CanvasViewportTransform) => {
      const next = renderTransform(transform);
      commitZoom(next.zoom);
    },
    [commitZoom, renderTransform],
  );

  const centerAtContentRatio = useCallback(
    (point: CanvasPoint) => {
      const sizes = geometry();
      renderTransform(
        centerCanvasTransformAtContentRatio(
          transformRef.current,
          point,
          sizes.viewport,
          sizes.content,
          minimumZoom,
          maximumZoom,
        ),
      );
    },
    [geometry, maximumZoom, minimumZoom, renderTransform],
  );

  const getViewportSnapshot = useCallback((): CanvasViewportSnapshot => {
    const sizes = geometry();
    return {
      transform: transformRef.current,
      viewport: sizes.viewport,
      content: sizes.content,
    };
  }, [geometry]);

  useLayoutEffect(() => {
    const requestedZoom = clampCanvasZoom(zoom, minimumZoom, maximumZoom);
    const current = transformRef.current;
    if (Math.abs(current.zoom - requestedZoom) < 0.0001) {
      renderTransform(current);
      return;
    }
    const sizes = geometry();
    renderTransform(
      zoomCanvasTransformAt(
        current,
        requestedZoom,
        { x: sizes.viewport.width / 2, y: sizes.viewport.height / 2 },
        sizes.viewport,
        sizes.content,
        minimumZoom,
        maximumZoom,
      ),
    );
  }, [geometry, maximumZoom, minimumZoom, renderTransform, zoom]);

  useEffect(() => {
    if (previousFitRequestRef.current === fitRequest) return;
    previousFitRequestRef.current = fitRequest;
    fit();
  }, [fit, fitRequest]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => {
      renderTransform(transformRef.current);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [renderTransform]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleGestureStart = (rawEvent: Event) => {
      const event = rawEvent as WebKitGestureEvent;
      event.preventDefault();
      const bounds = viewport.getBoundingClientRect();
      const clientX = event.clientX ?? bounds.left + bounds.width / 2;
      const clientY = event.clientY ?? bounds.top + bounds.height / 2;
      gestureZoomRef.current = {
        anchor: localPoint(clientX, clientY),
        startTransform: transformRef.current,
      };
    };
    const handleGestureChange = (rawEvent: Event) => {
      const event = rawEvent as WebKitGestureEvent;
      const gesture = gestureZoomRef.current;
      if (!gesture || !Number.isFinite(event.scale)) return;
      event.preventDefault();
      const sizes = geometry();
      renderTransform(
        zoomCanvasTransformAt(
          gesture.startTransform,
          gesture.startTransform.zoom * event.scale,
          gesture.anchor,
          sizes.viewport,
          sizes.content,
          minimumZoom,
          maximumZoom,
        ),
      );
    };
    const handleGestureEnd = (rawEvent: Event) => {
      if (!gestureZoomRef.current) return;
      rawEvent.preventDefault();
      gestureZoomRef.current = undefined;
      commitZoom(transformRef.current.zoom);
    };

    viewport.addEventListener("gesturestart", handleGestureStart, {
      passive: false,
    });
    viewport.addEventListener("gesturechange", handleGestureChange, {
      passive: false,
    });
    viewport.addEventListener("gestureend", handleGestureEnd, {
      passive: false,
    });
    return () => {
      viewport.removeEventListener("gesturestart", handleGestureStart);
      viewport.removeEventListener("gesturechange", handleGestureChange);
      viewport.removeEventListener("gestureend", handleGestureEnd);
    };
  }, [commitZoom, geometry, localPoint, maximumZoom, minimumZoom, renderTransform]);

  useEffect(
    () => () => {
      if (zoomCommitTimerRef.current !== undefined) {
        window.clearTimeout(zoomCommitTimerRef.current);
      }
    },
    [],
  );

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (
        event.target instanceof Element &&
        event.target.closest(WHEEL_OVERLAY_SELECTOR)
      ) {
        return;
      }
      event.preventDefault();
      const sizes = geometry();
      const deltaX = wheelDeltaInPixels(
        event.deltaX,
        event.deltaMode,
        sizes.viewport.width,
      );
      const deltaY = wheelDeltaInPixels(
        event.deltaY,
        event.deltaMode,
        sizes.viewport.height,
      );

      if (event.ctrlKey || event.metaKey) {
        if (gestureZoomRef.current) return;
        const factor = Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY);
        zoomAt(
          transformRef.current.zoom * factor,
          localPoint(event.clientX, event.clientY),
          "later",
        );
        return;
      }

      const horizontalDelta =
        event.shiftKey && Math.abs(deltaX) < 0.01 ? deltaY : deltaX;
      const verticalDelta = event.shiftKey && Math.abs(deltaX) < 0.01 ? 0 : deltaY;
      renderTransform(
        panCanvasTransform(
          transformRef.current,
          { x: -horizontalDelta, y: -verticalDelta },
          sizes.viewport,
          sizes.content,
          minimumZoom,
          maximumZoom,
        ),
      );
    },
    [geometry, localPoint, maximumZoom, minimumZoom, renderTransform, zoomAt],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!event.isPrimary || event.button !== 0) return;
      if (canvasTargetIsInteractiveControl(event.target, event.currentTarget)) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      pointerPanRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startTransform: transformRef.current,
        moved: false,
      };
      event.currentTarget.classList.add("is-panning");
    },
    [],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const pan = pointerPanRef.current;
      const viewport = viewportRef.current;
      if (!pan || pan.pointerId !== event.pointerId || !viewport) return;
      const bounds = viewport.getBoundingClientRect();
      const deltaX =
        (event.clientX - pan.startClientX) *
        (viewport.clientWidth / Math.max(1, bounds.width));
      const deltaY =
        (event.clientY - pan.startClientY) *
        (viewport.clientHeight / Math.max(1, bounds.height));
      if (!pan.moved && Math.hypot(deltaX, deltaY) >= POINTER_PAN_THRESHOLD) {
        pan.moved = true;
      }
      if (!pan.moved) return;
      event.preventDefault();
      const sizes = geometry();
      renderTransform(
        panCanvasTransform(
          pan.startTransform,
          { x: deltaX, y: deltaY },
          sizes.viewport,
          sizes.content,
          minimumZoom,
          maximumZoom,
        ),
      );
    },
    [geometry, maximumZoom, minimumZoom, renderTransform],
  );

  const finishPointerPan = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const pan = pointerPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    pointerPanRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.currentTarget.classList.remove("is-panning");
    if (pan.moved) {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  }, []);

  const handleClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        stepZoom(BUTTON_ZOOM_STEP);
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        stepZoom(-BUTTON_ZOOM_STEP);
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        fit();
        return;
      }

      const step = event.shiftKey ? 80 : 28;
      const delta =
        event.key === "ArrowLeft"
          ? { x: step, y: 0 }
          : event.key === "ArrowRight"
            ? { x: -step, y: 0 }
            : event.key === "ArrowUp"
              ? { x: 0, y: step }
              : event.key === "ArrowDown"
                ? { x: 0, y: -step }
                : undefined;
      if (!delta) return;
      event.preventDefault();
      const sizes = geometry();
      renderTransform(
        panCanvasTransform(
          transformRef.current,
          delta,
          sizes.viewport,
          sizes.content,
          minimumZoom,
          maximumZoom,
        ),
      );
    },
    [fit, geometry, maximumZoom, minimumZoom, renderTransform, stepZoom],
  );

  return {
    viewportRef,
    contentRef,
    viewportHandlers: {
      onWheel: handleWheel,
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: finishPointerPan,
      onPointerCancel: finishPointerPan,
      onClickCapture: handleClickCapture,
      onKeyDown: handleKeyDown,
    },
    zoomIn: () => stepZoom(BUTTON_ZOOM_STEP),
    zoomOut: () => stepZoom(-BUTTON_ZOOM_STEP),
    fit,
    fitBounds,
    fitWidth,
    reset,
    restore,
    centerAtContentRatio,
    getViewportSnapshot,
  };
}
