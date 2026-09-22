import type { Task } from "@/lib/scheduler/types";
import { effectiveMobileHours } from "@/lib/scheduler/mobilePlatform";

export type TaskDetailsSummaryChip = {
  key: string;
  label: string;
  /** Phase color class for the mini box (e.g. phase-be). */
  toneClass: string;
};

/** Packed chip rows for the collapsed Details column (2 per row, left→right, top→bottom). */
export type TaskDetailsSummaryRow = {
  key: string;
  left: TaskDetailsSummaryChip | null;
  right: TaskDetailsSummaryChip | null;
};

const formatHoursShort = (hours: number): string => {
  if (Number.isInteger(hours)) return String(hours);
  return String(Math.round(hours * 10) / 10);
};

const countIntegrationFlags = (task: Task): number =>
  [
    task.integrationFlags?.needsDevOps,
    task.integrationFlags?.needsCdc,
    task.integrationFlags?.needsDbSync,
    task.integrationFlags?.needsOtherSquad,
    task.integrationFlags?.needsThirdParty,
  ].filter(Boolean).length;

/** Chip only when hours or people/flags are set (skip 0 / empty). */
const makeChip = (
  key: string,
  label: string,
  toneClass: string,
  hours: number,
  extraCount = 0,
  extraSuffix = "p",
): TaskDetailsSummaryChip | null => {
  if (!(hours > 0) && extraCount <= 0) return null;
  const parts = [label];
  if (hours > 0) parts.push(formatHoursShort(hours));
  else parts.push(`${extraCount}${extraSuffix}`);
  return { key, label: parts.join(" "), toneClass };
};

/**
 * Compact colored chips for the collapsed Details column.
 */
export function buildTaskDetailsSummaryChips(task: Task): TaskDetailsSummaryChip[] {
  return buildTaskDetailsSummaryRows(task).flatMap((row) =>
    [row.left, row.right].filter((chip): chip is TaskDetailsSummaryChip => chip != null),
  );
}

/**
 * Chip pairs for the Details column. Present phases are packed 2-per-row
 * left→right, top→bottom (no fixed slot per phase). PM is not shown here.
 */
export function buildTaskDetailsSummaryRows(task: Task): TaskDetailsSummaryRow[] {
  const mobileHours = Math.max(
    effectiveMobileHours(task),
    Math.max(0, task.androidHours ?? 0) + Math.max(0, task.iosHours ?? 0),
  );
  const mobilePeople =
    (task.androidDevs?.length ?? 0) + (task.iosDevs?.length ?? 0);
  const hasMobileApp = task.mobileApp === "star" || task.mobileApp === "hubs";

  const chips: TaskDetailsSummaryChip[] = [
    makeChip("be", "BE", "phase-be", task.beHours, task.beDevs?.length ?? 0),
    makeChip("fe", "FE", "phase-fe", task.feHours, task.feDevs?.length ?? 0),
    makeChip("mo", "Mob", "phase-android", mobileHours, mobilePeople) ??
      (hasMobileApp || task.needsIos
        ? ({ key: "mo", label: "Mob", toneClass: "phase-android" } as const)
        : null),
    makeChip(
      "int",
      "Int",
      "phase-int",
      task.integrationHours ?? 0,
      countIntegrationFlags(task),
      "",
    ),
    makeChip("buf", "Buf", "phase-pm", task.bufferHours ?? 0),
    makeChip("qc", "QC", "phase-qc", task.qcHours, task.qcs?.length ?? 0),
  ].filter((chip): chip is TaskDetailsSummaryChip => chip != null);

  const rows: TaskDetailsSummaryRow[] = [];
  for (let i = 0; i < chips.length; i += 2) {
    const left = chips[i] ?? null;
    const right = chips[i + 1] ?? null;
    rows.push({
      key: `${left?.key ?? "empty"}-${right?.key ?? "empty"}`,
      left,
      right,
    });
  }
  return rows;
}
