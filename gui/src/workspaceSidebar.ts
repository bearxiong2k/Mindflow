export const DEFAULT_FILES_SIDEBAR_WIDTH = 280;
export const MINIMUM_FILES_SIDEBAR_WIDTH = 208;
export const MAXIMUM_FILES_SIDEBAR_WIDTH = 520;
export const MINIMUM_SEMANTIC_WORKSPACE_WIDTH = 360;

export function normalizeFilesSidebarWidth(
  value: unknown,
  fallback = DEFAULT_FILES_SIDEBAR_WIDTH,
): number {
  const candidate =
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.round(
    Math.min(
      MAXIMUM_FILES_SIDEBAR_WIDTH,
      Math.max(MINIMUM_FILES_SIDEBAR_WIDTH, candidate),
    ),
  );
}

export function filesSidebarWidthFromPointer(
  startingWidth: number,
  startingClientX: number,
  clientX: number,
  availableWidth: number,
): number {
  const responsiveMaximum = Math.max(
    MINIMUM_FILES_SIDEBAR_WIDTH,
    Math.min(
      MAXIMUM_FILES_SIDEBAR_WIDTH,
      Math.floor(availableWidth - MINIMUM_SEMANTIC_WORKSPACE_WIDTH),
    ),
  );
  return Math.round(
    Math.min(
      responsiveMaximum,
      Math.max(
        MINIMUM_FILES_SIDEBAR_WIDTH,
        normalizeFilesSidebarWidth(startingWidth) +
          (clientX - startingClientX),
      ),
    ),
  );
}
