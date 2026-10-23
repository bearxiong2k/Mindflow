import { useEffect, useState } from "react";
import { loadDocumentationQc } from "./api";
import type { DocumentationQc } from "./documentationQc";

export function useStructureMetrics(root: string, snapshot: string, generation: number, enabled: boolean, commits: number) {
  const [attempt, setAttempt] = useState(0);
  const [request, setRequest] = useState<{ key: string; report?: DocumentationQc; error?: string }>();
  const key = JSON.stringify([root, snapshot, generation, commits, attempt]);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    void loadDocumentationQc(root, snapshot, { kind: "recent", commits }).then(
      (report) => { if (!disposed) setRequest({ key, report }); },
      (error: unknown) => { if (!disposed) setRequest({ key, error: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { disposed = true; };
  }, [root, snapshot, enabled, commits, key]);
  const report = enabled && request?.key === key ? request.report : undefined;
  const error = enabled && request?.key === key ? request.error : undefined;
  return { report, error, loading: enabled && !report && !error, retry: () => setAttempt((value) => value + 1) };
}
