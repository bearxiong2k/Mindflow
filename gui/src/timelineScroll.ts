import type { TimelineViewport } from "./timelineInteraction.ts";

type ScrollSource = "canvas" | "events" | "files";
interface ScrollPorts {
  canvas: { scrollLeft: number; scrollTop: number; clientWidth: number; clientHeight: number };
  events: { scrollLeft: number };
  files: { scrollTop: number };
}

/** One coordinate shared by three native scrollers. An echoed scroll event
 * must never overwrite newer input that is still waiting on another surface. */
export function createTimelineScrollSync(initial: TimelineViewport) {
  let viewport = initial;
  let eventLeft = initial.left;
  let fileTop = initial.top;

  function apply(ports: ScrollPorts, source: ScrollSource, next: TimelineViewport, measured = false) {
    const changed = next.left !== viewport.left || next.top !== viewport.top
      || next.width !== viewport.width || next.height !== viewport.height;
    // In particular, a canvas event following an Event-bar write is only an
    // acknowledgement. Do not read or write its peers in that case.
    if (!changed && !measured) return;
    const previous = viewport;
    viewport = next;
    if (source !== "canvas") {
      if (next.left !== previous.left) ports.canvas.scrollLeft = next.left;
      if (next.top !== previous.top) ports.canvas.scrollTop = next.top;
    }
    if (eventLeft !== next.left) {
      eventLeft = next.left;
      if (source !== "events") ports.events.scrollLeft = next.left;
    }
    if (fileTop !== next.top) {
      fileTop = next.top;
      if (source !== "files") ports.files.scrollTop = next.top;
    }
    return changed ? next : undefined;
  }

  return {
    // Explicit scrubbing adopts the canvas position and cancels pending peer
    // input, including when the target is unchanged, without measuring layout.
    align(ports: ScrollPorts) {
      const { scrollLeft: left, scrollTop: top } = ports.canvas;
      eventLeft = ports.events.scrollLeft;
      fileTop = ports.files.scrollTop;
      return apply(ports, "canvas", { ...viewport, left, top }, true);
    },
    // Resize and topology commits measure geometry once, before any writes.
    measure(ports: ScrollPorts) {
      const { scrollLeft: left, scrollTop: top, clientWidth: width, clientHeight: height } = ports.canvas;
      eventLeft = ports.events.scrollLeft;
      fileTop = ports.files.scrollTop;
      return apply(ports, "canvas", { left, top, width, height }, true);
    },
    scroll(source: ScrollSource, ports: ScrollPorts) {
      if (source === "events") {
        const left = ports.events.scrollLeft;
        if (left === eventLeft) return;
        return apply(ports, source, { ...viewport, left });
      }
      if (source === "files") {
        const top = ports.files.scrollTop;
        if (top === fileTop) return;
        return apply(ports, source, { ...viewport, top });
      }
      const { scrollLeft: left, scrollTop: top } = ports.canvas;
      return apply(ports, source, { ...viewport, left, top });
    },
  };
}
