import { appEnv } from "@/lib/config/env";
import { sanitizeSquadKey } from "@/lib/authz/permissions";
import { prisma } from "@/lib/db/prisma";
import {
  defaultSquadJiraConfig,
  type JiraParentStoryFieldIds,
  type SquadJiraConfig,
} from "./types";
import { normalizeJiraSiteUrl } from "./credentials";

const mergeParentStoryFields = (
  current: JiraParentStoryFieldIds,
  incoming?: Partial<JiraParentStoryFieldIds>,
): JiraParentStoryFieldIds => ({
  ...current,
  ...incoming,
});

const normalizeConfig = (parsed: Record<string, unknown>): SquadJiraConfig => {
  const defaults = defaultSquadJiraConfig();
  const legacyProduct = parsed.predefinedRoles as { product?: { displayName?: string } } | undefined;

  return {
    siteUrl:
      typeof parsed.siteUrl === "string" ? normalizeJiraSiteUrl(parsed.siteUrl) : defaults.siteUrl,
    projectKey: typeof parsed.projectKey === "string" ? parsed.projectKey : defaults.projectKey,
    issueTypeSubTask:
      typeof parsed.issueTypeSubTask === "string" ? parsed.issueTypeSubTask : defaults.issueTypeSubTask,
    productManagerName:
      typeof parsed.productManagerName === "string"
        ? parsed.productManagerName
        : legacyProduct?.product?.displayName?.trim() || defaults.productManagerName,
    productManagerJiraAccountId:
      typeof parsed.productManagerJiraAccountId === "string"
        ? parsed.productManagerJiraAccountId
        : defaults.productManagerJiraAccountId,
    parentStoryFields: mergeParentStoryFields(
      defaults.parentStoryFields,
      parsed.parentStoryFields as Partial<JiraParentStoryFieldIds> | undefined,
    ),
    qcEngineerFieldIsUser:
      typeof parsed.qcEngineerFieldIsUser === "boolean"
        ? parsed.qcEngineerFieldIsUser
        : defaults.qcEngineerFieldIsUser,
    productManagerFieldIsUser:
      typeof parsed.productManagerFieldIsUser === "boolean"
        ? parsed.productManagerFieldIsUser
        : defaults.productManagerFieldIsUser,
    subtaskSquadFieldId:
      typeof parsed.subtaskSquadFieldId === "string" ? parsed.subtaskSquadFieldId : defaults.subtaskSquadFieldId,
    subtaskSquadOptionId:
      typeof parsed.subtaskSquadOptionId === "string" ? parsed.subtaskSquadOptionId : defaults.subtaskSquadOptionId,
    assigneeMap:
      parsed.assigneeMap && typeof parsed.assigneeMap === "object"
        ? (parsed.assigneeMap as Record<string, string>)
        : defaults.assigneeMap,
    assigneesSyncedAt:
      typeof parsed.assigneesSyncedAt === "string"
        ? parsed.assigneesSyncedAt
        : parsed.assigneesSyncedAt instanceof Date
          ? parsed.assigneesSyncedAt.toISOString()
          : null,
  };
};

const parentFieldKeys: (keyof JiraParentStoryFieldIds)[] = [
  "developmentEstimateHours",
  "testingEstimateHours",
  "qcEngineer",
  "productManager",
  "branchName",
];

const fieldColumnByKey: Record<keyof JiraParentStoryFieldIds, string> = {
  developmentEstimateHours: "developmentEstimateFieldId",
  testingEstimateHours: "testingEstimateFieldId",
  qcEngineer: "qcEngineerFieldId",
  productManager: "productManagerFieldId",
  branchName: "branchNameFieldId",
};

/** Persist full squad Jira product config (no env fallbacks). */
const compactSquadJiraConfigForStorage = (config: SquadJiraConfig): Record<string, unknown> => {
  const stored: Record<string, unknown> = {
    siteUrl: normalizeJiraSiteUrl(config.siteUrl) || null,
    projectKey: config.projectKey.trim() || null,
    issueTypeSubTask: config.issueTypeSubTask.trim() || "Sub-task",
    productManagerName: config.productManagerName.trim() || null,
    productManagerJiraAccountId: config.productManagerJiraAccountId.trim() || null,
    qcEngineerFieldIsUser: config.qcEngineerFieldIsUser,
    productManagerFieldIsUser: config.productManagerFieldIsUser,
    subtaskSquadFieldId: config.subtaskSquadFieldId.trim() || null,
    subtaskSquadOptionId: config.subtaskSquadOptionId.trim() || null,
    assigneesSyncedAt: config.assigneesSyncedAt ? new Date(config.assigneesSyncedAt) : null,
  };

  for (const key of parentFieldKeys) {
    const value = config.parentStoryFields[key]?.trim() ?? "";
    stored[fieldColumnByKey[key]] = value || null;
  }

  stored.assigneeMap = Object.fromEntries(
    Object.entries(config.assigneeMap).filter(([name, accountId]) => name.trim() && accountId.trim()),
  );

  return stored;
};

