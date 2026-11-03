import type { JiraApiCredentials } from "./credentials";
import {
  getJiraIssueStatusName,
  listJiraIssueTransitions,
  transitionJiraIssue,
  type JiraIssueTransition,
} from "./client";
import { isSameJiraStatus, pickTransitionForTargetStatus } from "./statusMap";
import { jiraStatusForwardRank } from "./statusWalk";

export type SyncIssueStatusResult = {
  changed: boolean;
  fromStatus: string;
  toStatus: string | null;
  warning?: string;
};

/** One transition per status on the release path, plus a detour when Jira's next step is an earlier release status. */
const MAX_FORWARD_STEPS = 16;

const statusKey = (status: string): string => status.trim().toLowerCase();

/**
 * Next forward transition toward the target when Jira has no direct one: the next status on the
 * release path (STAGING → UAT → Ready for Production → Production), not a later status offered at the same time.
 */
const pickForwardStepTransition = (
  transitions: JiraIssueTransition[],
  currentStatus: string,
  targetStatus: string,
  visited: Set<string>,
): JiraIssueTransition | null => {
  const currentRank = jiraStatusForwardRank(currentStatus);
  const targetRank = jiraStatusForwardRank(targetStatus);
  if (currentRank == null || targetRank == null || targetRank <= currentRank) return null;
  let best: { transition: JiraIssueTransition; rank: number } | null = null;
  for (const transition of transitions) {
    const rank = jiraStatusForwardRank(transition.toStatusName);
    if (rank == null || rank <= currentRank || rank >= targetRank) continue;
    if (visited.has(statusKey(transition.toStatusName))) continue;
    if (!best || rank < best.rank) best = { transition, rank };
  }
  return best?.transition ?? null;
};

/**
 * When the forward step is missing, take the closest earlier release status that has not been used yet.
 * To Do, Done, Blocked, and Cancelled are not detours.
 * @param visited - Statuses already applied in this push, so the walk cannot bounce.
 */
const pickReleaseDetourTransition = (
  transitions: JiraIssueTransition[],
  currentStatus: string,
  targetStatus: string,
  visited: Set<string>,
): JiraIssueTransition | null => {
  const currentRank = jiraStatusForwardRank(currentStatus);
  const targetRank = jiraStatusForwardRank(targetStatus);
  if (currentRank == null || targetRank == null || targetRank <= currentRank) return null;
  let best: { transition: JiraIssueTransition; rank: number } | null = null;
  for (const transition of transitions) {
    const rank = jiraStatusForwardRank(transition.toStatusName);
    if (rank == null || rank <= 0 || rank >= currentRank || rank >= targetRank) continue;
    if (visited.has(statusKey(transition.toStatusName))) continue;
    if (!best || rank > best.rank) best = { transition, rank };
  }
  return best?.transition ?? null;
};

/**
 * Push planner status to Jira by transitioning the parent issue to that status name.
 * When the workflow has no direct transition, steps forward one status at a time
 * through Ready for Testing, then STAGING → UAT → Ready for Production → Production.
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
  const visited = new Set([statusKey(fromStatus)]);
  for (let step = 0; step < MAX_FORWARD_STEPS; step += 1) {
    const direct = pickTransitionForTargetStatus(transitions, target);
    const next =
      direct ??
      pickForwardStepTransition(transitions, currentStatus, target, visited) ??
      pickReleaseDetourTransition(transitions, currentStatus, target, visited);
    if (!next) break;
    await transitionJiraIssue(credentials, issueKey, next.id);
    currentStatus = next.toStatusName;
    visited.add(statusKey(currentStatus));
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
