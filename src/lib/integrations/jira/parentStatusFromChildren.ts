import {
  isBlockedTaskStatus,
  isBufferPhaseTaskStatus,
  isDiscopedTaskStatus,
  isReleasedTaskStatus,
  isTestingTaskStatus,
  isTodoTaskStatus,
  isUatTaskStatus,
} from "@/lib/scheduler/taskStatus";

/** Parent statuses the subtasks can move a story to (Jira status names). */
export const CHILD_DRIVEN_PARENT_STATUS = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  READY_FOR_REVIEW: "Ready for Review",
  READY_FOR_TESTING: "Ready for Testing",
} as const;

const STAGE_STATUS = [
  CHILD_DRIVEN_PARENT_STATUS.TODO,
  CHILD_DRIVEN_PARENT_STATUS.IN_PROGRESS,
  CHILD_DRIVEN_PARENT_STATUS.READY_FOR_REVIEW,
  CHILD_DRIVEN_PARENT_STATUS.READY_FOR_TESTING,
] as const;

type Stage = 0 | 1 | 2 | 3;

const normalize = (value: string) => value.trim().toLowerCase();

/** Initial Review and Final Review are review steps, so the parent sits at Ready for Review. */
const isReviewStatus = (status: string): boolean => {
  const value = normalize(status);
  return value === "ready for review" || value === "initial review" || value === "final review";
};

const isCancelledStatus = (status: string): boolean =>
  normalize(status) === "cancelled" || isDiscopedTaskStatus(status);

/**
 * Workflow stage for a Jira status.
 * 0 = To Do, 1 = In Progress (including Blocked), 2 = Ready for Review (including Initial/Final Review),
 * 3 = Ready for Testing or later.
 * @param status - Jira status name.
 * @returns The stage used to find the slowest subtask.
 */
export const workflowStageForStatus = (status: string): Stage => {
  const value = normalize(status);
  if (isTodoTaskStatus(status) && !value.includes("review")) return 0;
  if (isReviewStatus(status)) return 2;
  if (
    isTestingTaskStatus(status) ||
    isUatTaskStatus(status) ||
    isBufferPhaseTaskStatus(status) ||
    isReleasedTaskStatus(status) ||
    value === "closed"
  ) {
    return 3;
  }
  return 1;
};

/**
 * Parent status implied by the slowest active subtask (Cancelled/Discoped ignored).
 * All To Do → To Do. Any still In Progress or earlier → In Progress.
 * Every subtask at least Ready for Review, but not all Ready for Testing → Ready for Review.
 * Every subtask Ready for Testing or later → Ready for Testing.
 * @param childStatuses - Jira status names of every subtask under the parent.
 * @returns The implied status, or null when there are no active subtasks or a status is unknown.
 */
export const deriveParentStatusFromChildren = (childStatuses: Array<string | undefined>): string | null => {
  if (childStatuses.some((status) => !status?.trim())) return null;
  const active = (childStatuses as string[]).filter((status) => !isCancelledStatus(status));
  if (active.length === 0) return null;

  const stages = active.map(workflowStageForStatus);
  if (stages.every((stage) => stage === 0)) return CHILD_DRIVEN_PARENT_STATUS.TODO;
  const slowest = Math.min(...stages);
  if (slowest >= 3) return CHILD_DRIVEN_PARENT_STATUS.READY_FOR_TESTING;
  if (slowest >= 2) return CHILD_DRIVEN_PARENT_STATUS.READY_FOR_REVIEW;
  return CHILD_DRIVEN_PARENT_STATUS.IN_PROGRESS;
};

export type ParentStatusFromChildrenResult = {
  /** Set when the subtasks move the parent forward. */
  status?: string;
  /** Set when the subtasks point behind the parent (parent left unchanged). */
  warning?: string;
};

/**
 * Forward-only parent status update from subtasks.
 * Cancelled / Discoped / Blocked parents are never changed: someone set them on purpose.
 * @param parentStatus - Current Jira parent status name.
 * @param childStatuses - Jira status names of every subtask.
 * @returns `status` to apply when the subtasks are further along; `warning` when they are behind; empty otherwise.
 */
export const resolveParentStatusFromChildren = (
  parentStatus: string,
  childStatuses: Array<string | undefined>,
): ParentStatusFromChildrenResult => {
  if (!parentStatus.trim() || isCancelledStatus(parentStatus) || isBlockedTaskStatus(parentStatus)) return {};
  const implied = deriveParentStatusFromChildren(childStatuses);
  if (!implied) return {};

  const impliedStage = STAGE_STATUS.indexOf(implied as (typeof STAGE_STATUS)[number]);
  const parentStage = workflowStageForStatus(parentStatus);
  if (impliedStage > parentStage) {
    return { status: implied };
  }
  if (impliedStage < parentStage) {
    return {
      warning: `Subtasks point to "${implied}" but the Jira parent is "${parentStatus}" — parent status left unchanged`,
    };
  }
  return {};
};
