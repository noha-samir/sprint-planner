import { describe, expect, it } from "vitest";
import type { Resource, Task } from "@/lib/scheduler/types";
import {
  applyBulkEditPaste,
  buildBulkEditDraftRows,
  buildBulkEditPatches,
  bulkEditColumns,
  clearBulkEditSelection,
  hasMissingAssignees,
  setBulkEditColumn,
} from "./bulkAssignees";

const resources: Resource[] = [
  { name: "Abbas", type: "BE", ownershipMode: "shared", ourSquadHours: 40, capacityHours: 40 },
  { name: "Karim", type: "BE", ownershipMode: "shared", ourSquadHours: 40, capacityHours: 40 },
  { name: "Alice", type: "FE", ownershipMode: "shared", ourSquadHours: 40, capacityHours: 40 },
  { name: "Nour", type: "MO", ownershipMode: "shared", ourSquadHours: 40, capacityHours: 40 },
  { name: "QC-One", type: "QC", ownershipMode: "shared", ourSquadHours: 40, capacityHours: 40 },
  { name: "QC-Two", type: "QC", ownershipMode: "shared", ourSquadHours: 40, capacityHours: 40 },
  { name: "PM-One", type: "PM", ownershipMode: "shared", ourSquadHours: 40, capacityHours: 40 },
];

const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  storyName: `Story ${id}`,
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
  qcs: [],
  productManagers: [],
  qcHours: 0,
  bufferHours: 0,
  status: "TODO",
  ...overrides,
});

const cell = (text: string) => ({ text, href: null });
const colOf = (field: string) => bulkEditColumns.findIndex((column) => column.field === field);
const editable = { canEditBuffer: true };

describe("buildBulkEditDraftRows", () => {
  it("joins names, shows hours (zero as empty) and flags Technical Tasks", () => {
    const [story, technical] = buildBulkEditDraftRows(
      [task("a", { beDevs: ["Abbas", "Karim"], beHours: 8, qcs: ["QC-One"], bufferHours: 1.5 }), task("b", { issueType: "Technical Task" })],
      editable,
    );

    expect(story).toMatchObject({
      taskId: "a",
      technicalTask: false,
      status: "TODO",
      bufferLocked: false,
      beDevs: "Abbas, Karim",
      beHours: "8",
      feHours: "",
      qcs: "QC-One",
      bufferHours: "1.5",
    });
    expect(technical.technicalTask).toBe(true);
  });
});

