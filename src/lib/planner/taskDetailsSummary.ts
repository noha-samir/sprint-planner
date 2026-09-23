import type { Task } from "@/lib/scheduler/types";
import { effectiveMobileHours } from "@/lib/scheduler/mobilePlatform";
import { isStandaloneIssueType, isTechnicalTaskIssueType } from "@/lib/planner/taskIssueFilters";

export type TaskDetailsSummaryChip = {
  key: string;
  label: string;
  /** Phase color class for the mini box (e.g. phase-be). */
  toneClass: string;
  /** True when hours lack people (or flags) or people lack hours. */
  incomplete: boolean;
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

type MakeChipOptions = {
  /** When false (e.g. Buffer), hours alone are complete — no · NA. */
  requiresAssignee?: boolean;
};

/**
 * Chip when hours or people/flags are set.
 * Complete: hours + people → `ROLE 8`
 * Incomplete: hours only → `ROLE 8 · NA`; people only → `ROLE 1p`
 */
const makeChip = (
  key: string,
  label: string,
  toneClass: string,
  hours: number,
  extraCount = 0,
  extraSuffix = "p",
  options: MakeChipOptions = {},
): TaskDetailsSummaryChip | null => {
  const hasHours = hours > 0;
  const hasExtra = extraCount > 0;
  if (!hasHours && !hasExtra) return null;

  const requiresAssignee = options.requiresAssignee !== false;
  const parts = [label];

  if (hasHours && hasExtra) {
    parts.push(formatHoursShort(hours));
    return { key, label: parts.join(" "), toneClass, incomplete: false };
  }

  if (hasHours) {
    parts.push(formatHoursShort(hours));
    if (requiresAssignee) {
      parts.push("·", "NA");
      return { key, label: parts.join(" "), toneClass, incomplete: true };
    }
    return { key, label: parts.join(" "), toneClass, incomplete: false };
  }

  // People / flags only
  parts.push(`${extraCount}${extraSuffix}`);
  return { key, label: parts.join(" "), toneClass, incomplete: true };
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
 * Parent-Dev style: standalone issue, or FE hours only with no BE/Mob roles.
 * Uses Dev / Testing labels instead of FE / QC.
 */
const useDevTestingLabels = (task: Task, mobileHours: number): boolean => {
  if (isStandaloneIssueType(task.issueType)) return true;
  const hasBe = task.beHours > 0 || (task.beDevs?.length ?? 0) > 0;
  const hasMob =
    mobileHours > 0 ||
    (task.androidDevs?.length ?? 0) > 0 ||
    (task.iosDevs?.length ?? 0) > 0 ||
    task.mobileApp === "star" ||
    task.mobileApp === "hubs" ||
    Boolean(task.needsIos);
  const hasFe = task.feHours > 0 || (task.feDevs?.length ?? 0) > 0;
  return hasFe && !hasBe && !hasMob;
};

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
  const parentStyle = useDevTestingLabels(task, mobileHours);

  const feLabel = parentStyle ? "Dev" : "FE";
  const qcLabel = parentStyle ? "Testing" : "QC";
  const technical = isTechnicalTaskIssueType(task.issueType);

  const chips: TaskDetailsSummaryChip[] = [
    makeChip("be", "BE", "phase-be", task.beHours, task.beDevs?.length ?? 0),
    makeChip(
      "fe",
      feLabel,
      "phase-fe",
      task.feHours,
      task.feDevs?.length ?? 0,
      "p",
      technical ? { requiresAssignee: false } : undefined,
    ),
    makeChip("mo", "Mob", "phase-android", mobileHours, mobilePeople) ??
      (hasMobileApp || task.needsIos
        ? ({ key: "mo", label: "Mob", toneClass: "phase-android", incomplete: true } as const)
        : null),
    makeChip(
      "int",
      "Int",
      "phase-int",
      task.integrationHours ?? 0,
      countIntegrationFlags(task),
      "",
    ),
    makeChip("buf", "Buf", "phase-pm", task.bufferHours ?? 0, 0, "p", {
      requiresAssignee: false,
    }),
    makeChip("qc", qcLabel, "phase-qc", task.qcHours, task.qcs?.length ?? 0),
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
