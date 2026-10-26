"use client";

import { useState } from "react";

export type JiraSprintChoice = {
  projectKey: string;
  storyCount: number;
  sprints: Array<{ jiraSprintId: number; jiraSprintName: string }>;
};

type Props = {
  choices: JiraSprintChoice[];
  onClose: () => void;
  onConfirm: (sprintIdByProject: Record<string, number>) => void;
};

/**
 * Pick which open Jira sprint receives the selected stories when a project has more than one.
 * Calls `onConfirm` with the sprint id chosen for each project key.
 */
export function JiraSprintChoiceModal({ choices, onClose, onConfirm }: Props) {
  const [pickedByProject, setPickedByProject] = useState<Record<string, number>>({});
  const ready = choices.every((choice) => typeof pickedByProject[choice.projectKey] === "number");
  const storyCount = choices.reduce((sum, choice) => sum + choice.storyCount, 0);
  const storyWord = storyCount === 1 ? "story" : "stories";

  return (
    <div
      className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-[min(12vh,6rem)]"
      onClick={onClose}
      role="presentation"
    >
      <form
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          onConfirm(pickedByProject);
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="jira-sprint-choice-title"
      >
        <h3 id="jira-sprint-choice-title" className="text-lg font-semibold text-slate-900">
          Choose the Jira sprint
        </h3>
        <p className="mt-1 text-[13px] text-slate-600">
          Jira has more than one open sprint. Pick where to add {storyCount} {storyWord}.
        </p>

        <div className="mt-4 space-y-4">
          {choices.map((choice) => (
            <fieldset key={choice.projectKey} className="space-y-1">
              {choices.length > 1 ? (
                <legend className="mb-1 text-[12px] font-semibold text-slate-700">
                  {choice.projectKey} · {choice.storyCount} {choice.storyCount === 1 ? "story" : "stories"}
                </legend>
              ) : (
                <legend className="sr-only">Open Jira sprint</legend>
              )}
              {choice.sprints.map((sprint) => {
                const selected = pickedByProject[choice.projectKey] === sprint.jiraSprintId;
                return (
                  <label
                    key={sprint.jiraSprintId}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                      selected ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`jira-sprint-${choice.projectKey}`}
                      className="accent-blue-600"
                      checked={selected}
                      onChange={() =>
                        setPickedByProject((current) => ({
                          ...current,
                          [choice.projectKey]: sprint.jiraSprintId,
                        }))
                      }
                    />
                    <span className="font-semibold text-slate-900">{sprint.jiraSprintName}</span>
                  </label>
                );
              })}
            </fieldset>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            className="btn-secondary px-3 py-1.5 text-sm"
            title="Close without changing Jira"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={!ready}
            title={ready ? "Add the selected stories to this Jira sprint" : "Pick a sprint first"}
          >
            Add to sprint
          </button>
        </div>
      </form>
    </div>
  );
}
