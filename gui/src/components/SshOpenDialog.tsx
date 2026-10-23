import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  browseSshDirectory,
  closeSshPicker,
  listSshDestinations,
} from "../api";
import {
  filterSshDestinations,
  remoteFolderName,
  remotePathBreadcrumbs,
} from "../sshBrowser";
import type { FolderPickerResponse } from "../types";
import { HelpOnly, HelpToggle } from "./InterfaceHelp";
import {
  ChevronIcon,
  CloseIcon,
  FolderIcon,
  RefreshIcon,
  ServerIcon,
} from "./Icons";

type SshOpenStage = "server" | "folder";

interface SshOpenDialogProps {
  opening: boolean;
  error?: string;
  onClearError: () => void;
  onClose: () => void;
  onSubmit: (destination: string, path: string) => Promise<void>;
}

export function SshOpenDialog({
  opening,
  error,
  onClearError,
  onClose,
  onSubmit,
}: SshOpenDialogProps) {
  const [stage, setStage] = useState<SshOpenStage>("server");
  const [destinations, setDestinations] = useState<string[]>([]);
  const [serverQuery, setServerQuery] = useState("");
  const [loadingServers, setLoadingServers] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [destination, setDestination] = useState("");
  const [directory, setDirectory] = useState<FolderPickerResponse>();
  const [pathInput, setPathInput] = useState("~");
  const [localError, setLocalError] = useState<string>();
  const [returnFocusTarget] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const folderListRef = useRef<HTMLDivElement>(null);
  const busy = opening || connecting || browsing;

  useEffect(() => {
    let active = true;
    void listSshDestinations()
      .then((configured) => {
        if (active) setDestinations(configured);
      })
      .catch((reason: unknown) => {
        if (active) setLocalError(String(reason));
      })
      .finally(() => {
        if (active) setLoadingServers(false);
      });
    return () => {
      active = false;
      void closeSshPicker().catch(() => undefined);
    };
  }, []);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const dialog = dialogRef.current;
    if (!overlay || !dialog) return;
    const siblings = [...(overlay.parentElement?.children ?? [])]
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlay);
    const previousInert = siblings.map((element) => element.inert);
    for (const sibling of siblings) sibling.inert = true;
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) dialog.focus();
    };
    window.addEventListener("focusin", containFocus);
    return () => {
      window.removeEventListener("focusin", containFocus);
      siblings.forEach((element, index) => { element.inert = previousInert[index]; });
      if (returnFocusTarget?.isConnected) returnFocusTarget.focus({ preventScroll: true });
    };
  }, [returnFocusTarget]);

  useLayoutEffect(() => {
    dialogRef.current?.querySelector<HTMLInputElement>("input:not(:disabled)")?.focus();
  }, [stage]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) onClose();
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]",
      )].filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      const activeIndex = controls.indexOf(document.activeElement as HTMLElement);
      if (activeIndex < 0 || (event.shiftKey ? activeIndex === 0 : activeIndex === controls.length - 1)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
        if (!first) dialog.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [busy, onClose]);

  const visibleDestinations = useMemo(
    () => filterSshDestinations(destinations, serverQuery),
    [destinations, serverQuery],
  );
  const breadcrumbs = useMemo(
    () => remotePathBreadcrumbs(directory?.path ?? ""),
    [directory?.path],
  );

  useEffect(() => {
    if (folderListRef.current) folderListRef.current.scrollTop = 0;
  }, [directory?.path]);

  const connectToDestination = useCallback(
    async (candidate: string) => {
      const nextDestination = candidate.trim();
      if (!nextDestination || connecting) return;
      setConnecting(true);
      setLocalError(undefined);
      onClearError();
      try {
        await closeSshPicker();
        const nextDirectory = await browseSshDirectory(
          nextDestination,
          "~",
          true,
        );
        setDestination(nextDestination);
        setDirectory(nextDirectory);
        setPathInput(nextDirectory.path);
        setStage("folder");
      } catch (reason) {
        setLocalError(String(reason));
      } finally {
        setConnecting(false);
      }
    },
    [connecting, onClearError],
  );

  const navigateTo = useCallback(
    async (path: string, reconnect = false) => {
      if (!destination || browsing) return;
      setBrowsing(true);
      setLocalError(undefined);
      onClearError();
      try {
        const nextDirectory = await browseSshDirectory(
          destination,
          path,
          reconnect,
        );
        setDirectory(nextDirectory);
        setPathInput(nextDirectory.path);
      } catch (reason) {
        setLocalError(String(reason));
      } finally {
        setBrowsing(false);
      }
    },
    [browsing, destination, onClearError],
  );

  const returnToServers = useCallback(() => {
    if (busy) return;
    void closeSshPicker().catch((reason: unknown) => setLocalError(String(reason)));
    setStage("server");
    setLocalError(undefined);
    onClearError();
  }, [busy, onClearError]);

  const submitFolder = useCallback(async () => {
    if (!directory || busy) return;
    setLocalError(undefined);
    onClearError();
    await onSubmit(destination, directory.path);
  }, [busy, destination, directory, onClearError, onSubmit]);

  const displayedError = localError ?? error;
  const title = stage === "server" ? "Choose an SSH server" : "Choose a remote folder";

  return (
    <div
      className="ssh-open-overlay"
      ref={overlayRef}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="ssh-open-dialog"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ssh-open-title"
        aria-busy={busy}
      >
        <header className="ssh-open-dialog__heading">
          <div>
            <h2 id="ssh-open-title">{title}</h2>
          </div>
          <div className="dialog-header-actions">
            <HelpToggle />
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Close SSH project picker"
            >
              <CloseIcon />
            </button>
          </div>
        </header>

        <ol className="ssh-open-steps" aria-label="SSH project opening steps">
          {(["Server", "Browse", "Open"] as const).map((label, index) => {
            const activeIndex = opening ? 2 : stage === "server" ? 0 : 1;
            const state = index < activeIndex ? "complete" : index === activeIndex ? "active" : "pending";
            return (
              <li key={label} data-state={state}>
                <span>{index + 1}</span>
                {label}
              </li>
            );
          })}
        </ol>

        {stage === "server" ? (
          <div className="ssh-server-picker">
            <form
              className="ssh-server-search"
              onSubmit={(event) => {
                event.preventDefault();
                void connectToDestination(serverQuery);
              }}
            >
              <ServerIcon aria-hidden="true" />
              <input
                value={serverQuery}
                onChange={(event) => setServerQuery(event.target.value)}
                placeholder="Search configured servers or enter user@host"
                aria-label="SSH server"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={connecting}
                autoFocus
              />
              <button
                type="submit"
                className="secondary-button"
                disabled={connecting || !serverQuery.trim()}
              >
                {connecting ? "Connecting…" : "Connect"}
              </button>
            </form>

            <div className="ssh-picker-section-heading">
              <span>SSH configuration</span>
              <span>{visibleDestinations.length}</span>
            </div>
            <div className="ssh-server-list">
              {loadingServers ? (
                <div className="ssh-picker-placeholder">Reading configured servers…</div>
              ) : visibleDestinations.length ? (
                visibleDestinations.map((configured) => (
                  <button
                    key={configured}
                    type="button"
                    className="ssh-server-row"
                    onClick={() => void connectToDestination(configured)}
                    disabled={connecting}
                  >
                    <span className="ssh-server-row__icon"><ServerIcon /></span>
                    <span className="ssh-server-row__copy">
                      <strong>{configured}</strong>
                    </span>
                    <ChevronIcon aria-hidden="true" />
                  </button>
                ))
              ) : (
                <div className="ssh-picker-placeholder">
                  {serverQuery
                    ? "No matching server. Enter a destination to connect."
                    : "No configured servers. Enter a destination above."}
                </div>
              )}
            </div>
            <HelpOnly><p className="ssh-open-dialog__note">
              Uses ~/.ssh/config and existing SSH authentication.
            </p></HelpOnly>
          </div>
        ) : directory ? (
          <div className="ssh-folder-picker">
            <div className="ssh-connected-server">
              <span className="ssh-server-row__icon"><ServerIcon /></span>
              <div>
                <strong>{destination}</strong>
                <small>Connected</small>
              </div>
              <button type="button" onClick={returnToServers} disabled={busy}>
                Change server
              </button>
            </div>

            <form
              className="ssh-path-entry"
              onSubmit={(event) => {
                event.preventDefault();
                void navigateTo(pathInput);
              }}
            >
              <input
                value={pathInput}
                onChange={(event) => setPathInput(event.target.value)}
                aria-label="Remote folder path"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={browsing || opening}
              />
              <button
                type="submit"
                className="secondary-button"
                disabled={browsing || opening || !pathInput.trim()}
              >
                Go
              </button>
              <button
                type="button"
                className="ssh-icon-button"
                onClick={() => void navigateTo(directory.path)}
                disabled={browsing || opening}
                aria-label="Refresh remote folders"
                title="Refresh remote folders"
              >
                <RefreshIcon size={15} />
              </button>
            </form>

            <nav className="ssh-folder-breadcrumbs" aria-label="Remote folder path">
              {breadcrumbs.map((breadcrumb, index) => (
                <span key={breadcrumb.path}>
                  {index ? <ChevronIcon size={11} aria-hidden="true" /> : null}
                  <button
                    type="button"
                    onClick={() => void navigateTo(breadcrumb.path)}
                    disabled={busy || breadcrumb.path === directory.path}
                  >
                    {breadcrumb.label}
                  </button>
                </span>
              ))}
            </nav>

            <div className="ssh-picker-section-heading">
              <span>Folders</span>
              <span>{directory.entries.length}</span>
            </div>
            <div className="ssh-folder-list" ref={folderListRef}>
              {directory.parent ? (
                <button
                  type="button"
                  className="ssh-folder-row ssh-folder-row--parent"
                  onClick={() => void navigateTo(directory.parent!)}
                  disabled={busy}
                >
                  <span className="ssh-folder-row__icon"><FolderIcon /></span>
                  <span><strong>..</strong><small>Parent folder</small></span>
                  <ChevronIcon aria-hidden="true" />
                </button>
              ) : null}
              {directory.entries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className="ssh-folder-row"
                  onClick={() => void navigateTo(entry.path)}
                  disabled={busy}
                >
                  <span className="ssh-folder-row__icon"><FolderIcon /></span>
                  <span><strong>{entry.name}</strong><small>{entry.path}</small></span>
                  <ChevronIcon aria-hidden="true" />
                </button>
              ))}
              {!directory.parent && directory.entries.length === 0 ? (
                <div className="ssh-picker-placeholder">This folder contains no visible directories.</div>
              ) : null}
            </div>
          </div>
        ) : null}

        {displayedError ? (
          <div className="ssh-open-dialog__error" role="alert">
            <span>{displayedError}</span>
            {stage === "folder" && directory ? (
              <button
                type="button"
                onClick={() => void navigateTo(directory.path, true)}
                disabled={busy}
              >
                Retry connection
              </button>
            ) : null}
          </div>
        ) : null}

        <footer className="ssh-open-dialog__actions">
          <button
            type="button"
            className="secondary-button"
            onClick={stage === "folder" ? returnToServers : onClose}
            disabled={busy}
          >
            {stage === "folder" ? "Back" : "Cancel"}
          </button>
          {stage === "folder" && directory ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => void submitFolder()}
              disabled={busy}
            >
              <FolderIcon size={15} />
              <span>{opening ? "Opening…" : `Open ${remoteFolderName(directory.path)}`}</span>
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
