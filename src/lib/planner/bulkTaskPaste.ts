import type { Resource, ResourceType } from "@/lib/scheduler/types";

export interface BulkPasteRow {
  storyName: string;
  storyLink: string;
  beDevs: string[];
  feDevs: string[];
  androidDevs: string[];
  iosDevs: string[];
  qcs: string[];
  productManagers: string[];
  beHours?: number;
  feHours?: number;
  androidHours?: number;
  iosHours?: number;
  needsIos?: boolean;
  mobileApp?: "none" | "star" | "hubs";
  moStartDate?: string | null;
  qcHours?: number;
  tags?: string[];
  issueType?: string;
  isEmStory?: boolean;
  warnings: string[];
  isValid: boolean;
}

export interface BulkTaskDraftRow {
  storyName: string;
  storyLink: string;
  beDevsRaw: string;
  feDevsRaw: string;
  androidDevsRaw: string;
  iosDevsRaw: string;
  qcsRaw: string;
  productManagersRaw: string;
  beHoursRaw: string;
  feHoursRaw: string;
  androidHoursRaw: string;
  iosHoursRaw: string;
  mobileAppRaw: string;
  qcHoursRaw: string;
}

export interface BulkPasteParseResult {
  rows: BulkPasteRow[];
  skippedEmpty: number;
}

export const emptyBulkDraftRow = (): BulkTaskDraftRow => ({
  storyName: "",
  storyLink: "",
  beDevsRaw: "",
  feDevsRaw: "",
  androidDevsRaw: "",
  iosDevsRaw: "",
  qcsRaw: "",
  productManagersRaw: "",
  beHoursRaw: "",
  feHoursRaw: "",
  androidHoursRaw: "",
  iosHoursRaw: "",
  mobileAppRaw: "",
  qcHoursRaw: "",
});

export const createEmptyBulkDraftRows = (count: number): BulkTaskDraftRow[] =>
  Array.from({ length: count }, () => emptyBulkDraftRow());

const HEADER_FIRST_CELL =
  /^(story\s*name|story\s*link|name|link|be(\s*devs?)?|fe(\s*devs?)?|mo(\s*devs?)?|qc(\s*engineers?)?)$/i;

const splitAssigneeCell = (raw: string): string[] => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  return trimmed
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
};

const parseEstimationHours = (raw: string): number => {
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

const buildResourceSets = (resources: Resource[]) => {
  const byType = new Map<ResourceType, Set<string>>();
  resources.forEach((resource) => {
    const names = byType.get(resource.type) ?? new Set<string>();
    names.add(resource.name);
    byType.set(resource.type, names);
  });
  return byType;
};

const resolveAssignees = (
  raw: string,
  type: ResourceType,
  label: string,
  knownNames: Set<string>,
): { names: string[]; warnings: string[] } => {
  const tokens = splitAssigneeCell(raw);
  const names: string[] = [];
  const warnings: string[] = [];

  tokens.forEach((token) => {
    if (knownNames.has(token)) {
      if (!names.includes(token)) {
        names.push(token);
      }
      return;
    }
    warnings.push(`Unknown ${label} assignee: "${token}"`);
  });

  return { names, warnings };
};

const isHeaderRow = (cells: string[]): boolean => HEADER_FIRST_CELL.test(cells[0]?.trim() ?? "");

export interface ClipboardCell {
  text: string;
  href: string | null;
}

const looksLikeUrl = (value: string): boolean => /^https?:\/\//i.test(value.trim());

/**
 * Excel on Windows often copies HTML as quoted-printable (href=3D"https://...").
 */
export const decodeClipboardHtml = (html: string): string => {
  let decoded = html.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const start = decoded.indexOf("<!--StartFragment-->");
  const end = decoded.indexOf("<!--EndFragment-->");
  if (start >= 0 && end > start) {
    decoded = decoded.slice(start + "<!--StartFragment-->".length, end);
  }

  return decoded
    .replace(/=\n/g, "")
    .replace(/=3D/gi, "=")
    .replace(/=22/g, '"')
    .replace(/=27/g, "'")
    .replace(/=20/g, " ")
    .replace(/=09/g, "\t")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
};

export const clipboardHtmlContainsLinks = (html: string): boolean => {
  const decoded = decodeClipboardHtml(html);
  return (
    /<a\b/i.test(decoded) ||
    /\bhref\s*=/i.test(decoded) ||
    /\bHRef\s*=/i.test(decoded) ||
    /data-stringify-link/i.test(decoded) ||
    /data-sheets-value/i.test(decoded) ||
    /https?:\/\//i.test(decoded)
  );
};

const clipboardRtfContainsLinks = (rtf: string): boolean => /HYPERLINK\s+"/i.test(rtf);

export const clipboardPlainTextContainsLinks = (plainText: string): boolean =>
  /<https?:\/\/[^>|]+(?:\|[^>]+)?>/i.test(plainText) ||
  /\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(plainText);

export const clipboardContainsLinks = (html: string, plainText: string, rtf = ""): boolean =>
  clipboardHtmlContainsLinks(html) ||
  clipboardPlainTextContainsLinks(plainText) ||
  clipboardRtfContainsLinks(rtf);

const parseSlackPlainTextCell = (raw: string): ClipboardCell => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { text: "", href: null };
  }

  const slackWithLabel = trimmed.match(/^<((?:https?:\/\/)[^|>]+)\|([^>]+)>$/i);
  if (slackWithLabel) {
    return {
      text: slackWithLabel[2].trim(),
      href: normalizeClipboardHref(slackWithLabel[1]),
    };
  }

  const slackBareUrl = trimmed.match(/^<((?:https?:\/\/)[^>]+)>$/i);
  if (slackBareUrl) {
    const href = normalizeClipboardHref(slackBareUrl[1]);
    return {
      text: href ?? trimmed,
      href,
    };
  }

  const markdownLink = trimmed.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/i);
  if (markdownLink) {
    return {
      text: markdownLink[1].trim(),
      href: normalizeClipboardHref(markdownLink[2]),
    };
  }

  const embeddedSlack = trimmed.match(/<((?:https?:\/\/)[^|>]+)\|([^>]+)>/i);
  if (embeddedSlack) {
    return {
      text: embeddedSlack[2].trim(),
      href: normalizeClipboardHref(embeddedSlack[1]),
    };
  }

  const embeddedMarkdown = trimmed.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/i);
  if (embeddedMarkdown) {
    return {
      text: embeddedMarkdown[1].trim(),
      href: normalizeClipboardHref(embeddedMarkdown[2]),
    };
  }

  if (looksLikeUrl(trimmed)) {
    return { text: trimmed, href: trimmed };
  }

  return { text: trimmed, href: null };
};

