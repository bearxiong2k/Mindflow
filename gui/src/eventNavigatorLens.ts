const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
const smooth = (from: number, to: number, value: number) => {
  const t = clamp((value - from) / (to - from), 1);
  return t * t * (3 - 2 * t);
};

/** Settle at either Event edge without an abrupt change in caption velocity. */
const settleWithin = (value: number, max: number) => {
  const x = clamp(value, max);
  const edge = Math.min(32, max / 2);
  if (!edge) return 0;
  const ease = (distance: number) => {const t = distance / edge; return edge * t * t * (2 - t);};
  return x < edge ? ease(x) : x > max - edge ? max - ease(max - x) : x;
};

/** Put a history coordinate at the lens's absolute position on the bar. */
export function eventLensScrollLeft(focus: number, viewportWidth: number, contentWidth: number) {
  const total = Math.max(1, viewportWidth, contentWidth);
  return clamp(focus / total, 1) * Math.max(0, total - viewportWidth);
}

/** Keep the entire selected card readable even when the lens is close to an
 * endpoint: anchor within the card at its own absolute history proportion. */
export function eventLensSelectionLeft(start: number, end: number, viewportWidth: number, contentWidth: number) {
  const total = Math.max(1, viewportWidth, contentWidth);
  const span = Math.max(0, end - start);
  const focus = span < total ? start / (1 - span / total) : total / 2;
  return eventLensScrollLeft(focus, viewportWidth, total);
}

/** One continuous lens over the entire history. Its peak follows scroll
 * progress on the absolute bar; neither endpoint nor authored order moves.
 * Both sides have the same peak scale and zero scale derivative at the focus,
 * then contract smoothly all the way to their fixed endpoints. */
export function eventNavigatorLens(contentWidth: number, viewportWidth: number, scrollLeft: number) {
  const width = Math.max(1, viewportWidth);
  const total = Math.max(width, contentWidth);
  const left = clamp(scrollLeft, total - width);
  const progress = total > width ? left / (total - width) : 0;
  const focus = progress * total;
  const position = progress * width;
  const overviewScale = width / total;
  // Give a passing title a readable span, while a history that already fits
  // stays at its natural scale. The same continuous taper keeps context visible.
  const peak = 1 + 3 * (1 - overviewScale);
  const curve = Math.sqrt((peak / overviewScale) ** 2 - 1);
  return {
    width, total, left, progress, focus, position, peak,
    project(value: number) {
      const x = clamp(value, total);
      const side = x < focus ? -1 : 1;
      const extent = side < 0 ? focus : total - focus;
      const distance = Math.abs(x - focus);
      if (!extent || !distance) return position;
      return position + side * peak * distance / Math.hypot(1, curve * distance / extent);
    },
    unproject(value: number) {
      const x = clamp(value, width);
      const side = x < position ? -1 : 1;
      const extent = side < 0 ? focus : total - focus;
      const screenExtent = side < 0 ? position : width - position;
      if (!screenExtent) return focus;
      const fraction = clamp(Math.abs(x - position) / screenExtent, 1);
      // Factoring 1 - fraction² preserves precision near compressed endpoints.
      const distance = extent * fraction / Math.sqrt(1 + curve ** 2 * (1 - fraction) * (1 + fraction));
      return clamp(focus + side * distance, total);
    },
    scale(value: number) {
      const x = clamp(value, total);
      const extent = x < focus ? focus : total - focus;
      return extent ? peak / (1 + (curve * (x - focus) / extent) ** 2) ** 1.5 : peak;
    },
  };
}

export type EventNavigatorLens = ReturnType<typeof eventNavigatorLens>;

/** Every Event uses the same readable label, centered on the magnified focus
 * where space permits and settling inside its own interval at either edge. */
export function eventLensPlacement(lens: Pick<EventNavigatorLens, "project" | "position">, start: number, end: number, preferredWidth = 380) {
  const x = lens.project(start);
  const width = Math.max(0, lens.project(end) - x);
  const opacity = smooth(24, 82, width);
  const scale = 0.6 + 0.4 * smooth(28, 130, width);
  const innerWidth = Math.max(0, width - 2);
  const labelWidth = Math.min(preferredWidth, innerWidth / scale);
  const travel = Math.max(0, innerWidth - labelWidth * scale);
  const caption = settleWithin(lens.position - x - 1 - labelWidth * scale / 2, travel);
  return {x, width, opacity, scale, caption, labelWidth};
}
