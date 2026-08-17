export type JiraSubtaskRole = "fe" | "be" | "android" | "ios";

export interface JiraTaskSubtaskRef {
  key: string;
  role: JiraSubtaskRole;
  assigneeName: string;
  hours: number;
}

export interface TaskJiraMeta {
  parentIssueKey: string;
  lastPushedAt: string | null;
  /** ISO timestamp of the last successful pull from Jira. */
  lastPulledAt?: string | null;
  subtasks: JiraTaskSubtaskRef[];
}

/** Jira custom field ids (e.g. customfield_10123) for the parent story. */
export interface JiraParentStoryFieldIds {
  developmentEstimateHours: string;
  testingEstimateHours: string;
  qcEngineer: string;
  productManager: string;
  branchName: string;
}

export interface SquadJiraConfig {
  /** Jira Cloud site URL (e.g. https://your-domain.atlassian.net). */
  siteUrl: string;
  projectKey: string;
  issueTypeSubTask: string;
  productManagerName: string;
  /** Jira accountId for Product Manager when the field is a user picker. */
  productManagerJiraAccountId: string;
  parentStoryFields: JiraParentStoryFieldIds;
  /** When true, QC Engineer is a Jira user field (accountId). Otherwise plain text name. */
  qcEngineerFieldIsUser: boolean;
  /** When true, Product Manager is a Jira user field (accountId). Otherwise plain text name. */
  productManagerFieldIsUser: boolean;
  /** Required on subtask create — Jira custom field id (e.g. customfield_10001). */
  subtaskSquadFieldId: string;
  /** Jira select option id for Squad (e.g. 10001). */
  subtaskSquadOptionId: string;
  /** Parent-story Engineering Manager user field (customfield_…) used to import missing stories. */
  engineeringManagerFieldId: string;
  assigneeMap: Record<string, string>;
  /** ISO timestamp of last successful account sync from Jira (read-only for clients). */
  assigneesSyncedAt?: string | null;
}

export interface PlannedJiraSubtask {
  role: JiraSubtaskRole;
  assigneeName: string;
  jiraAccountId: string | null;
  hours: number;
  summary: string;
  existingKey?: string;
}

export interface PlannedJiraParentUpdate {
  qcEngineerName: string;
  qcJiraAccountId: string | null;
  developmentHours: number;
  testingHours: number;
  productManagerName: string;
  productManagerJiraAccountId: string | null;
  branchName: string;
}

export const defaultParentStoryFieldIds = (): JiraParentStoryFieldIds => ({
  developmentEstimateHours: "",
  testingEstimateHours: "",
  qcEngineer: "",
  productManager: "",
  branchName: "",
});

/** Empty client-safe defaults (all product settings live in SquadJiraConfig DB). */
export const defaultSquadJiraConfig = (): SquadJiraConfig => ({
  siteUrl: "",
  projectKey: "",
  issueTypeSubTask: "Sub-task",
  productManagerName: "",
  productManagerJiraAccountId: "",
  parentStoryFields: defaultParentStoryFieldIds(),
  qcEngineerFieldIsUser: true,
  productManagerFieldIsUser: true,
  subtaskSquadFieldId: "",
  subtaskSquadOptionId: "",
  engineeringManagerFieldId: "",
  assigneeMap: {},
  assigneesSyncedAt: null,
});
