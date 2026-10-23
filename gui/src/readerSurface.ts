export type ApplicationSurface = "workspace" | "reader";

export const READER_WINDOW_LABEL_PREFIX = "reader-";

export function resolveApplicationSurface(
  search: string,
  windowLabel?: string,
): ApplicationSurface {
  if (new URLSearchParams(search).get("surface") === "reader") {
    return "reader";
  }
  return windowLabel?.startsWith(READER_WINDOW_LABEL_PREFIX)
    ? "reader"
    : "workspace";
}
