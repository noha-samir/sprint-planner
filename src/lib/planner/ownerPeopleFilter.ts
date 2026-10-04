import type { Resource, ResourceType, Task } from "@/lib/scheduler/types";

/** Owner filter choices that can be narrowed to specific people. */
export type OwnerPeopleScope = "team" | "pm";

export type OwnerPeopleGroup = { label: string; names: string[] };

const OWNER_PEOPLE_ROLES: Record<OwnerPeopleScope, ReadonlyArray<{ type: ResourceType; label: string }>> = {
  team: [
    { type: "BE", label: "BE" },
    { type: "FE", label: "FE" },
    { type: "MO", label: "Mobile" },
    { type: "QC", label: "QC" },
  ],
  pm: [{ type: "PM", label: "PM" }],
};

type JiraAssignedPeopleFields = Pick<Task, "jira" | "jiraAssigneeName">;

const normalizeName = (name: string) => name.trim().toLowerCase();

/**
 * Roster people offered under Owner → Team / PM, grouped by role.
 * @param scope "team" for engineers and QC, "pm" for product managers.
 * @param resources Squad roster.
 * @returns Non-empty groups in display order, names sorted alphabetically.
 */
export const listOwnerPeopleGroups = (
  scope: OwnerPeopleScope,
  resources: ReadonlyArray<Pick<Resource, "name" | "type">>,
): OwnerPeopleGroup[] =>
  OWNER_PEOPLE_ROLES[scope]
    .map(({ type, label }) => ({
      label,
      names: resources
        .filter((resource) => resource.type === type && resource.name.trim())
        .map((resource) => resource.name)
        .sort((left, right) => left.localeCompare(right)),
    }))
    .filter((group) => group.names.length > 0);

/**
 * Lowercased names and nicknames of the picked people, so story assignees match in O(1).
 * @param pickedNames Roster names picked in the filter.
 * @param resources Squad roster (for nicknames).
 * @returns Empty set when nobody is picked (filter off).
 */
export const buildOwnerPeopleMatchSet = (
  pickedNames: readonly string[],
  resources: ReadonlyArray<{ name: string; nickname?: string | null }>,
): Set<string> => {
  const picked = new Set(pickedNames);
  const matchSet = new Set(pickedNames.map(normalizeName).filter(Boolean));
  for (const resource of resources) {
    const nickname = resource.nickname?.trim();
    if (nickname && picked.has(resource.name)) {
      matchSet.add(nickname.toLowerCase());
    }
  }
  return matchSet;
};

/**
 * @param name Assignee label shown on a story.
 * @param matchSet From `buildOwnerPeopleMatchSet`.
 * @returns Whether the label belongs to a picked person.
 */
export const isOwnerPeopleMatch = (name: string, matchSet: ReadonlySet<string>): boolean =>
  matchSet.has(normalizeName(name));

/**
 * True when Jira assigns any picked person to this row (planner-only edits do not count):
 * - the issue itself (Technical Task, Bug, a Story assigned to them),
 * - one of its FE / BE / Android / iOS subtasks (the parent row shows once),
 * - its QC Engineer or Product Manager field.
 * Ownership (EM / PM / Team) is ignored so a person's full workload shows.
 * @param task Jira link (subtasks + values Jira held at the last pull/push) and Jira issue assignee.
 * @param matchSet From `buildOwnerPeopleMatchSet` (non-empty).
 */
export const taskHasAssignedPerson = (task: JiraAssignedPeopleFields, matchSet: ReadonlySet<string>): boolean => {
  const synced = task.jira?.syncedFields;
  const jiraNames = [task.jiraAssigneeName ?? "", synced?.qcEngineer ?? "", synced?.productManager ?? ""];
  return (
    jiraNames.some((name) => name !== "" && isOwnerPeopleMatch(name, matchSet)) ||
    (task.jira?.subtasks ?? []).some((subtask) => isOwnerPeopleMatch(subtask.assigneeName, matchSet))
  );
};
