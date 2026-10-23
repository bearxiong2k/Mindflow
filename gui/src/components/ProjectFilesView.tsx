import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type UIEvent,
} from "react";

import { listProjectDirectory } from "../api";
import {
  nearestVisibleProjectPath,
  PROJECT_FILES_HOVER_INTENT_MS,
  PROJECT_FILES_NAVIGATION_MS,
  projectFilesAncestorPaths,
  projectFilesFocusedPaths,
  projectFilesRevealScrollTop,
  sameProjectDirectoryEntries,
} from "../projectFilesNavigation";
import {
  readerNavigationMode,
  type ReaderDocumentActivation,
} from "../readerNavigation";
import type {
  GraphData,
  ProjectEntry,
} from "../types";
import {
  AnchorIcon,
  ChevronIcon,
  FileIcon,
  FolderIcon,
} from "./Icons";

type DirectoryLoad =
  | { status: "loading" }
  | { status: "loaded"; entries: ProjectEntry[] }
  | { status: "error"; message: string };

interface ProjectFilesViewProps {
  root: string;
  project: string;
  graph: GraphData;
  refreshGeneration: number;
  expandedPaths: ReadonlySet<string>;
  selectedPath: string;
  scrollTop: number;
  activeDirectoryPath?: string;
  navigableDirectories?: ReadonlyMap<string, string>;
  hoveredPath?: string;
  expandHoveredDirectory?: boolean;
  onHoverPath?: (path?: string) => void;
  onNavigateDirectory?: (path: string) => void;
  onExpandedPathsChange: (paths: Set<string>) => void;
  onScrollTopChange: (scrollTop: number) => void;
  onSelect: ReaderDocumentActivation;
}

