import {
  buildJiraBasicAuthHeader,
  jiraRestApiBase,
  type JiraApiCredentials,
} from "./credentials";
import { buildSubtaskHourFields } from "./subtaskFields";
import { JiraApiError, publicJiraErrorMessage } from "./jiraErrors";

export { JiraApiError } from "./jiraErrors";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const jiraFetch = async (
  credentials: JiraApiCredentials,
  path: string,
  init?: RequestInit,
): Promise<Response> => {
  const maxAttempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${jiraRestApiBase(credentials.siteUrl)}${path}`, {
        ...init,
        headers: {
          Authorization: buildJiraBasicAuthHeader(credentials),
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
        cache: "no-store",
      });
      if (
        attempt < maxAttempts &&
        (response.status === 429 || response.status === 502 || response.status === 503)
      ) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 400 * attempt;
        await response.text().catch(() => "");
        await sleep(waitMs);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      await sleep(400 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Jira request failed");
};

/**
 * Verify an API token by calling Jira /myself.
 */
export const verifyJiraConnection = async (
  credentials: JiraApiCredentials,
): Promise<{ displayName: string; email: string } | null> => {
  const response = await jiraFetch(credentials, "/myself");
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as { displayName?: string; emailAddress?: string };
  return {
    displayName: body.displayName ?? credentials.email,
    email: body.emailAddress ?? credentials.email,
  };
};

export const getJiraIssue = async (credentials: JiraApiCredentials, issueKey: string) => {
  const response = await jiraFetch(credentials, `/issue/${encodeURIComponent(issueKey)}?fields=summary,issuetype,parent`);
  if (!response.ok) {
    throw new JiraApiError(
      publicJiraErrorMessage(response.status, `Failed to load Jira issue ${issueKey}`),
      response.status,
    );
  }
  return (await response.json()) as Record<string, unknown>;
};

/** Fields used by the dashboard story-link hover preview. */
export const jiraFetchIssuePreviewFields = async (
  credentials: JiraApiCredentials,
  issueKey: string,
): Promise<{
  summary?: string;
  assignee?: unknown;
  reporter?: unknown;
  description?: unknown;
}> => {
  const response = await jiraFetch(
    credentials,
    `/issue/${encodeURIComponent(issueKey)}?fields=${encodeURIComponent("summary,assignee,reporter,description")}`,
  );
  if (!response.ok) {
    await response.text().catch(() => "");
    throw new JiraApiError(
      publicJiraErrorMessage(response.status, `Failed to load Jira issue ${issueKey}`),
      response.status,
    );
  }
  const body = (await response.json()) as {
    fields?: {
      summary?: string;
      assignee?: unknown;
      reporter?: unknown;
      description?: unknown;
    };
  };
  return body.fields ?? {};
};

export interface CreateSubtaskInput {
  projectKey: string;
  parentIssueKey: string;
  issueTypeName: string;
  summary: string;
  jiraAccountId: string | null;
  hours: number;
  squadFieldId?: string;
  squadOptionId?: string;
  /** e.g. customfield_10001 — Development Estimate in Hours on subtasks. */
  developmentEstimateFieldId?: string;
}

export const createJiraSubtask = async (
  credentials: JiraApiCredentials,
  input: CreateSubtaskInput,
): Promise<string> => {
  const fields: Record<string, unknown> = {
    project: { key: input.projectKey },
    parent: { key: input.parentIssueKey },
    summary: input.summary,
    issuetype: { name: input.issueTypeName },
    ...buildSubtaskHourFields(input.hours, input.developmentEstimateFieldId),
  };
  if (input.jiraAccountId) {
    fields.assignee = { accountId: input.jiraAccountId };
  }
  if (input.squadFieldId?.trim() && input.squadOptionId?.trim()) {
    fields[input.squadFieldId.trim()] = { id: input.squadOptionId.trim() };
  }

  const response = await jiraFetch(credentials, "/issue", {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) {
    await response.text().catch(() => "");
    throw new JiraApiError(
      publicJiraErrorMessage(response.status, "Failed to create Jira subtask"),
      response.status,
    );
  }
  const body = (await response.json()) as { key?: string };
  if (!body.key) {
    throw new JiraApiError("Jira did not return a subtask key", 500);
  }
  return body.key;
};

export const updateJiraParentIssue = async (
  credentials: JiraApiCredentials,
  issueKey: string,
  fields: Record<string, unknown>,
): Promise<void> => {
  if (Object.keys(fields).length === 0) {
    return;
  }

  const response = await jiraFetch(credentials, `/issue/${encodeURIComponent(issueKey)}`, {
    method: "PUT",
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) {
    await response.text().catch(() => "");
    throw new JiraApiError(
      publicJiraErrorMessage(response.status, `Failed to update Jira parent issue ${issueKey}`),
      response.status,
    );
  }
};

export const updateJiraSubtaskHours = async (
  credentials: JiraApiCredentials,
  issueKey: string,
  hours: number,
  developmentEstimateFieldId?: string,
): Promise<void> => {
  const response = await jiraFetch(credentials, `/issue/${encodeURIComponent(issueKey)}`, {
    method: "PUT",
    body: JSON.stringify({
      fields: buildSubtaskHourFields(hours, developmentEstimateFieldId),
    }),
  });
  if (!response.ok) {
    await response.text().catch(() => "");
    throw new JiraApiError(
      publicJiraErrorMessage(response.status, `Failed to update Jira subtask hours ${issueKey}`),
      response.status,
    );
  }
};

export const updateJiraSubtask = async (
  credentials: JiraApiCredentials,
  issueKey: string,
  input: Pick<CreateSubtaskInput, "summary" | "jiraAccountId" | "hours" | "developmentEstimateFieldId">,
): Promise<void> => {
  const fields: Record<string, unknown> = {
    summary: input.summary,
    ...buildSubtaskHourFields(input.hours, input.developmentEstimateFieldId),
  };
  if (input.jiraAccountId) {
    fields.assignee = { accountId: input.jiraAccountId };
  }

  const response = await jiraFetch(credentials, `/issue/${encodeURIComponent(issueKey)}`, {
    method: "PUT",
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) {
    await response.text().catch(() => "");
    throw new JiraApiError(
      publicJiraErrorMessage(response.status, `Failed to update Jira subtask ${issueKey}`),
      response.status,
    );
  }
};

export const getJiraIssueStatusName = async (
  credentials: JiraApiCredentials,
  issueKey: string,
): Promise<string> => {
  const response = await jiraFetch(
    credentials,
    `/issue/${encodeURIComponent(issueKey)}?fields=status`,
  );
  if (!response.ok) {
    await response.text().catch(() => "");
    throw new JiraApiError(
      publicJiraErrorMessage(response.status, `Failed to load Jira status for ${issueKey}`),
      response.status,
    );
  }
  const body = (await response.json()) as { fields?: { status?: { name?: string } } };
  const name = body.fields?.status?.name?.trim();
  if (!name) {
    throw new JiraApiError(`Jira issue ${issueKey} has no status name`, 500);
  }
  return name;
};

export type JiraIssueTransition = {
  id: string;
  name: string;
  toStatusName: string;
};

export const listJiraIssueTransitions = async (
  credentials: JiraApiCredentials,
  issueKey: string,
): Promise<JiraIssueTransition[]> => {
  const response = await jiraFetch(
    credentials,
    `/issue/${encodeURIComponent(issueKey)}/transitions`,
  );
  if (!response.ok) {
    await response.text().catch(() => "");
    throw new JiraApiError(
      publicJiraErrorMessage(response.status, `Failed to list Jira transitions for ${issueKey}`),
      response.status,
    );
  }
  const body = (await response.json()) as {
    transitions?: Array<{ id?: string; name?: string; to?: { name?: string } }>;
  };
  return (body.transitions ?? [])
    .filter((item) => item.id?.trim() && item.to?.name?.trim())
    .map((item) => ({
      id: item.id!.trim(),
      name: item.name?.trim() || item.to!.name!.trim(),
      toStatusName: item.to!.name!.trim(),
    }));
};

export const transitionJiraIssue = async (
  credentials: JiraApiCredentials,
  issueKey: string,
  transitionId: string,
): Promise<void> => {
  const response = await jiraFetch(
    credentials,
    `/issue/${encodeURIComponent(issueKey)}/transitions`,
    {
      method: "POST",
      body: JSON.stringify({ transition: { id: transitionId } }),
    },
  );
  if (!response.ok) {
    await response.text().catch(() => "");
    throw new JiraApiError(
      publicJiraErrorMessage(response.status, `Failed to transition Jira issue ${issueKey}`),
      response.status,
    );
  }
};
