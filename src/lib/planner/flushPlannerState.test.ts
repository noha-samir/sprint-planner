import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/scheduler/types";
import { usePlannerStore } from "@/store/usePlannerStore";
import { flushPlannerStateToServer, reloadPlannerFromServer, savePlannerAfterJiraSync } from "./flushPlannerState";

const makeTask = (id: string, storyName: string): Task => ({
  id,
  storyName,
  storyLink: "",
  poPriority: null,
  feDevs: [],
  feHours: 0,
  beDevs: [],
  beHours: 0,
  androidDevs: [],
  androidHours: 0,
  iosDevs: [],
  iosHours: 0,
  needsIos: false,
  integrationHours: 0,
  integrationFlags: {
    needsDevOps: false,
    needsCdc: false,
    needsDbSync: false,
    needsOtherSquad: false,
    needsThirdParty: false,
  },
  qcs: [],
  productManagers: [],
  qcHours: 0,
  bufferHours: 0,
  carryToNextSprint: false,
  status: "TODO",
});

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const storyNames = () =>
  Object.fromEntries(usePlannerStore.getState().tasks.map((task) => [task.id, task.storyName]));

const seedLocalBoard = () => {
  usePlannerStore.setState({
    tasks: [makeTask("a", "A pulled from Jira"), makeTask("b", "B stale local"), makeTask("c", "C imported")],
    lastServerUpdatedAt: "2026-09-29T10:00:00.000Z",
    lastLocalMutationAt: "2026-09-29T10:05:00.000Z",
  });
};

const serverSnapshot = () => ({
  tasks: [makeTask("a", "A old on server"), makeTask("b", "B edited by teammate")],
  resources: [],
  config: usePlannerStore.getState().config,
  plannerMeta: usePlannerStore.getState().plannerMeta,
  timelineStartDate: null,
  updatedAt: "2026-09-29T10:03:00.000Z",
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("savePlannerAfterJiraSync", () => {
  it("saves directly when there is no conflict", async () => {
    seedLocalBoard();
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true, updatedAt: "2026-09-29T10:06:00.000Z" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(savePlannerAfterJiraSync("squad-1", ["a"])).resolves.toBe("saved");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(usePlannerStore.getState().lastServerUpdatedAt).toBe("2026-09-29T10:06:00.000Z");
    expect(usePlannerStore.getState().lastLocalMutationAt).toBeNull();
  });

  it("on conflict keeps the Jira-changed rows, takes the saved rows for the rest, and saves again", async () => {
    seedLocalBoard();
    const snapshot = serverSnapshot();
    const postBodies: Array<{ baseUpdatedAt?: string | null }> = [];
    let postCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { method?: string; body?: string }) => {
        if (init?.method === "POST") {
          postBodies.push(JSON.parse(init.body ?? "{}"));
          postCount += 1;
          return postCount === 1
            ? jsonResponse(409, { code: "STALE_WRITE" })
            : jsonResponse(200, { ok: true, updatedAt: "2026-09-29T10:07:00.000Z" });
        }
        return jsonResponse(200, snapshot);
      }),
    );

    await expect(savePlannerAfterJiraSync("squad-1", ["a", "c"])).resolves.toBe("saved");
    expect(storyNames()).toEqual({
      a: "A pulled from Jira",
      b: "B edited by teammate",
      c: "C imported",
    });
    expect(postBodies[1]?.baseUpdatedAt).toBe("2026-09-29T10:03:00.000Z");
    expect(usePlannerStore.getState().lastServerUpdatedAt).toBe("2026-09-29T10:07:00.000Z");
  });

  it("reports conflict when another save wins again after the merge", async () => {
    seedLocalBoard();
    const snapshot = serverSnapshot();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { method?: string }) =>
        init?.method === "POST" ? jsonResponse(409, { code: "STALE_WRITE" }) : jsonResponse(200, snapshot),
      ),
    );

    await expect(savePlannerAfterJiraSync("squad-1", ["a"])).resolves.toBe("conflict");
  });

  it("reports failed on a server error without merging", async () => {
    seedLocalBoard();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(500, { error: "boom" })));

    await expect(savePlannerAfterJiraSync("squad-1", ["a"])).resolves.toBe("failed");
    expect(storyNames().b).toBe("B stale local");
  });
});

describe("flushPlannerStateToServer", () => {
  it("runs overlapping saves one after another with the fresh baseUpdatedAt", async () => {
    seedLocalBoard();
    const postBodies: Array<{ baseUpdatedAt?: string | null }> = [];
    let releaseFirst: () => void = () => undefined;
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      postBodies.push(JSON.parse(init?.body ?? "{}"));
      if (postBodies.length === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return jsonResponse(200, { ok: true, updatedAt: "2026-09-29T10:06:00.000Z" });
      }
      return jsonResponse(200, { ok: true, updatedAt: "2026-09-29T10:08:00.000Z" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = flushPlannerStateToServer("squad-1");
    await Promise.resolve();
    usePlannerStore.setState({ lastLocalMutationAt: "2026-09-29T10:05:30.000Z" });
    const second = flushPlannerStateToServer("squad-1");
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    releaseFirst();
    await expect(first).resolves.toBe("saved");
    await expect(second).resolves.toBe("saved");
    expect(postBodies.map((body) => body.baseUpdatedAt)).toEqual([
      "2026-09-29T10:00:00.000Z",
      "2026-09-29T10:06:00.000Z",
    ]);
    expect(usePlannerStore.getState().lastLocalMutationAt).toBeNull();
  });

  it("keeps the unsaved flag when the planner was edited during the save", async () => {
    seedLocalBoard();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        usePlannerStore.setState({ lastLocalMutationAt: "2026-09-29T10:05:30.000Z" });
        return jsonResponse(200, { ok: true, updatedAt: "2026-09-29T10:06:00.000Z" });
      }),
    );

    await expect(flushPlannerStateToServer("squad-1")).resolves.toBe("saved");
    expect(usePlannerStore.getState().lastLocalMutationAt).toBe("2026-09-29T10:05:30.000Z");
    expect(usePlannerStore.getState().lastServerUpdatedAt).toBe("2026-09-29T10:06:00.000Z");
  });

  it("skips a waiting save when the earlier save already covered every change", async () => {
    seedLocalBoard();
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true, updatedAt: "2026-09-29T10:06:00.000Z" }));
    vi.stubGlobal("fetch", fetchMock);

    const results = await Promise.all([flushPlannerStateToServer("squad-1"), flushPlannerStateToServer("squad-1")]);

    expect(results).toEqual(["saved", "saved"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("reloadPlannerFromServer", () => {
  it("replaces unsaved local rows with the saved planner", async () => {
    seedLocalBoard();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, serverSnapshot())));

    await expect(reloadPlannerFromServer("squad-1")).resolves.toBe(true);
    expect(storyNames()).toEqual({ a: "A old on server", b: "B edited by teammate" });
    expect(usePlannerStore.getState().lastLocalMutationAt).toBeNull();
    expect(usePlannerStore.getState().lastServerUpdatedAt).toBe("2026-09-29T10:03:00.000Z");
  });
});
