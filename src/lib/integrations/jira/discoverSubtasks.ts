import type { JiraApiCredentials } from "./credentials";
import { JiraApiError } from "./client";
import { publicJiraErrorMessage } from "./jiraErrors";
import { buildJiraBasicAuthHeader, jiraRestApiBase } from "./credentials";
import type { JiraSubtaskRole, TaskJiraMeta } from "./types";
import { effectiveIosHours } from "@/lib/scheduler/mobilePlatform";

export interface DiscoveredFeBeKeys {
  feKey?: string;
  beKey?: string;
  androidKey?: string;
  iosKey?: string;
}

interface JiraSubtaskRef {
  key: string;
  summary: string;
}

const jiraFetch = async (
  credentials: JiraApiCredentials,
  path: string,
): Promise<Response> =>
  fetch(`${jiraRestApiBase(credentials.siteUrl)}${path}`, {
    headers: {
      Authorization: buildJiraBasicAuthHeader(credentials),
      Accept: "application/json",
    },
    cache: "no-store",
  });

/**
 * Match [FE]/[BE]/[Android]/[IOS] subtask summaries from Jira children (pure — for tests).
 * Legacy [MO] summaries map to Android.
 */
export const matchFeBeSubtasksFromSummaries = (
  children: JiraSubtaskRef[],
  storyName: string,
): DiscoveredFeBeKeys => {
  const title = storyName.trim().toLowerCase();
  let feKey: string | undefined;
  let beKey: string | undefined;
  let androidKey: string | undefined;
  let iosKey: string | undefined;

  for (const child of children) {
    const summary = child.summary.trim();
    const summaryLower = summary.toLowerCase();
    if (title && !summaryLower.includes(title)) {
      continue;
    }
    if (!feKey && /^\[FE\]/i.test(summary)) {
      feKey = child.key;
      continue;
    }
    if (!beKey && /^\[BE\]/i.test(summary)) {
      beKey = child.key;
      continue;
    }
    if (!iosKey && /^\[IOS\]/i.test(summary)) {
      iosKey = child.key;
      continue;
    }
    if (!androidKey && (/^\[Android\]/i.test(summary) || /^\[MO\]/i.test(summary))) {
      androidKey = child.key;
    }
  }

  return { feKey, beKey, androidKey, iosKey };
};

/**
 * List child subtasks under a parent Jira story.
 */
export const listParentSubtasks = async (
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
    if (!item.key) {
      continue;
    }
    const summary = item.fields?.summary?.trim() ?? "";
    if (!summary) {
      missingSummaryKeys.push(item.key);
    }
    refs.push({ key: item.key, summary });
  }

  // One batched search instead of N sequential issue GETs when summaries are omitted.
  if (missingSummaryKeys.length > 0) {
    const jql = `key in (${missingSummaryKeys.map((key) => `"${key.replace(/"/g, '\\"')}"`).join(",")})`;
    const search = await jiraFetch(
      credentials,
      `/search?jql=${encodeURIComponent(jql)}&fields=summary&maxResults=${missingSummaryKeys.length}`,
    );
    if (search.ok) {
      const searchBody = (await search.json()) as {
        issues?: Array<{ key?: string; fields?: { summary?: string } }>;
      };
      const byKey = new Map(
        (searchBody.issues ?? [])
          .filter((issue): issue is { key: string; fields?: { summary?: string } } => Boolean(issue.key))
          .map((issue) => [issue.key, issue.fields?.summary?.trim() ?? ""] as const),
      );
      for (const ref of refs) {
        if (!ref.summary && byKey.has(ref.key)) {
          ref.summary = byKey.get(ref.key) ?? "";
        }
      }
    }
  }

  return refs;
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

/**
 * Merge discovered keys into jira metadata for subtask plan building.
 */
export const mergeDiscoveredIntoJiraMeta = (
  parentIssueKey: string,
  task: DiscoverTaskAssignees,
  jiraMeta: TaskJiraMeta | undefined,
  discovered: DiscoveredFeBeKeys,
): TaskJiraMeta => {
  const subtasks = [...(jiraMeta?.subtasks ?? [])].filter(
    (item) => (item.role as string) !== "mo",
  );

  const upsertKey = (role: JiraSubtaskRole, key: string | undefined) => {
    if (!key) {
      return;
    }
    const assigneeName = assigneesForRole(task, role).find((name) => name.trim().length > 0)?.trim() ?? "";
    const hours = hoursForRole(task, role);
    const index = subtasks.findIndex((item) => item.role === role);
    if (index >= 0) {
      subtasks[index] = { ...subtasks[index], key };
      return;
    }
    subtasks.push({ key, role, assigneeName, hours });
  };

  upsertKey("fe", discovered.feKey);
  upsertKey("be", discovered.beKey);
  upsertKey("android", discovered.androidKey);
  upsertKey("ios", discovered.iosKey);

  return {
    parentIssueKey,
    lastPushedAt: jiraMeta?.lastPushedAt ?? null,
    subtasks,
  };
};
