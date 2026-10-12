import type { JiraApiCredentials } from "./credentials";
import { jiraFetch } from "./client";
import { JiraApiError, publicJiraErrorMessage } from "./jiraErrors";
import { walkAdf, type AdfNode } from "./issuePreview";
import type { JiraUserRef } from "./userSearch";
import { splitTextByMentions, uniqueMentions } from "./commentText";

export const JIRA_COMMENTS_PAGE_SIZE = 50;

/** One Jira comment as the planner shows it. */
export type JiraIssueComment = {
  id: string;
  authorAccountId: string;
  authorName: string;
  created: string;
  updated: string;
  /** True when the comment was changed after it was created. */
  edited: boolean;
  text: string;
  mentions: JiraUserRef[];
  /** True when the signed-in Jira user wrote it (may edit / delete). */
  isOwn: boolean;
};

export type JiraIssueCommentList = {
  comments: JiraIssueComment[];
  /** Total comments on the issue (may exceed the page shown). */
  total: number;
};

/** Plain text plus the people mentioned in it, as typed in the planner. */
export type JiraCommentDraft = {
  text: string;
  mentions: JiraUserRef[];
};

type RawJiraComment = {
  id?: string;
  author?: { accountId?: string; displayName?: string };
  body?: unknown;
  created?: string;
  updated?: string;
};

const EDITED_THRESHOLD_MS = 1000;

/**
 * Build a Jira ADF comment body from planner text.
 * Each line is joined with a hard break; every intact "@Display Name" of a picked person becomes a mention
 * (Jira notifies that person). Mentions whose text was removed are ignored.
 * @param text - Comment text as typed.
 * @param mentions - People picked from the @ list (account id + display name).
 * @returns ADF document for the Jira comment API.
 */
export const buildCommentAdf = (text: string, mentions: JiraUserRef[]): AdfNode & { version: number } => {
  const content: AdfNode[] = [];
  text
    .replace(/\r\n/g, "\n")
    .trim()
    .split("\n")
    .forEach((line, index) => {
      if (index > 0) content.push({ type: "hardBreak" });
      for (const segment of splitTextByMentions(line, mentions)) {
        content.push(
          segment.mention
            ? { type: "mention", attrs: { id: segment.mention.accountId, text: segment.text } }
            : { type: "text", text: segment.text },
        );
      }
    });
  return { type: "doc", version: 1, content: [{ type: "paragraph", content }] };
};

/**
 * Read a Jira ADF comment body back into planner text and mentions (used for display and editing).
 * @param body - ADF document (or plain string for old comments).
 * @returns Text with "@Name" mentions and the mentioned people.
 */
export const commentAdfToDraft = (body: unknown): JiraCommentDraft => {
  if (typeof body === "string") return { text: body.trim(), mentions: [] };
  const parts: string[] = [];
  const mentions: JiraUserRef[] = [];
  walkAdf(body as AdfNode, parts, mentions);
  const text = parts
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, mentions: uniqueMentions(mentions) };
};

/**
 * Map a raw Jira comment to the planner shape.
 * @param raw - Comment from the Jira REST API.
 * @param myAccountId - Signed-in Jira user (null when unknown — nothing is marked as own).
 */
export const toJiraIssueComment = (raw: RawJiraComment, myAccountId: string | null): JiraIssueComment => {
  const created = raw.created ?? "";
  const updated = raw.updated ?? created;
  const authorAccountId = raw.author?.accountId?.trim() ?? "";
  const { text, mentions } = commentAdfToDraft(raw.body);
  const createdMs = Date.parse(created);
  const updatedMs = Date.parse(updated);
  return {
    id: String(raw.id ?? ""),
    authorAccountId,
    authorName: raw.author?.displayName?.trim() || "Unknown",
    created,
    updated,
    edited: Number.isFinite(createdMs) && Number.isFinite(updatedMs) && updatedMs - createdMs > EDITED_THRESHOLD_MS,
    text,
    mentions,
    isOwn: Boolean(myAccountId && authorAccountId === myAccountId),
  };
};

