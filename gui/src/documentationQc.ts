import type { SnapshotIdentity } from "./types";

export interface QcSample {
  documents: number;
  lines: number;
  bytes: number;
  added_lines: number | null;
  deleted_lines: number | null;
}
export interface QcEntry {
  path: string;
  kind: "file" | "directory";
  component: string | null;
  samples: QcSample[];
}
export const QC_PRESETS = [5, 10, 20, 30, 50, 100] as const;
export type QcWindow = { kind: "recent"; commits: number }
  | { kind: "range"; start: string; end: string };
export interface QcPoint {
  kind: "commit" | "working-tree";
  commit: string | null;
  timestamp: number | null;
  subject: string;
}
export interface QcHistory {
  schema: "mindflow-documentation-qc-history/v1";
  root: string;
  snapshot: SnapshotIdentity;
  offset: number;
  has_more: boolean;
  commits: QcPoint[];
}
export interface DocumentationQc {
  schema: "mindflow-documentation-qc/v2";
  root: string;
  snapshot: SnapshotIdentity;
  window: QcWindow;
  history_truncated: boolean;
  shallow_history: boolean;
  points: QcPoint[];
  entries: QcEntry[];
}
export function qcHasWorkingTree(report: DocumentationQc) {
  return report.points.at(-1)?.kind === "working-tree";
}
export function qcSameWindow(left: QcWindow, right: QcWindow) {
  return left.kind === "recent" && right.kind === "recent" ? left.commits === right.commits
    : left.kind === "range" && right.kind === "range" && left.start === right.start && left.end === right.end;
}
export function qcSummary(entry: QcEntry, includesWorkingTree = true) {
  const current = entry.samples.at(-1)!;
  const baseline = entry.samples.length > 1 ? entry.samples[0] : undefined;
  const added = entry.samples.reduce((sum, sample) => sum + (sample.added_lines ?? 0), 0);
  const deleted = entry.samples.reduce((sum, sample) => sum + (sample.deleted_lines ?? 0), 0);
  const changedCommits = entry.samples.slice(1, includesWorkingTree ? -1 : undefined).filter((sample) =>
    (sample.added_lines ?? 0) + (sample.deleted_lines ?? 0) > 0).length;
  return { current, growth: baseline ? current.lines - baseline.lines : null,
    added, deleted, churn: added + deleted, changedCommits };
}

export function qcRows(
  report: DocumentationQc, scope: string, kind: "file" | "directory", query: string,
  sort: "volume" | "growth" | "churn" | "path",
) {
  const prefix = scope ? `${scope}/` : "";
  const needle = query.trim().toLocaleLowerCase();
  return report.entries.filter((entry) => entry.kind === kind && entry.path !== scope
    && entry.path.startsWith(prefix) && entry.path.toLocaleLowerCase().includes(needle)
    && (kind === "file" || !entry.path.slice(prefix.length).includes("/")))
    .map((entry) => ({ entry, summary: qcSummary(entry, qcHasWorkingTree(report)) }))
    .sort((left, right) => {
      const value = sort === "volume" ? right.summary.current.lines - left.summary.current.lines
        : sort === "growth" ? (right.summary.growth ?? 0) - (left.summary.growth ?? 0)
        : sort === "churn" ? right.summary.churn - left.summary.churn : 0;
      return value || left.entry.path.localeCompare(right.entry.path);
    });
}
