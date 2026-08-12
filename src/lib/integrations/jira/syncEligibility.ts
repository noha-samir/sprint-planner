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
