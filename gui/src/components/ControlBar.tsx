import {
  MAXIMUM_INTERFACE_SCALE,
  MINIMUM_INTERFACE_SCALE,
} from "../presentationPreferences";
import {
  MindflowMark,
  StructureModeIcon,
  TimelineFoldIcon,
  TimelineModeIcon,
} from "./Icons";

export type TimelineFoldAction = "fold" | "cancel";

interface ControlBarProps {
  regionAvailable?: boolean;
  hasOpening?: boolean;
  regionOverviewOpen: boolean;
  interfaceScale: number;
  timelineFoldAction?: TimelineFoldAction;
  timelineFoldDisabled?: boolean;
  timelineAvailable?: boolean;
  timelineOpen?: boolean;
  qcOpen?: boolean;
  onToggleQc?: () => void;
  onStructureToolbarHost?: (element: HTMLDivElement | null) => void;
  onInterfaceScaleChange: (
    change: "decrease" | "increase" | "reset",
  ) => void;
  onTimelineFoldAction?: () => void;
  onTimelineUnfold?: () => void;
  onToggleTimeline?: () => void;
  onToggleRegionOverview: () => void;
}

export function ControlBar({
  regionAvailable = true,
  hasOpening = false,
  regionOverviewOpen,
  interfaceScale,
  timelineFoldAction,
  timelineFoldDisabled = false,
  timelineAvailable = false,
  timelineOpen = false,
  qcOpen = false,
  onToggleQc,
  onStructureToolbarHost,
  onInterfaceScaleChange,
  onTimelineFoldAction,
  onTimelineUnfold,
  onToggleTimeline,
  onToggleRegionOverview,
}: ControlBarProps) {
  return (
    <div className="control-bar">
      <div className="layout-control" aria-label="Structure workspace controls">
        {regionAvailable ? (
          <>
            <span className="structure-workspace-label">
              <StructureModeIcon />
              Structure
            </span>
            {hasOpening ? (
              <span
                className="opening-cue-key"
                title="Dashed amber boundaries mark Opening documents and folders containing them"
              >
                <i aria-hidden="true" />
                Opening
              </span>
            ) : null}
          </>
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

      {timelineAvailable ? (
        <button
          type="button"
          className={`timeline-toggle${timelineOpen ? " is-active" : ""}`}
          aria-pressed={timelineOpen}
          data-timeline-toggle
          title={
            timelineOpen
              ? "Close Timeline and return to Structure"
              : "Open Timeline"
          }
          onClick={onToggleTimeline}
        >
          <TimelineModeIcon />
          <span>Timeline</span>
        </button>
      ) : null}

      {onStructureToolbarHost ? (
        <div
          className={`structure-toolbar-slot${timelineOpen || qcOpen ? " is-covered" : ""}`}
          aria-hidden={timelineOpen || qcOpen || undefined}
          inert={timelineOpen || qcOpen || undefined}
          ref={onStructureToolbarHost}
        />
      ) : null}

      {timelineFoldAction ? (
        <button
          type="button"
          className={`timeline-fold-toggle${
            timelineFoldAction === "fold" ? "" : " is-active"
          }`}
          aria-pressed={timelineFoldAction !== "fold"}
          disabled={timelineFoldDisabled}
          title={
            timelineFoldAction === "cancel"
              ? "Cancel folded-region endpoint selection"
              : "Select two events or folded regions to fold one inclusive Timeline region"
          }
          onClick={onTimelineFoldAction}
        >
          <TimelineFoldIcon />
          <span>{timelineFoldAction === "cancel" ? "Cancel" : "Fold"}</span>
        </button>
      ) : null}

      {onTimelineUnfold ? (
        <button
          type="button"
          className="timeline-fold-toggle"
          title="Unfold the selected region, preserving any nested folds"
          onClick={onTimelineUnfold}
        >
          <TimelineFoldIcon unfold />
          <span>Unfold</span>
        </button>
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
