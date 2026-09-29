import type { JiraApiCredentials } from "./credentials";
import {
  getJiraIssueStatusName,
  listJiraIssueTransitions,
  transitionJiraIssue,
  type JiraIssueTransition,
} from "./client";
import { isSameJiraStatus, pickTransitionForTargetStatus } from "./statusMap";
import { isTodoTaskStatus } from "@/lib/scheduler/taskStatus";

export type SyncIssueStatusResult = {
  changed: boolean;
  fromStatus: string;
  toStatus: string | null;
  warning?: string;
};

/** Forward workflow up to Ready for Testing: To Do → In Progress → Ready for Review → Ready for Testing. */
const FORWARD_STEP_RANK: Record<string, number> = {
  "to do": 0,
  "in progress": 1,
  "ready for review": 2,
  "ready for testing": 3,
};

const MAX_FORWARD_STEPS = Object.keys(FORWARD_STEP_RANK).length;

/**
 * Position of a status on the forward workflow.
 * @returns Rank, or null when the status is not part of the stepped workflow (e.g. Blocked, Testing).
 */
const forwardStepRank = (status: string): number | null => {
  const value = status.trim().toLowerCase();
  if (value in FORWARD_STEP_RANK) return FORWARD_STEP_RANK[value];
  return isTodoTaskStatus(status) && !value.includes("review") ? 0 : null;
};

/**
 * Next forward transition toward the target when Jira has no direct one: the furthest available status
 * that is after the current status and before the target.
 */
const pickForwardStepTransition = (
  transitions: JiraIssueTransition[],
  currentStatus: string,
  targetStatus: string,
): JiraIssueTransition | null => {
  const currentRank = forwardStepRank(currentStatus);
  const targetRank = forwardStepRank(targetStatus);
  if (currentRank == null || targetRank == null || targetRank <= currentRank) return null;
  let best: { transition: JiraIssueTransition; rank: number } | null = null;
  for (const transition of transitions) {
    const rank = forwardStepRank(transition.toStatusName);
    if (rank == null || rank <= currentRank || rank >= targetRank) continue;
    if (!best || rank > best.rank) best = { transition, rank };
  }
  return best?.transition ?? null;
};

/**
 * Push planner status to Jira by transitioning the parent issue to that status name.
 * When the workflow has no direct transition, steps forward one status at a time
 * (To Do → In Progress → Ready for Review → Ready for Testing) until the target is reached.
 * @returns `warning` when the target could not be reached (possibly after some forward steps).
 */
export const pushPlannerStatusToJira = async (
  credentials: JiraApiCredentials,
  issueKey: string,
  targetStatusName: string,
): Promise<SyncIssueStatusResult> => {
  const target = targetStatusName.trim();
  if (!target) {
    return {
      changed: false,
      fromStatus: "",
      toStatus: null,
      warning: `No status set on planner task for ${issueKey}`,
    };
  }

  const fromStatus = await getJiraIssueStatusName(credentials, issueKey);
  if (isSameJiraStatus(fromStatus, target)) {
    return { changed: false, fromStatus, toStatus: fromStatus };
  }

  let currentStatus = fromStatus;
  let transitions = await listJiraIssueTransitions(credentials, issueKey);
  for (let step = 0; step < MAX_FORWARD_STEPS; step += 1) {
    const direct = pickTransitionForTargetStatus(transitions, target);
    const next = direct ?? pickForwardStepTransition(transitions, currentStatus, target);
    if (!next) break;
    await transitionJiraIssue(credentials, issueKey, next.id);
    currentStatus = next.toStatusName;
    if (direct || isSameJiraStatus(currentStatus, target)) {
      return { changed: true, fromStatus, toStatus: currentStatus };
    }
    transitions = await listJiraIssueTransitions(credentials, issueKey);
  }

  const available = transitions.map((item) => item.toStatusName).join(", ") || "none";
  if (currentStatus === fromStatus) {
    return {
      changed: false,
      fromStatus,
      toStatus: null,
      warning: `Could not move ${issueKey} from "${fromStatus}" to "${target}". Available from here: ${available}`,
    };
  }
  return {
    changed: true,
    fromStatus,
    toStatus: currentStatus,
    warning:
      `Moved ${issueKey} from "${fromStatus}" to "${currentStatus}" but could not continue to "${target}". ` +
      `Available from here: ${available}`,
  };
};
