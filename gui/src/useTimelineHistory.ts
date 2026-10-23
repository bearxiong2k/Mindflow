import { useEffect, useState } from "react";
import { loadTimelineHistory } from "./api";
import type { RegionResponse, TimelineCommit } from "./types";

export function useTimelineHistory(region: RegionResponse, enabled: boolean) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; commits?: TimelineCommit[]; error?: string }>();
  const root = region.root;
  const snapshot = region.status.snapshot.id;
  const key = JSON.stringify([root, snapshot, attempt]);
  const preloaded = region.timeline_history_loaded !== false;
  const current = result?.key === key ? result : undefined;
  useEffect(() => {
    if (!enabled || preloaded || current) return;
    let disposed = false;
    void loadTimelineHistory(root, snapshot).then(
      (report) => { if (!disposed) setResult({ key, commits: report.commits }); },
      (error: unknown) => { if (!disposed) setResult({ key, error: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { disposed = true; };
  }, [root, snapshot, enabled, preloaded, key, current]);
  return {
    commits: preloaded ? region.timeline_commits : current?.commits ?? EMPTY_COMMITS,
    loading: enabled && !preloaded && !current,
    error: current?.error,
    retry: () => setAttempt((value) => value + 1),
  };
}
const EMPTY_COMMITS: TimelineCommit[] = [];