describe("buildBulkEditPatches", () => {
  it("returns no patch when nothing was edited", () => {
    const tasks = [task("a", { beDevs: ["Abbas"], beHours: 4 })];
    const originals = buildBulkEditDraftRows(tasks, editable);

    expect(buildBulkEditPatches(originals, originals, tasks, resources).patches).toEqual([]);
  });

  it("patches only edited cells and keeps off-roster names in untouched cells", () => {
    const tasks = [task("a", { beDevs: ["Abbas"], feDevs: ["Jira Only Person"] })];
    const originals = buildBulkEditDraftRows(tasks, editable);
    const drafts = [{ ...originals[0], qcs: "QC-One" }];

    const { patches, warnings } = buildBulkEditPatches(drafts, originals, tasks, resources);

    expect(patches).toEqual([{ id: "a", patch: { qcs: ["QC-One"] } }]);
    expect(warnings).toEqual([]);
  });

  it("skips unknown names in edited cells and reports them", () => {
    const tasks = [task("a")];
    const originals = buildBulkEditDraftRows(tasks, editable);
    const drafts = [{ ...originals[0], beDevs: "Abbas, Ghost" }];

    const result = buildBulkEditPatches(drafts, originals, tasks, resources);

    expect(result.patches).toEqual([{ id: "a", patch: { beDevs: ["Abbas"] } }]);
    expect(result.warnings).toEqual(['Story a: Unknown BE assignee: "Ghost"']);
    expect(result.warningCells.has("a:beDevs")).toBe(true);
  });

  it("parses edited hours, caps them at 80 and clears to 0 when emptied", () => {
    const tasks = [task("a", { qcHours: 3 })];
    const originals = buildBulkEditDraftRows(tasks, editable);
    const drafts = [{ ...originals[0], beHours: "6,5", feHours: "120", qcHours: "", bufferHours: "2" }];

    expect(buildBulkEditPatches(drafts, originals, tasks, resources).patches).toEqual([
      { id: "a", patch: { beHours: 6.5, feHours: 80, qcHours: 0, bufferHours: 2 } },
    ]);
  });

  it("skips invalid hours and reports them", () => {
    const tasks = [task("a")];
    const originals = buildBulkEditDraftRows(tasks, editable);
    const drafts = [{ ...originals[0], feHours: "1.2.3" }];

    const result = buildBulkEditPatches(drafts, originals, tasks, resources);

    expect(result.patches).toEqual([]);
    expect(result.warningCells.has("a:feHours")).toBe(true);
  });

  it("ignores BE people/hours edits on Technical Tasks but keeps Dev hours in FE h", () => {
    const tasks = [task("t", { issueType: "Technical Task" })];
    const originals = buildBulkEditDraftRows(tasks, editable);
    const drafts = [{ ...originals[0], beDevs: "Abbas", beHours: "5", feHours: "6", qcs: "QC-One" }];

    expect(buildBulkEditPatches(drafts, originals, tasks, resources).patches).toEqual([
      { id: "t", patch: { feHours: 6, qcs: ["QC-One"] } },
    ]);
  });

  it("ignores buffer edits when the user may not change buffer hours", () => {
    const tasks = [task("a")];
    const originals = buildBulkEditDraftRows(tasks, { canEditBuffer: false });
    const drafts = [{ ...originals[0], bufferHours: "4" }];

    expect(buildBulkEditPatches(drafts, originals, tasks, resources).patches).toEqual([]);
  });

  it("turns Needs iOS on when iOS names or hours are added", () => {
    const tasks = [task("a"), task("b")];
    const originals = buildBulkEditDraftRows(tasks, editable);
    const drafts = [
      { ...originals[0], iosDevs: "Nour" },
      { ...originals[1], iosHours: "3" },
    ];

    expect(buildBulkEditPatches(drafts, originals, tasks, resources).patches).toEqual([
      { id: "a", patch: { iosDevs: ["Nour"], needsIos: true } },
      { id: "b", patch: { iosHours: 3, needsIos: true } },
    ]);
  });

  it("patches an edited status using the canonical planner name", () => {
    const tasks = [task("a", { status: "To Do" }), task("b", { status: "To Do" })];
    const originals = buildBulkEditDraftRows(tasks, editable);
    const drafts = [
      { ...originals[0], status: "in progress" },
      { ...originals[1], status: "To Do " },
    ];

    expect(buildBulkEditPatches(drafts, originals, tasks, resources).patches).toEqual([
      { id: "a", patch: { status: "In Progress" } },
    ]);
  });

  it("skips unknown statuses and reports them", () => {
    const tasks = [task("a", { status: "To Do" })];
    const originals = buildBulkEditDraftRows(tasks, editable);
    const drafts = [{ ...originals[0], status: "Almost done", qcs: "QC-One" }];

    const result = buildBulkEditPatches(drafts, originals, tasks, resources);

    expect(result.patches).toEqual([{ id: "a", patch: { qcs: ["QC-One"] } }]);
    expect(result.warnings).toEqual(['Story a: Unknown status "Almost done"']);
    expect(result.warningCells.has("a:status")).toBe(true);
  });

  it("keeps a Jira-only status when the cell is not edited", () => {
    const tasks = [task("a", { status: "Ready for Development" })];
    const originals = buildBulkEditDraftRows(tasks, editable);
    const drafts = [{ ...originals[0], beDevs: "Abbas" }];

    const result = buildBulkEditPatches(drafts, originals, tasks, resources);

    expect(result.patches).toEqual([{ id: "a", patch: { beDevs: ["Abbas"] } }]);
    expect(result.warnings).toEqual([]);
  });

  it("skips rows whose story no longer exists", () => {
    const tasks = [task("a")];
    const originals = buildBulkEditDraftRows(tasks, editable);
    const drafts = [{ ...originals[0], qcs: "QC-One" }];

    expect(buildBulkEditPatches(drafts, originals, [], resources).patches).toEqual([]);
  });
});

