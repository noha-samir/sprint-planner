"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { StartNewSprintModal } from "@/components/tasks/StartNewSprintModal";
import { TaskTable } from "@/components/tasks/TaskTable";
import { getCapabilities, plannerAccessContext } from "@/lib/access/control";
import { usePlannerStore } from "@/store/usePlannerStore";

function NewSprintButton() {
  const { data: session } = useSession();
  const startNewSprint = usePlannerStore((state) => state.startNewSprint);
  const tasks = usePlannerStore((state) => state.tasks);
  const activeSquadId = usePlannerStore((state) => state.activeSquadId);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const role = session?.user?.role;
  const canManageSprintLifecycle =
    !!role &&
    getCapabilities(plannerAccessContext(session, activeSquadId)).canManageSprintLifecycle;
  if (!canManageSprintLifecycle) {
    return null;
  }

  const nextSprintStories = tasks.filter((task) => !!task.carryToNextSprint).length;

  return (
    <>
      <button
        className="btn-danger disabled:opacity-50"
        disabled={busy}
        onClick={() => setModalOpen(true)}
      >
        Start New Sprint
      </button>
      <StartNewSprintModal
        open={modalOpen}
        totalStories={tasks.length}
        nextSprintStories={nextSprintStories}
        busy={busy}
        onClose={() => {
          if (!busy) {
            setModalOpen(false);
          }
        }}
        onConfirm={(sprintStartDate) => {
          void (async () => {
            setBusy(true);
            try {
              await startNewSprint({ sprintStartDate });
              setModalOpen(false);
            } catch (error) {
              window.alert(
                error instanceof Error
                  ? error.message
                  : "Could not archive the current sprint to History. The live board was left unchanged.",
              );
            } finally {
              setBusy(false);
            }
          })();
        }}
      />
    </>
  );
}

export default function Home() {
  return (
    <main className="mx-auto flex h-full min-h-0 w-full min-w-0 max-w-full flex-1 flex-col gap-2 overflow-hidden md:gap-3">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="section-title">Dashboard</h1>
          <p className="mt-0.5 text-sm text-slate-500">Plan sprint tasks with FE/BE/QC parallel scheduling.</p>
        </div>
        <NewSprintButton />
      </div>
      <section className="page-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-2 md:p-3">
        <TaskTable />
      </section>
    </main>
  );
}
