// SVG labels need explicit breaks before measuring their graph geometry. Keep
// this independent of the DOM so graph preparation never introduces layout reads.
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const openingPunctuation = /^[([{‘“（［｛〈《「『【〔]$/u;
const closingPunctuation = /^[)\]}’”）］｝〉》」』】〕、。，．！？：；,.!?;:%…]$/u;
const cjkCharacter = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

interface LabelUnit {
  text: string;
  width: number;
  trailingSpace: number;
}

function graphemeWidth(value: string) {
  if (value === " ") return 0.32;
  const base = value.normalize("NFD").replace(/\p{Mark}/gu, "");
  if (/[^\x00-\x7f]/u.test(base)) return 1;
  if (/^[ilI1|!.,:;'`]$/u.test(base)) return 0.3;
  if (/^[mwMW@#%&]$/u.test(base)) return 0.95;
  if (/^[A-Z]$/u.test(base)) return 0.68;
  return 0.56;
}

function labelUnit(text: string): LabelUnit {
  let width = 0;
  for (const { segment } of graphemeSegmenter.segment(text)) width += graphemeWidth(segment);
  return { text, width, trailingSpace: text.endsWith(" ") ? 0.32 : 0 };
}

function safeBoundary(previous: string, next: string) {
  return !openingPunctuation.test(previous) && !closingPunctuation.test(next);
}

/** Greedy line count, then two linear passes balance adjacent lines. */
function balancedRanges(units: LabelUnit[], maximumWidth: number) {
  const widths = [0];
  for (const unit of units) widths.push(widths[widths.length - 1] + unit.width);
  const width = (start: number, end: number) =>
    widths[end] - widths[start] - units[end - 1].trailingSpace;
  const ranges: Array<[number, number]> = [];
  let start = 0;
  for (let end = 1; end <= units.length; end += 1) {
    if (end > start + 1 && width(start, end) > maximumWidth) {
      ranges.push([start, end - 1]);
      start = end - 1;
    }
  }
  ranges.push([start, units.length]);
  const balance = (index: number) => {
    const start = ranges[index][0];
    const end = ranges[index + 1][1];
    let cut = ranges[index][1];
    let difference = Math.abs(width(start, cut) - width(cut, end));
    for (let candidate = start + 1; candidate < end; candidate += 1) {
      const left = width(start, candidate);
      const right = width(candidate, end);
      const nextDifference = Math.abs(left - right);
      if (left <= maximumWidth && right <= maximumWidth && nextDifference < difference) {
        cut = candidate;
        difference = nextDifference;
      }
    }
    ranges[index][1] = cut;
    ranges[index + 1][0] = cut;
  };
  for (let index = 0; index < ranges.length - 1; index += 1) balance(index);
  for (let index = ranges.length - 2; index >= 0; index -= 1) balance(index);
  return ranges;
}

function emergencyUnits(text: string, maximumWidth: number) {
  const graphemes = [...graphemeSegmenter.segment(text)].map(({ segment }) => segment);
  const extensionStart = /\.[a-z\d]{1,8}\s?$/iu.test(text)
    ? Math.max(0, graphemes.lastIndexOf(".") - 1) : graphemes.length;
  const units: LabelUnit[] = [];
  let start = 0;
  for (let index = 1; index <= graphemes.length; index += 1) {
    if (index < graphemes.length &&
      (index > extensionStart || !safeBoundary(graphemes[index - 1], graphemes[index]))) continue;
    units.push(labelUnit(graphemes.slice(start, index).join("")));
    start = index;
  }
  return balancedRanges(units, maximumWidth).map(([start, end]) =>
    labelUnit(units.slice(start, end).map(({ text }) => text).join("")));
}

/**
 * Keep words, path/name segments, punctuation, and graphemes intact whenever
 * they fit. An oversized identifier falls back to balanced grapheme chunks.
 * Width is a conservative em estimate; no authored characters are discarded.
 */
export function wrapLabelText(value: string, maximumWidth: number): string[] {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized) return [];
  const limit = Number.isFinite(maximumWidth) ? Math.max(1, maximumWidth) : 13.6;
  const graphemes = [...graphemeSegmenter.segment(normalized)].map(({ segment }) => segment);
  // A final extension belongs with the filename's preceding segment. Earlier
  // dots in package names and dotted identifiers are useful natural boundaries.
  const lastDot = graphemes.lastIndexOf(".");
  const units: LabelUnit[] = [];
  let start = 0;
  for (let index = 1; index <= graphemes.length; index += 1) {
    if (index < graphemes.length) {
      const previous = graphemes[index - 1];
      const next = graphemes[index];
      const natural = previous === " " || /[-_/\\]/u.test(previous) ||
        (previous === "." && index - 1 !== lastDot) ||
        (/^[a-z]$/u.test(previous) && /^[A-Z]$/u.test(next)) ||
        cjkCharacter.test(previous) || cjkCharacter.test(next);
      if (!natural || next === " " || !safeBoundary(previous, next)) continue;
    }
    const unit = labelUnit(graphemes.slice(start, index).join(""));
    units.push(...(unit.width - unit.trailingSpace <= limit ? [unit] : emergencyUnits(unit.text, limit)));
    start = index;
  }
  return balancedRanges(units, limit).map(([start, end]) =>
    units.slice(start, end).map(({ text }) => text).join("").trim());
}
