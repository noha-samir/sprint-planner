import type { BulkPasteParseResult, BulkPasteRow } from "@/lib/planner/bulkTaskPaste";
import type { Resource, ResourceType } from "@/lib/scheduler/types";

/**
 * Spreadsheet columns for Tasks import.
 * Only Task + BE/FE/Android/IOS/QC assignees and estimation hours (plus optional MO Start Date) are applied;
 * P0, Status, release dates, and Notes are accepted for file shape only.
 * Legacy "MO Dev" / "MO Hours" headers map to Android.
 */
export const TASKS_IMPORT_HEADERS = [
  "Task",
  "P0",
  "Status",
  "BE Dev",
  "BE Estimation hours",
  "BE Release to staging",
  "FE Dev",
  "FE Estimation hours",
  "FE Release to staging",
  "Android Dev",
  "Android Hours",
  "Needs iOS",
  "IOS Dev",
  "IOS Hours",
  "MO Start Date",
  "QC",
  "QC Estimation hours",
  "QC Release to UAT",
  "Release to Production",
  "Notes",
] as const;

const TEMPLATE_FILENAME = "tasks-import-template.xlsx";
const TEMPLATE_SHEET = "Tasks";
const LISTS_SHEET = "_lists";
const DATA_START_ROW = 2;
const DATA_END_ROW = 200;
const IMPORT_COLUMN_COUNT = TASKS_IMPORT_HEADERS.length;

type ImportCell = {
  text: string;
  href: string | null;
};

type ImportColumnKey =
  | "task"
  | "beDev"
  | "beHours"
  | "feDev"
  | "feHours"
  | "androidDev"
  | "androidHours"
  | "needsIos"
  | "iosDev"
  | "iosHours"
  | "moStartDate"
  | "qc"
  | "qcHours";

type ImportColumnMap = Partial<Record<ImportColumnKey, number>>;

/** Default positions for the current template / export layout. */
const DEFAULT_COLUMN_MAP: Record<ImportColumnKey, number> = {
  task: 0,
  beDev: 3,
  beHours: 4,
  feDev: 6,
  feHours: 7,
  androidDev: 9,
  androidHours: 10,
  needsIos: 11,
  iosDev: 12,
  iosHours: 13,
  moStartDate: 14,
  qc: 15,
  qcHours: 16,
};

/**
 * Split a CSV line into cells, respecting double-quoted fields.
 */
export const parseCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
};

const splitImportLine = (line: string): string[] => {
  const tabCount = (line.match(/\t/g) ?? []).length;
  const commaCount = (line.match(/,/g) ?? []).length;
  if (tabCount > 0 && tabCount >= commaCount) {
    return line.split("\t");
  }
  return parseCsvLine(line);
};

const namesForType = (resources: Resource[], type: ResourceType): string[] =>
  resources
    .filter((resource) => resource.type === type)
    .map((resource) => resource.name)
    .sort((a, b) => a.localeCompare(b));

const normalizeHeader = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/estmation/g, "estimation");

const resolveHeaderKey = (header: string): ImportColumnKey | null => {
  const normalized = normalizeHeader(header);
  if (normalized === "task" || normalized === "story" || normalized === "story name") {
    return "task";
  }
  if (normalized === "be dev" || normalized === "be" || normalized === "be developer") {
    return "beDev";
  }
  if (
    normalized === "be estimation hours" ||
    normalized === "be hours" ||
    normalized === "be estimation hour"
  ) {
    return "beHours";
  }
  if (normalized === "fe dev" || normalized === "fe" || normalized === "fe developer") {
    return "feDev";
  }
  if (
    normalized === "fe estimation hours" ||
    normalized === "fe hours" ||
    normalized === "fe estimation hour"
  ) {
    return "feHours";
  }
  if (
    normalized === "android dev" ||
    normalized === "android" ||
    normalized === "android developer" ||
    normalized === "mo dev" ||
    normalized === "mo" ||
    normalized === "mo developer" ||
    normalized === "mobile"
  ) {
    return "androidDev";
  }
  if (
    normalized === "android hours" ||
    normalized === "android estimation hours" ||
    normalized === "mo hours" ||
    normalized === "mo estimation hours" ||
    normalized === "mo estimation hour" ||
    normalized === "mobile hours"
  ) {
    return "androidHours";
  }
  if (
    normalized === "needs ios" ||
    normalized === "need ios" ||
    normalized === "ios needed" ||
    normalized === "needs iOS".toLowerCase()
  ) {
    return "needsIos";
  }
  if (
    normalized === "ios dev" ||
    normalized === "ios" ||
    normalized === "ios developer"
  ) {
    return "iosDev";
  }
  if (
    normalized === "ios hours" ||
    normalized === "ios estimation hours" ||
    normalized === "ios estimation hour"
  ) {
    return "iosHours";
  }
  if (
    normalized === "mo start date" ||
    normalized === "mo start" ||
    normalized === "mobile start date"
  ) {
    return "moStartDate";
  }
  if (normalized === "qc" || normalized === "qc eng" || normalized === "qc engineer") {
    return "qc";
  }
  if (
    normalized === "qc estimation hours" ||
    normalized === "qc hours" ||
    normalized === "qc estimation hour"
  ) {
    return "qcHours";
  }
  return null;
};

