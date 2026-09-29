import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useJiraSyncStore } from "./useJiraSyncStore";

const preparingPull = { mode: "pull" as const, title: "Getting ready to pull", detail: "Searching Jira…" };
const oneTask = [{ taskId: "t1", storyName: "Story 1" }];

describe("useJiraSyncStore loading screen state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    useJiraSyncStore.getState().finish({ summary: "" });
    useJiraSyncStore.getState().clearSummary();
  });

  afterEach(() => vi.useRealTimers());

  it("keeps the preparing start time when stories start syncing", () => {
    const store = useJiraSyncStore.getState();
    store.setPreparing(preparingPull);
    vi.setSystemTime(5_000);
    store.start({ mode: "pull", tasks: oneTask });

    const state = useJiraSyncStore.getState();
    expect(state.preparing).toBeNull();
    expect(state.active).toBe(true);
    expect(state.busySince).toBe(1_000);
  });

  it("clears the start time when preparing is cancelled before any sync", () => {
    const store = useJiraSyncStore.getState();
    store.setPreparing(preparingPull);
    store.setPreparing(null);

    expect(useJiraSyncStore.getState().busySince).toBeNull();
    expect(useJiraSyncStore.getState().active).toBe(false);
  });

  it("resets preparing and start time on finish", () => {
    const store = useJiraSyncStore.getState();
    store.start({ mode: "push", tasks: oneTask });
    store.markRunning("t1");
    store.markDone({ taskId: "t1", ok: true });
    store.finish({ summary: "Done" });

    const state = useJiraSyncStore.getState();
    expect(state.completed).toBe(1);
    expect(state.active).toBe(false);
    expect(state.preparing).toBeNull();
    expect(state.busySince).toBeNull();
  });
});
