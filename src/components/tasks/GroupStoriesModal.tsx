"use client";

import { useState } from "react";
import { releaseGroupInputStyle, type NudeReleaseGroupColor } from "@/lib/planner/releaseGroupColors";
import { normalizeReleaseGroup } from "@/lib/scheduler/releaseGroups";

type Props = {
  storyCount: number;
  /** Groups the selected stories are in now, with how many selected stories each holds. */
  currentGroups: Array<{ name: string; count: number }>;
  /** Every group on the board, offered as one-click picks. */
  existingGroups: string[];
  colorMap: Map<string, NudeReleaseGroupColor>;
  onClose: () => void;
  onSave: (group: string | null) => void;
};

/**
 * Put several stories in one release group (shared UAT / production dates), or take them out of their group.
 * Calls `onSave(name)` to group, `onSave(null)` to ungroup; the parent applies it in one store update.
 */
export function GroupStoriesModal({ storyCount, currentGroups, existingGroups, colorMap, onClose, onSave }: Props) {
  const [draft, setDraft] = useState(currentGroups.length === 1 ? currentGroups[0].name : "");
  const groupName = normalizeReleaseGroup(draft.replace(/\s+/g, " "));
  const storyWord = storyCount === 1 ? "story" : "stories";

  return (
    <div
      className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-[min(12vh,6rem)]"
      onClick={onClose}
      role="presentation"
    >
      <form
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (groupName) onSave(groupName);
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-stories-title"
      >
        <h3 id="group-stories-title" className="text-lg font-semibold text-slate-900">
          Group {storyCount} {storyWord}
        </h3>
        <p className="mt-1 text-[13px] text-slate-600">
          Stories in the same group release together: they share the UAT and production dates of the last one to
          finish.
        </p>

        {currentGroups.length > 0 ? (
          <p className="mt-3 text-[12px] text-slate-600">
            Now in:{" "}
            {currentGroups.map((group, index) => (
              <span key={group.name}>
                {index > 0 ? ", " : ""}
                <span className="font-semibold text-slate-800">{group.name}</span> ({group.count})
              </span>
            ))}
          </p>
        ) : null}

        <label className="mt-4 block text-[12px] font-semibold text-slate-700">
          Group name
          <input
            autoFocus
            className="field-input mt-1 w-full"
            maxLength={96}
            placeholder="e.g. Checkout revamp"
            value={draft}
            style={releaseGroupInputStyle(groupName, colorMap)}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>

        {existingGroups.length > 0 ? (
          <div className="mt-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              Or add to an existing group
            </div>
            <div className="mt-1.5 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {existingGroups.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`group-stories-chip${groupName === name ? " group-stories-chip-on" : ""}`}
                  style={releaseGroupInputStyle(name, colorMap)}
                  title={`Use the group "${name}"`}
                  onClick={() => setDraft(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {currentGroups.length > 0 ? (
            <button
              type="button"
              className="btn-secondary mr-auto px-3 py-1.5 text-sm text-rose-700"
              title={`Take the selected ${storyWord} out of their release group`}
              onClick={() => onSave(null)}
            >
              Remove from group
            </button>
          ) : null}
          <button
            type="button"
            className="btn-secondary px-3 py-1.5 text-sm"
            title="Close without changing groups"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={!groupName}
            title={groupName ? `Put the selected ${storyWord} in "${groupName}"` : "Type or pick a group name first"}
          >
            Group {storyWord}
          </button>
        </div>
      </form>
    </div>
  );
}
