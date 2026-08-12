import {
  buildJiraBasicAuthHeader,
  jiraRestApiBase,
  normalizeJiraSiteUrl,
} from "@/lib/integrations/jira/credentials";
import { resolveJiraSiteUrl } from "@/lib/integrations/jira/configStore";

export type JiraMyselfProfile = {
  accountId: string;
  email: string;
  displayName: string;
};

/**
 * Validate Atlassian email + API token via GET /rest/api/3/myself.
 * Site URL comes from SquadJiraConfig in the database.
 */
export const verifyJiraEmailAndApiKey = async (
  email: string,
  apiToken: string,
): Promise<JiraMyselfProfile | null> => {
  const siteUrl = normalizeJiraSiteUrl(await resolveJiraSiteUrl());
  const normalizedEmail = email.trim().toLowerCase();
  const token = apiToken.trim();
  if (!siteUrl || !normalizedEmail || !token) {
    return null;
  }

  const response = await fetch(`${jiraRestApiBase(siteUrl)}/myself`, {
    method: "GET",
    headers: {
      Authorization: buildJiraBasicAuthHeader({ siteUrl, email: normalizedEmail, apiToken: token }),
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as {
    accountId?: string;
    emailAddress?: string;
    displayName?: string;
  };
  const accountId = body.accountId?.trim();
  if (!accountId) {
    return null;
  }
  const jiraEmail = (body.emailAddress ?? normalizedEmail).trim().toLowerCase();
  if (jiraEmail && jiraEmail !== normalizedEmail) {
    return null;
  }

  return {
    accountId,
    email: normalizedEmail,
    displayName: body.displayName?.trim() || normalizedEmail,
  };
};
