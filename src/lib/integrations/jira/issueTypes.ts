/** Jira issue types treated as standalone tasks (not stories, not epics, not subtasks). */
export const STANDALONE_TASK_ISSUE_TYPES = ["Bug", "Task", "Technical Task"] as const;

/** Fixed Type-filter options (same idea as status list — always available without a pull). */
export const PLANNER_ISSUE_TYPES = ["Story", "Bug", "Task", "Technical Task"] as const;

export type PlannerIssueType = (typeof PLANNER_ISSUE_TYPES)[number];

/** Default when a planner row has no Jira issue type yet. */
export const DEFAULT_PLANNER_ISSUE_TYPE: PlannerIssueType = "Story";
