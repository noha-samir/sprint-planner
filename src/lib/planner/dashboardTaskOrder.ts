import { normalizeReleaseGroup } from "@/lib/scheduler/releaseGroups";
import type { ScheduleResult, Task } from "@/lib/scheduler/types";

/** How the dashboard list is ordered. Default is status, then Order, then release date. */
export type DashboardSortMode = "default" | "status" | "release" | "order";

/**
 * Workflow position for the dashboard, latest step first.
 * Lower rank sits higher in the list.
 * @param status - Planner status label.
 * @returns Rank. Unknown statuses sit after the named flow.
 */
export const dashboardStatusRank = (status: string): number => {
  switch (status.trim().toLowerCase()) {
    case "production":
    case "done":
    case "released":
      return 0;
    case "ready for production":
      return 1;
    case "uat":
      return 2;
    case "staging":
      return 3;
    case "pending bug fixes":
      return 4;
    case "testing":
      return 5;
    case "ready for testing":
      return 6;
    case "final review":
      return 7;
    case "initial review":
      return 8;
    case "ready for review":
      return 9;
    case "in progress":
    case "inprogress":
      return 10;
    case "to do":
    case "todo":
      return 11;
    case "blocked":
      return 12;
    case "backlog":
      return 13;
    case "cancelled":
      return 14;
    case "closed":
      return 15;
    case "discoped":
      return 16;
    default:
      return 17;
  }
};

const isBlockedDashboardStatus = (status: string): boolean => status.trim().toLowerCase() === "blocked";

/**
 * Order number, lower first. Stories with no Order sit last.
 * @param a - First story.
 * @param b - Second story.
 * @returns Negative when a comes first.
 */
const compareDashboardOrder = (a: Task, b: Task): number => {
  const aPriority = a.poPriority ?? Number.MAX_SAFE_INTEGER;
  const bPriority = b.poPriority ?? Number.MAX_SAFE_INTEGER;
  return aPriority - bPriority;
};

/**
 * Soonest release date first. Stories with no date sit last.
 * @param a - First story.
 * @param b - Second story.
 * @param releaseDateById - UAT release date from the schedule, keyed by task id.
 * @returns Negative when a comes first.
 */
const compareDashboardReleaseDate = (
  a: Task,
  b: Task,
  releaseDateById: Map<string, Date | null | undefined>,
): number => {
  const aRelease = releaseDateById.get(a.id);
  const bRelease = releaseDateById.get(b.id);
  const aTime = aRelease instanceof Date && !Number.isNaN(aRelease.getTime()) ? aRelease.getTime() : null;
  const bTime = bRelease instanceof Date && !Number.isNaN(bRelease.getTime()) ? bRelease.getTime() : null;
  if (aTime == null && bTime == null) return 0;
  if (aTime == null) return 1;
  if (bTime == null) return -1;
  return aTime - bTime;
};

/**
 * Default dashboard order: status, then Order, then release date, with a release group kept as one block.
 * The block sits where its furthest story would sit. Stories inside it follow that same order.
 * Stories with no group stay single rows.
 * @param tasks - Rows to sort.
 * @param releaseDateById - UAT release date from the schedule, keyed by task id.
 * @returns A new array.
 */
const sortDefaultKeepingGroups = (
  tasks: Task[],
  releaseDateById: Map<string, Date | null | undefined>,
): Task[] => {
  const membersByGroup = new Map<string, Task[]>();
  const blocks: Task[][] = [];

  for (const task of tasks) {
    const group = normalizeReleaseGroup(task.releaseGroup)?.toLowerCase();
    if (!group) {
      blocks.push([task]);
      continue;
    }
    const members = membersByGroup.get(group);
    if (members) members.push(task);
    else membersByGroup.set(group, [task]);
  }

  const byDefault = (a: Task, b: Task) => compareTasksForDashboardSort(a, b, releaseDateById, "default");
  for (const members of membersByGroup.values()) {
    blocks.push([...members].sort(byDefault));
  }
  blocks.sort((a, b) => byDefault(a[0], b[0]));
  return blocks.flat();
};

