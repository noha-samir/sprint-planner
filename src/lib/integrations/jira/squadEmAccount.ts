import { prisma } from "@/lib/db/prisma";
import { requireJiraApiCredentials } from "@/lib/authz/sessionJiraCredentials";
import { resolveEmJiraAccountId } from "./discoverEmStories";

/** Resolve the squad EM's Jira account id from squad.emEmail. */
export async function resolveSquadEmAccountId(squadId: string): Promise<string | null> {
  try {
    const squad = await prisma.squad.findUnique({
      where: { id: squadId },
      select: { emEmail: true },
    });
    const emEmail = squad?.emEmail?.trim() ?? "";
    if (!emEmail) return null;
    const credentials = await requireJiraApiCredentials(squadId);
    return await resolveEmJiraAccountId(credentials, emEmail);
  } catch {
    return null;
  }
}
