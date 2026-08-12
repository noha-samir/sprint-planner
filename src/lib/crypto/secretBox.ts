import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/** NextAuth / session signing secret — always AUTH_SECRET. */
export const resolveAuthCryptoSecret = (): string => {
  const fromEnv = process.env.AUTH_SECRET?.trim();
  if (!fromEnv) {
    throw new Error("AUTH_SECRET is required to encrypt sensitive data");
  }
  return fromEnv;
};

/** Prefer dedicated key for Jira API tokens; fall back to AUTH_SECRET. */
const resolveTokenSecret = (): string => {
  const tokenKey = process.env.JIRA_TOKEN_ENCRYPTION_KEY?.trim();
  if (tokenKey) return tokenKey;
  return resolveAuthCryptoSecret();
};

const keyFromSecret = (secret: string): Buffer => createHash("sha256").update(secret).digest();

/**
 * Encrypt a UTF-8 string with JIRA_TOKEN_ENCRYPTION_KEY or AUTH_SECRET (AES-256-GCM).
 * Returns `iv:tag:cipher` hex.
 */
export const encryptSecret = (plainText: string): string => {
  const key = keyFromSecret(resolveTokenSecret());
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
};

/**
 * Decrypt a value produced by encryptSecret.
 */
export const decryptSecret = (payload: string): string => {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Invalid encrypted payload");
  }
  const key = keyFromSecret(resolveTokenSecret());
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
  return decrypted.toString("utf8");
};
