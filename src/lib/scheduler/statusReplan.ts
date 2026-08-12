import {
  isBufferPhaseTaskStatus,
  isReleasedTaskStatus,
  isTestingTaskStatus,
  isUatTaskStatus,
} from "./taskStatus";
import type { Task, TaskReplanStep } from "./types";

const REPLAN_STEP_RANK: Record<TaskReplanStep, number> = {
  Start: 0,
  FE: 1,
  Integration: 2,
  QC: 3,
  Buffer: 4,
};

const normalizeManualReplanStep = (step: Task["replanFromStep"]): TaskReplanStep | null =>
  step === "Start" ||
  step === "FE" ||
  step === "Integration" ||
  step === "QC" ||
  step === "Buffer"
    ? step
    : null;

/**
 * Status implies where remaining work starts:
 * Ready for Testing / Testing / Pending Bug Fixes → QC
 * UAT / Ready for Production / STAGING → Buffer
 */
export const statusImpliedReplanStep = (status: string): TaskReplanStep | null => {
  if (isReleasedTaskStatus(status)) {
    return null;
  }
  if (isTestingTaskStatus(status)) {
    return "QC";
  }
  if (isUatTaskStatus(status) || isBufferPhaseTaskStatus(status)) {
    return "Buffer";
  }
  return null;
};

/**
 * Prefer the later of manual replanFromStep and status-implied step so status
 * always advances remaining work at least as far as the workflow says.
 */
export const effectiveReplanFromStep = (task: Pick<Task, "status" | "replanFromStep">): TaskReplanStep => {
  const fromStatus = statusImpliedReplanStep(task.status);
  const fromManual = normalizeManualReplanStep(task.replanFromStep) ?? "Start";
  if (!fromStatus) {
    return fromManual;
  }
  return REPLAN_STEP_RANK[fromStatus] >= REPLAN_STEP_RANK[fromManual] ? fromStatus : fromManual;
};
