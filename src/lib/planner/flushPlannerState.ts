import { usePlannerStore } from "@/store/usePlannerStore";

/**
 * Persist the current in-memory planner store to the squad's server file.
 * Used after Jira pull/push so a refresh does not reload a stale server snapshot.
 */
export const flushPlannerStateToServer = async (squadId: string | null | undefined): Promise<boolean> => {
  const sid = squadId?.trim();
  if (!sid) return false;
  const { tasks, resources, config, plannerMeta, timelineStartDate, lastServerUpdatedAt } =
    usePlannerStore.getState();
  try {
    const response = await fetch("/api/planner-state", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-squad-id": sid,
      },
      body: JSON.stringify({
        tasks,
        resources,
        config,
        plannerMeta,
        timelineStartDate,
        baseUpdatedAt: lastServerUpdatedAt,
      }),
    });
    if (response.status === 409) {
      return false;
    }
    if (!response.ok) return false;
    const body = (await response.json().catch(() => null)) as { updatedAt?: string } | null;
    usePlannerStore.getState().markPlannerSyncedToServer(body?.updatedAt ?? null);
    return true;
  } catch {
    return false;
  }
};
