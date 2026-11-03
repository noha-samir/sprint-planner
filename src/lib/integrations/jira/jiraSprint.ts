import type { Task } from "@/lib/scheduler/types";
import { isJiraStoryLink, parseJiraIssueKey } from "./issueKey";

export type JiraSprintState = "active" | "future" | "closed" | "none";

export type JiraSprintFilter = "open" | "none" | "all";

export type StoredJiraSprint = {
  jiraSprintId: number | null;
  jiraSprintName: string | null;
  jiraSprintState: JiraSprintState;
};

type AgileSprint = {
  id?: number;
  name?: string;
  state?: string;
};

const SPRINT_STATES = new Set<JiraSprintState>(["active", "future", "closed", "none"]);

/**
 * Parse a stored or API sprint state.
 * @param value - Raw state string.
 * @returns A known state, or null when the value is missing or unknown.
 */
export const parseJiraSprintState = (value: unknown): JiraSprintState | null => {
  if (typeof value !== "string") return null;
  const state = value.trim().toLowerCase();
  return SPRINT_STATES.has(state as JiraSprintState) ? (state as JiraSprintState) : null;
};

const sprintName = (sprint: AgileSprint | undefined): string | null => {
  const name = sprint?.name?.trim();
  return name ? name : null;
};

const sprintId = (sprint: AgileSprint | undefined): number | null =>
  typeof sprint?.id === "number" && Number.isFinite(sprint.id) ? sprint.id : null;

/**
 * Map a Jira Agile issue payload to the sprint we store.
 * An active or future sprint wins. Otherwise the latest closed sprint is stored.
 * No sprint at all is `none`.
 * @param body - Agile issue JSON (`fields.sprint` and `fields.closedSprints`).
 */
export const jiraSprintFromAgileIssue = (body: {
  fields?: { sprint?: AgileSprint | null; closedSprints?: AgileSprint[] | null };
}): StoredJiraSprint => {
  const current = body.fields?.sprint ?? undefined;
  const currentState = parseJiraSprintState(current?.state);
  if (current && (currentState === "active" || currentState === "future")) {
    return {
      jiraSprintId: sprintId(current),
      jiraSprintName: sprintName(current),
      jiraSprintState: currentState,
    };
  }

  const closed = (body.fields?.closedSprints ?? []).filter((sprint) => sprint && typeof sprint === "object");
  if (closed.length > 0 || currentState === "closed") {
    const last = closed[closed.length - 1] ?? current;
    return {
      jiraSprintId: sprintId(last),
      jiraSprintName: sprintName(last),
      jiraSprintState: "closed",
    };
  }

  return { jiraSprintId: null, jiraSprintName: null, jiraSprintState: "none" };
};

/**
 * Whether a dashboard row matches the Jira sprint filter.
 * Open is the active sprint only. No sprint is a missing Jira link or a confirmed backlog issue.
 * A linked story whose sprint has not been read yet matches All only.
 * @param task - Story with its stored sprint.
 * @param filter - Toolbar choice.
 */
export const taskMatchesJiraSprintFilter = (
  task: Pick<Task, "storyLink" | "jiraSprintState">,
  filter: JiraSprintFilter,
): boolean => {
  if (filter === "all") return true;
  if (filter === "open") return task.jiraSprintState === "active";
  if (!isJiraStoryLink(task.storyLink ?? "")) return true;
  return task.jiraSprintState === "none";
};

export type OpenJiraSprint = {
  jiraSprintId: number;
  jiraSprintName: string;
};

/**
 * Active sprints from the rows Jira returned, one entry per sprint id.
 * @param sprints - Sprint rows from one or more boards.
 * @returns Open sprints, sorted by name.
 */
/**
 * Open sprints already stored on the board, busiest first.
 * @param tasks - Dashboard stories.
 * @returns One entry per active sprint id.
 */