const isHeaderRow = (cells: string[]): boolean => {
  const first = normalizeHeader(cells[0] ?? "");
  return first === "task" || first === "story name" || first === "story";
};

const buildColumnMap = (headerCells: string[]): ImportColumnMap | null => {
  if (!isHeaderRow(headerCells)) {
    return null;
  }
  const map: ImportColumnMap = {};
  headerCells.forEach((header, index) => {
    const key = resolveHeaderKey(header);
    if (key && map[key] === undefined) {
      map[key] = index;
    }
  });
  return map.task !== undefined ? map : null;
};

const parseHours = (raw: string): number => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return 0;
  }
  const value = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.min(80, Math.round(value * 100) / 100);
};

/** Parse optional yyyy-MM-dd (or Excel-style date text) into a planner date string. */
const parseOptionalDate = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  const slash = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (slash) {
    const month = slash[1].padStart(2, "0");
    const day = slash[2].padStart(2, "0");
    return `${slash[3]}-${month}-${day}`;
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString().slice(0, 10);
};

const resolveAssignee = (
  raw: string,
  label: string,
  knownNames: Set<string>,
): { names: string[]; warnings: string[] } => {
  const token = raw.trim();
  if (!token) {
    return { names: [], warnings: [] };
  }
  if (knownNames.has(token)) {
    return { names: [token], warnings: [] };
  }
  const match = [...knownNames].find((name) => name.toLowerCase() === token.toLowerCase());
  if (match) {
    return { names: [match], warnings: [] };
  }
  return { names: [], warnings: [`Unknown ${label} assignee: "${token}"`] };
};

const cellText = (cell: ImportCell | undefined): string => cell?.text?.trim() ?? "";

const looksLikeUrl = (value: string): boolean => /^https?:\/\//i.test(value.trim());

const readMappedCell = (
  cells: ImportCell[],
  map: ImportColumnMap | Record<ImportColumnKey, number>,
  key: ImportColumnKey,
): ImportCell | undefined => {
  const index = map[key];
  return index === undefined ? undefined : cells[index];
};

/**
 * Parse one spreadsheet data row into a bulk paste row.
 * Only Task (name/link) and BE/FE/Android/IOS/QC assignees + hours (and optional MO Start Date) are stored.
 */
export const parseTasksImportRow = (
  cells: ImportCell[],
  resources: Resource[],
  columnMap: ImportColumnMap | Record<ImportColumnKey, number> = DEFAULT_COLUMN_MAP,
): BulkPasteRow | null => {
  if (cells.every((cell) => !cellText(cell) && !cell.href)) {
    return null;
  }

  const taskCell = readMappedCell(cells, columnMap, "task");
  const storyName = cellText(taskCell) || (taskCell?.href ?? "").trim();
  const storyLink = (taskCell?.href ?? "").trim() || (looksLikeUrl(cellText(taskCell)) ? cellText(taskCell) : "");

  const beKnown = new Set(namesForType(resources, "BE"));
  const feKnown = new Set(namesForType(resources, "FE"));
  const moKnown = new Set(namesForType(resources, "MO"));
  const qcKnown = new Set(namesForType(resources, "QC"));

  const be = resolveAssignee(cellText(readMappedCell(cells, columnMap, "beDev")), "BE", beKnown);
  const fe = resolveAssignee(cellText(readMappedCell(cells, columnMap, "feDev")), "FE", feKnown);
  const android = resolveAssignee(
    cellText(readMappedCell(cells, columnMap, "androidDev")),
    "MO",
    moKnown,
  );
  const needsIosRaw = cellText(readMappedCell(cells, columnMap, "needsIos")).toLowerCase();
  const needsIos = ["1", "y", "yes", "true", "t", "ios", "need", "needed"].includes(needsIosRaw);
  const ios = needsIos
    ? resolveAssignee(cellText(readMappedCell(cells, columnMap, "iosDev")), "MO", moKnown)
    : { names: [] as string[], warnings: [] as string[] };
  const qc = resolveAssignee(cellText(readMappedCell(cells, columnMap, "qc")), "QC", qcKnown);

  const warnings = [...be.warnings, ...fe.warnings, ...android.warnings, ...ios.warnings, ...qc.warnings];
  const beHours = parseHours(cellText(readMappedCell(cells, columnMap, "beHours")));
  const feHours = parseHours(cellText(readMappedCell(cells, columnMap, "feHours")));
  const androidHours = parseHours(cellText(readMappedCell(cells, columnMap, "androidHours")));
  const iosHours = needsIos ? parseHours(cellText(readMappedCell(cells, columnMap, "iosHours"))) : 0;
  const qcHours = parseHours(cellText(readMappedCell(cells, columnMap, "qcHours")));
  const moStartDate = parseOptionalDate(cellText(readMappedCell(cells, columnMap, "moStartDate")));

  const isValid = storyName.length > 0 || storyLink.length > 0;
  if (!isValid) {
    return null;
  }

  return {
    storyName,
    storyLink,
    beDevs: be.names,
    feDevs: fe.names,
    androidDevs: android.names,
    iosDevs: needsIos ? ios.names : [],
    qcs: qc.names,
    beHours,
    feHours,
    androidHours,
    iosHours,
    needsIos,
    moStartDate,
    qcHours,
    warnings,
    isValid,
  };
};

