import {
  MAXIMUM_INTERFACE_SCALE,
  MINIMUM_INTERFACE_SCALE,
} from "../presentationPreferences";
import {
  MindflowMark,
  StructureIcon,
  OpeningIcon,
  EvolveIcon,
} from "./Icons";

interface ControlBarProps {
  regionAvailable?: boolean;
  hasOpening?: boolean;
  regionOverviewOpen: boolean;
  interfaceScale: number;
  timelineAvailable?: boolean;
  timelineOpen?: boolean;
  qcOpen?: boolean;
  onToggleQc?: () => void;
  onStructureToolbarHost?: (element: HTMLDivElement | null) => void;
  onInterfaceScaleChange: (
    change: "decrease" | "increase" | "reset",
  ) => void;
  onStructureHome?: () => void;
  onFocusOpening?: () => void;
  onOpenEvolve?: () => void;
  onToggleRegionOverview: () => void;
}

export function ControlBar({
  regionAvailable = true,
  hasOpening = false,
  regionOverviewOpen,
  interfaceScale,
  timelineAvailable = false,
  timelineOpen = false,
  qcOpen = false,
  onToggleQc,
  onStructureToolbarHost,
  onInterfaceScaleChange,
  onStructureHome,
  onFocusOpening,
  onOpenEvolve,
  onToggleRegionOverview,
}: ControlBarProps) {
  return (
    <div className="control-bar">
      <div className="layout-control" aria-label="Structure workspace controls">
        {regionAvailable ? (
          <div className="soe-controls" role="group" aria-label="Structure, Opening, and Evolve">
            <button type="button" className="soe-button" data-soe="structure" data-structure-toggle
              aria-pressed={!timelineOpen && !qcOpen} title="Structure home — return to project overview"
              onClick={onStructureHome}>
              <StructureIcon /><span>Structure</span>
            </button>
            <button type="button" className="soe-button" data-soe="opening"
              disabled={!hasOpening} title={hasOpening ? "Focus current Opening documents in Structure" : "No current Opening documents"}
              onClick={onFocusOpening}>
              <OpeningIcon /><span>Opening</span>
            </button>
            <button type="button" className="soe-button" data-soe="evolve" data-timeline-toggle
              aria-pressed={timelineOpen} disabled={!timelineAvailable}
              title={timelineAvailable ? "Open Evolve" : "No Opening files, Events, or Anchors"}
              onClick={onOpenEvolve}>
              <EvolveIcon /><span>Evolve</span>
            </button>
          </div>
        ) : null}
        <div
          className="interface-scale-control"
          role="group"
          aria-label={`Interface size, ${Math.round(interfaceScale * 100)} percent`}
        >
          <button
            type="button"
            onClick={() => onInterfaceScaleChange("decrease")}
            disabled={interfaceScale <= MINIMUM_INTERFACE_SCALE}
            aria-label="Make interface smaller"
            title="Make interface smaller"
          >
            <span aria-hidden="true">A−</span>
          </button>
          <button
            type="button"
            className="interface-scale-control__value"
            onClick={() => onInterfaceScaleChange("reset")}
            aria-label={`Reset interface size from ${Math.round(interfaceScale * 100)} percent`}
            title="Reset interface size"
          >
            {Math.round(interfaceScale * 100)}%
          </button>
          <button
            type="button"
            onClick={() => onInterfaceScaleChange("increase")}
            disabled={interfaceScale >= MAXIMUM_INTERFACE_SCALE}
            aria-label="Make interface larger"
            title="Make interface larger"
          >
            <span aria-hidden="true">A+</span>
          </button>
        </div>
      </div>

      {onStructureToolbarHost ? (
        <div
          className={`structure-toolbar-slot${timelineOpen || qcOpen ? " is-covered" : ""}`}
          aria-hidden={timelineOpen || qcOpen || undefined}
          inert={timelineOpen || qcOpen || undefined}
          ref={onStructureToolbarHost}
        />
      ) : null}

      {onToggleQc ? (
        <button type="button" className={`timeline-toggle${qcOpen ? " is-active" : ""}`}
          aria-pressed={qcOpen} aria-label="Documentation QC" title="Document volume and growth"
          data-qc-toggle onClick={onToggleQc}>
          <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 2v12h12M4 10l3-4 3 2 4-5" /></svg>
          <span>QC</span>
        </button>
      ) : null}
      {regionAvailable ? (
        <button
          type="button"
          className={`region-toggle${regionOverviewOpen ? " is-active" : ""}`}
          aria-pressed={regionOverviewOpen}
          title="Show the validated Project Map vocabulary, Opening, Events, and Anchors"
          onClick={onToggleRegionOverview}
        >
          <MindflowMark size={12} />
          <span>Region</span>
        </button>
      ) : null}
    </div>
  );
}
