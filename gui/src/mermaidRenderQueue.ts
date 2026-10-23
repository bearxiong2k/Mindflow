export interface MermaidRenderOptions {
  signal?: AbortSignal;
  priority?: () => "foreground" | "background";
}

export function mermaidRenderAborted() {
  return new DOMException("Graph rendering was superseded", "AbortError");
}

/** Mermaid has global configuration and temporary DOM: only one job may run. */
export function createMermaidRenderQueue() {
  interface Job {
    options: MermaidRenderOptions;
    run: () => Promise<void>;
    cancel: () => void;
  }
  const pending: Job[] = [];
  let running = false;
  let scheduled = false;
  const schedule = () => {
    if (running || scheduled || pending.length === 0) return;
    scheduled = true;
    // Yield between layouts so input can replace queued work before it starts.
    setTimeout(() => {
      scheduled = false;
      const foreground = pending.findIndex((job) => job.options.priority?.() !== "background");
      const job = pending.splice(foreground < 0 ? 0 : foreground, 1)[0];
      if (!job) return;
      running = true;
      void job.run().finally(() => {
        running = false;
        schedule();
      });
    }, 0);
  };
  return function enqueue<T>(operation: () => Promise<T>, options: MermaidRenderOptions = {}) {
    return new Promise<T>((resolve, reject) => {
      if (options.signal?.aborted) { reject(mermaidRenderAborted()); return; }
      const cleanup = () => options.signal?.removeEventListener("abort", job.cancel);
      const job: Job = {
        options,
        cancel: () => {
          const index = pending.indexOf(job);
          if (index >= 0) {
            pending.splice(index, 1);
            cleanup();
            reject(mermaidRenderAborted());
          }
        },
        run: async () => {
          try {
            if (options.signal?.aborted) throw mermaidRenderAborted();
            const result = await operation();
            if (options.signal?.aborted) throw mermaidRenderAborted();
            resolve(result);
          } catch (error) {
            reject(error);
          } finally {
            cleanup();
          }
        },
      };
      options.signal?.addEventListener("abort", job.cancel, { once: true });
      pending.push(job);
      schedule();
    });
  };
}
