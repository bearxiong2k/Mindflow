import { useEffect, useRef } from "react";

/** Coalesce focus checks, but never drop a human Refresh behind one. */
export function createWorkspaceReloadQueue(
  run: (activateBuild: boolean) => Promise<void>,
  onRefreshingChange: (refreshing: boolean) => void,
) {
  let pending: Promise<void> | undefined;
  let foreground: Promise<void> | undefined;
  return (activateBuild: boolean): Promise<void> => {
    if (activateBuild && foreground) return foreground;
    if (!activateBuild && pending) return pending;
    if (activateBuild) onRefreshingChange(true);
    const request = Promise.resolve(pending).catch(() => {}).then(() => run(activateBuild));
    pending = request;
    if (activateBuild) foreground = request;
    const finish = () => {
      if (pending === request) pending = undefined;
      if (foreground === request) {
        foreground = undefined;
        onRefreshingChange(false);
      }
    };
    void request.then(finish, finish);
    return request;
  };
}

export function useWorkspaceReload(
  run: (activateBuild: boolean) => Promise<void>,
  onRefreshingChange: (refreshing: boolean) => void,
) {
  const callbacks = useRef({ run, onRefreshingChange });
  callbacks.current = { run, onRefreshingChange };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const queue = useRef<ReturnType<typeof createWorkspaceReloadQueue> | null>(null);
  queue.current ??= createWorkspaceReloadQueue(
    (activateBuild) => mounted.current ? callbacks.current.run(activateBuild) : Promise.resolve(),
    (refreshing) => callbacks.current.onRefreshingChange(refreshing),
  );
  return queue.current;
}
