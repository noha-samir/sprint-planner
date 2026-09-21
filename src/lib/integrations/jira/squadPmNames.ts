import { prisma } from "@/lib/db/prisma";
import { requireJiraApiCredentials } from "@/lib/authz/sessionJiraCredentials";
import { readSquadJiraConfig } from "@/lib/integrations/jira/configStore";
import { resolveEmJiraAccountId } from "@/lib/integrations/jira/discoverEmStories";
import { quoteJql, searchJqlIssues } from "@/lib/integrations/jira/jiraSearch";
import { searchJiraUsers } from "@/lib/integrations/jira/userSearch";
import { resolveIsPmStory } from "@/lib/planner/pmStoryFlag";

const namesByAccountId = (assigneeMap: Record<string, string>): Map<string, string[]> => {
  const byAccount = new Map<string, string[]>();
  for (const [plannerName, accountId] of Object.entries(assigneeMap)) {
    const id = accountId.trim();
    const name = plannerName.trim();
    if (!id || !name) continue;
    const list = byAccount.get(id) ?? [];
    if (!list.some((item) => item.toLowerCase() === name.toLowerCase())) {
      list.push(name);
    }
    byAccount.set(id, list);
  }
  return byAccount;
};

export type SquadPmResolution = {
  pmEmails: string[];
  pmNames: string[];
  pmAccountIds: string[];
};

/**
 * Resolve squad PM identity for Owner → PM and isPmStory.
 * Sources (merged): User Management pmEmails, People PM roster + assignee map,
 * and Squad Jira productManagerName / productManagerJiraAccountId.
 */
export async function resolveSquadPmRosterNames(squadId: string): Promise<SquadPmResolution> {
  const squad = await prisma.squad.findUnique({
    where: { id: squadId },
    select: { pmEmails: true },
  });
  const pmEmails = (squad?.pmEmails ?? [])
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  let assigneeMap: Record<string, string> = {};
  let productManagerName = "";
  let productManagerJiraAccountId = "";
  try {
    const config = await readSquadJiraConfig(squadId);
    assigneeMap = config.assigneeMap ?? {};
    productManagerName = config.productManagerName?.trim() ?? "";
    productManagerJiraAccountId = config.productManagerJiraAccountId?.trim() ?? "";
  } catch {
    assigneeMap = {};
  }
  const byAccountId = namesByAccountId(assigneeMap);

  const pmResources = await prisma.resource.findMany({
    where: { squadId, type: "PM" },
    select: {
      name: true,
      nickname: true,
      jiraMappings: { select: { jiraAccountId: true } },
    },
  });

  let credentials: Awaited<ReturnType<typeof requireJiraApiCredentials>> | null = null;
  try {
    credentials = await requireJiraApiCredentials(squadId);
  } catch {
    credentials = null;
  }

  const pmNames: string[] = [];
  const pmAccountIds: string[] = [];
  const seenNames = new Set<string>();
  const seenAccounts = new Set<string>();

  const addName = (value: string | null | undefined) => {
    const name = value?.trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seenNames.has(key)) return;
    seenNames.add(key);
    pmNames.push(name);
  };

  const addAccount = (accountId: string | null | undefined) => {
    const id = accountId?.trim();
    if (!id || seenAccounts.has(id)) return;
    seenAccounts.add(id);
    pmAccountIds.push(id);
  };

  const addAccountAliases = (accountId: string) => {
    for (const name of byAccountId.get(accountId) ?? []) {
      addName(name);
    }
    for (const resource of pmResources) {
      const mapped = resource.jiraMappings.some(
        (row) => row.jiraAccountId.trim() === accountId,
      );
      if (!mapped) continue;
      addName(resource.name);
      addName(resource.nickname);
    }
  };

  const accountIdForPlannerName = (plannerName: string): string | undefined => {
    const name = plannerName.trim();
    if (!name) return undefined;
    const direct = assigneeMap[name]?.trim();
    if (direct) return direct;
    const lower = name.toLowerCase();
    for (const [key, accountId] of Object.entries(assigneeMap)) {
      if (key.trim().toLowerCase() === lower) {
        const id = accountId.trim();
        return id || undefined;
      }
    }
    return undefined;
  };

  // People → PM roster (names) and mapped Jira account ids.
  for (const resource of pmResources) {
    addName(resource.name);
    addName(resource.nickname);
    for (const row of resource.jiraMappings) {
      addAccount(row.jiraAccountId);
    }
    for (const alias of [resource.name, resource.nickname ?? ""]) {
      const mappedFromAssignee = accountIdForPlannerName(alias);
      if (!mappedFromAssignee) continue;
      addAccount(mappedFromAssignee);
      addAccountAliases(mappedFromAssignee);
    }
  }

  // Squad Jira default product manager (People → Jira fields).
  if (productManagerName) addName(productManagerName);
  if (productManagerJiraAccountId) {
    addAccount(productManagerJiraAccountId);
    addAccountAliases(productManagerJiraAccountId);
  }

  // User Management PM emails → Jira account ids + display names.
  for (const email of pmEmails) {
    if (!credentials) break;
    try {
      const accountId = await resolveEmJiraAccountId(credentials, email);
      if (!accountId) continue;
      addAccount(accountId);
      addAccountAliases(accountId);
      const users = await searchJiraUsers(credentials, email);
      addName(users[0]?.displayName);
    } catch {
      // Skip unresolvable emails; filter still works for resolved PMs.
    }
  }

  return { pmEmails, pmNames, pmAccountIds };
}

/** Resolve only squad PM Jira account ids (for pull/discover isPmStory). */
export async function resolveSquadPmAccountIds(squadId: string): Promise<string[]> {
  const result = await resolveSquadPmRosterNames(squadId);
  return result.pmAccountIds;
}

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
};

/**
 * Look up Jira assignees for dashboard issue keys and mark which are squad PMs.
 * Used so Owner → PM works without waiting for a full Pull on every story.
 */
export async function resolvePmStoryFlagsByIssueKeys(
  squadId: string,
  issueKeys: string[],
): Promise<Record<string, boolean>> {
  const uniqueKeys = [
    ...new Set(
      issueKeys
        .map((key) => key.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  if (uniqueKeys.length === 0) return {};

  const pmAccountIds = await resolveSquadPmAccountIds(squadId);
  if (pmAccountIds.length === 0) {
    // Do not return false for every key — that would wipe isPmStory in the client.
    return {};
  }

  let credentials: Awaited<ReturnType<typeof requireJiraApiCredentials>>;
  try {
    credentials = await requireJiraApiCredentials(squadId);
  } catch {
    return {};
  }

  const flags: Record<string, boolean> = {};
  for (const keys of chunk(uniqueKeys, 50)) {
    const jql = `key in (${keys.map((key) => quoteJql(key)).join(", ")})`;
    const issues = await searchJqlIssues(credentials, jql, 50, {
      fields: ["assignee"],
      maxIssues: keys.length,
    });
    if (!issues) continue;
    for (const issue of issues) {
      const key = issue.key?.trim().toUpperCase();
      if (!key) continue;
      flags[key] = resolveIsPmStory(
        pmAccountIds,
        issue.fields?.assignee?.accountId ?? null,
      );
    }
  }
  return flags;
}
