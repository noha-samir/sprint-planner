import { prisma } from "@/lib/db/prisma";

const DEFAULT_DOMAIN = "example.com";

const trim = (value: string | undefined): string => value?.trim() ?? "";

let cachedDomain: string | null = null;
let cacheLoaded = false;

const domainFromEnv = (): string | null => {
  const fromEnv =
    trim(process.env.AUTH_ALLOWED_EMAIL_DOMAIN) || trim(process.env.NEXT_PUBLIC_AUTH_ALLOWED_EMAIL_DOMAIN);
  return fromEnv ? fromEnv.toLowerCase() : null;
};

/** Refresh in-memory AppConfig cache from Postgres (safe to call from async routes). */
export const refreshAppConfigCache = async (): Promise<void> => {
  try {
    const row = await prisma.appConfig.findUnique({ where: { id: 1 } });
    cachedDomain = row?.allowedEmailDomain?.trim().toLowerCase() || null;
  } catch {
    cachedDomain = null;
  } finally {
    cacheLoaded = true;
  }
};

/**
 * Allowed sign-in email domain.
 * Priority: AUTH_ALLOWED_EMAIL_DOMAIN / NEXT_PUBLIC_* → AppConfig DB row → default (dev only).
 * In production, env or DB must provide a domain (no silent default).
 */
export const getAllowedEmailDomain = async (): Promise<string> => {
  const fromEnv = domainFromEnv();
  if (fromEnv) {
    return fromEnv;
  }
  if (!cacheLoaded) {
    await refreshAppConfigCache();
  }
  if (cachedDomain) {
    return cachedDomain;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_ALLOWED_EMAIL_DOMAIN (or AppConfig.allowedEmailDomain) is required in production",
    );
  }
  return DEFAULT_DOMAIN;
};