interface ProjectDirectoryRowsProps {
  entries: readonly ProjectEntry[];
  depth: number;
  directories: ReadonlyMap<string, DirectoryLoad>;
  expandedPaths: ReadonlySet<string>;
  animate: boolean;
  selectedPath: string;
  activeDirectoryPath?: string;
  hoveredPath?: string;
  navigableDirectories?: ReadonlyMap<string, string>;
  onHoverPath?: (path?: string) => void;
  onNavigateDirectory?: (path: string) => void;
  managedByPath: ReadonlyMap<string, {path:string; component:string; description?:string}>;
  anchorPaths: ReadonlySet<string>;
  onLoadDirectory: (path: string) => void;
  onSelect: ReaderDocumentActivation;
  onToggleDirectory: (path: string) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ProjectDirectoryGroup({ expanded, animate, children }: {
  expanded: boolean;
  animate: boolean;
  children: ReactNode;
}) {
  const [present, setPresent] = useState(expanded);

  useLayoutEffect(() => {
    if (expanded || !animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPresent(expanded);
      return;
    }
    // Retain inert children only for the closing transition. CSS owns natural
    // height, including lazy listings and interruption by native window focus.
    const timeout = window.setTimeout(() => setPresent(false), PROJECT_FILES_NAVIGATION_MS);
    return () => window.clearTimeout(timeout);
  }, [animate, expanded]);

  return (
    <div className="project-directory__children" role="group"
      style={{
        gridTemplateRows: expanded ? "1fr" : "0fr",
        transitionDuration: animate ? `${PROJECT_FILES_NAVIGATION_MS}ms` : "0ms",
      }} inert={!expanded || undefined}
      aria-hidden={!expanded || undefined}>
      <div className="project-directory__children-content">
        {expanded || present ? children : null}
      </div>
    </div>
  );
}

function ProjectFileRow({
  entry,
  depth,
  selectedPath,
  managed,
  anchor,
  hoveredPath,
  onHoverPath,
  onSelect,
}: {
  entry: ProjectEntry;
  depth: number;
  selectedPath: string;
  managed?: {path:string; component:string; description?:string};
  anchor: boolean;
  hoveredPath?: string;
  onHoverPath?: (path?: string) => void;
  onSelect: ReaderDocumentActivation;
}) {
  return (
    <div
      className={`project-file${selectedPath === entry.path ? " is-selected" : ""}${managed ? "" : " is-unmanaged"}${anchor ? " is-anchor" : ""}${hoveredPath === entry.path ? " is-linked-hover" : ""}`}
      data-project-path={entry.path}
      onPointerEnter={() => onHoverPath?.(entry.path)}
      onPointerLeave={() => onHoverPath?.(undefined)}
      onFocus={() => onHoverPath?.(entry.path)}
      onBlur={() => onHoverPath?.(undefined)}
      style={{ "--tree-depth": depth } as CSSProperties}
      role="none"
    >
      <button
        type="button"
        className="project-file__main"
        title={entry.path}
        role="treeitem"
        aria-description={managed
          ? `Managed by Mindflow: ${managed.component}${managed.description ? `. ${managed.description}` : ""}`
          : "Not managed by Mindflow"}
        aria-level={depth + 1}
        aria-selected={selectedPath === entry.path}
        onClick={(event) => onSelect(entry.path, readerNavigationMode(event))}
      >
        <FileIcon />
        <span className="project-file__name">{entry.name}</span>
        {anchor ? (
          <span className="project-file__anchor" title="Current anchor file" aria-label="Current anchor file">
            <AnchorIcon />
          </span>
        ) : null}
      </button>
    </div>
  );
}

function ProjectDirectoryRows({
  entries,
  depth,
  directories,
  expandedPaths,
  animate,
  selectedPath,
  activeDirectoryPath,
  hoveredPath,
  navigableDirectories,
  onHoverPath,
  onNavigateDirectory,
  managedByPath,
  anchorPaths,
  onLoadDirectory,
  onSelect,
  onToggleDirectory,
}: ProjectDirectoryRowsProps) {
  return entries.map((entry) => {
    if (entry.kind === "file") {
      return (
        <ProjectFileRow
          key={entry.path}
          entry={entry}
          depth={depth}
          selectedPath={selectedPath}
          managed={managedByPath.get(entry.path)}
          anchor={anchorPaths.has(entry.path)}
          hoveredPath={hoveredPath}
          onHoverPath={onHoverPath}
          onSelect={onSelect}
        />
      );
    }

    const expanded = expandedPaths.has(entry.path);
    const directory = directories.get(entry.path);
    const managed = managedByPath.get(entry.path);
    return (
      <div className="project-directory" role="none" key={entry.path}>
        <div
          className={`project-directory__row${activeDirectoryPath === entry.path ? " is-current" : ""}${managed ? "" : " is-unmanaged"}${hoveredPath === entry.path ? " is-linked-hover" : ""}`}
          style={{ "--tree-depth": depth } as CSSProperties}
          data-project-path={entry.path}
          onPointerEnter={() => onHoverPath?.(entry.path)}
          onPointerLeave={() => onHoverPath?.(undefined)}
          onFocus={() => onHoverPath?.(entry.path)}
          onBlur={(event) => {
            if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
            onHoverPath?.(undefined);
          }}
        >
          <button
            type="button"
            className="project-directory__toggle"
            aria-label={`${expanded ? "Collapse" : "Expand"} folder ${entry.name}`}
            onClick={() => onToggleDirectory(entry.path)}
          ><span
            className={`project-directory__caret${expanded ? " is-expanded" : ""}`}
            aria-hidden="true"
          ><ChevronIcon /></span></button>
          <button type="button" className="project-directory__main"
            role="treeitem" aria-level={depth + 1} aria-expanded={expanded}
            aria-description={managed
              ? `Managed by Mindflow: ${managed.component}${managed.description ? `. ${managed.description}` : ""}`
              : "Not managed by Mindflow"}
            aria-current={activeDirectoryPath === entry.path ? "location" : undefined}
            title={`${expanded ? "Collapse" : "Expand"} ${entry.path}`}
            onClick={() => !expanded && navigableDirectories?.has(entry.path) && onNavigateDirectory
              ? onNavigateDirectory(entry.path) : onToggleDirectory(entry.path)}
            onKeyDown={(event) => {
              if ((event.key === "ArrowRight" && !expanded) || (event.key === "ArrowLeft" && expanded)) {
                event.preventDefault();
                onToggleDirectory(entry.path);
              }
            }}>
            <FolderIcon />
            <span>{entry.name}</span>
          </button>
        </div>
        <ProjectDirectoryGroup expanded={expanded} animate={animate}>
            {!directory || directory.status === "loading" ? (
              <div className="project-files__directory-state" role="status">
                Loading {entry.name}…
              </div>
            ) : directory.status === "error" ? (
              <button
                type="button"
                className="project-files__directory-state is-error"
                onClick={() => onLoadDirectory(entry.path)}
              >
                {directory.message} · Retry
              </button>
            ) : directory.entries.length === 0 ? (
              <div className="project-files__directory-state">Empty folder</div>
            ) : (
              <ProjectDirectoryRows
                entries={directory.entries}
                depth={depth + 1}
                directories={directories}
                expandedPaths={expandedPaths}
                animate={animate}
                selectedPath={selectedPath}
                activeDirectoryPath={activeDirectoryPath}
                hoveredPath={hoveredPath}
                navigableDirectories={navigableDirectories}
                onHoverPath={onHoverPath}
                onNavigateDirectory={onNavigateDirectory}
                managedByPath={managedByPath}
                anchorPaths={anchorPaths}
                onLoadDirectory={onLoadDirectory}
                onSelect={onSelect}
                onToggleDirectory={onToggleDirectory}
              />
            )}
        </ProjectDirectoryGroup>
      </div>
    );
  });
}

export function ProjectFilesView({
  root,
  project,
  graph,
  refreshGeneration,
  expandedPaths,
  selectedPath,
  scrollTop,
  activeDirectoryPath,
  navigableDirectories,
  hoveredPath,
  expandHoveredDirectory = false,
  onHoverPath,
  onNavigateDirectory,
  onExpandedPathsChange,
  onScrollTopChange,
  onSelect,
}: ProjectFilesViewProps) {
  const [directories, setDirectories] = useState<Map<string, DirectoryLoad>>(
    () => new Map(),
  );
  const requestGenerationRef = useRef(0);
  const loadingPathsRef = useRef(new Set<string>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoreKey = root;
  const directoryRootRef = useRef(root);
  const [directoryRequestKey, setDirectoryRequestKey] = useState("");
  const [restoredScrollKey, setRestoredScrollKey] = useState("");
  const scrollCommitRef = useRef<number | undefined>(undefined);
  const [revealRequest, setRevealRequest] = useState<{
    path: string;
    kind: "navigation" | "hover" | "selection";
    revealContents?: boolean;
  }>();
  // Hover may expose a different branch without changing saved browsing state.
  // Keep the last preview on pointer exit, so leaving a node never snaps back.
  const [preview, setPreview] = useState<{
    savedPaths: ReadonlySet<string>;
    paths: ReadonlySet<string>;
  }>();
  // Explicit browsing or an external Files activation supersedes a preview.
  const previewPaths = preview?.savedPaths === expandedPaths ? preview.paths : undefined;
  const openPaths = previewPaths ?? expandedPaths;
  const openPathsRef = useRef(openPaths);
  openPathsRef.current = openPaths;
  const hoverIntentRef = useRef<number | undefined>(undefined);
  const expandedPathsRef = useRef(expandedPaths);
  expandedPathsRef.current = expandedPaths;
  const previousDirectoryRef = useRef<string | undefined>(undefined);
  const previousSelectedPathRef = useRef(selectedPath);
  const initialDirectoryRef = useRef(true);

  const revealDirectory = useCallback((path: string) => {
    window.clearTimeout(hoverIntentRef.current);
    setPreview(undefined);
    onExpandedPathsChange(projectFilesFocusedPaths(path));
    setRevealRequest({ path, kind: "navigation" });
  }, [onExpandedPathsChange]);

  useEffect(() => {
    const initial = initialDirectoryRef.current;
    initialDirectoryRef.current = false;
    const previous = previousDirectoryRef.current;
    previousDirectoryRef.current = activeDirectoryPath;
    if (activeDirectoryPath === undefined) {
      setRevealRequest(undefined);
    } else if (initial && (activeDirectoryPath === "" ||
      [...projectFilesAncestorPaths(activeDirectoryPath), activeDirectoryPath]
        .every((path) => expandedPathsRef.current.has(path)))) {
      // A restored tab already has a usable tree position; preserve it.
      return;
    } else if (previous !== activeDirectoryPath) {
      revealDirectory(activeDirectoryPath);
    }
  }, [activeDirectoryPath, revealDirectory]);

  useEffect(() => {
    // Only map-origin hover reaches this prop. Files-origin hover must never
    // move the rows under the pointer and thereby choose another target.
    setRevealRequest((current) => current?.kind === "hover" ? undefined : current);
    if (!hoveredPath) return;
    hoverIntentRef.current = window.setTimeout(() => {
      const revealContents = expandHoveredDirectory && navigableDirectories?.has(hoveredPath);
      window.clearTimeout(scrollCommitRef.current);
      setPreview({
        savedPaths: expandedPathsRef.current,
        paths: projectFilesFocusedPaths(activeDirectoryPath, hoveredPath, revealContents),
      });
      setRevealRequest({ path: hoveredPath, kind: "hover", revealContents });
    }, PROJECT_FILES_HOVER_INTENT_MS);
    return () => window.clearTimeout(hoverIntentRef.current);
  }, [activeDirectoryPath, expandHoveredDirectory, hoveredPath, navigableDirectories]);

  useEffect(() => {
    if (previousSelectedPathRef.current === selectedPath) return;
    previousSelectedPathRef.current = selectedPath;
    if (!selectedPath) return;
    window.clearTimeout(hoverIntentRef.current);
    setPreview(undefined);
    onExpandedPathsChange(projectFilesFocusedPaths(activeDirectoryPath, selectedPath));
    setRevealRequest({ path: selectedPath, kind: "selection" });
  }, [activeDirectoryPath, onExpandedPathsChange, selectedPath]);

  const navigateDirectory = useCallback((path: string) => {
    revealDirectory(path);
    onNavigateDirectory?.(path);
  }, [onNavigateDirectory, revealDirectory]);

  const managedByPath = useMemo(
    () => new Map(graph.structure.nodes.flatMap(node => node.component ? [[node.path, {path:node.path, component:node.component.id, description:node.component.description}] as const] : [])),
    [graph.structure],
  );
  const anchorPaths = useMemo(
    () => new Set(Object.values(graph.anchors).map((anchor) => anchor.file)),
    [graph.anchors],
  );

  const loadDirectory = useCallback(
    (path: string) => {
      if (loadingPathsRef.current.has(path)) return;
      const generation = requestGenerationRef.current;
      loadingPathsRef.current.add(path);
      setDirectories((current) => {
        // Revalidate a visible listing in place; only a first load needs a
        // placeholder. Errors remain visible until a successful retry.
        if (current.has(path)) return current;
        const next = new Map(current);
        next.set(path, { status: "loading" });
        return next;
      });
      void listProjectDirectory(root, path)
        .then((response) => {
          if (requestGenerationRef.current !== generation) return;
          setDirectories((current) => {
            const previous = current.get(path);
            if (previous?.status === "loaded" &&
                sameProjectDirectoryEntries(previous.entries, response.entries)) return current;
            const next = new Map(current);
            next.set(path, { status: "loaded", entries: response.entries });
            return next;
          });
        })
        .catch((error: unknown) => {
          if (requestGenerationRef.current !== generation) return;
          setDirectories((current) => {
            const previous = current.get(path);
            if (previous?.status === "error" && previous.message === errorMessage(error)) return current;
            const next = new Map(current);
            next.set(path, { status: "error", message: errorMessage(error) });
            return next;
          });
        })
        .finally(() => {
          if (requestGenerationRef.current === generation) {
            loadingPathsRef.current.delete(path);
          }
        });
    },
    [root],
  );

  useEffect(() => {
    requestGenerationRef.current += 1;
    loadingPathsRef.current.clear();
    if (directoryRootRef.current !== root) {
      directoryRootRef.current = root;
      window.clearTimeout(scrollCommitRef.current);
      setDirectories(new Map());
    } else {
      // Hidden listings will be read when reopened. Keep every currently
      // exposed branch, including hover previews, mounted during revalidation.
      const visible = new Set(["", ...openPathsRef.current]);
      setDirectories((current) => [...current.keys()].every((path) => visible.has(path))
        ? current : new Map([...current].filter(([path]) => visible.has(path))));
    }
    setDirectoryRequestKey(restoreKey);
    const paths = ["", ...openPathsRef.current];
    for (const path of paths) loadDirectory(path);
    return () => { requestGenerationRef.current += 1; };
  }, [loadDirectory, refreshGeneration, restoreKey, root]);

  useEffect(() => {
    for (const path of openPaths) {
      if (!directories.has(path)) loadDirectory(path);
    }
  }, [directories, openPaths, loadDirectory]);

  useEffect(
    () => () => {
      if (scrollCommitRef.current !== undefined) {
        window.clearTimeout(scrollCommitRef.current);
      }
    },
    [],
  );

  const rootDirectory = directories.get("");
  useLayoutEffect(() => {
    // Restore only when entering a root. Background listing checks preserve
    // the current rows and scroll position throughout the request.
    if (directoryRequestKey !== restoreKey) return;
    if (rootDirectory?.status !== "loaded") return;
    if (restoredScrollKey === restoreKey) return;
    // Restore after lazy listings have their real height. Initial expansion
    // stays still, so it cannot clamp a saved scroll position to a short tree.
    if (!revealRequest && [...openPaths].some((path) => {
      const status = directories.get(path)?.status;
      return status !== "loaded" && status !== "error";
    })) return;
    if (!revealRequest) scrollRef.current?.scrollTo({ top: scrollTop });
    setRestoredScrollKey(restoreKey);
  }, [directories, directoryRequestKey, openPaths, restoredScrollKey, restoreKey, revealRequest, rootDirectory?.status, scrollTop]);

  useLayoutEffect(() => {
    const tree = scrollRef.current;
    if (directoryRequestKey !== restoreKey) return;
    if (!tree || !revealRequest || rootDirectory?.status !== "loaded") return;
    // Resolve lazy listings before measuring. Requests for folded branches do
    // not delay the current reveal or pull it back when they eventually arrive.
    if ([...openPaths].some((path) => {
      const status = directories.get(path)?.status;
      return status !== "loaded" && status !== "error";
    })) return;
    const rows = new Map([...tree.querySelectorAll<HTMLElement>("[data-project-path]")]
      .filter((element) => !element.closest("[inert]"))
      .map((element) => [element.dataset.projectPath!, element]));
    const visiblePath = nearestVisibleProjectPath(revealRequest.path, new Set(rows.keys()));
    // A missing or failed binding still exposes its nearest available ancestor
    // and local retry control; it must not leave a reveal request running.
    const row = visiblePath === undefined ? undefined : rows.get(visiblePath);
    let cancelled = false;
    let frame = 0;
    const finish = () => {
      if (!cancelled) {
        if (revealRequest.kind !== "hover") {
          // Activation adopts an already-centered hover preview too, even when
          // no scroll event fires because the destination has not changed.
          window.clearTimeout(scrollCommitRef.current);
          onScrollTopChange(tree.scrollTop);
        }
        setRevealRequest((current) => current === revealRequest ? undefined : current);
      }
    };
    const reveal = () => {
      if (cancelled) return;
      // Folding runs first. Measure once in content coordinates after it
      // settles, then animate to one fixed endpoint, never a moving center.
      const bounds = row?.getBoundingClientRect();
      const previewHeight = revealRequest.kind === "navigation" || revealRequest.revealContents ? Math.min(
        row?.nextElementSibling?.getBoundingClientRect().height ?? 0,
        tree.clientHeight / 3, 160,
      ) : 0;
      const from = tree.scrollTop;
      const target = bounds ? projectFilesRevealScrollTop(
        from, tree.clientHeight,
        bounds.top - tree.getBoundingClientRect().top + from,
        bounds.height + previewHeight, tree.scrollHeight,
      ) : 0;
      if (Math.abs(target - from) < 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        tree.scrollTop = target;
        finish();
        return;
      }
      const start = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - start) / PROJECT_FILES_NAVIGATION_MS);
        tree.scrollTop = from + (target - from) * (1 - (1 - progress) ** 3);
        if (progress < 1) frame = window.requestAnimationFrame(step);
        else finish();
      };
      frame = window.requestAnimationFrame(step);
    };
    const folding = tree.getAnimations({ subtree: true }).filter((animation) =>
      animation.effect instanceof KeyframeEffect &&
      animation.effect.target instanceof Element &&
      animation.effect.target.classList.contains("project-directory__children"));
    void Promise.all(folding.map((animation) => animation.finished.catch(() => {}))).then(() => {
      if (!cancelled) frame = window.requestAnimationFrame(reveal);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [directories, directoryRequestKey, onScrollTopChange, openPaths, restoreKey, revealRequest, rootDirectory?.status]);

  const visiblePaths = useMemo(() => {
    const paths = new Set([""]);
    const visit = (path: string) => {
      const directory = directories.get(path);
      if (directory?.status !== "loaded") return;
      for (const entry of directory.entries) {
        paths.add(entry.path);
        if (entry.kind === "directory" && openPaths.has(entry.path)) visit(entry.path);
      }
    };
    visit("");
    return paths;
  }, [directories, openPaths]);
  const visibleHoverPath = nearestVisibleProjectPath(hoveredPath, visiblePaths);
  const cancelReveal = () => {
    window.clearTimeout(hoverIntentRef.current);
    setRevealRequest(undefined);
    setRestoredScrollKey(restoreKey);
    if (previewPaths) {
      // Manual interaction adopts the visible tree as ordinary browsing state.
      setPreview(undefined);
      onExpandedPathsChange(new Set(previewPaths));
      if (scrollRef.current) onScrollTopChange(scrollRef.current.scrollTop);
    }
  };

  const toggleDirectory = useCallback(
    (path: string) => {
      const next = new Set(openPaths);
      if (next.has(path)) next.delete(path);
      else {
        next.add(path);
        loadDirectory(path);
      }
      setPreview(undefined);
      onExpandedPathsChange(next);
    },
    [openPaths, loadDirectory, onExpandedPathsChange],
  );

  const commitScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const nextScrollTop = event.currentTarget.scrollTop;
      if (scrollCommitRef.current !== undefined) {
        window.clearTimeout(scrollCommitRef.current);
      }
      if (previewPaths || directoryRequestKey !== restoreKey || restoredScrollKey !== restoreKey) return;
      scrollCommitRef.current = window.setTimeout(() => {
        onScrollTopChange(nextScrollTop);
      }, 120);
    },
    [directoryRequestKey, onScrollTopChange, previewPaths, restoredScrollKey, restoreKey],
  );

