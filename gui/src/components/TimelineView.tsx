import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type PointerEvent,
} from "react";
import { loadDocument, loadProjectImage } from "../api";
import {
  eventRows, visibleEventSelection, evolveInspectorHeight, DEFAULT_EVOLVE_INSPECTOR_HEIGHT,
  timelineCommitPage, type EventPoint,
} from "../eventTimeline";
import { buildOpeningTimeline, projectOpeningTimeline, openingFocusBoundary, openingTrace, openingEvidenceBoundaries, FILE_LANE_HEIGHT, type OpeningTraceTarget } from "../openingTimeline";
import { DEFAULT_EVOLVE_RAIL_WIDTH, resizeEvolveRail, timelineAnchorPosition, timelineCommitTickPositions, timelineCommitTickGroups, centeredTimelineScrollLeft, timelineRenderWindow, TIMELINE_RENDER_TILE } from "../timelineInteraction";
import type { AnchorTimelineSlice, GraphData, Opening, TimelineCommit } from "../types";
import { readerNavigationMode, type ReaderNavigationMode } from "../readerNavigation";
import { ReaderMarkdown, ReaderImageLoaderContext } from "./DocumentInspector";
import { CloseIcon, ChevronIcon, AnchorIcon, LayersIcon } from "./Icons";
import { HelpOnly } from "./InterfaceHelp";
import { useTimelineRailMotion, type RetiringOpeningFile } from "./useTimelineRailMotion";
import { WorkspaceBanner } from "./WorkspaceBanner";
import { OpeningTimelineCanvas } from "./OpeningTimelineCanvas";
import { EventNavigator } from "./EventNavigator";
import { createTimelineScrollSync } from "../timelineScroll";
import { eventNavigatorLens, eventLensScrollLeft, eventLensSelectionLeft } from "../eventNavigatorLens";
import { EVENT_LAYERS_HEIGHT } from "../eventLayers";
import type { EventLensHandle } from "./EventLens";

interface Props {
  root: string;
  snapshot: string;
  graph: GraphData;
  opening: Opening;
  expandedEvents: string[];
  onExpandedEventsChange: (ids: string[]) => void;
  railWidth: number;
  onRailWidthChange: (width: number) => void;
  inspectorHeight: number;
  onInspectorHeightChange: (height: number) => void;
  anchorTimeline: AnchorTimelineSlice[];
  commits: TimelineCommit[];
  historyLoading: boolean;
  historyError?: string;
  onRetryHistory: () => void;
  onSelect: (path: string, mode?: ReaderNavigationMode, fragment?: string) => void;
  onClose: () => void;
}

type EvidenceSelection = {kind: "git"} | {kind: "anchor"; name: string} | {kind: "commit"; commit: string} | {kind: "file"; component: string; interval?: string};

