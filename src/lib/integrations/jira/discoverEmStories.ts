import { JiraApiError } from "./client";
import { normalizeJiraSiteUrl, type JiraApiCredentials } from "./credentials";
import { publicJiraErrorMessage } from "./jiraErrors";
import { parseJiraIssueKey } from "./issueKey";
import { jqlFieldRef, quoteJql, searchJqlIssues, type SearchJqlIssue } from "./jiraSearch";
import type { SquadJiraConfig } from "./types";
import { searchJiraUsers } from "./userSearch";
import { STANDALONE_TASK_ISSUE_TYPES } from "./issueTypes";

export const EM_STORY_DISCOVERY_LIMIT = 200;

/** Open engineering statuses imported from closed sprints and from the EM backlog (not Done / Production / In Design). */
export const EM_CARRYOVER_OPEN_STATUSES = [
  "Ready for Development",
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
 * Finished and design statuses on old sprints are excluded.
 * A story with no sprint is included only when the assignee is the squad EM.
 */
export const emSprintAwareStoryClause = (): string =>
  `(sprint in openSprints() OR (sprint in closedSprints() AND ${emCarryoverOpenStatusClause()}))`;

/**
 * Squad backlog assigned to the EM: no sprint, still in an open engineering status.
 * @param emAccountId - Jira account id of the squad EM.
 * @returns The JQL piece, or null when the account id is missing.
 */
export const emAssignedBacklogClause = (emAccountId: string | null | undefined): string | null => {
  const accountId = emAccountId?.trim();
  if (!accountId) return null;
  return `(sprint is EMPTY AND assignee = ${quoteJql(accountId)} AND ${emCarryoverOpenStatusClause()})`;
};

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
  emAccountId?: string | null;
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
 * Shared project, type, and squad pieces for a discovery search.
 * @param input - Project key and Squad field config.
 * @param typeClauses - Issue-type limits for stories or standalone tasks.
 * @returns The clauses, or null when project or Squad config is missing.
 */
const discoveryBaseClauses = (input: EmStoryDiscoveryInput, typeClauses: string[]): string[] | null => {
  const projectKey = input.projectKey.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]+$/.test(projectKey)) {
    return null;
  }

  const squadField = jqlFieldRef(input.squadFieldId);
  const squadOptionId = input.squadOptionId.trim();
  const squadClause =
    squadField && squadOptionId ? `${squadField} = ${quoteJql(squadOptionId)}` : null;
  if (!squadClause) return null;

  return [`project = ${quoteJql(projectKey)}`, ...typeClauses, "status != Discoped", squadClause];
};

/**
 * Build JQL for parent stories owned by this squad (not subtasks or epics).
 * Limited to the current open sprint, plus unfinished stories from closed sprints.
 */
export const buildEmStoryDiscoveryJql = (input: EmStoryDiscoveryInput): string | null => {
  const clauses = discoveryBaseClauses(input, [
    "issuetype not in subTaskIssueTypes()",
    "issuetype != Epic",
  ]);
  if (!clauses) return null;
  clauses.splice(clauses.length - 1, 0, emSprintAwareStoryClause());
  return clauses.join(" AND ") + " ORDER BY key ASC";
};

/**
 * Build JQL for this squad's stories that have no sprint and are assigned to the EM.
 * @param input - Project, Squad field, and the EM account id.
 * @returns JQL, or null when Squad config or the EM account is missing.
 */
export const buildEmAssignedBacklogJql = (input: EmStoryDiscoveryInput): string | null => {
  const backlog = emAssignedBacklogClause(input.emAccountId);
  if (!backlog) return null;
  const clauses = discoveryBaseClauses(input, [
    "issuetype not in subTaskIssueTypes()",
    "issuetype != Epic",
  ]);
  if (!clauses) return null;
  clauses.splice(clauses.length - 1, 0, backlog);
  return clauses.join(" AND ") + " ORDER BY key ASC";
};

const storyLinkForKey = (siteUrl: string, key: string): string =>
  `${normalizeJiraSiteUrl(siteUrl) || "https://atlassian.net"}/browse/${key}`;

const DISCOVERY_SEARCH_FIELDS = ["summary", "issuetype", "assignee", "timeoriginalestimate", "parent"];

const discoveryInput = (config: SquadJiraConfig, emAccountId?: string | null): EmStoryDiscoveryInput => ({
  projectKey: config.projectKey,
  squadFieldId: config.subtaskSquadFieldId,
  squadOptionId: config.subtaskSquadOptionId,
  emAccountId,
});

/**
 * Copy new parent issues into the result list.
 * @returns True when Jira returned more issues than the import cap.
 */
const appendDiscoveredIssues = (
  searched: SearchJqlIssue[],
  existingKeys: Set<string>,
  siteUrl: string,
  stories: DiscoveredEmStory[],
  seen: Set<string>,
): boolean => {
  for (const issue of searched) {
    const key = issue.key?.trim().toUpperCase();
    if (!key || seen.has(key) || existingKeys.has(key)) continue;
    if (issue.fields?.issuetype?.subtask) continue;
    seen.add(key);
    stories.push({
      key,
      summary: issue.fields?.summary?.trim() || key,
      storyLink: storyLinkForKey(siteUrl, key),
      issueType: issue.fields?.issuetype?.name ?? undefined,
      assigneeAccountId: issue.fields?.assignee?.accountId ?? null,
      estimateSeconds: issue.fields?.timeoriginalestimate ?? null,
    });
    if (stories.length >= EM_STORY_DISCOVERY_LIMIT) break;
  }
  return searched.length > EM_STORY_DISCOVERY_LIMIT;
};

