import { prisma } from "@/lib/db/prisma";
import { SQUAD_CAPACITY_HOURS_MAX, type ResourceType } from "@/lib/scheduler/types";
import { readSquadJiraConfig, writeSquadJiraConfig } from "./configStore";
import {
  applyResourceJiraIdentities,
  pruneAssigneeMapToRoster,
} from "./resourceJiraIdentity";
import type { SquadJiraConfig } from "./types";
import { requireJiraApiCredentials } from "@/lib/authz/sessionJiraCredentials";
import { fetchJiraUserByAccountId } from "./userSearch";

const normalizeName = (value: string) => value.trim().toLowerCase();

export type MappedResourceResult = {
  resource: {
    name: string;
    type: ResourceType;
    ownershipMode: "shared";
    ourSquadHours: number;
    capacityHours: number;
  };
  config: SquadJiraConfig;
  renames: Array<{ from: string; to: string }>;
};

/**
 * Create a roster person from an exact Jira account pick.
 * Rejects duplicate accountId or displayName (case-insensitive) in the squad.
 */
export const createMappedResource = async (
  squadId: string,
  params: {
    type: ResourceType;
    accountId: string;
    displayName: string;
    capacityHours: number;
  },
): Promise<MappedResourceResult> => {
  const safe = squadId.trim();
  const accountId = params.accountId.trim();
  const displayName = params.displayName.trim();
  const type = params.type;
  const capacityHours = Math.max(
    0,
    Math.min(SQUAD_CAPACITY_HOURS_MAX, Number(params.capacityHours) || 0),
  );

  if (!safe || !accountId || !displayName) {
    throw new Error("Missing squad, account, or display name");
  }

  const current = await readSquadJiraConfig(safe);
  for (const [name, mappedId] of Object.entries(current.assigneeMap)) {
    if (mappedId.trim() === accountId) {
      throw Object.assign(new Error(`Jira account already mapped to "${name}"`), { status: 409 });
    }
  }

  const existing = await prisma.resource.findMany({
    where: { squadId: safe },
    select: { id: true, name: true },
  });
  const nameTaken = existing.find((row) => normalizeName(row.name) === normalizeName(displayName));
  if (nameTaken) {
    throw Object.assign(new Error(`Resource "${nameTaken.name}" already exists`), { status: 409 });
  }

  await prisma.resource.create({
    data: {
      squadId: safe,
      name: displayName,
      type,
      ownershipMode: "shared",
      ourSquadHours: capacityHours,
      capacityHours,
      nickname: null,
    },
  });

  const assigneeMap = { ...current.assigneeMap, [displayName]: accountId };
  await writeSquadJiraConfig(safe, {
    ...current,
    assigneeMap,
    assigneesSyncedAt: new Date().toISOString(),
  });

  const identityResult = await applyResourceJiraIdentities(safe, [
    { currentName: displayName, accountId, displayName },
  ]);
  const config = await pruneAssigneeMapToRoster(safe);

  return {
    resource: {
      name: displayName,
      type,
      ownershipMode: "shared",
      ourSquadHours: capacityHours,
      capacityHours,
    },
    config,
    renames: identityResult.renames,
  };
};

/**
 * Re-fetch Jira display names for every mapped roster account and rename resources to match.
 */
export const refreshMappedIdentitiesFromJira = async (
  squadId: string,
): Promise<{ config: SquadJiraConfig; renames: Array<{ from: string; to: string }> }> => {
  const safe = squadId.trim();
  const credentials = await requireJiraApiCredentials(safe);
  const current = await readSquadJiraConfig(safe);
  const resources = await prisma.resource.findMany({
    where: { squadId: safe },
    select: { name: true },
  });

  const identities: Array<{ currentName: string; accountId: string; displayName: string }> = [];
  for (const row of resources) {
    const accountId = current.assigneeMap[row.name]?.trim() ?? "";
    if (!accountId) continue;
    const user = await fetchJiraUserByAccountId(credentials, accountId);
    const displayName = user?.displayName.trim() || row.name;
    identities.push({ currentName: row.name, accountId, displayName });
  }

  if (identities.length === 0) {
    const config = await pruneAssigneeMapToRoster(safe);
    return { config, renames: [] };
  }

  // Persist interim keys so identity rewrite can move account IDs with renames.
  const interimMap = { ...current.assigneeMap };
  for (const identity of identities) {
    interimMap[identity.currentName] = identity.accountId;
    interimMap[identity.displayName] = identity.accountId;
  }
  await writeSquadJiraConfig(safe, {
    ...current,
    assigneeMap: interimMap,
    assigneesSyncedAt: new Date().toISOString(),
  });

  const identityResult = await applyResourceJiraIdentities(safe, identities);
  const config = await pruneAssigneeMapToRoster(safe);
  return { config, renames: identityResult.renames };
};
