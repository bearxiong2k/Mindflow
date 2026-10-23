import { useEffect, useRef, useState } from "react";
import { loadDocumentationQcHistory } from "../api";
import { QC_PRESETS, type QcPoint, type QcWindow } from "../documentationQc";
import { HelpOnly } from "./InterfaceHelp";

function commitLabel(point: QcPoint) {
  const date = point.timestamp === null ? "" : new Date(point.timestamp * 1000).toLocaleDateString();
  return `${point.commit!.slice(0, 8)} · ${date} · ${point.subject}`;
}

export function QcWindowSelector({ root, snapshot, window, onChange }: {
  root: string; snapshot: string; window: QcWindow; onChange: (window: QcWindow) => void;
}) {
  const [custom, setCustom] = useState(window.kind === "range");
  const [history, setHistory] = useState<QcPoint[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [start, setStart] = useState(window.kind === "range" ? window.start : "");
  const [end, setEnd] = useState(window.kind === "range" ? window.end : "working-tree");
  const live = useRef(true);
  const request = useRef(0);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const load = async (offset: number) => {
    const id = ++request.current;
    setLoading(true);
    setError("");
    try {
      const page = await loadDocumentationQcHistory(root, snapshot, offset);
      if (!live.current || request.current !== id) return;
      setHistory((current) => offset === 0 ? page.commits : [...current, ...page.commits]);
      setMore(page.has_more);
      if (offset === 0) setStart((current) => current || page.commits[Math.min(29, page.commits.length - 1)]?.commit || "");
    } catch (failure) {
      if (live.current && request.current === id) setError(String(failure));
    } finally {
      if (live.current && request.current === id) setLoading(false);
    }
  };
  // Mounted with a snapshot key by the owner. Only custom selection needs commit metadata.
  useEffect(() => { if (custom && !history.length && !loading && !error) void load(0); }, [custom]);
  const startIndex = history.findIndex((point) => point.commit === start);
  const endIndex = end === "working-tree" ? 0 : history.findIndex((point) => point.commit === end);
  const reversed = startIndex >= 0 && endIndex >= 0 && startIndex < endIndex;
  const count = startIndex >= 0 && endIndex >= 0 ? startIndex - endIndex + 1 : null;
  const overLimit = count !== null && count > 500;
  return <div className="qc-window-selector">
    <label>History window<select aria-label="QC history window" value={custom ? "custom" : window.kind === "recent" ? window.commits : "custom"}
      onChange={(event) => {
        const selected = event.target.value;
        setCustom(selected === "custom");
        if (selected !== "custom") onChange({ kind: "recent", commits: Number(selected) });
      }}>
      {QC_PRESETS.map((count) => <option key={count} value={count}>Last {count} commits</option>)}
      <option value="custom">Custom commit range</option>
    </select></label>
    {custom ? <div className="qc-custom-range">
      <div className="qc-range-fields">
        <label>From · baseline<select aria-label="QC start commit" value={start} disabled={!history.length} onChange={(event) => setStart(event.target.value)}>
          {!history.some((point) => point.commit === start) ? <option value={start}>{start ? start.slice(0, 12) : "Choose a commit"}</option> : null}
          {history.map((point) => <option key={point.commit} value={point.commit!}>{commitLabel(point)}</option>)}
        </select></label>
        <label>Through<select aria-label="QC end commit" value={end} onChange={(event) => setEnd(event.target.value)}>
          <option value="working-tree">Working tree</option>
          {end !== "working-tree" && !history.some((point) => point.commit === end) ? <option value={end}>{end.slice(0, 12)}</option> : null}
          {history.map((point) => <option key={point.commit} value={point.commit!}>{commitLabel(point)}</option>)}
        </select></label>
        <button type="button" className="qc-range-apply" disabled={!start || reversed || overLimit || loading}
          onClick={() => onChange({ kind: "range", start, end })}>Apply range</button>
      </div>
      <div className="qc-range-help">
        {reversed || overLimit ? <span role="alert">{reversed ? "Start must be at or before end." : "Choose at most 500 commits."}</span> : <HelpOnly><span>Inclusive range · up to 500 commits</span></HelpOnly>}
        {more && !loading ? <button type="button" onClick={() => void load(history.length)}>Load older commits</button> : null}
        {loading ? <span role="status">Loading commits…</span> : null}
        {!loading && !error && !history.length ? <span>No commits in this snapshot.</span> : null}
      </div>
      {error ? <div className="qc-range-error" role="alert">{error} <button type="button" onClick={() => void load(history.length)}>Retry commit choices</button></div> : null}
    </div> : null}
  </div>;
}
