import type { JiraApiCredentials } from "./credentials";
import { buildJiraBasicAuthHeader, jiraRestApiBase } from "./credentials";

export type SearchJqlIssue = {
  key?: string;
  fields?: {
    summary?: string;
    issuetype?: { name?: string; subtask?: boolean };
    assignee?: { accountId?: string; displayName?: string } | null;
    timeoriginalestimate?: number | null;
    parent?: { key?: string } | null;
    [customField: string]: unknown;
  };
};

type SearchJqlBody = {
  issues?: SearchJqlIssue[];
  nextPageToken?: string;
};

export const quoteJql = (value: string): string => `"${value.replace(/"/g, '\\"')}"`;

const jiraFetch = async (
  credentials: JiraApiCredentials,
  path: string,
  init?: RequestInit,
): Promise<Response> =>
  fetch(`${jiraRestApiBase(credentials.siteUrl)}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: buildJiraBasicAuthHeader(credentials),
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    body: init?.body,
    cache: "no-store",
  });

/**
 * Paginated POST /search/jql. Returns null when the first page fails.
 */
export const searchJqlIssues = async (
  credentials: JiraApiCredentials,
  jql: string,
  maxResults: number,
  options?: { fields?: string[]; maxIssues?: number },
): Promise<SearchJqlIssue[] | null> => {
  const fields = options?.fields?.length ? options.fields : ["summary"];
  const maxIssues = options?.maxIssues;
  const issues: SearchJqlIssue[] = [];
  let nextPageToken: string | undefined;
  do {
    const payload: Record<string, unknown> = {
      jql,
      maxResults,
      fields,
    };
    if (nextPageToken) {
      payload.nextPageToken = nextPageToken;
    }
    const response = await jiraFetch(credentials, "/search/jql", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      await response.text().catch(() => "");
      return issues.length > 0 ? issues : null;
    }
    const body = (await response.json()) as SearchJqlBody;
    issues.push(...(body.issues ?? []));
    if (maxIssues != null && issues.length >= maxIssues) {
      return issues.slice(0, maxIssues);
    }
    nextPageToken = body.nextPageToken?.trim() || undefined;
  } while (nextPageToken);
  return issues;
};

/**
 * JQL field token from a customfield id, numeric id, or quoted field name.
 */
export const jqlFieldRef = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const custom = trimmed.match(/^customfield_(\d+)$/i);
  if (custom) return `cf[${custom[1]}]`;
  if (/^\d+$/.test(trimmed)) return `cf[${trimmed}]`;
  if (/^cf\[\d+\]$/i.test(trimmed)) return trimmed;
  if (/^[A-Za-z][\w ]*$/.test(trimmed)) return quoteJql(trimmed);
  return null;
};
