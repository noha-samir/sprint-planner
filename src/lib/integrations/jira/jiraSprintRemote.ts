import type { JiraApiCredentials } from "./credentials";
import { jiraAgileFetch, JiraApiError } from "./client";
import { publicJiraErrorMessage } from "./jiraErrors";
import { jiraSprintFromAgileIssue, listActiveJiraSprints, type OpenJiraSprint, type StoredJiraSprint } from "./jiraSprint";

type AgileSprint = {
  id?: number;
  name?: string;
  state?: string;
};

/**
 * Read the issue's current Jira sprint.
 * @param credentials - Signed-in Jira credentials.
 * @param issueKey - Parent issue key.
 */
export const readJiraIssueSprint = async (
  credentials: JiraApiCredentials,
  issueKey: string,
): Promise<StoredJiraSprint> => {
  const response = await jiraAgileFetch(credentials, `/issue/${encodeURIComponent(issueKey)}`);
  if (!response.ok) {
    await response.text().catch(() => "");
    throw new JiraApiError(
      publicJiraErrorMessage(response.status, `Failed to read the Jira sprint for ${issueKey}`),
      response.status,
    );
  }
  const body = (await response.json()) as {
    fields?: { sprint?: AgileSprint | null; closedSprints?: AgileSprint[] | null };
  };
  return jiraSprintFromAgileIssue(body);
};

type AgilePage<T> = {
  values?: T[];
  isLast?: boolean;
};

const readAgileValues = async <T>(credentials: JiraApiCredentials, path: string): Promise<T[]> => {
  const values: T[] = [];
  let startAt = 0;
  for (let page = 0; page < 10; page += 1) {
    const joiner = path.includes("?") ? "&" : "?";
    const response = await jiraAgileFetch(
      credentials,
      `${path}${joiner}startAt=${startAt}&maxResults=50`,
    );
    if (!response.ok) {
      await response.text().catch(() => "");
      throw new JiraApiError(
        publicJiraErrorMessage(response.status, "Failed to read Jira boards"),
        response.status,
      );
    }
    const body = (await response.json()) as AgilePage<T>;
    const pageValues = body.values ?? [];
    values.push(...pageValues);
    if (body.isLast !== false || pageValues.length < 50) break;
    startAt += pageValues.length;
  }
  return values;
};

/**
 * Active sprints on this project's boards.
 * A board that does not support sprints is skipped.
 * @param credentials - Signed-in Jira credentials.
 * @param projectKey - Jira project key from the issue.
 */
export const listOpenJiraSprints = async (
  credentials: JiraApiCredentials,
  projectKey: string,
): Promise<OpenJiraSprint[]> => {
  const boards = await readAgileValues<{ id?: number }>(
    credentials,
    `/board?projectKeyOrId=${encodeURIComponent(projectKey)}`,
  );
  const sprints: Array<{ id?: number; name?: string; state?: string }> = [];
  for (const board of boards) {
    if (typeof board.id !== "number") continue;
    const response = await jiraAgileFetch(credentials, `/board/${board.id}/sprint?state=active&maxResults=50`);
    if (response.status === 400) {
      await response.text().catch(() => "");
      continue;
    }
    if (!response.ok) {
      await response.text().catch(() => "");
      throw new JiraApiError(
        publicJiraErrorMessage(response.status, `Failed to read the open sprint for ${projectKey}`),
        response.status,
      );
    }
    const body = (await response.json()) as AgilePage<{ id?: number; name?: string; state?: string }>;
    sprints.push(...(body.values ?? []).map((sprint) => ({ ...sprint, state: sprint.state ?? "active" })));
  }
  return listActiveJiraSprints(sprints);
};

/**
 * Move one issue onto a Jira sprint.
 * @param credentials - Signed-in Jira credentials.
 * @param sprintId - Active sprint id.
 * @param issueKey - Parent issue key.
 */
export const moveJiraIssueToSprint = async (
  credentials: JiraApiCredentials,
  sprintId: number,
  issueKey: string,
): Promise<void> => {
  const response = await jiraAgileFetch(credentials, `/sprint/${sprintId}/issue`, {
    method: "POST",
    body: JSON.stringify({ issues: [issueKey] }),
  });
  if (!response.ok) {
    await response.text().catch(() => "");
    throw new JiraApiError(
      publicJiraErrorMessage(response.status, `Failed to add ${issueKey} to the Jira sprint`),
      response.status,
    );
  }
};

/**
 * Move one issue out of its active or future sprint onto the Jira backlog.
 * @param credentials - Signed-in Jira credentials.
 * @param issueKey - Parent issue key.
 */
export const moveJiraIssueToBacklog = async (
  credentials: JiraApiCredentials,
  issueKey: string,
): Promise<void> => {
  const response = await jiraAgileFetch(credentials, "/backlog/issue", {
    method: "POST",
    body: JSON.stringify({ issues: [issueKey] }),
  });
  if (!response.ok) {
    await response.text().catch(() => "");
    throw new JiraApiError(
      publicJiraErrorMessage(response.status, `Failed to remove ${issueKey} from its Jira sprint`),
      response.status,
    );
  }
};
