import {
  MAXIMUM_CANVAS_TEXT_SCALE,
  MINIMUM_CANVAS_TEXT_SCALE,
  stepCanvasTextScale,
} from "../canvasTextScale";
import { MinusIcon, PlusIcon } from "./Icons";

interface CanvasZoomControlsProps {
  label: string;
  textScale: number;
  onFit: () => void;
  onTextScaleChange: (scale: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export function CanvasZoomControls({
  label,
  textScale,
  onFit,
  onTextScaleChange,
  onZoomIn,
  onZoomOut,
}: CanvasZoomControlsProps) {
  const textSizeLabel = label.replace(/ zoom$/i, " text size");
  const textScalePercent = Math.round(textScale * 100);
  return (
    <div
      className="zoom-controls desktop-only"
      data-canvas-overlay
      role="group"
      aria-label={`${label} and relative text size`}
      title="Text size is independent of canvas zoom and interface size"
    >
      <div
        className="zoom-controls__group zoom-controls__group--text"
        role="group"
        aria-label={`${textSizeLabel}, ${textScalePercent} percent`}
      >
        <button
          type="button"
          onClick={() => onTextScaleChange(stepCanvasTextScale(textScale, 1))}
          disabled={textScale >= MAXIMUM_CANVAS_TEXT_SCALE}
          aria-label={`Make ${textSizeLabel.toLowerCase()} larger`}
          title="Make canvas text larger"
        >
          <span aria-hidden="true">A+</span>
        </button>
        <button
          type="button"
          onClick={() => onTextScaleChange(stepCanvasTextScale(textScale, -1))}
          disabled={textScale <= MINIMUM_CANVAS_TEXT_SCALE}
          aria-label={`Make ${textSizeLabel.toLowerCase()} smaller`}
          title="Make canvas text smaller"
        >
          <span aria-hidden="true">A−</span>
        </button>
        <button
          type="button"
          className="zoom-controls__text-value"
          onClick={() => onTextScaleChange(1)}
          aria-label={`Reset ${textSizeLabel.toLowerCase()} from ${textScalePercent} percent`}
          title="Reset canvas text size"
        >
          {textScalePercent}%
        </button>
      </div>
      <div className="zoom-controls__group" role="group" aria-label={label}>
        <button type="button" onClick={onZoomIn} aria-label="Zoom in">
          <PlusIcon />
        </button>
        <button type="button" onClick={onZoomOut} aria-label="Zoom out">
          <MinusIcon />
        </button>
        <button type="button" onClick={onFit} aria-label="Fit canvas">
          <span className="fit-corners" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
