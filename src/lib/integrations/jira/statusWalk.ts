import { isTodoTaskStatus } from "@/lib/scheduler/taskStatus";

/**
 * Forward workflow through release:
 * (Ready for Development / Backlog / …) → To Do → In Progress → Ready for Review →
 * Ready for Testing → Testing → Pending Bug Fixes → STAGING → UAT → Ready for Production → Production.
 * Done, Blocked, and Cancelled are not steps on this path.
 */
const FORWARD_STEP_RANK: Record<string, number> = {
  "to do": 0,
  todo: 0,
  "in progress": 1,
  "ready for review": 2,
  "initial review": 3,
  "final review": 4,
  "ready for testing": 5,
  testing: 6,
  "pending bug fixes": 7,
  staging: 8,
  uat: 9,
  "ready for production": 10,
  production: 11,
};

const PRE_DEVELOPMENT_RANK = -1;

/**
 * Position of a status on the forward workflow.
 * Pre-development statuses (Ready for Development, Backlog, design / discovery) sit one step before To Do,
 * since Jira usually only allows them to move to To Do first.
 * @param status - Planner or Jira status name.
 * @returns Rank, or null when the status is not part of the stepped workflow (Blocked, Done, Cancelled).
 */
export const jiraStatusForwardRank = (status: string): number | null => {
  const value = status.trim().toLowerCase();
  if (value in FORWARD_STEP_RANK) return FORWARD_STEP_RANK[value];
  return isTodoTaskStatus(status) && !value.includes("review") ? PRE_DEVELOPMENT_RANK : null;
};

export type JiraStatusJump = {
  fromStatus: string;
  toStatus: string;
};

/**
 * A push that must walk Jira: the planner status is more than one step ahead of the status Jira last held.
 * @param fromStatus - Status from the last pull or push.
 * @param toStatus - Status the planner will send.
 * @returns The two names, or null when the move is one step, backward, or off the release path.
 */
export const jiraStatusJump = (fromStatus: string, toStatus: string): JiraStatusJump | null => {
  const fromRank = jiraStatusForwardRank(fromStatus);
  const toRank = jiraStatusForwardRank(toStatus);
  if (fromRank == null || toRank == null || toRank - fromRank <= 1) return null;
  return { fromStatus: fromStatus.trim(), toStatus: toStatus.trim() };
};

const MAX_JUMP_STORIES = 12;

/**
 * Confirm text shown before a push that walks Jira through intermediate statuses.
 * @param jumps - Stories whose planner status is more than one step ahead of Jira.
 * @returns The warning, or null when nothing jumps.
 */
export const formatJiraStatusJumpWarning = (
  jumps: Array<{ storyName: string; fromStatus: string; toStatus: string }>,
): string | null => {
  if (jumps.length === 0) return null;
  const shown = jumps.slice(0, MAX_JUMP_STORIES);
  const lines = shown.map((jump) => `• ${jump.storyName} — ${jump.fromStatus} → ${jump.toStatus}`);
  if (jumps.length > shown.length) {
    lines.push(`• and ${jumps.length - shown.length} more`);
  }
  return [
    "Status jump. Jira will be moved through the statuses in between, one request at a time, until it reaches the planner status.",
    "Accept to continue.",
    ...lines,
  ].join("\n");
};
