import { auth } from "@/auth";
import { normalizeJiraSiteUrl, type JiraApiCredentials } from "@/lib/integrations/jira/credentials";
import { resolveJiraSiteUrl } from "@/lib/integrations/jira/configStore";
import { JiraApiError } from "@/lib/integrations/jira/jiraErrors";
import { getJiraApiToken } from "@/lib/authz/jiraAccountsStore";

/** Email of the signed-in (not revoked) session, lower-cased; "" when there is none. */
const readSessionEmail = async (): Promise<string> => {
  const session = await auth();
  if (session?.error === "SessionRevoked") {
    return "";
  }
  return session?.user?.email?.trim().toLowerCase() ?? "";
};

/**
 * Site URL + signed-in user's Jira token, looked up in parallel (token from Postgres, encrypted; not from the JWT).
 * @param squadId - Squad whose Jira site to use (falls back to any configured site).
 * @param sessionEmail - Email of an already-verified session; skips loading the session again.
 * @returns Site URL ("" when no site is configured) and credentials (null when the user has no token).
 */
const loadSessionJiraCredentials = async (
  squadId?: string | null,
  sessionEmail?: string,
): Promise<{ siteUrl: string; credentials: JiraApiCredentials | null }> => {
  const emailPromise = sessionEmail ? Promise.resolve(sessionEmail.trim().toLowerCase()) : readSessionEmail();
  const [siteUrl, email, apiToken] = await Promise.all([
    resolveJiraSiteUrl(squadId).then(normalizeJiraSiteUrl),
    emailPromise,
    emailPromise.then((email) => (email ? getJiraApiToken(email) : null)),
  ]);
  return { siteUrl, credentials: siteUrl && email && apiToken ? { siteUrl, email, apiToken } : null };
};

/**
 * Load Jira credentials for the signed-in user (null when no site is configured or the user has no token).
 * @param squadId - Squad whose Jira site to use.
 * @param sessionEmail - Email of an already-verified session (optional; avoids a second session lookup).
 */
export const getSessionJiraCredentials = async (
  squadId?: string | null,
  sessionEmail?: string,
): Promise<JiraApiCredentials | null> => (await loadSessionJiraCredentials(squadId, sessionEmail)).credentials;

/**
 * Jira credentials for the signed-in user, or a JiraApiError (503 no Jira site configured, 401 no Jira token).
 * @param squadId - Squad whose Jira site to use.
 * @param sessionEmail - Email of an already-verified session (pass `authResult.access.email` from route guards).
 */
export const requireJiraApiCredentials = async (
  squadId?: string | null,
  sessionEmail?: string,
): Promise<JiraApiCredentials> => {
  const { siteUrl, credentials } = await loadSessionJiraCredentials(squadId, sessionEmail);
  if (!siteUrl) {
    throw new JiraApiError(
      "Jira site is not configured. A super admin must set the site URL under Jira Integration.",
      503,
    );
  }
  if (!credentials) {
    throw new JiraApiError(
      "Sign in with your Jira email and API key to use Jira integration.",
      401,
    );
  }
  return credentials;
};