async function ensureSquadExists(squadId: string): Promise<void> {
  const existing = await prisma.squad.findUnique({ where: { id: squadId }, select: { id: true } });
  if (!existing) {
    throw new Error(`Unknown squad "${squadId}". Provision it in user management first.`);
  }
}

/**
 * Resolve Jira Cloud site URL from DB (prefer squad, then default squad, then any configured squad).
 */
export async function resolveJiraSiteUrl(squadId?: string | null): Promise<string> {
  const preferred = sanitizeSquadKey(squadId ?? null) || sanitizeSquadKey(appEnv.defaultSquadId);
  if (preferred) {
    const row = await prisma.squadJiraConfig.findUnique({
      where: { squadId: preferred },
      select: { siteUrl: true },
    });
    const fromPreferred = normalizeJiraSiteUrl(row?.siteUrl ?? "");
    if (fromPreferred) return fromPreferred;
  }

  const any = await prisma.squadJiraConfig.findFirst({
    where: { siteUrl: { not: null } },
    select: { siteUrl: true },
    orderBy: { updatedAt: "desc" },
  });
  return normalizeJiraSiteUrl(any?.siteUrl ?? "");
}

export async function readSquadJiraConfig(squadId: string): Promise<SquadJiraConfig> {
  const safe = sanitizeSquadKey(squadId);
  if (!safe) {
    return defaultSquadJiraConfig();
  }
  const row = await prisma.squadJiraConfig.findUnique({
    where: { squadId: safe },
    include: { assignees: true },
  });
  if (!row) {
    return defaultSquadJiraConfig();
  }
  const assigneeMap = Object.fromEntries(row.assignees.map((a) => [a.resourceName, a.jiraAccountId]));
  return normalizeConfig({
    siteUrl: row.siteUrl ?? undefined,
    projectKey: row.projectKey ?? undefined,
    issueTypeSubTask: row.issueTypeSubTask ?? undefined,
    productManagerName: row.productManagerName ?? undefined,
    productManagerJiraAccountId: row.productManagerJiraAccountId ?? undefined,
    parentStoryFields: {
      developmentEstimateHours: row.developmentEstimateFieldId ?? "",
      testingEstimateHours: row.testingEstimateFieldId ?? "",
      qcEngineer: row.qcEngineerFieldId ?? "",
      productManager: row.productManagerFieldId ?? "",
      branchName: row.branchNameFieldId ?? "",
    },
    qcEngineerFieldIsUser: row.qcEngineerFieldIsUser ?? undefined,
    productManagerFieldIsUser: row.productManagerFieldIsUser ?? undefined,
    subtaskSquadFieldId: row.subtaskSquadFieldId ?? undefined,
    subtaskSquadOptionId: row.subtaskSquadOptionId ?? undefined,
    assigneeMap,
    assigneesSyncedAt: row.assigneesSyncedAt ?? undefined,
  });
}

