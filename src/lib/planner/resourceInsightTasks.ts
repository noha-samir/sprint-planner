import { matchResourceByAssigneeLabel } from "@/lib/planner/resourceIdentity";
import { storyLinkIdentityKey } from "@/lib/planner/storyLinkIdentity";
import {
  isHiddenFromResourceInsight,
  resolveUtilizationEffort,
} from "@/lib/scheduler/utilizationEffort";
import type { Resource, Task } from "@/lib/scheduler/types";

export type ResourceInsightOrigin = "new" | "carry";

/** True when this roster person is on the story assignee list for their role (hours may still be 0). */
export const isResourceAssignedOnTask = (task: Task, resource: Resource): boolean => {
  const labelsForRole = (assignees: string[] | undefined): string[] => assignees ?? [];

  const matches = (assignees: string[] | undefined): boolean =>
    labelsForRole(assignees).some((label) => matchResourceByAssigneeLabel(label, [resource]) != null);

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

export const hoursForResourceOnTask = (task: Task, resource: Resource): number => {
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
};

/**
 * Stories assigned to this resource on the current sprint board.
 * Excludes UAT/Production/inactive; dedupes by Jira key.
 */
export const buildResourceInsightTaskRows = (
  tasks: Task[],
  resource: Resource,
): ResourceInsightTaskRow[] => {
  const bestByKey = new Map<string, ResourceInsightTaskRow>();

  for (const task of tasks) {
    if (
      task.carryToNextSprint ||
      isHiddenFromResourceInsight(task.status) ||
      !isResourceAssignedOnTask(task, resource)
    ) {
      continue;
    }
    const row: ResourceInsightTaskRow = {
      taskId: task.id,
      storyLabel: task.storyName || task.storyLink || task.id,
      storyLink: task.storyLink,
      status: task.status,
      totalHours: hoursForResourceOnTask(task, resource),
      origin: task.carriedFromPreviousSprint ? "carry" : "new",
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
