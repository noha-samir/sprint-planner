import { effectiveIosHours } from "./mobilePlatform";
import { resolveRemainingEffort, type RemainingEffort } from "./remainingEffort";
import {
  isBufferPhaseTaskStatus,
  isExcludedFromSchedule,
  isInactiveTaskStatus,
  isReleasedTaskStatus,
  isTestingTaskStatus,
  isUatTaskStatus,
} from "./taskStatus";
import type { Task } from "./types";

export type TaskRemainingOverrides = Pick<
  Task,
  | "remainingFeHours"
  | "remainingBeHours"
  | "remainingAndroidHours"
  | "remainingIosHours"
  | "remainingQcHours"
  | "remainingIntegrationHours"
  | "remainingBufferHours"
>;

/** Statuses that contribute zero hours to people utilization (UAT handoff + shipped/inactive). */
export const isUtilizationExcludedStatus = (status: string): boolean =>
  isExcludedFromSchedule(status) || isUatTaskStatus(status) || isBufferPhaseTaskStatus(status);

export const isDevCarryWizardStatus = (status: string): boolean => {
  if (isUtilizationExcludedStatus(status) || isTestingTaskStatus(status)) {
    return false;
  }
  return true;
};

export const isQcCarryWizardStatus = (status: string): boolean => isTestingTaskStatus(status);

const finiteOverride = (value: number | null | undefined): number | null =>
  value != null && Number.isFinite(value) ? Math.max(0, value) : null;

const pickHours = (override: number | null, estimate: number, fallback: number): number => {
  if (override != null) {
    return Math.max(0, Math.min(estimate, override));
  }
  return fallback;
};

export const resolveUtilizationEffort = (task: Task): RemainingEffort => {
  if (isUtilizationExcludedStatus(task.status)) {
    return {
      feHours: 0,
      beHours: 0,
      androidHours: 0,
      iosHours: 0,
      integrationHours: 0,
      qcHours: 0,
      bufferHours: 0,
    };
  }

  const base = resolveRemainingEffort(task);
  const androidEstimate = task.androidHours ?? 0;
  const iosEstimate = effectiveIosHours(task);

  return {
    feHours: pickHours(finiteOverride(task.remainingFeHours), task.feHours, base.feHours),
    beHours: pickHours(finiteOverride(task.remainingBeHours), task.beHours, base.beHours),
    androidHours: pickHours(finiteOverride(task.remainingAndroidHours), androidEstimate, base.androidHours),
    iosHours: pickHours(finiteOverride(task.remainingIosHours), iosEstimate, base.iosHours),
    integrationHours: pickHours(
      finiteOverride(task.remainingIntegrationHours),
      task.integrationHours,
      base.integrationHours,
    ),
    qcHours: pickHours(finiteOverride(task.remainingQcHours), task.qcHours, base.qcHours),
    bufferHours: pickHours(finiteOverride(task.remainingBufferHours), task.bufferHours ?? 0, base.bufferHours),
  };
};

export const clearRemainingHourOverrides = (): TaskRemainingOverrides => ({
  remainingFeHours: null,
  remainingBeHours: null,
  remainingAndroidHours: null,
  remainingIosHours: null,
  remainingQcHours: null,
  remainingIntegrationHours: null,
  remainingBufferHours: null,
});

export const remainingOverridesFromEffort = (effort: RemainingEffort): TaskRemainingOverrides => ({
  remainingFeHours: effort.feHours,
  remainingBeHours: effort.beHours,
  remainingAndroidHours: effort.androidHours,
  remainingIosHours: effort.iosHours,
  remainingQcHours: effort.qcHours,
  remainingIntegrationHours: effort.integrationHours,
  remainingBufferHours: effort.bufferHours,
});

export const isHiddenFromResourceInsight = (status: string): boolean => isUtilizationExcludedStatus(status);

export const isReleasedOrInactiveForDisplay = (status: string): boolean =>
  isReleasedTaskStatus(status) || isInactiveTaskStatus(status);
