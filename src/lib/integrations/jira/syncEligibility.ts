import type { Task } from "@/lib/scheduler/types";
import { effectiveMobileHours } from "@/lib/scheduler/mobilePlatform";
import { isDiscopedTaskStatus } from "@/lib/scheduler/taskStatus";
import { isJiraStoryLink } from "./issueKey";

const hasNamedAssignee = (names: string[]): boolean =>
  names.some((name) => name.trim().length > 0);

/** Whether a task row has hours or FE/BE/Android/IOS assignees worth syncing to Jira. */
export const taskHasJiraSyncHours = (task: Task): boolean =>
  task.feHours > 0 ||
  task.beHours > 0 ||
  (task.androidHours ?? 0) > 0 ||
  effectiveMobileHours(task) > 0 ||
  task.qcHours > 0 ||
  hasNamedAssignee(task.feDevs) ||
  hasNamedAssignee(task.beDevs) ||
  hasNamedAssignee(task.androidDevs ?? []) ||
  (task.needsIos && hasNamedAssignee(task.iosDevs ?? []));

/** Soft skip reasons for bulk push confirm (not Discoped). */
export type BulkSyncLeftOutReason = "no_link" | "no_hours";

export type BulkSyncLeftOutStory = {
  name: string;
  reason: BulkSyncLeftOutReason;
};

/** Why a selected row is left out of push (null when eligible or Discoped). */
export const bulkSyncLeftOutReason = (task: Task): BulkSyncLeftOutReason | null => {
  if (isDiscopedTaskStatus(task.status)) return null;
  if (!isJiraStoryLink(task.storyLink)) return "no_link";
  if (!taskHasJiraSyncHours(task)) return "no_hours";
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

/** Whether a task is eligible for dashboard Jira sync. */
export const isTaskEligibleForJiraSync = (task: Task): boolean =>
  isJiraStoryLink(task.storyLink) && taskHasJiraSyncHours(task) && !isDiscopedTaskStatus(task.status);

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
