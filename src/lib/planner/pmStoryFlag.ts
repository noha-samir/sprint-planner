import { isStandaloneIssueType } from "@/lib/planner/taskIssueFilters";

/**
 * True when Jira assignee matches any squad PM account id.
 */
export function resolveIsPmStory(
  pmAccountIds: string[] | null | undefined,
  assigneeAccountId: string | null | undefined,
): boolean {
  const assignee = assigneeAccountId?.trim();
  if (!assignee || !pmAccountIds?.length) return false;
  return pmAccountIds.some((id) => id.trim() === assignee);
}

/**
 * Expand resolved squad PM names with roster nicknames so Product Managers column matches.
 * When API names are empty, fall back to every People → PM roster name.
 */
export function expandSquadPmMatchNames(
  squadPmNames: string[] | null | undefined,
  resources: Array<{ name: string; nickname?: string | null; type: string }> | null | undefined,
): string[] {
  const fromApi = (squadPmNames ?? []).map((name) => name.trim()).filter(Boolean);
  const fromRoster = (resources ?? [])
    .filter((resource) => resource.type === "PM")
    .flatMap((resource) =>
      [resource.name, resource.nickname ?? ""]
        .map((value) => value.trim())
        .filter(Boolean),
    );
  const base = fromApi.length > 0 ? fromApi : fromRoster;
  if (base.length === 0) return [];
  const matchSet = new Set(base.map((name) => name.toLowerCase()));
  const out = new Set(base);
  for (const resource of resources ?? []) {
    if (resource.type !== "PM") continue;
    const aliases = [resource.name, resource.nickname ?? ""]
      .map((value) => value.trim())
      .filter(Boolean);
    if (!aliases.some((alias) => matchSet.has(alias.toLowerCase()))) continue;
    for (const alias of aliases) {
      out.add(alias);
      matchSet.add(alias.toLowerCase());
    }
  }
  return [...out];
}

/**
 * True when the story lists at least one squad PM (roster name match, case-insensitive).
 */
export function isSquadPmStory(
  productManagers: string[] | null | undefined,
  squadPmNames: string[] | null | undefined,
): boolean {
  if (!productManagers?.length || !squadPmNames?.length) return false;
  const pmSet = new Set(squadPmNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  if (pmSet.size === 0) return false;
  return productManagers.some((name) => pmSet.has(name.trim().toLowerCase()));
}

/**
 * Owner → PM / Team exclusion:
 * - Jira assignee is a squad PM (`isPmStory`), or
 * - Story (not technical task/bug/task) has a squad PM in Product Managers.
 */
export function isOwnerPmStory(
  task: {
    isPmStory?: boolean;
    productManagers?: string[] | null;
    issueType?: string | null;
  },
  squadPmNames: string[] | null | undefined,
  resources?: Array<{ name: string; nickname?: string | null; type: string }> | null,
): boolean {
  if (task.isPmStory) return true;
  if (isStandaloneIssueType(task.issueType)) return false;
  const names = expandSquadPmMatchNames(squadPmNames, resources);
  return isSquadPmStory(task.productManagers, names);
}