const unwrapClipboardHref = (href: string): string => {
  try {
    const url = new URL(href);
    const nested = url.searchParams.get("url") ?? url.searchParams.get("u");
    if (nested) {
      const decoded = decodeURIComponent(nested);
      if (looksLikeUrl(decoded)) {
        return decoded;
      }
    }
  } catch {
    // keep original href
  }
  return href;
};

const normalizeClipboardHref = (raw: string | null | undefined): string | null => {
  if (!raw) {
    return null;
  }
  const href = unwrapClipboardHref(raw.trim().replace(/&amp;/g, "&"));
  if (!href || href.startsWith("#") || /^javascript:/i.test(href)) {
    return null;
  }
  return looksLikeUrl(href) ? href : null;
};

const buildPlainClipboardGrid = (plainText: string): ClipboardCell[][] => {
  const normalized = plainText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  return normalized.split("\n").map((line) => line.split("\t").map((text) => parseSlackPlainTextCell(text)));
};

const parseGoogleSheetsHref = (cell: Element): string | null => {
  const raw =
    cell.getAttribute("data-sheets-value") ??
    cell.querySelector("[data-sheets-value]")?.getAttribute("data-sheets-value");
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw.replace(/&quot;/g, '"')) as Record<string, unknown>;
    const candidate = parsed["2"];
    return typeof candidate === "string" ? normalizeClipboardHref(candidate) : null;
  } catch {
    return null;
  }
};

const extractCellFromHtmlElement = (cell: Element): ClipboardCell => {
  const slackLink = cell.getAttribute("data-stringify-link");
  const directHref = normalizeClipboardHref(slackLink);
  if (directHref) {
    return {
      text: (cell.textContent ?? "").trim(),
      href: directHref,
    };
  }

  const anchor = cell.querySelector("a[href], [data-stringify-link]");
  const anchorSlackLink = anchor?.getAttribute("data-stringify-link");
  const anchorHref = normalizeClipboardHref(anchorSlackLink ?? anchor?.getAttribute("href"));
  if (anchor && anchorHref) {
    return {
      text: (anchor.textContent ?? "").trim(),
      href: anchorHref,
    };
  }

  const sheetsHref = parseGoogleSheetsHref(cell);
  const text = (cell.textContent ?? "").trim();
  return {
    text,
    href: sheetsHref,
  };
};

const extractAnchorsWithRegex = (html: string): ClipboardCell[] => {
  const anchors: ClipboardCell[] = [];
  const stringifyPattern = /<[^>]*\bdata-stringify-link\s*=\s*"([^"]*)"[^>]*>([^<]*)</gi;
  let stringifyMatch = stringifyPattern.exec(html);
  while (stringifyMatch) {
    const href = normalizeClipboardHref(stringifyMatch[1]);
    const text = stringifyMatch[2].replace(/<[^>]+>/g, "").trim();
    if (href) {
      anchors.push({ text, href });
    }
    stringifyMatch = stringifyPattern.exec(html);
  }
  if (anchors.length > 0) {
    return anchors;
  }

  const patterns = [
    /<a\b[^>]*\bhref\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    /<a\b[^>]*\bhref\s*=\s*'([^']*)'[^>]*>([\s\S]*?)<\/a>/gi,
    /<a\b[^>]*\bhref\s*=\s*([^\s>]+)[^>]*>([\s\S]*?)<\/a>/gi,
    /<[^>]*\bHRef\s*=\s*"([^"]*)"[^>]*>([^<]*)</gi,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(html);
    while (match) {
      const href = normalizeClipboardHref(match[1]);
      const text = match[2].replace(/<[^>]+>/g, "").trim();
      if (href) {
        anchors.push({ text, href });
      }
      match = pattern.exec(html);
    }
    if (anchors.length > 0) {
      return anchors;
    }
  }

  return anchors;
};

