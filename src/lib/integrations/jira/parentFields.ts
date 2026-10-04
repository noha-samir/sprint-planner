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
 * @param config - Squad Jira config (field ids, user-field flags).
 * @param parent - Planned parent values.
 * @param options.omitZeroDevelopmentEstimate - Leave the Development estimate untouched when it is 0
 *   (parent-only push: the planner has no dev work, so the dev side is not touched).
 * @returns Jira `fields` payload; empty when nothing is configured or set.
 */
export const buildParentJiraFieldPayload = (
  config: SquadJiraConfig,
  parent: PlannedJiraParentUpdate,
  options: { omitZeroDevelopmentEstimate?: boolean } = {},
): Record<string, unknown> => {
  const fields: Record<string, unknown> = {};
  const ids = config.parentStoryFields;
  const developmentHours =
    options.omitZeroDevelopmentEstimate && parent.developmentHours <= 0 ? null : parent.developmentHours;

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

  setField(ids.developmentEstimateHours, developmentHours);
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
