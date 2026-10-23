export const MINIMUM_CANVAS_TEXT_SCALE = 0.8;
export const MAXIMUM_CANVAS_TEXT_SCALE = 1.4;
export const CANVAS_TEXT_SCALE_STEP = 0.1;

export function normalizeCanvasTextScale(
  value: unknown,
  fallback = 1,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(
    Math.min(
      MAXIMUM_CANVAS_TEXT_SCALE,
      Math.max(MINIMUM_CANVAS_TEXT_SCALE, value),
    ) * 10,
  ) / 10;
}

export function stepCanvasTextScale(
  current: number,
  direction: -1 | 1,
): number {
  return normalizeCanvasTextScale(
    current + direction * CANVAS_TEXT_SCALE_STEP,
  );
}
