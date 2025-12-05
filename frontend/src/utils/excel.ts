import { utils, writeFile } from "xlsx";

export type ExcelCell = string | number | null | undefined;

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g;
const INVALID_SHEET_CHARS = /[\\/?*\[\]:]/g;

export const sanitizeFileName = (value: string | null | undefined, fallback: string) => {
  if (!value) {
    return fallback;
  }
  const sanitized = value.replace(INVALID_FILENAME_CHARS, "_").trim();
  return sanitized || fallback;
};

export const sanitizeSheetName = (value: string | null | undefined, fallback: string) => {
  if (!value) {
    return fallback;
  }
  const sanitized = value.replace(INVALID_SHEET_CHARS, " ").trim().slice(0, 31);
  return sanitized || fallback;
};

interface ExportToExcelOptions {
  header: string[];
  rows: ExcelCell[][];
  fileName: string;
  sheetName?: string;
}

export const exportToExcel = ({ header, rows, fileName, sheetName }: ExportToExcelOptions) => {
  const worksheet = utils.aoa_to_sheet([header, ...rows]);
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, worksheet, sheetName ?? "Report");
  writeFile(workbook, fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`);
};