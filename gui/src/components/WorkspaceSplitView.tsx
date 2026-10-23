import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import {
  DEFAULT_FILES_SIDEBAR_WIDTH,
  filesSidebarWidthFromPointer,
  MAXIMUM_FILES_SIDEBAR_WIDTH,
  MINIMUM_FILES_SIDEBAR_WIDTH,
  normalizeFilesSidebarWidth,
} from "../workspaceSidebar";

interface WorkspaceSplitViewProps {
  files: ReactNode;
  children: ReactNode;
  filesWidth: number;
  onFilesWidthChange: (width: number) => void;
}

interface FilesSidebarResize {
  pointerId: number;
  startingClientX: number;
  startingWidth: number;
  currentWidth: number;
}

export function WorkspaceSplitView({
  files,
  children,
  filesWidth,
  onFilesWidthChange,
}: WorkspaceSplitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<FilesSidebarResize | undefined>(undefined);
  const normalizedWidth = normalizeFilesSidebarWidth(filesWidth);

  const renderWidth = (width: number) => {
    containerRef.current?.style.setProperty(
      "--files-sidebar-width",
      `${width}px`,
    );
  };

  useLayoutEffect(() => renderWidth(normalizedWidth), [normalizedWidth]);

  const beginResize = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      pointerId: event.pointerId,
      startingClientX: event.clientX,
      startingWidth: normalizedWidth,
      currentWidth: normalizedWidth,
    };
    event.currentTarget.classList.add("is-resizing");
    containerRef.current?.setAttribute("data-files-sidebar-resizing", "true");
  };

  const moveResize = (event: PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    const container = containerRef.current;
    if (!resize || resize.pointerId !== event.pointerId || !container) return;
    event.preventDefault();
    resize.currentWidth = filesSidebarWidthFromPointer(
      resize.startingWidth,
      resize.startingClientX,
      event.clientX,
      container.clientWidth,
    );
    renderWidth(resize.currentWidth);
    event.currentTarget.setAttribute(
      "aria-valuenow",
      String(resize.currentWidth),
    );
  };

  const finishResize = (event: PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    resizeRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.currentTarget.classList.remove("is-resizing");
    containerRef.current?.removeAttribute("data-files-sidebar-resizing");
    onFilesWidthChange(resize.currentWidth);
  };

  const handleSeparatorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;
    const step = event.shiftKey ? 48 : 16;
    const requested =
      event.key === "ArrowLeft"
        ? normalizedWidth - step
        : event.key === "ArrowRight"
          ? normalizedWidth + step
          : event.key === "Home"
            ? MINIMUM_FILES_SIDEBAR_WIDTH
            : event.key === "End"
              ? MAXIMUM_FILES_SIDEBAR_WIDTH
              : undefined;
    if (requested === undefined) return;
    event.preventDefault();
    onFilesWidthChange(
      filesSidebarWidthFromPointer(
        normalizedWidth,
        0,
        requested - normalizedWidth,
        container.clientWidth,
      ),
    );
  };

  return (
    <div
      className="workspace-split-view"
      ref={containerRef}
      style={
        {
          "--files-sidebar-width": `${normalizedWidth}px`,
        } as CSSProperties
      }
    >
      <aside className="workspace-files-sidebar" aria-label="Project files">
        {files}
      </aside>
      <div
        className="workspace-files-separator"
        role="separator"
        aria-label="Resize project files"
        aria-orientation="vertical"
        aria-valuemin={MINIMUM_FILES_SIDEBAR_WIDTH}
        aria-valuemax={MAXIMUM_FILES_SIDEBAR_WIDTH}
        aria-valuenow={normalizedWidth}
        aria-keyshortcuts="ArrowLeft ArrowRight Home End"
        tabIndex={0}
        title="Drag to resize Files"
        onDoubleClick={() => onFilesWidthChange(DEFAULT_FILES_SIDEBAR_WIDTH)}
        onKeyDown={handleSeparatorKeyDown}
        onPointerDown={beginResize}
        onPointerMove={moveResize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
      />
      <section className="workspace-semantic-surface">{children}</section>
    </div>
  );
}
