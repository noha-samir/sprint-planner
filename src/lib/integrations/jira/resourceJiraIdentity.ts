import { prisma } from "@/lib/db/prisma";
import { readSquadJiraConfig, writeSquadJiraConfig } from "./configStore";
import type { SquadJiraConfig } from "./types";

export type ResourceJiraIdentity = {
  /** Current planner / DB resource name. */
  currentName: string;
  accountId: string;
  /** Exact Jira display name to use as the resource name. */
  displayName: string;
};

const sanitizeSquadKey = (squadId: string) => squadId.trim();

type PlannedRename =
  | { kind: "rename"; id: string; from: string; to: string }
  | { kind: "merge"; sourceId: string; targetId: string; from: string; to: string };

/**
 * Clear all resource nicknames and rename matched resources to exact Jira display names.
 * Also rewrites TaskAssignee.resourceName and assigneeMap keys.
 */
export const applyResourceJiraIdentities = async (
  squadId: string,
  identities: ResourceJiraIdentity[],
): Promise<{ config: SquadJiraConfig; renames: Array<{ from: string; to: string }> }> => {
  const safe = sanitizeSquadKey(squadId);
  const renames: Array<{ from: string; to: string }> = [];
  if (!safe) {
    const config = await readSquadJiraConfig(squadId);
    return { config, renames };
  }

  // Plan renames outside the interactive transaction — Neon drops long-held txs.
  await prisma.resource.updateMany({
    where: { squadId: safe },
    data: { nickname: null },
  });

  const resources = await prisma.resource.findMany({
    where: { squadId: safe },
    select: { id: true, name: true },
  });
  const byName = new Map(resources.map((row) => [row.name, row]));
  const planned: PlannedRename[] = [];

  for (const identity of identities) {
    const from = identity.currentName.trim();
    const to = identity.displayName.trim();
    const accountId = identity.accountId.trim();
    if (!from || !to || !accountId || from === to) continue;

    const source = byName.get(from);
    if (!source) continue;
    const conflict = byName.get(to);

    if (!conflict) {
      planned.push({ kind: "rename", id: source.id, from, to });
      byName.delete(from);
      byName.set(to, { id: source.id, name: to });
      renames.push({ from, to });
      continue;
    }

    if (conflict.id !== source.id) {
      // Keep existing Jira-named row; drop the short-name duplicate after remapping assignees.
      planned.push({ kind: "merge", sourceId: source.id, targetId: conflict.id, from, to });
      byName.delete(from);
      renames.push({ from, to });
    }
  }

  if (planned.length > 0) {
    await prisma.$transaction(
      async (tx) => {
        for (const step of planned) {
          if (step.kind === "rename") {
            await tx.resource.update({
              where: { id: step.id },
              data: { name: step.to, nickname: null },
            });
            await tx.taskAssignee.updateMany({
              where: { task: { squadId: safe }, resourceName: step.from },
              data: { resourceName: step.to },
            });
            continue;
          }
          await tx.taskAssignee.updateMany({
            where: { task: { squadId: safe }, resourceName: step.from },
            data: { resourceName: step.to },
          });
          await tx.resource.delete({ where: { id: step.sourceId } });
          await tx.resource.update({
            where: { id: step.targetId },
            data: { nickname: null },
          });
        }
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  }

  const current = await readSquadJiraConfig(safe);
  const roster = await prisma.resource.findMany({
    where: { squadId: safe },
    select: { name: true },
  });
  const resourceNames = new Set(roster.map((row) => row.name));

  // Keep only current roster keys — drop legacy short/full-name duplicates.
  const assigneeMap: Record<string, string> = {};
  const accountByOldName = { ...current.assigneeMap };
  for (const identity of identities) {
    const from = identity.currentName.trim();
    const to = identity.displayName.trim() || from;
    if (from && identity.accountId.trim()) {
      accountByOldName[from] = identity.accountId.trim();
    }
    if (to && identity.accountId.trim()) {
      accountByOldName[to] = identity.accountId.trim();
    }
  }
  for (const name of resourceNames) {
    const accountId = accountByOldName[name]?.trim();
    if (accountId) {
      assigneeMap[name] = accountId;
    }
  }

  const next: SquadJiraConfig = {
    ...current,
    assigneeMap,
    assigneesSyncedAt: new Date().toISOString(),
  };
  await writeSquadJiraConfig(safe, next);
  return { config: next, renames };
};

/**
 * Clear every nickname for a squad's resources.
 */
export const clearSquadResourceNicknames = async (squadId: string): Promise<void> => {
  const safe = sanitizeSquadKey(squadId);
  if (!safe) return;
  await prisma.resource.updateMany({
    where: { squadId: safe },
    data: { nickname: null },
  });
};

/**
 * Drop assignee-map rows that are not current Resources.
 */
export const pruneAssigneeMapToRoster = async (squadId: string): Promise<SquadJiraConfig> => {
  const safe = sanitizeSquadKey(squadId);
  const current = await readSquadJiraConfig(safe || squadId);
  if (!safe) return current;

  const resources = await prisma.resource.findMany({
    where: { squadId: safe },
    select: { name: true },
  });
  const keep = new Set(resources.map((row) => row.name));

  const assigneeMap: Record<string, string> = {};
  for (const [name, accountId] of Object.entries(current.assigneeMap)) {
    if (!keep.has(name)) continue;
    const id = accountId.trim();
    if (!id) continue;
    assigneeMap[name] = id;
  }

  const next: SquadJiraConfig = {
    ...current,
    assigneeMap,
    assigneesSyncedAt: new Date().toISOString(),
  };
  await writeSquadJiraConfig(safe, next);
  return next;
};