const readExcelCell = (value: unknown): ImportCell => {
  if (value == null) {
    return { text: "", href: null };
  }
  if (typeof value === "object" && "hyperlink" in value) {
    const hyperlink = value as { text?: string; hyperlink?: string };
    return {
      text: (hyperlink.text ?? hyperlink.hyperlink ?? "").trim(),
      href: hyperlink.hyperlink?.trim() || null,
    };
  }
  if (typeof value === "object" && "text" in value && typeof (value as { text: unknown }).text === "string") {
    return { text: (value as { text: string }).text.trim(), href: null };
  }
  if (typeof value === "object" && "result" in value) {
    return { text: String((value as { result: unknown }).result ?? "").trim(), href: null };
  }
  if (value instanceof Date) {
    return { text: value.toISOString().slice(0, 10), href: null };
  }
  return { text: String(value).trim(), href: null };
};

/**
 * Trigger a browser download of an XLSX template matching the Tasks import columns,
 * with BE/FE/MO/QC dropdowns from the current resources list.
 */
export const downloadTasksImportTemplate = async (resources: Resource[] = []) => {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(TEMPLATE_SHEET);
  const lists = workbook.addWorksheet(LISTS_SHEET);
  lists.state = "hidden";

  const beNames = namesForType(resources, "BE");
  const feNames = namesForType(resources, "FE");
  const moNames = namesForType(resources, "MO");
  const qcNames = namesForType(resources, "QC");

  lists.getColumn(1).values = ["BE Dev", ...beNames];
  lists.getColumn(2).values = ["FE Dev", ...feNames];
  lists.getColumn(3).values = ["Android Dev", ...moNames];
  lists.getColumn(4).values = ["IOS Dev", ...moNames];
  lists.getColumn(5).values = ["QC", ...qcNames];
  lists.getColumn(6).values = ["Needs iOS", "yes", "no"];

  worksheet.addRow([...TASKS_IMPORT_HEADERS]);
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).alignment = { wrapText: true, vertical: "middle" };

  worksheet.columns = [
    { width: 36 },
    { width: 8 },
    { width: 14 },
    { width: 16 },
    { width: 14 },
    { width: 18 },
    { width: 16 },
    { width: 14 },
    { width: 18 },
    { width: 16 },
    { width: 12 },
    { width: 12 },
    { width: 16 },
    { width: 12 },
    { width: 14 },
    { width: 16 },
    { width: 14 },
    { width: 16 },
    { width: 18 },
    { width: 24 },
  ];

  const beCol = DEFAULT_COLUMN_MAP.beDev + 1;
  const feCol = DEFAULT_COLUMN_MAP.feDev + 1;
  const androidCol = DEFAULT_COLUMN_MAP.androidDev + 1;
  const needsIosCol = DEFAULT_COLUMN_MAP.needsIos + 1;
  const iosCol = DEFAULT_COLUMN_MAP.iosDev + 1;
  const qcCol = DEFAULT_COLUMN_MAP.qc + 1;

  for (let row = DATA_START_ROW; row <= DATA_END_ROW; row += 1) {
    if (beNames.length > 0) {
      worksheet.getCell(row, beCol).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`=${LISTS_SHEET}!$A$2:$A$${beNames.length + 1}`],
        showErrorMessage: true,
        errorTitle: "BE Dev",
        error: "Choose a BE from the resources list.",
      };
    }
    if (feNames.length > 0) {
      worksheet.getCell(row, feCol).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`=${LISTS_SHEET}!$B$2:$B$${feNames.length + 1}`],
        showErrorMessage: true,
        errorTitle: "FE Dev",
        error: "Choose an FE from the resources list.",
      };
    }
    if (moNames.length > 0) {
      worksheet.getCell(row, androidCol).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`=${LISTS_SHEET}!$C$2:$C$${moNames.length + 1}`],
        showErrorMessage: true,
        errorTitle: "Android Dev",
        error: "Choose a Mobile person from the resources list.",
      };
      worksheet.getCell(row, iosCol).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`=${LISTS_SHEET}!$D$2:$D$${moNames.length + 1}`],
        showErrorMessage: true,
        errorTitle: "IOS Dev",
        error: "Choose a Mobile person from the resources list.",
      };
    }
    worksheet.getCell(row, needsIosCol).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`=${LISTS_SHEET}!$F$2:$F$3`],
      showErrorMessage: true,
      errorTitle: "Needs iOS",
      error: "Choose yes or no.",
    };
    if (qcNames.length > 0) {
      worksheet.getCell(row, qcCol).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`=${LISTS_SHEET}!$E$2:$E$${qcNames.length + 1}`],
        showErrorMessage: true,
        errorTitle: "QC",
        error: "Choose a QC from the resources list.",
      };
    }
  }

  worksheet.getCell("A2").note =
    "Enter the story name. Optionally turn the cell into a hyperlink to the Jira story URL (Insert → Link). Only Task + BE/FE/Android/IOS/QC + hours (and optional MO Start Date) are imported. Legacy MO columns map to Android.";

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = TEMPLATE_FILENAME;
  anchor.click();
  URL.revokeObjectURL(url);
};

