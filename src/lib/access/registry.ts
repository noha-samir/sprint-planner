import { type UserRole as PrismaUserRole } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { appEnv, authEnv } from "@/lib/config/env";
import type { UserRole } from "./control";

export interface Squad {
  id: string;
  name: string;
  emEmail: string;
  hidden?: boolean;
}

export interface UserAccount {
  email: string;
  role: UserRole;
  squadId: string | null;
}

export interface AccessRegistry {
  squads: Squad[];
  users: UserAccount[];
  squadAccounts: UserAccount[];
}

const DEFAULT_SQUAD_ID = appEnv.defaultSquadId;
const SUPER_ADMIN_EMAIL = authEnv.superAdminEmail;

const defaultRegistry = (): AccessRegistry => ({
  squads: [{ id: DEFAULT_SQUAD_ID, name: "Ventures", emEmail: SUPER_ADMIN_EMAIL || "admin@localhost" }],
  users: SUPER_ADMIN_EMAIL
    ? [{ email: SUPER_ADMIN_EMAIL, role: "super_admin", squadId: DEFAULT_SQUAD_ID }]
    : [],
  squadAccounts: [],
});

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const normalizeSquadId = (squadId: string | null | undefined): string => {
  const normalized = (squadId ?? "").trim().toLowerCase();
  if (!normalized || normalized === "default") {
    return DEFAULT_SQUAD_ID;
  }
  if (normalized === "ventures") {
    return DEFAULT_SQUAD_ID;
  }
  return normalized;
};

const toPrismaRole = (role: UserRole): PrismaUserRole => {
  if (role === "super_admin" || role === "em" || role === "editor") {
    return role as PrismaUserRole;
  }
  return "reviewer";
};

const coerceRegistryRole = (role: unknown): UserRole => {
  if (role === "super_admin" || role === "em" || role === "editor" || role === "reviewer") return role;
  return "reviewer";
};

const normalizeRegistry = (value: AccessRegistry): AccessRegistry => {
  const fallback = defaultRegistry();
  const squads = value.squads
    .filter((item) => !!item && typeof item.id === "string" && typeof item.name === "string")
    .map((item) => ({
      id: normalizeSquadId(item.id),
      name: item.name.trim() || "Unnamed Squad",
      emEmail: normalizeEmail(item.emEmail ?? ""),
      hidden: Boolean(item.hidden),
    }));
  const uniqueSquads = squads.filter(
    (squad, index, arr) => arr.findIndex((candidate) => candidate.id === squad.id) === index,
  );
  const users = value.users
    .filter((item) => !!item && typeof item.email === "string" && item.email.trim())
    .map((item) => ({
      email: normalizeEmail(item.email),
      role: coerceRegistryRole(item.role),
      squadId: normalizeSquadId(item.squadId),
    }));
  const squadAccounts = value.squadAccounts
    .filter((item) => !!item && typeof item.email === "string" && item.email.trim())
    .map((item) => ({
      email: normalizeEmail(item.email),
      role: coerceRegistryRole(item.role),
      squadId: normalizeSquadId(item.squadId),
    }));
  if (SUPER_ADMIN_EMAIL && !users.some((user) => user.role === "super_admin")) {
    if (!users.some((user) => user.email === SUPER_ADMIN_EMAIL)) {
      users.push({
        email: SUPER_ADMIN_EMAIL,
        role: "super_admin",
        squadId: uniqueSquads[0]?.id ?? DEFAULT_SQUAD_ID,
      });
    }
  }
  return {
    squads: uniqueSquads.length > 0 ? uniqueSquads : fallback.squads,
    users: users.length > 0 ? users : fallback.users,
    squadAccounts,
  };
};

async function loadRegistryFromDb(): Promise<AccessRegistry | null> {
  const [squads, users, squadAccounts] = await Promise.all([
    prisma.squad.findMany({ orderBy: { id: "asc" } }),
    prisma.user.findMany({ orderBy: { email: "asc" } }),
    prisma.squadAccount.findMany({ orderBy: { email: "asc" } }),
  ]);
  if (squads.length === 0 && users.length === 0) {
    return null;
  }
  return {
    squads: squads.map((s) => ({
      id: s.id,
      name: s.name,
      emEmail: s.emEmail,
      hidden: s.hidden,
    })),
    users: users.map((u) => ({
      email: u.email,
      role: u.role as UserRole,
      squadId: u.squadId,
    })),
    squadAccounts: squadAccounts.map((u) => ({
      email: u.email,
      role: u.role as UserRole,
      squadId: u.squadId,
    })),
  };
}

