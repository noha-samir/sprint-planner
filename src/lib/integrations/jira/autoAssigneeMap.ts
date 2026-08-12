import { requireJiraApiCredentials } from "@/lib/authz/sessionJiraCredentials";
import { readSquadJiraConfig, writeSquadJiraConfig } from "./configStore";
import {
  applyResourceJiraIdentities,
  clearSquadResourceNicknames,
  pruneAssigneeMapToRoster,
} from "./resourceJiraIdentity";
import type { SquadJiraConfig } from "./types";
import {
  fetchJiraUserByAccountId,
  resolveJiraAccountForPlannerName,
  type JiraUserRef,
} from "./userSearch";

export interface AutoMappedAssignee {
  plannerName: string;
  accountId: string;
  displayName: string;
  previousName: string;
}

export interface AmbiguousAssignee {
  plannerName: string;
  candidates: JiraUserRef[];
}

export interface SyncAssigneeResult {
  config: SquadJiraConfig;
  mapped: AutoMappedAssignee[];
  missing: string[];
  ambiguous: AmbiguousAssignee[];
  renames: Array<{ from: string; to: string }>;
}

export type PlannerNameHint = {
  name: string;
};

const toHints = (names: Array<string | PlannerNameHint>): PlannerNameHint[] => {
  const byName = new Map<string, PlannerNameHint>();
  for (const item of names) {
    const name = (typeof item === "string" ? item : item.name).trim();
    if (!name || byName.has(name)) continue;
    byName.set(name, { name });
  }
  return [...byName.values()];
};

const displayNameForAccount = (
  accountId: string,
  candidates: JiraUserRef[],
  fallback: string,
): string =>
  candidates.find((user) => user.accountId === accountId)?.displayName.trim() || fallback;

/**
 * Look up Jira users for planner names, map account IDs, and rename resources to Jira display names.
 */
export const syncAssigneeNamesFromJira = async (
  squadId: string,
  names: Array<string | PlannerNameHint>,
  options?: { replaceAll?: boolean },
): Promise<SyncAssigneeResult> => {
  const credentials = await requireJiraApiCredentials(squadId);
  const current = await readSquadJiraConfig(squadId);
  await clearSquadResourceNicknames(squadId);

  const hints = toHints(names);
  const replaceAll = options?.replaceAll ?? false;
  const pending = replaceAll
    ? hints
    : hints.filter((hint) => !current.assigneeMap[hint.name]?.trim());

  const mapped: AutoMappedAssignee[] = [];
  const missing: string[] = [];
  const ambiguous: AmbiguousAssignee[] = [];
  const assigneeMap = { ...current.assigneeMap };

  const withExisting = pending.filter((hint) => Boolean(assigneeMap[hint.name]?.trim()));
  const withoutExisting = pending.filter((hint) => !assigneeMap[hint.name]?.trim());

  const existingResults = await Promise.all(
    withExisting.map(async (hint) => {
      const existingAccountId = assigneeMap[hint.name]!.trim();
      const user = await fetchJiraUserByAccountId(credentials, existingAccountId);
      return {
        hint,
        existingAccountId,
        displayName: user?.displayName.trim() || hint.name,
      };
    }),
  );
  for (const row of existingResults) {
    assigneeMap[row.hint.name] = row.existingAccountId;
    mapped.push({
      plannerName: row.displayName,
      previousName: row.hint.name,
      accountId: row.existingAccountId,
      displayName: row.displayName,
    });
  }

  const searchResults = await Promise.all(
    withoutExisting.map(async (hint) => ({
      hint,
      resolved: await resolveJiraAccountForPlannerName(credentials, hint.name),
    })),
  );
  for (const { hint, resolved } of searchResults) {
    if (resolved.accountId) {
      const displayName = displayNameForAccount(
        resolved.accountId,
        resolved.candidates,
        hint.name,
      );
      assigneeMap[hint.name] = resolved.accountId;
      mapped.push({
        plannerName: displayName,
        previousName: hint.name,
        accountId: resolved.accountId,
        displayName,
      });
      continue;
    }
    if (resolved.candidates.length > 1) {
      ambiguous.push({ plannerName: hint.name, candidates: resolved.candidates });
      continue;
    }
    missing.push(hint.name);
  }

  // Persist interim map so identity helper can rewrite keys.
  await writeSquadJiraConfig(squadId, {
    ...current,
    assigneeMap,
    assigneesSyncedAt: new Date().toISOString(),
  });

  const identityResult = await applyResourceJiraIdentities(
    squadId,
    mapped.map((row) => ({
      currentName: row.previousName,
      accountId: row.accountId,
      displayName: row.displayName,
    })),
  );
  const config = await pruneAssigneeMapToRoster(squadId);

  return {
    config,
    mapped,
    missing,
    ambiguous,
    renames: identityResult.renames,
  };
};

/**
 * Persist explicit planner-name → Jira account mappings and rename to Jira display names.
 */
export const applyAssigneeMappings = async (
  squadId: string,
  mappings: Array<{ plannerName: string; accountId: string; displayName?: string }>,
): Promise<{ config: SquadJiraConfig; renames: Array<{ from: string; to: string }> }> => {
  await clearSquadResourceNicknames(squadId);
  const current = await readSquadJiraConfig(squadId);
  const assigneeMap = { ...current.assigneeMap };
  const identities = [];

  for (const row of mappings) {
    const name = row.plannerName.trim();
    const accountId = row.accountId.trim();
    const displayName = (row.displayName ?? row.plannerName).trim();
    if (!name || !accountId || !displayName) continue;

    for (const [existingName, existingId] of Object.entries(assigneeMap)) {
      if (
        existingId.trim() === accountId &&
        existingName.trim().toLowerCase() !== name.toLowerCase() &&
        existingName.trim().toLowerCase() !== displayName.toLowerCase()
      ) {
        throw Object.assign(
          new Error(`Jira account already mapped to "${existingName}"`),
          { status: 409 },
        );
      }
    }

    assigneeMap[name] = accountId;
    identities.push({ currentName: name, accountId, displayName });
  }

  await writeSquadJiraConfig(squadId, {
    ...current,
    assigneeMap,
    assigneesSyncedAt: new Date().toISOString(),
  });

  const identityResult = await applyResourceJiraIdentities(squadId, identities);
  const config = await pruneAssigneeMapToRoster(squadId);
  return { config, renames: identityResult.renames };
};

/**
 * Look up Jira users for unmapped planner names and persist squad assignee overrides.
 */
export const autoMapAssigneeNames = async (
  squadId: string,
  names: Array<string | PlannerNameHint>,
): Promise<{ config: SquadJiraConfig; mapped: AutoMappedAssignee[]; renames: Array<{ from: string; to: string }> }> => {
  const result = await syncAssigneeNamesFromJira(squadId, names, { replaceAll: false });
  return { config: result.config, mapped: result.mapped, renames: result.renames };
};
