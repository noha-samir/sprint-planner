"use client";

import { useSession } from "next-auth/react";
import { useEffect, useMemo, useRef } from "react";
import { getCapabilities, plannerAccessContext } from "@/lib/access/control";
import { flushPlannerStateToServer } from "@/lib/planner/flushPlannerState";
import { useJiraSyncStore } from "@/store/useJiraSyncStore";
import { usePlannerSaveStore } from "@/store/usePlannerSaveStore";
import { usePlannerStore } from "@/store/usePlannerStore";

const applyServerPlannerPayload = async (
  data: {
    tasks: unknown;
    resources: unknown;
    config: unknown;
    plannerMeta?: unknown;
    timelineStartDate?: string | null;
    updatedAt?: string | null;
  },
  activeSquadId: string | null,
  options?: { canWrite?: boolean },
) => {
  if (data.config == null || !Array.isArray(data.tasks) || !Array.isArray(data.resources)) {
    return false;
  }

  const localMutationAt = usePlannerStore.getState().lastLocalMutationAt;
  const serverUpdatedAt = typeof data.updatedAt === "string" ? data.updatedAt : null;
  if (
    options?.canWrite &&
    localMutationAt &&
    serverUpdatedAt &&
    Number.isFinite(Date.parse(localMutationAt)) &&
    Number.isFinite(Date.parse(serverUpdatedAt)) &&
    Date.parse(localMutationAt) > Date.parse(serverUpdatedAt)
  ) {
    // Don't race a long Jira pull/push with an opportunistic save.
    if (useJiraSyncStore.getState().active) return true;
    await flushPlannerStateToServer(activeSquadId);
    return true;
  }

  usePlannerStore.getState().hydrateFromServer({
    tasks: data.tasks,
    resources: data.resources,
    config: data.config as never,
    plannerMeta: (data.plannerMeta as never) ?? undefined,
    timelineStartDate: data.timelineStartDate ?? null,
    serverUpdatedAt,
  });
  return true;
};

