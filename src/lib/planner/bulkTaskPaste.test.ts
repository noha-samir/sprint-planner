import { describe, expect, it } from "vitest";
import {
  applyClipboardPasteToDrafts,
  clearBulkGridSelection,
  createEmptyBulkDraftRows,
  decodeClipboardHtml,
  parseBulkTaskPaste,
  parseBulkTaskPasteFromTable,
  parseClipboardTable,
  resolveBulkTaskRow,
} from "./bulkTaskPaste";
import type { Resource } from "@/lib/scheduler/types";

const resources: Resource[] = [
  { name: "Abbas", type: "BE", ownershipMode: "shared", ourSquadHours: 40, capacityHours: 40 },
  { name: "Karim", type: "BE", ownershipMode: "shared", ourSquadHours: 40, capacityHours: 40 },
  { name: "Alice", type: "FE", ownershipMode: "shared", ourSquadHours: 40, capacityHours: 40 },
  { name: "Bob", type: "FE", ownershipMode: "shared", ourSquadHours: 40, capacityHours: 40 },
  { name: "Nour", type: "MO", ownershipMode: "shared", ourSquadHours: 40, capacityHours: 40 },
  { name: "QC-One", type: "QC", ownershipMode: "shared", ourSquadHours: 40, capacityHours: 40 },
  { name: "PM-One", type: "PM", ownershipMode: "shared", ourSquadHours: 40, capacityHours: 40 },
];

