import { clampReleaseDatesToWorkEnd, clearReleaseDatesPendingOnPm } from "@/lib/scheduler/releaseGroups";
import { isReleasePendingOnPmStatus } from "@/lib/scheduler/taskStatus";
import type { Config, ScheduleResult, ScheduledBlock, ScheduledTask } from "@/lib/scheduler/types";

export type CurScheduleSnapshot = {
  sprintEndDate: string;
  tasks: SerializedScheduledTask[];
};

type SerializedScheduledBlock = {
  resourceName: string;
  start: string;
  end: string;
  hours: number;
};

type SerializedScheduledTask = {
  id: string;
  storyName: string;
  storyLink: string;
  poPriority: number | null;
  status: ScheduledTask["status"];
  feBlocks: SerializedScheduledBlock[];
  beBlocks: SerializedScheduledBlock[];
  androidBlocks: SerializedScheduledBlock[];
  iosBlocks: SerializedScheduledBlock[];
  /** @deprecated legacy snapshots */
  moBlocks?: SerializedScheduledBlock[];
  feStart: string | null;
  feEnd: string | null;
  beStart: string | null;
  beEnd: string | null;
  androidStart: string | null;
  androidEnd: string | null;
  iosStart: string | null;
  iosEnd: string | null;
  /** @deprecated legacy snapshots */
  moStart?: string | null;
  moEnd?: string | null;
  devEnd: string | null;
  integrationStart: string | null;
  integrationEnd: string | null;
  qcBlocks: SerializedScheduledBlock[];
  qcStart: string | null;
  qcEnd: string | null;
  bufferStart: string | null;
  bufferEnd: string | null;
  uatReleaseDate: string | null;
  productionReleaseDate: string | null;
  releaseDate: string | null;
  isThursdayRelease: boolean;
  thursdayReleaseScope: ScheduledTask["thursdayReleaseScope"];
  isOverflow: boolean;
  releaseGroup: string | null;
};

const serializeBlock = (block: ScheduledBlock): SerializedScheduledBlock => ({
  resourceName: block.resourceName,
  start: block.start.toISOString(),
  end: block.end.toISOString(),
  hours: block.hours,
});

const deserializeBlock = (block: SerializedScheduledBlock): ScheduledBlock => ({
  resourceName: block.resourceName,
  start: new Date(block.start),
  end: new Date(block.end),
  hours: block.hours,
});

const serializeDate = (value: Date | null): string | null => (value ? value.toISOString() : null);

const deserializeDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const serializeScheduledTask = (task: ScheduledTask): SerializedScheduledTask => ({
  id: task.id,
  storyName: task.storyName,
  storyLink: task.storyLink,
  poPriority: task.poPriority,
  status: task.status,
  feBlocks: task.feBlocks.map(serializeBlock),
  beBlocks: task.beBlocks.map(serializeBlock),
  androidBlocks: (task.androidBlocks ?? []).map(serializeBlock),
  iosBlocks: (task.iosBlocks ?? []).map(serializeBlock),
  feStart: serializeDate(task.feStart),
  feEnd: serializeDate(task.feEnd),
  beStart: serializeDate(task.beStart),
  beEnd: serializeDate(task.beEnd),
  androidStart: serializeDate(task.androidStart ?? null),
  androidEnd: serializeDate(task.androidEnd ?? null),
  iosStart: serializeDate(task.iosStart ?? null),
  iosEnd: serializeDate(task.iosEnd ?? null),
  devEnd: serializeDate(task.devEnd),
  integrationStart: serializeDate(task.integrationStart),
  integrationEnd: serializeDate(task.integrationEnd),
  qcBlocks: task.qcBlocks.map(serializeBlock),
  qcStart: serializeDate(task.qcStart),
  qcEnd: serializeDate(task.qcEnd),
  bufferStart: serializeDate(task.bufferStart),
  bufferEnd: serializeDate(task.bufferEnd),
  uatReleaseDate: serializeDate(task.uatReleaseDate),
  productionReleaseDate: serializeDate(task.productionReleaseDate),
  releaseDate: serializeDate(task.releaseDate),
  isThursdayRelease: task.isThursdayRelease,
  thursdayReleaseScope: task.thursdayReleaseScope,
  isOverflow: task.isOverflow,
  releaseGroup: task.releaseGroup,
});

