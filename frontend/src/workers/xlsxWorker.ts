/// <reference lib="webworker" />

import * as XLSX from "xlsx";
import columnAliasesConfig from "../../../config/excel_column_aliases.json";

type ParseJob = {
  arrayBuffer: ArrayBuffer;
  sheetName?: string;
  hardLimit?: number; // default 5000
};

type WorkerRow = Record<string, unknown>;

const COL_KEYS = [
  "description",
  "part_no",
  "due_on",
  "qty",
  "rate",
  "per",
  "disc_pct",
] as const;

const RAW_COLUMN_ALIASES = columnAliasesConfig as Record<string, string>;

const COLUMN_ALIASES: Record<string, (typeof COL_KEYS)[number]> = {};
Object.entries(RAW_COLUMN_ALIASES).forEach(([key, value]) => {
  if ((COL_KEYS as readonly string[]).includes(value)) {
    COLUMN_ALIASES[normaliseKeyToken(key)] = value as (typeof COL_KEYS)[number];
  }
});

function normaliseKeyToken(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isBlankRow(values: unknown[]): boolean {
  for (const cell of values) {
    if (cell == null) continue;
    if (typeof cell === "string") {
      if (cell.trim()) return false;
    } else {
      return false;
    }
  }
  return true;
}

function buildHeaderMap(values: unknown[]): Record<number, (typeof COL_KEYS)[number]> {
  const headerMap: Record<number, (typeof COL_KEYS)[number]> = {};
  values.forEach((cell, idx) => {
    const alias = COLUMN_ALIASES[normaliseKeyToken(cell)];
    if (alias) headerMap[idx] = alias;
  });
  return headerMap;
}

function buildRecord(
  values: unknown[],
  headerMap: Record<number, (typeof COL_KEYS)[number]> | null,
): WorkerRow {
  const record: WorkerRow = {};
  if (headerMap) {
    for (const [indexStr, key] of Object.entries(headerMap)) {
      const idx = Number(indexStr);
      record[key] = idx < values.length ? values[idx] : null;
    }
  } else {
    for (let idx = 0; idx < COL_KEYS.length; idx += 1) {
      record[COL_KEYS[idx]] = idx < values.length ? values[idx] : null;
    }
  }
  return record;
}

function hasAnyValue(record: WorkerRow): boolean {
  for (const key of COL_KEYS) {
    const value = record[key];
    if (value == null) continue;
    if (typeof value === "string") {
      if (value.trim()) return true;
    } else {
      return true;
    }
  }
  return false;
}

self.onmessage = (event: MessageEvent<ParseJob>) => {
  try {
    const { arrayBuffer, sheetName, hardLimit = 5000 } = event.data;
    const wb = XLSX.read(arrayBuffer, { type: "array", cellDates: true, raw: true });
    const targetSheetName =
      (sheetName && wb.SheetNames.includes(sheetName) ? sheetName : null) ?? wb.SheetNames[0];
    const ws = wb.Sheets[targetSheetName];
    if (!ws) {
      (self as unknown as Worker).postMessage({ ok: true, rows: [], sheetName: targetSheetName });
      return;
    }

    const matrix: unknown[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    });

    const limit = Number.isFinite(hardLimit) && hardLimit > 0 ? Math.min(Math.floor(hardLimit), 5000) : 5000;

    let firstRowIndex = -1;
    for (let idx = 0; idx < matrix.length; idx += 1) {
      const row = matrix[idx];
      if (!Array.isArray(row)) continue;
      if (isBlankRow(row)) continue;
      firstRowIndex = idx;
      break;
    }

    if (firstRowIndex === -1) {
      (self as unknown as Worker).postMessage({ ok: true, rows: [], sheetName: targetSheetName });
      return;
    }

    const headerCandidate = matrix[firstRowIndex] ?? [];
    const headerMap = buildHeaderMap(headerCandidate);
    const hasHeader = Object.keys(headerMap).length >= 3;

    const rows: WorkerRow[] = [];

    if (!hasHeader) {
      const firstRecord = buildRecord(headerCandidate, null);
      if (hasAnyValue(firstRecord)) rows.push(firstRecord);
    }

    for (let idx = firstRowIndex + 1; idx < matrix.length; idx += 1) {
      if (rows.length >= limit) break;
      const row = matrix[idx];
      if (!Array.isArray(row)) continue;
      if (isBlankRow(row)) continue;
      const record = buildRecord(row, hasHeader ? headerMap : null);
      if (hasAnyValue(record)) rows.push(record);
    }

    const constrained = rows.length > limit ? rows.slice(0, limit) : rows;
    (self as unknown as Worker).postMessage({ ok: true, rows: constrained, sheetName: targetSheetName });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to parse Excel";
    (self as unknown as Worker).postMessage({ ok: false, error: message });
  }
};

export default null;