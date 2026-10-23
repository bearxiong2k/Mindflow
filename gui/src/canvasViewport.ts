export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export interface CanvasClientRect extends CanvasSize {
  left: number;
  top: number;
}

export interface CanvasViewBox extends CanvasSize {
  x: number;
  y: number;
}

export type CanvasBounds = CanvasViewBox;

export type CanvasViewportWindow = CanvasBounds;

export interface CanvasViewportTransform {
  x: number;
  y: number;
  zoom: number;
}

export const MINIMUM_CANVAS_ZOOM = 0.5;
export const MAXIMUM_CANVAS_ZOOM = 2.5;
export const CANVAS_POINTER_INTERACTIVE_SELECTOR =
  "button, a, input, textarea, select, summary, [role='button'], [tabindex]:not([tabindex='-1']), [data-canvas-interactive]";

export function canvasTargetIsInteractiveControl(
  target: unknown,
  viewport: unknown,
): boolean {
  if (!target || (typeof target !== "object" && typeof target !== "function")) {
    return false;
  }
  const closest = (target as { closest?: unknown }).closest;
  if (typeof closest !== "function") return false;
  const control = closest.call(target, CANVAS_POINTER_INTERACTIVE_SELECTOR);
  return Boolean(control && control !== viewport);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function canvasClientScale(
  renderedBounds: CanvasClientRect,
  viewBox: CanvasViewBox,
): CanvasPoint | undefined {
  if (
    !Number.isFinite(renderedBounds.left) ||
    !Number.isFinite(renderedBounds.top) ||
    !Number.isFinite(renderedBounds.width) ||
    !Number.isFinite(renderedBounds.height) ||
    renderedBounds.width <= 0 ||
    renderedBounds.height <= 0 ||
    !Number.isFinite(viewBox.x) ||
    !Number.isFinite(viewBox.y) ||
    !Number.isFinite(viewBox.width) ||
    !Number.isFinite(viewBox.height) ||
    viewBox.width <= 0 ||
    viewBox.height <= 0
  ) return undefined;

  return {
    x: viewBox.width / renderedBounds.width,
    y: viewBox.height / renderedBounds.height,
  };
}

export function canvasPointFromClientRect(
  client: CanvasPoint,
  renderedBounds: CanvasClientRect,
  viewBox: CanvasViewBox,
): CanvasPoint | undefined {
  if (!Number.isFinite(client.x) || !Number.isFinite(client.y)) {
    return undefined;
  }
  const scale = canvasClientScale(renderedBounds, viewBox);
  if (!scale) return undefined;
  return {
    x: viewBox.x + (client.x - renderedBounds.left) * scale.x,
    y: viewBox.y + (client.y - renderedBounds.top) * scale.y,
  };
}

export function canvasDeltaFromClientRect(
  clientDelta: CanvasPoint,
  renderedBounds: CanvasClientRect,
  viewBox: CanvasViewBox,
): CanvasPoint | undefined {
  if (!Number.isFinite(clientDelta.x) || !Number.isFinite(clientDelta.y)) {
    return undefined;
  }
  const scale = canvasClientScale(renderedBounds, viewBox);
  if (!scale) return undefined;
  return {
    x: clientDelta.x * scale.x,
    y: clientDelta.y * scale.y,
  };
}

export function clampCanvasZoom(
  zoom: number,
  minimum = MINIMUM_CANVAS_ZOOM,
  maximum = MAXIMUM_CANVAS_ZOOM,
): number {
  return Number.isFinite(zoom) ? clamp(zoom, minimum, maximum) : 1;
}

export function restoreCanvasViewportTransform(
  savedTransform: CanvasViewportTransform | undefined,
  fallbackZoom: number,
  minimumZoom = MINIMUM_CANVAS_ZOOM,
  maximumZoom = MAXIMUM_CANVAS_ZOOM,
): CanvasViewportTransform {
  if (
    savedTransform &&
    Number.isFinite(savedTransform.x) &&
    Number.isFinite(savedTransform.y) &&
    Number.isFinite(savedTransform.zoom)
  ) {
    return {
      x: savedTransform.x,
      y: savedTransform.y,
      zoom: clampCanvasZoom(savedTransform.zoom, minimumZoom, maximumZoom),
    };
  }
  return {
    x: 0,
    y: 0,
    zoom: clampCanvasZoom(fallbackZoom, minimumZoom, maximumZoom),
  };
}

export function renderedCanvasSize(
  content: CanvasSize,
  zoom: number,
  minimumZoom = MINIMUM_CANVAS_ZOOM,
  maximumZoom = MAXIMUM_CANVAS_ZOOM,
): CanvasSize {
  const clampedZoom = clampCanvasZoom(zoom, minimumZoom, maximumZoom);
  return {
    width: Math.max(1, content.width) * clampedZoom,
    height: Math.max(1, content.height) * clampedZoom,
  };
}

function constrainedOffset(
  offset: number,
  viewportExtent: number,
  contentExtent: number,
  zoom: number,
): number {
  const scaledExtent = contentExtent * zoom;
  if (scaledExtent <= viewportExtent) {
    return (viewportExtent - scaledExtent) / 2;
  }
  return clamp(offset, viewportExtent - scaledExtent, 0);
}

export function constrainCanvasTransform(
  transform: CanvasViewportTransform,
  viewport: CanvasSize,
  content: CanvasSize,
  minimumZoom = MINIMUM_CANVAS_ZOOM,
  maximumZoom = MAXIMUM_CANVAS_ZOOM,
): CanvasViewportTransform {
  const zoom = clampCanvasZoom(transform.zoom, minimumZoom, maximumZoom);
  const viewportWidth = Math.max(1, viewport.width);
  const viewportHeight = Math.max(1, viewport.height);
  const contentWidth = Math.max(1, content.width);
  const contentHeight = Math.max(1, content.height);
  return {
    x: constrainedOffset(transform.x, viewportWidth, contentWidth, zoom),
    y: constrainedOffset(transform.y, viewportHeight, contentHeight, zoom),
    zoom,
  };
}

export function panCanvasTransform(
  transform: CanvasViewportTransform,
  delta: CanvasPoint,
  viewport: CanvasSize,
  content: CanvasSize,
  minimumZoom = MINIMUM_CANVAS_ZOOM,
  maximumZoom = MAXIMUM_CANVAS_ZOOM,
): CanvasViewportTransform {
  return constrainCanvasTransform(
    {
      ...transform,
      x: transform.x + delta.x,
      y: transform.y + delta.y,
    },
    viewport,
    content,
    minimumZoom,
    maximumZoom,
  );
}

export function canvasViewportWindow(
  transform: CanvasViewportTransform,
  viewport: CanvasSize,
  content: CanvasSize,
  minimumZoom = MINIMUM_CANVAS_ZOOM,
  maximumZoom = MAXIMUM_CANVAS_ZOOM,
): CanvasViewportWindow {
  const constrained = constrainCanvasTransform(
    transform,
    viewport,
    content,
    minimumZoom,
    maximumZoom,
  );
  const rendered = renderedCanvasSize(
    content,
    constrained.zoom,
    minimumZoom,
    maximumZoom,
  );
  const viewportWidth = Math.max(1, viewport.width);
  const viewportHeight = Math.max(1, viewport.height);
  const left = Math.max(0, -constrained.x);
  const top = Math.max(0, -constrained.y);
  const right = Math.min(rendered.width, viewportWidth - constrained.x);
  const bottom = Math.min(rendered.height, viewportHeight - constrained.y);
  return {
    x: left / rendered.width,
    y: top / rendered.height,
    width: Math.max(0, right - left) / rendered.width,
    height: Math.max(0, bottom - top) / rendered.height,
  };
}

export function centerCanvasTransformAtContentRatio(
  transform: CanvasViewportTransform,
  point: CanvasPoint,
  viewport: CanvasSize,
  content: CanvasSize,
  minimumZoom = MINIMUM_CANVAS_ZOOM,
  maximumZoom = MAXIMUM_CANVAS_ZOOM,
): CanvasViewportTransform {
  const zoom = clampCanvasZoom(
    transform.zoom,
    minimumZoom,
    maximumZoom,
  );
  const x = clamp(Number.isFinite(point.x) ? point.x : 0.5, 0, 1);
  const y = clamp(Number.isFinite(point.y) ? point.y : 0.5, 0, 1);
  return constrainCanvasTransform(
    {
      x: Math.max(1, viewport.width) / 2 - Math.max(1, content.width) * x * zoom,
      y:
        Math.max(1, viewport.height) / 2 -
        Math.max(1, content.height) * y * zoom,
      zoom,
    },
    viewport,
    content,
    minimumZoom,
    maximumZoom,
  );
}

export function zoomCanvasTransformAt(
  transform: CanvasViewportTransform,
  nextZoom: number,
  anchor: CanvasPoint,
  viewport: CanvasSize,
  content: CanvasSize,
  minimumZoom = MINIMUM_CANVAS_ZOOM,
  maximumZoom = MAXIMUM_CANVAS_ZOOM,
): CanvasViewportTransform {
  const zoom = clampCanvasZoom(nextZoom, minimumZoom, maximumZoom);
  const currentZoom = clampCanvasZoom(
    transform.zoom,
    minimumZoom,
    maximumZoom,
  );
  const contentX = (anchor.x - transform.x) / currentZoom;
  const contentY = (anchor.y - transform.y) / currentZoom;
  return constrainCanvasTransform(
    {
      x: anchor.x - contentX * zoom,
      y: anchor.y - contentY * zoom,
      zoom,
    },
    viewport,
    content,
    minimumZoom,
    maximumZoom,
  );
}

export function fitCanvasZoom(
  viewport: CanvasSize,
  content: CanvasSize,
  minimumZoom = MINIMUM_CANVAS_ZOOM,
  maximumZoom = MAXIMUM_CANVAS_ZOOM,
): number {
  const widthZoom = viewport.width / Math.max(1, content.width);
  const heightZoom = viewport.height / Math.max(1, content.height);
  return clampCanvasZoom(
    Math.min(1, widthZoom, heightZoom),
    minimumZoom,
    maximumZoom,
  );
}

export function fitCanvasWidthZoom(
  viewport: CanvasSize,
  content: CanvasSize,
  minimumZoom = MINIMUM_CANVAS_ZOOM,
  maximumZoom = MAXIMUM_CANVAS_ZOOM,
): number {
  return clampCanvasZoom(
    viewport.width / Math.max(1, content.width),
    minimumZoom,
    maximumZoom,
  );
}

export function fitCanvasBoundsTransform(
  viewport: CanvasSize,
  content: CanvasSize,
  bounds: CanvasBounds,
  padding = 24,
  minimumZoom = MINIMUM_CANVAS_ZOOM,
  maximumZoom = MAXIMUM_CANVAS_ZOOM,
): CanvasViewportTransform {
  const safePadding = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  const availableWidth = Math.max(1, viewport.width - safePadding * 2);
  const availableHeight = Math.max(1, viewport.height - safePadding * 2);
  const boundsX = Number.isFinite(bounds.x) ? bounds.x : 0;
  const boundsY = Number.isFinite(bounds.y) ? bounds.y : 0;
  const boundsWidth = Number.isFinite(bounds.width)
    ? Math.max(1, bounds.width)
    : 1;
  const boundsHeight = Number.isFinite(bounds.height)
    ? Math.max(1, bounds.height)
    : 1;
  const zoom = clampCanvasZoom(
    Math.min(1, availableWidth / boundsWidth, availableHeight / boundsHeight),
    minimumZoom,
    maximumZoom,
  );
  return constrainCanvasTransform(
    {
      x: viewport.width / 2 - (boundsX + boundsWidth / 2) * zoom,
      y: viewport.height / 2 - (boundsY + boundsHeight / 2) * zoom,
      zoom,
    },
    viewport,
    content,
    minimumZoom,
    maximumZoom,
  );
}

export function wheelDeltaInPixels(
  delta: number,
  deltaMode: number,
  viewportExtent: number,
): number {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * viewportExtent;
  return delta;
}
