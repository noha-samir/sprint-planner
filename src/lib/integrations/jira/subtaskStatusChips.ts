import type { Task } from "@/lib/scheduler/types";
import type { JiraSubtaskRole } from "./types";

const ROLE_ORDER: Record<JiraSubtaskRole, number> = { be: 0, fe: 1, android: 2, ios: 3 };
const ROLE_CHIP_LABEL: Record<JiraSubtaskRole, string> = { be: "BE", fe: "FE", android: "AND", ios: "iOS" };

export type SubtaskStatusChip = {
  key: string;
  /** Short chip text, e.g. "BE · In Progress" ("?" when the status is not known yet). */
  label: string;
  /** Jira status name, or null when unknown (created in a push, not pulled since). */
  status: string | null;
  /** Hover text: key · role · assignee · status. */
  title: string;
};

/**
 * One status chip per linked Jira subtask, ordered BE → FE → Android → iOS (same-role order kept).
 * @param task - Story with `jira.subtasks` saved by the last pull/push.
 * @returns Empty array when the story has no linked subtasks.
 */
export const buildSubtaskStatusChips = (task: Pick<Task, "jira">): SubtaskStatusChip[] =>
  [...(task.jira?.subtasks ?? [])]
    .sort((left, right) => (ROLE_ORDER[left.role] ?? 9) - (ROLE_ORDER[right.role] ?? 9))
    .map((subtask) => {
      const roleLabel = ROLE_CHIP_LABEL[subtask.role] ?? subtask.role.toUpperCase();
      const status = subtask.status?.trim() || null;
      return {
        key: subtask.key,
        label: `${roleLabel} · ${status ?? "?"}`,
        status,
        title: [
          subtask.key,
          roleLabel,
          subtask.assigneeName.trim() || null,
          status ?? "Status unknown — pull from Jira to refresh",
        ]
          .filter(Boolean)
          .join(" · "),
      };
    });
