import { normalizeReleaseGroup } from "@/lib/scheduler/releaseGroups";
import { isUatTaskStatus } from "@/lib/scheduler/taskStatus";
import type { ScheduleResult, Task } from "@/lib/scheduler/types";

/**
 * UAT / Ready for Production float above other statuses in the dashboard list.
 * Lower rank = higher in the list. This is always the first sort key.
 */
export const dashboardStatusTopRank = (status: string): number => {
  if (isUatTaskStatus(status)) {
    return 0;
  }
  if (status.trim().toLowerCase() === "ready for production") {
    return 1;
  }
  return 2;
};

const isDashboardTopStatus = (status: string): boolean => dashboardStatusTopRank(status) < 2;

/**
 * Keep relative order, but move UAT then Ready for Production stories to the top.
 */
export const floatNearReleaseStatusesToTop = (tasks: Task[]): Task[] => {
  const top: Task[] = [];
  const rest: Task[] = [];
  for (const task of tasks) {
    if (isDashboardTopStatus(task.status)) {
      top.push(task);
    } else {
      rest.push(task);
    }
  }
  top.sort((a, b) => {
    const rankDiff = dashboardStatusTopRank(a.status) - dashboardStatusTopRank(b.status);
    return rankDiff !== 0 ? rankDiff : 0;
  });
  return [...top, ...rest];
};

/**
 * Default dashboard sort within a release group: PO Order first, then expected release date.
 */
export const compareTasksWithinReleaseGroup = (
  a: Task,
  b: Task,
  releaseDateById: Map<string, Date | null | undefined>,
): number => {
  const aPriority = a.poPriority ?? Number.MAX_SAFE_INTEGER;
  const bPriority = b.poPriority ?? Number.MAX_SAFE_INTEGER;
  if (aPriority !== bPriority) {
    return aPriority - bPriority;
  }

  const aRelease = releaseDateById.get(a.id);
  const bRelease = releaseDateById.get(b.id);
  if (!aRelease && !bRelease) return 0;
  if (!aRelease) return 1;
  if (!bRelease) return -1;
  return aRelease.getTime() - bRelease.getTime();
};

/**
 * Dashboard sort keys (in order):
 * 1. Status tier (UAT → Ready for Production → everything else)
 * 2. Order (poPriority)
 * 3. Release group adjacency / group rank
 * 4. Release date
 */
export const compareTasksForDashboardOrder = (
  a: Task,
  b: Task,
  releaseDateById: Map<string, Date | null | undefined>,
  groupRankByName: Map<string, number>,
): number => {
  const statusRankDiff = dashboardStatusTopRank(a.status) - dashboardStatusTopRank(b.status);
  if (statusRankDiff !== 0) {
    return statusRankDiff;
  }

  const aPriority = a.poPriority ?? Number.MAX_SAFE_INTEGER;
  const bPriority = b.poPriority ?? Number.MAX_SAFE_INTEGER;
  if (aPriority !== bPriority) {
    return aPriority - bPriority;
  }

  const aGroup = normalizeReleaseGroup(a.releaseGroup);
  const bGroup = normalizeReleaseGroup(b.releaseGroup);

  if (aGroup !== bGroup) {
    if (!aGroup) return 1;
    if (!bGroup) return -1;
    const aRank = groupRankByName.get(aGroup) ?? Number.MAX_SAFE_INTEGER;
    const bRank = groupRankByName.get(bGroup) ?? Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) {
      return aRank - bRank;
    }
    return aGroup.localeCompare(bGroup);
  }

  return compareTasksWithinReleaseGroup(a, b, releaseDateById);
};

export const buildReleaseGroupRankMap = (tasks: Task[]): Map<string, number> => {
  const ranks = new Map<string, number>();
  for (const task of tasks) {
    const group = normalizeReleaseGroup(task.releaseGroup);
    if (!group) {
      continue;
    }
    const priority = task.poPriority ?? Number.MAX_SAFE_INTEGER;
    const current = ranks.get(group);
    if (current === undefined || priority < current) {
      ranks.set(group, priority);
    }
  }
  return ranks;
};

