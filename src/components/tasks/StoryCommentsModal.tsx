"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MentionTextarea } from "@/components/common/MentionTextarea";
import {
  cachedStoryComments,
  fetchStoryComments,
  isStoryCommentsFresh,
  readCommentsApiError,
  storeStoryComments,
} from "@/components/tasks/storyCommentsCache";
import type { JiraIssueComment } from "@/lib/integrations/jira/comments";
import {
  formatCommentTime,
  JIRA_COMMENT_MAX_CHARS,
  mentionsUsedInText,
  splitTextByMentions,
} from "@/lib/integrations/jira/commentText";
import { buildJiraIssueBrowseUrl } from "@/lib/integrations/jira/issueKey";
import type { JiraUserRef } from "@/lib/integrations/jira/userSearch";

type Props = {
  issueKey: string;
  storyLink: string;
  storyName: string;
  squadId: string | null;
  /** Editors may add comments and edit / delete their own. */
  canEdit: boolean;
  onClose: () => void;
};

type Draft = { text: string; mentions: JiraUserRef[] };

const EMPTY_DRAFT: Draft = { text: "", mentions: [] };

function CommentText({ comment }: { comment: JiraIssueComment }) {
  return (
    <p className="story-comment-text">
      {splitTextByMentions(comment.text, comment.mentions).map((segment, index) =>
        segment.mention ? (
          <span key={index} className="story-comment-mention">
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  );
}

/**
 * Jira comments of one story (newest first), read and written with the signed-in user's Jira token.
 * Viewers read only; editors get the composer and can edit / delete their own comments.
 */
export function StoryCommentsModal({ issueKey, storyLink, storyName, squadId, canEdit, onClose }: Props) {
  const [cached] = useState(() => cachedStoryComments(issueKey));
  const [comments, setComments] = useState<JiraIssueComment[]>(cached?.comments ?? []);
  const [total, setTotal] = useState(cached?.total ?? 0);
  const [hasList, setHasList] = useState(Boolean(cached));
  const [loading, setLoading] = useState(!cached && Boolean(squadId));
  const [loadError, setLoadError] = useState<string | null>(squadId ? null : "Select a squad to see Jira comments.");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const baseUrl = `/api/integrations/jira/issues/${encodeURIComponent(issueKey)}/comments`;
  const headers = { "Content-Type": "application/json", "x-squad-id": squadId ?? "" };
  const browseUrl = buildJiraIssueBrowseUrl(storyLink, issueKey);

  const loadComments = useCallback(
    (force: boolean) => {
      if (!squadId || (!force && isStoryCommentsFresh(issueKey))) return () => undefined;
      const requestId = ++requestIdRef.current;
      void fetchStoryComments(issueKey, squadId).then((result) => {
        if (requestId !== requestIdRef.current) return;
        if ("error" in result) {
          setLoadError(result.error);
        } else {
          setComments(result.comments ?? []);
          setTotal(result.total ?? 0);
          setHasList(true);
        }
        setLoading(false);
      });
      return () => {
        requestIdRef.current += 1;
      };
    },
    [issueKey, squadId],
  );

  useEffect(() => loadComments(false), [loadComments]);

  useEffect(() => {
    if (hasList) storeStoryComments(issueKey, { comments, total });
  }, [comments, hasList, issueKey, total]);

  const retryLoad = () => {
    setLoading(true);
    setLoadError(null);
    loadComments(true);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const toBody = (value: Draft) =>
    JSON.stringify({ text: value.text.trim(), mentions: mentionsUsedInText(value.text, value.mentions) });

  const addComment = async () => {
    if (!draft.text.trim() || posting) return;
    setPosting(true);
    setActionError(null);
    try {
      const response = await fetch(baseUrl, { method: "POST", headers, body: toBody(draft) });
      if (!response.ok) {
        setActionError(await readCommentsApiError(response, "Could not add the comment."));
        return;
      }
      const { comment } = (await response.json()) as { comment: JiraIssueComment };
      setComments((current) => [comment, ...current]);
      setTotal((current) => current + 1);
      setDraft(EMPTY_DRAFT);
    } catch {
      setActionError("Could not add the comment.");
    } finally {
      setPosting(false);
    }
  };

  const saveEdit = async (commentId: string) => {
    if (!editDraft.text.trim() || busyId) return;
    setBusyId(commentId);
    setActionError(null);
    try {
      const response = await fetch(`${baseUrl}/${encodeURIComponent(commentId)}`, {
        method: "PUT",
        headers,
        body: toBody(editDraft),
      });
      if (!response.ok) {
        setActionError(await readCommentsApiError(response, "Could not update the comment."));
        return;
      }
      const { comment } = (await response.json()) as { comment: JiraIssueComment };
      setComments((current) => current.map((entry) => (entry.id === commentId ? comment : entry)));
      setEditingId(null);
    } catch {
      setActionError("Could not update the comment.");
    } finally {
      setBusyId(null);
    }
  };

  const deleteComment = async (commentId: string) => {
    if (busyId) return;
    setBusyId(commentId);
    setActionError(null);
    try {
      const response = await fetch(`${baseUrl}/${encodeURIComponent(commentId)}`, { method: "DELETE", headers });
      if (!response.ok) {
        setActionError(await readCommentsApiError(response, "Could not delete the comment."));
        return;
      }
      setComments((current) => current.filter((entry) => entry.id !== commentId));
      setTotal((current) => Math.max(0, current - 1));
      setConfirmDeleteId(null);
    } catch {
      setActionError("Could not delete the comment.");
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (comment: JiraIssueComment) => {
    setEditingId(comment.id);
    setEditDraft({ text: comment.text, mentions: comment.mentions });
    setConfirmDeleteId(null);
    setActionError(null);
  };

  return (
    <div
      className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-[min(8vh,4rem)]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[84vh] w-full max-w-xl flex-col rounded-2xl border border-slate-200 bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="story-comments-title"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h3 id="story-comments-title" className="text-lg font-semibold text-slate-900">
              Comments · {issueKey}
            </h3>
            <p className="truncate text-[13px] text-slate-600" title={storyName}>
              {storyName || "Untitled story"}
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary px-2.5 py-1 text-sm"
            title="Close comments"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {loading && comments.length === 0 ? <p className="text-[13px] text-slate-500">Loading comments…</p> : null}
          {loadError ? (
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-rose-700">
              <span>{loadError}</span>
              <button type="button" className="btn-secondary px-2 py-0.5 text-xs" onClick={retryLoad}>
                Retry
              </button>
            </div>
          ) : null}
          {!loading && !loadError && comments.length === 0 ? (
            <p className="text-[13px] text-slate-500">No comments on this story yet.</p>
          ) : null}

          <ul className="story-comment-list">
            {comments.map((comment) => {
              const editing = editingId === comment.id;
              const busy = busyId === comment.id;
              return (
                <li key={comment.id} className="story-comment">
                  <div className="story-comment-meta">
                    <span className="story-comment-author">{comment.authorName}</span>
                    <span title={new Date(comment.created).toLocaleString()}>{formatCommentTime(comment.created)}</span>
                    {comment.edited ? (
                      <span title={`Edited ${new Date(comment.updated).toLocaleString()}`}>· edited</span>
                    ) : null}
                    {canEdit && comment.isOwn && !editing ? (
                      <span className="ml-auto flex gap-1">
                        <button
                          type="button"
                          className="story-comment-action"
                          disabled={busy}
                          title="Edit your comment"
                          onClick={() => startEdit(comment)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="story-comment-action story-comment-action-danger"
                          disabled={busy}
                          title="Delete your comment from Jira"
                          onClick={() => setConfirmDeleteId(comment.id)}
                        >
                          Delete
                        </button>
                      </span>
                    ) : null}
                  </div>

                  {editing ? (
                    <div className="mt-1.5">
                      <MentionTextarea
                        value={editDraft.text}
                        onChange={(text) => setEditDraft((current) => ({ ...current, text }))}
                        mentions={editDraft.mentions}
                        onMentionsChange={(mentions) => setEditDraft((current) => ({ ...current, mentions }))}
                        squadId={squadId}
                        maxLength={JIRA_COMMENT_MAX_CHARS}
                        disabled={busy}
                        autoFocus
                        ariaLabel="Edit comment"
                        onSubmitShortcut={() => void saveEdit(comment.id)}
                      />
                      <div className="mt-1.5 flex justify-end gap-2">
                        <button
                          type="button"
                          className="btn-secondary px-2.5 py-1 text-xs"
                          disabled={busy}
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn-primary px-2.5 py-1 text-xs disabled:opacity-50"
                          disabled={busy || !editDraft.text.trim()}
                          onClick={() => void saveEdit(comment.id)}
                        >
                          {busy ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <CommentText comment={comment} />
                  )}

                  {confirmDeleteId === comment.id ? (
                    <div className="story-comment-confirm">
                      <span>Delete this comment from Jira? This cannot be undone.</span>
                      <button
                        type="button"
                        className="btn-secondary px-2 py-0.5 text-xs"
                        disabled={busy}
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Keep
                      </button>
                      <button
                        type="button"
                        className="story-comment-action story-comment-action-danger"
                        disabled={busy}
                        onClick={() => void deleteComment(comment.id)}
                      >
                        {busy ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {total > comments.length && comments.length > 0 ? (
            <p className="mt-2 text-[12px] text-slate-500">
              Showing {comments.length} of {total}.{" "}
              {browseUrl ? (
                <a href={browseUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  Open in Jira
                </a>
              ) : null}
            </p>
          ) : null}
        </div>

        <div className="border-t border-slate-200 px-5 py-3">
          {actionError ? <p className="mb-2 text-[12px] text-rose-700">{actionError}</p> : null}
          {canEdit ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void addComment();
              }}
            >
              <MentionTextarea
                value={draft.text}
                onChange={(text) => setDraft((current) => ({ ...current, text }))}
                mentions={draft.mentions}
                onMentionsChange={(mentions) => setDraft((current) => ({ ...current, mentions }))}
                squadId={squadId}
                maxLength={JIRA_COMMENT_MAX_CHARS}
                disabled={posting}
                placeholder="Write a comment… type @ to mention someone"
                ariaLabel="New comment"
                onSubmitShortcut={() => void addComment()}
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500">Posted to Jira as you · Ctrl+Enter to send</span>
                <button
                  type="submit"
                  className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
                  disabled={posting || !draft.text.trim()}
                  title={draft.text.trim() ? `Add this comment to ${issueKey} in Jira` : "Write a comment first"}
                >
                  {posting ? "Posting…" : "Comment"}
                </button>
              </div>
            </form>
          ) : (
            <p className="text-[12px] text-slate-500">You have view access — only editors can add comments.</p>
          )}
        </div>
      </div>
    </div>
  );
}
