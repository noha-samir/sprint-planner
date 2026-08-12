import { prisma } from "@/lib/db/prisma";
import type { AccessRegistry, UserAccount } from "@/lib/access/registry";

const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Current session version for an email (0 if never revoked). */
export const getSessionVersion = async (email: string): Promise<number> => {
  const row = await prisma.sessionVersion.findUnique({
    where: { email: normalizeEmail(email) },
  });
  return row?.version ?? 0;
};

/** Bump session versions for many emails so existing JWTs are treated as revoked. */
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
