import { prisma } from "@/lib/db/prisma";
import { requireJiraApiCredentials } from "@/lib/authz/sessionJiraCredentials";
import { createMappedResource } from "./createMappedResource";
import { resolveJiraAccountForPlannerName } from "./userSearch";
import { SQUAD_CAPACITY_HOURS_MAX } from "@/lib/scheduler/types";

export const DEFAULT_PM_SEED_QUERIES = ["Alex Rivera", "Rivera", "Casey Morgan", "Lee"] as const;

export type SeedPmResult = {
  created: Array<{ name: string; accountId: string }>;
  skipped: Array<{ query: string; reason: string }>;
  failed: Array<{ query: string; reason: string }>;
};

/**
 * Idempotent: when the squad has no PM resources, search Jira for the seed queries
 * and create mapped PM roster people for unique hits.
 */
export const seedDefaultProductManagers = async (
  squadId: string,
  queries: readonly string[] = DEFAULT_PM_SEED_QUERIES,
): Promise<SeedPmResult> => {
  const safe = squadId.trim();
  const result: SeedPmResult = { created: [], skipped: [], failed: [] };
  if (!safe) return result;

  const existingPm = await prisma.resource.findMany({
    where: { squadId: safe, type: "PM" },
    select: { name: true },
  });
  const existingNames = new Set(existingPm.map((row) => row.name.trim().toLowerCase()));
  // Only skip entirely when we already have a full seeded set; otherwise fill gaps.
  const stillNeeded = queries.filter((query) => {
    const q = query.trim().toLowerCase();
    return ![...existingNames].some((name) => name.includes(q) || q.includes(name));
  });
  if (stillNeeded.length === 0) {
    for (const query of queries) {
      result.skipped.push({ query, reason: "Already on PM roster" });
    }
    return result;
  }

  const credentials = await requireJiraApiCredentials(safe);
  const capacityHours = SQUAD_CAPACITY_HOURS_MAX;

  for (const query of stillNeeded) {
    try {
      const resolved = await resolveJiraAccountForPlannerName(credentials, query);
      if (!resolved.accountId) {
        if (resolved.candidates.length > 1) {
          result.failed.push({
            query,
            reason: `Ambiguous Jira match (${resolved.candidates.length} candidates) — add manually`,
          });
        } else {
          result.failed.push({ query, reason: "No Jira account found — add manually" });
        }
        continue;
      }
      const displayName =
        resolved.candidates.find((user) => user.accountId === resolved.accountId)?.displayName.trim() ||
        query;
      const created = await createMappedResource(safe, {
        type: "PM",
        accountId: resolved.accountId,
        displayName,
        capacityHours,
      });
      result.created.push({ name: created.resource.name, accountId: resolved.accountId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to seed";
      if (
        message.includes("already") ||
        message.includes("already exists") ||
        message.includes("already mapped")
      ) {
        result.skipped.push({ query, reason: message });
      } else {
        result.failed.push({ query, reason: message });
      }
    }
  }

  return result;
};
