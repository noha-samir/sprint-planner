/**
 * Hosting / platform secrets only. Jira product settings live in SquadJiraConfig (DB).
 */
const trim = (value: string | undefined): string => value?.trim() ?? "";

export const authEnv = {
  /** Comma-separated break-glass emails used when bootstrapping an empty registry. Not an authz allowlist. */
  get superAdminEmails(): string[] {
    const raw = trim(process.env.AUTH_SUPER_ADMIN_EMAIL);
    return raw
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  },
  get superAdminEmail(): string {
    return this.superAdminEmails[0] ?? "";
  },
};

export const appEnv = {
  get defaultSquadId(): string {
    return trim(process.env.DEFAULT_SQUAD_ID) || "ventures";
  },
};