describe("grid editing", () => {
  const rows = buildBulkEditDraftRows([task("a"), task("b"), task("c", { issueType: "Technical Task" })], editable);

  it("fills every selected cell with one pasted value", () => {
    const qc = colOf("qcs");
    const next = applyBulkEditPaste(rows, [[cell("QC-One")]], { rowIndex: 0, colIndex: qc }, {
      startRow: 0,
      startCol: qc,
      endRow: 2,
      endCol: qc,
    });

    expect(next.map((row) => row.qcs)).toEqual(["QC-One", "QC-One", "QC-One"]);
  });

  it("pastes a people/hours table from the anchor, clipped to the grid and skipping locked cells", () => {
    const next = applyBulkEditPaste(
      rows,
      [
        [cell("Abbas"), cell("8")],
        [cell("Karim"), cell("5")],
        [cell("Abbas"), cell("3")],
      ],
      { rowIndex: 1, colIndex: colOf("beDevs") },
      null,
    );

    expect(next).toHaveLength(3);
    expect(next[0]).toEqual(rows[0]);
    expect(next[1]).toMatchObject({ beDevs: "Abbas", beHours: "8" });
    expect(next[2]).toMatchObject({ beDevs: "", beHours: "" });
  });

  it("clears a selected range", () => {
    const filled = setBulkEditColumn(rows, "qcHours", "2");
    const cleared = clearBulkEditSelection(filled, {
      startRow: 1,
      startCol: colOf("qcHours"),
      endRow: 0,
      endCol: colOf("qcHours"),
    });

    expect(cleared.map((row) => row.qcHours)).toEqual(["", "", "2"]);
  });

  it("fills status by paste and Set all, but never clears it", () => {
    const status = colOf("status");
    const pasted = applyBulkEditPaste(rows, [[cell("Blocked")]], { rowIndex: 0, colIndex: status }, {
      startRow: 0,
      startCol: status,
      endRow: 1,
      endCol: status,
    });
    expect(pasted.map((row) => row.status)).toEqual(["Blocked", "Blocked", "TODO"]);

    const cleared = clearBulkEditSelection(pasted, { startRow: 0, startCol: status, endRow: 2, endCol: colOf("beDevs") });
    expect(cleared.map((row) => row.status)).toEqual(["Blocked", "Blocked", "TODO"]);

    expect(setBulkEditColumn(rows, "status", "").map((row) => row.status)).toEqual(["TODO", "TODO", "TODO"]);
    expect(setBulkEditColumn(rows, "status", "Testing").map((row) => row.status)).toEqual([
      "Testing",
      "Testing",
      "Testing",
    ]);
  });

  it("sets a whole column or only a row range", () => {
    expect(setBulkEditColumn(rows, "productManagers", "PM-One").map((row) => row.productManagers)).toEqual([
      "PM-One",
      "PM-One",
      "PM-One",
    ]);
    expect(
      setBulkEditColumn(rows, "bufferHours", "1", { startRow: 2, endRow: 1 }).map((row) => row.bufferHours),
    ).toEqual(["", "1", "1"]);
  });
});

describe("hasMissingAssignees", () => {
  it("flags stories without a developer or QC", () => {
    expect(hasMissingAssignees(task("a"))).toBe(true);
    expect(hasMissingAssignees(task("a", { feDevs: ["Alice"] }))).toBe(true);
    expect(hasMissingAssignees(task("a", { beDevs: ["Abbas"], qcs: ["QC-One"] }))).toBe(false);
  });

  it("never flags standalone items", () => {
    expect(hasMissingAssignees(task("b", { issueType: "Bug" }))).toBe(false);
    expect(hasMissingAssignees(task("t", { issueType: "Technical Task" }))).toBe(false);
  });
});
