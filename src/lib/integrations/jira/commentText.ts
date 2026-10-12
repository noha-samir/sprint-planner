import type { JiraUserRef } from "./userSearch";

export const JIRA_COMMENT_MAX_CHARS = 5000;
export const JIRA_COMMENT_MAX_MENTIONS = 20;

/** A run of comment text: plain, or an "@Name" that mentions a Jira user. */
export type CommentTextSegment = { text: string; mention?: JiraUserRef };

/** Drop blank / repeated people (by account id), keeping the first of each. */
export const uniqueMentions = (mentions: JiraUserRef[]): JiraUserRef[] => {
  const byId = new Map<string, JiraUserRef>();
  for (const mention of mentions) {
    const accountId = mention.accountId.trim();
    const displayName = mention.displayName.trim();
    if (accountId && displayName && !byId.has(accountId)) byId.set(accountId, { accountId, displayName });
  }
  return [...byId.values()];
};

const isWordChar = (char: string | undefined): boolean => Boolean(char && /[\p{L}\p{N}_]/u.test(char));

/**
 * Split text into plain runs and "@Display Name" mentions of the given people.
 * At each "@" the longest matching name wins (so "@Ali Hassan" beats "@Ali"), and the name must end at a
 * word boundary ("@Alia" does not match "Ali").
 * @param text - Comment text.
 * @param mentions - People that may be mentioned.
 * @returns Segments in order; joining their text gives back the input.
 */
export const splitTextByMentions = (text: string, mentions: JiraUserRef[]): CommentTextSegment[] => {
  const longestFirst = uniqueMentions(mentions).sort((a, b) => b.displayName.length - a.displayName.length);
  const segments: CommentTextSegment[] = [];
  let buffer = "";
  let index = 0;
  while (index < text.length) {
    const mention =
      text[index] === "@"
        ? longestFirst.find((candidate) => {
            const token = `@${candidate.displayName}`;
            return text.startsWith(token, index) && !isWordChar(text[index + token.length]);
          })
        : undefined;
    if (!mention) {
      buffer += text[index];
      index += 1;
      continue;
    }
    if (buffer) segments.push({ text: buffer });
    buffer = "";
    segments.push({ text: `@${mention.displayName}`, mention });
    index += mention.displayName.length + 1;
  }
  if (buffer) segments.push({ text: buffer });
  return segments;
};

const MENTION_QUERY_MAX_CHARS = 40;

/**
 * The "@query" being typed right before the caret, if any.
 * The "@" must start the text or follow whitespace / an opening bracket; the query may contain single spaces
 * (full names) but no line break, and stops after MENTION_QUERY_MAX_CHARS characters.
 * @param text - Textarea value.
 * @param caret - Caret position (selectionStart).
 * @returns Index of the "@" and the query after it, or null when no mention is being typed.
 */
export const findActiveMentionQuery = (text: string, caret: number): { start: number; query: string } | null => {
  const before = text.slice(0, Math.max(0, caret));
  const start = before.lastIndexOf("@");
  if (start < 0) return null;
  const previous = before[start - 1];
  if (previous !== undefined && !/[\s([{]/.test(previous)) return null;
  const query = before.slice(start + 1);
  if (query.length > MENTION_QUERY_MAX_CHARS || /\n|\s{2}|^\s/.test(query)) return null;
  return { start, query };
};

const RELATIVE_TIME_STEPS: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
  { unit: "day", seconds: 86400 },
  { unit: "hour", seconds: 3600 },
  { unit: "minute", seconds: 60 },
];

/**
 * Short comment timestamp: "just now", "5 minutes ago", "3 hours ago", "yesterday", then the date
 * (after 7 days).
 * @param iso - Jira timestamp.
 * @param now - Current time in ms (injectable for tests).
 */
export const formatCommentTime = (iso: string, now: number = Date.now()): string => {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const seconds = Math.round((now - time) / 1000);
  if (seconds < 60) return "just now";
  if (seconds >= 7 * 86400) {
    return new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
  const step = RELATIVE_TIME_STEPS.find((candidate) => seconds >= candidate.seconds) ?? RELATIVE_TIME_STEPS[2];
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    -Math.floor(seconds / step.seconds),
    step.unit,
  );
};

/** People whose "@Name" is still in the text (picked mentions whose text was erased are dropped). */
export const mentionsUsedInText = (text: string, mentions: JiraUserRef[]): JiraUserRef[] => {
  const used = new Set(
    splitTextByMentions(text, mentions).flatMap((segment) => (segment.mention ? [segment.mention.accountId] : [])),
  );
  return uniqueMentions(mentions).filter((mention) => used.has(mention.accountId));
};
