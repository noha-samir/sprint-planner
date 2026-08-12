import { publicAuthEnv } from "@/lib/config/publicEnv";

/** Shown on the sign-in page (client-safe). */
export const SIGN_IN_EMAIL_DOMAIN = publicAuthEnv.allowedEmailDomain;

/** Atlassian page where users create a personal Jira API token. */
export const JIRA_API_TOKEN_CREATE_URL =
  "https://id.atlassian.com/manage-profile/security/api-tokens";

export function isSignInAllowedEmail(
  emailLowerTrimmed: string,
  domain: string = SIGN_IN_EMAIL_DOMAIN,
): boolean {
  const allowed = domain.trim().toLowerCase() || SIGN_IN_EMAIL_DOMAIN;
  const parts = emailLowerTrimmed.split("@");
  return parts.length === 2 && parts[0].length > 0 && parts[1] === allowed;
}
