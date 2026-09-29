import { prisma } from "@/lib/db/prisma";
import type { AccessRegistry, UserAccount } from "@/lib/access/registry";

const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** How long a looked-up session version is trusted before asking the database again. */
export const SESSION_VERSION_CACHE_MS = 30_000;

type CachedSessionVersion = { version: number; expiresAt: number };

// Shared through globalThis so the proxy and every route bundle use one cache per server process.
const globalForSessionVersions = globalThis as unknown as {
  sessionVersionCache: Map<string, CachedSessionVersion> | undefined;
};
const sessionVersionCache = (globalForSessionVersions.sessionVersionCache ??= new Map());

/**
 * Current session version for an email (0 if never revoked).
 * Cached per server process for SESSION_VERSION_CACHE_MS, so a revocation made on another
 * server instance takes effect within that window (instantly on the instance that revoked).
 */
export const getSessionVersion = async (email: string): Promise<number> => {
  const key = normalizeEmail(email);
  const cached = sessionVersionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.version;
  }
  const row = await prisma.sessionVersion.findUnique({ where: { email: key } });
  const version = row?.version ?? 0;
  sessionVersionCache.set(key, { version, expiresAt: Date.now() + SESSION_VERSION_CACHE_MS });
  return version;
};

/**
 * Bump session versions for many emails so existing JWTs are treated as revoked.
 * Side effects: clears those emails from the local session-version cache.
 */
export const bumpSessionVersions = async (emails: string[]): Promise<void> => {
  const unique = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  if (unique.length === 0) return;
  await prisma.$transaction(
    unique.map((email) =>
      prisma.sessionVersion.upsert({
        where: { email },
        create: { email, version: 1 },
        update: { version: { increment: 1 } },
      }),
    ),
  );
  for (const email of unique) sessionVersionCache.delete(email);
};

const userKey = (user: UserAccount) => user.email.trim().toLowerCase();

const collectAccountMap = (registry: AccessRegistry): Map<string, UserAccount[]> => {
  const map = new Map<string, UserAccount[]>();
  const push = (user: UserAccount) => {
    const email = userKey(user);
    const list = map.get(email) ?? [];
    list.push(user);
    map.set(email, list);
  };
  for (const user of registry.users) push(user);
  for (const user of registry.squadAccounts) push(user);
  return map;
};

const accountsSignature = (accounts: UserAccount[]): string =>
  accounts
    .map((a) => `${a.role}:${a.squadId ?? ""}`)
    .sort()
    .join("|");

/**
 * Emails whose role/squad changed or were removed — their sessions must be revoked.
 * Diffs both `users` and `squadAccounts`.
 */
export const emailsNeedingSessionRevoke = (
  previous: AccessRegistry,
  next: AccessRegistry,
): string[] => {
  const nextByEmail = collectAccountMap(next);
  const prevByEmail = collectAccountMap(previous);
  const emails = new Set<string>();

  for (const [email, prevAccounts] of prevByEmail) {
    const updated = nextByEmail.get(email);
    if (!updated) {
      emails.add(email);
      continue;
    }
    if (accountsSignature(prevAccounts) !== accountsSignature(updated)) {
      emails.add(email);
    }
  }
  return [...emails];
};
