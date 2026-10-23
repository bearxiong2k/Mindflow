import { useEffect, useMemo, useRef, useState } from "react";
import { loadDocumentationQc } from "../api";
import { qcRows, qcSummary, qcHasWorkingTree, type DocumentationQc, type QcEntry, type QcWindow } from "../documentationQc";
import { CloseIcon } from "./Icons";
import { QcWindowSelector } from "./QcWindowSelector";
import { HelpOnly } from "./InterfaceHelp";
import "../documentationQc.css";

const number = (value: number) => value.toLocaleString();
const signed = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${number(value)}`;
const bytes = (value: number) => value < 1024 ? `${value} B` : `${(value / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB`;

function VolumeChart({ report, entry }: { report: DocumentationQc; entry: QcEntry }) {
  const svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(950);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const resize = new ResizeObserver(([observed]) => {
      if (observed.contentRect.width > 0) setWidth(Math.max(320, observed.contentRect.width));
    });
    resize.observe(element);
    return () => resize.disconnect();
  }, []);
  const [sampleIndex, setSampleIndex] = useState(entry.samples.length - 1);
  const index = Math.min(sampleIndex, entry.samples.length - 1);
  const sample = entry.samples[index];
  const point = report.points[index];
  const maximum = Math.max(1, ...entry.samples.map((value) => value.lines));
  const x = (position: number) => 48 + (entry.samples.length === 1 ? 0.5 : position / (entry.samples.length - 1)) * (width - 70);
  const y = (lines: number) => 145 - (lines / maximum) * 125;
  const line = entry.samples.map((value, position) => `${x(position)},${y(value.lines)}`).join(" ");
  return (
    <div className="qc-chart">
      <div className="qc-chart__heading">
        <div><span className="qc-eyebrow">Volume · source lines</span><h3 title={entry.path}>{entry.path || "All registered documents"}</h3></div>
        <label>Sample
          <select aria-label="QC chart sample" value={index} onChange={(event) => setSampleIndex(Number(event.target.value))}>
            {report.points.map((value, position) => <option key={value.commit ?? "working"} value={position}>
              {value.commit ? `${value.commit.slice(0, 7)} · ${value.subject}` : "Working tree"}{position === 0 && value.commit ? " · baseline" : ""}
            </option>)}
          </select>
        </label>
      </div>
      <svg ref={svg} viewBox={`0 0 ${width} 177`} role="img" aria-label={`Source line volume for ${entry.path || "all registered documents"} across ${report.points.length} samples`}>
        {[0, 0.5, 1].map((fraction) => <g key={fraction}>
          <line className="qc-chart__grid" x1="48" x2={width - 22} y1={y(maximum * fraction)} y2={y(maximum * fraction)} />
          <text className="qc-chart__axis" x="38" y={y(maximum * fraction) + 4} textAnchor="end">{number(Math.round(maximum * fraction))}</text>
        </g>)}
        <polygon className="qc-chart__area" points={`${x(0)},145 ${line} ${x(entry.samples.length - 1)},145`} />
        <polyline className="qc-chart__line" points={line} />
        {entry.samples.map((value, position) => <g key={position} onClick={() => setSampleIndex(position)} className="qc-chart__point">
          <circle cx={x(position)} cy={y(value.lines)} r="12" fill="transparent" />
          <circle className={position === index ? "is-selected" : ""} cx={x(position)} cy={y(value.lines)} r={position === index ? 5 : 3} />
          <title>{report.points[position].subject}: {number(value.lines)} lines</title>
        </g>)}
        <text className="qc-chart__axis" x="48" y="169">{report.points[0].commit ? `${report.points[0].commit.slice(0, 7)} · baseline` : "No Git baseline"}</text>
        <text className="qc-chart__axis" x={width - 22} y="169" textAnchor="end">{qcHasWorkingTree(report) ? "Working tree" : `${report.points.at(-1)!.commit!.slice(0, 7)} · end`}</text>
      </svg>
      <div className="qc-chart__readout" aria-live="polite">
        <strong>{number(sample.lines)} lines</strong><span>{bytes(sample.bytes)}</span>
        <span>{sample.added_lines === null ? "No earlier comparison" : `+${number(sample.added_lines)} / −${number(sample.deleted_lines ?? 0)} lines since previous sample`}</span>
        <span>{sample.documents} {sample.documents === 1 ? "document" : "documents"}</span>
      </div>
      <p className="qc-chart__commit" title={point.commit ?? "Captured working tree"}>
        {point.commit ? <><code>{point.commit.slice(0, 12)}</code> · {point.timestamp !== null ? new Date(point.timestamp * 1000).toLocaleString() : ""} · {point.subject}</> : <>Working tree<HelpOnly> · captured on load or Refresh</HelpOnly></>}
      </p>
    </div>
  );
}

export function DocumentationQcView({ root, snapshot, generation, onClose, onRead }: {
  root: string; snapshot: string; generation: number; onClose: () => void; onRead: (path: string) => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeButton.current?.focus(); }, []);
  const [window, setWindow] = useState<QcWindow>({ kind: "recent", commits: 30 });
  const [request, setRequest] = useState<{ key: string; report?: DocumentationQc; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  const [scope, setScope] = useState("");
  const [selected, setSelected] = useState("");
  const [kind, setKind] = useState<"file" | "directory">("file");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"volume" | "growth" | "churn" | "path">("volume");
  const key = JSON.stringify([root, snapshot, generation, window, attempt]);
  useEffect(() => {
    let disposed = false;
    loadDocumentationQc(root, snapshot, window).then(
      (report) => { if (!disposed) setRequest({ key, report }); },
      (error: unknown) => { if (!disposed) setRequest({ key, error: String(error) }); },
    );
    return () => { disposed = true; };
  }, [root, snapshot, window, key]);
  const report = request?.key === key ? request.report : undefined;
  const error = request?.key === key ? request.error : undefined;
  const folders = useMemo(() => report?.entries.filter((entry) => entry.kind === "directory") ?? [], [report]);
  const activeScope = folders.some((entry) => entry.path === scope) ? scope : "";
  const entry = report?.entries.find((value) => value.path === selected)
    ?? report?.entries.find((value) => value.path === activeScope);
  const includesWorkingTree = report ? qcHasWorkingTree(report) : false;
  const summary = entry ? qcSummary(entry, includesWorkingTree) : undefined;
  const rows = useMemo(() => report ? qcRows(report, activeScope, kind, query, sort) : [], [report, activeScope, kind, query, sort]);
  const maxLines = Math.max(1, ...rows.map((row) => row.summary.current.lines));
  const changeScope = (path: string) => { setScope(path); setSelected(path); };

  return (
    <section className="documentation-qc" aria-label="Documentation QC">
      <header className="qc-header">
        <div><span className="qc-eyebrow">Documentation</span><h2>Volume & growth</h2></div>
        <button ref={closeButton} type="button" className="qc-close" onClick={onClose} aria-label="Close Documentation QC"><CloseIcon /></button>
      </header>
      <div className="qc-body">
        <QcWindowSelector key={`${root}:${snapshot}:${generation}`} root={root} snapshot={snapshot} window={window} onChange={setWindow} />
        {!report && !error ? <p className="qc-state" role="status">Measuring documentation and Git history…</p> : null}
        {error ? <div className="qc-state" role="alert"><p>{error}</p><button onClick={() => setAttempt((value) => value + 1)}>Retry</button></div> : null}
        {report && entry && summary ? <>
          <HelpOnly><p className="qc-scope-note">Current registered documents · {report.points.filter((point) => point.kind === "commit").length} commits{includesWorkingTree ? " + working edits" : " · historical range"}</p></HelpOnly>
          {report.shallow_history ? <p className="qc-scope-note" role="status">Shallow Git history</p> : null}
          <div className="qc-summary" aria-label="Selected scope measurements">
            <div><span>{includesWorkingTree ? "Current volume" : "Volume at range end"}</span><strong>{number(summary.current.lines)} <small>lines</small></strong><span>{bytes(summary.current.bytes)} · {summary.current.documents} {summary.current.documents === 1 ? "document" : "documents"}</span></div>
            <div><span>Net growth</span><strong>{signed(summary.growth)} <small>lines</small></strong>{summary.growth === null ? <span>{includesWorkingTree ? "No Git comparison yet" : "No comparison interval"}</span> : <HelpOnly><span>since baseline</span></HelpOnly>}</div>
            <div><span>Lines changed</span><strong>{summary.growth === null ? "—" : <><span className="qc-added">+{number(summary.added)}</span> <span className="qc-deleted">−{number(summary.deleted)}</span></>}</strong><span>{summary.growth === null ? (includesWorkingTree ? "No Git comparison yet" : "No comparison interval") : `${summary.changedCommits} changed commits`}{includesWorkingTree && (summary.current.added_lines ?? 0) + (summary.current.deleted_lines ?? 0) > 0 ? " + working edits" : ""}</span></div>
          </div>
          <VolumeChart key={`${key}:${entry.path}`} report={report} entry={entry} />
          <div className="qc-filters">
            <label>Folder<select aria-label="QC folder" value={activeScope} onChange={(event) => changeScope(event.target.value)}>
              {folders.map((folder) => <option key={folder.path} value={folder.path}>{folder.path || "All folders"}</option>)}
            </select></label>
            <label>Show<select aria-label="QC entry type" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="file">Files</option><option value="directory">Subfolders</option></select></label>
            <label>Sort<select aria-label="QC sort" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="volume">Largest first</option><option value="growth">Most growth</option><option value="churn">Most changes</option><option value="path">Path</option></select></label>
            <label className="qc-search">Find<input aria-label="Find QC path" type="search" placeholder="Filter paths…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          </div>
          <div className="qc-table-scroll"><table className="qc-table">
            <caption>{rows.length} {kind === "file" ? "files" : "direct subfolders"}</caption>
            <thead><tr><th scope="col">{kind === "file" ? "Document" : "Folder"}</th><th scope="col">{includesWorkingTree ? "Lines now" : "Lines at end"}</th><th scope="col">Net growth</th><th scope="col">Added / deleted</th><th scope="col" title="Commits with line changes after the baseline, excluding working edits">Commits changed</th><th scope="col"><span className="qc-action-label">Open</span></th></tr></thead>
            <tbody>{rows.map(({ entry: row, summary: value }) => <tr key={row.path} className={row.path === entry.path ? "is-selected" : ""}>
              <td><button className="qc-path" onClick={() => setSelected(row.path)} aria-pressed={row.path === entry.path} title={row.path}>{row.path}{row.kind === "directory" ? "/" : ""}</button></td>
              <td><span className="qc-volume-bar" style={{ width: `${value.current.lines / maxLines * 100}%` }} /><span className="qc-cell-value">{number(value.current.lines)}</span></td>
              <td>{signed(value.growth)}</td><td>{value.growth === null ? "—" : <><span className="qc-added">+{number(value.added)}</span> / <span className="qc-deleted">−{number(value.deleted)}</span></>}</td><td>{value.growth === null ? "—" : value.changedCommits}</td>
              <td><button className="qc-open" onClick={() => row.kind === "file" ? onRead(row.path) : changeScope(row.path)} aria-label={`${row.kind === "file" ? (includesWorkingTree ? "Read" : "Read current") : "Browse"} ${row.path}`}>{row.kind === "file" ? (includesWorkingTree ? "Read ↗" : "Read current ↗") : "Browse →"}</button></td>
            </tr>)}</tbody>
          </table>{rows.length === 0 ? <p className="qc-state">No {kind === "file" ? "documents" : "subfolders"} match this view.</p> : null}</div>
          <HelpOnly><aside className="qc-method" aria-label="Measurement notes">
            <p>Lines include blank lines and Markdown syntax; bytes use UTF-8. Growth is measured from the baseline. Added/deleted lines show total activity.</p>
            <p>Only current registered paths are included. Folder totals count each document once. Renames are not followed, removed documents are excluded, and missing paths count as zero.</p>
            <p>History follows first-parent commits with equal spacing. Working edits are captured on load or Refresh.</p>
          </aside></HelpOnly>
        </> : null}
      </div>
    </section>
  );
}
