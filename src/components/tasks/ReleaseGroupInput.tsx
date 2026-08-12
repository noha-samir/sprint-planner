"use client";

import { useEffect, useState } from "react";
import {
  releaseGroupInputStyle,
  type NudeReleaseGroupColor,
} from "@/lib/planner/releaseGroupColors";

type ReleaseGroupInputProps = {
  taskId: string;
  value: string | null;
  storyLabel: string;
  colorMap: Map<string, NudeReleaseGroupColor>;
  help: string;
  onCommit: (next: string | null) => void;
  disabled?: boolean;
};

/**
 * Local-draft release group field — commits to the store on blur only,
 * so typing does not reschedule the sprint on every keystroke.
 */
export function ReleaseGroupInput({
  taskId,
  value,
  storyLabel,
  colorMap,
  help,
  onCommit,
  disabled = false,
}: ReleaseGroupInputProps) {
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset draft when row value changes
    setDraft(value ?? "");
  }, [taskId, value]);

  return (
    <div className="story-select-release-wrap">
      <textarea
        className="story-select-release-input field-input"
        placeholder="Group"
        maxLength={96}
        rows={2}
        title={draft.trim() || help}
        value={draft}
        disabled={disabled}
        readOnly={disabled}
        style={releaseGroupInputStyle(draft.length > 0 ? draft : null, colorMap)}
        onChange={(event) => {
          if (disabled) return;
          setDraft(event.target.value);
        }}
        onBlur={() => {
          if (disabled) return;
          const trimmed = draft.trim().replace(/\s+/g, " ");
          const next = trimmed.length > 0 ? trimmed : null;
          setDraft(next ?? "");
          if ((value ?? null) !== next) {
            onCommit(next);
          }
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        aria-label={`Release group for ${storyLabel}`}
      />
    </div>
  );
}