export function PlannerServerSync() {
  const { data: session, status } = useSession();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const switchingSquadRef = useRef(false);
  const initializedSquadRef = useRef<string | null>(null);
  const hasHydrated = usePlannerStore((state) => state.hasHydrated);
  const activeSquadId = usePlannerStore((state) => state.activeSquadId);

  const role = session?.user?.role;
  const squadId = session?.user?.squadId ?? null;
  const canWrite = !!(
    role &&
    session?.user?.email &&
    getCapabilities(plannerAccessContext(session, activeSquadId)).canWrite
  );

  useEffect(() => {
    if (status !== "authenticated" || !hasHydrated) return;
    if (squadId && activeSquadId !== squadId && role !== "super_admin") {
      usePlannerStore.getState().setActiveSquadId(squadId);
      return;
    }
    if (!activeSquadId && squadId) {
      usePlannerStore.getState().setActiveSquadId(squadId);
    }
  }, [status, hasHydrated, activeSquadId, squadId, role]);

  const squadHeaders = useMemo((): Record<string, string> => {
    if (!activeSquadId) return {};
    return { "x-squad-id": activeSquadId };
  }, [activeSquadId]);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (!hasHydrated) return;
    if (!canWrite) return;

    const controller = new AbortController();
    const squadAtStart = activeSquadId;
    void (async () => {
      const squadChanged = initializedSquadRef.current !== activeSquadId;
      if (squadChanged) {
        switchingSquadRef.current = true;
        initializedSquadRef.current = activeSquadId ?? null;
      }
      try {
        const response = await fetch("/api/planner-state", {
          cache: "no-store",
          headers: squadHeaders,
          signal: controller.signal,
        });
        if (!response.ok || controller.signal.aborted) return;
        if (usePlannerStore.getState().activeSquadId !== squadAtStart) return;
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (data.config == null && Array.isArray(data.tasks) && Array.isArray(data.resources)) {
          const local = usePlannerStore.getState();
          const hasLocalData = local.tasks.length > 0 || local.resources.length > 0;
          if (!hasLocalData) {
            usePlannerStore.getState().hydrateEmptySquad();
          }
          switchingSquadRef.current = false;
          return;
        }
        await applyServerPlannerPayload(data, activeSquadId, { canWrite: true });
        switchingSquadRef.current = false;
      } catch {
        if (!controller.signal.aborted) {
          switchingSquadRef.current = false;
        }
      }
    })();

    return () => controller.abort();
  }, [status, canWrite, hasHydrated, activeSquadId, squadHeaders]);

  useEffect(() => {
    if (!canWrite) return;
    if (!hasHydrated) return;

    const clearDebounce = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = undefined;
      }
    };

    const flushToServer = async () => {
      if (useJiraSyncStore.getState().active) return;
      // Skip if another sync already cleared the dirty flag (or hydrate won).
      if (!usePlannerStore.getState().lastLocalMutationAt) return;
      const saveStore = usePlannerSaveStore.getState();
      saveStore.markSaving();
      const ok = await flushPlannerStateToServer(activeSquadId);
      if (useJiraSyncStore.getState().active) {
        // Jira sync took over while we were saving — drop the save chip.
        saveStore.clear();
        return;
      }
      if (ok) {
        saveStore.markSaved();
      } else {
        saveStore.markError("Could not save planner");
      }
    };

    const scheduleFlush = () => {
      if (useJiraSyncStore.getState().active) {
        clearDebounce();
        return;
      }
      clearDebounce();
      debounceRef.current = setTimeout(() => {
        void flushToServer();
      }, 900);
    };

    const unsubPlanner = usePlannerStore.subscribe((state, prevState) => {
      if (switchingSquadRef.current) {
        clearDebounce();
        return;
      }
      if (useJiraSyncStore.getState().active) {
        clearDebounce();
        return;
      }
      // Only persist real editor mutations — not hydrate / post-save store updates.
      if (!state.lastLocalMutationAt) return;
      if (state.lastLocalMutationAt === prevState.lastLocalMutationAt) return;
      scheduleFlush();
    });

    const unsubJira = useJiraSyncStore.subscribe((state, prevState) => {
      if (state.active && !prevState.active) {
        clearDebounce();
        const saveStatus = usePlannerSaveStore.getState().status;
        if (saveStatus === "saving" || saveStatus === "saved") {
          usePlannerSaveStore.getState().clear();
        }
        return;
      }
      if (!state.active && prevState.active && usePlannerStore.getState().lastLocalMutationAt) {
        scheduleFlush();
      }
    });

    const onPageHide = () => {
      clearDebounce();
      if (useJiraSyncStore.getState().active) return;
      if (usePlannerStore.getState().lastLocalMutationAt) {
        void flushToServer();
      }
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onPageHide);
    return () => {
      unsubPlanner();
      unsubJira();
      clearDebounce();
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onPageHide);
    };
  }, [canWrite, hasHydrated, activeSquadId]);

  useEffect(() => {
    if (canWrite) return;
    if (status !== "authenticated") return;
    const controller = new AbortController();
    const tick = async () => {
      try {
        const response = await fetch("/api/planner-state", {
          cache: "no-store",
          headers: squadHeaders,
          signal: controller.signal,
        });
        if (!response.ok || controller.signal.aborted) return;
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (data.config == null && Array.isArray(data.tasks) && Array.isArray(data.resources)) {
          const local = usePlannerStore.getState();
          const hasLocalData = local.tasks.length > 0 || local.resources.length > 0;
          if (!hasLocalData) {
            usePlannerStore.getState().hydrateEmptySquad();
          }
          return;
        }
        await applyServerPlannerPayload(data, activeSquadId, { canWrite: false });
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = setInterval(tick, 30_000);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [canWrite, status, activeSquadId, squadHeaders]);

  return null;
}