/**
 * Compare two stories for the selected dashboard sort.
 * Default is status (latest step first), then Order, then release date.
 * Blocked stories are not ordered by release date.
 * A release group is kept together by `sortTasksForDashboard`, placed by its furthest story.
 * @param a - First story.
 * @param b - Second story.
 * @param releaseDateById - UAT release date from the schedule, keyed by task id.
 * @param mode - Which sort the user picked.
 * @returns Negative when a comes first.
 */
export const compareTasksForDashboardSort = (
  a: Task,
  b: Task,
  releaseDateById: Map<string, Date | null | undefined>,
  mode: DashboardSortMode,
): number => {
  if (mode === "order") {
    return compareDashboardOrder(a, b);
  }
  if (mode === "release") {
    const aBlocked = isBlockedDashboardStatus(a.status);
    const bBlocked = isBlockedDashboardStatus(b.status);
    if (aBlocked !== bBlocked) return aBlocked ? 1 : -1;
    if (aBlocked && bBlocked) return compareDashboardOrder(a, b);
    return compareDashboardReleaseDate(a, b, releaseDateById);
  }
  if (mode === "status") {
    return dashboardStatusRank(a.status) - dashboardStatusRank(b.status);
  }
  const statusDiff = dashboardStatusRank(a.status) - dashboardStatusRank(b.status);
  if (statusDiff !== 0) return statusDiff;
  const orderDiff = compareDashboardOrder(a, b);
  if (orderDiff !== 0) return orderDiff;
  if (isBlockedDashboardStatus(a.status)) return 0;
  return compareDashboardReleaseDate(a, b, releaseDateById);
};

/**
 * Build persisted dashboard row order from schedule results.
 * Uses the default sort: status, then Order, then release date.
 * @param tasks - Stories on the board.
 * @param result - Current schedule, used for release dates.
 * @returns Task ids in dashboard order.
 */
export const buildDashboardTaskOrder = (tasks: Task[], result: ScheduleResult): string[] => {
  const releaseDateById = new Map(result.tasks.map((task) => [task.id, task.releaseDate]));
  return sortTasksForDashboard(tasks, releaseDateById, "default").map((task) => task.id);
};

/**
 * Sort the visible dashboard rows.
 * Default is status, then Order, then release date. A release group stays together and sits where its furthest story would sit.
 * Status, Release date, and Order do not regroup.
 * @param tasks - Rows that passed the filters.
 * @param releaseDateById - UAT release date from the schedule, keyed by task id.
 * @param mode - Default, status, release date, or Order.
 * @returns A new array in the chosen order.
 */
export const sortTasksForDashboard = (
  tasks: Task[],
  releaseDateById: Map<string, Date | null | undefined>,
  mode: DashboardSortMode = "default",
): Task[] =>
  mode === "default"
    ? sortDefaultKeepingGroups(tasks, releaseDateById)
    : [...tasks].sort((a, b) => compareTasksForDashboardSort(a, b, releaseDateById, mode));

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

/**
 * Keep the rows in a captured order so an edit does not move the story the user is working through.
 * Ids that were not in the capture stay at the end, in their current relative order.
 * @param tasks - Rows to show.
 * @param order - Ids in the order to keep.
 */
export const sortTasksByFrozenOrder = (tasks: Task[], order: readonly string[]): Task[] => {
  const index = new Map(order.map((id, position) => [id, position]));
  return [...tasks].sort((a, b) => {
    const aIndex = index.get(a.id);
    const bIndex = index.get(b.id);
    if (aIndex === undefined && bIndex === undefined) return 0;
    if (aIndex === undefined) return 1;
    if (bIndex === undefined) return -1;
    return aIndex - bIndex;
  });
};