export const listBoardOpenSprints = (
  tasks: Array<Pick<Task, "jiraSprintId" | "jiraSprintName" | "jiraSprintState">>,
): OpenJiraSprint[] => {
  const counts = new Map<number, { name: string; count: number }>();
  for (const task of tasks) {
    if (task.jiraSprintState !== "active") continue;
    const id = task.jiraSprintId;
    if (typeof id !== "number" || !Number.isFinite(id)) continue;
    const name = task.jiraSprintName?.trim() || `Sprint ${id}`;
    const existing = counts.get(id);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(id, { name, count: 1 });
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1].count - left[1].count || left[1].name.localeCompare(right[1].name))
    .map(([jiraSprintId, value]) => ({ jiraSprintId, jiraSprintName: value.name }));
};

export const listActiveJiraSprints = (
  sprints: Array<{ id?: number; name?: string; state?: string }>,
): OpenJiraSprint[] => {
  const byId = new Map<number, string>();
  for (const sprint of sprints) {
    if (parseJiraSprintState(sprint.state) !== "active") continue;
    if (typeof sprint.id !== "number" || !Number.isFinite(sprint.id)) continue;
    const name = sprint.name?.trim();
    if (!byId.has(sprint.id)) byId.set(sprint.id, name || `Sprint ${sprint.id}`);
  }
  return [...byId.entries()]
    .map(([jiraSprintId, jiraSprintName]) => ({ jiraSprintId, jiraSprintName }))
    .sort((a, b) => a.jiraSprintName.localeCompare(b.jiraSprintName));
};

/**
 * Stories that can be placed on the open Jira sprint: a Jira key, and not already in an active sprint.
 * @param tasks - Selected stories.
 * @returns Eligible rows and the ones to skip, with a reason.
 */
export const partitionJiraSprintAdd = (
  tasks: Array<Pick<Task, "id" | "storyName" | "storyLink" | "jiraSprintState">>,
): {
  eligible: Array<{ taskId: string; storyName: string; issueKey: string }>;
  skipped: Array<{ taskId: string; storyName: string; reason: string }>;
} => {
  const eligible: Array<{ taskId: string; storyName: string; issueKey: string }> = [];
  const skipped: Array<{ taskId: string; storyName: string; reason: string }> = [];
  for (const task of tasks) {
    const storyName = task.storyName?.trim() || task.id;
    const issueKey = parseJiraIssueKey(task.storyLink ?? "");
    if (!issueKey) {
      skipped.push({ taskId: task.id, storyName, reason: "No Jira link" });
      continue;
    }
    if (task.jiraSprintState === "active") {
      skipped.push({ taskId: task.id, storyName, reason: "Already in the open Jira sprint" });
      continue;
    }
    eligible.push({ taskId: task.id, storyName, issueKey });
  }
  return { eligible, skipped };
};

/**
 * Stories that can be taken out of a Jira sprint: a Jira key plus an active or future sprint.
 * @param tasks - Selected stories.
 * @returns Eligible rows and the ones to skip, with a reason.
 */
export const partitionJiraSprintClear = (
  tasks: Array<Pick<Task, "id" | "storyName" | "storyLink" | "jiraSprintState">>,
): {
  eligible: Array<{ taskId: string; storyName: string; issueKey: string }>;
  skipped: Array<{ taskId: string; storyName: string; reason: string }>;
} => {
  const eligible: Array<{ taskId: string; storyName: string; issueKey: string }> = [];
  const skipped: Array<{ taskId: string; storyName: string; reason: string }> = [];
  for (const task of tasks) {
    const storyName = task.storyName?.trim() || task.id;
    const issueKey = parseJiraIssueKey(task.storyLink ?? "");
    if (!issueKey) {
      skipped.push({ taskId: task.id, storyName, reason: "No Jira link" });
      continue;
    }
    if (task.jiraSprintState === "active" || task.jiraSprintState === "future") {
      eligible.push({ taskId: task.id, storyName, issueKey });
      continue;
    }
    if (task.jiraSprintState === "closed") {
      skipped.push({ taskId: task.id, storyName, reason: "Only in a closed sprint" });
      continue;
    }
    if (task.jiraSprintState === "none") {
      skipped.push({ taskId: task.id, storyName, reason: "Already has no Jira sprint" });
      continue;
    }
    skipped.push({ taskId: task.id, storyName, reason: "Jira sprint has not been read yet — pull first" });
  }
  return { eligible, skipped };
};