export async function writeSquadJiraConfig(squadId: string, config: SquadJiraConfig): Promise<void> {
  const safe = sanitizeSquadKey(squadId);
  if (!safe) {
    throw new Error("Invalid squad id");
  }
  await ensureSquadExists(safe);
  const compact = compactSquadJiraConfigForStorage(config);
  const assigneeMap =
    compact.assigneeMap && typeof compact.assigneeMap === "object"
      ? (compact.assigneeMap as Record<string, string>)
      : {};

  await prisma.$transaction(async (tx) => {
    await tx.squadJiraConfig.upsert({
      where: { squadId: safe },
      create: {
        squadId: safe,
        siteUrl: typeof compact.siteUrl === "string" ? compact.siteUrl : null,
        projectKey: typeof compact.projectKey === "string" ? compact.projectKey : null,
        issueTypeSubTask: typeof compact.issueTypeSubTask === "string" ? compact.issueTypeSubTask : null,
        productManagerName: typeof compact.productManagerName === "string" ? compact.productManagerName : null,
        productManagerJiraAccountId:
          typeof compact.productManagerJiraAccountId === "string" ? compact.productManagerJiraAccountId : null,
        developmentEstimateFieldId:
          typeof compact.developmentEstimateFieldId === "string" ? compact.developmentEstimateFieldId : null,
        testingEstimateFieldId:
          typeof compact.testingEstimateFieldId === "string" ? compact.testingEstimateFieldId : null,
        qcEngineerFieldId: typeof compact.qcEngineerFieldId === "string" ? compact.qcEngineerFieldId : null,
        productManagerFieldId:
          typeof compact.productManagerFieldId === "string" ? compact.productManagerFieldId : null,
        branchNameFieldId: typeof compact.branchNameFieldId === "string" ? compact.branchNameFieldId : null,
        qcEngineerFieldIsUser:
          typeof compact.qcEngineerFieldIsUser === "boolean" ? compact.qcEngineerFieldIsUser : null,
        productManagerFieldIsUser:
          typeof compact.productManagerFieldIsUser === "boolean" ? compact.productManagerFieldIsUser : null,
        subtaskSquadFieldId:
          typeof compact.subtaskSquadFieldId === "string" ? compact.subtaskSquadFieldId : null,
        subtaskSquadOptionId:
          typeof compact.subtaskSquadOptionId === "string" ? compact.subtaskSquadOptionId : null,
        assigneesSyncedAt:
          compact.assigneesSyncedAt instanceof Date ? compact.assigneesSyncedAt : null,
      },
      update: {
        siteUrl: typeof compact.siteUrl === "string" ? compact.siteUrl : null,
        projectKey: typeof compact.projectKey === "string" ? compact.projectKey : null,
        issueTypeSubTask: typeof compact.issueTypeSubTask === "string" ? compact.issueTypeSubTask : null,
        productManagerName: typeof compact.productManagerName === "string" ? compact.productManagerName : null,
        productManagerJiraAccountId:
          typeof compact.productManagerJiraAccountId === "string" ? compact.productManagerJiraAccountId : null,
        developmentEstimateFieldId:
          typeof compact.developmentEstimateFieldId === "string" ? compact.developmentEstimateFieldId : null,
        testingEstimateFieldId:
          typeof compact.testingEstimateFieldId === "string" ? compact.testingEstimateFieldId : null,
        qcEngineerFieldId: typeof compact.qcEngineerFieldId === "string" ? compact.qcEngineerFieldId : null,
        productManagerFieldId:
          typeof compact.productManagerFieldId === "string" ? compact.productManagerFieldId : null,
        branchNameFieldId: typeof compact.branchNameFieldId === "string" ? compact.branchNameFieldId : null,
        qcEngineerFieldIsUser:
          typeof compact.qcEngineerFieldIsUser === "boolean" ? compact.qcEngineerFieldIsUser : null,
        productManagerFieldIsUser:
          typeof compact.productManagerFieldIsUser === "boolean" ? compact.productManagerFieldIsUser : null,
        subtaskSquadFieldId:
          typeof compact.subtaskSquadFieldId === "string" ? compact.subtaskSquadFieldId : null,
        subtaskSquadOptionId:
          typeof compact.subtaskSquadOptionId === "string" ? compact.subtaskSquadOptionId : null,
        assigneesSyncedAt:
          compact.assigneesSyncedAt instanceof Date
            ? compact.assigneesSyncedAt
            : compact.assigneesSyncedAt === null
              ? null
              : undefined,
      },
    });

    await tx.jiraAssigneeMap.deleteMany({ where: { squadId: safe } });
    const resources = await tx.resource.findMany({
      where: { squadId: safe },
      select: { id: true, name: true },
    });
    const resourceIdByName = new Map(resources.map((row) => [row.name, row.id]));
    const rows = Object.entries(assigneeMap)
      .filter(([name, accountId]) => name.trim() && accountId.trim())
      .map(([resourceName, jiraAccountId]) => ({
        squadId: safe,
        resourceName,
        jiraAccountId,
        resourceId: resourceIdByName.get(resourceName) ?? null,
      }));
    if (rows.length > 0) {
      await tx.jiraAssigneeMap.createMany({ data: rows });
    }
  });
}

export async function deleteSquadJiraConfig(squadId: string): Promise<void> {
  const safe = sanitizeSquadKey(squadId);
  if (!safe) return;
  await prisma.squadJiraConfig.deleteMany({ where: { squadId: safe } });
}
