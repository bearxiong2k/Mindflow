import { memo, useCallback, useMemo, useState, type KeyboardEvent, type RefObject } from "react";
import { eventGroupRanges, EVENT_STEP, EVENT_LANE_HEIGHT, type EventPoint } from "../eventTimeline";
import { eventLayers, eventLayerWindow, visibleLayerEvents, EVENT_LAYER_LEFT, EVENT_LAYER_RIGHT, EVENT_LAYERS_HEIGHT } from "../eventLayers";
import type { OpeningTimeline } from "../openingTimeline";
import { readerNavigationMode, type ReaderNavigationMode } from "../readerNavigation";
import { EventLens, type EventLensHandle } from "./EventLens";

interface Props {
  topology: OpeningTimeline;
  expanded: ReadonlySet<string>;
  selection?: string;
  active?: string;
  preview?: string;
  focus: number;
  position: RefObject<number>;
  viewportWidth: number;
  element: RefObject<HTMLDivElement | null>;
  lens: RefObject<EventLensHandle | null>;
  onFocus: (x: number) => void;
  onSelect: (point: EventPoint, keepView?: boolean) => void;
  onToggle: (id: string) => void;
  onRead: (path: string, mode?: ReaderNavigationMode) => void;
  onHover: (component?: string) => void;
  onScroll: () => void;
}

/** Each level keeps its own reading scale over the coordinated history. */
export const EventNavigator = memo(function EventNavigator({topology, expanded, selection, active, preview, focus, position,
  viewportWidth, element, lens, onFocus, onSelect, onToggle, onRead, onHover, onScroll}: Props) {
  const groupRanges = useMemo(() => eventGroupRanges(topology.points), [topology]);
  const layers = useMemo(() => eventLayers(topology.points, topology.width), [topology]);
  const [zooms, setZooms] = useState<Readonly<Record<number, number>>>({});
  const [row, setRow] = useState(0);
  const firstDepth = Math.min(Math.max(0, layers.length - 1), Math.max(0, row - 1));
  const lastDepth = Math.min(layers.length, firstDepth + Math.ceil(EVENT_LAYERS_HEIGHT / EVENT_LANE_HEIGHT) + 3);
  const width = Math.max(1, viewportWidth - EVENT_LAYER_LEFT - EVENT_LAYER_RIGHT);
  const columns = layers.slice(firstDepth, lastDepth).map(layer => Math.floor(layer.toLocal(focus) / EVENT_STEP)).join(",");
  const shownNavigator = useMemo(() => columns.split(",").flatMap((column, index) => {
    const layer = layers[firstDepth + index];
    if (!layer) return [];
    const window = eventLayerWindow(layer, width, Number(column), zooms[layer.depth] ?? 1);
    return visibleLayerEvents(layer, window.start, window.end);
  }), [layers, columns, firstDepth, width, zooms]);
  const zoom = useCallback((depth: number, factor: number) => setZooms(current => {
    const minimum = Math.max(0.25, width / Math.max(width, layers[depth]?.total ?? width));
    const value = factor === 0 ? 1 : Math.max(minimum, Math.min(8, (current[depth] ?? 1) * factor));
    return current[depth] === value ? current : {...current, [depth]: value};
  }), [layers, width]);
  const point = selection ? topology.byId.get(selection) : undefined;
  function navigate(e: KeyboardEvent) {
    const index = point ? point.ordinal - 1 : 0;
    let target: EventPoint | undefined;
    switch (e.key) {
      case "ArrowDown": target = topology.points[Math.min(topology.points.length - 1, index + 1)]; break;
      case "ArrowUp": target = topology.points[Math.max(0, index - 1)]; break;
      case "Home": target = topology.points[0]; break;
      case "End": target = topology.points[topology.points.length - 1]; break;
      case "ArrowRight":
        if (point?.event.children.length && !expanded.has(point.event.component)) onToggle(point.event.component);
        else if (topology.points[index + 1]?.parent === selection) target = topology.points[index + 1];
        else target = topology.points[Math.min(topology.points.length - 1, index + 1)];
        break;
      case "ArrowLeft":
        if (point && expanded.has(point.event.component)) onToggle(point.event.component);
        else if (point?.parent) target = topology.byId.get(point.parent);
        else target = topology.points[Math.max(0, index - 1)];
        break;
      case " ": if (point?.event.children.length) onToggle(point.event.component); break;
      case "Enter": if (point) onRead(point.event.file, readerNavigationMode(e)); break;
      default: return;
    }
    if (target) onSelect(target);
    e.preventDefault();
  }
  return <div className="timeline-event-strip" ref={element} role="tree" aria-label="Events" tabIndex={0}
    aria-activedescendant={active && shownNavigator.some(item => item.event.component === active) ? `event-${active}` : undefined}
    onKeyDown={navigate} onScroll={() => {onScroll(); setRow(Math.floor((element.current?.scrollTop ?? 0) / EVENT_LANE_HEIGHT));}}>
    <div style={{width: topology.width, height: topology.headerHeight, position: "relative"}}>
      {topology.points.length ? <EventLens topology={topology} points={shownNavigator} ranges={groupRanges} expanded={expanded}
        layers={layers} firstDepth={firstDepth} lastDepth={lastDepth} zooms={zooms} onZoom={zoom} historyPosition={position}
        width={viewportWidth} active={active} preview={preview} strip={element} controller={lens} onFocus={onFocus}
        onSelect={onSelect} onToggle={onToggle} onHover={onHover} />
        : <p className="timeline-empty">No Events recorded yet.</p>}
    </div>
  </div>;
});
