import type { Task } from "../lib/scheduler/types";
import { DEFAULT_TASK_STATUS } from "../lib/scheduler/taskStatus";
import { clearRemainingHourOverrides, type TaskRemainingOverrides } from "../lib/scheduler/utilizationEffort";

const normalizePriority = (value: number | null | undefined) =>
  value === null || value === undefined ? null : Math.max(1, Math.trunc(value) || 1);

export const activeSprintTasks = (tasks: Task[]) => tasks.filter((task) => !task.carryToNextSprint);

export type CarryOverRemainingByTaskId = Record<string, TaskRemainingOverrides>;

export const enforceUniquePoPriorities = (tasks: Task[], changedTaskId: string, requestedPriority: number | null) => {
  const targetPriority = normalizePriority(requestedPriority);
  const indexById = new Map(tasks.map((task, index) => [task.id, index]));
  const changedTask = tasks.find((task) => task.id === changedTaskId);
  if (!changedTask) {
    return tasks;
  }

  const prioritizedWithoutChanged = tasks
    .filter((task) => task.id !== changedTaskId && task.poPriority !== null)
    .sort((a, b) => {
      const delta = (a.poPriority ?? Number.MAX_SAFE_INTEGER) - (b.poPriority ?? Number.MAX_SAFE_INTEGER);
      if (delta !== 0) return delta;
      return (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0);
    });

  const orderedPrioritized =
    targetPriority === null
      ? prioritizedWithoutChanged
      : (() => {
          const insertionIndex = Math.min(Math.max(targetPriority, 1), prioritizedWithoutChanged.length + 1) - 1;
          const inserted = [...prioritizedWithoutChanged];
          inserted.splice(insertionIndex, 0, { ...changedTask, poPriority: targetPriority });
          return inserted;
        })();

  const nextPriorityByTask = new Map<string, number>();
  orderedPrioritized.forEach((task, index) => {
    nextPriorityByTask.set(task.id, index + 1);
  });

  return tasks.map((task) => {
    if (task.poPriority === null && task.id !== changedTaskId) {
      return task;
    }
    const adjusted = nextPriorityByTask.get(task.id);
    if (adjusted !== undefined) {
      return { ...task, poPriority: adjusted };
    }
    if (task.id === changedTaskId) {
      return { ...task, poPriority: null };
    }
    return task;
  });
};

/**
 * Start New Sprint keeps the full live board (story count unchanged).
 * History gets a snapshot first; Next Sprint flags clear; parked Next rows reset to To Do.
 */
export const buildCarryOverTasks = (tasks: Task[], carryRemainingByTaskId?: CarryOverRemainingByTaskId) =>
  tasks.map((task) => {
    const wasParkedForNextSprint = Boolean(task.carryToNextSprint);
    const carried = !wasParkedForNextSprint;
    const overrides = carryRemainingByTaskId?.[task.id];
    return {
      ...task,
      storyName: task.storyName ?? "",
      carryToNextSprint: false,
      status: wasParkedForNextSprint ? DEFAULT_TASK_STATUS : task.status,
      carriedFromPreviousSprint: carried,
      ...(wasParkedForNextSprint ? clearRemainingHourOverrides() : {}),
      ...(carried && overrides ? overrides : {}),
    };
  });

export const compactPrioritiesAfterRelease = (tasks: Task[], releasedTaskId: string): Task[] => {
  const indexById = new Map(tasks.map((task, index) => [task.id, index]));
  const prioritized = tasks
    .filter((task) => task.id !== releasedTaskId && task.poPriority !== null)
    .sort((a, b) => {
      const delta = (a.poPriority ?? Number.MAX_SAFE_INTEGER) - (b.poPriority ?? Number.MAX_SAFE_INTEGER);
      if (delta !== 0) return delta;
      return (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0);
    });
  const nextById = new Map(prioritized.map((task, index) => [task.id, index + 1]));
  return tasks.map((task) => {
    if (task.id === releasedTaskId) {
      return { ...task, poPriority: null };
    }
    const next = nextById.get(task.id);
    if (next !== undefined) {
      return { ...task, poPriority: next };
    }
    return task.poPriority !== null ? { ...task, poPriority: null } : task;
  });
};
