import type { Task } from "@/lib/scheduler/types";
import { parseJiraIssueNumber } from "./issueKey";
import type { PlannedJiraParentUpdate, SquadJiraConfig } from "./types";

/**
 * Branch name = story title and Jira issue number (e.g. "Pricing Engine - 123").
 */
export const buildBranchName = (task: Task): string => {
  const name = task.storyName.trim();
  if (!name) {
    return "";
  }
  const issueNumber = parseJiraIssueNumber(task.storyLink);
  if (issueNumber != null) {
    return `${name} - ${issueNumber}`;
  }
  return name;
};

/**
 * Map parent story values onto Jira custom field ids from squad config.
 */
export const buildParentJiraFieldPayload = (
  config: SquadJiraConfig,
  parent: PlannedJiraParentUpdate,
): Record<string, unknown> => {
  const fields: Record<string, unknown> = {};
  const ids = config.parentStoryFields;

  const setField = (fieldId: string, value: unknown) => {
    const trimmed = fieldId.trim();
    if (!trimmed || value === null || value === undefined) {
      return;
    }
    if (typeof value === "string" && !value.trim()) {
      return;
    }
    fields[trimmed] = value;
  };

  setField(ids.developmentEstimateHours, parent.developmentHours);
  setField(ids.testingEstimateHours, parent.testingHours);
  setField(ids.branchName, parent.branchName);

  if (parent.productManagerName) {
    if (config.productManagerFieldIsUser && parent.productManagerJiraAccountId) {
      setField(ids.productManager, { accountId: parent.productManagerJiraAccountId });
    } else if (!config.productManagerFieldIsUser) {
      setField(ids.productManager, parent.productManagerName);
    }
  }

  if (parent.qcEngineerName) {
    if (config.qcEngineerFieldIsUser && parent.qcJiraAccountId) {
      setField(ids.qcEngineer, { accountId: parent.qcJiraAccountId });
    } else {
      setField(ids.qcEngineer, parent.qcEngineerName);
    }
  }

  return fields;
};
