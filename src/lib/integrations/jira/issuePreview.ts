import type { JiraApiCredentials } from "./credentials";
import { jiraFetchIssuePreviewFields } from "./client";

export const ISSUE_DESCRIPTION_PREVIEW_MAX_CHARS = 320;
export const ISSUE_DESCRIPTION_PREVIEW_MAX_LINES = 4;

export type JiraIssuePreview = {
  key: string;
  summary: string;
  assignee: string;
  reporter: string;
  descriptionPreview: string;
};

type AdfNode = {
  type?: string;
  text?: string;
  content?: AdfNode[];
};

const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "codeBlock",
  "rule",
  "mediaSingle",
  "table",
  "tableRow",
]);

const walkAdf = (node: AdfNode | null | undefined, parts: string[]): void => {
  if (!node || typeof node !== "object") {
    return;
  }
  if (typeof node.text === "string" && node.text) {
    parts.push(node.text);
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      walkAdf(child, parts);
      if (child?.type && BLOCK_TYPES.has(child.type)) {
        parts.push("\n");
      }
    }
  }
};

/** Convert Jira ADF / HTML / plain description to plain text. */
export const jiraDescriptionToPlainText = (description: unknown): string => {
  if (description == null) {
    return "";
  }
  if (typeof description === "string") {
    const stripped = description
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
    return stripped
      .replace(/\r\n/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }
  if (typeof description === "object") {
    const parts: string[] = [];
    walkAdf(description as AdfNode, parts);
    return parts
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return "";
};

/** Keep the first N lines and max characters for hover preview. */
export const truncateDescriptionPreview = (
  plain: string,
  maxLines = ISSUE_DESCRIPTION_PREVIEW_MAX_LINES,
  maxChars = ISSUE_DESCRIPTION_PREVIEW_MAX_CHARS,
): string => {
  const normalized = plain.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return "";
  }
  const lines = normalized.split("\n");
  let text = lines.slice(0, Math.max(1, maxLines)).join("\n").trim();
  let truncated = lines.length > maxLines;
  if (text.length > maxChars) {
    text = text.slice(0, maxChars).trimEnd();
    truncated = true;
  }
  return truncated ? `${text}…` : text;
};

const displayNameFromUser = (user: unknown): string => {
  if (!user || typeof user !== "object") {
    return "";
  }
  const record = user as { displayName?: string; emailAddress?: string };
  return record.displayName?.trim() || record.emailAddress?.trim() || "";
};

/**
 * Load summary, assignee, reporter, and a short description preview for hover UI.
 */
export const fetchJiraIssuePreview = async (
  credentials: JiraApiCredentials,
  issueKey: string,
): Promise<JiraIssuePreview> => {
  const key = issueKey.trim().toUpperCase();
  const fields = await jiraFetchIssuePreviewFields(credentials, key);
  const descriptionPreview = truncateDescriptionPreview(jiraDescriptionToPlainText(fields.description));
  return {
    key,
    summary: typeof fields.summary === "string" ? fields.summary.trim() : "",
    assignee: displayNameFromUser(fields.assignee),
    reporter: displayNameFromUser(fields.reporter),
    descriptionPreview,
  };
};
