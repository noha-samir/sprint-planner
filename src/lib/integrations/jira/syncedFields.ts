import type { JiraSyncedFields, Task } from "@/lib/scheduler/types";
import { isDiscopedTaskStatus } from "@/lib/scheduler/taskStatus";
import { isTechnicalTaskIssueType } from "@/lib/planner/taskIssueFilters";
import { isJiraStoryLink } from "./issueKey";

type HoursField = "feHours" | "beHours" | "androidHours" | "iosHours" | "qcHours";
type NamesField = "feDevs" | "beDevs" | "androidDevs" | "iosDevs";
type TextField = "storyName" | "status" | "qcEngineer" | "productManager";
type SyncedField = keyof JiraSyncedFields;

const HOURS_FIELDS: readonly HoursField[] = ["feHours", "beHours", "androidHours", "iosHours", "qcHours"];
const NAMES_FIELDS: readonly NamesField[] = ["feDevs", "beDevs", "androidDevs", "iosDevs"];

/** Display order of pending changes (story → status → dev → QC → PM). */
const FIELD_ORDER: readonly SyncedField[] = [
  "storyName",
  "status",
  "beDevs",
  "beHours",
  "feDevs",
  "feHours",
  "androidDevs",
  "androidHours",
  "iosDevs",
  "iosHours",
  "qcEngineer",
  "qcHours",
  "productManager",
];

const FIELD_LABELS: Record<SyncedField, string> = {
  storyName: "Story name",
  status: "Status",
  beDevs: "BE developers",
  beHours: "BE hours",
  feDevs: "FE developers",
  feHours: "FE hours",
  androidDevs: "Android developers",
  androidHours: "Android hours",
  iosDevs: "iOS developers",
  iosHours: "iOS hours",
  qcEngineer: "QC engineer",
  qcHours: "Testing (QC) hours",
  productManager: "Product manager",
};

const HOURS_EPSILON = 0.001;
const MAX_HINT_CHANGES = 8;

const roundHours = (value: unknown): number => Math.round(Math.max(0, Number(value) || 0) * 100) / 100;

