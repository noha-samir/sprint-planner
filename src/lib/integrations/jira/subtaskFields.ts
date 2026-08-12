import { formatJiraTimeEstimate } from "./hours";

/**
 * Jira fields for FE/BE subtask hour estimates (timetracking + Development Estimate custom field).
 * Includes 0h so assignees with zero hours still get an estimate written.
 */
export const buildSubtaskHourFields = (
  hours: number,
  developmentEstimateFieldId?: string,
): Record<string, unknown> => {
  const safeHours = Number.isFinite(hours) ? Math.max(0, hours) : 0;
  const estimate = formatJiraTimeEstimate(safeHours);
  const fields: Record<string, unknown> = {
    timetracking: {
      originalEstimate: estimate,
      remainingEstimate: estimate,
    },
  };

  const fieldId = developmentEstimateFieldId?.trim();
  if (fieldId) {
    fields[fieldId] = safeHours;
  }
  return fields;
};
