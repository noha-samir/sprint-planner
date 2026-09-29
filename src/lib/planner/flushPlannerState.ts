import { usePlannerStore, type ServerPlannerSnapshot } from "@/store/usePlannerStore";

/** saved: written; conflict: someone else saved since our last sync (409); failed: network/server error. */
export type PlannerSaveResult = "saved" | "conflict" | "failed";

let plannerSaveInFlight: Promise<PlannerSaveResult> | null = null;

/**
 * Persist the current in-memory planner store to the squad's saved planner.
 * Saves from this tab run one at a time: a call made while another save is in flight waits for it,
 * then sends the new `baseUpdatedAt` (so the tab never 409s itself). A waiting call is skipped when
 * the earlier save already covered every local change.
 * Used by autosave and after Jira pull/push so a refresh does not reload a stale server snapshot.
 * @returns "conflict" when the server has a newer save than `lastServerUpdatedAt`.
 */
export const flushPlannerStateToServer = async (squadId: string | null | undefined): Promise<PlannerSaveResult> => {
  const sid = squadId?.trim();
  if (!sid) return "failed";
  let waited = false;
  while (plannerSaveInFlight) {
    waited = true;
    await plannerSaveInFlight;
  }
  if (waited && !usePlannerStore.getState().lastLocalMutationAt) return "saved";
  const save = postPlannerState(sid);
  plannerSaveInFlight = save;
  try {
    return await save;
  } finally {
    if (plannerSaveInFlight === save) plannerSaveInFlight = null;
  }
};

/**
 * POST the planner store once. Never throws.
 * Side effects: on success stores the new server `updatedAt` and clears the unsaved flag,
 * unless the planner was edited while the request was running (that edit still needs a save).
 */
const postPlannerState = async (sid: string): Promise<PlannerSaveResult> => {
  const { tasks, resources, config, plannerMeta, timelineStartDate, lastServerUpdatedAt, lastLocalMutationAt } =
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
    if (response.status === 409) return "conflict";
    if (!response.ok) return "failed";
    const body = (await response.json().catch(() => null)) as { updatedAt?: string } | null;
    usePlannerStore.getState().markPlannerSyncedToServer(
      typeof body?.updatedAt === "string" ? body.updatedAt : undefined,
      lastLocalMutationAt,
    );
    return "saved";
  } catch {
    return "failed";
  }
};

/**
 * Load the squad's saved planner.
 * @returns Snapshot for the planner store, or null when the request fails / squad has no saved board.
 */
const fetchServerPlannerSnapshot = async (squadId: string): Promise<ServerPlannerSnapshot | null> => {
  try {
    const response = await fetch("/api/planner-state", {
      cache: "no-store",
      headers: { "x-squad-id": squadId },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Partial<ServerPlannerSnapshot> & { updatedAt?: string | null };
    if (data.config == null || !Array.isArray(data.tasks) || !Array.isArray(data.resources)) return null;
    return {
      tasks: data.tasks,
      resources: data.resources,
      config: data.config,
      plannerMeta: data.plannerMeta,
      timelineStartDate: data.timelineStartDate ?? null,
      serverUpdatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
    };
  } catch {
    return null;
  }
};

/**
 * Save after a Jira pull/push. On conflict, reload the saved planner, re-apply only `changedTaskIds`
 * (the stories Jira just updated, plus newly imported ones) and save once more.
 * @param squadId - Active squad.
 * @param changedTaskIds - Task ids whose local version must survive the merge.
 * Side effects: may replace other rows in the planner store with the saved server version.
 */
export const savePlannerAfterJiraSync = async (
  squadId: string | null | undefined,
  changedTaskIds: string[],
): Promise<PlannerSaveResult> => {
  const firstAttempt = await flushPlannerStateToServer(squadId);
  const sid = squadId?.trim();
  if (firstAttempt !== "conflict" || !sid) return firstAttempt;
  const snapshot = await fetchServerPlannerSnapshot(sid);
  if (!snapshot) return "conflict";
  usePlannerStore.getState().rebaseOntoServerSnapshot(snapshot, changedTaskIds);
  return flushPlannerStateToServer(sid);
};

/**
 * Discard unsaved local edits and load the saved planner (used by the "Reload" action after a conflict).
 * @returns true when the saved planner was loaded.
 */
export const reloadPlannerFromServer = async (squadId: string | null | undefined): Promise<boolean> => {
  const sid = squadId?.trim();
  if (!sid) return false;
  const snapshot = await fetchServerPlannerSnapshot(sid);
  if (!snapshot) return false;
  usePlannerStore.getState().replaceWithServerSnapshot(snapshot);
  return true;
};
