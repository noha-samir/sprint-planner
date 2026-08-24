"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { parseCalendarDate, todayDateKey } from "@/lib/scheduler/calendar";

type Props = {
  open: boolean;
  totalStories: number;
  nextSprintStories: number;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (sprintStartDate: string) => void;
};

const isValidDateKey = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = parseCalendarDate(value);
  return !Number.isNaN(parsed.getTime()) && format(parsed, "yyyy-MM-dd") === value;
};

export function StartNewSprintModal({
  open,
  totalStories,
  nextSprintStories,
  busy = false,
  onClose,
  onConfirm,
}: Props) {
  const [sprintStartDate, setSprintStartDate] = useState(todayDateKey());

  useEffect(() => {
    if (open) {
      setSprintStartDate(todayDateKey());
    }
  }, [open]);

  const currentSprintStories = Math.max(0, totalStories - nextSprintStories);
  const storyWord = totalStories === 1 ? "story" : "stories";
  const startLabel = useMemo(() => {
    if (!isValidDateKey(sprintStartDate)) {
      return null;
    }
    return format(parseCalendarDate(sprintStartDate), "EEE dd MMM, yyyy");
  }, [sprintStartDate]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-[min(10vh,5rem)]"
      onClick={() => {
        if (!busy) {
          onClose();
        }
      }}
      role="presentation"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-new-sprint-title"
      >
        <h3 id="start-new-sprint-title" className="text-lg font-semibold text-slate-900">
          Start a new sprint?
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          Board now:{" "}
          <span className="font-semibold text-slate-800">
            {totalStories} {storyWord}
          </span>{" "}
          ({currentSprintStories} Current Sprint, {nextSprintStories} Next Sprint).
        </p>

        <label className="mt-4 block text-[12px] font-semibold text-slate-700">
          New sprint start date
          <input
            type="date"
            disabled={busy}
            className="field-input mt-1 w-full"
            value={sprintStartDate}
            onChange={(event) => setSprintStartDate(event.target.value)}
          />
        </label>
        {startLabel ? (
          <p className="mt-1 text-[12px] text-slate-500">Planning Sunday / sprint start: {startLabel}</p>
        ) : (
          <p className="mt-1 text-[12px] text-rose-600">Pick a valid start date.</p>
        )}

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] text-slate-700">
          <p className="font-semibold text-slate-800">What will happen</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-4">
            <li>A full snapshot of this board is saved to History (you can restore it later).</li>
            <li>All stories stay on the live board — nothing is deleted.</li>
            <li>Stories on Next Sprint move to Current Sprint and their status resets to To Do.</li>
            <li>
              Stories already on Current Sprint stay as they are (same status, hours, assignees, Grp).
            </li>
            <li>Sprint start / planning dates become the date you pick; old extra holidays clear.</li>
          </ol>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="btn-secondary px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={busy || !isValidDateKey(sprintStartDate)}
            onClick={() => onConfirm(sprintStartDate)}
          >
            {busy ? "Starting…" : "Start new sprint"}
          </button>
        </div>
      </div>
    </div>
  );
}
