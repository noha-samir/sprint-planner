"use client";

import { useState } from "react";
import type { Task } from "@/lib/scheduler/types";

type Props = {
  task: Task;
  disabled?: boolean;
  onClose: () => void;
  onSave: (moStartDate: string | null) => void;
};

/** Remount via `key={task.id}` when the parent opens a different task. */
export function MobileStartDateModal({ task, disabled = false, onClose, onSave }: Props) {
  const [draft, setDraft] = useState(task.moStartDate?.trim() || "");

  const storyLabel = (task.storyName ?? "").trim() || task.storyLink.trim() || task.id;

  return (
    <div
      className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-[min(12vh,6rem)]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mo-start-date-title"
      >
        <h3 id="mo-start-date-title" className="text-lg font-semibold text-slate-900">
          Mobile start date
        </h3>
        <p className="mt-1 truncate text-sm text-slate-600" title={storyLabel}>
          {storyLabel}
        </p>
        <p className="mt-2 text-[13px] text-slate-600">
          Leave empty to start Android/IOS with FE/BE at sprint start.
        </p>
        <label className="mt-4 block text-[12px] font-semibold text-slate-700">
          Start date
          <input
            type="date"
            disabled={disabled}
            className="field-input mt-1 w-full"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={disabled}
            className="btn-secondary px-3 py-1.5 text-sm disabled:opacity-50"
            onClick={() => {
              setDraft("");
              onSave(null);
              onClose();
            }}
          >
            Clear
          </button>
          <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={disabled}
            className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
            onClick={() => {
              const next = draft.trim();
              onSave(next || null);
              onClose();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
