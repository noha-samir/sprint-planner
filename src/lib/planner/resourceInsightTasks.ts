import { matchResourceByAssigneeLabel, technicalTaskDevOwners } from "@/lib/planner/resourceIdentity";
import { storyLinkIdentityKey } from "@/lib/planner/storyLinkIdentity";
import { isBufferPhaseTaskStatus, isUatTaskStatus } from "@/lib/scheduler/taskStatus";
import {
  isHiddenFromResourceInsight,
  resolveUtilizationEffort,
} from "@/lib/scheduler/utilizationEffort";
import type { Resource, Task } from "@/lib/scheduler/types";

export type ResourceInsightOrigin = "new" | "carry";

/** True when this roster person is one of the Technical Task's Jira developers. */
const isTechnicalTaskOwner = (task: Task, resource: Resource): boolean =>
  technicalTaskDevOwners(task, [resource]).length > 0;

/**
 * True when this roster person is on the story assignee list for their role, or is a Jira developer of a
 * Technical Task (hours may still be 0).
 */
export const isResourceAssignedOnTask = (task: Task, resource: Resource): boolean => {
  const labelsForRole = (assignees: string[] | undefined): string[] => assignees ?? [];

  const matches = (assignees: string[] | undefined): boolean =>
    labelsForRole(assignees).some((label) => matchResourceByAssigneeLabel(label, [resource]) != null);

  if (isTechnicalTaskOwner(task, resource)) {
    return true;
  }
  if (resource.type === "BE") {
    return matches(task.beDevs);
  }
  if (resource.type === "FE") {
    return matches(task.feDevs);
  }
  if (resource.type === "MO") {
    if (matches(task.androidDevs)) {
      return true;
    }
    return Boolean(task.needsIos) && matches(task.iosDevs);
  }
  if (resource.type === "QC") {
    return matches(task.qcs);
  }
  if (resource.type === "PM") {
    return false;
  }
  return false;
};

/**
 * This person's remaining hours on a story: their even share of each role they are on, plus their even share of
 * a Technical Task's Dev hours when they are one of its Jira developers (same split as Taken).
 * @param task - Planner task.
 * @param resource - The person.
 * @param resources - Full roster, to know how many developers share a Technical Task.
 */
export const hoursForResourceOnTask = (task: Task, resource: Resource, resources: Resource[]): number => {
  const remaining = resolveUtilizationEffort(task);
  const share = (assignees: string[], totalHours: number): number => {
    if (assignees.length === 0) {
      return 0;
    }
    if (!assignees.some((label) => matchResourceByAssigneeLabel(label, [resource]) != null)) {
      return 0;
    }
    return totalHours / assignees.length;
  };

  const roleHours = (): number => {
    if (resource.type === "BE") {
      return share(task.beDevs?.length ? task.beDevs : [], remaining.beHours);
    }
    if (resource.type === "FE") {
      return share(task.feDevs?.length ? task.feDevs : [], remaining.feHours);
    }
    if (resource.type === "MO") {
      let total = 0;
      const androidAssignees = task.androidDevs?.length ? task.androidDevs : [];
      total += share(androidAssignees, remaining.androidHours);
      if (task.needsIos) {
        const iosAssignees = task.iosDevs?.length ? task.iosDevs : [];
        total += share(iosAssignees, remaining.iosHours);
      }
      return total;
    }
    if (resource.type === "QC") {
      return share(task.qcs?.length ? task.qcs : [], remaining.qcHours);
    }
    return 0;
  };

  const technicalOwners = technicalTaskDevOwners(task, resources);
  const technicalDevHours = technicalOwners.some((owner) => owner.name === resource.name)
    ? (remaining.feHours + remaining.beHours) / technicalOwners.length
    : 0;
  return technicalDevHours + roleHours();
};

/** Prefer Jira issue key so the same story is not listed twice under different planner rows. */
export const resourceInsightDedupeKey = (task: Pick<Task, "id" | "storyLink">): string =>
  storyLinkIdentityKey(task.storyLink) ?? `id:${task.id}`;

export type ResourceInsightTaskRow = {
  taskId: string;
  storyLabel: string;
  storyLink: string;
  status: string;
  totalHours: number;
  origin: ResourceInsightOrigin;
  /** UAT / STAGING / Ready for Production: development is done, so the story carries no hours. */
  pastDev: boolean;
};

/** UAT, STAGING and Ready for Production — listed in the profile, never counted in Taken. */
const isPastDevStatus = (status: string): boolean => isUatTaskStatus(status) || isBufferPhaseTaskStatus(status);

/**
 * Stories assigned to this resource on the current sprint board, including Technical Tasks where this person is
 * a Jira developer. UAT / STAGING / Ready for Production stories come back with `pastDev` and 0 hours;
 * Production and inactive stories are left out. Dedupes by Jira key.
 * @param tasks - Board tasks.
 * @param resource - The person.
 * @param resources - Full roster (Technical Task hour split).
 */
export const buildResourceInsightTaskRows = (
  tasks: Task[],
  resource: Resource,
  resources: Resource[],
): ResourceInsightTaskRow[] => {
  const bestByKey = new Map<string, ResourceInsightTaskRow>();

  for (const task of tasks) {
    const pastDev = isPastDevStatus(task.status);
    if (
      task.carryToNextSprint ||
      (isHiddenFromResourceInsight(task.status) && !pastDev) ||
      !isResourceAssignedOnTask(task, resource)
    ) {
      continue;
    }
    const row: ResourceInsightTaskRow = {
      taskId: task.id,
      storyLabel: task.storyName || task.storyLink || task.id,
      storyLink: task.storyLink,
      status: task.status,
      totalHours: pastDev ? 0 : hoursForResourceOnTask(task, resource, resources),
      origin: task.carriedFromPreviousSprint ? "carry" : "new",
      pastDev,
    };
    const key = resourceInsightDedupeKey(task);
    const existing = bestByKey.get(key);
    if (!existing || row.totalHours > existing.totalHours) {
      bestByKey.set(key, row);
    }
  }

  return [...bestByKey.values()];
};

export const sumResourceInsightHoursByOrigin = (
  rows: ResourceInsightTaskRow[],
): { newHours: number; carryHours: number; totalHours: number } => {
  let newHours = 0;
  let carryHours = 0;
  for (const row of rows) {
    if (row.origin === "carry") {
      carryHours += row.totalHours;
    } else {
      newHours += row.totalHours;
    }
  }
  return { newHours, carryHours, totalHours: newHours + carryHours };
};
