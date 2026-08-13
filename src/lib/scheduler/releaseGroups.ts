import { getProductionReleaseDateFrom, resolveUatReleaseDate } from "./calendar";
import { isReleasePendingOnPmStatus } from "./taskStatus";
import type { Config, ScheduledTask, Task, ThursdayReleaseScope } from "./types";

const resolveThursdayReleaseScope = (
  uatReleaseDate: Date | null,
  productionReleaseDate: Date | null,
): ThursdayReleaseScope => {
  const uatThu = uatReleaseDate != null && uatReleaseDate.getDay() === 4;
  const prodThu = productionReleaseDate != null && productionReleaseDate.getDay() === 4;
  if (uatThu && prodThu) return "both";
  if (uatThu) return "uat";
  if (prodThu) return "production";
  return "none";
};

export const normalizeReleaseGroup = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** Clear computed release dates when go-live is pending on the PM. */
export const clearReleaseDatesPendingOnPm = (task: ScheduledTask): ScheduledTask => ({
  ...task,
  uatReleaseDate: null,
  productionReleaseDate: null,
  releaseDate: null,
  isThursdayRelease: false,
  thursdayReleaseScope: "none",
  isOverflow: false,
});

/**
 * Earliest moment this scheduled story is ready for UAT: buffer end, else QC end,
 * else its existing UAT date. Never invents an earlier optimistic estimate.
 * UAT+ statuses defer dates to the PM — no scheduler readiness gate.
 */
export const scheduledReadyForUat = (member: ScheduledTask, config: Config): Date | null => {
  if (isReleasePendingOnPmStatus(member.status)) {
    return null;
  }
  if (member.bufferEnd) {
    return resolveUatReleaseDate(member.bufferEnd, config);
  }
  if (member.qcEnd) {
    return resolveUatReleaseDate(member.qcEnd, config);
  }
  return member.uatReleaseDate ?? member.releaseDate ?? null;
};

/**
 * Ensure UAT / production / release dates are never before the story's own
 * scheduled QC or buffer finish (fixes frozen snapshots and bad alignments).
 */
export const clampReleaseDatesToWorkEnd = (task: ScheduledTask, config: Config): ScheduledTask => {
  if (isReleasePendingOnPmStatus(task.status)) {
    return clearReleaseDatesPendingOnPm(task);
  }
  const ready = scheduledReadyForUat(task, config);
  if (!ready) {
    return task;
  }
  const currentUat = task.uatReleaseDate ?? task.releaseDate;
  if (currentUat && currentUat.getTime() >= ready.getTime()) {
    return task;
  }
  const uatReleaseDate = ready;
  const productionReleaseDate = getProductionReleaseDateFrom(uatReleaseDate, config);
  const thursdayReleaseScope = resolveThursdayReleaseScope(uatReleaseDate, productionReleaseDate);
  return {
    ...task,
    uatReleaseDate,
    productionReleaseDate,
    releaseDate: uatReleaseDate,
    isThursdayRelease: thursdayReleaseScope !== "none",
    thursdayReleaseScope,
  };
};

/**
 * Stories in the same release group enter UAT together: shared UAT/production dates
 * are the latest *scheduled* readiness among members (QC/buffer end after real
 * resource contention), never an optimistic hours-only estimate that can land
 * before Alice finishes on the timeline.
 */
export const alignReleaseGroups = (
  _sourceTasks: Task[],
  scheduledTasks: ScheduledTask[],
  config: Config,
  sprintEndDate: Date,
): ScheduledTask[] => {
  const groupByTaskId = new Map<string, string>();
  scheduledTasks.forEach((task) => {
    const group = normalizeReleaseGroup(task.releaseGroup);
    if (group) {
      groupByTaskId.set(task.id, group);
    }
  });
  if (groupByTaskId.size === 0) {
    return scheduledTasks.map((task) => clampReleaseDatesToWorkEnd(task, config));
  }

  const membersByGroup = new Map<string, ScheduledTask[]>();
  scheduledTasks.forEach((scheduled) => {
    const group = groupByTaskId.get(scheduled.id);
    if (!group) return;
    const members = membersByGroup.get(group) ?? [];
    members.push(scheduled);
    membersByGroup.set(group, members);
  });

  const alignedById = new Map(scheduledTasks.map((task) => [task.id, task]));

  membersByGroup.forEach((members) => {
    let maxUat: Date | null = null;
    for (const member of members) {
      const gate = scheduledReadyForUat(member, config);
      if (gate && (!maxUat || gate.getTime() > maxUat.getTime())) {
        maxUat = gate;
      }
    }
    if (maxUat === null) {
      return;
    }

    const sharedUat = maxUat;
    const productionReleaseDate = getProductionReleaseDateFrom(sharedUat, config);
    const thursdayReleaseScope = resolveThursdayReleaseScope(sharedUat, productionReleaseDate);
    const isOverflow = sharedUat.getTime() > sprintEndDate.getTime();

    for (const member of members) {
      if (isReleasePendingOnPmStatus(member.status)) {
        alignedById.set(member.id, clearReleaseDatesPendingOnPm(member));
        continue;
      }
      alignedById.set(member.id, {
        ...member,
        uatReleaseDate: sharedUat,
        productionReleaseDate,
        releaseDate: sharedUat,
        isThursdayRelease: thursdayReleaseScope !== "none",
        thursdayReleaseScope,
        isOverflow,
      });
    }
  });

  return scheduledTasks.map((task) => clampReleaseDatesToWorkEnd(alignedById.get(task.id) ?? task, config));
};
