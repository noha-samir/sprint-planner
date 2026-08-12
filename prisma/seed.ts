/**
 * One-time import of existing data/*.json into Postgres.
 * Usage: npm run db:seed
 * Requires DATABASE_URL (Neon) in .env.local or .env
 */
import { promises as fs } from "fs";
import path from "path";
import { PrismaClient, type UserRole } from "@prisma/client";

const prisma = new PrismaClient();
const DATA_DIR = path.join(process.cwd(), "data");

const readJson = async <T>(filePath: string): Promise<T | null> => {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const toRole = (role: string): UserRole => {
  if (role === "super_admin" || role === "em") return role;
  return "reviewer";
};

async function seedAccessControl() {
  const registry = await readJson<{
    squads: Array<{ id: string; name: string; emEmail: string; hidden?: boolean }>;
    users: Array<{ email: string; role: string; squadId: string | null }>;
    squadAccounts: Array<{ email: string; role: string; squadId: string | null }>;
  }>(path.join(DATA_DIR, "access-control.json"));
  if (!registry) return;

  for (const squad of registry.squads ?? []) {
    await prisma.squad.upsert({
      where: { id: squad.id },
      create: {
        id: squad.id,
        name: squad.name,
        emEmail: (squad.emEmail ?? "").toLowerCase(),
        hidden: Boolean(squad.hidden),
      },
      update: {
        name: squad.name,
        emEmail: (squad.emEmail ?? "").toLowerCase(),
        hidden: Boolean(squad.hidden),
      },
    });
  }

  await prisma.user.deleteMany({});
  if (registry.users?.length) {
    await prisma.user.createMany({
      data: registry.users.map((user) => ({
        email: user.email.toLowerCase(),
        role: toRole(user.role),
        squadId: user.squadId || registry.squads[0]?.id || "ventures",
      })),
    });
  }

  await prisma.squadAccount.deleteMany({});
  if (registry.squadAccounts?.length) {
    await prisma.squadAccount.createMany({
      data: registry.squadAccounts.map((user) => ({
        email: user.email.toLowerCase(),
        role: toRole(user.role),
        squadId: user.squadId || registry.squads[0]?.id || "ventures",
      })),
    });
  }
  console.log("Seeded access-control");
}

async function seedAppConfig() {
  const config = await readJson<{ allowedEmailDomain?: string }>(path.join(DATA_DIR, "app-config.json"));
  const domain = config?.allowedEmailDomain?.trim().toLowerCase() || "example.com";
  await prisma.appConfig.upsert({
    where: { id: 1 },
    create: { id: 1, allowedEmailDomain: domain },
    update: { allowedEmailDomain: domain },
  });
  console.log("Seeded app-config");
}

async function seedPlannerStates() {
  const files = await fs.readdir(DATA_DIR);
  for (const file of files) {
    const match = /^planner-state\.([a-z0-9_-]+)\.json$/i.exec(file);
    if (!match) continue;
    const squadId = match[1].toLowerCase();
    const payload = await readJson<Record<string, unknown>>(path.join(DATA_DIR, file));
    if (!payload) continue;

    await prisma.squad.upsert({
      where: { id: squadId },
      create: { id: squadId, name: squadId, emEmail: "", hidden: false },
      update: {},
    });

    const { writeSquadPlannerState } = await import("../src/lib/authz/squadStorage");
    await writeSquadPlannerState(squadId, payload);
    console.log(`Seeded planner-state.${squadId}`);
  }
}

async function seedJiraConfigs() {
  const files = await fs.readdir(DATA_DIR);
  for (const file of files) {
    const match = /^jira-config\.([a-z0-9_-]+)\.json$/i.exec(file);
    if (!match) continue;
    const squadId = match[1].toLowerCase();
    const raw = await readJson<Record<string, unknown>>(path.join(DATA_DIR, file));
    if (!raw) continue;
    await prisma.squad.upsert({
      where: { id: squadId },
      create: { id: squadId, name: squadId, emEmail: "", hidden: false },
      update: {},
    });
    const { writeSquadJiraConfig, readSquadJiraConfig } = await import(
      "../src/lib/integrations/jira/configStore"
    );
    const merged = await readSquadJiraConfig(squadId);
    // Apply file overrides onto defaults by writing through compact path
    const assigneeMap =
      raw.assigneeMap && typeof raw.assigneeMap === "object"
        ? { ...merged.assigneeMap, ...(raw.assigneeMap as Record<string, string>) }
        : merged.assigneeMap;
    await writeSquadJiraConfig(squadId, {
      ...merged,
      subtaskSquadOptionId:
        typeof raw.subtaskSquadOptionId === "string" ? raw.subtaskSquadOptionId : merged.subtaskSquadOptionId,
      assigneeMap,
    });
    console.log(`Seeded jira-config.${squadId}`);
  }
}

async function seedHistory() {
  const entries = await readJson<
    Array<{
      id: string;
      archivedAt: string;
      squadId: string;
      sprintStartDate: string;
      planningSunday: string;
      tasks: unknown;
      resources: unknown;
      config: unknown;
      summary?: { totalTasks?: number; carryOverTasks?: number; totalResources?: number };
    }>
  >(path.join(DATA_DIR, "sprint-history.json"));
  if (!Array.isArray(entries)) return;

  let imported = 0;
  let skipped = 0;
  for (const entry of entries) {
    const squadId = (entry.squadId || "ventures").toLowerCase();
    // Skip legacy stub squads not in the live access registry.
    if (squadId === "squad-1") {
      skipped += 1;
      continue;
    }
    await prisma.squad.upsert({
      where: { id: squadId },
      create: { id: squadId, name: squadId, emEmail: "", hidden: false },
      update: {},
    });
    const summary = entry.summary ?? {};
    await prisma.sprintHistory.upsert({
      where: { id: entry.id },
      create: {
        id: entry.id,
        squadId,
        archivedAt: new Date(entry.archivedAt),
        sprintStartDate: entry.sprintStartDate,
        planningSunday: entry.planningSunday,
        tasksSnapshot: entry.tasks ?? [],
        resourcesSnapshot: entry.resources ?? [],
        configSnapshot: entry.config ?? {},
        totalTasks: Number(summary.totalTasks) || 0,
        carryOverTasks: Number(summary.carryOverTasks) || 0,
        totalResources: Number(summary.totalResources) || 0,
      },
      update: {
        archivedAt: new Date(entry.archivedAt),
        sprintStartDate: entry.sprintStartDate,
        planningSunday: entry.planningSunday,
        tasksSnapshot: entry.tasks ?? [],
        resourcesSnapshot: entry.resources ?? [],
        configSnapshot: entry.config ?? {},
        totalTasks: Number(summary.totalTasks) || 0,
        carryOverTasks: Number(summary.carryOverTasks) || 0,
        totalResources: Number(summary.totalResources) || 0,
      },
    });
    imported += 1;
  }
  console.log(`Seeded sprint-history (${imported} rows, skipped ${skipped})`);
}

async function seedSessionVersions() {
  const raw = await readJson<Record<string, unknown> | { versions?: Record<string, number> }>(
    path.join(DATA_DIR, "session-versions.json"),
  );
  if (!raw || typeof raw !== "object") return;
  const map =
    "versions" in raw && raw.versions && typeof raw.versions === "object"
      ? raw.versions
      : (raw as Record<string, number>);
  const entries = Object.entries(map).filter(
    ([email, version]) => email.trim() && email !== "versions" && Number.isFinite(Number(version)),
  );
  for (const [email, version] of entries) {
    await prisma.sessionVersion.upsert({
      where: { email: email.trim().toLowerCase() },
      create: { email: email.trim().toLowerCase(), version: Math.max(0, Number(version) || 0) },
      update: { version: Math.max(0, Number(version) || 0) },
    });
  }
  console.log(`Seeded session-versions (${entries.length} rows)`);
}

async function seedJiraAccounts() {
  const encPath = path.join(DATA_DIR, "jira-accounts.enc");
  try {
    await fs.access(encPath);
  } catch {
    return;
  }
  if (!process.env.AUTH_SECRET?.trim()) {
    console.warn("Skipping jira-accounts.enc seed (AUTH_SECRET missing)");
    return;
  }
  try {
    const { decryptSecret } = await import("../src/lib/crypto/secretBox");
    const raw = await fs.readFile(encPath, "utf-8");
    const decrypted = decryptSecret(raw.trim());
    const parsed = JSON.parse(decrypted) as Record<string, { accountId?: string } | string>;
    let count = 0;
    for (const [email, value] of Object.entries(parsed)) {
      const accountId =
        typeof value === "string"
          ? value
          : value && typeof value === "object"
            ? value.accountId
            : undefined;
      if (!email.trim() || !accountId?.trim()) continue;
      await prisma.jiraAccount.upsert({
        where: { email: email.trim().toLowerCase() },
        create: { email: email.trim().toLowerCase(), accountId: accountId.trim() },
        update: { accountId: accountId.trim() },
      });
      count += 1;
    }
    console.log(`Seeded jira-accounts (${count} rows)`);
  } catch (error) {
    console.warn("Skipping jira-accounts.enc seed:", error instanceof Error ? error.message : error);
  }
}

async function main() {
  const confirmed =
    process.env.ALLOW_DB_SEED === "1" ||
    process.env.ALLOW_DB_SEED === "true" ||
    process.argv.includes("--confirm-seed");
  if (!confirmed) {
    throw new Error(
      "Refusing to seed without ALLOW_DB_SEED=1 or --confirm-seed (replaces registry users and imports data/*).",
    );
  }
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DB_SEED !== "1") {
    throw new Error("Refusing to seed in production without ALLOW_DB_SEED=1.");
  }

  await seedAccessControl();
  await seedAppConfig();
  await seedPlannerStates();
  await seedJiraConfigs();
  await seedHistory();
  await seedSessionVersions();
  await seedJiraAccounts();
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Seed complete");
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
