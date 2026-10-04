"use client";

import { useState } from "react";
import { statusChipClass } from "@/lib/scheduler/taskStatus";

type Props = {
  storyCount: number;
  /** Statuses the selected stories have now, with how many selected stories each holds. */
  currentStatuses: Array<{ status: string; count: number }>;
  statuses: readonly string[];
  /** How many selected stories are linked to Jira (they will show Needs push). */
  jiraLinkedCount: number;
  onClose: () => void;
  onSave: (status: string) => void;
};

/**
 * Set one status on several stories at once (planner only — nothing is sent to Jira until they are pushed).
 * Calls `onSave(status)`; the parent applies it in one store update.
 */
export function BulkStatusModal({ storyCount, currentStatuses, statuses, jiraLinkedCount, onClose, onSave }: Props) {
  const [picked, setPicked] = useState(currentStatuses.length === 1 ? currentStatuses[0].status : "");
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
          if (picked) onSave(picked);
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-status-title"
      >
        <h3 id="bulk-status-title" className="text-lg font-semibold text-slate-900">
          Set status for {storyCount} {storyWord}
        </h3>
        <p className="mt-1 text-[13px] text-slate-600">
          Changes the status in the planner only.
          {jiraLinkedCount > 0
            ? ` ${jiraLinkedCount} linked ${jiraLinkedCount === 1 ? "story" : "stories"} will show Needs push — push them to update Jira.`
            : ""}
        </p>

        {currentStatuses.length > 0 ? (
          <p className="mt-3 text-[12px] text-slate-600">
            Now:{" "}
            {currentStatuses.map((entry, index) => (
              <span key={entry.status}>
                {index > 0 ? ", " : ""}
                <span className="font-semibold text-slate-800">{entry.status}</span> ({entry.count})
              </span>
            ))}
          </p>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-1" role="listbox" aria-label="New status">
          {statuses.map((status) => (
            <button
              key={status}
              type="button"
              role="option"
              aria-selected={picked === status}
              title={`Set "${status}"`}
              className={`task-status-picker-option ${statusChipClass(status)} ${
                picked === status ? "ring-2 ring-blue-500" : "hover:brightness-[0.98]"
              }`}
              onClick={() => setPicked(status)}
            >
              {status}
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            className="btn-secondary px-3 py-1.5 text-sm"
            title="Close without changing statuses"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={!picked}
            title={picked ? `Set "${picked}" on the selected ${storyWord}` : "Pick a status first"}
          >
            Set status
          </button>
        </div>
      </form>
    </div>
  );
}