describe("parseBulkTaskPaste", () => {
  it("parses a single story name column", () => {
    const result = parseBulkTaskPaste("Order Creation\nPayments", resources);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      storyName: "Order Creation",
      storyLink: "",
      beDevs: [],
      feDevs: [],
      qcs: [],
  productManagers: [],
      isValid: true,
    });
  });

  it("parses story name and link columns", () => {
    const result = parseBulkTaskPaste("Order Creation\thttps://jira/1", resources);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      storyName: "Order Creation",
      storyLink: "https://jira/1",
    });
  });

  it("parses five-column Excel rows with assignees", () => {
    const text = [
      "Order Creation\thttps://jira/1\tAbbas, Karim\tAlice\tQC-One",
      "Payments\thttps://jira/2\tKarim\tBob; Alice\tQC-One",
    ].join("\n");

    const result = parseBulkTaskPaste(text, resources);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      storyName: "Order Creation",
      storyLink: "https://jira/1",
      beDevs: ["Abbas", "Karim"],
      feDevs: ["Alice"],
      qcs: ["QC-One"],
    });
    expect(result.rows[1]).toMatchObject({
      storyName: "Payments",
      feDevs: ["Bob", "Alice"],
    });
  });

  it("skips header row when first cell looks like a header", () => {
    const text = "Story Name\tStory Link\tBE Devs\tFE Devs\tQC\nOrder\tlink\tAbbas\tAlice\tQC-One";
    const result = parseBulkTaskPaste(text, resources);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].storyName).toBe("Order");
  });

  it("warns on unknown assignees but keeps the row valid", () => {
    const text = "Story\tlink\tUnknownBE\tAlice\tQC-One";
    const result = parseBulkTaskPaste(text, resources);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].beDevs).toEqual([]);
    expect(result.rows[0].warnings).toContain('Unknown BE assignee: "UnknownBE"');
  });

  it("skips empty rows and counts them", () => {
    const text = "Story A\n\t\nStory B";
    const result = parseBulkTaskPaste(text, resources);
    expect(result.rows).toHaveLength(2);
    expect(result.skippedEmpty).toBe(1);
  });

  it("returns empty result for blank clipboard text", () => {
    expect(parseBulkTaskPaste("   \n  ", resources)).toEqual({ rows: [], skippedEmpty: 0 });
  });

  it("parses eight-column Excel rows with name then estimation hours per role", () => {
    const text = [
      "Order Creation\thttps://jira/1\tAbbas, Karim\t8\tAlice\t4\tQC-One\t2",
      "Payments\thttps://jira/2\tKarim\t10\tBob; Alice\t6\tQC-One\t3",
    ].join("\n");

    const result = parseBulkTaskPaste(text, resources);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      storyName: "Order Creation",
      beDevs: ["Abbas", "Karim"],
      feDevs: ["Alice"],
      androidDevs: [],
      androidHours: 0,
      iosDevs: [],
      iosHours: 0,
      needsIos: false,
      qcs: ["QC-One"],
      beHours: 8,
      feHours: 4,
      qcHours: 2,
    });
    expect(result.rows[1]).toMatchObject({
      storyName: "Payments",
      beHours: 10,
      androidDevs: [],
      androidHours: 0,
      iosDevs: [],
      iosHours: 0,
      needsIos: false,
      feHours: 6,
      qcHours: 3,
    });
  });

  it("parses ten-column rows with MO assignees and hours mapped to Android", () => {
    const text = "Order\thttps://jira/1\tAbbas\t8\tAlice\t4\tNour\t6\tQC-One\t2";
    const result = parseBulkTaskPaste(text, resources);
    expect(result.rows[0]).toMatchObject({
      beDevs: ["Abbas"],
      feDevs: ["Alice"],
      androidDevs: ["Nour"],
      beHours: 8,
      feHours: 4,
      androidHours: 6,
      iosDevs: [],
      iosHours: 0,
      needsIos: false,
      qcHours: 2,
    });
  });

  it("parses eleven-column rows and ignores legacy MO start (defaults to squad start)", () => {
    const text = "Order\thttps://jira/1\tAbbas\t8\tAlice\t4\tNour\t6\t2026-08-12\tQC-One\t2";
    const result = parseBulkTaskPaste(text, resources);
    expect(result.rows[0]).toMatchObject({
      androidDevs: ["Nour"],
      androidHours: 6,
      moStartDate: null,
      qcs: ["QC-One"],
      qcHours: 2,
    });
  });

  it("infers Needs iOS from IOS assignee or hours without a flag column", () => {
    const text = "Order\thttps://jira/1\tAbbas\t8\tAlice\t4\tNour\t6\tstar\tNour\t5\tQC-One\t2";
    const result = parseBulkTaskPaste(text, resources);
    expect(result.rows[0]).toMatchObject({
      androidDevs: ["Nour"],
      androidHours: 6,
      mobileApp: "star",
      iosDevs: ["Nour"],
      iosHours: 5,
      needsIos: true,
      moStartDate: null,
      qcs: ["QC-One"],
      qcHours: 2,
    });
  });

  it("resolves editable draft rows with assignee warnings", () => {
    const resolved = resolveBulkTaskRow(
      {
        storyName: "Story",
        storyLink: "link",
        beDevsRaw: "UnknownBE",
        feDevsRaw: "Alice",
        androidDevsRaw: "Nour",
        iosDevsRaw: "",
        qcsRaw: "QC-One",
        productManagersRaw: "",
        beHoursRaw: "8",
        feHoursRaw: "4",
        androidHoursRaw: "6",
        iosHoursRaw: "",
        mobileAppRaw: "",
        qcHoursRaw: "2",
      },
      resources,
    );
    expect(resolved.isValid).toBe(true);
    expect(resolved.beDevs).toEqual([]);
    expect(resolved.feDevs).toEqual(["Alice"]);
    expect(resolved.androidDevs).toEqual(["Nour"]);
    expect(resolved.beHours).toBe(8);
    expect(resolved.feHours).toBe(4);
    expect(resolved.androidHours).toBe(6);
    expect(resolved.needsIos).toBe(false);
    expect(resolved.moStartDate).toBeNull();
    expect(resolved.qcHours).toBe(2);
    expect(resolved.warnings).toContain('Unknown BE assignee: "UnknownBE"');
  });

  it("keeps hyperlinks from clipboard table cells", () => {
    const result = parseBulkTaskPasteFromTable(
      [[{ text: "Order Creation", href: "https://jira/FOO-1" }]],
      resources,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      storyName: "Order Creation",
      storyLink: "https://jira/FOO-1",
    });
  });

  it("pastes a single assignee into only the focused cell when nothing is selected", () => {
    const current = createEmptyBulkDraftRows(3);
    current[0].storyName = "Story A";
    current[1].storyName = "Story B";

    const next = applyClipboardPasteToDrafts(current, [[{ text: "Abbas", href: null }]], {
      rowIndex: 1,
      colIndex: 2,
    });

    expect(next[0].beDevsRaw).toBe("");
    expect(next[1].beDevsRaw).toBe("Abbas");
    expect(next[2].beDevsRaw).toBe("");
  });

  it("fills only the selected cells when multiple cells are selected", () => {
    const current = createEmptyBulkDraftRows(4);

    const next = applyClipboardPasteToDrafts(
      current,
      [[{ text: "Abbas", href: null }]],
      { rowIndex: 1, colIndex: 2 },
      { startRow: 1, startCol: 2, endRow: 3, endCol: 2 },
    );

    expect(next[0].beDevsRaw).toBe("");
    expect(next[1].beDevsRaw).toBe("Abbas");
    expect(next[2].beDevsRaw).toBe("Abbas");
    expect(next[3].beDevsRaw).toBe("Abbas");
  });

  it("maps a pasted column list into a selected column range", () => {
    const current = createEmptyBulkDraftRows(3);
    const table = [[{ text: "Abbas", href: null }], [{ text: "Karim", href: null }]];

    const next = applyClipboardPasteToDrafts(
      current,
      table,
      { rowIndex: 1, colIndex: 2 },
      { startRow: 1, startCol: 2, endRow: 2, endCol: 2 },
    );

    expect(next[0].beDevsRaw).toBe("");
    expect(next[1].beDevsRaw).toBe("Abbas");
    expect(next[2].beDevsRaw).toBe("Karim");
  });

  it("fills values down from the focused cell when pasting a column list without a selection", () => {
    const current = createEmptyBulkDraftRows(2);
    const table = [[{ text: "Abbas", href: null }], [{ text: "Karim", href: null }]];

    const next = applyClipboardPasteToDrafts(current, table, { rowIndex: 0, colIndex: 2 });

    expect(next[0].beDevsRaw).toBe("Abbas");
    expect(next[1].beDevsRaw).toBe("Karim");
  });

  it("maps hyperlinked story cells into story name and link fields", () => {
    const current = createEmptyBulkDraftRows(1);
    const next = applyClipboardPasteToDrafts(
      current,
      [[{ text: "Order Creation", href: "https://jira/FOO-1" }]],
      { rowIndex: 0, colIndex: 0 },
    );

    expect(next[0].storyName).toBe("Order Creation");
    expect(next[0].storyLink).toBe("https://jira/FOO-1");
  });

  it("parses Slack multi-line titles with html anchors into story and link columns", () => {
    const plain = [
      "Pricing Engine – KM-Based for Box Trips",
      "Box Trips – Landing Page",
      "Counter Hub – Customer Orders Filter on Orders Page",
    ].join("\n");
    const html = [
      '<a data-stringify-link="https://jira/PRICING" href="https://slack-redir.net/link?url=https%3A%2F%2Fjira%2FPRICING">Pricing Engine – KM-Based for Box Trips</a><br>',
      '<a data-stringify-link="https://jira/LANDING" href="https://slack-redir.net/link?url=https%3A%2F%2Fjira%2FLANDING">Box Trips – Landing Page</a><br>',
      '<a data-stringify-link="https://jira/FILTER" href="https://slack-redir.net/link?url=https%3A%2F%2Fjira%2FFILTER">Counter Hub – Customer Orders Filter on Orders Page</a>',
    ].join("");

    const table = parseClipboardTable(html, plain);
    const next = applyClipboardPasteToDrafts(createEmptyBulkDraftRows(3), table, {
      rowIndex: 0,
      colIndex: 0,
    });

    expect(next[0]).toMatchObject({
      storyName: "Pricing Engine – KM-Based for Box Trips",
      storyLink: "https://jira/PRICING",
    });
    expect(next[2]).toMatchObject({
      storyName: "Counter Hub – Customer Orders Filter on Orders Page",
      storyLink: "https://jira/FILTER",
    });
  });

  it("parses Slack mrkdwn links from plain text into story and link columns", () => {
    const plain = "<https://jira/FOO-1|Order Creation>\n<https://jira/FOO-2|Payments>";

    const table = parseClipboardTable("", plain);
    const next = applyClipboardPasteToDrafts(createEmptyBulkDraftRows(2), table, {
      rowIndex: 0,
      colIndex: 0,
    });

    expect(next[0]).toMatchObject({
      storyName: "Order Creation",
      storyLink: "https://jira/FOO-1",
    });
    expect(next[1]).toMatchObject({
      storyName: "Payments",
      storyLink: "https://jira/FOO-2",
    });
  });

  it("parses markdown links from plain text into story and link columns", () => {
    const plain = "[Counter Hub](https://jira/FOO-3)";

    const table = parseClipboardTable("", plain);
    const next = applyClipboardPasteToDrafts(createEmptyBulkDraftRows(1), table, {
      rowIndex: 0,
      colIndex: 0,
    });

    expect(next[0]).toMatchObject({
      storyName: "Counter Hub",
      storyLink: "https://jira/FOO-3",
    });
  });

  it("parses Excel quoted-printable hyperlink html into story and link columns", () => {
    const html = `<!--StartFragment--><table><tr><td><a href=3D"https://jira/FOO-1">Order Creation</a></td></tr></table><!--EndFragment-->`;
    const plain = "Order Creation";

    const table = parseClipboardTable(html, plain);
    const next = applyClipboardPasteToDrafts(createEmptyBulkDraftRows(1), table, {
      rowIndex: 0,
      colIndex: 0,
    });

    expect(next[0]).toMatchObject({
      storyName: "Order Creation",
      storyLink: "https://jira/FOO-1",
    });
  });

  it("decodes excel quoted-printable href attributes", () => {
    expect(decodeClipboardHtml('href=3D"https://jira/FOO-1"')).toContain('href="https://jira/FOO-1"');
  });

  it("parses Excel html anchors into story and link columns from plain text rows", () => {
    const html = `<table><tr><td><a href="https://jira/FOO-1">Order Creation</a></td></tr><tr><td><a href="https://jira/FOO-2">Payments</a></td></tr></table>`;
    const plain = "Order Creation\nPayments";

    const table = parseClipboardTable(html, plain);
    const next = applyClipboardPasteToDrafts(createEmptyBulkDraftRows(2), table, {
      rowIndex: 0,
      colIndex: 0,
    });

    expect(next[0]).toMatchObject({
      storyName: "Order Creation",
      storyLink: "https://jira/FOO-1",
    });
    expect(next[1]).toMatchObject({
      storyName: "Payments",
      storyLink: "https://jira/FOO-2",
    });
  });

  it("parses Google Sheets hyperlink metadata into the link column", () => {
    const html = `<table><tr><td data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;https://jira/FOO-3&quot;,&quot;3&quot;:1}">Counter Hub</td></tr></table>`;
    const plain = "Counter Hub";

    const table = parseClipboardTable(html, plain);
    const next = applyClipboardPasteToDrafts(createEmptyBulkDraftRows(1), table, {
      rowIndex: 0,
      colIndex: 0,
    });

    expect(next[0]).toMatchObject({
      storyName: "Counter Hub",
      storyLink: "https://jira/FOO-3",
    });
  });

  it("does not grow the grid when pasting a single link into an empty link cell", () => {
    const current = createEmptyBulkDraftRows(5);

    const next = applyClipboardPasteToDrafts(
      current,
      [[{ text: "https://jira/FOO-1", href: "https://jira/FOO-1" }]],
      { rowIndex: 0, colIndex: 1 },
    );

    expect(next).toHaveLength(5);
    expect(next[0].storyLink).toBe("https://jira/FOO-1");
  });

  it("parses Slack span data-stringify-link html into story and link columns", () => {
    const plain = ["Pricing Engine – KM-Based for Box Trips", "Box Trips – Landing Page"].join("\n");
    const html = [
      '<span data-stringify-link="https://jira/PRICING">Pricing Engine – KM-Based for Box Trips</span><br>',
      '<span data-stringify-link="https://jira/LANDING">Box Trips – Landing Page</span>',
    ].join("");

    const table = parseClipboardTable(html, plain);
    const next = applyClipboardPasteToDrafts(createEmptyBulkDraftRows(2), table, {
      rowIndex: 0,
      colIndex: 0,
    });

    expect(next[0]).toMatchObject({
      storyName: "Pricing Engine – KM-Based for Box Trips",
      storyLink: "https://jira/PRICING",
    });
    expect(next[1]).toMatchObject({
      storyName: "Box Trips – Landing Page",
      storyLink: "https://jira/LANDING",
    });
  });

  it("parses Windows Slack RTF hyperlinks into story and link columns", () => {
    const plain = "Order Creation\nPayments";
    const rtf =
      '{\\rtf1{\\field{\\*\\fldinst HYPERLINK "https://jira/FOO-1"}{\\fldrslt Order Creation}}\\line{\\field{\\*\\fldinst HYPERLINK "https://jira/FOO-2"}{\\fldrslt Payments}}';

    const table = parseClipboardTable("", plain, rtf);
    const next = applyClipboardPasteToDrafts(createEmptyBulkDraftRows(2), table, {
      rowIndex: 0,
      colIndex: 0,
    });

    expect(next[0]).toMatchObject({
      storyName: "Order Creation",
      storyLink: "https://jira/FOO-1",
    });
    expect(next[1]).toMatchObject({
      storyName: "Payments",
      storyLink: "https://jira/FOO-2",
    });
  });

  it("pastes PM names into the PM column instead of QC hours", () => {
    const current = createEmptyBulkDraftRows(2);
    const pmColIndex = 13;

    const next = applyClipboardPasteToDrafts(
      current,
      [[{ text: "PM-One", href: null }]],
      { rowIndex: 0, colIndex: pmColIndex },
    );

    expect(next[0].productManagersRaw).toBe("PM-One");
    expect(next[0].qcHoursRaw).toBe("");
  });

  it("pastes QC hours beside QC names in the grid column order", () => {
    const current = createEmptyBulkDraftRows(1);
    const table = [[{ text: "QC-One", href: null }, { text: "4", href: null }]];

    const next = applyClipboardPasteToDrafts(current, table, { rowIndex: 0, colIndex: 11 });

    expect(next[0].qcsRaw).toBe("QC-One");
    expect(next[0].qcHoursRaw).toBe("4");
    expect(next[0].productManagersRaw).toBe("");
  });

  it("resolves PM assignees from the PM column", () => {
    const resolved = resolveBulkTaskRow(
      {
        storyName: "Story",
        storyLink: "link",
        beDevsRaw: "",
        feDevsRaw: "",
        androidDevsRaw: "",
        iosDevsRaw: "",
        qcsRaw: "QC-One",
        productManagersRaw: "PM-One",
        beHoursRaw: "",
        feHoursRaw: "",
        androidHoursRaw: "",
        iosHoursRaw: "",
        mobileAppRaw: "",
        qcHoursRaw: "2",
      },
      resources,
    );

    expect(resolved.qcs).toEqual(["QC-One"]);
    expect(resolved.qcHours).toBe(2);
    expect(resolved.productManagers).toEqual(["PM-One"]);
  });

  it("clears all values inside a multi-cell selection", () => {
    const current = createEmptyBulkDraftRows(3);
    current[0].storyName = "A";
    current[0].beDevsRaw = "Abbas";
    current[1].storyName = "B";
    current[1].beDevsRaw = "Karim";
    current[2].storyName = "C";
    current[2].beDevsRaw = "Alice";

    const next = clearBulkGridSelection(current, {
      startRow: 0,
      startCol: 0,
      endRow: 2,
      endCol: 2,
    });

    expect(next[0]).toMatchObject({ storyName: "", storyLink: "", beDevsRaw: "" });
    expect(next[1]).toMatchObject({ storyName: "", beDevsRaw: "" });
    expect(next[2]).toMatchObject({ storyName: "", beDevsRaw: "" });
  });
});
