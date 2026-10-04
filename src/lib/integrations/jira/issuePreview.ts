import type { JiraApiCredentials } from "./credentials";
import { jiraFetchIssuePreviewFields } from "./client";

export const ISSUE_DESCRIPTION_PREVIEW_MAX_CHARS = 320;
export const ISSUE_DESCRIPTION_PREVIEW_MAX_LINES = 4;

/** Jira status category: "new" (To Do), "indeterminate" (in progress), "done", or "" when unknown. */
export type JiraStatusCategory = "new" | "indeterminate" | "done" | "";

export type JiraIssuePreview = {
  key: string;
  summary: string;
  status: string;
  statusCategory: JiraStatusCategory;
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
 * Read a Jira status field.
 * @param status Raw `fields.status` from the Jira REST API.
 * @returns Status name and its colour category (empty strings when missing).
 */
export const jiraStatusFromField = (status: unknown): { status: string; statusCategory: JiraStatusCategory } => {
  if (!status || typeof status !== "object") {
    return { status: "", statusCategory: "" };
  }
  const record = status as { name?: string; statusCategory?: { key?: string } };
  const categoryKey = record.statusCategory?.key;
  return {
    status: record.name?.trim() ?? "",
    statusCategory:
      categoryKey === "new" || categoryKey === "indeterminate" || categoryKey === "done" ? categoryKey : "",
  };
};

/**
 * Load summary, status, assignee, reporter, and a short description preview for hover UI.
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
    ...jiraStatusFromField(fields.status),
    assignee: displayNameFromUser(fields.assignee),
    reporter: displayNameFromUser(fields.reporter),
    descriptionPreview,
  };
};