const allowBootstrap = (): boolean =>
  process.env.ALLOW_REGISTRY_BOOTSTRAP === "1" || process.env.ALLOW_REGISTRY_BOOTSTRAP === "true";

/**
 * Load squads, users, and squadAccounts from Postgres (optionally bootstrap on first empty DB).
 */
export const readAccessRegistry = async (): Promise<AccessRegistry> => {
  const fromDb = await loadRegistryFromDb();
  if (!fromDb) {
    if (!allowBootstrap()) {
      throw new Error(
        "Access registry is empty. Seed the database or set ALLOW_REGISTRY_BOOTSTRAP=1 for first boot.",
      );
    }
    const fallback = defaultRegistry();
    if (fallback.users.length === 0) {
      throw new Error("Cannot bootstrap registry without AUTH_SUPER_ADMIN_EMAIL.");
    }
    await writeAccessRegistry(fallback, { allowSquadDeletion: false });
    return fallback;
  }
  return normalizeRegistry(fromDb);
};

export type WriteAccessRegistryOptions = {
  /** When true, squads missing from the payload are hard-deleted (cascade). Default false. */
  allowSquadDeletion?: boolean;
};

/**
 * Persist the access registry. By default does not hard-delete missing squads.
 */
export const writeAccessRegistry = async (
  registry: AccessRegistry,
  options?: WriteAccessRegistryOptions,
): Promise<void> => {
  const normalized = normalizeRegistry(registry);
  const allowSquadDeletion = Boolean(options?.allowSquadDeletion);

  await prisma.$transaction(async (tx) => {
    for (const squad of normalized.squads) {
      await tx.squad.upsert({
        where: { id: squad.id },
        create: {
          id: squad.id,
          name: squad.name,
          emEmail: squad.emEmail,
          hidden: Boolean(squad.hidden),
        },
        update: {
          name: squad.name,
          emEmail: squad.emEmail,
          hidden: Boolean(squad.hidden),
        },
      });
    }

    await tx.user.deleteMany({});
    await tx.squadAccount.deleteMany({});

    if (allowSquadDeletion) {
      const keepSquadIds = normalized.squads.map((s) => s.id);
      if (keepSquadIds.length > 0) {
        await tx.squad.deleteMany({
          where: { id: { notIn: keepSquadIds } },
        });
      }
    }

    if (normalized.users.length > 0) {
      await tx.user.createMany({
        data: normalized.users.map((user) => ({
          email: user.email,
          role: toPrismaRole(user.role),
          squadId: user.squadId ?? DEFAULT_SQUAD_ID,
        })),
      });
    }

    if (normalized.squadAccounts.length > 0) {
      await tx.squadAccount.createMany({
        data: normalized.squadAccounts.map((user) => ({
          email: user.email,
          role: toPrismaRole(user.role),
          squadId: user.squadId ?? DEFAULT_SQUAD_ID,
        })),
      });
    }
  });
};

/** Look up a provisioned account. Returns null when the email is not in the registry. */
/**
 * Resolve the primary User or SquadAccount row for an email, with a fallback squad id.
 */
export const resolveUserAccount = async (email: string): Promise<UserAccount | null> => {
  const normalized = normalizeEmail(email);
  const registry = await readAccessRegistry();
  const fallbackSquadId =
    registry.squads.find((item) => !item.hidden)?.id ?? registry.squads[0]?.id ?? DEFAULT_SQUAD_ID;
  const user = registry.users.find((item) => item.email === normalized);
  const squadAccount = registry.squadAccounts.find((item) => item.email === normalized);
  if (user) return { ...user, squadId: user.squadId ?? fallbackSquadId };
  if (squadAccount) return { ...squadAccount, squadId: squadAccount.squadId ?? fallbackSquadId };
  return null;
};