export function TimelineView({root, snapshot, graph, opening, expandedEvents, onExpandedEventsChange,
  railWidth, onRailWidthChange, inspectorHeight, onInspectorHeightChange, anchorTimeline, commits, historyLoading,
  historyError, onRetryHistory, onSelect, onClose}: Props) {
  const [selected, setSelected] = useState<string>();
  const [evidence, setEvidence] = useState<EvidenceSelection | undefined>({kind: "git"});
  const lastGitSelection = useRef<EvidenceSelection>({kind: "git"});
  const gitActive = evidence?.kind === "git" || evidence?.kind === "anchor" || evidence?.kind === "commit";
  const expanded = useMemo(() => new Set(expandedEvents), [expandedEvents]);
  const rows = useMemo(() => eventRows(graph.events, expanded), [graph.events, expanded]);
  const [viewport, setViewport] = useState({left: 0, top: 0, width: 900, height: 500});
  const [historyPosition, setHistoryPosition] = useState(0);
  const historyPositionRef = useRef(0);
  const topology = useMemo(() => buildOpeningTimeline(graph, opening, expanded), [graph, opening, expanded]);
  const focusedBoundary = openingFocusBoundary(topology, viewport.left + viewport.width - 16);
  const layout = useMemo(() => projectOpeningTimeline(topology, focusedBoundary), [topology, focusedBoundary]);
  const retiringFiles = useTimelineRailMotion(layout.files);
  const canvasHeight = Math.max(layout.height, ...retiringFiles.map(file => file.y + FILE_LANE_HEIGHT));
  const selection = useMemo(() => visibleEventSelection(rows, graph.events, selected), [rows, graph.events, selected]);
  const point = selection ? layout.byId.get(selection) : undefined;
  const anchor = evidence?.kind === "anchor" ? graph.anchors[evidence.name] : undefined;
  const commit = evidence?.kind === "commit" ? commits.find(item => item.commit === evidence.commit)
    : evidence?.kind === "git" ? commits.at(-1) : undefined;
  const file = evidence?.kind === "file" ? layout.fileById.get(evidence.component) : undefined;
  const event = gitActive || file || !selected ? undefined : point?.event;
  const workspace = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const eventStrip = useRef<HTMLDivElement>(null);
  const eventLens = useRef<EventLensHandle>(null);
  const fileRail = useRef<HTMLDivElement>(null);
  const [scrollSync] = useState(() => createTimelineScrollSync(viewport));
  const lastViewport = useRef(viewport);
  const scrollIdle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focusAfterLayout = useRef(false);
  const foldAnchor = useRef<string | undefined>(undefined);
  const renderColumn = Math.floor(viewport.left / TIMELINE_RENDER_TILE);
  const renderRow = Math.floor(viewport.top / TIMELINE_RENDER_TILE);
  const renderWindow = useMemo(() => timelineRenderWindow({left: renderColumn * TIMELINE_RENDER_TILE,
    top: renderRow * TIMELINE_RENDER_TILE, width: viewport.width, height: viewport.height}),
    [renderColumn, renderRow, viewport.width, viewport.height]);
  const shownFiles = useMemo(() => layout.files.filter(file => file.y >= viewport.top - FILE_LANE_HEIGHT && file.y <= viewport.top + viewport.height + FILE_LANE_HEIGHT), [layout, viewport.top, viewport.height]);
  const [availableHeight, setAvailableHeight] = useState(600);
  const [availableWidth, setAvailableWidth] = useState(1000);
  const fittedRailWidth = resizeEvolveRail(railWidth, 0, availableWidth);
  const railDrag = useRef<{pointerId: number; x: number; width: number; scale: number; current: number} | undefined>(undefined);
  const [hover, setHover] = useState<OpeningTraceTarget>();
  const selectedTraceTarget = useMemo<OpeningTraceTarget | undefined>(() => file && evidence?.kind === "file" ? evidence
    : event ? {kind: "event", component: event.component} : undefined, [file, evidence, event]);
  const selectedTrace = useMemo(() => openingTrace(topology, selectedTraceTarget), [topology, selectedTraceTarget]);
  const hoverTrace = useMemo(() => openingTrace(topology, hover, true), [topology, hover]);
  const hoveredEvent = hover?.kind === "event" ? layout.byId.get(hover.component) : undefined;
  const hoveredParent = hoveredEvent?.parent ? topology.byId.get(hoveredEvent.parent) : undefined;
  const hoveredFile = hover?.kind === "file" ? topology.fileById.get(hover.component) : undefined;
  const pendingPin = useRef(false);
  const boundaries = useMemo(() => openingEvidenceBoundaries(topology), [topology]);
  const commitPositions = useMemo(() => timelineCommitTickPositions(commits.map(commit => commit.event_boundary),
    boundaries.positions, 8, topology.presentX), [commits, boundaries, topology.presentX]);
  const commitTicks = useMemo(() => timelineCommitTickGroups(commitPositions), [commitPositions]);
  const anchorName = evidence?.kind === "anchor" && anchor ? evidence.name : undefined;
  const anchorBoundary = anchorTimeline.find(slice => slice.name === anchorName)?.event_boundary;
  const anchorPin = anchor ? timelineAnchorPosition(anchorBoundary == null ? undefined : boundaries.positions[anchorBoundary],
    anchor.commit, commits, commitPositions) : undefined;
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => setCopyState("idle"), [commit?.commit]);
  useEffect(() => setHover(undefined), [topology]);
  const panelHeight = evolveInspectorHeight(inspectorHeight, availableHeight);
  const drag = useRef<{pointerId: number; y: number; height: number; scale: number; current: number} | undefined>(undefined);
  const cache = useRef(new Map<string, string>());
  const pending = useRef(new Map<string, Promise<string>>());
  const [retry, setRetry] = useState(0);
  const [read, setRead] = useState<{key: string; content?: string; error?: string}>();
  const key = JSON.stringify([root, snapshot, event?.file]);
  const loadImage = useCallback((path: string) => loadProjectImage(root, snapshot, path), [root, snapshot]);
  const [linkPreview, setLinkPreview] = useState<string>();
  const previewLink = useCallback((_source: "pointer" | "focus", address?: string) => setLinkPreview(address), []);
  const [commitIndex, setCommitIndex] = useState(0);
  useEffect(() => {if (evidence?.kind === "git") setCommitIndex(Math.max(0, commits.length - 1));}, [commits, evidence?.kind]);
  const commitPage = timelineCommitPage(commits.length, commitIndex);
  const [fileEventIndex, setFileEventIndex] = useState<{component: string; index: number}>();
  const fileEvents = useMemo(() => file ? layout.points.filter(point =>
    point.predecessors.includes(file.component) || point.successors.includes(file.component)) : [], [layout, file]);
  const fileEventPage = timelineCommitPage(fileEvents.length, fileEventIndex?.component === file?.component ? fileEventIndex?.index ?? 0 : 0);
  const ancestry = useMemo(() => {
    const result: EventPoint[] = [];
    let parent = point?.parent;
    while (parent) {
      const ancestor = layout.byId.get(parent);
      if (!ancestor) break;
      result.unshift(ancestor);
      parent = ancestor.parent;
    }
    return result;
  }, [layout, point]);

  const publishViewport = useCallback((next: typeof viewport | undefined, nativeScroll: boolean, explicitFocus?: number) => {
    if (!next && explicitFocus === undefined) return;
    const view = next ?? lastViewport.current;
    const horizontal = lastViewport.current.left !== view.left || lastViewport.current.width !== view.width;
    const focus = Math.max(0, Math.min(topology.width, explicitFocus ?? (horizontal && topology.width > view.width
      ? eventNavigatorLens(topology.width, view.width, view.left).focus : historyPositionRef.current)));
    const moved = lastViewport.current.left !== view.left || lastViewport.current.top !== view.top || historyPositionRef.current !== focus;
    lastViewport.current = view;
    historyPositionRef.current = focus;
    eventLens.current?.update(focus);
    setHistoryPosition(focus);
    if (nativeScroll && moved && workspace.current) {
      if (workspace.current.dataset.scrolling !== "true") workspace.current.dataset.scrolling = "true";
      clearTimeout(scrollIdle.current);
      scrollIdle.current = setTimeout(() => { delete workspace.current?.dataset.scrolling; }, 120);
    }
    if (moved) setHover(undefined);
    if (next) setViewport(next);
  }, [topology.width]);
  const scrollers = useCallback(() => canvas.current && eventStrip.current && fileRail.current
    ? {canvas: canvas.current, events: eventStrip.current, files: fileRail.current} : undefined, []);
  const updateViewport = useCallback(() => {
    const ports = scrollers();
    if (!ports) return;
    const next = scrollSync.measure(ports);
    if (next && next.width !== lastViewport.current.width) {
      // Retain the logical position through resize, including transitions
      // between a fully fitted history and one with native overflow.
      const focus = Math.min(topology.width, historyPositionRef.current);
      ports.canvas.scrollLeft = eventLensScrollLeft(focus, next.width, topology.width);
      publishViewport(scrollSync.align(ports) ?? next, false, focus);
    } else publishViewport(next, false);
  }, [scrollers, scrollSync, publishViewport, topology.width]);
  const scrollCanvas = useCallback(() => {
    const ports = scrollers();
    if (ports) publishViewport(scrollSync.scroll("canvas", ports), true);
  }, [scrollers, scrollSync, publishViewport]);
  const scrollEvents = useCallback(() => {
    const ports = scrollers();
    if (ports) publishViewport(scrollSync.scroll("events", ports), true);
  }, [scrollers, scrollSync, publishViewport]);
  const scrollFiles = useCallback(() => {
    const ports = scrollers();
    if (ports) publishViewport(scrollSync.scroll("files", ports), true);
  }, [scrollers, scrollSync, publishViewport]);
  const previewEvent = useCallback((component?: string) => {
    if (!workspace.current?.dataset.scrolling) setHover(component ? {kind: "event", component} : undefined);
  }, []);
  useEffect(() => () => clearTimeout(scrollIdle.current), []);
  useLayoutEffect(() => {
    const element = canvas.current;
    const container = workspace.current;
    if (!element || !container) return;
    const observer = new ResizeObserver(() => {
      updateViewport();
      const chrome = [...container.querySelectorAll<HTMLElement>(".workspace-banner, .timeline-panel-resize")]
        .reduce((height, element) => height + element.offsetHeight, 0);
      setAvailableHeight(container.clientHeight - chrome);
      setAvailableWidth(container.clientWidth);
    });
    observer.observe(element);
    observer.observe(container);
    return () => observer.disconnect();
  }, [updateViewport]);

  const currentLayout = useRef(layout);
  useLayoutEffect(() => { currentLayout.current = layout; }, [layout]);
  const reveal = useCallback((target: EventPoint) => {
    const element = canvas.current;
    if (!element) return;
    const focus = eventLens.current?.selectionFocus(target.event.component);
    element.scrollLeft = focus === undefined
      ? eventLensSelectionLeft(target.x - 10, target.x + 130, element.clientWidth, element.scrollWidth)
      : eventLensScrollLeft(focus, element.clientWidth, currentLayout.current.width);
    const junction = currentLayout.current.byId.get(target.event.component)?.junctionY;
    if (junction !== undefined) {
      if (junction < element.scrollTop + 24) element.scrollTop = Math.max(0, junction - 60);
      else if (junction > element.scrollTop + element.clientHeight - 24) element.scrollTop = junction - element.clientHeight + 60;
    }
    const strip = eventStrip.current;
    if (strip) {
      if (target.y < strip.scrollTop) strip.scrollTop = target.y;
      else if (target.y + 28 > strip.scrollTop + strip.clientHeight) strip.scrollTop = target.y + 28 - strip.clientHeight;
    }
    const ports = scrollers();
    if (ports) publishViewport(scrollSync.measure(ports), false, focus);
  }, [scrollers, scrollSync, publishViewport]);
  useLayoutEffect(() => {
    const folded = foldAnchor.current;
    if (folded && canvas.current) {
      const target = layout.byId.get(folded);
      foldAnchor.current = undefined;
      if (target) reveal(target);
    } else if ((focusAfterLayout.current || (selected && selected !== selection)) && point) {
      focusAfterLayout.current = false;
      reveal(point);
    }
  }, [layout, point, selected, selection, reveal, updateViewport]);
  // Only a topology change can clamp the canvas. Lane projection during a
  // scroll must not synchronously measure the just-rendered SVG again.
  useLayoutEffect(updateViewport, [topology, updateViewport]);

  useEffect(() => {
    if (!event) return;
    let active = true;
    const cached = cache.current.get(key);
    if (cached !== undefined) {
      // A pending read can finish between render and this effect.
      setRead(previous => previous?.key === key && previous.content === cached ? previous : {key, content: cached});
      return;
    }
    setRead(previous => previous?.key === key && previous.error ? undefined : previous);
    let request = pending.current.get(key);
    if (!request) {
      request = loadDocument(root, event.file, snapshot).then(document => {
        pending.current.delete(key);
        // Retain a completed selected read even if navigation has moved on.
        // Exact snapshot keys and this small cap also apply to late results.
        if (document.content.length <= 256 * 1024) {
          if (cache.current.size >= 8) cache.current.delete(cache.current.keys().next().value!);
          cache.current.set(key, document.content);
        }
        return document.content;
      }, error => { pending.current.delete(key); throw error; });
      pending.current.set(key, request);
    }
    void request.then(content => {
      if (!active) return;
      setRead({key, content});
    }, error => { if (active) setRead({key, error: String(error)}); });
    return () => { active = false; };
  }, [root, snapshot, event?.file, key, retry]);
  useEffect(() => setLinkPreview(undefined), [key]);

  const select = useCallback((target: EventPoint, keepView = false) => {
    setHover(undefined);
    setSelected(target.event.component);
    setEvidence(undefined);
    if (!keepView) reveal(target);
  }, [reveal]);
  const selectFile = useCallback((component: string, interval: string) => setEvidence({kind: "file", component, interval}), []);
  const toggle = useCallback((id: string) => {
    setHover(undefined);
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(id);
    setEvidence(undefined);
    if (topology.byId.has(id)) foldAnchor.current = id;
    onExpandedEventsChange([...next]);
  }, [expanded, topology, onExpandedEventsChange]);
  function beginResize(e: PointerEvent<HTMLDivElement>) {
    const container = workspace.current;
    if (!container || !e.isPrimary || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus({preventScroll: true});
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {pointerId: e.pointerId, y: e.clientY, height: panelHeight, current: panelHeight,
      scale: container.clientHeight / container.getBoundingClientRect().height};
  }
  function moveResize(e: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== e.pointerId) return;
    current.current = evolveInspectorHeight(current.height + (e.clientY - current.y) * current.scale, availableHeight);
    workspace.current?.style.setProperty("--timeline-inspector-panel-height", `${current.current}px`);
    e.currentTarget.setAttribute("aria-valuenow", String(current.current));
  }
  function finishResize(e: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== e.pointerId) return;
    drag.current = undefined;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onInspectorHeightChange(current.current);
  }
  const cachedContent = cache.current.get(key);
  const document = cachedContent !== undefined ? {key, content: cachedContent, error: undefined} : read?.key === key ? read : undefined;
  const centerOn = useCallback((x: number) => {
    const element = canvas.current;
    if (!element) return;
    element.scrollLeft = centeredTimelineScrollLeft(x, element.clientWidth, element.scrollWidth);
    updateViewport();
  }, [updateViewport]);
  const focusHistory = useCallback((x: number) => {
    const ports = scrollers();
    if (!ports) return;
    // Scrubbing uses the measured bounds and the same immediate lane motion
    // as native scrolling; it does not remeasure the canvas on every move.
    ports.canvas.scrollLeft = eventLensScrollLeft(x, lastViewport.current.width, currentLayout.current.width);
    publishViewport(scrollSync.align(ports), true, x);
  }, [scrollers, scrollSync, publishViewport]);
  useLayoutEffect(() => {
    if (!pendingPin.current) return;
    if (anchorPin) centerOn(anchorPin.x);
    pendingPin.current = false;
  }, [anchorName, anchorPin?.x, layout, centerOn]);
  function selectAnchor(name: string) {
    if (anchorName === name) {setEvidence({kind: "git"}); lastGitSelection.current = {kind: "git"}; return;}
    const boundary = anchorTimeline.find(slice => slice.name === name)?.event_boundary;
    const component = boundary == null ? undefined : boundaries.components[boundary];
    if (component) {
      const parents = new Map(graph.events.flatMap(event => event.children.map(child => [child, event.component] as const)));
      const next = new Set(expanded);
      if (graph.events.find(event => event.component === component)?.children.length) next.add(component);
      for (let parent = parents.get(component); parent; parent = parents.get(parent)) next.add(parent);
      if (next.size !== expanded.size) onExpandedEventsChange([...next]);
    }
    pendingPin.current = true;
    lastGitSelection.current = {kind: "anchor", name};
    setEvidence(lastGitSelection.current);
  }
  const selectCommit = useCallback((hash: string) => {
    lastGitSelection.current = {kind: "commit", commit: hash};
    setEvidence(lastGitSelection.current);
    const index = commits.findIndex(item => item.commit === hash);
    setCommitIndex(index);
    if (commitPositions[index]) centerOn(commitPositions[index].x);
  }, [commits, commitPositions, centerOn]);
  function openGitEvidence() {
    if (gitActive) return;
    const previous = lastGitSelection.current;
    if (previous.kind === "anchor" && graph.anchors[previous.name]) selectAnchor(previous.name);
    else if (previous.kind === "commit" && commits.some(commit => commit.commit === previous.commit)) selectCommit(previous.commit);
    else setEvidence({kind: "git"});
  }
  function beginRailResize(e: PointerEvent<HTMLDivElement>) {
    if (!e.isPrimary || e.button !== 0 || !workspace.current) return;
    e.preventDefault();e.currentTarget.focus({preventScroll: true});e.currentTarget.setPointerCapture(e.pointerId);
    railDrag.current = {pointerId: e.pointerId, x: e.clientX, width: fittedRailWidth, current: fittedRailWidth,
      scale: workspace.current.clientWidth / workspace.current.getBoundingClientRect().width};
  }
  function moveRailResize(e: PointerEvent<HTMLDivElement>) {
    const drag = railDrag.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    drag.current = resizeEvolveRail(drag.width, (e.clientX - drag.x) * drag.scale, availableWidth);
    workspace.current?.style.setProperty("--timeline-entry-rail-width", `${drag.current}px`);
    e.currentTarget.setAttribute("aria-valuenow", String(drag.current));
  }
  function finishRailResize(e: PointerEvent<HTMLDivElement>) {
    const drag = railDrag.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    railDrag.current = undefined;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onRailWidthChange(drag.current);
  }

  return <section className="timeline-workspace" ref={workspace} aria-label="Evolve"
    style={{"--timeline-inspector-panel-height": `${panelHeight}px`, "--timeline-entry-rail-width": `${fittedRailWidth}px`} as CSSProperties}>
    <WorkspaceBanner ariaLabel="Evolve summary" className="timeline-summary" multiline trailing={
      <button type="button" className="timeline-close" aria-label="Close Evolve and return to Structure" title="Return to Structure" onClick={onClose}><CloseIcon /><span>Structure</span></button>
    }>
      <div className="timeline-navigation" role="toolbar" aria-label="Evolve navigation">
        <strong className="timeline-summary__title">Evolve</strong>
        <div className="timeline-navigation__mode" role="group" aria-label="Inspector content">
          <button type="button" aria-pressed={!gitActive} aria-label="Show Event discussions" onClick={() => {setEvidence(undefined);if (point) reveal(point);}}>Events <small>{graph.events.length}</small></button>
          <button type="button" aria-pressed={gitActive} aria-label="Git evidence" onClick={openGitEvidence}>Git <small>{commits.length || (historyLoading ? "…" : "")}</small></button>
        </div>
        <div className="timeline-navigation__travel" role="group" aria-label="Navigate the timeline">
          <button type="button" aria-label="First Event" title="First Event · Home" disabled={!rows.length} onClick={() => {select(layout.points[0]); focusHistory(0);}}><ChevronIcon className="timeline-nav-first" /></button>
          <button type="button" aria-label="Previous Event" title="Previous Event · ↑" disabled={!point || point.ordinal <= 1} onClick={() => select(layout.points[point!.ordinal - 2])}><ChevronIcon className="timeline-nav-previous" /></button>
          <button type="button" aria-label="Next Event" title="Next Event · ↓" disabled={!point || point.ordinal >= rows.length} onClick={() => select(layout.points[point!.ordinal])}><ChevronIcon /></button>
          <button type="button" aria-label="Present" title="Present Opening" onClick={() => {lastGitSelection.current = {kind: "git"};setEvidence(lastGitSelection.current);focusHistory(layout.width);}}>Present <span aria-hidden="true">→</span></button>
        </div>
        <button type="button" className="timeline-navigation__overview" aria-label="Fold all summaries" title="Return to the summary overview" disabled={!expandedEvents.length} onClick={() => {focusAfterLayout.current = true; onExpandedEventsChange([]);}}><LayersIcon size={13} /> Overview</button>
      </div>
      <HelpOnly><p className="timeline-summary__help">Select an Event to read it. Its chevron folds the discussion and file flow together. Each Event level has its own zoom, coordinated at one history position. Scroll horizontally or drag a row for coarse or fine navigation; use its +/− controls or ⌘/Ctrl + scroll to zoom. Scroll vertically to reach deeper levels. The bottom ruler moves through the whole history. Focus a level number for arrow-key navigation and +/− zoom; 0 resets it. Git marks open exact evidence. In the Event tree, arrow keys navigate; Space folds; Enter opens Reader.</p></HelpOnly>
    </WorkspaceBanner>

    <section className={`timeline-inspector${gitActive ? " timeline-inspector--git" : ""}`} aria-label={anchor ? "Anchor evidence" : commit ? "Commit evidence" : gitActive ? "Git evidence inspector" : file ? "Opening file history" : "Event discussion"}>
      <header className="timeline-inspector__heading">
        <span className="timeline-inspector__kind">{commit ? "Commit" : gitActive ? "Git evidence" : file ? "File history" : event?.children.length ? "Summary" : event ? "Event" : "Evolve"}</span>
        {event && ancestry.length ? <nav className="timeline-ancestry" aria-label="Event summaries">{ancestry.map(ancestor =>
          <button type="button" key={ancestor.event.component} title={ancestor.event.file} onClick={() => select(ancestor)}>{ancestor.event.name.replace(/\.md$/, "")}<span aria-hidden="true"> ›</span></button>)}</nav> : null}
        <strong title={event?.file ?? anchor?.file ?? file?.path ?? commit?.commit}>{event?.name.replace(/\.md$/, "") ?? anchorName ?? (commit ? commit.subject || "Empty commit message" : undefined) ?? file?.name ?? (gitActive ? "Anchors and commits" : "Opening evolution")}</strong>
        {event && point && (point.predecessors.length || point.successors.length) ? <span className="timeline-participants" aria-label="Opening transition" title={expanded.has(event.component) || !event.children.length ? "Recorded Opening transition" : "Folded Opening effect"}>{point.predecessors.length} → {point.successors.length} files</span> : null}
        {event || anchor || file?.managed ? <button type="button" className="timeline-reader-action" onClick={e => onSelect(event?.file ?? anchor?.file ?? file!.path, readerNavigationMode(e))}>Open in Reader <span aria-hidden="true">↗</span></button> : null}
      </header>
      <div className="timeline-inspector__body">
        {gitActive ? <TimelineGitBrowser anchors={graph.anchors} commits={commits} selectedAnchor={anchorName} selectedCommit={commit?.commit}
          page={commitPage} onPage={setCommitIndex} onAnchor={selectAnchor} onCommit={selectCommit}
          loading={historyLoading} error={historyError} onRetry={onRetryHistory} /> : null}
        <div className="timeline-inspector__content" key={event?.component ?? anchorName ?? commit?.commit ?? file?.component ?? "git"}>
          {event ? <>
            <ReaderImageLoaderContext.Provider value={loadImage}><ReaderMarkdown currentPath={event.file} content={document?.content ?? ""}
              loading={document?.content === undefined && !document?.error} loadingLabel="Reading Event…" error={document?.error}
              onSelect={onSelect} onPreviewLink={previewLink} /></ReaderImageLoaderContext.Provider>
            {document?.error ? <button type="button" onClick={() => {setRead(undefined);setRetry(value => value + 1);}}>Retry reading</button> : null}
          </> : anchor ? <div className="timeline-evidence-detail">
            <p>{anchor.description}</p><code>{anchor.commit}</code>
            <p>{alignmentLabel(anchorBoundary)}</p><p>{anchorPin?.kind === "commit" ? "Pinned at its Git commit, independently of Event alignment." : anchorPin ? "Pinned at its Event boundary. Select this Anchor again to release the pin." : "No position is available in this displayed history."}</p>
            <p>{anchor.connections.length} historical {anchor.connections.length === 1 ? "connection" : "connections"}</p>
            {anchor.connections.map((connection, index) => <p key={index}><span>{connection.type}</span> · <code>{connection.target}</code></p>)}
          </div> : commit ? <div className="timeline-evidence-detail timeline-commit-detail">
            <div className="timeline-commit-identity"><code>{commit.commit}</code> <button type="button" onClick={async () => {
              try {await copyTimelineText(commit.commit); setCopyState("copied");} catch {setCopyState("failed");}
            }}>{copyState === "copied" ? "Copied" : "Copy commit"}</button></div>
            {copyState === "failed" ? <span role="status">Copy unavailable; select the hash above.</span> : null}
            <pre className="timeline-commit-message">{commit.message || "(empty commit message)"}</pre>
            <dl className="timeline-commit-metadata">
              <dt>Author</dt><dd>{commit.author.name} <span>{commit.author.email}</span></dd>
              <dt>Authored</dt><dd><CommitDate value={commit.author.date} /></dd>
              {commit.committer.name !== commit.author.name || commit.committer.email !== commit.author.email || commit.committer.date !== commit.author.date ? <>
                <dt>Committer</dt><dd>{commit.committer.name} <span>{commit.committer.email}</span></dd>
                <dt>Committed</dt><dd><CommitDate value={commit.committer.date} /></dd>
              </> : null}
              <dt>{commit.parents.length > 1 ? "Parents" : "Parent"}</dt><dd>{commit.parents.length ? commit.parents.map(parent => <code key={parent}>{parent}</code>) : "Root commit"}</dd>
            </dl>
            <HelpOnly><p>{alignmentLabel(commit.event_boundary)}</p></HelpOnly>
          </div>
            : file ? <div className="timeline-file-history">
              <p>{file.current ? "In the current Opening." : "Outside the current Opening."} {file.managed ? "" : "Historical identity; exact older bytes remain in Git."}</p>
              {fileEvents.slice(fileEventPage.start, fileEventPage.end).map(point =>
                <button type="button" key={point.event.component} onClick={() => select(point)}>{point.event.name.replace(/\.md$/, "")}</button>)}
              {fileEvents.length > 32 ? <nav aria-label="File Event pages">
                <button type="button" disabled={fileEventPage.start === 0} onClick={() => setFileEventIndex({component: file.component, index: fileEventPage.start - 1})}>Previous Events</button>
                <span>{fileEventPage.start + 1}–{fileEventPage.end} of {fileEvents.length}</span>
                <button type="button" disabled={fileEventPage.end === fileEvents.length} onClick={() => setFileEventIndex({component: file.component, index: fileEventPage.end})}>Next Events</button>
              </nav> : null}
              {!file.recorded ? <p>No file transitions are recorded for this current selection.</p> : null}
            </div> : gitActive ? <div className="timeline-evidence-detail"><p>Select an Anchor or commit here, or a Git mark on the timeline.</p><p>Git records exact versions independently of authored Event discussions.</p></div>
            : <p className="timeline-empty">Select an Event to read its discussion, or an Opening file to inspect its history.</p>}
        </div>
      </div>
      {linkPreview && event ? <div className="timeline-link-preview">{linkPreview}</div> : null}
    </section>

    <div className="timeline-panel-resize" role="separator" aria-label="Resize Event reading panel" aria-orientation="horizontal"
      aria-valuemin={120} aria-valuemax={Math.max(120, availableHeight - 180)} aria-valuenow={panelHeight} tabIndex={0}
      onPointerDown={beginResize} onPointerMove={moveResize} onPointerUp={finishResize} onPointerCancel={finishResize} onLostPointerCapture={finishResize}
      onDoubleClick={() => onInspectorHeightChange(DEFAULT_EVOLVE_INSPECTOR_HEIGHT)} onKeyDown={e => {
        const value = e.key === "ArrowDown" ? panelHeight + 16 : e.key === "ArrowUp" ? panelHeight - 16
          : e.key === "Home" ? 120 : e.key === "End" ? availableHeight - 180 : undefined;
        if (value !== undefined) {e.preventDefault(); onInspectorHeightChange(evolveInspectorHeight(value, availableHeight));}
      }} />

    <div className="timeline-result timeline-result--opening" style={{"--event-strip-height": `${Math.max(56, Math.min(EVENT_LAYERS_HEIGHT, layout.headerHeight))}px`} as CSSProperties}>
      <EventNavigator topology={topology} expanded={expanded} selection={selection} active={event?.component} preview={hoveredEvent?.event.component}
        focus={historyPosition} position={historyPositionRef} viewportWidth={viewport.width} element={eventStrip}
        lens={eventLens} onFocus={focusHistory}
        onSelect={select} onToggle={toggle} onRead={onSelect} onHover={previewEvent} onScroll={scrollEvents} />
      <div className="timeline-file-heading"><strong>{focusedBoundary > topology.points.length ? "At present" : `Opening after E${layout.points[focusedBoundary - 1]?.end ?? 0}`}</strong>
        <small>{focusedBoundary > topology.points.length ? `${opening.files.length} current · ${layout.files.filter(file => !file.current).length} recorded only` : `${layout.files.length} files in this view`}</small>
        {layout.unrecorded ? <small className="timeline-opening-difference" title="Current Opening includes changes outside the recorded Event flow.">Unrecorded Opening changes</small> : null}
      </div>
      <div className="timeline-flow-scroll" ref={canvas} onScroll={scrollCanvas} aria-label="Opening file evolution">
        <div className="timeline-canvas" style={{width: layout.width, height: canvasHeight}}>
          <OpeningTimelineCanvas topology={topology} layout={layout} viewport={renderWindow}
            anchorX={anchorPin?.x} anchorName={anchorName} commitTicks={commitTicks} commits={commits} selectedCommit={commit?.commit}
            selectedTrace={selectedTrace} traceSelected={Boolean(selectedTraceTarget)} hoverTrace={hoverTrace}
            onCommit={selectCommit} onEvent={select} onFile={selectFile} onHover={setHover} />
          {!topology.files.length ? <p className="timeline-empty">No Opening-file transitions recorded. Event discussions remain available above.</p> : null}
        </div>
      </div>
      <aside className="timeline-file-rail" ref={fileRail} aria-label="Opening file entries" onScroll={scrollFiles}>
        <div style={{height: canvasHeight, position: "relative"}}>{shownFiles.map(item => <button type="button" key={item.component}
          className={`timeline-file-entry${item.current ? " is-current" : ""}${item.managed ? "" : " is-historical"}${selectedTrace.files.has(item.component) ? " is-selected" : ""}${hoverTrace.files.has(item.component) ? " is-previewed" : ""}`}
          style={{transform: `translateY(${item.y - FILE_LANE_HEIGHT / 2}px)`, "--timeline-entry-color": item.color} as CSSProperties} title={item.path}
          aria-label={`${item.path}${item.current ? ", current Opening" : ""}${item.managed ? "" : ", historical"}`}
          onMouseEnter={() => setHover({kind: "file", component: item.component, interval: item.interval})} onMouseLeave={() => setHover(undefined)}
          onFocus={() => setHover({kind: "file", component: item.component, interval: item.interval})} onBlur={() => setHover(undefined)}
          onClick={e => {setEvidence({kind: "file", component: item.component, interval: item.interval}); if (item.managed) onSelect(item.path, readerNavigationMode(e));}}>
          <span className="timeline-entry-box"><span className="timeline-entry-name">{item.name}</span><span className="timeline-entry-id">{item.path.split("/").slice(0, -1).join("/")}</span></span>
        </button>)}
          {retiringFiles.filter(item => item.y >= viewport.top - FILE_LANE_HEIGHT && item.y <= viewport.top + viewport.height + FILE_LANE_HEIGHT).map(item =>
            <RetiringFileLabel key={item.component} file={item} onSelect={mode => {setEvidence({kind: "file", component: item.component, interval: item.interval});if (item.managed) onSelect(item.path, mode);}} />)}
        </div>
      </aside>
      <div className="timeline-rail-resize" role="separator" aria-label="Resize Opening file rail" aria-orientation="vertical" tabIndex={0}
        aria-valuemin={132} aria-valuemax={Math.max(132, Math.min(520, availableWidth - 260))} aria-valuenow={fittedRailWidth}
        onPointerDown={beginRailResize} onPointerMove={moveRailResize} onPointerUp={finishRailResize} onPointerCancel={finishRailResize} onLostPointerCapture={finishRailResize}
        onDoubleClick={() => onRailWidthChange(DEFAULT_EVOLVE_RAIL_WIDTH)} onKeyDown={e => {
          const step = e.shiftKey ? 48 : 16;
          const width = e.key === "ArrowLeft" ? fittedRailWidth + step : e.key === "ArrowRight" ? fittedRailWidth - step
            : e.key === "Home" ? 132 : e.key === "End" ? 520 : e.key === "Enter" || e.key === " " ? DEFAULT_EVOLVE_RAIL_WIDTH : undefined;
          if (width !== undefined) {e.preventDefault();onRailWidthChange(resizeEvolveRail(width, 0, availableWidth));}
        }} />
      {hoveredFile || hoveredEvent ? <div className="timeline-hover-preview" role="tooltip">
        <strong>{hoveredFile?.path ?? hoveredEvent?.event.name.replace(/\.md$/, "")}</strong>
        {hoveredParent ? <span>Parent: {hoveredParent.event.name.replace(/\.md$/, "")}</span> : null}
        <span>{hoveredFile ? `${hoveredFile.managed ? "Registered file" : "Historical identity"} · ${hoveredFile.component}`
          : `${hoveredEvent!.subtreeEnd - hoveredEvent!.start} ${hoveredEvent!.subtreeEnd - hoveredEvent!.start === 1 ? "Event" : "Events"} · ${hoveredEvent!.predecessors.length} before → ${hoveredEvent!.successors.length} after`}</span>
      </div> : null}
    </div>

  </section>;
}

