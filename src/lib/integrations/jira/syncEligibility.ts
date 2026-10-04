import type { Task } from "@/lib/scheduler/types";
import { effectiveMobileHours } from "@/lib/scheduler/mobilePlatform";
import { isDiscopedTaskStatus } from "@/lib/scheduler/taskStatus";
import { isJiraStoryLink } from "./issueKey";

const hasNamedAssignee = (names: string[]): boolean =>
  names.some((name) => name.trim().length > 0);

/**
 * Whether a task row has FE/BE/Android/IOS hours or assignees (the values that map to Jira dev subtasks).
 * @param task - Planner story.
 * @returns False when push would only touch parent story fields.
 */
export const taskHasJiraDevWork = (task: Task): boolean =>
  task.feHours > 0 ||
  task.beHours > 0 ||
  effectiveMobileHours(task) > 0 ||
  hasNamedAssignee(task.feDevs) ||
  hasNamedAssignee(task.beDevs) ||
  hasNamedAssignee(task.androidDevs ?? []) ||
  (task.needsIos && hasNamedAssignee(task.iosDevs ?? []));

/** Soft skip reasons for bulk push confirm (not Discoped). */
export type BulkSyncLeftOutReason = "no_link";

export type BulkSyncLeftOutStory = {
  name: string;
  reason: BulkSyncLeftOutReason;
};

/** Why a selected row is left out of push (null when eligible or Discoped). */
export const bulkSyncLeftOutReason = (task: Task): BulkSyncLeftOutReason | null => {
  if (isDiscopedTaskStatus(task.status)) return null;
  if (!isJiraStoryLink(task.storyLink)) return "no_link";
  return null;
};

const storyLabelForLeftOut = (task: Task): string =>
  task.storyName.trim() || task.storyLink.trim() || task.id;

/** Selected rows that will be soft-skipped on push (not Discoped). */
export const listBulkSyncLeftOutStories = (tasks: Task[]): BulkSyncLeftOutStory[] =>
  tasks.flatMap((task) => {
    const reason = bulkSyncLeftOutReason(task);
    if (!reason) return [];
    return [{ name: storyLabelForLeftOut(task), reason }];
  });

/**
 * Whether a task can be pushed to Jira: a valid story link and not Discoped.
 * Zero hours / no people still push (parent-only: Testing estimate, QC / PM, branch, status).
 */
export const isTaskEligibleForJiraSync = (task: Task): boolean =>
  isJiraStoryLink(task.storyLink) && !isDiscopedTaskStatus(task.status);

/** Whether a task can be pulled from Jira (link required; Discoped never pulls). */
export const isTaskEligibleForJiraPull = (task: Task): boolean =>
  isJiraStoryLink(task.storyLink) && !isDiscopedTaskStatus(task.status);

/**
 * Merge the latest in-memory story link (e.g. link input draft) before sync.
 */
export const resolveTaskForJiraSync = (task: Task, linkDraft?: string | null): Task => {
  const storyLink = linkDraft?.trim() || task.storyLink;
  return storyLink === task.storyLink ? task : { ...task, storyLink };
};
