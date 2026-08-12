export interface JiraApiCredentials {
  siteUrl: string;
  email: string;
  apiToken: string;
}

/**
 * Normalize Jira Cloud site URL (no trailing slash).
 */
export const normalizeJiraSiteUrl = (raw: string): string => {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
};

/** True when at least one squad has a Jira site URL configured in the DB. */
export const isJiraSiteConfigured = async (): Promise<boolean> => {
  const { resolveJiraSiteUrl } = await import("./configStore");
  return Boolean(await resolveJiraSiteUrl());
};

export const buildJiraBasicAuthHeader = (credentials: JiraApiCredentials): string => {
  const encoded = Buffer.from(`${credentials.email}:${credentials.apiToken}`).toString("base64");
  return `Basic ${encoded}`;
};

export const jiraRestApiBase = (siteUrl: string): string => `${normalizeJiraSiteUrl(siteUrl)}/rest/api/3`;
