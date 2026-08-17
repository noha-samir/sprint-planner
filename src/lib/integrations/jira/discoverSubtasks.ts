import type { JiraApiCredentials } from "./credentials";
import { JiraApiError } from "./client";
import { publicJiraErrorMessage } from "./jiraErrors";
import { buildJiraBasicAuthHeader, jiraRestApiBase } from "./credentials";
import { quoteJql, searchJqlIssues, type SearchJqlIssue } from "./jiraSearch";
import type { JiraSubtaskRole, TaskJiraMeta } from "./types";
import { effectiveIosHours } from "@/lib/scheduler/mobilePlatform";

export interface DiscoveredFeBeKeys {
  feKey?: string;
  beKey?: string;
  androidKey?: string;
  iosKey?: string;
}

export type DiscoveredRoleKeys = {
  fe: string[];
  be: string[];
  android: string[];
  ios: string[];
};

interface JiraSubtaskRef {
  key: string;
  summary: string;
}

const SEARCH_PAGE_SIZE = 100;
const KEY_LOOKUP_CHUNK = 40;

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

const refsFromSearchIssues = (issues: SearchJqlIssue[]): JiraSubtaskRef[] => {
  const refs: JiraSubtaskRef[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    const key = issue.key?.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    refs.push({ key, summary: issue.fields?.summary?.trim() ?? "" });
  }
  return refs;
};

/** Map a Jira subtask summary onto a planner role. Legacy [MO] is Android. */
export const roleFromSubtaskSummary = (summary: string): JiraSubtaskRole | null => {
  const value = summary.trim();
  if (/^\[FE\]/i.test(value)) return "fe";
  if (/^\[BE\]/i.test(value)) return "be";
  if (/^\[IOS\]/i.test(value)) return "ios";
  if (/^\[Android\]/i.test(value) || /^\[MO\]/i.test(value)) return "android";
  return null;
};

export const emptyDiscoveredRoleKeys = (): DiscoveredRoleKeys => ({
  fe: [],
  be: [],
  android: [],
  ios: [],
});

/**
 * All [FE]/[BE]/[Android]/[IOS] children under the parent, in Jira order.
 * Parent-scoped lists do not need the story title in the summary.
 */
export const matchAllRoleSubtasksFromSummaries = (children: JiraSubtaskRef[]): DiscoveredRoleKeys => {
  const discovered = emptyDiscoveredRoleKeys();
  for (const child of children) {
    const role = roleFromSubtaskSummary(child.summary);
    if (!role || discovered[role].includes(child.key)) continue;
    discovered[role].push(child.key);
  }
  return discovered;
};

/**
 * First matching [FE]/[BE]/[Android]/[IOS] subtask per role (push discovery).
 * Prefers summaries that include the story title, then any role-prefixed child.
 */
export const matchFeBeSubtasksFromSummaries = (
  children: JiraSubtaskRef[],
  storyName: string,
): DiscoveredFeBeKeys => {
  const title = storyName.trim().toLowerCase();
  const preferred = title
    ? children.filter((child) => child.summary.trim().toLowerCase().includes(title))
    : children;
  const pool = preferred.length > 0 ? preferred : children;
  const all = matchAllRoleSubtasksFromSummaries(pool);
  return {
    feKey: all.fe[0],
    beKey: all.be[0],
    androidKey: all.android[0],
    iosKey: all.ios[0],
  };
};

const listParentSubtasksFromIssue = async (
  credentials: JiraApiCredentials,
  parentIssueKey: string,
): Promise<JiraSubtaskRef[]> => {
  const response = await jiraFetch(
    credentials,
    `/issue/${encodeURIComponent(parentIssueKey)}?fields=summary,subtasks`,
  );
  if (!response.ok) {
    await response.text().catch(() => "");
    throw new JiraApiError(
      publicJiraErrorMessage(response.status, `Failed to list subtasks for ${parentIssueKey}`),
      response.status,
    );
  }

  const body = (await response.json()) as {
    fields?: {
      subtasks?: Array<{
        key?: string;
        fields?: { summary?: string };
      }>;
    };
  };

  const raw = body.fields?.subtasks ?? [];
  const refs: JiraSubtaskRef[] = [];
  const missingSummaryKeys: string[] = [];

  for (const item of raw) {
    if (!item.key) continue;
    const summary = item.fields?.summary?.trim() ?? "";
    if (!summary) {
      missingSummaryKeys.push(item.key);
    }
    refs.push({ key: item.key, summary });
  }

  for (let offset = 0; offset < missingSummaryKeys.length; offset += KEY_LOOKUP_CHUNK) {
    const chunk = missingSummaryKeys.slice(offset, offset + KEY_LOOKUP_CHUNK);
    const jql = `key in (${chunk.map(quoteJql).join(",")})`;
    const issues = await searchJqlIssues(credentials, jql, chunk.length);
    if (!issues) continue;
    const byKey = new Map(
      issues
        .filter((issue): issue is { key: string; fields?: { summary?: string } } => Boolean(issue.key))
        .map((issue) => [issue.key, issue.fields?.summary?.trim() ?? ""] as const),
    );
    for (const ref of refs) {
      if (!ref.summary && byKey.has(ref.key)) {
        ref.summary = byKey.get(ref.key) ?? "";
      }
    }
  }

  return refs;
};

/**
 * List child subtasks under a parent Jira story (paginated search, then issue-field fallback).
 */
export const listParentSubtasks = async (
  credentials: JiraApiCredentials,
  parentIssueKey: string,
): Promise<JiraSubtaskRef[]> => {
  const jql = `parent = ${quoteJql(parentIssueKey)} ORDER BY key ASC`;
  const searched = await searchJqlIssues(credentials, jql, SEARCH_PAGE_SIZE);
  if (searched) {
    return refsFromSearchIssues(searched);
  }
  return listParentSubtasksFromIssue(credentials, parentIssueKey);
};