function TimelineGitBrowser({anchors, commits, selectedAnchor, selectedCommit, page, onPage, onAnchor, onCommit, loading, error, onRetry}: {
  anchors: GraphData["anchors"]; commits: TimelineCommit[]; selectedAnchor?: string; selectedCommit?: string;
  page: {start: number; end: number}; onPage: (index: number) => void; onAnchor: (name: string) => void;
  onCommit: (hash: string) => void; loading: boolean; error?: string; onRetry: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = list.current;
    if (!container) return;
    const active = container.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (active) container.scrollTop = Math.max(0, active.offsetTop - container.clientHeight / 2 + active.offsetHeight / 2);
    else container.scrollTop = 0;
  }, [page.start, selectedCommit]);
  return <aside className="timeline-git-browser" aria-label="Git evidence navigator">
    {Object.keys(anchors).length ? <div className="timeline-git-anchors">
      <div className="timeline-git-label">Anchors <span>{Object.keys(anchors).length}</span></div>
      {Object.entries(anchors).map(([name, definition]) => <button type="button" key={name} title={definition.commit} aria-pressed={selectedAnchor === name} onClick={() => onAnchor(name)}><AnchorIcon size={12} /><span>{name}</span></button>)}
    </div> : null}
    <div className="timeline-git-label">Commits <span>{commits.length ? `${page.start + 1}–${page.end} / ${commits.length}` : ""}</span>
      <button type="button" aria-label="Previous commits" disabled={!commits.length || page.start === 0} onClick={() => onPage(page.start - 1)}><ChevronIcon className="timeline-nav-previous" size={12} /></button>
      <button type="button" aria-label="Next commits" disabled={!commits.length || page.end === commits.length} onClick={() => onPage(page.end)}><ChevronIcon size={12} /></button>
    </div>
    <div className="timeline-git-commits" ref={list}>
      {loading ? <p role="status">Loading Git history…</p> : error ? <p role="alert">{error} <button type="button" onClick={onRetry}>Retry</button></p> : !commits.length ? <p>No Git commits available.</p> : commits.slice(page.start, page.end).map(item =>
        <button type="button" key={item.commit} title={`${item.subject}\n${item.commit}\n${item.author.name} · ${item.author.date}`} aria-pressed={selectedCommit === item.commit} onClick={() => onCommit(item.commit)}>
          <strong>{item.subject || "Empty commit message"}</strong><span><code>{item.commit.slice(0, 10)}</code><CommitDate value={item.author.date} compact /></span>
        </button>)}
    </div>
  </aside>;
}

