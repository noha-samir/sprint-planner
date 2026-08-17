import type { Task, TaskReplanStep } from "../lib/scheduler/types";

export const normalizeReplanStep = (step: Task["replanFromStep"]): TaskReplanStep | null =>
  step === "Start" ||
  step === "FE" ||
  step === "Integration" ||
  step === "QC" ||
  step === "Buffer"
    ? step
    : null;

const parsePlannerIsoMs = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Skip applying a GET snapshot when it is older than a save we already have,
 * or when the user has unsynced edits newer than that snapshot.
 * Unsynced local + missing snapshot time also skip so a late fetch cannot wipe new rows.
 */
export const shouldSkipIncomingPlannerSnapshot = (params: {
  incomingUpdatedAt: string | null;
  localMutationAt: string | null;
  knownServerUpdatedAt: string | null;
}): boolean => {
  const incomingMs = parsePlannerIsoMs(params.incomingUpdatedAt);
  const localMs = parsePlannerIsoMs(params.localMutationAt);
  const knownMs = parsePlannerIsoMs(params.knownServerUpdatedAt);
  if (knownMs != null && incomingMs != null && knownMs > incomingMs) {
    return true;
  }
  if (localMs != null && incomingMs != null && localMs > incomingMs) {
    return true;
  }
  if (localMs != null && incomingMs == null) {
    return true;
  }
  return false;
};

export const mergeIncomingTasksWithCurrent = (
  incomingTasks: Task[],
  currentTasks: Task[],
  options?: { keepLocalOnly?: boolean },
): Task[] => {
  const currentById = new Map(currentTasks.map((task) => [task.id, task]));
  const merged = incomingTasks.map((incomingTask) => {
    if (normalizeReplanStep(incomingTask.replanFromStep) != null) {
      return incomingTask;
    }
    const currentTask = currentById.get(incomingTask.id);
    if (!currentTask) {
      return incomingTask;
    }
    const fallback = normalizeReplanStep(currentTask.replanFromStep);
    return fallback ? { ...incomingTask, replanFromStep: fallback } : incomingTask;
  });

  if (!options?.keepLocalOnly) {
    return merged;
  }

  const incomingIds = new Set(incomingTasks.map((task) => task.id));
  const localOnly = currentTasks.filter((task) => !incomingIds.has(task.id));
  return localOnly.length === 0 ? merged : [...merged, ...localOnly];
};
