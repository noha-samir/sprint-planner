import { effectiveIosHours } from "./mobilePlatform";
import { effectiveReplanFromStep } from "./statusReplan";
import { isReleasedTaskStatus } from "./taskStatus";
import type { Task } from "./types";

export type RemainingEffort = {
  feHours: number;
  beHours: number;
  androidHours: number;
  iosHours: number;
  integrationHours: number;
  qcHours: number;
  bufferHours: number;
};

const bufferHours = (task: Task) => task.bufferHours ?? 0;

const emptyEffort = (): RemainingEffort => ({
  feHours: 0,
  beHours: 0,
  androidHours: 0,
  iosHours: 0,
  integrationHours: 0,
  qcHours: 0,
  bufferHours: 0,
});

export const resolveRemainingEffort = (task: Task): RemainingEffort => {
  if (isReleasedTaskStatus(task.status)) {
    return emptyEffort();
  }

  const totalBufferHours = bufferHours(task);
  const androidHours = task.androidHours ?? 0;
  const iosHours = effectiveIosHours(task);

  switch (effectiveReplanFromStep(task)) {
    case "FE":
      // FE and Mobile continue in parallel; BE is done.
      return {
        feHours: task.feHours,
        beHours: 0,
        androidHours,
        iosHours,
        integrationHours: task.integrationHours,
        qcHours: task.qcHours,
        bufferHours: totalBufferHours,
      };
    case "Integration":
      return {
        ...emptyEffort(),
        integrationHours: task.integrationHours,
        qcHours: task.qcHours,
        bufferHours: totalBufferHours,
      };
    case "QC":
      return {
        ...emptyEffort(),
        qcHours: task.qcHours,
        bufferHours: totalBufferHours,
      };
    case "Buffer":
      return { ...emptyEffort(), bufferHours: totalBufferHours };
    case "Start":
    default:
      return {
        feHours: task.feHours,
        beHours: task.beHours,
        androidHours,
        iosHours,
        integrationHours: task.integrationHours,
        qcHours: task.qcHours,
        bufferHours: totalBufferHours,
      };
  }
};
