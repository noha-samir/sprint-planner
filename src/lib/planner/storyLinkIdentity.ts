import { parseJiraIssueKey } from "@/lib/integrations/jira/issueKey";
import type { Task } from "@/lib/scheduler/types";

/**
 * Stable identity for a story link: Jira issue key when present, else normalized URL.
 * Empty / unparseable links return null (those rows are never treated as link-duplicates).
 */
export const storyLinkIdentityKey = (storyLink: string | null | undefined): string | null => {
  const trimmed = (storyLink ?? "").trim();
  if (!trimmed) {
    return null;
  }
  const issueKey = parseJiraIssueKey(trimmed);
  if (issueKey) {
    return `jira:${issueKey}`;
  }
  return `link:${trimmed.toLowerCase().replace(/\/+$/, "")}`;
};

export const storyLinkIdentityKeySet = (
  tasks: Array<Pick<Task, "storyLink">>,
): Set<string> => {
  const keys = new Set<string>();
  for (const task of tasks) {
    const key = storyLinkIdentityKey(task.storyLink);
    if (key) {
      keys.add(key);
    }
  }
  return keys;
};

const taskEffortHours = (task: Task): number =>
  (task.feHours ?? 0) +
  (task.beHours ?? 0) +
  (task.androidHours ?? 0) +
  (task.iosHours ?? 0) +
  (task.qcHours ?? 0) +
  (task.integrationHours ?? 0) +
  (task.bufferHours ?? 0);

/** Prefer higher effort, but always keep Next-sprint carry if either duplicate had it. */
export const preferTaskForStoryLinkDedupe = (a: Task, b: Task): Task => {
  const effortDelta = taskEffortHours(a) - taskEffortHours(b);
  let preferred: Task;
  if (effortDelta !== 0) {
    preferred = effortDelta > 0 ? a : b;
  } else {
    const aName = a.storyName.trim().length;
    const bName = b.storyName.trim().length;
    if (aName !== bName) {
      preferred = aName > bName ? a : b;
    } else if (a.carryToNextSprint && !b.carryToNextSprint) {
      preferred = a;
    } else if (b.carryToNextSprint && !a.carryToNextSprint) {
      preferred = b;
    } else {
      preferred = a;
    }
  }

  const carryToNextSprint = Boolean(a.carryToNextSprint || b.carryToNextSprint);
  const releaseGroup =
    (preferred.releaseGroup?.trim() ? preferred.releaseGroup : null) ??
    (a.releaseGroup?.trim() ? a.releaseGroup : null) ??
    (b.releaseGroup?.trim() ? b.releaseGroup : null);

  let next = preferred;
  if (carryToNextSprint !== Boolean(preferred.carryToNextSprint)) {
    next = { ...next, carryToNextSprint };
  }
  if ((next.releaseGroup ?? null) !== (releaseGroup ?? null)) {
    next = { ...next, releaseGroup };
  }
  return next;
};

export type CollapseTasksByStoryLinkResult = {
  tasks: Task[];
  removedIds: string[];
};

/**
 * Keep one planner row per story-link identity (Jira key / normalized URL).
 * Rows with no identity key are left as-is. Order follows the first occurrence of each key.
 */
export const collapseTasksByStoryLink = (tasks: Task[]): CollapseTasksByStoryLinkResult => {
  const bestByKey = new Map<string, Task>();

  for (const task of tasks) {
    const key = storyLinkIdentityKey(task.storyLink);
    if (!key) {
      continue;
    }
    const existing = bestByKey.get(key);
    if (!existing) {
      bestByKey.set(key, task);
      continue;
    }
    bestByKey.set(key, preferTaskForStoryLinkDedupe(existing, task));
  }

  const seenKeys = new Set<string>();
  const collapsed: Task[] = [];
  for (const task of tasks) {
    const key = storyLinkIdentityKey(task.storyLink);
    if (!key) {
      collapsed.push(task);
      continue;
    }
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    collapsed.push(bestByKey.get(key) ?? task);
  }

  const keptIds = new Set(collapsed.map((task) => task.id));
  const removedIds = tasks.filter((task) => !keptIds.has(task.id)).map((task) => task.id);
  return { tasks: collapsed, removedIds };
};

/**
 * Drop drafts whose story link already exists on the board or earlier in the same batch.
 */
export const filterDraftsSkippingExistingStoryLinks = <T extends { storyLink: string }>(
  drafts: T[],
  existingTasks: Array<Pick<Task, "storyLink">>,
): T[] => {
  const seen = storyLinkIdentityKeySet(existingTasks);
  const kept: T[] = [];
  for (const draft of drafts) {
    const key = storyLinkIdentityKey(draft.storyLink);
    if (key && seen.has(key)) {
      continue;
    }
    if (key) {
      seen.add(key);
    }
    kept.push(draft);
  }
  return kept;
};
