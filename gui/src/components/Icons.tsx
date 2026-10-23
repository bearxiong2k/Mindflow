import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const common = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 1.7,
};

export function MindflowMark({ size = 26, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} {...props} {...common}>
      <path d="M8 7.5 14 12m0 0 6-4m-6 4v7m0-7-6 7" />
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="22" cy="6" r="2.5" />
      <circle cx="14" cy="21.5" r="2.5" />
      <circle cx="6" cy="21.5" r="2.5" />
      <rect x="11.5" y="9.5" width="5" height="5" rx="1" />
    </svg>
  );
}

export function RefreshIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} {...props} {...common}>
      <path d="M20 7v5h-5" />
      <path d="M19 12a7 7 0 1 0-2.1 5" />
    </svg>
  );
}

export function HelpIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} {...props} {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 16h.01" />
    </svg>
  );
}

export function FitIcon({ size = 17, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} {...props} {...common}>
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
      <circle cx="12" cy="12" r="3.25" />
    </svg>
  );
}

export function ExpandIcon({ size = 17, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} {...props} {...common}>
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
    </svg>
  );
}

export function FolderIcon({ size = 17, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} {...props} {...common}>
      <path d="M3 6.5h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

export function ServerIcon({ size = 17, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} {...props} {...common}>
      <rect x="4" y="3" width="16" height="7" rx="2" />
      <rect x="4" y="14" width="16" height="7" rx="2" />
      <path d="M8 6.5h.01M8 17.5h.01M12 6.5h5M12 17.5h5" />
    </svg>
  );
}

export function FileIcon({ size = 15, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} {...props} {...common}>
      <path d="M6 3h8l4 4v14H6Z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

export function AnchorIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} {...props} {...common}>
      <circle cx="10" cy="4" r="2" />
      <path d="M10 6v9M5 10H2.8c.8 4.2 3.2 6.2 7.2 6.2s6.4-2 7.2-6.2H15" />
    </svg>
  );
}

export function MapIcon({ size = 18, ...props }: IconProps) {
  return <MindflowMark size={size} {...props} />;
}

export function DocumentIcon({ size = 18, ...props }: IconProps) {
  return <FileIcon size={size} {...props} />;
}

export function ChevronIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} {...props} {...common}>
      <path d="m7 4 6 6-6 6" />
    </svg>
  );
}

export function CheckIcon({ size = 13, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} {...props} {...common}>
      <path d="m4 10 4 4 8-9" strokeWidth="2.2" />
    </svg>
  );
}

export function CloseIcon({ size = 17, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} {...props} {...common}>
      <path d="M4 4l12 12M16 4 4 16" />
    </svg>
  );
}

export function PlusIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} {...props} {...common}>
      <path d="M10 3v14M3 10h14" />
    </svg>
  );
}

export function WindowIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} {...props} {...common}>
      <rect x="3" y="4" width="14" height="12" rx="1.5" />
      <path d="M3 7h14" />
    </svg>
  );
}

export function MinusIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} {...props} {...common}>
      <path d="M3 10h14" />
    </svg>
  );
}

export function LayersIcon({ size = 15, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} {...props} {...common}>
      <path d="m3 6 7-3 7 3-7 3Z" />
      <path d="m3 10 7 3 7-3M3 14l7 3 7-3" />
    </svg>
  );
}

export function GripIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} {...props} {...common}>
      <circle cx="7" cy="5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="13" cy="5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="7" cy="10" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="13" cy="10" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="7" cy="15" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="13" cy="15" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ArrowIcon({ size = 15, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} {...props} {...common}>
      <path d="M3 10h13M11 5l5 5-5 5" />
    </svg>
  );
}

export function DirectionSwapIcon({ size = 15, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} {...props} {...common}>
      <path d="M6 3v14M3 14l3 3 3-3" />
      <path d="M14 17V3M11 6l3-3 3 3" />
    </svg>
  );
}

export function StructureModeIcon({ size = 15, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} {...props} {...common}>
      <path d="M10 4v5M5 15v-3h10v3" />
      <circle cx="10" cy="3" r="1.7" />
      <circle cx="5" cy="16.5" r="1.7" />
      <circle cx="15" cy="16.5" r="1.7" />
    </svg>
  );
}

export function TimelineModeIcon({ size = 15, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} {...props} {...common}>
      <path d="M2.5 10h15M7 10c1.5 0 1.5-4.5 3-4.5h4M11 10c1.2 0 1.2 4 2.5 4h3" />
      <circle cx="7" cy="10" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function TimelineFoldIcon({
  unfold = false,
  size = 15,
  ...props
}: IconProps & { unfold?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} {...props} {...common}>
      <path d="M3 3.5h14M3 16.5h14" />
      {unfold ? (
        <>
          <path d="M10 9V5M8 7l2-2 2 2" />
          <path d="M10 11v4M8 13l2 2 2-2" />
        </>
      ) : (
        <>
          <path d="M10 5v4M8 7l2 2 2-2" />
          <path d="M10 15v-4M8 13l2-2 2 2" />
        </>
      )}
    </svg>
  );
}

export function RelationshipDirectionIcon({
  bidirectional,
  size = 30,
  ...props
}: IconProps & { bidirectional: boolean }) {
  return (
    <svg viewBox="0 0 30 12" width={size} height={(size / 30) * 12} {...props} {...common}>
      <path d="M2 6h25" />
      <path d="m23 2 4 4-4 4" />
      {bidirectional ? <path d="M6 2 2 6l4 4" /> : null}
    </svg>
  );
}
