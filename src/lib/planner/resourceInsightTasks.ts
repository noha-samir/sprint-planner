import { matchResourceByAssigneeLabel } from "@/lib/planner/resourceIdentity";
import { storyLinkIdentityKey } from "@/lib/planner/storyLinkIdentity";
import type { Resource, Task } from "@/lib/scheduler/types";

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
    return matches(task.productManagers);
  }
  return false;
};

export const hoursForResourceOnTask = (task: Task, resource: Resource): number => {
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
    return share(task.beDevs?.length ? task.beDevs : [], task.beHours);
  }
  if (resource.type === "FE") {
    return share(task.feDevs?.length ? task.feDevs : [], task.feHours);
  }
  if (resource.type === "MO") {
    let total = 0;
    const androidAssignees = task.androidDevs?.length ? task.androidDevs : [];
    total += share(androidAssignees, task.androidHours ?? 0);
    if (task.needsIos) {
      const iosAssignees = task.iosDevs?.length ? task.iosDevs : [];
      total += share(iosAssignees, Math.max(0, task.iosHours ?? 0));
    }
    return total;
  }
  if (resource.type === "QC") {
    return share(task.qcs?.length ? task.qcs : [], task.qcHours);
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
};

/**
 * Stories assigned to this resource on the current sprint board.
 * Dedupes by Jira key (keeps the row with more hours for that person).
 */
export const buildResourceInsightTaskRows = (
  tasks: Task[],
  resource: Resource,
): ResourceInsightTaskRow[] => {
  const bestByKey = new Map<string, ResourceInsightTaskRow>();

  for (const task of tasks) {
    if (task.carryToNextSprint || !isResourceAssignedOnTask(task, resource)) {
      continue;
    }
    const row: ResourceInsightTaskRow = {
      taskId: task.id,
      storyLabel: task.storyName || task.storyLink || task.id,
      storyLink: task.storyLink,
      status: task.status,
      totalHours: hoursForResourceOnTask(task, resource),
    };
    const key = resourceInsightDedupeKey(task);
    const existing = bestByKey.get(key);
    if (!existing || row.totalHours > existing.totalHours) {
      bestByKey.set(key, row);
    }
  }

  return [...bestByKey.values()];
};