const parseImportTable = (table: ImportCell[][], resources: Resource[]): BulkPasteParseResult => {
  if (table.length === 0) {
    return { rows: [], skippedEmpty: 0 };
  }

  let skippedEmpty = 0;
  const rows: BulkPasteRow[] = [];
  const headerTexts = table[0]?.map((cell) => cellText(cell)) ?? [];
  const columnMap = buildColumnMap(headerTexts) ?? DEFAULT_COLUMN_MAP;

  table.forEach((cells, index) => {
    if (cells.every((cell) => !cellText(cell) && !cell.href)) {
      skippedEmpty += 1;
      return;
    }
    if (index === 0 && isHeaderRow(cells.map((cell) => cellText(cell)))) {
      return;
    }
    const parsed = parseTasksImportRow(cells, resources, columnMap);
    if (!parsed) {
      skippedEmpty += 1;
      return;
    }
    rows.push(parsed);
  });

  return { rows, skippedEmpty };
};

/**
 * Parse a CSV/TSV import file into bulk paste rows.
 */
export const parseTasksImportCsv = (text: string, resources: Resource[]): BulkPasteParseResult => {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) {
    return { rows: [], skippedEmpty: 0 };
  }
  const table = normalized.split("\n").map((line) =>
    splitImportLine(line).map((cell) => ({
      text: cell.trim(),
      href: looksLikeUrl(cell.trim()) ? cell.trim() : null,
    })),
  );
  return parseImportTable(table, resources);
};

/**
 * Parse an XLSX import file (first data sheet) into bulk paste rows.
 */
export const parseTasksImportXlsx = async (
  buffer: ArrayBuffer,
  resources: Resource[],
): Promise<BulkPasteParseResult> => {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet =
    workbook.getWorksheet(TEMPLATE_SHEET) ??
    workbook.worksheets.find((sheet) => sheet.name !== LISTS_SHEET) ??
    workbook.worksheets[0];
  if (!worksheet) {
    return { rows: [], skippedEmpty: 0 };
  }

  const table: ImportCell[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: ImportCell[] = [];
    const maxCol = Math.max(row.cellCount, IMPORT_COLUMN_COUNT);
    for (let col = 1; col <= maxCol; col += 1) {
      cells.push(readExcelCell(row.getCell(col).value));
    }
    table.push(cells);
  });

  return parseImportTable(table, resources);
};

export type TasksImportParseResult = BulkPasteParseResult & {
  error?: string;
};

/**
 * Parse a user-selected import file (CSV or XLSX) into bulk paste rows.
 */
export const parseTasksImportFile = async (
  file: File,
  resources: Resource[],
): Promise<TasksImportParseResult> => {
  const lowerName = file.name.toLowerCase();
  try {
    if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
      const buffer = await file.arrayBuffer();
      return parseTasksImportXlsx(buffer, resources);
    }
    if (
      lowerName.endsWith(".csv") ||
      lowerName.endsWith(".txt") ||
      file.type.includes("csv") ||
      file.type === "text/plain"
    ) {
      const text = await file.text();
      return parseTasksImportCsv(text, resources);
    }
    return { rows: [], skippedEmpty: 0, error: "Unsupported file type. Use the XLSX template (or CSV)." };
  } catch {
    return { rows: [], skippedEmpty: 0, error: "Could not read the import file." };
  }
};
