import { prisma } from "@/lib/db/prisma";
import { requireJiraApiCredentials } from "@/lib/authz/sessionJiraCredentials";
import { readSquadJiraConfig } from "@/lib/integrations/jira/configStore";
import { resolveEmJiraAccountId } from "@/lib/integrations/jira/discoverEmStories";
import { searchJiraUsers } from "@/lib/integrations/jira/userSearch";

const reverseAssigneeMap = (assigneeMap: Record<string, string>): Map<string, string> => {
  const reversed = new Map<string, string>();
  for (const [plannerName, accountId] of Object.entries(assigneeMap)) {
    const id = accountId.trim();
    const name = plannerName.trim();
    if (id && name && !reversed.has(id)) {
      reversed.set(id, name);
    }
  }
  return reversed;
};

export type SquadPmResolution = {
  pmEmails: string[];
  pmNames: string[];
};

/**
 * Resolve User Management squad PM emails to planner roster / Jira display names
 * for Owner filter matching against task.productManagers.
 */
export async function resolveSquadPmRosterNames(squadId: string): Promise<SquadPmResolution> {
  const squad = await prisma.squad.findUnique({
    where: { id: squadId },
    select: { pmEmails: true },
  });
  const pmEmails = (squad?.pmEmails ?? [])
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (pmEmails.length === 0) {
    return { pmEmails: [], pmNames: [] };
  }

  let assigneeMap: Record<string, string> = {};
  try {
    const config = await readSquadJiraConfig(squadId);
    assigneeMap = config.assigneeMap ?? {};
  } catch {
    assigneeMap = {};
  }
  const byAccountId = reverseAssigneeMap(assigneeMap);

  let credentials: Awaited<ReturnType<typeof requireJiraApiCredentials>> | null = null;
  try {
    credentials = await requireJiraApiCredentials(squadId);
  } catch {
    credentials = null;
  }

  const pmNames: string[] = [];
  const seen = new Set<string>();

  for (const email of pmEmails) {
    if (!credentials) break;
    try {
      const accountId = await resolveEmJiraAccountId(credentials, email);
      if (!accountId) continue;
      const mappedName = byAccountId.get(accountId)?.trim();
      if (mappedName) {
        const key = mappedName.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          pmNames.push(mappedName);
        }
        continue;
      }
      const users = await searchJiraUsers(credentials, email);
      const displayName = users[0]?.displayName?.trim();
      if (displayName) {
        const key = displayName.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          pmNames.push(displayName);
        }
      }
    } catch {
      // Skip unresolvable emails; filter still works for resolved PMs.
    }
  }

  return { pmEmails, pmNames };
}
