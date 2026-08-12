import type { Task, TaskReplanStep } from "../lib/scheduler/types";

export const normalizeReplanStep = (step: Task["replanFromStep"]): TaskReplanStep | null =>
  step === "Start" ||
  step === "FE" ||
  step === "Integration" ||
  step === "QC" ||
  step === "Buffer"
    ? step
    : null;

export const mergeIncomingTasksWithCurrent = (incomingTasks: Task[], currentTasks: Task[]): Task[] => {
  const currentById = new Map(currentTasks.map((task) => [task.id, task]));
  return incomingTasks.map((incomingTask) => {
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
};