const cleanNames = (names: unknown): string[] =>
  [...new Set((Array.isArray(names) ? names : []).map((name) => String(name ?? "").trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );

const primaryName = (names: string[] | undefined): string =>
  (names ?? []).map((name) => name.trim()).find(Boolean) ?? "";

/** Story fields Push sends to Jira. */
export type JiraSyncedFieldsSource = Pick<
  Task,
  | "storyName"
  | "status"
  | "feHours"
  | "beHours"
  | "androidHours"
  | "iosHours"
  | "needsIos"
  | "qcHours"
  | "feDevs"
  | "beDevs"
  | "androidDevs"
  | "iosDevs"
  | "qcs"
  | "productManagers"
>;

/**
 * Snapshot the values Push sends to Jira for a story.
 * @param task - Planner story (after pull patch / as pushed / as loaded when no snapshot exists yet).
 * @param jiraStatus - Status Jira actually holds (defaults to the planner status).
 * @returns Normalized snapshot stored on `task.jira.syncedFields`.
 */
export const buildJiraSyncedFields = (
  task: JiraSyncedFieldsSource,
  jiraStatus: string = task.status,
): JiraSyncedFields => ({
  storyName: task.storyName.trim(),
  status: jiraStatus.trim(),
  feHours: roundHours(task.feHours),
  beHours: roundHours(task.beHours),
  androidHours: roundHours(task.androidHours),
  iosHours: task.needsIos ? roundHours(task.iosHours) : 0,
  qcHours: roundHours(task.qcHours),
  feDevs: cleanNames(task.feDevs),
  beDevs: cleanNames(task.beDevs),
  androidDevs: cleanNames(task.androidDevs),
  iosDevs: task.needsIos ? cleanNames(task.iosDevs) : [],
  qcEngineer: primaryName(task.qcs),
  productManager: primaryName(task.productManagers),
});

/**
 * Parse a stored snapshot (DB JSON / autosave payload).
 * @param raw - Unknown JSON value.
 * @returns A complete snapshot, or undefined when the value is not an object.
 */
export const normalizeJiraSyncedFields = (raw: unknown): JiraSyncedFields | undefined => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const text = (key: TextField) => (typeof value[key] === "string" ? (value[key] as string).trim() : "");
  return {
    storyName: text("storyName"),
    status: text("status"),
    feHours: roundHours(value.feHours),
    beHours: roundHours(value.beHours),
    androidHours: roundHours(value.androidHours),
    iosHours: roundHours(value.iosHours),
    qcHours: roundHours(value.qcHours),
    feDevs: cleanNames(value.feDevs),
    beDevs: cleanNames(value.beDevs),
    androidDevs: cleanNames(value.androidDevs),
    iosDevs: cleanNames(value.iosDevs),
    qcEngineer: text("qcEngineer"),
    productManager: text("productManager"),
  };
};

/** One planner edit that Jira does not have yet. */
export type JiraPendingChange = {
  field: SyncedField;
  label: string;
  from: string;
  to: string;
};

const isSameValue = (field: SyncedField, before: JiraSyncedFields, after: JiraSyncedFields): boolean => {
  if ((HOURS_FIELDS as readonly string[]).includes(field)) {
    return Math.abs((before[field] as number) - (after[field] as number)) < HOURS_EPSILON;
  }
  if ((NAMES_FIELDS as readonly string[]).includes(field)) {
    return (before[field] as string[]).join("\n") === (after[field] as string[]).join("\n");
  }
  if (field === "status") {
    return before.status.toLowerCase() === after.status.toLowerCase();
  }
  return before[field] === after[field];
};

const formatValue = (field: SyncedField, snapshot: JiraSyncedFields): string => {
  const value = snapshot[field];
  if (typeof value === "number") return `${value}h`;
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "none";
  return value || (field === "storyName" ? "empty" : "none");
};

/**
 * Planner edits since the last pull/push that Push would send to Jira.
 * @param task - Live planner story.
 * @returns Changes in display order; empty when in sync, never baselined, unlinked, or Discoped.
 */
export const listJiraPendingChanges = (task: Task): JiraPendingChange[] => {
  const baseline = task.jira?.syncedFields;
  if (!baseline || !isJiraStoryLink(task.storyLink) || isDiscopedTaskStatus(task.status)) return [];
  const current = buildJiraSyncedFields(task);
  const technical = isTechnicalTaskIssueType(task.issueType);
  return FIELD_ORDER.filter((field) => !isSameValue(field, baseline, current)).map((field) => ({
    field,
    label: field === "feHours" && technical ? "Dev hours" : FIELD_LABELS[field],
    from: formatValue(field, baseline),
    to: formatValue(field, current),
  }));
};

/** Put `primary` first in a people list, keeping the other names; empty when there is no primary. */
const withPrimaryName = (names: string[] | undefined, primary: string): string[] =>
  primary ? [primary, ...(names ?? []).filter((name) => name.trim() && name.trim() !== primary)] : [];

/**
 * Undo planner edits that Jira does not have: set every pending field back to the value from the last pull/push.
 * QC / PM restore only the primary person (Jira holds one), keeping any extra planner names.
 * @param task - Live planner story.
 * @returns Patch for the store (empty when nothing is pending).
 */
export const buildRevertToJiraPatch = (task: Task): Partial<Task> => {
  const baseline = task.jira?.syncedFields;
  const changes = listJiraPendingChanges(task);
  if (!baseline || changes.length === 0) return {};

  const patch: Partial<Task> = {};
  for (const { field } of changes) {
    if (field === "qcEngineer") {
      patch.qcs = withPrimaryName(task.qcs, baseline.qcEngineer);
    } else if (field === "productManager") {
      patch.productManagers = withPrimaryName(task.productManagers, baseline.productManager);
    } else if ((HOURS_FIELDS as readonly string[]).includes(field)) {
      patch[field as HoursField] = baseline[field as HoursField];
    } else if ((NAMES_FIELDS as readonly string[]).includes(field)) {
      patch[field as NamesField] = [...baseline[field as NamesField]];
    } else {
      patch[field as "storyName" | "status"] = baseline[field as "storyName" | "status"];
    }
  }
  // iOS values only reach Jira while Needs iOS is on.
  if ((patch.iosHours ?? 0) > 0 || (patch.iosDevs?.length ?? 0) > 0) {
    patch.needsIos = true;
  }
  return patch;
};

/**
 * Hover / confirm text for undoing planner edits back to the Jira values.
 * @param changes - Output of listJiraPendingChanges (non-empty).
 * @returns Multi-line text listing each field as planner value → Jira value.
 */
export const formatRevertToJiraHint = (changes: JiraPendingChange[]): string => {
  const lines = [
    "Undo planner edits — put back what Jira has (nothing is sent to Jira):",
    ...changes.slice(0, MAX_HINT_CHANGES).map((change) => `• ${change.label}: ${change.to} → ${change.from}`),
  ];
  if (changes.length > MAX_HINT_CHANGES) {
    lines.push(`• …and ${changes.length - MAX_HINT_CHANGES} more`);
  }
  return lines.join("\n");
};

/**
 * Hover text for a story that needs a push.
 * @param changes - Output of listJiraPendingChanges (non-empty).
 * @param lastSyncedLabel - Formatted time of the last pull/push (e.g. "01 Oct 13:20"), or null.
 * @param canPush - Whether the viewer may push (adds the click hint).
 * @returns Multi-line text for the hover hint layer.
 */
export const formatJiraPendingChangesHint = (
  changes: JiraPendingChange[],
  lastSyncedLabel: string | null,
  canPush: boolean,
): string => {
  const since = lastSyncedLabel ? ` (last synced ${lastSyncedLabel})` : "";
  const lines = [
    `Needs push — changed in the planner since the last Jira sync${since}. Jira still shows the old values:`,
    ...changes.slice(0, MAX_HINT_CHANGES).map((change) => `• ${change.label}: ${change.from} → ${change.to}`),
  ];
  if (changes.length > MAX_HINT_CHANGES) {
    lines.push(`• …and ${changes.length - MAX_HINT_CHANGES} more`);
  }
  lines.push(
    canPush
      ? "Click to push this story now so Jira matches the planner. Unchanged subtasks are left alone."
      : "An editor needs to push this story to update Jira.",
  );
  return lines.join("\n");
};
