"use client";

import { useEffect, useState } from "react";

type OrderInputProps = {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  className?: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Compact schedule-order control for the select column.
 * − / + move rank; empty clears order (null).
 */
export function OrderInput({
  value,
  onChange,
  disabled = false,
  min = 1,
  max = 999,
  className = "",
}: OrderInputProps) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync draft from controlled value when not editing
      setDraft(value == null ? "" : String(value));
    }
  }, [value, focused]);

  const commitRaw = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      onChange(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      onChange(null);
      return;
    }
    onChange(clamp(Math.trunc(parsed), min, max));
  };

  const bump = (direction: -1 | 1) => {
    if (disabled) return;
    if (value == null) {
      onChange(direction < 0 ? min : min);
      return;
    }
    onChange(clamp(value + direction, min, max));
  };

  return (
    <div className={`order-input ${disabled ? "order-input-disabled" : ""} ${className}`.trim()}>
      <span className="order-input-label" title="Schedule order — lower numbers are scheduled first.">
        Ord
      </span>
      <button
        type="button"
        className="order-input-btn"
        disabled={disabled || (value != null && value <= min)}
        title="Earlier (lower number)"
        aria-label="Move earlier in schedule"
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => bump(-1)}
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        disabled={disabled}
        className="order-input-field"
        value={draft}
        placeholder="—"
        title="Schedule order — lower numbers are scheduled first."
        aria-label="Schedule order"
        onFocus={() => setFocused(true)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setFocused(false);
          commitRaw(draft);
        }}
        onWheel={(event) => {
          event.currentTarget.blur();
          event.preventDefault();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
            event.preventDefault();
            bump(-1);
          } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
            event.preventDefault();
            bump(1);
          } else if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
      <button
        type="button"
        className="order-input-btn"
        disabled={disabled || (value != null && value >= max)}
        title="Later (higher number)"
        aria-label="Move later in schedule"
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => bump(1)}
      >
        +
      </button>
    </div>
  );
}
