"use client";

import { useEffect, useId, useRef, useState } from "react";
import { findActiveMentionQuery, uniqueMentions } from "@/lib/integrations/jira/commentText";
import type { MentionSuggestion } from "@/lib/integrations/jira/mentionUsers";
import type { JiraUserRef } from "@/lib/integrations/jira/userSearch";

const SEARCH_DEBOUNCE_MS = 250;

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** People picked from the @ list so far (account id + display name). */
  mentions: JiraUserRef[];
  onMentionsChange: (mentions: JiraUserRef[]) => void;
  squadId: string | null;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
  rows?: number;
  /** Ctrl/Cmd + Enter. */
  onSubmitShortcut?: () => void;
  ariaLabel?: string;
};

type ActiveQuery = { start: number; query: string };

/**
 * Textarea with Jira @mentions: typing "@" lists the squad roster first, then any Jira user
 * (debounced search). ↑/↓ move, Enter/Tab pick, Esc closes the list. Picking inserts "@Display Name ".
 */
export function MentionTextarea({
  value,
  onChange,
  mentions,
  onMentionsChange,
  squadId,
  placeholder,
  disabled,
  maxLength,
  autoFocus,
  rows = 3,
  onSubmitShortcut,
  ariaLabel,
}: Props) {
  const listId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const requestIdRef = useRef(0);
  const cacheRef = useRef(new Map<string, MentionSuggestion[]>());
  const [active, setActive] = useState<ActiveQuery | null>(null);
  const [suggestions, setSuggestions] = useState<MentionSuggestion[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const activeQuery = active?.query ?? null;

  useEffect(() => {
    if (activeQuery === null || !squadId) return;
    const key = activeQuery.trim().toLowerCase();
    const cached = cacheRef.current.get(key);
    if (cached) {
      setSuggestions(cached);
      setHighlighted(0);
      setLoading(false);
      setSearchError(null);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/integrations/jira/mention-users?q=${encodeURIComponent(key)}`, {
          headers: { "x-squad-id": squadId },
        });
        const body = (await response.json()) as { users?: MentionSuggestion[]; error?: string };
        if (requestId !== requestIdRef.current) return;
        if (!response.ok) {
          setSuggestions([]);
          setSearchError(body.error?.trim() || "Could not search people.");
          return;
        }
        const users = body.users ?? [];
        cacheRef.current.set(key, users);
        setSuggestions(users);
        setHighlighted(0);
        setSearchError(null);
      } catch {
        if (requestId !== requestIdRef.current) return;
        setSuggestions([]);
        setSearchError("Could not search people.");
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [activeQuery, squadId]);

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
    };
  }, []);

  const refreshActive = (text: string, caret: number) => {
    setActive(findActiveMentionQuery(text, caret));
  };

  const closeList = () => {
    requestIdRef.current += 1;
    setActive(null);
    setLoading(false);
  };

  const pick = (person: MentionSuggestion) => {
    const textarea = textareaRef.current;
    if (!active || !textarea) return;
    const caret = textarea.selectionStart ?? value.length;
    const label = `@${person.displayName} `;
    const next = `${value.slice(0, active.start)}${label}${value.slice(caret)}`;
    if (maxLength && next.length > maxLength) return;
    onChange(next);
    onMentionsChange(uniqueMentions([...mentions, { accountId: person.accountId, displayName: person.displayName }]));
    closeList();
    const nextCaret = active.start + label.length;
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const listOpen = active !== null && Boolean(squadId);
  const showList = listOpen && (loading || suggestions.length > 0 || Boolean(searchError));

  return (
    <div className="mention-textarea">
      <textarea
        ref={textareaRef}
        className="mention-textarea-input"
        value={value}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-controls={showList ? listId : undefined}
        onChange={(event) => {
          onChange(event.target.value);
          refreshActive(event.target.value, event.target.selectionStart ?? event.target.value.length);
        }}
        onClick={(event) => refreshActive(value, event.currentTarget.selectionStart ?? value.length)}
        onBlur={() => window.setTimeout(closeList, 120)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            onSubmitShortcut?.();
            return;
          }
          if (!listOpen) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeList();
            return;
          }
          if (suggestions.length === 0) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setHighlighted((current) => (current + step + suggestions.length) % suggestions.length);
            return;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            pick(suggestions[Math.min(highlighted, suggestions.length - 1)]);
          }
        }}
        onKeyUp={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") {
            refreshActive(value, event.currentTarget.selectionStart ?? value.length);
          }
        }}
      />
      {showList ? (
        <ul id={listId} className="mention-textarea-list" role="listbox" aria-label="People to mention">
          {suggestions.map((person, index) => (
            <li key={person.accountId} role="option" aria-selected={index === highlighted}>
              <button
                type="button"
                className={`mention-textarea-option ${index === highlighted ? "mention-textarea-option-active" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => pick(person)}
              >
                <span className="truncate">{person.displayName}</span>
                {person.onRoster ? <span className="mention-textarea-badge">Squad</span> : null}
              </button>
            </li>
          ))}
          {loading && suggestions.length === 0 ? <li className="mention-textarea-hint">Searching…</li> : null}
          {searchError && !loading ? <li className="mention-textarea-hint mention-textarea-error">{searchError}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
