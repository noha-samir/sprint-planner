/**
 * One-time: copy legacy Jira product env vars into SquadJiraConfig for every squad.
 * Run: npx dotenv -e .env.local -e .env -- tsx scripts/seed-jira-config-from-env.mts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const trim = (value: string | undefined) => value?.trim() ?? "";

const parseBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const parseAssigneeMap = (raw: string | undefined): Record<string, string> => {
  const trimmed = raw?.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" && typeof entry[1] === "string" && entry[1].trim().length > 0,
      ),
    );
  } catch {
    return {};
  }
};

const normalizeSiteUrl = (raw: string): string => {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

async function main() {
  const siteUrl = normalizeSiteUrl(trim(process.env.JIRA_SITE_URL));
  const projectKey = trim(process.env.JIRA_PROJECT_KEY);
  const issueTypeSubTask = trim(process.env.JIRA_ISSUE_TYPE_SUB_TASK) || "Sub-task";
  const subtaskSquadFieldId = trim(process.env.JIRA_FIELD_SQUAD);
  const developmentEstimateFieldId = trim(process.env.JIRA_FIELD_DEVELOPMENT_ESTIMATE_HOURS);
  const testingEstimateFieldId = trim(process.env.JIRA_FIELD_TESTING_ESTIMATE_HOURS);
  const qcEngineerFieldId = trim(process.env.JIRA_FIELD_QC_ENGINEER);
  const productManagerFieldId = trim(process.env.JIRA_FIELD_PRODUCT_MANAGER);
  const branchNameFieldId = trim(process.env.JIRA_FIELD_BRANCH_NAME);
  const qcEngineerFieldIsUser = parseBool(process.env.JIRA_QC_ENGINEER_FIELD_IS_USER, true);
  const productManagerFieldIsUser = parseBool(process.env.JIRA_PRODUCT_MANAGER_FIELD_IS_USER, true);
  const assigneeMap = parseAssigneeMap(process.env.JIRA_ASSIGNEE_MAP);

  if (!siteUrl && !projectKey && Object.keys(assigneeMap).length === 0) {
    console.log("No legacy Jira env values found — nothing to seed.");
    return;
  }

  const squads = await prisma.squad.findMany({ select: { id: true } });
  console.log(`Seeding Jira config for ${squads.length} squad(s)…`);

  for (const squad of squads) {
    const existing = await prisma.squadJiraConfig.findUnique({ where: { squadId: squad.id } });
    await prisma.squadJiraConfig.upsert({
      where: { squadId: squad.id },
      create: {
        squadId: squad.id,
        siteUrl: siteUrl || null,
        projectKey: projectKey || null,
        issueTypeSubTask,
        developmentEstimateFieldId: developmentEstimateFieldId || null,
        testingEstimateFieldId: testingEstimateFieldId || null,
        qcEngineerFieldId: qcEngineerFieldId || null,
        productManagerFieldId: productManagerFieldId || null,
        branchNameFieldId: branchNameFieldId || null,
        qcEngineerFieldIsUser,
        productManagerFieldIsUser,
        subtaskSquadFieldId: subtaskSquadFieldId || null,
      },
      update: {
        siteUrl: existing?.siteUrl?.trim() ? existing.siteUrl : siteUrl || existing?.siteUrl,
        projectKey: existing?.projectKey?.trim() ? existing.projectKey : projectKey || existing?.projectKey,
        issueTypeSubTask: existing?.issueTypeSubTask?.trim()
          ? existing.issueTypeSubTask
          : issueTypeSubTask,
        developmentEstimateFieldId: existing?.developmentEstimateFieldId?.trim()
          ? existing.developmentEstimateFieldId
          : developmentEstimateFieldId || null,
        testingEstimateFieldId: existing?.testingEstimateFieldId?.trim()
          ? existing.testingEstimateFieldId
          : testingEstimateFieldId || null,
        qcEngineerFieldId: existing?.qcEngineerFieldId?.trim()
          ? existing.qcEngineerFieldId
          : qcEngineerFieldId || null,
        productManagerFieldId: existing?.productManagerFieldId?.trim()
          ? existing.productManagerFieldId
          : productManagerFieldId || null,
        branchNameFieldId: existing?.branchNameFieldId?.trim()
          ? existing.branchNameFieldId
          : branchNameFieldId || null,
        subtaskSquadFieldId: existing?.subtaskSquadFieldId?.trim()
          ? existing.subtaskSquadFieldId
          : subtaskSquadFieldId || null,
        qcEngineerFieldIsUser: existing?.qcEngineerFieldIsUser ?? qcEngineerFieldIsUser,
        productManagerFieldIsUser: existing?.productManagerFieldIsUser ?? productManagerFieldIsUser,
      },
    });

    const resources = await prisma.resource.findMany({
      where: { squadId: squad.id },
      select: { id: true, name: true },
    });
    const resourceIdByName = new Map(resources.map((row) => [row.name, row.id]));

    for (const [resourceName, jiraAccountId] of Object.entries(assigneeMap)) {
      if (!resourceName.trim() || !jiraAccountId.trim()) continue;
      await prisma.jiraAssigneeMap.upsert({
        where: { squadId_resourceName: { squadId: squad.id, resourceName } },
        create: {
          squadId: squad.id,
          resourceName,
          jiraAccountId,
          resourceId: resourceIdByName.get(resourceName) ?? null,
        },
        update: {
          jiraAccountId,
          resourceId: resourceIdByName.get(resourceName) ?? null,
        },
      });
    }
  }

  console.log("Done. You can remove Jira product keys from .env.local now.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
