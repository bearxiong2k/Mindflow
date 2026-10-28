import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { visibleEventPoints, type EventPoint } from "../eventTimeline";
import { openingLinePath, visibleOpeningLines, type OpeningTimeline, type OpeningTraceTarget, type openingTrace } from "../openingTimeline";
import type { TimelineViewport, timelineCommitTickGroups } from "../timelineInteraction";
import type { TimelineCommit } from "../types";

type Trace = ReturnType<typeof openingTrace>;
interface Props {
  topology: OpeningTimeline;
  layout: OpeningTimeline;
  viewport: TimelineViewport;
  anchorX?: number;
  anchorName?: string;
  commitTicks: ReturnType<typeof timelineCommitTickGroups>;
  commits: TimelineCommit[];
  selectedCommit?: string;
  selectedTrace: Trace;
  traceSelected: boolean;
  hoverTrace: Trace;
  onCommit: (hash: string) => void;
  onEvent: (point: EventPoint) => void;
  onFile: (component: string, interval: string) => void;
  onHover: (target?: OpeningTraceTarget) => void;
}

// Native scrolling carries the overscanned SVG between tile boundaries. Prose,
// hover changes elsewhere, and individual scroll pixels cannot redraw its paths.
export const OpeningTimelineCanvas = memo(function OpeningTimelineCanvas({topology, layout, viewport, anchorX, anchorName,
  commitTicks, commits, selectedCommit, selectedTrace, traceSelected, hoverTrace, onCommit, onEvent, onFile, onHover}: Props) {
  const svg = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const element = svg.current;
    if (!element) return;
    // Folding changes the horizontal coordinates. Apply those paths together
    // without interpolating between histories or remounting every SVG node.
    element.classList.add("is-changing");
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => element.classList.remove("is-changing"));
    });
    return () => cancelAnimationFrame(frame);
  }, [topology]);
  const shownPoints = useMemo(() => visibleEventPoints(layout.points, viewport.left, viewport.width), [layout.points, viewport]);
  const shownLines = useMemo(() => visibleOpeningLines(layout.lines, viewport.left, viewport.top, viewport.width, viewport.height), [layout.lines, viewport]);
  const firstLineByFile = useMemo(() => new Map([...shownLines].reverse().map(line => [line.component, line.key])), [shownLines]);
  return <svg ref={svg} className="timeline-lines timeline-opening-lines" width={viewport.width} height={viewport.height}
    style={{left: viewport.left, top: viewport.top}}
    viewBox={`${viewport.left} ${viewport.top} ${Math.max(1, viewport.width)} ${Math.max(1, viewport.height)}`}>
    {anchorX !== undefined ? <g className="timeline-anchor-pin" aria-label={`Pinned Anchor ${anchorName}`}>
      <rect x={anchorX - 9} width={18} height={layout.height} rx={6} /><line x1={anchorX} x2={anchorX} y1={0} y2={layout.height} />
      <text x={anchorX + 8} y={24}>{anchorName}</text>
    </g> : null}
    {commitTicks.filter(tick => tick.x >= viewport.left - 8 && tick.x <= viewport.left + viewport.width + 8).map(tick =>
      <g key={`commit:${tick.first}`} className={`timeline-commit-tick${selectedCommit && commits.slice(tick.first, tick.last + 1).some(item => item.commit === selectedCommit) ? " is-selected" : ""}`}
        role="button" tabIndex={0} aria-label={`${(tick.last - tick.first + 1)} Git ${(tick.last - tick.first + 1) === 1 ? "commit" : "commits"}, starting ${commits[tick.first]?.commit.slice(0, 8)}`}
        onClick={() => onCommit(commits[tick.first].commit)} onKeyDown={e => {if (e.key === "Enter" || e.key === " ") {e.preventDefault();onCommit(commits[tick.first].commit);}}}>
        <title>{(tick.last - tick.first + 1) === 1 ? `${commits[tick.first].subject}\n${commits[tick.first].commit}` : `${(tick.last - tick.first + 1)} Git commits; inspect to browse messages and exact hashes`}</title>
        <rect x={tick.x - 4} y={0} width={8} height={14} /><line x1={tick.x} x2={tick.x} y1={3} y2={10} />
      </g>)}
    {shownPoints.map(item => <line key={`guide:${item.event.component}`} className="timeline-flow-guide"
      x1={item.x} x2={item.x} y1={0} y2={layout.height} aria-hidden="true" />)}
    {shownLines.map(line => {
      const owner = layout.fileById.get(line.component)!;
      const active = selectedTrace.intervals.has(line.interval);
      const preview = hoverTrace.intervals.has(line.interval);
      return <OpeningLifeline key={line.key} component={line.component} interval={line.interval}
        path={owner.path} color={owner.color} d={openingLinePath(line)}
        className={`timeline-file-line${active ? " is-selected" : traceSelected ? " is-muted" : ""}${preview ? " is-previewed" : ""}${line.kind === "current" ? " is-current" : ""}`}
        tabIndex={firstLineByFile.get(line.component) === line.key ? 0 : -1}
        endX={line.kind === "current" ? line.end : undefined} endY={line.kind === "current" ? line.y : undefined}
        onFile={onFile} onHover={onHover} />;
    })}
    {shownPoints.filter(item => item.junctionY !== undefined && item.junctionY >= viewport.top - 20 && item.junctionY <= viewport.top + viewport.height + 20).map(item =>
      <g key={`junction:${item.event.component}`} role="button" tabIndex={-1} aria-label={`Read ${item.event.name}`}
        className={`timeline-flow-event${selectedTrace.events.has(item.event.component) ? " is-selected" : ""}${hoverTrace.events.has(item.event.component) ? " is-previewed" : ""}`}
        onMouseEnter={() => onHover({kind: "event", component: item.event.component})} onMouseLeave={() => onHover(undefined)}
        onClick={() => onEvent(item)}>
        <title>{item.event.name}</title><circle className="timeline-flow-event__ring" cx={item.x} cy={item.junctionY} r={item.event.children.length ? 7 : 5} /><circle className="timeline-flow-event__dot" cx={item.x} cy={item.junctionY} r={2.2} />
        <text x={item.x} y={item.junctionY! - 12} textAnchor="middle">{item.end - item.start > 1 ? `${item.end - item.start} Events` : `E${item.start + 1}`}</text>
      </g>)}
    <line className="timeline-present-line" x1={layout.presentX - 20} x2={layout.presentX - 20} y1={5} y2={layout.height} />
    <text className="timeline-present-label" x={layout.presentX - 20} y={14} textAnchor="end">Now</text>
  </svg>;
});

// Compare the visible geometry, not freshly projected line objects. Moving to
// another Event boundary often leaves most lifelines completely unchanged.
const OpeningLifeline = memo(function OpeningLifeline({component, interval, path, color, d, className, tabIndex, endX, endY, onFile, onHover}: {
  component: string; interval: string; path: string; color: string; d: string;
  className: string; tabIndex: number; endX?: number; endY?: number;
  onFile: Props["onFile"]; onHover: Props["onHover"];
}) {
  return <g className={className} style={{color}} role="button" tabIndex={tabIndex} aria-label={`Follow ${path}`}
    onKeyDown={e => {if (e.key === "Enter" || e.key === " ") {e.preventDefault(); onFile(component, interval);}}}
    onMouseEnter={() => onHover({kind: "file", component, interval})} onMouseLeave={() => onHover(undefined)}
    onFocus={() => onHover({kind: "file", component, interval})} onBlur={() => onHover(undefined)}
    onClick={() => onFile(component, interval)}>
    <title>{path}</title><path className="timeline-file-line__hit" d={d} />
    <path className="timeline-file-line__stroke" d={d} />
    {endX !== undefined ? <circle className="timeline-open-end" cx={endX} cy={endY} r={3} /> : null}
  </g>;
});
