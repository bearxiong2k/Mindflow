import { useEffect, useRef, useState } from "react";

import { loadVersionInfo } from "../api";
import { adoptionComparison, appVersionLabel, type DesktopVersionInfo } from "../versionInfo";
import { CloseIcon } from "./Icons";
import { HelpOnly, HelpToggle } from "./InterfaceHelp";

export function VersionInfo({ root, canRefresh, onRefresh }: {
  root?: string;
  canRefresh: boolean;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [result, setResult] = useState<{ root?: string; info?: DesktopVersionInfo }>();
  const [loading, setLoading] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const info = result?.root === root ? result?.info : undefined;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadVersionInfo(root).then((value) => {
      if (!cancelled) setResult({ root, info: value });
    }).catch(() => {
      // Old/unimplemented endpoints and unavailable identities share Unknown.
      if (!cancelled) setResult({ root });
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [root, generation]);

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  const unknown = (value: string | number | null | undefined) => value ?? "Unknown";
  return (
    <>
      <button type="button" className="app-version-button"
        aria-label={`Show version details: ${appVersionLabel(info)}`}
        aria-haspopup="dialog"
        onClick={() => { setOpen(true); setGeneration((value) => value + 1); }}>
        {appVersionLabel(info)}
      </button>
      <dialog className="version-info" ref={dialog} aria-labelledby="version-info-title"
        onClose={() => setOpen(false)}>
        <header>
          <h2 id="version-info-title">Mindflow versions</h2>
          <div className="dialog-header-actions">
            <HelpToggle />
            <button type="button" aria-label="Close version details" onClick={() => setOpen(false)}>
              <CloseIcon />
            </button>
          </div>
        </header>
        <section>
          <h3>Running application</h3>
          <dl>
            <dt>App</dt><dd>{appVersionLabel(info)}</dd>
            <dt>Bundled core</dt><dd>{unknown(info?.local_core.release)}</dd>
            <dt>Build</dt><dd>{unknown(info?.local_core.built_at)}</dd>
            <dt>Source revision</dt><dd>{unknown(info?.local_core.source_revision)}</dd>
          </dl>
        </section>
        <section>
          <h3>Current project</h3>
          <p className="version-info__root">{root ?? "No project selected"}</p>
          <dl>
            <dt>Serving core</dt><dd>{unknown(info?.project_core?.release)}</dd>
            <dt>Adopted release</dt><dd>{unknown(info?.project.adopted_release)}</dd>
            <dt>Project format</dt><dd>{unknown(info?.project.format)}</dd>
            <dt>Supported format</dt><dd>{unknown(info?.project_core?.project_format)}</dd>
            <dt>Bridge protocol</dt><dd>{unknown(info?.project_core?.bridge_protocol)}</dd>
          </dl>
          <p>{adoptionComparison(info)}</p>
          <HelpOnly><p className="version-info__note">Project adoption is recorded in MINDFLOW.yaml; Refresh does not change it.</p></HelpOnly>
        </section>
        <section aria-live="polite">
          <h3>Local build</h3>
          <p>{loading ? "Checking versions…" : info?.local_update.status === "current"
            ? "Running the synchronized local build"
            : info?.local_update.status === "ready"
              ? `Synchronized build ready: ${info.local_update.release} · ${info.local_update.built_at}`
              : "Unknown"}</p>
          <div className="version-info__actions">
            <button type="button" disabled={loading} onClick={() => setGeneration((value) => value + 1)}>
              Check versions
            </button>
            {info?.local_update.status === "ready" && canRefresh ? (
              <button type="button" disabled={loading} onClick={() => { setOpen(false); onRefresh(); }}>
                Activate with Refresh
              </button>
            ) : null}
          </div>
        </section>
      </dialog>
    </>
  );
}
