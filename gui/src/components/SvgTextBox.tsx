import { memo, useCallback } from "react";

interface SvgTextBoxProps {
  measurementKey: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  className: string;
  foreignObjectClassName?: string;
  onElement: (key: string, element: HTMLDivElement | null) => void;
}

export const SvgTextBox = memo(function SvgTextBox({
  measurementKey,
  label,
  x,
  y,
  width,
  height,
  className,
  foreignObjectClassName,
  onElement,
}: SvgTextBoxProps) {
  const registerElement = useCallback(
    (element: HTMLDivElement | null) => onElement(measurementKey, element),
    [measurementKey, onElement],
  );

  return (
    <foreignObject
      className={`svg-text-box__foreign${
        foreignObjectClassName ? ` ${foreignObjectClassName}` : ""
      }`}
      x={x}
      y={y}
      width={width}
      height={height}
      aria-hidden="true"
    >
      <div ref={registerElement} className={`svg-text-box ${className}`}>
        {label}
      </div>
    </foreignObject>
  );
});
