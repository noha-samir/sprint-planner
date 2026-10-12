import type { JiraApiCredentials } from "./credentials";
import type { SquadJiraConfig } from "./types";
import { searchJiraUsers, type JiraUserRef } from "./userSearch";

export const MENTION_SUGGESTIONS_MAX = 10;
export const MENTION_JIRA_SEARCH_MIN_CHARS = 2;

/** A person the comment composer can @mention. */
export type MentionSuggestion = JiraUserRef & {
  /** True when the person is on the squad roster (assignee map). */
  onRoster: boolean;
};

/**
 * Roster people (assignee map: planner name → Jira account) whose name contains the query.
 * @param assigneeMap - Squad assignee map.
 * @param query - Text typed after "@" (empty lists the whole roster).
 * @returns Roster suggestions sorted by name.
 */
export const rosterMentionSuggestions = (
  assigneeMap: SquadJiraConfig["assigneeMap"],
  query: string,
): MentionSuggestion[] => {
  const needle = query.trim().toLowerCase();
  return Object.entries(assigneeMap ?? {})
    .filter(([name, accountId]) => name.trim() && accountId?.trim() && name.toLowerCase().includes(needle))
    .map(([name, accountId]) => ({ accountId: accountId.trim(), displayName: name.trim(), onRoster: true }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
};

/**
 * People to suggest for an @mention: squad roster first, then any Jira user (one Jira search, only when the
 * query has at least MENTION_JIRA_SEARCH_MIN_CHARS characters). Deduplicated by account id.
 * A failed Jira search still returns the roster matches; it only throws when there are none.
 * @param credentials - Signed-in user's Jira credentials.
 * @param squadConfig - Squad Jira config (assignee map).
 * @param query - Text typed after "@".
 * @returns Up to MENTION_SUGGESTIONS_MAX suggestions.
 */
export const suggestMentionUsers = async (
  credentials: JiraApiCredentials,
  squadConfig: Pick<SquadJiraConfig, "assigneeMap">,
  query: string,
): Promise<MentionSuggestion[]> => {
  const roster = rosterMentionSuggestions(squadConfig.assigneeMap, query);
  if (roster.length >= MENTION_SUGGESTIONS_MAX || query.trim().length < MENTION_JIRA_SEARCH_MIN_CHARS) {
    return roster.slice(0, MENTION_SUGGESTIONS_MAX);
  }

  let jiraUsers: JiraUserRef[];
  try {
    jiraUsers = await searchJiraUsers(credentials, query);
  } catch (error) {
    if (roster.length > 0) return roster;
    throw error;
  }

  const seen = new Set(roster.map((person) => person.accountId));
  const others: MentionSuggestion[] = [];
  for (const user of jiraUsers) {
    if (seen.has(user.accountId)) continue;
    seen.add(user.accountId);
    others.push({ ...user, onRoster: false });
  }
  return [...roster, ...others].slice(0, MENTION_SUGGESTIONS_MAX);
};
