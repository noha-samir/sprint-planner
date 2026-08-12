/** Split total hours evenly across assignees (matches scheduler utilization logic). */
export const splitHoursAcrossAssignees = (hours: number, assigneesCount: number): number[] => {
  if (assigneesCount <= 0 || hours <= 0) {
    return [];
  }
  const base = Math.floor((hours / assigneesCount) * 100) / 100;
  const chunks = Array(assigneesCount).fill(base);
  const total = chunks.reduce((sum, chunk) => sum + chunk, 0);
  chunks[chunks.length - 1] += Math.round((hours - total) * 100) / 100;
  return chunks;
};

/** Format planner hours for Jira timetracking fields (e.g. "8h", "30m"). */
export const formatJiraTimeEstimate = (hours: number): string => {
  if (!Number.isFinite(hours) || hours <= 0) {
    return "0m";
  }
  const wholeHours = Math.floor(hours);
  const minutes = Math.round((hours - wholeHours) * 60);
  if (wholeHours > 0 && minutes > 0) {
    return `${wholeHours}h ${minutes}m`;
  }
  if (wholeHours > 0) {
    return `${wholeHours}h`;
  }
  return `${minutes}m`;
};

/** Parse a Jira estimate string ("8h", "1h 30m", "45m") into planner hours. */
export const parseJiraTimeEstimate = (raw: string | null | undefined): number | null => {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  const hourMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*h/i);
  const minuteMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*m/i);
  if (!hourMatch && !minuteMatch) {
    return null;
  }
  const hours = hourMatch ? Number(hourMatch[1]) : 0;
  const minutes = minuteMatch ? Number(minuteMatch[1]) : 0;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  return Math.round((hours + minutes / 60) * 100) / 100;
};

/** Prefer Jira seconds; fall back to the estimate string. */
export const hoursFromJiraTimetracking = (
  timetracking:
    | {
        originalEstimateSeconds?: number | null;
        originalEstimate?: string | null;
      }
    | null
    | undefined,
): number | null => {
  const seconds = timetracking?.originalEstimateSeconds;
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) {
    return Math.round((seconds / 3600) * 100) / 100;
  }
  return parseJiraTimeEstimate(timetracking?.originalEstimate ?? null);
};

/** Coerce Jira custom-field numeric hour values. */
export const hoursFromJiraNumberField = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return null;
};
