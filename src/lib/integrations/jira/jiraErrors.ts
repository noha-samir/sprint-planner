export class JiraApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Map upstream Jira failures to safe client-facing messages (no raw body leakage). */
export const publicJiraErrorMessage = (status: number, fallback: string): string => {
  if (status === 401 || status === 403) {
    return "Jira rejected the request. Check your API token and permissions.";
  }
  if (status === 404) {
    return "Jira issue was not found.";
  }
  if (status === 429) {
    return "Jira rate limit exceeded. Try again shortly.";
  }
  if (status >= 500) {
    return "Jira is temporarily unavailable. Try again later.";
  }
  return fallback;
};
