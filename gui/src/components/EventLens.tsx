import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, type CSSProperties, type PointerEvent, type RefObject } from "react";
import { eventLensPlacement } from "../eventNavigatorLens";
import { eventLayerLens, eventLayerNavigation, eventLayerSelectionFocus, EVENT_LAYER_LEFT, EVENT_LAYER_RIGHT, type EventLayer } from "../eventLayers";
import { EVENT_LANE_HEIGHT, EVENT_TOP, type EventPoint, eventGroupRanges } from "../eventTimeline";
import type { OpeningEventPoint, OpeningTimeline } from "../openingTimeline";
import { ChevronIcon } from "./Icons";

export interface EventLensHandle { update: (focus: number) => void; selectionFocus: (id: string) => number | undefined }
const GROUP_COLORS = ["#42877c", "#966e9f", "#aa8150", "#5a80ab", "#b37478", "#7d8c53"];
interface Props {
  topology: OpeningTimeline;
  points: readonly OpeningEventPoint[];
  ranges: ReturnType<typeof eventGroupRanges>;
  expanded: ReadonlySet<string>;
  layers: readonly EventLayer<OpeningEventPoint>[];
  firstDepth: number;
  lastDepth: number;
  zooms: Readonly<Record<number, number>>;
  historyPosition: RefObject<number>;
  onZoom: (depth: number, factor: number) => void;
  width: number;
  active?: string;
  preview?: string;
  strip: RefObject<HTMLDivElement | null>;
  controller: RefObject<EventLensHandle | null>;
  onFocus: (x: number) => void;
  onSelect: (point: EventPoint, keepView?: boolean) => void;
  onToggle: (id: string) => void;
  onHover: (id?: string) => void;
}

/** Independent level projections with bounded captions and canvas marks.
 * History movement paints immediately, without waiting for a React render. */
