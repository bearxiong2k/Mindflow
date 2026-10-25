import { qcSameWindow, type DocumentationQc, type QcWindow } from "./documentationQc.ts";

type Scope = { snapshot: string; pending: Map<string, Promise<DocumentationQc>> };
type Saved = { scope: Scope; report: DocumentationQc; cells: number };
const windowKey = (window: QcWindow) => window.kind === "recent"
  ? JSON.stringify([window.kind, window.commits]) : JSON.stringify([window.kind, window.start, window.end]);

/** Disposable webview cache. A refreshed or replaced scope cannot be repopulated
 * by a late request. Only completed successes are retained, within fixed limits. */
export function createDocumentationQcCache(
  fetchReport: (root: string, snapshot: string, window: QcWindow) => Promise<DocumentationQc>,
) {
  const scopes = new Map<string, Scope>();
  const saved = new Map<string, Saved>();
  const keyFor = (root: string, window: QcWindow) => JSON.stringify([root, windowKey(window)]);
  function invalidate(root: string) {
    const scope = scopes.get(root);
    scopes.delete(root);
    for (const [key, value] of saved) if (value.scope === scope) saved.delete(key);
  }
  function save(root: string, scope: Scope, report: DocumentationQc) {
    if (scopes.get(root) !== scope) return;
    const cells = report.entries.length * report.points.length;
    if (cells > 250_000) return;
    const key = keyFor(root, report.window);
    saved.delete(key);
    saved.set(key, { scope, report, cells });
    let total = [...saved.values()].reduce((sum, value) => sum + value.cells, 0);
    while (saved.size > 4 || total > 250_000) {
      const oldest = saved.keys().next().value!;
      total -= saved.get(oldest)!.cells;
      saved.delete(oldest);
    }
  }
  function peek(root: string, snapshot: string, window: QcWindow): DocumentationQc | undefined {
    const scope = scopes.get(root);
    if (!scope || scope.snapshot !== snapshot) return;
    const key = keyFor(root, window);
    const found = saved.get(key);
    if (found?.scope === scope) return found.report;
    // A smaller recent window is an exact suffix of a completed larger one.
    // Reset its first comparison so baseline churn is never counted twice.
    if (window.kind !== "recent") return;
    for (const value of saved.values()) {
      const report = value.report;
      if (value.scope !== scope || report.window.kind !== "recent" || report.window.commits < window.commits) continue;
      const start = Math.max(0, report.points.length - window.commits - 1);
      const selected: DocumentationQc = { ...report, window,
        history_truncated: report.history_truncated || start > 0,
        points: report.points.slice(start),
        entries: report.entries.map((entry) => ({ ...entry, samples: entry.samples.slice(start)
          .map((sample, index) => index ? sample : { ...sample, added_lines: null, deleted_lines: null }) })),
      };
      save(root, scope, selected);
      return selected;
    }
  }
  function load(root: string, snapshot: string, window: QcWindow): Promise<DocumentationQc> {
    const cached = peek(root, snapshot, window);
    if (cached) return Promise.resolve(cached);
    let scope = scopes.get(root);
    if (scope?.snapshot !== snapshot) {
      invalidate(root);
      scope = { snapshot, pending: new Map() };
      scopes.set(root, scope);
      while (scopes.size > 4) invalidate(scopes.keys().next().value!);
    }
    const owner = scope;
    const key = windowKey(window);
    const pending = owner.pending.get(key);
    if (pending) return pending;
    const request = fetchReport(root, snapshot, window).then((report) => {
      if (report.root !== root || report.snapshot.id !== snapshot
          || report.schema !== "mindflow-documentation-qc/v2" || !qcSameWindow(report.window, window)) {
        throw new Error("QC observation no longer matches this Region. Refresh the project and try again.");
      }
      save(root, owner, report);
      return report;
    }).finally(() => { owner.pending.delete(key); });
    owner.pending.set(key, request);
    return request;
  }
  return { load, peek, invalidate };
}
