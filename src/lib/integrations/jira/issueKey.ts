/**
 * Extract a Jira issue key (e.g. PROJ-123) from a story link or raw key string.
 */
export const parseJiraIssueKey = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const direct = trimmed.match(/^([A-Z][A-Z0-9]+-\d+)$/i);
  if (direct) {
    return direct[1].toUpperCase();
  }

  const fromBrowse = trimmed.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/i);
  if (fromBrowse) {
    return fromBrowse[1].toUpperCase();
  }

  const fromQuery = trimmed.match(/[?&]selectedIssue=([A-Z][A-Z0-9]+-\d+)/i);
  if (fromQuery) {
    return fromQuery[1].toUpperCase();
  }

  const anywhere = trimmed.match(/\b([A-Z][A-Z0-9]+-\d+)\b/i);
  if (anywhere) {
    return anywhere[1].toUpperCase();
  }

  return null;
};

export const isJiraStoryLink = (raw: string): boolean => parseJiraIssueKey(raw) !== null;

export const projectKeyFromIssueKey = (issueKey: string): string | null => {
  const match = issueKey.match(/^([A-Z][A-Z0-9]+)-\d+$/i);
  return match ? match[1].toUpperCase() : null;
};

/**
 * Numeric suffix from a Jira issue key (e.g. VEN-123 → 123).
 */
export const issueNumberFromIssueKey = (issueKey: string): number | null => {
  const match = issueKey.match(/^[A-Z][A-Z0-9]+-(\d+)$/i);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1], 10);
};

/**
 * Issue number from a story link or bare issue key.
 */
export const parseJiraIssueNumber = (raw: string): number | null => {
  const issueKey = parseJiraIssueKey(raw);
  if (!issueKey) {
    return null;
  }
  return issueNumberFromIssueKey(issueKey);
};

export const buildJiraIssueBrowseUrl = (storyLink: string, issueKey: string): string => {
  const trimmed = storyLink.trim();
  const siteMatch = trimmed.match(/^(https?:\/\/[^/]+)/i);
  if (siteMatch) {
    return `${siteMatch[1]}/browse/${issueKey}`;
  }
  const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    return `${url.origin}/browse/${issueKey}`;
  } catch {
    return "";
  }
};
