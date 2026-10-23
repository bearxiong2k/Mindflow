import type { ReactNode } from "react";

interface WorkspaceBannerProps {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  multiline?: boolean;
  trailing?: ReactNode;
}

export function WorkspaceBanner({
  ariaLabel,
  children,
  className,
  multiline = false,
  trailing,
}: WorkspaceBannerProps) {
  const classes = [
    "workspace-banner",
    multiline ? "workspace-banner--multiline" : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={classes} aria-label={ariaLabel}>
      <div className="workspace-banner__content">{children}</div>
      {trailing != null ? (
        <div className="workspace-banner__trailing">{trailing}</div>
      ) : null}
    </header>
  );
}
