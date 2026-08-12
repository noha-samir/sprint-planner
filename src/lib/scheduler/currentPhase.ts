import { effectiveReplanFromStep } from "./statusReplan";
import type { ScheduledTask, TaskReplanStep, TaskWorkflowStatus } from "./types";
import {
  isBufferPhaseTaskStatus,
  isReleasedTaskStatus,
  isTestingTaskStatus,
  isUatTaskStatus,
} from "./taskStatus";

export type StoryPhase =
  | "BE"
  | "FE"
  | "Android"
  | "IOS"
  | "Integration"
  | "QC"
  | "Buffer"
  | "UAT"
  | "Released"
  | "None";

const inRange = (start: Date | null, end: Date | null, now: Date) => {
  if (!start || !end) {
    return false;
  }
  return now >= start && now < end;
};

/**
 * Phase used to ring-highlight a timeline step from workflow status.
 * UAT / Ready for Production map to Buffer so the border sits on that step.
 */
export const getStatusHighlightPhase = (status: TaskWorkflowStatus | string): StoryPhase => {
  if (isTestingTaskStatus(status)) {
    return "QC";
  }
  if (isUatTaskStatus(status) || isBufferPhaseTaskStatus(status)) {
    return "Buffer";
  }
  if (isReleasedTaskStatus(status)) {
    return "Released";
  }
  return "None";
};

const replanStepToStoryPhase = (step: TaskReplanStep): StoryPhase => {
  switch (step) {
    case "FE":
      return "FE";
    case "Integration":
      return "Integration";
    case "QC":
      return "QC";
    case "Buffer":
      return "Buffer";
    case "Start":
    default:
      return "None";
  }
};

const firstScheduledPhase = (
  task: Pick<
    ScheduledTask,
    | "beStart"
    | "feStart"
    | "androidStart"
    | "iosStart"
    | "integrationStart"
    | "qcStart"
    | "bufferStart"
  >,
): StoryPhase => {
  if (task.beStart) {
    return "BE";
  }
  if (task.feStart) {
    return "FE";
  }
  if (task.androidStart) {
    return "Android";
  }
  if (task.iosStart) {
    return "IOS";
  }
  if (task.integrationStart) {
    return "Integration";
  }
  if (task.qcStart) {
    return "QC";
  }
  if (task.bufferStart) {
    return "Buffer";
  }
  return "None";
};

export const getCurrentStoryPhase = (
  task: Pick<
    ScheduledTask,
    | "status"
    | "beStart"
    | "beEnd"
    | "feStart"
    | "feEnd"
    | "androidStart"
    | "androidEnd"
    | "iosStart"
    | "iosEnd"
    | "integrationStart"
    | "integrationEnd"
    | "qcStart"
    | "qcEnd"
    | "bufferStart"
    | "bufferEnd"
  > & {
    replanFromStep?: TaskReplanStep | null;
  },
  now: Date = new Date(),
): StoryPhase => {
  const fromStatus = getStatusHighlightPhase(task.status);
  if (fromStatus !== "None") {
    return fromStatus;
  }
  if (inRange(task.integrationStart, task.integrationEnd, now)) {
    return "Integration";
  }
  if (inRange(task.qcStart, task.qcEnd, now)) {
    return "QC";
  }
  if (inRange(task.bufferStart, task.bufferEnd, now)) {
    return "Buffer";
  }
  if (inRange(task.beStart, task.beEnd, now)) {
    return "BE";
  }
  if (inRange(task.feStart, task.feEnd, now)) {
    return "FE";
  }
  if (inRange(task.androidStart ?? null, task.androidEnd ?? null, now)) {
    return "Android";
  }
  if (inRange(task.iosStart ?? null, task.iosEnd ?? null, now)) {
    return "IOS";
  }

  // Outside every window (e.g. replan starts at FE before FE begins) — border the
  // remaining-work start so the flow does not look unselected.
  const fromReplan = replanStepToStoryPhase(
    effectiveReplanFromStep({
      status: task.status,
      replanFromStep: task.replanFromStep,
    }),
  );
  if (fromReplan !== "None") {
    return fromReplan;
  }

  return firstScheduledPhase(task);
};

export const getStatusPhase = (status: TaskWorkflowStatus): StoryPhase => getStatusHighlightPhase(status);
