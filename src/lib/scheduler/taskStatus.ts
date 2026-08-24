import type { TaskWorkflowStatus } from "./types";

/** Planner-only status — never synced to Jira. */
export const DISCOPED_STATUS: TaskWorkflowStatus = "Discoped";

/**
 * Default Story statuses for Bosta BR (Jira), plus planner-only Discoped.
 */
export const DEFAULT_JIRA_STORY_STATUSES: TaskWorkflowStatus[] = [
  DISCOPED_STATUS,
  "To Do",
  "In Progress",
  "Blocked",
  "Ready for Review",
  "Initial Review",
  "Final Review",
  "Ready for Testing",
  "Testing",
  "Pending Bug Fixes",
  "UAT",
  "STAGING",
  "Ready for Production",
  "Production",
  "Closed",
  "Cancelled",
];

const OLD_PLANNER_TO_JIRA: Record<string, TaskWorkflowStatus> = {
  TODO: "To Do",
  InProgress: "In Progress",
  Testing: "Testing",
  UAT: "UAT",
  Released: "Production",
};

const normalize = (value: string) => value.trim().toLowerCase();

/** Map legacy planner statuses and unknown values onto a Jira / planner status name. */
export const normalizeTaskStatus = (raw: string | null | undefined): TaskWorkflowStatus => {
  const trimmed = raw?.trim() || "";
  if (!trimmed) {
    return "To Do";
  }
  if (normalize(trimmed) === "discoped") {
    return DISCOPED_STATUS;
  }
  if (OLD_PLANNER_TO_JIRA[trimmed]) {
    return OLD_PLANNER_TO_JIRA[trimmed];
  }
  const exact = DEFAULT_JIRA_STORY_STATUSES.find((status) => normalize(status) === normalize(trimmed));
  return exact ?? trimmed;
};

export const DEFAULT_TASK_STATUS: TaskWorkflowStatus = "To Do";

export const isDiscopedTaskStatus = (status: string): boolean => normalize(status) === "discoped";

/** Discoped / Cancelled / Closed — out of active planning. */
export const isInactiveTaskStatus = (status: string): boolean => {
  const value = normalize(status);
  return value === "cancelled" || value === "closed" || value === "discoped";
};

/** Production / done shipping states (was Released). Ready for Production and STAGING stay schedulable (buffer phase). */
export const isReleasedTaskStatus = (status: string): boolean => {
  const value = normalize(status);
  return value === "production" || value === "done" || value === "released";
};

/** Ready for Production / STAGING — past QC, schedule from buffer. */
export const isBufferPhaseTaskStatus = (status: string): boolean => {
  const value = normalize(status);
  return value === "ready for production" || value === "staging";
};

export const isUatTaskStatus = (status: string): boolean => normalize(status) === "uat";

/** UAT / STAGING — go-live dates pending on the PM. */
export const isReleasePendingOnPmStatus = (status: string): boolean => {
  const value = normalize(status);
  return value === "uat" || value === "staging";
};

/** Ready for Production — go-live dates pending on the EM. */
export const isReleasePendingOnEmStatus = (status: string): boolean =>
  normalize(status) === "ready for production";

/** Scheduler no longer owns UAT/Production dates (PM or EM handoff). */
export const isReleaseDateHandoffStatus = (status: string): boolean =>
  isReleasePendingOnPmStatus(status) || isReleasePendingOnEmStatus(status);

/** UI label for deferred UAT/Production dates, or null when the scheduler still owns them. */
export const releaseDateHandoffLabel = (status: string): "Pending on PM" | "Pending on EM" | null => {
  if (isReleasePendingOnEmStatus(status)) {
    return "Pending on EM";
  }
  if (isReleasePendingOnPmStatus(status)) {
    return "Pending on PM";
  }
  return null;
};

export const isTestingTaskStatus = (status: string): boolean => {
  const value = normalize(status);
  return value === "testing" || value === "ready for testing" || value === "pending bug fixes";
};

/** Still in the open / backlog-ish bucket (was TODO) — used for reorder. */
export const isTodoTaskStatus = (status: string): boolean => {
  const value = normalize(status);
  return (
    value === "to do" ||
    value === "todo" ||
    value === "backlog" ||
    value === "ready for development" ||
    value === "problem discovery" ||
    value === "story writing" ||
    value === "ready for design" ||
    value === "in design" ||
    value === "initial design" ||
    value === "final design" ||
    value === "final review" ||
    value === "initial review"
  );
};

export const isExcludedFromSchedule = (status: string): boolean =>
  isInactiveTaskStatus(status) || isReleasedTaskStatus(status);

