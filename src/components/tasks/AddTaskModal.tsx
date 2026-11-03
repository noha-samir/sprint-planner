"use client";

import { useState } from "react";
import { PLANNER_ISSUE_TYPES, type PlannerIssueType } from "@/lib/integrations/jira/issueTypes";
import type { OpenJiraSprint } from "@/lib/integrations/jira/jiraSprint";

type Props = {
  sprints: OpenJiraSprint[];
  onCancel: () => void;
  onConfirm: (choice: { issueType: PlannerIssueType; sprint: OpenJiraSprint | null }) => void;
};

/**
 * Ask for a story type and a Jira sprint before a new task is added to the board.
 * The busiest open sprint is selected first. "No sprint" leaves the task on the backlog view.
 */
export function AddTaskModal({ sprints, onCancel, onConfirm }: Props) {
  const [issueType, setIssueType] = useState<PlannerIssueType>("Story");
  const [sprintId, setSprintId] = useState<number | "none">(sprints[0]?.jiraSprintId ?? "none");
  const sprint = sprints.find((item) => item.jiraSprintId === sprintId) ?? null;

  return (
    <div
      className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-[min(12vh,6rem)]"
      onClick={onCancel}
      role="presentation"
    >
      <form
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm({ issueType, sprint });
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-task-title"
      >
        <h3 id="add-task-title" className="text-lg font-semibold text-slate-900">
          Add task
        </h3>
        <p className="mt-1 text-[13px] text-slate-600">
          Choose the story type and the sprint. The board will show the view that contains this task.
        </p>

        <label className="mt-4 block text-[12px] font-semibold text-slate-700" htmlFor="add-task-type">
          Story type
        </label>
        <select
          id="add-task-type"
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          value={issueType}
          onChange={(event) => setIssueType(event.target.value as PlannerIssueType)}
        >
          {PLANNER_ISSUE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        <fieldset className="mt-4 space-y-1">
          <legend className="mb-1 text-[12px] font-semibold text-slate-700">Sprint</legend>
          {sprints.length === 0 ? (
            <p className="text-[13px] text-slate-500">
              No open sprint is on the board yet. Pull from Jira to load the current sprint.
            </p>
          ) : null}
          {sprints.map((item, index) => {
            const selected = sprintId === item.jiraSprintId;
            return (
              <label
                key={item.jiraSprintId}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  selected ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <input
                  type="radio"
                  name="add-task-sprint"
                  className="accent-blue-600"
                  checked={selected}
                  onChange={() => setSprintId(item.jiraSprintId)}
                />
                <span className="font-medium text-slate-900">{item.jiraSprintName}</span>
                {index === 0 ? <span className="text-[12px] text-slate-500">Current sprint</span> : null}
              </label>
            );
          })}
          <label
            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
              sprintId === "none" ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50"
            }`}
          >
            <input
              type="radio"
              name="add-task-sprint"
              className="accent-blue-600"
              checked={sprintId === "none"}
              onChange={() => setSprintId("none")}
            />
            <span className="font-medium text-slate-900">No sprint</span>
          </label>
        </fieldset>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn-primary px-3 py-1.5 text-sm">
            Add task
          </button>
        </div>
      </form>
    </div>
  );
}
