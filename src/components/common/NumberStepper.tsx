"use client";

import { useEffect, useState } from "react";

type NumberStepperProps = {
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** When true, clearing the input stores `null` instead of `min`. */
  allowNull?: boolean;
  className?: string;
  inputClassName?: string;
  title?: string;
  "aria-label"?: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Compact numeric control with clickable up/down steppers (not mouse-wheel driven).
 */
export function NumberStepper({
  value,
  onChange,
  min = 0,
  max = 80,
  step = 1,
  disabled = false,
  allowNull = false,
  className = "",
  inputClassName = "",
  title,
  "aria-label": ariaLabel,
}: NumberStepperProps) {
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
      onChange(allowNull ? null : min);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      onChange(allowNull ? null : min);
      return;
    }
    onChange(clamp(parsed, min, max));
  };

  const bump = (direction: 1 | -1) => {
    if (disabled) return;
    let next: number | null;
    if (value == null) {
      next = direction > 0 ? min : allowNull ? null : min;
    } else {
      next = clamp(value + direction * step, min, max);
    }
    onChange(next);
    setDraft(next == null ? "" : String(next));
  };

  return (
    <div className={`number-stepper ${className}`.trim()} title={title}>
      <input
        type="text"
        inputMode="numeric"
        disabled={disabled}
        className={`number-stepper-input field-input ${inputClassName}`.trim()}
        value={draft}
        aria-label={ariaLabel}
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
          if (event.key === "ArrowUp") {
            event.preventDefault();
            bump(1);
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            bump(-1);
          } else if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
      <div className="number-stepper-buttons">
        <button
          type="button"
          className="number-stepper-btn"
          disabled={disabled || (value != null && value >= max)}
          aria-label="Increase"
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => bump(1)}
        >
          ▴
        </button>
        <button
          type="button"
          className="number-stepper-btn"
          disabled={disabled || (value != null && value <= min) || (allowNull && value == null)}
          aria-label="Decrease"
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => bump(-1)}
        >
          ▾
        </button>
      </div>
    </div>
  );
}
