import {
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
  READY_FOR_TESTING: "Ready for Testing",
} as const;

const STAGE_STATUS = [
  CHILD_DRIVEN_PARENT_STATUS.TODO,
  CHILD_DRIVEN_PARENT_STATUS.IN_PROGRESS,
  CHILD_DRIVEN_PARENT_STATUS.READY_FOR_TESTING,
] as const;

type Stage = 0 | 1 | 2;

const normalize = (value: string) => value.trim().toLowerCase();

const isCancelledStatus = (status: string): boolean =>
  normalize(status) === "cancelled" || isDiscopedTaskStatus(status);

/**
 * Workflow stage for a Jira status: 0 = To Do, 1 = In Progress (incl. review/blocked), 2 = Ready for Testing or later.
 * Code-review states (Initial/Final Review) sit after In Progress in this workflow, so they are stage 1.
 */
export const workflowStageForStatus = (status: string): Stage => {
  const value = normalize(status);
  if (isTodoTaskStatus(status) && !value.includes("review")) return 0;
  if (
    isTestingTaskStatus(status) ||
    isUatTaskStatus(status) ||
    isBufferPhaseTaskStatus(status) ||
    isReleasedTaskStatus(status) ||
    value === "closed"
  ) {
    return 2;
  }
  return 1;
};

/**
 * Parent status implied by the subtasks (all subtasks; Cancelled/Discoped ignored).
 * All To Do → To Do; all Ready for Testing or later → Ready for Testing; otherwise → In Progress.
 * @param childStatuses - Jira status names of every subtask under the parent.
 * @returns The implied status, or null when there are no active subtasks or a status is unknown.
 */
export const deriveParentStatusFromChildren = (childStatuses: Array<string | undefined>): string | null => {
  if (childStatuses.some((status) => !status?.trim())) return null;
  const active = (childStatuses as string[]).filter((status) => !isCancelledStatus(status));
  if (active.length === 0) return null;

  const stages = active.map(workflowStageForStatus);
  if (stages.every((stage) => stage === 0)) return CHILD_DRIVEN_PARENT_STATUS.TODO;
  if (stages.every((stage) => stage === 2)) return CHILD_DRIVEN_PARENT_STATUS.READY_FOR_TESTING;
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
 * @param parentStatus - Current Jira parent status name.
 * @param childStatuses - Jira status names of every subtask.
 * @returns `status` to apply when the subtasks are further along; `warning` when they are behind; empty otherwise.
 */
export const resolveParentStatusFromChildren = (
  parentStatus: string,
  childStatuses: Array<string | undefined>,
): ParentStatusFromChildrenResult => {
  if (!parentStatus.trim() || isCancelledStatus(parentStatus)) return {};
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
