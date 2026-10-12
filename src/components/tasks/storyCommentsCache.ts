import type { JiraIssueCommentList } from "@/lib/integrations/jira/comments";

const FRESH_FOR_MS = 30_000;
const AUTH_HINT = "If this keeps failing, sign out and sign in again with your Jira email and API key.";

type CacheEntry = { list: JiraIssueCommentList; fetchedAt: number };
export type StoryCommentsResult = JiraIssueCommentList | { error: string };

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<StoryCommentsResult>>();

/** Display-ready error from a failed comments API response (adds a sign-in hint on 401/403). */
export const readCommentsApiError = async (response: Response, fallback: string): Promise<string> => {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  const message = body.error?.trim() || fallback;
  return response.status === 401 || response.status === 403 ? `${message} ${AUTH_HINT}` : message;
};

/** Last loaded comments of a story in this page session, or null. */
export const cachedStoryComments = (issueKey: string): JiraIssueCommentList | null =>
  cache.get(issueKey)?.list ?? null;

/** True when the story's comments were fetched less than FRESH_FOR_MS ago. */
export const isStoryCommentsFresh = (issueKey: string): boolean => {
  const entry = cache.get(issueKey);
  return Boolean(entry && Date.now() - entry.fetchedAt < FRESH_FOR_MS);
};

/** Keep the cache in step with local adds / edits / deletes (does not change when it was fetched). */
export const storeStoryComments = (issueKey: string, list: JiraIssueCommentList): void => {
  cache.set(issueKey, { list, fetchedAt: cache.get(issueKey)?.fetchedAt ?? 0 });
};

/**
 * GET a story's comments. Concurrent calls for the same story share one request; a success is cached.
 * Resolves with the list or a display-ready error (never rejects).
 * @param issueKey - Story key, e.g. BR-123.
 * @param squadId - Active squad (sent as x-squad-id).
 */
export const fetchStoryComments = (issueKey: string, squadId: string): Promise<StoryCommentsResult> => {
  const pending = inFlight.get(issueKey);
  if (pending) return pending;

  const request = (async (): Promise<StoryCommentsResult> => {
    try {
      const response = await fetch(`/api/integrations/jira/issues/${encodeURIComponent(issueKey)}/comments`, {
        headers: { "x-squad-id": squadId },
      });
      if (!response.ok) return { error: await readCommentsApiError(response, "Could not load Jira comments.") };
      const list = (await response.json()) as JiraIssueCommentList;
      cache.set(issueKey, { list, fetchedAt: Date.now() });
      return list;
    } catch {
      return { error: "Could not load Jira comments." };
    } finally {
      inFlight.delete(issueKey);
    }
  })();
  inFlight.set(issueKey, request);
  return request;
};

/** Warm the cache before the panel opens (skipped when the cached copy is still fresh). */
export const prefetchStoryComments = (issueKey: string, squadId: string): void => {
  if (isStoryCommentsFresh(issueKey)) return;
  void fetchStoryComments(issueKey, squadId);
};
