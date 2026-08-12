import { prisma } from "@/lib/db/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secretBox";

/**
 * Upsert Jira account id and optionally the encrypted API token (server-side only).
 */
export const upsertJiraAccount = async (
  email: string,
  accountId: string,
  apiToken?: string,
): Promise<void> => {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedAccountId = accountId.trim();
  if (!normalizedEmail || !normalizedAccountId) {
    return;
  }
  const apiTokenEnc = apiToken?.trim() ? encryptSecret(apiToken.trim()) : undefined;
  await prisma.jiraAccount.upsert({
    where: { email: normalizedEmail },
    create: {
      email: normalizedEmail,
      accountId: normalizedAccountId,
      apiTokenEnc: apiTokenEnc ?? null,
    },
    update: {
      accountId: normalizedAccountId,
      ...(apiTokenEnc ? { apiTokenEnc } : {}),
    },
  });
};

/** Decrypt the stored Jira API token for a signed-in email (null if missing). */
export const getJiraApiToken = async (email: string): Promise<string | null> => {
  const normalizedEmail = email.trim().toLowerCase();
  const row = await prisma.jiraAccount.findUnique({ where: { email: normalizedEmail } });
  if (!row?.apiTokenEnc) return null;
  try {
    const token = decryptSecret(row.apiTokenEnc).trim();
    return token || null;
  } catch {
    return null;
  }
};

export const clearJiraApiToken = async (email: string): Promise<void> => {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return;
  await prisma.jiraAccount.updateMany({
    where: { email: normalizedEmail },
    data: { apiTokenEnc: null },
  });
};
