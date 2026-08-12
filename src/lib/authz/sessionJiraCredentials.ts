import { auth } from "@/auth";
import {
  isJiraSiteConfigured,
  normalizeJiraSiteUrl,
  type JiraApiCredentials,
} from "@/lib/integrations/jira/credentials";
import { resolveJiraSiteUrl } from "@/lib/integrations/jira/configStore";
import { JiraApiError } from "@/lib/integrations/jira/jiraErrors";
import { getJiraApiToken } from "@/lib/authz/jiraAccountsStore";

/**
 * Load Jira credentials for the signed-in user from Postgres (encrypted token), not from the JWT.
 */
export const getSessionJiraCredentials = async (
  squadId?: string | null,
): Promise<JiraApiCredentials | null> => {
  const siteUrl = normalizeJiraSiteUrl(await resolveJiraSiteUrl(squadId));
  if (!siteUrl) {
    return null;
  }

  const session = await auth();
  if (session?.error === "SessionRevoked") {
    return null;
  }
  const email = session?.user?.email?.trim().toLowerCase() ?? "";
  if (!email) {
    return null;
  }

  const apiToken = await getJiraApiToken(email);
  if (!apiToken) {
    return null;
  }
  return { siteUrl, email, apiToken };
};

export const requireJiraApiCredentials = async (
  squadId?: string | null,
): Promise<JiraApiCredentials> => {
  if (!(await isJiraSiteConfigured())) {
    throw new JiraApiError(
      "Jira site is not configured. A super admin must set the site URL under Jira Integration.",
      503,
    );
  }
  const credentials = await getSessionJiraCredentials(squadId);
  if (!credentials) {
    throw new JiraApiError(
      "Sign in with your Jira email and API key to use Jira integration.",
      401,
    );
  }
  return credentials;
};
