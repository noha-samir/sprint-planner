import type { JiraApiCredentials } from "./credentials";
import {
  getJiraIssueStatusName,
  listJiraIssueTransitions,
  transitionJiraIssue,
} from "./client";
import { isSameJiraStatus, pickTransitionForTargetStatus } from "./statusMap";

export type SyncIssueStatusResult = {
  changed: boolean;
  fromStatus: string;
  toStatus: string | null;
  warning?: string;
};

/**
 * Push planner status to Jira by transitioning the parent issue to that status name.
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

  const currentStatus = await getJiraIssueStatusName(credentials, issueKey);
  if (isSameJiraStatus(currentStatus, target)) {
    return { changed: false, fromStatus: currentStatus, toStatus: currentStatus };
  }

  const transitions = await listJiraIssueTransitions(credentials, issueKey);
  const match = pickTransitionForTargetStatus(transitions, target);
  if (!match) {
    const available = transitions.map((item) => item.toStatusName).join(", ") || "none";
    return {
      changed: false,
      fromStatus: currentStatus,
      toStatus: null,
      warning:
        `Could not move ${issueKey} from "${currentStatus}" to "${target}". ` +
        `Available from here: ${available}`,
    };
  }

  await transitionJiraIssue(credentials, issueKey, match.id);
  return {
    changed: true,
    fromStatus: currentStatus,
    toStatus: match.toStatusName,
  };
};
