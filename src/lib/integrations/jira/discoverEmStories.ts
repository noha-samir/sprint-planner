import { JiraApiError } from "./client";
import { normalizeJiraSiteUrl, type JiraApiCredentials } from "./credentials";
import { publicJiraErrorMessage } from "./jiraErrors";
import { parseJiraIssueKey } from "./issueKey";
import { jqlFieldRef, quoteJql, searchJqlIssues } from "./jiraSearch";
import type { SquadJiraConfig } from "./types";
import { searchJiraUsers } from "./userSearch";
import { STANDALONE_TASK_ISSUE_TYPES } from "./issueTypes";

export const EM_STORY_DISCOVERY_LIMIT = 200;

/** Open engineering statuses imported from closed sprints (not Done / Production / In Design). */
export const EM_CARRYOVER_OPEN_STATUSES = [
  "To Do",
  "In Progress",
  "Blocked",
  "Ready for Review",
  "Initial Review",
  "Final Review",
  "Ready for Testing",
  "Testing",
  "Pending Bug Fixes",
  "UAT",
  "STAGING",
  "Ready for Production",
] as const;

const emCarryoverOpenStatusClause = (): string =>
  `status in (${EM_CARRYOVER_OPEN_STATUSES.map((status) => quoteJql(status)).join(", ")})`;

/**
 * Current open sprint, or leftover open work from closed sprints.
 * Backlog (no sprint) and finished/design statuses on old sprints are excluded.
 */
export const emSprintAwareStoryClause = (): string =>
  `(sprint in openSprints() OR (sprint in closedSprints() AND ${emCarryoverOpenStatusClause()}))`;

export interface DiscoveredEmStory {
  key: string;
  summary: string;
  storyLink: string;
  issueType?: string;
  assigneeAccountId?: string | null;
  estimateSeconds?: number | null;
}

export interface DiscoverEmStoriesResult {
  stories: DiscoveredEmStory[];
  truncated: boolean;
  warning: string | null;
  jql: string | null;
}

export interface EmStoryDiscoveryInput {
  projectKey: string;
  squadFieldId: string;
  squadOptionId: string;
}

/**
 * Unique uppercase Jira keys already present on the dashboard (from story links).
 */
export const existingIssueKeySet = (storyLinks: string[]): Set<string> => {
  const keys = new Set<string>();
  for (const link of storyLinks) {
    const key = parseJiraIssueKey(link);
    if (key) keys.add(key);
  }
  return keys;
};

export const EM_DISCOVERY_CONFIG_WARNING =
  "Set Squad field + Squad option under People → Jira fields before Pull can add missing stories. Squad identity comes from User Management EM email for EM-story badges (assignee match), not a Jira EM custom field.";

/**
 * Build JQL for parent stories owned by this squad (not subtasks or epics).
 * Limited to the current open sprint, plus unfinished stories from closed sprints.
 */
export const buildEmStoryDiscoveryJql = (input: EmStoryDiscoveryInput): string | null => {
  const projectKey = input.projectKey.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]+$/.test(projectKey)) {
    return null;
  }

  const squadField = jqlFieldRef(input.squadFieldId);
  const squadOptionId = input.squadOptionId.trim();
  const squadClause =
    squadField && squadOptionId ? `${squadField} = ${quoteJql(squadOptionId)}` : null;

  if (!squadClause) {
    return null;
  }

  return [
    `project = ${quoteJql(projectKey)}`,
    "issuetype not in subTaskIssueTypes()",
    "issuetype != Epic",
    "status != Discoped",
    emSprintAwareStoryClause(),
    squadClause,
  ].join(" AND ") + " ORDER BY key ASC";
};

const storyLinkForKey = (siteUrl: string, key: string): string =>
  `${normalizeJiraSiteUrl(siteUrl) || "https://atlassian.net"}/browse/${key}`;

const DISCOVERY_SEARCH_FIELDS = ["summary", "issuetype", "assignee", "timeoriginalestimate", "parent"];

/**
 * Search Jira for parent stories under this squad in the current sprint or leftover open
 * from closed sprints, skipping keys already on the dashboard.
 */
