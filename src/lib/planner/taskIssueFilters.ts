import {
  DEFAULT_PLANNER_ISSUE_TYPE,
  PLANNER_ISSUE_TYPES,
  STANDALONE_TASK_ISSUE_TYPES,
} from "@/lib/integrations/jira/issueTypes";
import type { Task } from "@/lib/scheduler/types";

const standaloneTypeSet = new Set(
  STANDALONE_TASK_ISSUE_TYPES.map((type) => type.toLowerCase()),
);

/** Blank / missing issue types count as Story for display and Type filtering. */
export function effectiveIssueType(issueType?: string | null): string {
  const trimmed = typeof issueType === "string" ? issueType.trim() : "";
  return trimmed || DEFAULT_PLANNER_ISSUE_TYPE;
}

/**
 * Type dropdown options: fixed planner list first, then any extra types already on tasks.
 */
export function buildIssueTypeFilterOptions(taskIssueTypes: Iterable<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const options: string[] = [];

  const push = (raw: string) => {
    const label = raw.trim();
    if (!label) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    options.push(label);
  };

  for (const type of PLANNER_ISSUE_TYPES) {
    push(type);
  }
  for (const type of taskIssueTypes) {
    if (typeof type === "string") {
      push(type);
    }
  }
  return options;
}

/** True when the task’s effective type is in the selected Type filter (empty filter = match all). */
export function taskMatchesIssueTypeFilter(
  task: Pick<Task, "issueType">,
  selectedTypes: string[],
): boolean {
  if (selectedTypes.length === 0) return true;
  const effective = effectiveIssueType(task.issueType);
  return selectedTypes.some((type) => type.trim().toLowerCase() === effective.toLowerCase());
}

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
