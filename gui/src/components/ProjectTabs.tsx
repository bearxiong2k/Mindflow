import type { KeyboardEvent } from "react";

import {
  projectTabDomId,
  projectTabPanelDomId,
  type ProjectTab,
} from "../projectTabs";
import { CloseIcon, PlusIcon, RefreshIcon, WindowIcon } from "./Icons";
import { VersionInfo } from "./VersionInfo";
import { HelpToggle } from "./InterfaceHelp";

interface ProjectTabsProps {
  tabs: ProjectTab[];
  activeId?: string;
  opening: boolean;
  creatingWindow: boolean;
  canRefresh: boolean;
  refreshing: boolean;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onOpen: () => void;
  onOpenSsh: () => void;
  onNewWindow: () => void;
  onRefresh: () => void;
}

export function ProjectTabs({
  tabs,
  activeId,
  opening,
  creatingWindow,
  canRefresh,
  refreshing,
  onActivate,
  onClose,
  onOpen,
  onOpenSsh,
  onNewWindow,
  onRefresh,
}: ProjectTabsProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }

    const tabList = event.currentTarget.closest('[role="tablist"]');
    const tabButtons = Array.from(
      tabList?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
    );
    const currentIndex = tabButtons.indexOf(event.currentTarget);
    if (currentIndex < 0 || tabButtons.length === 0) return;

    event.preventDefault();
    const targetIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabButtons.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) +
              tabButtons.length) %
            tabButtons.length;
    const target = tabButtons[targetIndex];
    const targetId = target?.dataset.projectTabId;
    if (!target || !targetId) return;
    onActivate(targetId);
    target.focus();
  };

  return (
    <nav className="project-tabs" aria-label="Open Mindflow regions">
      <div className="project-tabs__list" role="tablist" aria-label="Projects">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          const hasError = tab.kind === "error" || Boolean(tab.openError);
          const location =
            tab.kind === "error" ? tab.requestedPath : tab.root;
          return (
            <div
              key={tab.id}
              className={`project-tab${active ? " is-active" : ""}${
                hasError ? " has-error" : ""
              }`}
            >
              <button
                type="button"
                id={projectTabDomId(tab.id)}
                className="project-tab__label"
                role="tab"
                aria-selected={active}
                aria-controls={projectTabPanelDomId(tab.id)}
                aria-label={hasError ? `${tab.label}, failed to open` : tab.label}
                tabIndex={active ? 0 : -1}
                data-project-tab-id={tab.id}
                title={location}
                onClick={() => onActivate(tab.id)}
                onKeyDown={handleKeyDown}
              >
                {hasError ? (
                  <span className="project-tab__error" aria-hidden="true" />
                ) : null}
                <span>{tab.label}</span>
              </button>
              <button
                type="button"
                className="project-tab__close"
                aria-label={`Close ${tab.label}`}
                title={`Close ${tab.label}`}
                onClick={(event) => {
                  const navigation = event.currentTarget.closest("nav");
                  onClose(tab.id);
                  window.requestAnimationFrame(() => {
                    const focusTarget =
                      navigation?.querySelector<HTMLButtonElement>(
                        '[role="tab"][aria-selected="true"]',
                      ) ??
                      navigation?.querySelector<HTMLButtonElement>(
                        ".project-tabs__open",
                      );
                    focusTarget?.focus();
                  });
                }}
              >
                <CloseIcon size={13} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="project-tabs__actions">
        <HelpToggle />
        <VersionInfo root={tabs.find((tab) => tab.id === activeId)?.root}
          canRefresh={canRefresh && !refreshing} onRefresh={onRefresh} />
        <button
          type="button"
          className="project-tabs__new-window"
          onClick={onNewWindow}
          disabled={creatingWindow}
          aria-label={creatingWindow ? "Creating window" : "New window"}
          title="New window (Command/Control-Shift-N)"
        >
          <WindowIcon size={14} />
          <span>{creatingWindow ? "Creating…" : "New window"}</span>
        </button>
        <button
          type="button"
          className="project-tabs__open"
          onClick={onOpen}
          disabled={opening}
          aria-label={opening ? "Opening region" : "Open another region"}
          title="Open another region"
        >
          <PlusIcon size={15} />
          <span>{opening ? "Opening…" : "Open"}</span>
        </button>
        <button
          type="button"
          className="project-tabs__ssh"
          onClick={onOpenSsh}
          disabled={opening}
          aria-label="Open a remote project over SSH"
          title="Open a remote project over SSH"
        >
          <span>SSH</span>
        </button>
        {canRefresh ? (
          <button
            type="button"
            className="project-tabs__refresh"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label={
              refreshing ? "Refreshing active project" : "Refresh active project"
            }
            title="Refresh project content or activate a newly synchronized Mindflow build"
          >
            <span className={refreshing ? "is-spinning" : ""} aria-hidden="true">
              <RefreshIcon size={14} />
            </span>
            <span>{refreshing ? "Refreshing…" : "Refresh"}</span>
          </button>
        ) : null}
      </div>
    </nav>
  );
}