/** Statuses hidden in the dashboard filter by default. */
export const isHiddenByDefaultStatusFilter = (status: string): boolean =>
  isInactiveTaskStatus(status) || isReleasedTaskStatus(status);

/**
 * Status filter options: known planner list first, then any extra statuses already on tasks.
 */
export const buildStatusFilterOptions = (
  knownStatuses: readonly string[],
  taskStatuses: Iterable<string | null | undefined>,
): string[] => {
  const seen = new Set<string>();
  const options: string[] = [];

  const push = (raw: string) => {
    const normalized = normalizeTaskStatus(raw);
    const label = normalized.trim();
    if (!label) return;
    const key = normalize(label);
    if (seen.has(key)) return;
    seen.add(key);
    const knownMatch = knownStatuses.find((status) => normalize(status) === key);
    options.push(knownMatch ?? label);
  };

  for (const status of knownStatuses) {
    push(status);
  }
  for (const status of taskStatuses) {
    if (typeof status === "string") {
      push(status);
    }
  }
  return options;
};

/** Default-on statuses for a filter option list (excludes discoped / done / closed / etc.). */
export const defaultVisibleStatusFilter = (options: readonly string[]): string[] =>
  options.filter((status) => !isHiddenByDefaultStatusFilter(status));

/**
 * Unique visual key per planner status — used for row/chip/filter colors.
 * Every default status maps to a distinct key (no shared palette buckets).
 */
export const TASK_STATUS_COLOR_KEYS = [
  "discoped",
  "todo",
  "in-progress",
  "blocked",
  "ready-for-review",
  "initial-review",
  "final-review",
  "ready-for-testing",
  "testing",
  "pending-bug-fixes",
  "uat",
  "staging",
  "ready-for-production",
  "production",
  "closed",
  "cancelled",
  "default",
] as const;

export type TaskStatusColorKey = (typeof TASK_STATUS_COLOR_KEYS)[number];

const STATUS_COLOR_BY_NAME: Record<string, TaskStatusColorKey> = {
  discoped: "discoped",
  "to do": "todo",
  todo: "todo",
  "in progress": "in-progress",
  inprogress: "in-progress",
  blocked: "blocked",
  "ready for review": "ready-for-review",
  "initial review": "initial-review",
  "final review": "final-review",
  "ready for testing": "ready-for-testing",
  testing: "testing",
  "pending bug fixes": "pending-bug-fixes",
  uat: "uat",
  staging: "staging",
  "ready for production": "ready-for-production",
  production: "production",
  released: "production",
  closed: "closed",
  cancelled: "cancelled",
};

/** Resolve the unique color key for a status label. */
export const taskStatusColorKey = (status: string): TaskStatusColorKey =>
  STATUS_COLOR_BY_NAME[normalize(status)] ?? "default";

export const statusRowClass = (status: string): string => `status-row-${taskStatusColorKey(status)}`;
export const statusChipClass = (status: string): string => `status-chip-${taskStatusColorKey(status)}`;
export const statusFilterClass = (status: string): string =>
  `status-filter-row-${taskStatusColorKey(status)}`;

/**
 * Coarse buckets for resource insight task lists.
 * Order: To Do → In Progress → In Review → Done.
 * Display labels stay the exact Jira / planner status names.
 */
export type ResourceInsightStatusBucket = "todo" | "in-progress" | "in-review" | "done";

export const resourceInsightStatusBucket = (status: string): ResourceInsightStatusBucket => {
  const value = normalize(status);
  if (
    value === "done" ||
    value === "production" ||
    value === "released" ||
    value === "closed" ||
    value === "cancelled" ||
    value === "discoped"
  ) {
    return "done";
  }
  if (
    value === "ready for review" ||
    value === "initial review" ||
    value === "final review" ||
    value.includes("review")
  ) {
    return "in-review";
  }
  if (isTodoTaskStatus(status)) {
    return "todo";
  }
  return "in-progress";
};

const RESOURCE_INSIGHT_BUCKET_RANK: Record<ResourceInsightStatusBucket, number> = {
  todo: 0,
  "in-progress": 1,
  "in-review": 2,
  done: 3,
};

/** Sort key for resource insight: To Do → In Progress → In Review → Done. */
export const resourceInsightStatusRank = (status: string): number =>
  RESOURCE_INSIGHT_BUCKET_RANK[resourceInsightStatusBucket(status)];

export const RESOURCE_INSIGHT_BUCKET_LABELS: Record<ResourceInsightStatusBucket, string> = {
  todo: "To Do",
  "in-progress": "In Progress",
  "in-review": "In Review",
  done: "Done",
};
