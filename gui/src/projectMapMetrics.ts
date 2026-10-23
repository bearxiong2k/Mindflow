import type { ProjectComponent } from "./types";
import { QC_PRESETS, qcHasWorkingTree, qcSummary, type DocumentationQc, type QcEntry, type QcPoint } from "./documentationQc.ts";

export function normalizeStructureMetricsCommits(value: unknown): number {
  return typeof value === "number" && QC_PRESETS.some((count) => count === value) ? value : 30;
}

export interface ProjectMapTrendSample { x: number; y: number; lines: number; index: number }

/** WebKit's tspan.getBBox() includes the whole text block, not just that row. */
export function projectMapMetricTextBounds(
  text: Pick<SVGTextContentElement, "getNumberOfChars" | "getExtentOfChar">,
) {
  const count = text.getNumberOfChars();
  if (!count) return undefined;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let index = 0; index < count; index += 1) {
    const glyph = text.getExtentOfChar(index);
    if (![glyph.x, glyph.y, glyph.width, glyph.height].every(Number.isFinite)) return undefined;
    left = Math.min(left, glyph.x);
    top = Math.min(top, glyph.y);
    right = Math.max(right, glyph.x + glyph.width);
    bottom = Math.max(bottom, glyph.y + glyph.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Geometry uses equally spaced samples and a padded, node-local line-volume scale. */
export function projectMapTrendGeometry(values: readonly number[], width = 112, height = 24) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
    || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Structure trend requires nonnegative finite volumes and positive chart dimensions");
  }
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 0;
  // At least ten percent of the maximum volume prevents a one-line edit in a
  // large document from filling the chart. Padding keeps endpoints visible.
  const span = Math.max(1, maximum - minimum, maximum * 0.1);
  const midpoint = (minimum + maximum) / 2;
  const minLines = Math.max(0, midpoint - span * 0.6);
  const maxLines = Math.max(midpoint + span * 0.6, minLines + span * 1.2);
  const insetX = Math.min(2, width / 4);
  const insetY = Math.min(2, height / 4);
  const samples: ProjectMapTrendSample[] = values.map((lines, index) => ({
    x: insetX + (values.length === 1 ? 0.5 : index / (values.length - 1)) * (width - 2 * insetX),
    y: height - insetY - (lines - minLines) / (maxLines - minLines) * (height - 2 * insetY),
    lines, index,
  }));
  const coordinate = (value: number) => Number(value.toFixed(4));
  const points = samples.map(({ x, y }) => `${coordinate(x)},${coordinate(y)}`).join(" ");
  const linePath = samples.map(({ x, y }, index) => `${index ? "L" : "M"}${coordinate(x)},${coordinate(y)}`).join(" ");
  const hasHistory = samples.length > 1;
  const first = samples[0];
  const last = samples.at(-1);
  const areaPath = hasHistory
    ? `${linePath} L${coordinate(last!.x)},${coordinate(height - insetY)} L${coordinate(first.x)},${coordinate(height - insetY)} Z`
    : "";
  return {
    width, height, samples, points, linePath, areaPath, minLines, maxLines, hasHistory,
    baselineY: hasHistory ? first.y : null,
    endpoint: last ? { x: last.x, y: last.y } : null,
  };
}

function qcPointDescription(point: QcPoint): string {
  if (point.kind === "working-tree") return "captured working tree, including uncommitted edits";
  const date = point.timestamp === null ? "" : ` at ${new Date(point.timestamp * 1000).toISOString()}`;
  return `${point.commit}${date}: ${point.subject}`;
}