const deserializeScheduledTask = (task: SerializedScheduledTask): ScheduledTask => {
  const androidBlocks = (task.androidBlocks ?? task.moBlocks ?? []).map(deserializeBlock);
  const iosBlocks = (task.iosBlocks ?? []).map(deserializeBlock);
  return {
    id: task.id,
    storyName: task.storyName,
    storyLink: task.storyLink,
    poPriority: task.poPriority,
    status: task.status,
    feBlocks: task.feBlocks.map(deserializeBlock),
    beBlocks: task.beBlocks.map(deserializeBlock),
    androidBlocks,
    iosBlocks,
    feStart: deserializeDate(task.feStart),
    feEnd: deserializeDate(task.feEnd),
    beStart: deserializeDate(task.beStart),
    beEnd: deserializeDate(task.beEnd),
    androidStart: deserializeDate(task.androidStart ?? task.moStart),
    androidEnd: deserializeDate(task.androidEnd ?? task.moEnd),
    iosStart: deserializeDate(task.iosStart),
    iosEnd: deserializeDate(task.iosEnd),
    devEnd: deserializeDate(task.devEnd),
    integrationStart: deserializeDate(task.integrationStart),
    integrationEnd: deserializeDate(task.integrationEnd),
    qcBlocks: task.qcBlocks.map(deserializeBlock),
    qcStart: deserializeDate(task.qcStart),
    qcEnd: deserializeDate(task.qcEnd),
    bufferStart: deserializeDate(task.bufferStart),
    bufferEnd: deserializeDate(task.bufferEnd),
    uatReleaseDate: deserializeDate(task.uatReleaseDate),
    productionReleaseDate: deserializeDate(task.productionReleaseDate),
    releaseDate: deserializeDate(task.releaseDate),
    isThursdayRelease: task.isThursdayRelease,
    thursdayReleaseScope: task.thursdayReleaseScope,
    isOverflow: task.isOverflow,
    releaseGroup: task.releaseGroup,
  };
};

export const serializeScheduleResult = (result: ScheduleResult): CurScheduleSnapshot => ({
  sprintEndDate: result.sprintEndDate.toISOString(),
  tasks: result.tasks.map(serializeScheduledTask),
});

export const deserializeScheduleResult = (snapshot: CurScheduleSnapshot): ScheduleResult => ({
  sprintEndDate: new Date(snapshot.sprintEndDate),
  tasks: snapshot.tasks.map(deserializeScheduledTask),
});

export const mergeFrozenScheduleWithFresh = (
  frozen: ScheduleResult,
  fresh: ScheduleResult,
  activeTaskIds: Set<string>,
  config?: Config,
): ScheduleResult => {
  const frozenById = new Map(frozen.tasks.map((task) => [task.id, task]));
  const freshById = new Map(fresh.tasks.map((task) => [task.id, task]));
  const merged: ScheduledTask[] = [];

  const finalize = (task: ScheduledTask): ScheduledTask => {
    if (isReleasePendingOnPmStatus(task.status)) {
      return clearReleaseDatesPendingOnPm(task);
    }
    return config ? clampReleaseDatesToWorkEnd(task, config) : task;
  };

  activeTaskIds.forEach((taskId) => {
    const frozenTask = frozenById.get(taskId);
    const freshTask = freshById.get(taskId);
    if (frozenTask && freshTask) {
      const next: ScheduledTask = {
        ...frozenTask,
        storyName: freshTask.storyName,
        storyLink: freshTask.storyLink,
        poPriority: freshTask.poPriority,
        status: freshTask.status,
        releaseGroup: freshTask.releaseGroup ?? frozenTask.releaseGroup,
      };
      merged.push(finalize(next));
      return;
    }
    if (freshTask) {
      merged.push(finalize(freshTask));
      return;
    }
    if (frozenTask) {
      merged.push(finalize(frozenTask));
    }
  });

  return {
    tasks: merged,
    sprintEndDate: fresh.sprintEndDate,
  };
};
