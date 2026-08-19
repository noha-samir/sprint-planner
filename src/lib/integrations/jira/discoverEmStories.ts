import { JiraApiError } from "./client";
import { normalizeJiraSiteUrl, type JiraApiCredentials } from "./credentials";
import { publicJiraErrorMessage } from "./jiraErrors";
import { parseJiraIssueKey } from "./issueKey";
import { jqlFieldRef, quoteJql, searchJqlIssues } from "./jiraSearch";
import type { SquadJiraConfig } from "./types";
import { searchJiraUsers } from "./userSearch";

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
}

export interface DiscoverEmStoriesResult {
  stories: DiscoveredEmStory[];
  truncated: boolean;
  warning: string | null;
  jql: string | null;
}

export interface EmStoryDiscoveryInput {
  projectKey: string;
  engineeringManagerFieldId: string;
  emAccountId?: string | null;
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

/**
 * Build JQL for parent stories owned by this EM / squad (not subtasks or epics).
 * Limited to the current open sprint, plus unfinished stories from closed sprints.
 */
export const buildEmStoryDiscoveryJql = (input: EmStoryDiscoveryInput): string | null => {
  const projectKey = input.projectKey.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]+$/.test(projectKey)) {
    return null;
  }

  const emField = jqlFieldRef(input.engineeringManagerFieldId);
  const emAccountId = input.emAccountId?.trim() ?? "";
  let emClause: string | null = null;
  if (emField) {
    const matches = [`${emField} = currentUser()`];
    if (emAccountId) {
      matches.push(`${emField} = ${quoteJql(emAccountId)}`);
    }
    emClause = matches.length === 1 ? matches[0]! : `(${matches.join(" OR ")})`;
  }

  const squadField = jqlFieldRef(input.squadFieldId);
  const squadOptionId = input.squadOptionId.trim();
  const squadClause =
    squadField && squadOptionId ? `${squadField} = ${quoteJql(squadOptionId)}` : null;

  if (!emClause && !squadClause) {
    return null;
  }

  const parts = [
    `project = ${quoteJql(projectKey)}`,
    "issuetype not in subTaskIssueTypes()",
    "issuetype != Epic",
    "status != Discoped",
    emSprintAwareStoryClause(),
  ];
  if (emClause) parts.push(emClause);
  if (squadClause) parts.push(squadClause);
  return `${parts.join(" AND ")} ORDER BY key ASC`;
};

const storyLinkForKey = (siteUrl: string, key: string): string =>
  `${normalizeJiraSiteUrl(siteUrl) || "https://atlassian.net"}/browse/${key}`;

/**
 * Search Jira for parent stories under this EM (and squad when configured)
 * in the current sprint or leftover open from closed sprints,
 * skipping keys already on the dashboard.
 */
export const discoverEmStoriesFromJira = async (
  credentials: JiraApiCredentials,
  config: SquadJiraConfig,
  existingKeys: Set<string>,
  emAccountId?: string | null,
): Promise<DiscoverEmStoriesResult> => {
  const jql = buildEmStoryDiscoveryJql({
    projectKey: config.projectKey,
    engineeringManagerFieldId: config.engineeringManagerFieldId,
    emAccountId,
    squadFieldId: config.subtaskSquadFieldId,
    squadOptionId: config.subtaskSquadOptionId,
  });
  if (!jql) {
    return {
      stories: [],
      truncated: false,
      warning:
        "Set Engineering Manager field (and/or Squad field) under People → Jira fields to import stories that are not on the dashboard.",
      jql: null,
    };
  }

  const searched = await searchJqlIssues(credentials, jql, 100, {
    fields: ["summary", "issuetype"],
    maxIssues: EM_STORY_DISCOVERY_LIMIT + 1,
  });
  if (!searched) {
    throw new JiraApiError(
      publicJiraErrorMessage(400, "Failed to search Jira for stories under this EM"),
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
