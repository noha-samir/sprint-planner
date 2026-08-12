"use client";

import { GanttTimeline } from "@/components/timeline/GanttTimeline";
import { usePlannerStore } from "@/store/usePlannerStore";

export default function TimelinePage() {
  const timelineStartDate = usePlannerStore((state) => state.timelineStartDate);
  const setTimelineStartDate = usePlannerStore((state) => state.setTimelineStartDate);
  return (
    <main className="mx-auto flex min-h-0 w-full max-w-[1280px] flex-1 flex-col gap-4 overflow-hidden">
      <div className="shrink-0">
        <h1 className="section-title">Timeline</h1>
        <p className="mt-1 text-sm text-slate-500">Phase pipeline for each story — FE, BE, integration, QC, and buffer.</p>
      </div>
      <section className="page-card flex min-h-0 flex-1 flex-col overflow-hidden p-4 md:p-5">
        <div className="mb-3 flex items-center gap-2">
          <label className="text-sm font-medium text-slate-700">Timeline start</label>
          <input
            type="date"
            className="field-input px-2 py-1 text-sm"
            value={timelineStartDate ?? ""}
            onChange={(event) => setTimelineStartDate(event.target.value || null)}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <GanttTimeline />
        </div>
      </section>
    </main>
  );
}
