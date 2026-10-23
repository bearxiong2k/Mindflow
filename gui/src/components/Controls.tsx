import type { CSSProperties } from "react";

import { CheckIcon } from "./Icons";

interface FilterToggleProps {
  active: boolean;
  color: string;
  label: string;
  count: number;
  description?: string;
  onChange: () => void;
  compact?: boolean;
  category?: "relationship" | "external-target";
  title?: string;
}

export function FilterToggle({
  active,
  color,
  label,
  count,
  description,
  onChange,
  compact = false,
  category = "relationship",
  title: explicitTitle,
}: FilterToggleProps) {
  const action = active ? "Hide" : "Show";
  const title =
    explicitTitle ??
    [
      `${action} ${label} relationships.`,
      description,
    ]
      .filter(Boolean)
      .join(" ");

  return (
    <button
      type="button"
      className={`filter-toggle${active ? " is-active" : ""}${compact ? " is-compact" : ""}${category === "external-target" ? " is-external-target" : ""}`}
      aria-pressed={active}
      onClick={onChange}
      title={title}
    >
      <span
        className="filter-toggle__check"
        style={{ "--toggle-color": color } as CSSProperties}
        aria-hidden="true"
      >
        {active ? <CheckIcon /> : null}
      </span>
      {compact ? null : (
        <span>
          {label} <span className="filter-toggle__count">({count})</span>
        </span>
      )}
    </button>
  );
}
