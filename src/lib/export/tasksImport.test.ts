import { describe, expect, it } from "vitest";
import {
  parseCsvLine,
  parseTasksImportCsv,
  parseTasksImportRow,
  TASKS_IMPORT_HEADERS,
} from "./tasksImport";
import type { Resource } from "@/lib/scheduler/types";

const resources: Resource[] = [
  { name: "Abbas", type: "BE" },
  { name: "Karim", type: "FE" },
  { name: "Nour", type: "MO" },
  { name: "Hala", type: "QC" },
];

const empty = { text: "", href: null };

describe("parseCsvLine", () => {
  it("splits simple commas", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("keeps commas inside quotes", () => {
    expect(parseCsvLine('"Story, one",Abbas,8,Karim,4,Hala,2,,')).toEqual([
      "Story, one",
      "Abbas",
      "8",
      "Karim",
      "4",
      "Hala",
      "2",
      "",
      "",
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsvLine('"Say ""hi""",,,,,,,,')).toEqual(["Say \"hi\"", "", "", "", "", "", "", "", ""]);
  });
});

describe("parseTasksImportRow", () => {
  it("reads task hyperlink, assignees, and hours from the new column layout", () => {
    const row = parseTasksImportRow(
      [
        { text: "Billing", href: "https://jira.example/BILL-1" },
        empty,
        empty,
        { text: "Abbas", href: null },
        { text: "8", href: null },
        empty,
        { text: "Karim", href: null },
        { text: "4", href: null },
        empty,
        { text: "Nour", href: null },
        { text: "6", href: null },
        empty,
        empty,
        empty,
        { text: "2026-08-10", href: null },
        { text: "Hala", href: null },
        { text: "2", href: null },
        empty,
        empty,
        empty,
      ],
      resources,
    );

    expect(row).toMatchObject({
      storyName: "Billing",
      storyLink: "https://jira.example/BILL-1",
      beDevs: ["Abbas"],
      beHours: 8,
      feDevs: ["Karim"],
      feHours: 4,
      androidDevs: ["Nour"],
      androidHours: 6,
      moStartDate: "2026-08-10",
      qcs: ["Hala"],
      qcHours: 2,
      isValid: true,
    });
  });

  it("warns on unknown assignees", () => {
    const row = parseTasksImportRow(
      [
        { text: "Story", href: "https://x" },
        empty,
        empty,
        { text: "Nobody", href: null },
        { text: "1", href: null },
        empty,
        { text: "Karim", href: null },
        empty,
        empty,
        empty,
        empty,
        empty,
        empty,
        empty,
        empty,
        empty,
        empty,
      ],
      resources,
    );
    expect(row?.beDevs).toEqual([]);
    expect(row?.warnings.some((warning) => warning.includes("Nobody"))).toBe(true);
  });
});

describe("parseTasksImportCsv", () => {
  it("skips the template header and parses rows", () => {
    const csv = [
      TASKS_IMPORT_HEADERS.join(","),
      "Billing,,Todo,Abbas,8,,Karim,4,,Nour,6,,,,2026-08-10,Hala,2,,,",
      "Orphan,,,,,,,,,,,,,,,,,,,",
    ].join("\n");

    const result = parseTasksImportCsv(csv, resources);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      storyName: "Billing",
      beDevs: ["Abbas"],
      beHours: 8,
      feDevs: ["Karim"],
      feHours: 4,
      androidDevs: ["Nour"],
      androidHours: 6,
      moStartDate: "2026-08-10",
      qcs: ["Hala"],
      qcHours: 2,
      isValid: true,
    });
    expect(result.rows[1].storyName).toBe("Orphan");
  });

  it("accepts the Estmation typo in headers and maps legacy MO columns to Android", () => {
    const tsv = [
      "Task\tP0\tStatus\tBE Dev\tBE Estmation hours\tBE Release to staging\tFE Dev\tFE Estmation hours\tFE Release to staging\tMO Dev\tMO Hours\tMO Start Date\tQC\tQC Estmation hours\tQC Release to UAT\tRelease to Production\tNotes",
      "Payments\t1\tIn Progress\tAbbas\t10\t2026-07-01\tKarim\t6\t2026-07-02\tNour\t5\t2026-07-05\tHala\t3\t2026-07-03\t2026-07-10\tignore me",
    ].join("\n");

    const result = parseTasksImportCsv(tsv, resources);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      storyName: "Payments",
      beDevs: ["Abbas"],
      beHours: 10,
      feDevs: ["Karim"],
      feHours: 6,
      androidDevs: ["Nour"],
      androidHours: 5,
      moStartDate: "2026-07-05",
      qcs: ["Hala"],
      qcHours: 3,
      isValid: true,
    });
  });
});