export const discoverEmStoriesFromJira = async (
  credentials: JiraApiCredentials,
  config: SquadJiraConfig,
  existingKeys: Set<string>,
): Promise<DiscoverEmStoriesResult> => {
  const jql = buildEmStoryDiscoveryJql({
    projectKey: config.projectKey,
    squadFieldId: config.subtaskSquadFieldId,
    squadOptionId: config.subtaskSquadOptionId,
  });
  if (!jql) {
    return {
      stories: [],
      truncated: false,
      warning: EM_DISCOVERY_CONFIG_WARNING,
      jql: null,
    };
  }

  const searched = await searchJqlIssues(credentials, jql, 100, {
    fields: DISCOVERY_SEARCH_FIELDS,
    maxIssues: EM_STORY_DISCOVERY_LIMIT + 1,
  });
  if (!searched) {
    throw new JiraApiError(
      publicJiraErrorMessage(400, "Failed to search Jira for stories under this squad"),
      400,
    );
  }

  const stories: DiscoveredEmStory[] = [];
  const seen = new Set<string>();
  for (const issue of searched) {
    const key = issue.key?.trim().toUpperCase();
    if (!key || seen.has(key) || existingKeys.has(key)) continue;
    if (issue.fields?.issuetype?.subtask) continue;
    seen.add(key);
    stories.push({
      key,
      summary: issue.fields?.summary?.trim() || key,
      storyLink: storyLinkForKey(credentials.siteUrl, key),
      issueType: issue.fields?.issuetype?.name ?? undefined,
      assigneeAccountId: issue.fields?.assignee?.accountId ?? null,
      estimateSeconds: issue.fields?.timeoriginalestimate ?? null,
    });
    if (stories.length >= EM_STORY_DISCOVERY_LIMIT) {
      break;
    }
  }

  return {
    stories,
    truncated: searched.length > EM_STORY_DISCOVERY_LIMIT,
    warning: null,
    jql,
  };
};

export { STANDALONE_TASK_ISSUE_TYPES };

/**
 * Build JQL for standalone bugs/tasks/technical tasks owned by this squad.
 * Same sprint/status filters and required Squad config as story discovery.
 */
export const buildStandaloneTaskDiscoveryJql = (input: EmStoryDiscoveryInput): string | null => {
  const projectKey = input.projectKey.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]+$/.test(projectKey)) {
    return null;
  }

  const squadField = jqlFieldRef(input.squadFieldId);
  const squadOptionId = input.squadOptionId.trim();
  const squadClause =
    squadField && squadOptionId ? `${squadField} = ${quoteJql(squadOptionId)}` : null;

  if (!squadClause) {
    return null;
  }

  const typeList = STANDALONE_TASK_ISSUE_TYPES.map((t) => quoteJql(t)).join(", ");
  return [
    `project = ${quoteJql(projectKey)}`,
    `issuetype in (${typeList})`,
    "issuetype not in subTaskIssueTypes()",
    "status != Discoped",
    emSprintAwareStoryClause(),
    squadClause,
  ].join(" AND ") + " ORDER BY key ASC";
};

/**
 * Search Jira for standalone bugs/tasks/technical tasks for this squad,
 * skipping keys already on the dashboard.
 */
export const discoverStandaloneTasksFromJira = async (
  credentials: JiraApiCredentials,
  config: SquadJiraConfig,
  existingKeys: Set<string>,
): Promise<DiscoveredEmStory[]> => {
  const jql = buildStandaloneTaskDiscoveryJql({
    projectKey: config.projectKey,
    squadFieldId: config.subtaskSquadFieldId,
    squadOptionId: config.subtaskSquadOptionId,
  });
  if (!jql) return [];

  const searched = await searchJqlIssues(credentials, jql, 100, {
    fields: DISCOVERY_SEARCH_FIELDS,
    maxIssues: EM_STORY_DISCOVERY_LIMIT + 1,
  });
  if (!searched) return [];

  const tasks: DiscoveredEmStory[] = [];
  const seen = new Set<string>();
  for (const issue of searched) {
    const key = issue.key?.trim().toUpperCase();
    if (!key || seen.has(key) || existingKeys.has(key)) continue;
    if (issue.fields?.issuetype?.subtask) continue;
    seen.add(key);
    tasks.push({
      key,
      summary: issue.fields?.summary?.trim() || key,
      storyLink: storyLinkForKey(credentials.siteUrl, key),
      issueType: issue.fields?.issuetype?.name ?? undefined,
      assigneeAccountId: issue.fields?.assignee?.accountId ?? null,
      estimateSeconds: issue.fields?.timeoriginalestimate ?? null,
    });
    if (tasks.length >= EM_STORY_DISCOVERY_LIMIT) break;
  }
  return tasks;
};

/**
 * Resolve the squad EM's Jira account id from the squad EM email.
 */
export const resolveEmJiraAccountId = async (
  credentials: JiraApiCredentials,
  emEmail: string,
): Promise<string | null> => {
  const email = emEmail.trim().toLowerCase();
  if (!email) return null;
  const users = await searchJiraUsers(credentials, email);
  return users[0]?.accountId?.trim() || null;
};
