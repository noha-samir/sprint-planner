import type { JiraApiCredentials } from "./credentials";
import { parseJiraIssueKey } from "./issueKey";
import { quoteJql, searchJqlIssues, type SearchJqlIssue } from "./jiraSearch";

/** Jira and planner clocks can drift; edits inside this window after our last sync are ignored. */
export const REMOTE_CHANGE_GRACE_MS = 60_000;

const PARENT_KEY_CHUNK = 40;
const SEARCH_PAGE_SIZE = 100;

export type RemoteChangeBaseline = {
  taskId: string;
  storyLink: string;
  lastPulledAt?: string | null;
  lastPushedAt?: string | null;
};

export type RemoteChangedTask = {
  taskId: string;
  /** Parent and/or subtask keys updated in Jira after the baseline. */
  keys: string[];
  latestUpdatedAt: string | null;
  /** True when the story was never pulled or pushed — any Jira content may be overwritten. */
  neverPulled: boolean;
};

const parseTime = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

/** Latest of lastPulledAt / lastPushedAt, or null when the story never synced. */
export const baselineMsForTask = (baseline: RemoteChangeBaseline): number | null => {
  const pulled = parseTime(baseline.lastPulledAt);
  const pushed = parseTime(baseline.lastPushedAt);
  if (pulled == null && pushed == null) return null;
  return Math.max(pulled ?? 0, pushed ?? 0);
};

/**
 * Compare Jira `updated` times with each story's last sync time (pure, no I/O).
 * @param baselines - Stories about to be pushed with their last pull/push timestamps.
 * @param issues - Jira search results for the parents and their subtasks (fields: updated, parent).
 * @returns Stories whose parent or any subtask changed after the baseline, plus never-synced stories.
 */
export const detectChangedTasks = (
  baselines: RemoteChangeBaseline[],
  issues: SearchJqlIssue[],
): RemoteChangedTask[] => {
  const taskByParentKey = new Map<string, RemoteChangeBaseline>();
  for (const baseline of baselines) {
    const key = parseJiraIssueKey(baseline.storyLink);
    if (key) taskByParentKey.set(key.toUpperCase(), baseline);
  }

  const changedByTaskId = new Map<string, { keys: string[]; latestMs: number }>();
  for (const issue of issues) {
    const key = issue.key?.trim().toUpperCase();
    if (!key) continue;
    const parentKey = issue.fields?.parent?.key?.trim().toUpperCase();
    const baseline = taskByParentKey.get(key) ?? (parentKey ? taskByParentKey.get(parentKey) : undefined);
    if (!baseline) continue;

    const baselineMs = baselineMsForTask(baseline);
    if (baselineMs == null) continue;
    const updatedMs = parseTime(issue.fields?.updated as string | undefined);
    if (updatedMs == null || updatedMs <= baselineMs + REMOTE_CHANGE_GRACE_MS) continue;

    const entry = changedByTaskId.get(baseline.taskId) ?? { keys: [], latestMs: 0 };
    if (!entry.keys.includes(key)) entry.keys.push(key);
    entry.latestMs = Math.max(entry.latestMs, updatedMs);
    changedByTaskId.set(baseline.taskId, entry);
  }

  const changed: RemoteChangedTask[] = [];
  for (const baseline of baselines) {
    if (baselineMsForTask(baseline) == null) {
      if (parseJiraIssueKey(baseline.storyLink)) {
        changed.push({ taskId: baseline.taskId, keys: [], latestUpdatedAt: null, neverPulled: true });
      }
      continue;
    }
    const entry = changedByTaskId.get(baseline.taskId);
    if (!entry) continue;
    changed.push({
      taskId: baseline.taskId,
      keys: entry.keys.sort(),
      latestUpdatedAt: new Date(entry.latestMs).toISOString(),
      neverPulled: false,
    });
  }
  return changed;
};

/**
 * Find stories changed in Jira since our last pull/push (batched JQL, no per-story calls).
 * @param credentials - Jira API credentials of the signed-in user.
 * @param baselines - Stories about to be pushed.
 * @returns Changed stories, or null when the Jira search failed (caller shows "could not check").
 * Side effects: read-only Jira searches — one per 40 parent keys.
 */
export const findRemoteJiraChanges = async (
  credentials: JiraApiCredentials,
  baselines: RemoteChangeBaseline[],
): Promise<RemoteChangedTask[] | null> => {
  const syncedParentKeys = [
    ...new Set(
      baselines
        .filter((baseline) => baselineMsForTask(baseline) != null)
        .map((baseline) => parseJiraIssueKey(baseline.storyLink)?.toUpperCase())
        .filter((key): key is string => Boolean(key)),
    ),
  ];

  const issues: SearchJqlIssue[] = [];
  for (let offset = 0; offset < syncedParentKeys.length; offset += PARENT_KEY_CHUNK) {
    const chunk = syncedParentKeys.slice(offset, offset + PARENT_KEY_CHUNK);
    const keyList = chunk.map(quoteJql).join(", ");
    const found = await searchJqlIssues(
      credentials,
      `key in (${keyList}) OR parent in (${keyList})`,
      SEARCH_PAGE_SIZE,
      { fields: ["updated", "parent"] },
    );
    if (!found) return null;
    issues.push(...found);
  }

  return detectChangedTasks(baselines, issues);
};
