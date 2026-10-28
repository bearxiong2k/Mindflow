import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FILE_LANE_HEIGHT, FILE_TOP, type OpeningFileLane } from "../openingTimeline";

export interface RetiringOpeningFile extends OpeningFileLane {
  startedAt: number;
  initialY: number;
}

/** Briefly retain departing labels while the focused Opening moves through history. */
export function useTimelineRailMotion(files: readonly OpeningFileLane[]) {
  const previous = useRef(files);
  const [retiring, setRetiring] = useState<RetiringOpeningFile[]>([]);
  useLayoutEffect(() => {
    const currentIds = new Set(files.map(file => file.component));
    const departed = previous.current.filter(file => !currentIds.has(file.component));
    previous.current = files;
    const now = performance.now();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRetiring(current => current.length ? [] : current);
      return;
    }
    setRetiring(current => {
      const retained = current.filter(file => !currentIds.has(file.component) && now - file.startedAt < 880);
      const ids = new Set(retained.map(file => file.component));
      for (const file of departed) if (!ids.has(file.component)) {
        retained.push({...file, initialY: file.y, startedAt: now});
      }
      return retained.length === current.length && retained.every((file, index) => file === current[index])
        ? current : retained.slice(-12);
    });
  }, [files]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => {if (media.matches) setRetiring([]);};
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    if (!retiring.length) return;
    const next = Math.min(...retiring.map(file => file.startedAt + 880));
    const timeout = window.setTimeout(() => setRetiring(current => current.filter(file => performance.now() - file.startedAt < 880)), Math.max(1, next - performance.now() + 1));
    return () => window.clearTimeout(timeout);
  }, [retiring]);
  return retiring.map((file, index) => ({...file, y: FILE_TOP + (files.length + index) * FILE_LANE_HEIGHT}));
}
