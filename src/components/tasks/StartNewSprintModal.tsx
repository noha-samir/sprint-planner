"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import type { Task } from "@/lib/scheduler/types";
import {
  applyFullEstimateToAllDevRows,
  carryOverridesFromWizardRows,
  defaultCarryWizardRows,
  toggleDevRowFullEstimate,
  validateCarryWizardRows,
  type CarryWizardRow,
} from "@/lib/planner/sprintCarryOver";
import type { CarryOverRemainingByTaskId } from "@/store/taskRules";
import { parseCalendarDate, todayDateKey } from "@/lib/scheduler/calendar";

type Props = {
  open: boolean;
  tasks: Task[];
  totalStories: number;
  nextSprintStories: number;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (sprintStartDate: string, carryRemainingByTaskId?: CarryOverRemainingByTaskId) => void;
};

const isValidDateKey = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = parseCalendarDate(value);
  return !Number.isNaN(parsed.getTime()) && format(parsed, "yyyy-MM-dd") === value;
};

const parseHourInput = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

export function StartNewSprintModal({
  open,
  tasks,
  totalStories,
  nextSprintStories,
  busy = false,
  onClose,
  onConfirm,
}: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [sprintStartDate, setSprintStartDate] = useState(todayDateKey());
  const [carryRows, setCarryRows] = useState<CarryWizardRow[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  const currentSprintTasks = useMemo(
    () => tasks.filter((task) => !task.carryToNextSprint),
    [tasks],
  );

  useEffect(() => {
    if (open) {
      setSprintStartDate(todayDateKey());
      setStep(1);
      setCarryRows(defaultCarryWizardRows(currentSprintTasks));
      setValidationError(null);
    }
  }, [open, currentSprintTasks]);

  const currentSprintStories = Math.max(0, totalStories - nextSprintStories);
  const storyWord = totalStories === 1 ? "story" : "stories";
  const startLabel = useMemo(() => {
    if (!isValidDateKey(sprintStartDate)) {
      return null;
    }
    return format(parseCalendarDate(sprintStartDate), "EEE dd MMM, yyyy");
  }, [sprintStartDate]);

  const devRows = carryRows.filter((row) => row.kind === "dev");
  const qcRows = carryRows.filter((row) => row.kind === "qc");

  const updateRow = (taskId: string, patch: Partial<CarryWizardRow>) => {
    setCarryRows((rows) => rows.map((row) => (row.taskId === taskId ? { ...row, ...patch } : row)));
    setValidationError(null);
  };

  const handleNext = () => {
    if (carryRows.length === 0) {
      if (!isValidDateKey(sprintStartDate)) return;
      onConfirm(sprintStartDate, undefined);
      return;
    }
    setStep(2);
  };

  const handleConfirm = () => {
    const error = validateCarryWizardRows(carryRows);
    if (error) {
      setValidationError(error);
      return;
    }
    if (!isValidDateKey(sprintStartDate)) {
      return;
    }
    onConfirm(sprintStartDate, carryOverridesFromWizardRows(carryRows));
  };

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
        className={`w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-xl ${step === 2 ? "max-w-4xl" : "max-w-lg"}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-new-sprint-title"
      >
        <h3 id="start-new-sprint-title" className="text-lg font-semibold text-slate-900">
          {step === 1 ? "Start a new sprint?" : "Confirm remaining hours (carry-over)"}
        </h3>

        {step === 1 ? (
          <>
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
                <li>Stories on Next Sprint move to Current Sprint and their status resets to To Do (new work).</li>
                <li>
                  Stories already on Current Sprint stay as they are and count as carry-over for utilization.
                </li>
                {carryRows.length > 0 ? (
                  <li>
                    You will confirm remaining dev/QC hours for{" "}
                    <span className="font-semibold">{carryRows.length}</span> carry-over{" "}
                    {carryRows.length === 1 ? "story" : "stories"}.
                  </li>
                ) : null}
                <li>Sprint start / planning dates become the date you pick; old extra holidays clear.</li>
              </ol>
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-slate-600">
              Set how many hours still count toward people utilization this sprint. UAT / Production stories are
              excluded automatically.
            </p>
            {devRows.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary px-2 py-1 text-[11px] disabled:opacity-50"
                  disabled={busy}
                  onClick={() => setCarryRows((rows) => applyFullEstimateToAllDevRows(rows))}
                >
                  Full estimates for all dev carry (untouched)
                </button>
                <span className="text-[11px] text-slate-500">
                  Or tick per story when dev work was not consumed last sprint.
                </span>
              </div>
            ) : null}
            {validationError ? (
              <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
                {validationError}
              </p>
            ) : null}
            <div className="mt-3 max-h-[55vh] space-y-4 overflow-y-auto pr-1">
              {devRows.length > 0 ? (
                <div>
                  <h4 className="text-[13px] font-semibold text-slate-800">
                    Dev carry-over ({devRows.length})
                  </h4>
                  <div className="mt-2 space-y-2">
                    {devRows.map((row) => (
                      <div key={row.taskId} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="text-[12px] font-semibold text-slate-900">{row.storyName}</div>
                            <div className="text-[11px] text-slate-600">{row.status}</div>
                          </div>
                          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-700">
                            <input
                              type="checkbox"
                              className="rounded border-slate-300"
                              checked={row.useFullEstimate}
                              disabled={busy}
                              onChange={(event) =>
                                setCarryRows((rows) =>
                                  rows.map((entry) =>
                                    entry.taskId === row.taskId
                                      ? toggleDevRowFullEstimate(entry, event.target.checked)
                                      : entry,
                                  ),
                                )
                              }
                            />
                            Full estimate (dev untouched)
                          </label>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {(
                            [
                              ["FE", "fe", row.estimateFe, row.defaultFe],
                              ["BE", "be", row.estimateBe, row.defaultBe],
                              ["MO", "android", row.estimateAndroid, row.defaultAndroid],
                              ["QC", "qc", row.estimateQc, row.defaultQc],
                            ] as const
                          ).map(([label, field, estimate, statusDefault]) => (
                            <label key={field} className="text-[10px] font-medium text-slate-700">
                              {label} rem (est {estimate}h
                              {row.useFullEstimate ? "" : `, status ${statusDefault}h`})
                              <input
                                type="number"
                                min={0}
                                step={0.5}
                                disabled={busy || row.useFullEstimate}
                                className="field-input mt-0.5 w-full px-1.5 py-1 text-[12px] disabled:bg-slate-100"
                                value={row[field]}
                                onChange={(event) =>
                                  updateRow(row.taskId, {
                                    [field]: parseHourInput(event.target.value),
                                    useFullEstimate: false,
                                  })
                                }
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {qcRows.length > 0 ? (
                <div>
                  <h4 className="text-[13px] font-semibold text-slate-800">QC carry-over ({qcRows.length})</h4>
                  <div className="mt-2 space-y-2">
                    {qcRows.map((row) => (
                      <div key={row.taskId} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <div className="text-[12px] font-semibold text-slate-900">{row.storyName}</div>
                        <div className="text-[11px] text-slate-600">{row.status}</div>
                        <label className="mt-2 block text-[10px] font-medium text-slate-700">
                          QC rem (est {row.estimateQc}h)
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            disabled={busy}
                            className="field-input mt-0.5 w-full max-w-[8rem] px-1.5 py-1 text-[12px]"
                            value={row.qc}
                            onChange={(event) =>
                              updateRow(row.taskId, { qc: parseHourInput(event.target.value) })
                            }
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="btn-secondary px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={busy}
            onClick={() => {
              if (step === 2) {
                setStep(1);
                setValidationError(null);
                return;
              }
              onClose();
            }}
          >
            {step === 2 ? "Back" : "Cancel"}
          </button>
          {step === 1 ? (
            <button
              type="button"
              className="btn-danger px-3 py-1.5 text-sm disabled:opacity-50"
              disabled={busy || !isValidDateKey(sprintStartDate)}
              onClick={handleNext}
            >
              {carryRows.length > 0 ? "Next: remaining hours" : busy ? "Starting…" : "Start new sprint"}
            </button>
          ) : (
            <button
              type="button"
              className="btn-danger px-3 py-1.5 text-sm disabled:opacity-50"
              disabled={busy || !isValidDateKey(sprintStartDate)}
              onClick={handleConfirm}
            >
              {busy ? "Starting…" : "Start new sprint"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