export function projectMapMetric(entry: QcEntry, report?: DocumentationQc) {
  if (!entry.samples.length) throw new Error("Structure metric requires at least one observed sample");
  const includesWorkingTree = report?.points ? qcHasWorkingTree(report) : true;
  const { current, growth, added, deleted } = qcSummary(entry, includesWorkingTree);
  const direction: "growth" | "shrink" | "flat" | "unknown" = growth === null ? "unknown"
    : growth > 0 ? "growth" : growth < 0 ? "shrink" : "flat";
  const signedGrowth = growth === null ? "—" : `${growth > 0 ? "+" : ""}${growth.toLocaleString()}`;
  const baseline = report?.points?.[0]?.kind === "commit" ? report.points[0] : undefined;
  const end = report?.points?.at(-1);
  const commitsCovered = report?.points?.filter((point) => point.kind === "commit").length;
  const historyDetails = report?.points ? [
    `${commitsCovered} first-parent commits${includesWorkingTree ? " plus captured working tree" : ""}`,
    baseline ? `Baseline ${qcPointDescription(baseline)}` : "No Git baseline",
    end ? `End ${qcPointDescription(end)}` : "",
    report.shallow_history ? "Shallow Git history" : "",
    report.history_truncated ? "Selected history window" : "",
  ].filter(Boolean) : [];
  const description = [
    `${current.lines.toLocaleString()} source lines, ${current.bytes.toLocaleString()} UTF-8 bytes`,
    entry.kind === "directory" ? `${current.documents} registered documents beneath this folder` : "Registered document",
    growth === null ? "No Git growth baseline" : `${signedGrowth} lines net growth since the oldest displayed commit; ${added.toLocaleString()} added and ${deleted.toLocaleString()} deleted lines${includesWorkingTree ? ", including captured working edits" : ""}`,
    ...historyDetails,
    "Trend uses equally spaced samples and a padded scale specific to this node, with a minimum span of 10% of its maximum volume",
    "Current registered document paths only; renames are not followed",
  ].join(". ");
  const size = current.bytes < 1024 ? `${current.bytes} B` : `${(current.bytes / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB`;
  const volumeLabel = `${current.lines.toLocaleString()} lines · ${size}`;
  const growthLabel = growth === null ? "Growth — · no baseline" : `Δ ${signedGrowth} · +${added.toLocaleString()} / −${deleted.toLocaleString()}`;
  return {
    lines: current.lines.toLocaleString(), lineCountLabel: `${current.lines.toLocaleString()} lines`,
    signedGrowth, growth, description, volumeLabel, growthLabel,
    kind: entry.kind, currentLines: current.lines, bytes: current.bytes,
    addedLines: added, deletedLines: deleted, direction,
    trend: projectMapTrendGeometry(entry.samples.map((sample) => sample.lines)),
    baseline, end, commitsCovered, includesWorkingTree,
  };
}

export type ProjectMapMetric = ReturnType<typeof projectMapMetric>;
export interface ProjectMapMetrics {
  key: string;
  byComponentId: ReadonlyMap<string, ProjectMapMetric>;
}

export function projectMapMetrics(components: readonly ProjectComponent[], report?: DocumentationQc): ProjectMapMetrics | undefined {
  if (!report) return undefined;
  const byPath = new Map(report.entries.map((entry) => [entry.path, entry]));
  const byComponentId = new Map<string, ProjectMapMetric>();
  for (const component of components) {
    if (component.kind === "target" || !component.binding) continue;
    const path = component.binding.value === "." ? "" : component.binding.value;
    const entry = byPath.get(path);
    if (!entry || (component.kind === "document" && (!component.managed || entry.kind !== "file"))
      || (component.kind === "directory" && entry.kind !== "directory")) continue;
    byComponentId.set(component.id, projectMapMetric(entry, report));
  }
  return { key: `${report.snapshot.id}:${JSON.stringify(report.window)}`, byComponentId };
}

/** Volume bars compare only the visible measured entries of the same kind. */
export function projectMapVolumeComparisons(metrics: ProjectMapMetrics, visibleComponentIds: Iterable<string>) {
  const visible = [...new Set(visibleComponentIds)].flatMap((id) => {
    const metric = metrics.byComponentId.get(id);
    return metric ? [{ id, metric }] : [];
  });
  const groups = new Map<QcEntry["kind"], { maximumLines: number; peerCount: number }>();
  for (const { metric } of visible) {
    const group = groups.get(metric.kind) ?? { maximumLines: 0, peerCount: 0 };
    group.maximumLines = Math.max(group.maximumLines, metric.currentLines);
    group.peerCount += 1;
    groups.set(metric.kind, group);
  }
  return new Map(visible.map(({ id, metric }) => {
    const group = groups.get(metric.kind)!;
    return [id, { ...group, ratio: group.maximumLines ? metric.currentLines / group.maximumLines : 0 }] as const;
  }));
}