const commentPath = (issueKey: string, commentId?: string): string =>
  `/issue/${encodeURIComponent(issueKey)}/comment${commentId ? `/${encodeURIComponent(commentId)}` : ""}`;

const throwJiraError = async (response: Response, fallback: string): Promise<never> => {
  await response.text().catch(() => "");
  throw new JiraApiError(publicJiraErrorMessage(response.status, fallback), response.status);
};

/**
 * Jira account id of the signed-in user (from /myself).
 * @returns Account id, or null when Jira does not return one.
 */
export const getJiraMyselfAccountId = async (credentials: JiraApiCredentials): Promise<string | null> => {
  const response = await jiraFetch(credentials, "/myself");
  if (!response.ok) return throwJiraError(response, "Failed to read your Jira account");
  const body = (await response.json()) as { accountId?: string };
  return body.accountId?.trim() || null;
};

/**
 * Newest comments of a Jira issue, with the signed-in user's own comments marked.
 * Side effects: one read-only Jira call (plus /myself, in parallel, only when the account id is not known).
 * @param credentials - Signed-in user's Jira credentials.
 * @param issueKey - Story key, e.g. BR-123.
 * @param myAccountId - Signed-in user's Jira account id from the session, when known.
 * @returns Up to JIRA_COMMENTS_PAGE_SIZE comments (newest first) and the issue's total.
 */
export const listIssueComments = async (
  credentials: JiraApiCredentials,
  issueKey: string,
  myAccountId?: string | null,
): Promise<JiraIssueCommentList> => {
  const [response, ownAccountId] = await Promise.all([
    jiraFetch(credentials, `${commentPath(issueKey)}?orderBy=-created&maxResults=${JIRA_COMMENTS_PAGE_SIZE}`),
    myAccountId?.trim() || getJiraMyselfAccountId(credentials),
  ]);
  if (!response.ok) return throwJiraError(response, `Failed to load comments for ${issueKey}`);
  const body = (await response.json()) as { comments?: RawJiraComment[]; total?: number };
  const comments = (body.comments ?? []).map((raw) => toJiraIssueComment(raw, ownAccountId));
  return { comments, total: typeof body.total === "number" ? body.total : comments.length };
};

/**
 * Add a comment to a Jira issue as the signed-in user (mentioned people get a Jira notification).
 * @returns The created comment.
 */
export const addIssueComment = async (
  credentials: JiraApiCredentials,
  issueKey: string,
  draft: JiraCommentDraft,
): Promise<JiraIssueComment> => {
  const response = await jiraFetch(credentials, commentPath(issueKey), {
    method: "POST",
    body: JSON.stringify({ body: buildCommentAdf(draft.text, draft.mentions) }),
  });
  if (!response.ok) return throwJiraError(response, `Failed to add a comment to ${issueKey}`);
  const raw = (await response.json()) as RawJiraComment;
  return toJiraIssueComment(raw, raw.author?.accountId?.trim() ?? null);
};

/**
 * Replace the text of a Jira comment (Jira only allows it for the author or admins).
 * @returns The updated comment.
 */
export const updateIssueComment = async (
  credentials: JiraApiCredentials,
  issueKey: string,
  commentId: string,
  draft: JiraCommentDraft,
): Promise<JiraIssueComment> => {
  const response = await jiraFetch(credentials, commentPath(issueKey, commentId), {
    method: "PUT",
    body: JSON.stringify({ body: buildCommentAdf(draft.text, draft.mentions) }),
  });
  if (!response.ok) return throwJiraError(response, `Failed to update the comment on ${issueKey}`);
  const raw = (await response.json()) as RawJiraComment;
  return toJiraIssueComment(raw, raw.author?.accountId?.trim() ?? null);
};

/** Delete a Jira comment (Jira only allows it for the author or admins). */
export const deleteIssueComment = async (
  credentials: JiraApiCredentials,
  issueKey: string,
  commentId: string,
): Promise<void> => {
  const response = await jiraFetch(credentials, commentPath(issueKey, commentId), { method: "DELETE" });
  if (!response.ok) await throwJiraError(response, `Failed to delete the comment on ${issueKey}`);
};
