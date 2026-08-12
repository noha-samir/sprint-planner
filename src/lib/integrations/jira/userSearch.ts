import type { JiraApiCredentials } from "./credentials";
import { JiraApiError } from "./client";
import { publicJiraErrorMessage } from "./jiraErrors";
import { buildJiraBasicAuthHeader, jiraRestApiBase } from "./credentials";

export interface JiraUserRef {
  accountId: string;
  displayName: string;
}

export interface ResolvePlannerAccountResult {
  accountId: string | null;
  candidates: JiraUserRef[];
}

/**
 * Fetch a single Jira user by account id (for renaming mapped resources to displayName).
 */
export const fetchJiraUserByAccountId = async (
  credentials: JiraApiCredentials,
  accountId: string,
): Promise<JiraUserRef | null> => {
  const id = accountId.trim();
  if (!id) return null;

  const response = await fetch(
    `${jiraRestApiBase(credentials.siteUrl)}/user?accountId=${encodeURIComponent(id)}`,
    {
      headers: {
        Authorization: buildJiraBasicAuthHeader(credentials),
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    await response.text().catch(() => "");
    if (response.status === 404) return null;
    throw new JiraApiError(
      publicJiraErrorMessage(response.status, "Failed to load Jira user"),
      response.status,
    );
  }

  const body = (await response.json()) as {
    accountId?: string;
    displayName?: string;
    active?: boolean;
  };
  const resolvedId = body.accountId?.trim();
  if (!resolvedId || body.active === false) return null;
  return {
    accountId: resolvedId,
    displayName: body.displayName?.trim() || resolvedId,
  };
};

/**
 * Search assignable Jira users by planner resource name.
 */
export const searchJiraUsers = async (
  credentials: JiraApiCredentials,
  query: string,
): Promise<JiraUserRef[]> => {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const response = await fetch(
    `${jiraRestApiBase(credentials.siteUrl)}/user/search?query=${encodeURIComponent(trimmed)}&maxResults=50`,
    {
      headers: {
        Authorization: buildJiraBasicAuthHeader(credentials),
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    await response.text().catch(() => "");
    throw new JiraApiError(
      publicJiraErrorMessage(response.status, `Failed to search Jira users for "${trimmed}"`),
      response.status,
    );
  }

  const body = (await response.json()) as Array<{
    accountId?: string;
    displayName?: string;
    active?: boolean;
  }>;
  return body
    .filter((user) => user.accountId?.trim() && user.active !== false)
    .map((user) => ({
      accountId: user.accountId!.trim(),
      displayName: user.displayName?.trim() || user.accountId!.trim(),
    }));
};

/**
 * Pick one Jira account for a planner name; returns null when ambiguous or no match.
 */
export const pickJiraAccountIdForPlannerName = (
  plannerName: string,
  users: JiraUserRef[],
): string | null => {
  const trimmed = plannerName.trim();
  if (!trimmed || users.length === 0) {
    return null;
  }
  if (users.length === 1) {
    return users[0].accountId;
  }

  const lower = trimmed.toLowerCase();
  const exact = users.find((user) => user.displayName.toLowerCase() === lower);
  if (exact) {
    return exact.accountId;
  }

  const wordMatches = users.filter((user) =>
    user.displayName
      .toLowerCase()
      .split(/\s+/)
      .some((part) => part === lower),
  );
  if (wordMatches.length === 1) {
    return wordMatches[0].accountId;
  }
  if (wordMatches.length > 1) {
    return null;
  }

  const contains = users.filter((user) => user.displayName.toLowerCase().includes(lower));
  if (contains.length === 1) {
    return contains[0].accountId;
  }

  return null;
};

/**
 * Resolve planner resource name to a Jira accountId via user search.
 * Optional nickname is tried when the primary name is missing or ambiguous.
 */
export const resolveJiraAccountForPlannerName = async (
  credentials: JiraApiCredentials,
  plannerName: string,
  nickname?: string | null,
): Promise<ResolvePlannerAccountResult> => {
  const primary = await searchJiraUsers(credentials, plannerName);
  let accountId = pickJiraAccountIdForPlannerName(plannerName, primary);
  let candidates = primary;

  const nick = nickname?.trim() ?? "";
  if (!accountId && nick && nick.toLowerCase() !== plannerName.trim().toLowerCase()) {
    const byNick = await searchJiraUsers(credentials, nick);
    const nickPick = pickJiraAccountIdForPlannerName(nick, byNick);
    if (nickPick) {
      return { accountId: nickPick, candidates: byNick };
    }
    if (byNick.length > 0) {
      const merged = new Map<string, JiraUserRef>();
      for (const user of [...primary, ...byNick]) {
        merged.set(user.accountId, user);
      }
      candidates = [...merged.values()];
      accountId = pickJiraAccountIdForPlannerName(plannerName, candidates);
    }
  }

  return { accountId, candidates };
};

/**
 * Resolve planner resource name to a Jira accountId via user search.
 */
export const resolveJiraAccountIdForPlannerName = async (
  credentials: JiraApiCredentials,
  plannerName: string,
  nickname?: string | null,
): Promise<string | null> => {
  const result = await resolveJiraAccountForPlannerName(credentials, plannerName, nickname);
  return result.accountId;
};

/** Warning text when a planner name is not mapped / not found in Jira. */
export const describeUnresolvedPlannerName = (plannerName: string, users: JiraUserRef[]): string => {
  const name = plannerName.trim();
  if (users.length === 0) {
    return `No Jira account found for "${name}"`;
  }
  if (!pickJiraAccountIdForPlannerName(name, users)) {
    return `Multiple Jira accounts match "${name}" — pick the exact account in Jira Integration`;
  }
  return `No Jira account mapped for "${name}" — sync accounts in Jira Integration`;
};

/**
 * For unmapped planner names, search Jira and return sync warnings.
 */
export const warningsForUnmappedPlannerNames = async (
  credentials: JiraApiCredentials,
  names: string[],
): Promise<string[]> => {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  const warnings: string[] = [];
  for (const name of unique) {
    const users = await searchJiraUsers(credentials, name);
    warnings.push(describeUnresolvedPlannerName(name, users));
  }
  return warnings;
};