const extractHttpsUrlsInOrder = (html: string): string[] => {
  const urls: string[] = [];
  const pattern = /https?:\/\/[^\s"'<>)]+/gi;
  let match = pattern.exec(html);
  while (match) {
    const href = normalizeClipboardHref(match[0]);
    if (href) {
      urls.push(href);
    }
    match = pattern.exec(html);
  }
  return urls;
};

const enrichPlainGridWithUrls = (plainGrid: ClipboardCell[][], urls: string[]): ClipboardCell[][] => {
  if (plainGrid.length === 0 || urls.length === 0) {
    return plainGrid;
  }

  let urlIndex = 0;
  return plainGrid.map((row) =>
    row.map((cell) => {
      if (cell.href || !cell.text || urlIndex >= urls.length) {
        return cell;
      }
      const href = urls[urlIndex];
      urlIndex += 1;
      return { ...cell, href };
    }),
  );
};

const parseGoogleSheetsHrefFromHtml = (html: string): ClipboardCell[] => {
  const cells: ClipboardCell[] = [];
  const pattern = /data-sheets-value="([^"]+)"[^>]*>([^<]*)/gi;
  let match = pattern.exec(html);
  while (match) {
    try {
      const parsed = JSON.parse(match[1].replace(/&quot;/g, '"')) as Record<string, unknown>;
      const href = typeof parsed["2"] === "string" ? normalizeClipboardHref(parsed["2"]) : null;
      const text = match[2].trim();
      if (href) {
        cells.push({ text, href });
      }
    } catch {
      // ignore malformed metadata
    }
    match = pattern.exec(html);
  }
  return cells;
};

