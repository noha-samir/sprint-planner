import { describe, expect, it } from "vitest";
import { detectChangedTasks, REMOTE_CHANGE_GRACE_MS, type RemoteChangeBaseline } from "./remoteChanges";

const pulledAt = "2026-09-29T10:00:00.000Z";
const later = (ms: number) => new Date(Date.parse(pulledAt) + ms).toISOString();

const baseline = (overrides: Partial<RemoteChangeBaseline> = {}): RemoteChangeBaseline => ({
  taskId: "t1",
  storyLink: "https://x.atlassian.net/browse/BR-1",
  lastPulledAt: pulledAt,
  lastPushedAt: null,
  ...overrides,
});

describe("detectChangedTasks", () => {
  it("flags a parent updated after the last pull", () => {
    const changed = detectChangedTasks([baseline()], [
      { key: "BR-1", fields: { updated: later(REMOTE_CHANGE_GRACE_MS + 5_000) } },
    ]);
    expect(changed).toEqual([
      expect.objectContaining({ taskId: "t1", keys: ["BR-1"], neverPulled: false }),
    ]);
  });

  it("ignores updates inside the grace window (our own push/pull)", () => {
    expect(
      detectChangedTasks([baseline()], [{ key: "BR-1", fields: { updated: later(30_000) } }]),
    ).toEqual([]);
  });

  it("uses the later of lastPulledAt and lastPushedAt", () => {
    const pushedAt = later(10 * 60_000);
    expect(
      detectChangedTasks([baseline({ lastPushedAt: pushedAt })], [
        { key: "BR-1", fields: { updated: later(5 * 60_000) } },
      ]),
    ).toEqual([]);
  });

  it("attributes a new or changed subtask to its parent story", () => {
    const changed = detectChangedTasks([baseline()], [
      { key: "BR-1", fields: { updated: pulledAt } },
      { key: "BR-99", fields: { parent: { key: "BR-1" }, updated: later(5 * 60_000) } },
    ]);
    expect(changed[0]?.keys).toEqual(["BR-99"]);
  });

  it("reports never-pulled stories without needing Jira results", () => {
    expect(detectChangedTasks([baseline({ lastPulledAt: null })], [])).toEqual([
      { taskId: "t1", keys: [], latestUpdatedAt: null, neverPulled: true },
    ]);
  });

  it("matches keys across stories", () => {
    const changed = detectChangedTasks(
      [baseline(), baseline({ taskId: "t2", storyLink: "BR-2" })],
      [
        { key: "BR-2", fields: { updated: later(5 * 60_000) } },
        { key: "BR-1", fields: { updated: pulledAt } },
      ],
    );
    expect(changed.map((row) => row.taskId)).toEqual(["t2"]);
  });
});
