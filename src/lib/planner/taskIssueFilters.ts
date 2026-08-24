import { STANDALONE_TASK_ISSUE_TYPES } from "@/lib/integrations/jira/issueTypes";
import type { Task } from "@/lib/scheduler/types";

const standaloneTypeSet = new Set(
  STANDALONE_TASK_ISSUE_TYPES.map((type) => type.toLowerCase()),
);

/** True for bugs, tasks, technical tasks, and other non-story top-level Jira issues. */
export function isStandaloneIssueType(issueType?: string | null): boolean {
  const normalized = issueType?.trim().toLowerCase() ?? "";
  if (!normalized) return false;
  if (normalized === "story" || normalized === "epic") return false;
  if (standaloneTypeSet.has(normalized)) return true;
  return !normalized.includes("sub-task") && !normalized.includes("subtask");
}

/** Standalone planner rows: bugs/tasks/technical tasks without a parent story, or manual rows with no link. */
export function isParentlessPlannerTask(task: Pick<Task, "issueType" | "storyLink">): boolean {
  if (isStandaloneIssueType(task.issueType)) return true;
  return !task.storyLink?.trim();
}