const extractOrderedAnchors = (html: string): ClipboardCell[] => {
  const trimmed = decodeClipboardHtml(html);
  if (!trimmed) {
    return [];
  }

  if (typeof DOMParser !== "undefined") {
    const parser = new DOMParser();
    const doc = parser.parseFromString(trimmed, "text/html");
    const anchors: ClipboardCell[] = [];
    const seen = new Set<string>();

    const pushAnchor = (text: string, href: string | null) => {
      if (!href) {
        return;
      }
      const key = `${href}\0${text}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      anchors.push({ text, href });
    };

    doc.querySelectorAll("a[href], [data-stringify-link]").forEach((element) => {
      const slackLink = element.getAttribute("data-stringify-link");
      const href = normalizeClipboardHref(slackLink ?? element.getAttribute("href"));
      pushAnchor((element.textContent ?? "").trim(), href);
    });

    if (anchors.length > 0) {
      return anchors;
    }

    doc.querySelectorAll("td, th").forEach((cell) => {
      const parsed = extractCellFromHtmlElement(cell);
      if (parsed.href) {
        pushAnchor(parsed.text, parsed.href);
      }
    });

    if (anchors.length > 0) {
      return anchors;
    }
  }

  const regexAnchors = extractAnchorsWithRegex(trimmed);
  if (regexAnchors.length > 0) {
    return regexAnchors;
  }

  return parseGoogleSheetsHrefFromHtml(trimmed);
};

const enrichPlainGridWithAnchors = (
  plainGrid: ClipboardCell[][],
  anchors: ClipboardCell[],
): ClipboardCell[][] => {
  if (plainGrid.length === 0 || anchors.length === 0) {
    return plainGrid;
  }

  const isSingleColumn = plainGrid.every((row) => row.length === 1);
  if (isSingleColumn && anchors.length === plainGrid.length) {
    return plainGrid.map((row, index) => {
      const cell = row[0] ?? { text: "", href: null };
      const anchor = anchors[index];
      if (!anchor) {
        return row;
      }
      return [
        {
          text: cell.text || anchor.text,
          href: anchor.href ?? cell.href,
        },
      ];
    });
  }

  const flatPlain = plainGrid.flat();
  const flatWithText = flatPlain.filter((cell) => cell.text.length > 0);
  if (anchors.length === flatPlain.length || anchors.length === flatWithText.length) {
    let anchorIndex = 0;
    return plainGrid.map((row) =>
      row.map((cell) => {
        if (!cell.text) {
          return cell;
        }
        const anchor = anchors[anchorIndex];
        anchorIndex += 1;
        return {
          text: cell.text || anchor?.text || "",
          href: anchor?.href ?? cell.href,
        };
      }),
    );
  }

  return plainGrid.map((row) =>
    row.map((cell) => {
      const anchor = anchors.find(
        (item) =>
          item.text === cell.text ||
          (cell.text.length > 0 && item.text.includes(cell.text)) ||
          (item.text.length > 0 && cell.text.includes(item.text)),
      );
      if (!anchor) {
        return cell;
      }
      return {
        text: cell.text || anchor.text,
        href: anchor.href ?? cell.href,
      };
    }),
  );
};

const mergeClipboardGrids = (plainGrid: ClipboardCell[][], htmlGrid: ClipboardCell[][]): ClipboardCell[][] => {
  const maxRows = Math.max(plainGrid.length, htmlGrid.length);
  const merged: ClipboardCell[][] = [];

  for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
    const plainRow = plainGrid[rowIndex] ?? [];
    const htmlRow = htmlGrid[rowIndex] ?? [];
    const maxCols = Math.max(plainRow.length, htmlRow.length, 1);
    const row: ClipboardCell[] = [];

    for (let colIndex = 0; colIndex < maxCols; colIndex += 1) {
      const plainCell = plainRow[colIndex] ?? { text: "", href: null };
      const htmlCell = htmlRow[colIndex] ?? { text: "", href: null };
      row.push({
        text: plainCell.text || htmlCell.text,
        href: htmlCell.href ?? plainCell.href,
      });
    }

    merged.push(row);
  }

  return merged;
};

const parseSlackTextyLinks = (raw: string): ClipboardCell[] => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      ops?: Array<{ insert?: string | Record<string, unknown>; attributes?: { link?: string } }>;
    };
    const ops = parsed.ops;
    if (!Array.isArray(ops)) {
      return [];
    }

    const cells: ClipboardCell[] = [];
    let lineText = "";
    let lineHref: string | null = null;

    const flushLine = () => {
      const text = lineText.trim();
      if (text || lineHref) {
        cells.push({ text, href: lineHref });
      }
      lineText = "";
      lineHref = null;
    };

    ops.forEach((op) => {
      if (typeof op.insert !== "string") {
        flushLine();
        return;
      }

      const href = op.attributes?.link ? normalizeClipboardHref(op.attributes.link) : null;
      const parts = op.insert.split("\n");
      parts.forEach((part, index) => {
        if (href) {
          lineHref = href;
        }
        lineText += part;
        if (index < parts.length - 1) {
          flushLine();
        }
      });
    });

    flushLine();
    return cells.filter((cell) => cell.text || cell.href);
  } catch {
    return [];
  }
};

export const parseClipboardTable = (
  html: string,
  plainText: string,
  rtf = "",
  slackTexty = "",
): ClipboardCell[][] => {
  const decodedHtml = decodeClipboardHtml(html);
  const plainGrid = buildPlainClipboardGrid(plainText);
  const htmlGridFromTable = parseHtmlClipboardTable(decodedHtml);
  const htmlGrid = htmlGridFromTable.length > 0 ? htmlGridFromTable : parseHtmlBlockGrid(decodedHtml);
  const anchors = extractOrderedAnchors(decodedHtml);
  const rtfAnchors = parseRtfHyperlinks(rtf);
  const slackAnchors = parseSlackTextyLinks(slackTexty);

  let merged =
    htmlGrid.length > 0 ? mergeClipboardGrids(plainGrid, htmlGrid) : plainGrid.map((row) => [...row]);

  const anchorSources = [...anchors, ...rtfAnchors, ...slackAnchors];
  if (anchorSources.length > 0) {
    merged = enrichPlainGridWithAnchors(merged, anchorSources);
  }

  const missingLinks = merged.some((row) => row.some((cell) => cell.text && !cell.href));
  if (missingLinks) {
    const urls = extractStoryUrlsInOrder(decodedHtml, anchorSources);
    if (urls.length > 0) {
      merged = enrichPlainGridWithUrls(merged, urls);
    }
  }

  return merged.length > 0 ? merged : plainGrid;
};

export const countClipboardRowsMissingLinks = (table: ClipboardCell[][]): number =>
  table.filter((row) => {
    const storyCell = row[0];
    return Boolean(storyCell?.text?.trim()) && !storyCell?.href;
  }).length;

const parseHtmlBlockGrid = (html: string): ClipboardCell[][] => {
  const trimmed = html.trim();
  if (!trimmed) {
    return [];
  }

  const chunks = trimmed
    .split(/<br\s*\/?>/gi)
    .flatMap((chunk) => chunk.split(/<\/(?:p|div|li|tr|h\d)>/gi))
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (chunks.length === 0) {
    return [];
  }

  const rows = chunks
    .flatMap((chunk) => {
      const anchors = extractAnchorsWithRegex(chunk);
      if (anchors.length > 0) {
        return anchors.map((anchor) => [anchor]);
      }
      const text = chunk.replace(/<[^>]+>/g, "").trim();
      return text ? [[{ text, href: null as string | null }]] : [];
    })
    .filter((row) => row.length > 0);

  return rows;
};

const parseRtfHyperlinks = (rtf: string): ClipboardCell[] => {
  const trimmed = rtf.trim();
  if (!trimmed) {
    return [];
  }

  const urls: string[] = [];
  const urlPattern = /HYPERLINK\s+"([^"]+)"/gi;
  let urlMatch = urlPattern.exec(trimmed);
  while (urlMatch) {
    const href = normalizeClipboardHref(urlMatch[1]);
    if (href) {
      urls.push(href);
    }
    urlMatch = urlPattern.exec(trimmed);
  }

  if (urls.length === 0) {
    return [];
  }

  const texts: string[] = [];
  const textPattern = /\\fldrslt\s+([^}\\]+)/gi;
  let textMatch = textPattern.exec(trimmed);
  while (textMatch) {
    texts.push(textMatch[1].replace(/\\'[0-9a-f]{2}/gi, "").trim());
    textMatch = textPattern.exec(trimmed);
  }

  return urls.map((href, index) => ({
    text: texts[index] ?? "",
    href,
  }));
};

const isLikelyStoryUrl = (url: string): boolean => {
  const lower = url.toLowerCase();
  if (/\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?)(\?|$)/.test(lower)) {
    return false;
  }
  if (lower.includes("fonts.googleapis.com") || lower.includes("slack-edge.com/css")) {
    return false;
  }
  return true;
};

const extractStoryUrlsInOrder = (html: string, anchors: ClipboardCell[]): string[] => {
  const fromAnchors = anchors.map((anchor) => anchor.href).filter((href): href is string => Boolean(href));
  if (fromAnchors.length > 0) {
    return fromAnchors;
  }

  return extractHttpsUrlsInOrder(html).filter(isLikelyStoryUrl);
};

export const readClipboardPayload = (clipboardData: DataTransfer) => {
  let html = clipboardData.getData("text/html");
  const plain = clipboardData.getData("text/plain");
  let rtf = clipboardData.getData("text/rtf");
  let slackTexty = clipboardData.getData("slack/texty");

  clipboardData.types.forEach((type) => {
    const lower = type.toLowerCase();
    if (!html && lower.includes("html")) {
      html = clipboardData.getData(type);
    }
    if (!rtf && lower.includes("rtf")) {
      rtf = clipboardData.getData(type);
    }
    if (!slackTexty && (lower.includes("slack") || lower.includes("texty"))) {
      slackTexty = clipboardData.getData(type);
    }
  });

  return { html, plain, rtf, slackTexty };
};

const parseHtmlClipboardTable = (html: string): ClipboardCell[][] => {
  const trimmed = html.trim();
  if (!trimmed || typeof DOMParser === "undefined") {
    return [];
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(trimmed, "text/html");
  const tables = [...doc.querySelectorAll("table")];
  if (tables.length === 0) {
    return [];
  }

  const table = tables.reduce((best, candidate) => {
    const bestRows = best.querySelectorAll("tr").length;
    const candidateRows = candidate.querySelectorAll("tr").length;
    return candidateRows > bestRows ? candidate : best;
  });

  const rows: ClipboardCell[][] = [];
  table.querySelectorAll("tr").forEach((row) => {
    const cells: ClipboardCell[] = [];
    row.querySelectorAll("td, th").forEach((cell) => {
      cells.push(extractCellFromHtmlElement(cell));
    });
    if (cells.length > 0) {
      rows.push(cells);
    }
  });

  return rows;
};

const looksLikeMoStartDate = (raw: string): boolean => /^\d{4}-\d{2}-\d{2}/.test(raw.trim());

const looksLikeMobileAppCell = (raw: string): boolean => {
  const value = raw.trim().toLowerCase();
  return (
    value === "" ||
    value === "star" ||
    value === "hubs" ||
    value === "hub" ||
    value === "star app" ||
    value === "hubs app"
  );
};

const isCurrentBulkGridPasteRow = (cells: string[]): boolean => {
  if (cells.length < 14) {
    return false;
  }
  if (looksLikeMoStartDate(cells[11] ?? "")) {
    return false;
  }
  return looksLikeMobileAppCell(cells[8] ?? "");
};

const bulkDraftFieldOrder: (keyof BulkTaskDraftRow)[] = [
  "storyName",
  "storyLink",
  "beDevsRaw",
  "beHoursRaw",
  "feDevsRaw",
  "feHoursRaw",
  "androidDevsRaw",
  "androidHoursRaw",
  "mobileAppRaw",
  "iosDevsRaw",
  "iosHoursRaw",
  "qcsRaw",
  "qcHoursRaw",
  "productManagersRaw",
];

export const bulkDraftFieldOrderForGrid = bulkDraftFieldOrder;

export const bulkDraftFieldAt = (colIndex: number): keyof BulkTaskDraftRow | undefined =>
  bulkDraftFieldOrder[colIndex];

export const isBulkAssigneeDraftField = (field: keyof BulkTaskDraftRow | undefined): boolean =>
  field === "beDevsRaw" ||
  field === "feDevsRaw" ||
  field === "androidDevsRaw" ||
  field === "iosDevsRaw" ||
  field === "qcsRaw" ||
  field === "productManagersRaw";

export const shouldInterceptBulkGridPaste = (
  html: string,
  plainText: string,
  table: ClipboardCell[][],
  selectionSize: number,
  rtf = "",
  focusedField?: keyof BulkTaskDraftRow,
): boolean => {
  if (selectionSize > 1) {
    return true;
  }

  if (isBulkAssigneeDraftField(focusedField) && table.length > 0) {
    return true;
  }

  const hasTabs = plainText.includes("\t");
  const hasNewlines = plainText.includes("\n") || plainText.includes("\r");
  const isSpreadsheetPaste =
    hasTabs || hasNewlines || table.length > 1 || table.some((row) => row.length > 1);
  const hasHyperlink =
    clipboardContainsLinks(html, plainText, rtf) || table.some((row) => row.some((cell) => cell.href));

  return isSpreadsheetPaste || hasHyperlink;
};

export interface BulkGridAnchor {
  rowIndex: number;
  colIndex: number;
}

export interface BulkGridSelection {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export const normalizeBulkGridSelection = (selection: BulkGridSelection): BulkGridSelection => ({
  startRow: Math.min(selection.startRow, selection.endRow),
  startCol: Math.min(selection.startCol, selection.endCol),
  endRow: Math.max(selection.startRow, selection.endRow),
  endCol: Math.max(selection.startCol, selection.endCol),
});

export const bulkGridSelectionSize = (selection: BulkGridSelection): number => {
  const normalized = normalizeBulkGridSelection(selection);
  return (
    (normalized.endRow - normalized.startRow + 1) * (normalized.endCol - normalized.startCol + 1)
  );
};

export const isBulkGridCellSelected = (
  rowIndex: number,
  colIndex: number,
  selection: BulkGridSelection | null,
): boolean => {
  if (!selection) {
    return false;
  }
  const normalized = normalizeBulkGridSelection(selection);
  return (
    rowIndex >= normalized.startRow &&
    rowIndex <= normalized.endRow &&
    colIndex >= normalized.startCol &&
    colIndex <= normalized.endCol
  );
};

/**
 * Clear all editable cell values inside a grid selection.
 */
export const clearBulkGridSelection = (
  current: BulkTaskDraftRow[],
  selection: BulkGridSelection,
): BulkTaskDraftRow[] => {
  const sel = normalizeBulkGridSelection(selection);

  return current.map((row, rowIndex) => {
    if (rowIndex < sel.startRow || rowIndex > sel.endRow) {
      return row;
    }

    const draft = { ...row };
    for (let colIndex = sel.startCol; colIndex <= sel.endCol; colIndex += 1) {
      const field = bulkDraftFieldOrder[colIndex];
      if (field) {
        draft[field] = "";
      }
    }
    return draft;
  });
};

const applyClipboardCell = (draft: BulkTaskDraftRow, field: keyof BulkTaskDraftRow, cell: ClipboardCell) => {
  if (field === "storyName") {
    draft.storyName = cell.text;
    if (cell.href) {
      draft.storyLink = cell.href;
    }
    return;
  }

  if (field === "storyLink") {
    draft.storyLink = cell.href ?? (looksLikeUrl(cell.text) ? cell.text.trim() : cell.text);
    return;
  }

  draft[field] = cell.text;
};

const applyHyperlinkToStoryFields = (draft: BulkTaskDraftRow, cell: ClipboardCell) => {
  if (!cell.href) {
    return;
  }

  if (cell.text) {
    draft.storyName = cell.text;
  }
  draft.storyLink = cell.href;
};

const ensureRowCount = (rows: BulkTaskDraftRow[], needed: number): BulkTaskDraftRow[] => {
  if (rows.length >= needed) {
    return rows;
  }
  return [...rows, ...createEmptyBulkDraftRows(needed - rows.length)];
};

const isEmptyBulkDraftRow = (row: BulkTaskDraftRow): boolean =>
  !row.storyName &&
  !row.storyLink &&
  !row.beDevsRaw &&
  !row.feDevsRaw &&
  !row.androidDevsRaw &&
  !row.iosDevsRaw &&
  !row.qcsRaw &&
  !row.beHoursRaw &&
  !row.feHoursRaw &&
  !row.androidHoursRaw &&
  !row.iosHoursRaw &&
  !row.mobileAppRaw &&
  !row.qcHoursRaw &&
  !row.productManagersRaw;

const ensureTrailingEmptyRows = (rows: BulkTaskDraftRow[], minEmpty = 2): BulkTaskDraftRow[] => {
  let trailingEmpty = 0;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (!isEmptyBulkDraftRow(rows[index])) {
      break;
    }
    trailingEmpty += 1;
  }

  if (trailingEmpty >= minEmpty) {
    return rows;
  }

  return [...rows, ...createEmptyBulkDraftRows(minEmpty - trailingEmpty)];
};

const applyPasteToSelection = (
  current: BulkTaskDraftRow[],
  table: ClipboardCell[][],
  selection: BulkGridSelection,
): BulkTaskDraftRow[] => {
  const sel = normalizeBulkGridSelection(selection);
  const selRows = sel.endRow - sel.startRow + 1;
  const selCols = sel.endCol - sel.startCol + 1;
  const clipRows = Math.max(table.length, 1);
  const clipCols = Math.max(...table.map((row) => row.length), 1);

  const next = ensureRowCount([...current], sel.endRow + 1);

  for (let rowOffset = 0; rowOffset < selRows; rowOffset += 1) {
    for (let colOffset = 0; colOffset < selCols; colOffset += 1) {
      const clipboardRow = table[rowOffset % clipRows] ?? [];
      const cell = clipboardRow[colOffset % clipCols];
      if (!cell) {
        continue;
      }

      const targetRowIndex = sel.startRow + rowOffset;
      const targetColIndex = sel.startCol + colOffset;
      const field = bulkDraftFieldOrder[targetColIndex];
      if (!field) {
        continue;
      }

      const draft = { ...next[targetRowIndex] };
      applyClipboardCell(draft, field, cell);
      if (cell.href && field !== "storyLink" && !draft.storyLink) {
        applyHyperlinkToStoryFields(draft, cell);
      }
      next[targetRowIndex] = draft;
    }
  }

  return next;
};

/**
 * Apply a parsed clipboard table onto draft rows starting at the focused cell.
 * When multiple cells are selected, paste fills only that range (Excel-style).
 */
export const applyClipboardPasteToDrafts = (
  current: BulkTaskDraftRow[],
  table: ClipboardCell[][],
  anchor: BulkGridAnchor,
  selection?: BulkGridSelection | null,
): BulkTaskDraftRow[] => {
  if (table.length === 0) {
    return current;
  }

  const anchorField = bulkDraftFieldOrder[anchor.colIndex];
  if (!anchorField) {
    return current;
  }

  if (selection && bulkGridSelectionSize(selection) > 1) {
    return applyPasteToSelection(current, table, selection);
  }

  const neededRows = anchor.rowIndex + table.length;
  const next = ensureRowCount([...current], neededRows);

  table.forEach((clipboardRow, rowOffset) => {
    const targetRowIndex = anchor.rowIndex + rowOffset;
    const draft = { ...next[targetRowIndex] };

    clipboardRow.forEach((cell, colOffset) => {
      const field = bulkDraftFieldOrder[anchor.colIndex + colOffset];
      if (!field) {
        return;
      }
      applyClipboardCell(draft, field, cell);
    });

    const linkedStoryCell = clipboardRow.find((cell) => cell.href);
    if (linkedStoryCell && !draft.storyLink) {
      applyHyperlinkToStoryFields(draft, linkedStoryCell);
    }

    next[targetRowIndex] = draft;
  });

  return ensureTrailingEmptyRows(next);
};

const clipboardCellsToStrings = (table: ClipboardCell[][]): string[][] =>
  table.map((row) => row.map((cell) => cell.text));

const parseMobileAppFlag = (raw: string): "none" | "star" | "hubs" => {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "star" || normalized === "star app") return "star";
  if (normalized === "hubs" || normalized === "hubs app" || normalized === "hub") return "hubs";
  return "none";
};

const parseRowCells = (
  cells: string[],
  resourceSets: Map<ResourceType, Set<string>>,
): BulkPasteRow => {
  const colCount = cells.length;
  const storyName = (colCount >= 1 ? cells[0] : "").trim();
  const storyLink = (colCount >= 2 ? cells[1] : "").trim();

  // Current grid (14): Story, Link, BE, BE h, FE, FE h, Android, And h, App, IOS, IOS h, QC, QC h, PM
  // Legacy 13: … QC, QC h (no PM)
  // Legacy 15: … App, Needs iOS, IOS, IOS h, MO start, QC, QC h
  // Legacy 14: … Needs iOS, IOS, IOS h, MO start, QC, QC h
  // Legacy 12: Story, Link, BE, BE h, FE, FE h, Android, And h, IOS, IOS h, QC, QC h
  // 11 cols (legacy MO): Story, Link, BE, BE h, FE, FE h, MO, MO h, MO start, QC, QC h
  // 10 cols (legacy MO): Story, Link, BE, BE h, FE, FE h, MO, MO h, QC, QC h
  // 8 cols: Story, Link, BE, BE h, FE, FE h, QC, QC h
  // 6 cols: Story, Link, BE, FE, MO, QC
  // 5 cols: Story, Link, BE, FE, QC
  const legacyWithFlagAndStart = colCount >= 15;
  const legacyWithFlagStartNoApp = colCount === 14;
  const withAndroidIosApp = colCount === 13;
  const withAndroidIos = colCount === 12;
  const withMoStart = colCount === 11;
  const withMoHours = colCount === 10;
  const interleavedHours = colCount >= 8 && colCount < 10;
  const assigneesWithMo = colCount === 6;

  const beRaw = colCount >= 5 ? cells[2] ?? "" : "";
  let feRaw = "";
  let androidRaw = "";
  let iosRaw = "";
  let qcRaw = "";
  let pmRaw = "";
  let beHours = 0;
  let feHours = 0;
  let androidHours = 0;
  let iosHours = 0;
  let mobileApp: "none" | "star" | "hubs" = "none";
  let qcHours = 0;

  if (legacyWithFlagAndStart) {
    feRaw = cells[4] ?? "";
    androidRaw = cells[6] ?? "";
    mobileApp = parseMobileAppFlag(cells[8] ?? "");
    iosRaw = cells[10] ?? "";
    qcRaw = cells[13] ?? "";
    beHours = parseEstimationHours(cells[3] ?? "");
    feHours = parseEstimationHours(cells[5] ?? "");
    androidHours = parseEstimationHours(cells[7] ?? "");
    iosHours = parseEstimationHours(cells[11] ?? "");
    qcHours = parseEstimationHours(cells[14] ?? "");
  } else if (colCount >= 14 && isCurrentBulkGridPasteRow(cells)) {
    feRaw = cells[4] ?? "";
    androidRaw = cells[6] ?? "";
    mobileApp = parseMobileAppFlag(cells[8] ?? "");
    iosRaw = cells[9] ?? "";
    qcRaw = cells[11] ?? "";
    pmRaw = cells[13] ?? "";
    beHours = parseEstimationHours(cells[3] ?? "");
    feHours = parseEstimationHours(cells[5] ?? "");
    androidHours = parseEstimationHours(cells[7] ?? "");
    iosHours = parseEstimationHours(cells[10] ?? "");
    qcHours = parseEstimationHours(cells[12] ?? "");
  } else if (legacyWithFlagStartNoApp) {
    feRaw = cells[4] ?? "";
    androidRaw = cells[6] ?? "";
    iosRaw = cells[9] ?? "";
    qcRaw = cells[12] ?? "";
    beHours = parseEstimationHours(cells[3] ?? "");
    feHours = parseEstimationHours(cells[5] ?? "");
    androidHours = parseEstimationHours(cells[7] ?? "");
    iosHours = parseEstimationHours(cells[10] ?? "");
    qcHours = parseEstimationHours(cells[13] ?? "");
  } else if (withAndroidIosApp) {
    feRaw = cells[4] ?? "";
    androidRaw = cells[6] ?? "";
    mobileApp = parseMobileAppFlag(cells[8] ?? "");
    iosRaw = cells[9] ?? "";
    qcRaw = cells[11] ?? "";
    beHours = parseEstimationHours(cells[3] ?? "");
    feHours = parseEstimationHours(cells[5] ?? "");
    androidHours = parseEstimationHours(cells[7] ?? "");
    iosHours = parseEstimationHours(cells[10] ?? "");
    qcHours = parseEstimationHours(cells[12] ?? "");
  } else if (withAndroidIos) {
    feRaw = cells[4] ?? "";
    androidRaw = cells[6] ?? "";
    iosRaw = cells[8] ?? "";
    qcRaw = cells[10] ?? "";
    beHours = parseEstimationHours(cells[3] ?? "");
    feHours = parseEstimationHours(cells[5] ?? "");
    androidHours = parseEstimationHours(cells[7] ?? "");
    iosHours = parseEstimationHours(cells[9] ?? "");
    qcHours = parseEstimationHours(cells[11] ?? "");
  } else if (withMoStart) {
    feRaw = cells[4] ?? "";
    androidRaw = cells[6] ?? "";
    qcRaw = cells[9] ?? "";
    beHours = parseEstimationHours(cells[3] ?? "");
    feHours = parseEstimationHours(cells[5] ?? "");
    androidHours = parseEstimationHours(cells[7] ?? "");
    qcHours = parseEstimationHours(cells[10] ?? "");
  } else if (withMoHours) {
    feRaw = cells[4] ?? "";
    androidRaw = cells[6] ?? "";
    qcRaw = cells[8] ?? "";
    beHours = parseEstimationHours(cells[3] ?? "");
    feHours = parseEstimationHours(cells[5] ?? "");
    androidHours = parseEstimationHours(cells[7] ?? "");
    qcHours = parseEstimationHours(cells[9] ?? "");
  } else if (interleavedHours) {
    feRaw = cells[4] ?? "";
    qcRaw = cells[6] ?? "";
    beHours = parseEstimationHours(cells[3] ?? "");
    feHours = parseEstimationHours(cells[5] ?? "");
    qcHours = parseEstimationHours(cells[7] ?? "");
  } else if (assigneesWithMo) {
    feRaw = cells[3] ?? "";
    androidRaw = cells[4] ?? "";
    qcRaw = cells[5] ?? "";
  } else if (colCount >= 5) {
    feRaw = cells[3] ?? "";
    qcRaw = cells[4] ?? "";
  }

  const beKnown = resourceSets.get("BE") ?? new Set<string>();
  const feKnown = resourceSets.get("FE") ?? new Set<string>();
  const moKnown = resourceSets.get("MO") ?? new Set<string>();
  const qcKnown = resourceSets.get("QC") ?? new Set<string>();
  const pmKnown = resourceSets.get("PM") ?? new Set<string>();

  const be = resolveAssignees(beRaw, "BE", "BE", beKnown);
  const fe = resolveAssignees(feRaw, "FE", "FE", feKnown);
  const android = resolveAssignees(androidRaw, "MO", "MO", moKnown);
  const ios = resolveAssignees(iosRaw, "MO", "MO", moKnown);
  const qc = resolveAssignees(qcRaw, "QC", "QC", qcKnown);
  const pm = resolveAssignees(pmRaw, "PM", "PM", pmKnown);

  // IOS cell data (assignees and/or hours) implies Needs iOS — no separate flag column.
  const needsIos = ios.names.length > 0 || iosHours > 0;

  const warnings = [
    ...be.warnings,
    ...fe.warnings,
    ...android.warnings,
    ...ios.warnings,
    ...qc.warnings,
    ...pm.warnings,
  ];
  const isValid = storyName.length > 0 || storyLink.length > 0;

  return {
    storyName,
    storyLink,
    beDevs: be.names,
    feDevs: fe.names,
    androidDevs: android.names,
    iosDevs: needsIos ? ios.names : [],
    qcs: qc.names,
    productManagers: pm.names,
    beHours,
    feHours,
    androidHours,
    iosHours: needsIos ? iosHours : 0,
    needsIos,
    mobileApp,
    // Bulk never sets MO start — dashboard Start overrides; otherwise scheduler uses squad sprint start.
    moStartDate: null,
    qcHours,
    warnings,
    isValid,
  };
};

/**
 * Parse clipboard text copied from Excel or Google Sheets into bulk task rows.
 * Supports 1, 2, 5/6 (assignees), or 8/10/11 (name then hours per role) tab-separated columns per row.
 */
export const parseBulkTaskPaste = (text: string, resources: Resource[]): BulkPasteParseResult =>
  parseBulkTaskPasteFromTable(parseClipboardTable("", text), resources);

export const parseBulkTaskPasteFromTable = (
  table: ClipboardCell[][],
  resources: Resource[],
): BulkPasteParseResult => {
  if (table.length === 0) {
    return { rows: [], skippedEmpty: 0 };
  }

  const resourceSets = buildResourceSets(resources);
  const lineRows = clipboardCellsToStrings(table);
  let skippedEmpty = 0;
  const rows: BulkPasteRow[] = [];

  lineRows.forEach((cells, index) => {
    const allEmpty = cells.every((cell) => !cell.trim());
    if (allEmpty) {
      skippedEmpty += 1;
      return;
    }

    if (index === 0 && isHeaderRow(cells)) {
      return;
    }

    const clipboardRow = table[index] ?? [];
    const parsed = parseRowCells(cells, resourceSets);
    if (clipboardRow[0]?.href) {
      parsed.storyLink = clipboardRow[0].href;
      if (!parsed.storyName && clipboardRow[0].text) {
        parsed.storyName = clipboardRow[0].text;
      }
    }
    if (clipboardRow[1]?.href) {
      parsed.storyLink = clipboardRow[1].href;
    }

    if (!parsed.isValid) {
      skippedEmpty += 1;
      return;
    }

    rows.push(parsed);
  });

  return { rows, skippedEmpty };
};

/**
 * Resolve a single editable spreadsheet row into a validated bulk task row.
 */
export const resolveBulkTaskRow = (draft: BulkTaskDraftRow, resources: Resource[]): BulkPasteRow => {
  const resourceSets = buildResourceSets(resources);
  const parsed = parseRowCells(
    [
      draft.storyName,
      draft.storyLink,
      draft.beDevsRaw,
      draft.beHoursRaw,
      draft.feDevsRaw,
      draft.feHoursRaw,
      draft.androidDevsRaw,
      draft.androidHoursRaw,
      draft.mobileAppRaw,
      draft.iosDevsRaw,
      draft.iosHoursRaw,
      draft.qcsRaw,
      draft.qcHoursRaw,
    ],
    resourceSets,
  );
  const pmKnown = resourceSets.get("PM") ?? new Set<string>();
  const pm = resolveAssignees(draft.productManagersRaw ?? "", "PM", "PM", pmKnown);
  return {
    ...parsed,
    productManagers: pm.names,
    warnings: [...parsed.warnings, ...pm.warnings],
  };
};