function CommitDate({value, compact = false}: {value: string; compact?: boolean}) {
  const date = new Date(value);
  return <time dateTime={value} title={value}>{Number.isNaN(date.getTime()) ? value : compact ? date.toLocaleDateString() : date.toLocaleString()}</time>;
}

function alignmentLabel(boundary?: number | null): string {
  return boundary == null ? "Event alignment unknown." : `Matches the authored Event registry prefix through ${boundary} records.`;
}

async function copyTimelineText(value: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Native WebViews can deny the asynchronous API while allowing a user copy.
  }
  const focused = document.activeElement;
  const field = document.createElement("textarea");
  field.value = value;
  field.readOnly = true;
  field.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.append(field);
  field.select();
  try {
    if (!document.execCommand("copy")) throw new Error("Clipboard copy unavailable.");
  } finally {
    field.remove();
    if (focused instanceof HTMLElement && focused.isConnected) focused.focus({preventScroll: true});
  }
}

function RetiringFileLabel({file, onSelect}: {file: RetiringOpeningFile; onSelect: (mode: ReaderNavigationMode) => void}) {
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const elapsed = Math.max(0, performance.now() - file.startedAt);
    const movement = element.animate([
      {transform: `translateY(${file.initialY - FILE_LANE_HEIGHT / 2}px)`},
      {transform: `translateY(${file.y - FILE_LANE_HEIGHT / 2}px)`},
    ], {duration: Math.max(0, 280 - elapsed), easing: "ease-out"});
    const fade = element.animate([{opacity: 0.7}, {opacity: 0}], {delay: Math.max(0, 460 - elapsed), duration: Math.max(0, 420 - Math.max(0, elapsed - 460)), fill: "forwards"});
    return () => {movement.cancel();fade.cancel();};
  }, [file.startedAt]);
  return <button type="button" ref={ref} className="timeline-file-entry is-retiring" data-retiring="true"
    style={{transform: `translateY(${file.y - FILE_LANE_HEIGHT / 2}px)`, "--timeline-entry-color": file.color} as CSSProperties}
    tabIndex={-1} aria-label={`${file.path}, leaving this historical view`} title={file.path} onClick={event => onSelect(readerNavigationMode(event))}>
    <span className="timeline-entry-box"><span className="timeline-entry-name">{file.name}</span><span className="timeline-entry-id">leaving</span></span>
  </button>;
}
