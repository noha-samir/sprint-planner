import { describe, expect, it } from "vitest";
import type { Task } from "@/lib/scheduler/types";
import {
  appendTaskIdsToDashboardOrder,
  buildDashboardTaskOrder,
  sortTasksByFrozenOrder,
  sortTasksForDashboard,
} from "./dashboardTaskOrder";
import { buildReleaseGroupColorMap, releaseGroupInputStyle } from "./releaseGroupColors";

const task = (
  id: string,
  poPriority: number | null,
  releaseGroup: string | null = null,
  status: Task["status"] = "TODO",
): Task => ({
  id,
  storyName: id,
  storyLink: "",
  poPriority,
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
  qcs: [],
  productManagers: [],
  qcHours: 0,
  bufferHours: 0,
  status,
  releaseGroup,
});

describe("dashboardTaskOrder", () => {
  it("sorts the working flow from the latest status back to Blocked", () => {
    const tasks = [
      task("todo", 1, null, "To Do"),
      task("blocked", 1, null, "Blocked"),
      task("review", 1, null, "Ready for Review"),
      task("testing", 1, null, "Testing"),
      task("ready-test", 1, null, "Ready for Testing"),
      task("progress", 1, null, "In Progress"),
      task("staging", 1, null, "STAGING"),
      task("uat", 1, null, "UAT"),
      task("rfp", 1, null, "Ready for Production"),
    ];
    const ordered = sortTasksForDashboard(tasks, new Map(), "default");
    expect(ordered.map((row) => row.id)).toEqual([
      "rfp",
      "uat",
      "staging",
      "testing",
      "ready-test",
      "review",
      "progress",
      "todo",
      "blocked",
    ]);
  });

  it("uses Order then release date inside the same status, and skips dates for Blocked", () => {
    const tasks = [
      task("same-order-later", 1, null, "In Progress"),
      task("same-order-sooner", 1, null, "In Progress"),
      task("higher-order", 2, null, "In Progress"),
      task("blocked-late", 2, null, "Blocked"),
      task("blocked-early", 1, null, "Blocked"),
    ];
    const dates = new Map<string, Date>([
      ["same-order-later", new Date("2026-07-01T12:00:00.000Z")],
      ["same-order-sooner", new Date("2026-06-01T12:00:00.000Z")],
      ["higher-order", new Date("2026-01-01T12:00:00.000Z")],
      ["blocked-late", new Date("2026-01-01T12:00:00.000Z")],
      ["blocked-early", new Date("2026-12-01T12:00:00.000Z")],
    ]);
    expect(sortTasksForDashboard(tasks, dates, "default").map((row) => row.id)).toEqual([
      "same-order-sooner",
      "same-order-later",
      "higher-order",
      "blocked-early",
      "blocked-late",
    ]);
  });

  it("sorts by release date, Order, or status when that mode is selected", () => {
    const tasks = [
      task("soon", 3, null, "To Do"),
      task("later", 1, null, "In Progress"),
      task("blocked", 2, null, "Blocked"),
    ];
    const dates = new Map<string, Date>([
      ["soon", new Date("2026-06-01T12:00:00.000Z")],
      ["later", new Date("2026-08-01T12:00:00.000Z")],
    ]);
    expect(sortTasksForDashboard(tasks, dates, "release").map((row) => row.id)).toEqual([
      "soon",
      "later",
      "blocked",
    ]);
    expect(sortTasksForDashboard(tasks, dates, "order").map((row) => row.id)).toEqual([
      "later",
      "blocked",
      "soon",
    ]);
    expect(sortTasksForDashboard(tasks, dates, "status").map((row) => row.id)).toEqual([
      "later",
      "soon",
      "blocked",
    ]);
  });

  it("appends bulk-added task ids to the end of dashboard order", () => {
    expect(appendTaskIdsToDashboardOrder(["a", "b"], ["a", "b", "c", "d"], ["c", "d"])).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(appendTaskIdsToDashboardOrder([], ["a", "b", "c"], ["c"])).toEqual(["a", "b", "c"]);
    expect(appendTaskIdsToDashboardOrder(["b", "a"], ["a", "b", "c"], ["c"])).toEqual(["b", "a", "c"]);
  });

  it("orders saved dashboard ids by status, then Order, then release date", () => {
    const tasks = [
      task("a", 3, "Beta"),
      task("b", 1, "Alpha"),
      task("c", 2, "Beta"),
      task("d", 4, null),
    ];
    const order = buildDashboardTaskOrder(tasks, {
      sprintEndDate: new Date("2026-06-30T12:00:00.000Z"),
      tasks: tasks.map((row) => ({
        id: row.id,
        storyName: row.storyName,
        storyLink: "",
        poPriority: row.poPriority,
        status: "TODO",
        feBlocks: [],
        beBlocks: [],
          androidBlocks: [],
          iosBlocks: [],
          androidStart: null,
          androidEnd: null,
          iosStart: null,
          iosEnd: null,
        feStart: null,
        feEnd: null,
        beStart: null,
        beEnd: null,
        devEnd: null,
        integrationStart: null,
        integrationEnd: null,
        qcBlocks: [],
        qcStart: null,
        qcEnd: null,
        bufferStart: null,
        bufferEnd: null,
        uatReleaseDate: null,
        productionReleaseDate: null,
        releaseDate: new Date("2026-06-12T12:00:00.000Z"),
        isThursdayRelease: false,
        thursdayReleaseScope: "none",
        isOverflow: false,
        releaseGroup: row.releaseGroup ?? null,
      })),
    });
    expect(order).toEqual(["b", "c", "a", "d"]);
  });

  it("keeps a release group together inside one status and leaves it split across statuses", () => {
    const tasks = [
      task("login", 2, null, "In Progress"),
      task("cart", 1, "Checkout", "In Progress"),
      task("tax", 3, "Checkout", "In Progress"),
      task("pay", 2, "Checkout", "Ready for Production"),
    ];
    expect(sortTasksForDashboard(tasks, new Map(), "default").map((row) => row.id)).toEqual([
      "pay",
      "cart",
      "tax",
      "login",
    ]);
  });

  it("sorts by Order within the same status before release date", () => {
    const tasks = [
      task("uat-late", 4, "Zeta", "UAT"),
      task("uat-early", 1, "Alpha", "UAT"),
      task("todo-early", 1, null, "To Do"),
      task("todo-late", 9, null, "To Do"),
    ];
    const ordered = sortTasksForDashboard(tasks, new Map(), "default");
    expect(ordered.map((row) => row.id)).toEqual(["uat-early", "uat-late", "todo-early", "todo-late"]);
  });

  it("keeps a captured order when a story's status would otherwise move it", () => {
    const rows = [
      task("a", 1, null, "In Progress"),
      task("b", 2, null, "UAT"),
      task("c", 3, null, "To Do"),
    ];
    expect(sortTasksByFrozenOrder(rows, ["c", "a", "b"]).map((row) => row.id)).toEqual(["c", "a", "b"]);
    expect(sortTasksByFrozenOrder(rows, ["a"]).map((row) => row.id)).toEqual(["a", "b", "c"]);
  });
});

describe("releaseGroupColors", () => {
  it("assigns a unique nude color per release group", () => {
    const map = buildReleaseGroupColorMap(["Wave 1", "Wave 2", "Wave 1", null, ""]);
    expect(map.size).toBe(2);
    expect(map.get("Wave 1")).not.toEqual(map.get("Wave 2"));
    expect(map.get("Wave 1")?.backgroundColor).toMatch(/^#|hsl/);
  });

  it("keeps group identity in variables so a filled name does not force a light fill", () => {
    const map = buildReleaseGroupColorMap(["MMT", "Inventory"]);
    const mmt = releaseGroupInputStyle("MMT", map);
    const inventory = releaseGroupInputStyle("Inventory", map);
    expect(mmt).toMatchObject({
      "--release-group-bg": map.get("MMT")?.backgroundColor,
      "--release-group-ink": map.get("MMT")?.color,
    });
    expect(mmt).not.toHaveProperty("backgroundColor");
    expect(inventory?.["--release-group-ink"]).not.toBe(mmt?.["--release-group-ink"]);
  });
});