const searchDiscoveredIssues = async (
  credentials: JiraApiCredentials,
  jql: string,
): Promise<SearchJqlIssue[] | null> =>
  searchJqlIssues(credentials, jql, 100, {
    fields: DISCOVERY_SEARCH_FIELDS,
    maxIssues: EM_STORY_DISCOVERY_LIMIT + 1,
  });

/**
 * Search Jira for parent stories under this squad in the current sprint or leftover open
 * from closed sprints, plus squad stories with no sprint that are assigned to the EM.
 * Keys already on the dashboard are skipped.
 * @param emAccountId - Squad EM account. When missing, the no-sprint search is skipped.
 */
export const discoverEmStoriesFromJira = async (
  credentials: JiraApiCredentials,
  config: SquadJiraConfig,
  existingKeys: Set<string>,
  emAccountId?: string | null,
): Promise<DiscoverEmStoriesResult> => {
  const input = discoveryInput(config, emAccountId);
  const jql = buildEmStoryDiscoveryJql(input);
  if (!jql) {
    return {
      stories: [],
      truncated: false,
      warning: EM_DISCOVERY_CONFIG_WARNING,
      jql: null,
    };
  }

  const searched = await searchDiscoveredIssues(credentials, jql);
  if (!searched) {
    throw new JiraApiError(
      publicJiraErrorMessage(400, "Failed to search Jira for stories under this squad"),
      400,
    );
  }

  const stories: DiscoveredEmStory[] = [];
  const seen = new Set<string>();
  let truncated = appendDiscoveredIssues(searched, existingKeys, credentials.siteUrl, stories, seen);

  const backlogJql = buildEmAssignedBacklogJql(input);
  if (backlogJql && stories.length < EM_STORY_DISCOVERY_LIMIT) {
    const backlog = await searchDiscoveredIssues(credentials, backlogJql);
    if (backlog) {
      truncated = appendDiscoveredIssues(backlog, existingKeys, credentials.siteUrl, stories, seen) || truncated;
    }
  }

  return {
    stories,
    truncated,
    warning: null,
    jql,
  };
};

export { STANDALONE_TASK_ISSUE_TYPES };

const standaloneTypeClauses = (): string[] => {
  const typeList = STANDALONE_TASK_ISSUE_TYPES.map((t) => quoteJql(t)).join(", ");
  return [`issuetype in (${typeList})`, "issuetype not in subTaskIssueTypes()"];
};

/**
 * Build JQL for standalone bugs/tasks/technical tasks owned by this squad.
 * Same sprint/status filters and required Squad config as story discovery.
 */
export const buildStandaloneTaskDiscoveryJql = (input: EmStoryDiscoveryInput): string | null => {
  const clauses = discoveryBaseClauses(input, standaloneTypeClauses());
  if (!clauses) return null;
  clauses.splice(clauses.length - 1, 0, emSprintAwareStoryClause());
  return clauses.join(" AND ") + " ORDER BY key ASC";
};

/**
 * Build JQL for this squad's bugs and tasks that have no sprint and are assigned to the EM.
 * @param input - Project, Squad field, and the EM account id.
 * @returns JQL, or null when Squad config or the EM account is missing.
 */
export const buildStandaloneAssignedBacklogJql = (input: EmStoryDiscoveryInput): string | null => {
  const backlog = emAssignedBacklogClause(input.emAccountId);
  if (!backlog) return null;
  const clauses = discoveryBaseClauses(input, standaloneTypeClauses());
  if (!clauses) return null;
  clauses.splice(clauses.length - 1, 0, backlog);
  return clauses.join(" AND ") + " ORDER BY key ASC";
};

/**
 * Search Jira for standalone bugs/tasks/technical tasks for this squad,
 * including ones with no sprint when they are assigned to the EM.
 * @param emAccountId - Squad EM account. When missing, the no-sprint search is skipped.
 */
export const discoverStandaloneTasksFromJira = async (
  credentials: JiraApiCredentials,
  config: SquadJiraConfig,
  existingKeys: Set<string>,
  emAccountId?: string | null,
): Promise<DiscoveredEmStory[]> => {
  const input = discoveryInput(config, emAccountId);
  const jql = buildStandaloneTaskDiscoveryJql(input);
  if (!jql) return [];

  const searched = await searchDiscoveredIssues(credentials, jql);
  if (!searched) return [];

  const tasks: DiscoveredEmStory[] = [];
  const seen = new Set<string>();
  appendDiscoveredIssues(searched, existingKeys, credentials.siteUrl, tasks, seen);

  const backlogJql = buildStandaloneAssignedBacklogJql(input);
  if (backlogJql && tasks.length < EM_STORY_DISCOVERY_LIMIT) {
    const backlog = await searchDiscoveredIssues(credentials, backlogJql);
    if (backlog) {
      appendDiscoveredIssues(backlog, existingKeys, credentials.siteUrl, tasks, seen);
    }
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