  return (
    <section className="project-files-workspace" aria-label="Project files">
      <header className="project-files-summary">
        <button type="button"
          className={`project-files-summary__identity${activeDirectoryPath === "" ? " is-current" : ""}${visibleHoverPath === "" ? " is-linked-hover" : ""}`}
          disabled={!navigableDirectories?.has("")}
          aria-label={`Open ${project} root in Structure`}
          aria-current={activeDirectoryPath === "" ? "location" : undefined}
          onClick={() => navigateDirectory("")}
          onPointerEnter={() => onHoverPath?.("")}
          onPointerLeave={() => onHoverPath?.(undefined)}
          onFocus={() => onHoverPath?.("")}
          onBlur={() => onHoverPath?.(undefined)}>
          <FolderIcon />
          <span>Files</span>
          <strong title={project}>{project}</strong>
        </button>
        <small>Read-only</small>
      </header>
      <div
        ref={scrollRef}
        className="project-files-tree"
        role="tree"
        aria-label={`${project} project files`}
        onScroll={commitScroll}
        onWheel={cancelReveal}
        onPointerDown={cancelReveal}
        onKeyDown={cancelReveal}
      >
        {!rootDirectory || rootDirectory.status === "loading" ? (
          <div className="project-files-state" role="status">
            Loading project files…
          </div>
        ) : rootDirectory.status === "error" ? (
          <div className="project-files-state is-error" role="alert">
            <strong>Project files are unavailable.</strong>
            <span>{rootDirectory.message}</span>
            <button type="button" onClick={() => loadDirectory("")}>Retry</button>
          </div>
        ) : rootDirectory.entries.length === 0 ? (
          <div className="project-files-state">This project folder is empty.</div>
        ) : (
          <ProjectDirectoryRows
            entries={rootDirectory.entries}
            depth={0}
            directories={directories}
            expandedPaths={openPaths}
            animate={restoredScrollKey === restoreKey}
            selectedPath={selectedPath}
            activeDirectoryPath={activeDirectoryPath}
            hoveredPath={visibleHoverPath}
            navigableDirectories={navigableDirectories}
            onHoverPath={onHoverPath}
            onNavigateDirectory={navigateDirectory}
            managedByPath={managedByPath}
            anchorPaths={anchorPaths}
            onLoadDirectory={loadDirectory}
            onSelect={onSelect}
            onToggleDirectory={toggleDirectory}
          />
        )}
      </div>
    </section>
  );
}
