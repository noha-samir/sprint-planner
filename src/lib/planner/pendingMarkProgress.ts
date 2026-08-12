import type { Task } from "@/lib/scheduler/types";
import type { PlannerMeta } from "./plannerMeta";

/**
 * Task fields that do not affect schedule / remaining effort.
 * Edits to these never light Mark Progress Now (and never clear a pending remark).
 */
export const TASK_PATCH_KEYS_IGNORED_FOR_REMARK: (keyof Task)[] = [
  "storyName",
  "storyLink",
  "taskNotes",
  "tags",
  "jira",
];

const isSameTaskField = (task: Task, key: keyof Task, next: unknown): boolean => {
  const prev = task[key];

  if (key === "releaseGroup") {
    const a = typeof prev === "string" ? prev.trim() || null : (prev ?? null);
    const b = typeof next === "string" ? next.trim() || null : (next ?? null);
    return a === b;
  }

  if (key === "storyName" || key === "storyLink" || key === "taskNotes") {
    return String(prev ?? "").trim() === String(next ?? "").trim();
  }

  if (key === "poPriority") {
    const a = prev == null ? null : Number(prev);
    const b = next == null || next === "" ? null : Number(next);
    return a === b;
  }

  if (
    key === "feHours" ||
    key === "beHours" ||
    key === "androidHours" ||
    key === "iosHours" ||
    key === "qcHours" ||
    key === "integrationHours" ||
    key === "bufferHours"
  ) {
    return Number(prev ?? 0) === Number(next ?? 0);
  }

  if (key === "needsIos") {
    return Boolean(prev) === Boolean(next);
  }

  if (key === "moStartDate") {
    const a = typeof prev === "string" ? prev.trim() || null : (prev ?? null);
    const b = typeof next === "string" ? next.trim() || null : (next ?? null);
    return a === b;
  }

  if (Array.isArray(prev) || Array.isArray(next)) {
    const a = Array.isArray(prev) ? prev : [];
    const b = Array.isArray(next) ? next : [];
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  if ((prev != null && typeof prev === "object") || (next != null && typeof next === "object")) {
    return JSON.stringify(prev ?? null) === JSON.stringify(next ?? null);
  }

  return prev === next;
};

/**
 * Keep only patch keys whose values differ from the current task.
 */
export const filterTaskPatchToActualChanges = (
  task: Task | undefined,
  patch: Partial<Task>,
): Partial<Task> => {
  if (!task) {
    return patch;
  }
  const changed: Partial<Task> = {};
  for (const key of Object.keys(patch) as (keyof Task)[]) {
    if (!isSameTaskField(task, key, patch[key])) {
      (changed as Record<string, unknown>)[key] = patch[key];
    }
  }
  return changed;
};

/**
 * Whether an updateTask patch should flag the story for Mark Progress Now.
 */
export const patchShouldMarkTaskNeedRemark = (patch: Partial<Task>): boolean =>
  Object.keys(patch).some((key) => !TASK_PATCH_KEYS_IGNORED_FOR_REMARK.includes(key as keyof Task));

/**
 * Whether a patch only touches cosmetic fields (name, link, tags, notes, jira meta).
 */
export const patchOnlyIgnoresRemark = (patch: Partial<Task>): boolean => {
  const keys = Object.keys(patch);
  return keys.length > 0 && keys.every((key) => TASK_PATCH_KEYS_IGNORED_FOR_REMARK.includes(key as keyof Task));
};

/** New/imported tasks with hours or assignees affect capacity and need remark. */
export const taskHasScheduleContentForRemark = (task: Task): boolean =>
  Number(task.feHours) > 0 ||
  Number(task.beHours) > 0 ||
  Number(task.androidHours) > 0 ||
  (task.needsIos && Number(task.iosHours) > 0) ||
  Number(task.qcHours) > 0 ||
  Number(task.integrationHours) > 0 ||
  Number(task.bufferHours ?? 0) > 0 ||
  task.feDevs.length > 0 ||
  task.beDevs.length > 0 ||
  task.androidDevs.length > 0 ||
  (task.needsIos && task.iosDevs.length > 0) ||
  task.qcs.length > 0 ||
  Boolean(task.releaseGroup?.trim()) ||
  task.poPriority != null ||
  Boolean(task.moStartDate?.trim());

/**
 * Update need-remark state for a single task edit.
 * Cosmetic-only patches leave an existing pending remark unchanged.
 */
export const applyPlannerMetaForTaskPatch = (
  meta: PlannerMeta,
  taskId: string,
  patch: Partial<Task>,
  previousTask?: Task,
): PlannerMeta => {
  const effectivePatch = filterTaskPatchToActualChanges(previousTask, patch);
  if (Object.keys(effectivePatch).length === 0) {
    return meta;
  }
  if (patchShouldMarkTaskNeedRemark(effectivePatch)) {
    return markTaskIdsNeedRemark(meta, [taskId]);
  }
  return meta;
};

export const markTaskIdsNeedRemark = (meta: PlannerMeta, taskIds: string[]): PlannerMeta => {
  if (!meta.uatTrackingEnabled || taskIds.length === 0) {
    return meta;
  }
  const pending = new Set(meta.taskIdsNeedRemark ?? []);
  taskIds.forEach((id) => pending.add(id));
  return { ...meta, taskIdsNeedRemark: [...pending] };
};

export const removeTaskIdFromNeedRemark = (meta: PlannerMeta, taskId: string): PlannerMeta => {
  const pending = (meta.taskIdsNeedRemark ?? []).filter((id) => id !== taskId);
  return pending.length === (meta.taskIdsNeedRemark ?? []).length ? meta : { ...meta, taskIdsNeedRemark: pending };
};

export const clearTasksNeedRemark = (meta: PlannerMeta): PlannerMeta => ({
  ...meta,
  taskIdsNeedRemark: [],
});

/** Stories with schedule/hours edits since the last Mark Progress Now. */
export const getTasksNeedingRemark = (meta: PlannerMeta, activeTaskIds: Iterable<string>): Set<string> => {
  if (!meta.uatTrackingEnabled || !meta.curScheduleTakenAt) {
    return new Set();
  }
  const active = new Set(activeTaskIds);
  const pending = new Set<string>();
  for (const id of meta.taskIdsNeedRemark ?? []) {
    if (active.has(id)) {
      pending.add(id);
    }
  }
  return pending;
};
