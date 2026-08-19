"use client";

import { format } from "date-fns";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { getCapabilities, plannerAccessContext } from "@/lib/access/control";
import { getSprintWindowEnd } from "@/lib/scheduler/calendar";
import type { ReleaseStrategy } from "@/lib/scheduler/types";
import { AppearanceToggle } from "@/components/config/AppearanceToggle";
import { usePlannerStore } from "@/store/usePlannerStore";

const clampWorkdayStartHour = (value: number) => Math.max(0, Math.min(23, Math.trunc(value) || 0));

export function ConfigForm() {
  const { data: session } = useSession();
  const activeSquadId = usePlannerStore((state) => state.activeSquadId);
  const role = session?.user?.role;
  const isEditor =
    !!role &&
    getCapabilities(plannerAccessContext(session, activeSquadId)).canEditOpsTabs;
  const { config, updateConfig } = usePlannerStore();
  const [holidayDate, setHolidayDate] = useState("");

  const addHoliday = () => {
    if (!holidayDate || config.extraHolidays.includes(holidayDate)) {
      return;
    }
    updateConfig({ extraHolidays: [...config.extraHolidays, holidayDate].sort() });
    setHolidayDate("");
  };

  const removeHoliday = (date: string) => {
    updateConfig({ extraHolidays: config.extraHolidays.filter((item) => item !== date) });
  };

  return (
    <div className="max-w-xl space-y-4">
      <AppearanceToggle />
      <label className="block space-y-1">
        <span className="text-sm">Sprint Start Date</span>
        <input
          type="date"
          disabled={!isEditor}
          className="field-input"
          value={config.sprintStartDate}
          onChange={(event) =>
            updateConfig({ sprintStartDate: event.target.value, planningSunday: event.target.value })
          }
        />
        <p className="text-[13px] text-slate-500">
          Planning uses this date as the anchor: that day and every <strong>14 days</strong> after are treated as
          non-working (biweekly planning). Other Sundays in between still count as normal sprint days.
        </p>
      </label>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-medium text-slate-800">
        Sprint window ends:{" "}
        <span className="tabular-nums">{format(getSprintWindowEnd(config), "EEE dd MMM, yyyy")}</span>
        <span className="ml-1 font-normal text-slate-600">(end of last usable working day in the window)</span>
      </div>
      <label className="block space-y-1">
        <span className="text-sm">Hours Per Day</span>
        <input
          type="number"
          disabled={!isEditor}
          className="field-input"
          value={config.hoursPerDay}
          onChange={(event) => updateConfig({ hoursPerDay: Number(event.target.value) || 8 })}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm">Workday start (hour, 0–23)</span>
        <input
          type="number"
          min={0}
          max={23}
          disabled={!isEditor}
          title="First working hour of the day (local), e.g. 11 after standups."
          className="field-input"
          value={config.workdayStartHour ?? 11}
          onChange={(event) =>
            updateConfig({ workdayStartHour: clampWorkdayStartHour(Number(event.target.value)) })
          }
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm">Release ordering (non–PO-priority stories)</span>
        <select
          disabled={!isEditor}
          className="field-input"
          value={config.releaseStrategy ?? "earliestStoriesFirst"}
          onChange={(event) => updateConfig({ releaseStrategy: event.target.value as ReleaseStrategy })}
        >
          <option value="earliestStoriesFirst">Earlier releases first (default)</option>
          <option value="latestReleaseOnly">Latest release only (legacy)</option>
        </select>
      </label>
      <div className="space-y-2">
        <span className="text-sm">Extra Holidays</span>
        <div className="flex gap-2">
          <input
            type="date"
            disabled={!isEditor}
            className="field-input"
            value={holidayDate}
            onChange={(event) => setHolidayDate(event.target.value)}
          />
          <button type="button" className="btn-primary disabled:opacity-50" disabled={!isEditor} onClick={addHoliday}>
            Add
          </button>
        </div>
        <div className="space-y-2">
          {config.extraHolidays.length === 0 && <p className="text-sm text-slate-500">No extra holidays added.</p>}
          {config.extraHolidays.map((date) => (
            <div key={date} className="flex items-center justify-between rounded-xl border border-slate-200 p-2">
              <span>{date}</span>
              <button
                type="button"
                className="btn-danger px-2 py-1 disabled:opacity-50"
                disabled={!isEditor}
                onClick={() => removeHoliday(date)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
