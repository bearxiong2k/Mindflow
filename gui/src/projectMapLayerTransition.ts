export interface ProjectMapLayerBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ProjectMapLayerOrigin {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface ProjectMapLayerGeometry {
  clipBottom: number;
  clipLeft: number;
  clipRight: number;
  clipTop: number;
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
}

export interface ProjectMapLayerFrame {
  height: string;
  transform: string;
  width: string;
}

export interface ProjectMapLayerInlineFrame {
  height: string;
  transform: string;
  width: string;
}

export interface ProjectMapLayerNavigationGate {
  begin: () => number;
  cancel: () => void;
  commitWhenReady: (
    revision: number,
    readiness: Promise<unknown>,
    commit: () => void,
  ) => Promise<boolean>;
}

export type ProjectMapLayerTransitionPhase =
  | "preparing"
  | "entering"
  | "closing";

export const PROJECT_MAP_LAYER_ENTRY_TRANSITION_MS = 160;
export const PROJECT_MAP_LAYER_EXIT_TRANSITION_MS = 140;

export function projectMapLayerTransitionMilliseconds(
  phase: ProjectMapLayerTransitionPhase,
) {
  return phase === "closing"
    ? PROJECT_MAP_LAYER_EXIT_TRANSITION_MS
    : PROJECT_MAP_LAYER_ENTRY_TRANSITION_MS;
}

export const DEFAULT_PROJECT_MAP_LAYER_ORIGIN: ProjectMapLayerOrigin = {
  top: 0.46,
  left: 0.44,
  width: 0.12,
  height: 0.08,
};

export function createProjectMapLayerNavigationGate(
): ProjectMapLayerNavigationGate {
  let currentRevision = 0;
  return {
    begin() {
      currentRevision += 1;
      return currentRevision;
    },
    cancel() {
      currentRevision += 1;
    },
    async commitWhenReady(revision, readiness, commit) {
      await readiness;
      if (revision !== currentRevision) return false;
      commit();
      return true;
    },
  };
}

export function projectMapLayerGeometry(
  origin: ProjectMapLayerOrigin,
): ProjectMapLayerGeometry {
  const scale = Math.max(
    Number.EPSILON,
    Math.min(origin.width, origin.height),
  );
  const centerX = origin.left + origin.width / 2;
  const centerY = origin.top + origin.height / 2;
  return {
    clipBottom: 0,
    clipLeft: 0,
    clipRight: 0,
    clipTop: 0,
    scaleX: scale,
    scaleY: scale,
    translateX: centerX - scale / 2,
    translateY: centerY - scale / 2,
  };
}

export function projectMapLayerSnapshotFrame(
  inline: ProjectMapLayerInlineFrame,
  fallback: { height: number; width: number },
): ProjectMapLayerFrame {
  return {
    height: inline.height || `${fallback.height}px`,
    transform: inline.transform || "translate3d(0, 0, 0)",
    width: inline.width || `${fallback.width}px`,
  };
}

export function projectMapLayerOrigin(
  origin: ProjectMapLayerBounds | undefined,
  stage: ProjectMapLayerBounds,
): ProjectMapLayerOrigin {
  if (!origin) return DEFAULT_PROJECT_MAP_LAYER_ORIGIN;
  const width = Math.max(1, stage.width);
  const height = Math.max(1, stage.height);
  const left = Math.min(width, Math.max(0, origin.left - stage.left));
  const right = Math.min(
    width,
    Math.max(0, origin.left + origin.width - stage.left),
  );
  const top = Math.min(height, Math.max(0, origin.top - stage.top));
  const bottom = Math.min(
    height,
    Math.max(0, origin.top + origin.height - stage.top),
  );
  if (right <= left || bottom <= top) return DEFAULT_PROJECT_MAP_LAYER_ORIGIN;
  return {
    top: top / height,
    left: left / width,
    width: (right - left) / width,
    height: (bottom - top) / height,
  };
}