export const EventLens = memo(function EventLens({topology, points, ranges, expanded, width, active, preview,
  strip, controller, layers, firstDepth, lastDepth, zooms, historyPosition, onZoom, onFocus, onSelect, onToggle, onHover}: Props) {
  const element = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const glows = useRef(new Map<number, HTMLDivElement>());
  const position = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const current = useRef(new Map<number, ReturnType<typeof eventLayerLens>>());
  const lastFocus = useRef<number | undefined>(undefined);
  const drag = useRef<{pointer: number; unproject: (x: number) => number; origin: number; scale: number; width: number; linear: boolean} | undefined>(undefined);
  const plotWidth = Math.max(1, width - EVENT_LAYER_LEFT - EVENT_LAYER_RIGHT);
  const navigation = useMemo(() => eventLayerNavigation(layers, plotWidth, zooms), [layers, plotWidth, zooms]);
  const pan = useCallback((depth: number, pixels: number) => {
    onFocus(navigation[depth].pan(historyPosition.current, pixels));
  }, [navigation, historyPosition, onFocus]);
  const shownLayers = useMemo(() => layers.slice(firstDepth, lastDepth), [layers, firstDepth, lastDepth]);
  const canvasTop = firstDepth * EVENT_LANE_HEIGHT;
  const canvasHeight = (lastDepth - firstDepth) * EVENT_LANE_HEIGHT + EVENT_TOP;
  const colors = useMemo(() => {
    const groups = new Map<string, string>(), siblings = new Map<string | undefined, string>();
    // Whole visible generations, not the virtual caption pool: scrolling and
    // folding descendants cannot recolor their parents or neighboring groups.
    for (const {event, parent} of topology.points) {
      if (!event.children.length) continue;
      let hash = 2166136261;
      for (const character of event.component) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
      let index = (hash >>> 0) % GROUP_COLORS.length;
      while (GROUP_COLORS[index] === groups.get(parent ?? "") || GROUP_COLORS[index] === siblings.get(parent)) index = (index + 1) % GROUP_COLORS.length;
      groups.set(event.component, GROUP_COLORS[index]);
      siblings.set(parent, GROUP_COLORS[index]);
    }
    return groups;
  }, [topology]);
  const parentContext = topology.byId.get(preview ?? "")?.parent ?? topology.byId.get(active ?? "")?.parent;
  const marks = useMemo(() => shownLayers.flatMap(layer => layer.items.map(item => ({...item,
    preferred: Math.max(180, Math.min(380, item.point.event.name.replace(/\.md$/, "").length * 6 + 80)),
    color: colors.get(item.point.event.children.length ? item.point.event.component : item.point.parent ?? "") ?? "#8ba3c3",
  }))), [shownLayers, colors]);

  const paint = useCallback((focus: number, force = false) => {
    if (!force && lastFocus.current === focus) return;
    lastFocus.current = focus;
    current.current.clear();
    for (const layer of shownLayers) {
      const lens = eventLayerLens(layer, plotWidth, focus, zooms[layer.depth] ?? 1);
      current.current.set(layer.depth, lens);
      const glow = glows.current.get(layer.depth);
      if (glow) glow.style.transform = `translateX(${lens.position}px)`;
    }
    const progress = Math.max(0, Math.min(1, focus / topology.width));
    if (indicator.current) indicator.current.style.transform = `translateX(${progress * plotWidth}px)`;
    const percent = String(Math.round(progress * 1000) / 10);
    if (position.current?.getAttribute("aria-valuenow") !== percent) position.current?.setAttribute("aria-valuenow", percent);
    const node = canvas.current;
    const ctx = node?.getContext("2d");
    if (node && ctx) {
      const ratio = window.devicePixelRatio || 1;
      if (node.width !== Math.round(plotWidth * ratio) || node.height !== Math.round(canvasHeight * ratio)) {
        node.width = Math.round(plotWidth * ratio); node.height = Math.round(canvasHeight * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, plotWidth, canvasHeight);
      ctx.translate(0, -canvasTop);
    }
    const occupied = new Map<number, number>();
    for (const mark of marks) {
      const {point} = mark;
      const lens = current.current.get(point.depth)!;
      const placed = eventLensPlacement(lens.local, mark.localStart, mark.localEnd, mark.preferred);
      const item = nodes.current.get(point.event.component);
      if (item) {
        item.style.transform = `translate3d(${(placed.x + EVENT_LAYER_LEFT).toFixed(3)}px,${point.y}px,0)`;
        item.style.width = `${placed.width.toFixed(3)}px`;
        const label = item.firstElementChild as HTMLElement;
        label.dataset.compact = String(placed.labelWidth * placed.scale < 160);
        label.style.cssText = `transform:translateX(${placed.caption.toFixed(3)}px) scale(${placed.scale.toFixed(4)});width:${placed.labelWidth.toFixed(3)}px;opacity:${placed.opacity.toFixed(4)};pointer-events:${placed.opacity > 0.2 ? "auto" : "none"}`;
      }
      if (!ctx) continue;
      const selected = point.event.component === active;
      const bucket = Math.floor(placed.x / 2);
      if (placed.width < 2 && !selected && occupied.get(point.depth) === bucket) continue;
      occupied.set(point.depth, bucket);
      ctx.globalAlpha = (item ? 1 - placed.opacity : 1) * 0.8;
      if (!ctx.globalAlpha) continue;
      ctx.fillStyle = mark.color;
      ctx.fillRect(placed.x, point.y + 10, Math.max(1, placed.width - 2), 4);
    }
    if (ctx) ctx.globalAlpha = 1;
  }, [topology.width, shownLayers, marks, plotWidth, zooms, canvasHeight, canvasTop, active]);
  useImperativeHandle(controller, () => ({update: paint, selectionFocus: id => {
    const point = topology.byId.get(id);
    return point ? eventLayerSelectionFocus(layers[point.depth], id) : undefined;
  }}), [paint, topology, layers]);
  useLayoutEffect(() => { paint(historyPosition.current, true); }, [paint, points, historyPosition]);

  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const wheel = (e: WheelEvent) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>("[data-event-depth]");
      if (!target) return;
      const depth = Number(target.dataset.eventDepth);
      const lens = current.current.get(depth);
      if (!lens) return;
      const units = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? plotWidth : 1;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        onZoom(depth, Math.exp(-Math.max(-100, Math.min(100, e.deltaY * units)) * 0.005));
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
        e.preventDefault();
        pan(depth, (e.deltaX || e.deltaY) * units);
      }
    };
    node.addEventListener("wheel", wheel, {passive: false});
    return () => node.removeEventListener("wheel", wheel);
  }, [pan, onZoom, plotWidth]);

  function seek(e: PointerEvent<HTMLDivElement>) {
    const held = drag.current;
    if (!held || held.pointer !== e.pointerId) return;
    const x = (e.clientX - held.origin) * held.scale;
    onFocus(x <= 4 ? 0 : x >= held.width - 4 ? topology.width : held.unproject(x));
  }
  function grab(e: PointerEvent<HTMLDivElement>) {
    if (!e.isPrimary || e.button !== 0 || !element.current
      || (e.target as HTMLElement).closest(".timeline-event__label, button")) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-event-depth]");
    const linear = Boolean((e.target as HTMLElement).closest(".timeline-event-position"));
    const lens = target ? current.current.get(Number(target.dataset.eventDepth)) : undefined;
    if (!linear && !lens) return;
    e.preventDefault();
    const bounds = element.current.getBoundingClientRect();
    (linear ? position.current : strip.current)?.focus({preventScroll: true});
    e.currentTarget.setPointerCapture(e.pointerId);
    // Freeze the inverse during a gesture so a stationary pointer cannot drift.
    drag.current = {pointer: e.pointerId, unproject: linear ? x => x / plotWidth * topology.width : lens!.unproject,
      origin: bounds.left + EVENT_LAYER_LEFT * bounds.width / width, scale: width / bounds.width, width: plotWidth, linear};
    seek(e);
  }
  function release(e: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointer !== e.pointerId) return;
    const linear = drag.current.linear;
    drag.current = undefined;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    (linear ? position.current : strip.current)?.focus({preventScroll: true});
  }
  return <div ref={element} className="timeline-event-lens" style={{width, height: topology.headerHeight}}
    onPointerDown={grab} onPointerMove={seek} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>
    {shownLayers.map(layer => <div key={layer.depth} className="timeline-event-layer" data-event-depth={layer.depth}
      style={{top: EVENT_TOP + layer.depth * EVENT_LANE_HEIGHT - 4, height: EVENT_LANE_HEIGHT}}>
      <div className="timeline-event-layer__track" style={{left: EVENT_LAYER_LEFT, width: plotWidth}}>
        <div ref={node => {if (node) glows.current.set(layer.depth, node); else glows.current.delete(layer.depth);}}
          className="timeline-event-lens__glow" aria-hidden="true" />
      </div>
      <button type="button" className="timeline-event-layer__level" aria-label={`Navigate Event level ${layer.depth + 1}`}
        title={`Level ${layer.depth + 1} · ${layer.items.length} Events · ${Math.round((zooms[layer.depth] ?? 1) * 100)}% zoom. Drag or scroll horizontally to navigate. ⌘/Ctrl + scroll to zoom; double-click this number to reset.`}
        onDoubleClick={() => onZoom(layer.depth, 0)} onKeyDown={e => {
          e.stopPropagation();
          const lens = current.current.get(layer.depth);
          if (!lens) return;
          const target = e.key === "Home" ? 0 : e.key === "End" ? topology.width
            : e.key === "ArrowLeft" || e.key === "PageUp" ? navigation[layer.depth].pan(historyPosition.current, -plotWidth * (e.key === "PageUp" ? 1 : 0.15))
            : e.key === "ArrowRight" || e.key === "PageDown" ? navigation[layer.depth].pan(historyPosition.current, plotWidth * (e.key === "PageDown" ? 1 : 0.15)) : undefined;
          if (target !== undefined) {e.preventDefault(); onFocus(target);}
          else if (["+", "=", "-", "0"].includes(e.key)) {e.preventDefault(); onZoom(layer.depth, e.key === "0" ? 0 : e.key === "-" ? 0.8 : 1.25);}
        }}>{layer.depth + 1}</button>
      <div className="timeline-event-layer__zoom" onKeyDown={e => e.stopPropagation()}>
        <button type="button" aria-label={`Zoom out Event level ${layer.depth + 1}`} title="Zoom out this level"
          disabled={Math.max(plotWidth, layer.total) * (zooms[layer.depth] ?? 1) <= plotWidth || (zooms[layer.depth] ?? 1) <= 0.25}
          onClick={() => onZoom(layer.depth, 0.8)}>−</button>
        <button type="button" aria-label={`Zoom in Event level ${layer.depth + 1}`} title="Zoom in this level"
          disabled={(zooms[layer.depth] ?? 1) >= 8} onClick={() => onZoom(layer.depth, 1.25)}>+</button>
      </div>
    </div>)}
    <canvas ref={canvas} aria-hidden="true" style={{left: EVENT_LAYER_LEFT, top: canvasTop, width: plotWidth, height: canvasHeight}} />
    {points.map(item => {
      const grouped = ranges.has(item.event.component);
      const parent = item.parent ? topology.byId.get(item.parent) : undefined;
      const parentHint = parent ? `Parent Event: ${parent.event.name.replace(/\.md$/, "")}` : undefined;
      const title = parentHint ? `${item.event.file}\n${parentHint}` : item.event.file;
      return <div key={item.event.component} id={`event-${item.event.component}`}
        ref={node => {if (node) nodes.current.set(item.event.component, node); else nodes.current.delete(item.event.component);}}
        className={`timeline-event${active === item.event.component ? " is-selected" : ""}${item.event.children.length ? " is-summary" : ""}${grouped ? " is-expanded" : ""}${parentContext === item.event.component ? " is-parent-context" : ""}`}
        style={{"--event-group-color": colors.get(item.event.component), "--event-family-color": colors.get(item.parent ?? item.event.component) ?? "#8ba3c3"} as CSSProperties}
        data-parent-event={item.parent} data-event-depth={item.depth} aria-description={parentHint}
        role="treeitem" aria-level={item.depth + 1} aria-posinset={item.position} aria-setsize={item.siblings}
        aria-selected={active === item.event.component} aria-label={item.event.name}
        aria-expanded={item.event.children.length ? expanded.has(item.event.component) : undefined}>
        <div className="timeline-event__label" onMouseEnter={() => onHover(item.event.component)} onMouseLeave={() => onHover(undefined)}
          onClick={() => {onSelect(item, grouped); strip.current?.focus({preventScroll: true});}}>
          <span className="timeline-event__dot" title={parentHint} aria-hidden="true" />
          {item.event.children.length ? <button type="button" tabIndex={-1} className="timeline-event__fold" aria-expanded={expanded.has(item.event.component)}
            aria-label={`${expanded.has(item.event.component) ? "Collapse" : "Expand"} ${item.event.name}`}
            onClick={e => {e.stopPropagation(); onToggle(item.event.component); strip.current?.focus({preventScroll: true});}}><ChevronIcon size={12} /></button> : null}
          <span className="timeline-event__number">E{item.start + 1}</span>
          <strong title={title}>{item.event.name.replace(/\.md$/, "")}</strong>
          {item.event.children.length ? <span className="timeline-event__count" title={`${item.subtreeEnd - item.start - 1} nested Events`}>+{item.subtreeEnd - item.start - 1}</span> : null}
        </div>
      </div>;
    })}
    <div ref={position} className="timeline-event-position" style={{left: EVENT_LAYER_LEFT, right: EVENT_LAYER_RIGHT}} role="slider" tabIndex={0}
      aria-label="History position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}
      onKeyDown={e => {
        e.stopPropagation();
        const focus = historyPosition.current;
        const target = e.key === "Home" ? 0 : e.key === "End" ? topology.width
          : e.key === "ArrowLeft" || e.key === "PageUp" ? focus - width * (e.key === "PageUp" ? 1 : 0.25)
          : e.key === "ArrowRight" || e.key === "PageDown" ? focus + width * (e.key === "PageDown" ? 1 : 0.25) : undefined;
        if (target !== undefined) {e.preventDefault(); onFocus(target);}
      }}>
      <span className="timeline-event-position__first" aria-hidden="true">E1</span>
      <span ref={indicator} className="timeline-event-position__focus" aria-hidden="true" />
      <span className="timeline-event-position__last" aria-hidden="true">E{topology.points.at(-1)?.end}</span>
    </div>
  </div>;
});