/**
 * Keep first-seen group order, but pull later members of the same release group next to
 * the first occurrence. Only clusters within the same status tier so UAT / RFP stay on top.
 */
export const clusterTasksByReleaseGroup = (tasks: Task[]): Task[] => {
  const placed = new Set<string>();
  const result: Task[] = [];

  for (const task of tasks) {
    if (placed.has(task.id)) {
      continue;
    }
    const group = normalizeReleaseGroup(task.releaseGroup);
    const tier = dashboardStatusTopRank(task.status);
    if (!group) {
      result.push(task);
      placed.add(task.id);
      continue;
    }
    for (const other of tasks) {
      if (placed.has(other.id)) {
        continue;
      }
      if (dashboardStatusTopRank(other.status) !== tier) {
        continue;
      }
      if (normalizeReleaseGroup(other.releaseGroup) === group) {
        result.push(other);
        placed.add(other.id);
      }
    }
  }

  return result;
};

/**
 * Build persisted dashboard row order from schedule results.
 */
export const buildDashboardTaskOrder = (tasks: Task[], result: ScheduleResult): string[] => {
  const releaseDateById = new Map(result.tasks.map((task) => [task.id, task.releaseDate]));
  const groupRankByName = buildReleaseGroupRankMap(tasks);
  return [...tasks]
    .sort((a, b) => compareTasksForDashboardOrder(a, b, releaseDateById, groupRankByName))
    .map((task) => task.id);
};

/**
 * Sort tasks for the dashboard table, optionally pinned to a saved order.
 * Status tier is always first; Order is next; release groups stay adjacent within a tier.
 */
/**
 * Keep saved dashboard order, then any active tasks missing from it (store order),
 * then newly bulk-added ids at the end.
 */
export const appendTaskIdsToDashboardOrder = (
  order: string[],
  existingActiveIds: string[],
  newIds: string[],
): string[] => {
  if (newIds.length === 0) {
    return order;
  }
  const activeSet = new Set(existingActiveIds);
  const next: string[] = [];
  const seen = new Set<string>();

  const push = (id: string) => {
    if (!activeSet.has(id) || seen.has(id)) {
      return;
    }
    next.push(id);
    seen.add(id);
  };

  for (const id of order) {
    push(id);
  }
  for (const id of existingActiveIds) {
    push(id);
  }
  for (const id of newIds) {
    push(id);
  }

  return next;
};

export const sortTasksForDashboard = (
  tasks: Task[],
  releaseDateById: Map<string, Date | null | undefined>,
  pinnedOrder: string[] | null | undefined,
): Task[] => {
  const groupRankByName = buildReleaseGroupRankMap(tasks);
  const sorted = [...tasks];

  if (!pinnedOrder || pinnedOrder.length === 0) {
    sorted.sort((a, b) => compareTasksForDashboardOrder(a, b, releaseDateById, groupRankByName));
    return floatNearReleaseStatusesToTop(clusterTasksByReleaseGroup(sorted));
  }

  const orderIndex = new Map(pinnedOrder.map((id, index) => [id, index]));
  sorted.sort((a, b) => {
    const statusRankDiff = dashboardStatusTopRank(a.status) - dashboardStatusTopRank(b.status);
    if (statusRankDiff !== 0) {
      return statusRankDiff;
    }

    const aPriority = a.poPriority ?? Number.MAX_SAFE_INTEGER;
    const bPriority = b.poPriority ?? Number.MAX_SAFE_INTEGER;
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    const aIndex = orderIndex.get(a.id);
    const bIndex = orderIndex.get(b.id);
    const aPinned = aIndex !== undefined;
    const bPinned = bIndex !== undefined;

    if (aPinned && bPinned) {
      return aIndex - bIndex;
    }
    if (aPinned !== bPinned) {
      return aPinned ? -1 : 1;
    }
    return compareTasksForDashboardOrder(a, b, releaseDateById, groupRankByName);
  });

  return floatNearReleaseStatusesToTop(clusterTasksByReleaseGroup(sorted));
};