const keysFromPlannerMeta = (
  jiraMeta: TaskJiraMeta | undefined,
  parentIssueKey: string,
): DiscoveredFeBeKeys => {
  if (jiraMeta?.parentIssueKey && jiraMeta.parentIssueKey !== parentIssueKey) {
    return {};
  }
  return {
    feKey: jiraMeta?.subtasks.find((item) => item.role === "fe")?.key,
    beKey: jiraMeta?.subtasks.find((item) => item.role === "be")?.key,
    androidKey: jiraMeta?.subtasks.find(
      (item) => item.role === "android" || (item.role as string) === "mo",
    )?.key,
    iosKey: jiraMeta?.subtasks.find((item) => item.role === "ios")?.key,
  };
};

/**
 * Keep planner metadata keys only when they still exist under the parent story.
 */
export const reconcileFeBeSubtaskKeys = (
  fromMeta: DiscoveredFeBeKeys,
  fromJira: DiscoveredFeBeKeys,
  childKeys: Set<string>,
): DiscoveredFeBeKeys => {
  const pick = (metaKey?: string, jiraKey?: string): string | undefined => {
    if (metaKey && childKeys.has(metaKey)) {
      return metaKey;
    }
    if (jiraKey && childKeys.has(jiraKey)) {
      return jiraKey;
    }
    return undefined;
  };

  return {
    feKey: pick(fromMeta.feKey, fromJira.feKey),
    beKey: pick(fromMeta.beKey, fromJira.beKey),
    androidKey: pick(fromMeta.androidKey, fromJira.androidKey),
    iosKey: pick(fromMeta.iosKey, fromJira.iosKey),
  };
};

/**
 * Resolve existing FE/BE/Android/IOS subtask keys from planner metadata and/or Jira API.
 */
export const discoverFeBeSubtasks = async (
  credentials: JiraApiCredentials,
  parentIssueKey: string,
  storyName: string,
  jiraMeta?: TaskJiraMeta,
): Promise<DiscoveredFeBeKeys> => {
  const fromMeta = keysFromPlannerMeta(jiraMeta, parentIssueKey);
  const children = await listParentSubtasks(credentials, parentIssueKey);
  const childKeys = new Set(children.map((child) => child.key));
  const fromJira = matchFeBeSubtasksFromSummaries(children, storyName);
  return reconcileFeBeSubtaskKeys(fromMeta, fromJira, childKeys);
};

type DiscoverTaskAssignees = {
  storyName: string;
  feDevs: string[];
  beDevs: string[];
  androidDevs: string[];
  iosDevs: string[];
  needsIos: boolean;
  feHours: number;
  beHours: number;
  androidHours: number;
  iosHours: number;
};

const assigneesForRole = (task: DiscoverTaskAssignees, role: JiraSubtaskRole): string[] => {
  if (role === "fe") return task.feDevs;
  if (role === "be") return task.beDevs;
  if (role === "ios") return task.iosDevs;
  return task.androidDevs;
};

const hoursForRole = (task: DiscoverTaskAssignees, role: JiraSubtaskRole): number => {
  if (role === "fe") return task.feHours;
  if (role === "be") return task.beHours;
  if (role === "ios") return effectiveIosHours(task);
  return task.androidHours;
};

const isRoleKeyLists = (discovered: DiscoveredFeBeKeys | DiscoveredRoleKeys): discovered is DiscoveredRoleKeys =>
  Array.isArray((discovered as DiscoveredRoleKeys).fe);

const toRoleKeyLists = (discovered: DiscoveredFeBeKeys | DiscoveredRoleKeys): DiscoveredRoleKeys => {
  if (isRoleKeyLists(discovered)) {
    return discovered;
  }
  return {
    fe: discovered.feKey ? [discovered.feKey] : [],
    be: discovered.beKey ? [discovered.beKey] : [],
    android: discovered.androidKey ? [discovered.androidKey] : [],
    ios: discovered.iosKey ? [discovered.iosKey] : [],
  };
};

/**
 * Merge discovered keys into jira metadata for subtask plan building.
 * Keeps every [FE]/[BE]/[Android]/[IOS] child (multiple people of the same role).
 */
export const mergeDiscoveredIntoJiraMeta = (
  parentIssueKey: string,
  task: DiscoverTaskAssignees,
  jiraMeta: TaskJiraMeta | undefined,
  discovered: DiscoveredFeBeKeys | DiscoveredRoleKeys,
): TaskJiraMeta => {
  const subtasks = [...(jiraMeta?.subtasks ?? [])].filter(
    (item) => (item.role as string) !== "mo",
  );
  const keys = toRoleKeyLists(discovered);

  const upsertKey = (role: JiraSubtaskRole, key: string) => {
    const byKey = subtasks.findIndex((item) => item.key === key);
    if (byKey >= 0) {
      subtasks[byKey] = { ...subtasks[byKey], role, key };
      return;
    }
    const takenAssignees = new Set(
      subtasks.filter((item) => item.role === role).map((item) => item.assigneeName.trim()).filter(Boolean),
    );
    const assigneeName =
      assigneesForRole(task, role)
        .map((name) => name.trim())
        .find((name) => name && !takenAssignees.has(name)) ?? "";
    subtasks.push({
      key,
      role,
      assigneeName,
      hours: hoursForRole(task, role),
    });
  };

  for (const role of ["fe", "be", "android", "ios"] as const) {
    for (const key of keys[role]) {
      upsertKey(role, key);
    }
  }

  return {
    parentIssueKey,
    lastPushedAt: jiraMeta?.lastPushedAt ?? null,
    subtasks,
  };
};
