export interface RuntimeVersion {
  release: string;
  project_format: string;
  bridge_protocol: number;
  source_digest: string | null;
  source_revision: string | null;
  built_at: string | null;
}

export interface ProjectVersion {
  format: string | null;
  adopted_release: string | null;
}

export interface DesktopVersionInfo {
  app: { release: string; variant: "development" | "stable" | "unknown" };
  local_core: RuntimeVersion;
  project_core: RuntimeVersion | null;
  project: ProjectVersion;
  local_update:
    | { status: "unknown" | "current" }
    | { status: "ready"; release: string; built_at: string };
}

export function appVersionLabel(info?: DesktopVersionInfo): string {
  if (!info) return "Version · Unknown";
  const name = info.app.variant === "development" ? "Dev"
    : info.app.variant === "stable" ? "Stable" : "Unknown";
  return `${name} · ${info.app.release || "Unknown"}`;
}

export function adoptionComparison(info?: DesktopVersionInfo): string {
  const adopted = info?.project.adopted_release;
  const runtime = info?.project_core?.release;
  if (!adopted || !runtime) return "Unknown";
  return adopted === runtime
    ? "Matches the serving core release"
    : "Differs from the serving core release";
}
