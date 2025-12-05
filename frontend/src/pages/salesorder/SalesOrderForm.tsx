import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { isAxiosError } from "axios";
import {
  createSalesOrder,
  exportSalesOrder,
  getSalesOrder,
  updateSalesOrder,
  uploadSalesOrderItems,
  scanSalesOrderUpload,
  cancelSalesOrder,
  type SalesOrderPayload,
  type SalesOrderResponse,
  type SalesOrderItemPayload,
  type SalesOrderItemResponse,
  type SalesOrderUploadResponse,
} from "../../api/salesorders";
import { extractApiErrorMessage } from "../../api/errors";
import { fetchCompanies } from "../../api/companies";
import type { CompanySuggestion } from "../../api/companies";
import { fetchClients } from "../../api/clients";
import type { ClientSuggestion } from "../../api/clients";
import ItemPickerModal, { type ItemPickerOption } from "../../components/ItemPickerModal";
import { listCurrencies, type Currency } from "../../api/currencies";
import { useAdminTheme } from "../common/useAdminTheme";
import ReasonCell from "../../components/ReasonCell";
import { uploadInBatches } from "../../utils/uploader.ts";
import {
  convertDmyToIso,
  convertIsoToDmy,
  isValidDmyDateString,
} from "../../utils/date";

/** ---------- Types ---------- */
type GoodsRow = {
  id: string;
  line_no: number | null;
  description: string;
  part_no: string;
  due_on: string; // dd-mm-yyyy
  qty: string;    // keep as string to control formatting
  rate: string;
  per: string;
  disc_pct: string;
  prod_qty: number;
  dely_qty: number;
  stock_qty: number;
  reason: string;
};

export type Line = {
  so_sno: number | null;
  so_no?: number;
  so_prod_name: string;
  so_part_no: string;
  so_qty: number;
  prod_qty?: number;
  dely_qty?: number;
  stk_qty?: number;
};

type FormMode = "create" | "edit" | "delete" | "export";
type CurrencyFetchState = "idle" | "loading" | "loaded" | "error";

type SalesOrderHeader = {
  so_voucher_no: string;
  so_voucher_date: string;
  job_ref_no: string;
  order_date: string;
  client_po_no: string;
  company_code: string;
  company_name: string;
  client_code: string;
  client_name: string;
  currency: string;
};

/** ---------- Helpers ---------- */
function buildInitialHeader(
  overrides?: Partial<SalesOrderHeader>,
  options?: { defaultVoucherDate?: boolean },
): SalesOrderHeader {
  const shouldPrefillDate = options?.defaultVoucherDate ?? true;
  const todayIso = shouldPrefillDate ? new Date().toISOString().slice(0, 10) : "";
  const base: SalesOrderHeader = {
    so_voucher_no: "",
    so_voucher_date: todayIso ? normaliseDate(todayIso) : "",
    job_ref_no: "",
    order_date: todayIso,
    client_po_no: "",
    company_code: "",
    company_name: "",
    client_code: "",
    client_name: "",
    currency: "",
  };
  const merged: SalesOrderHeader = { ...base, ...overrides };
  return {
    ...merged,
    so_voucher_date: normaliseDate(merged.so_voucher_date),
  };
}

const COL_KEYS = ["description", "part_no", "due_on", "qty", "rate", "per", "disc_pct"] as const;
type ColKey = typeof COL_KEYS[number];

const LOOKUP_LIMIT = 500;
const VIRTUALIZE_THRESHOLD = 400;
const VIRTUAL_ROW_HEIGHT = 44;
const UPLOAD_BATCH_SIZE = 400;
const UPLOAD_CONCURRENCY = 4;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

type ParsedRecord = Partial<Record<ColKey, unknown>>;

function sanitiseText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
}

function sanitiseNumber(value: unknown) {
  const raw = sanitiseText(value);
  if (!raw) return "";
  const digits = raw.replace(/[^0-9.]/g, "");
  if (!digits) return "";
  const parts = digits.split(".");
  return parts.length > 1 ? parts[0] + "." + parts.slice(1).join("") : parts[0];
}

function normaliseDate(value: unknown) {
  // 1) Values coming directly from XLSX / Excel parsing as JS Date
  if (value instanceof Date) {
    const iso = value.toISOString().slice(0, 10); // yyyy-mm-dd
    return convertIsoToDmy(iso); // dd-mm-yyyy
  }

  // 2) Excel serial date numbers (e.g. 44927 for 2023‑01‑01)
  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel's epoch: 1899‑12‑30 (handles the 1900 leap‑year bug convention)
    const excelEpoch = Date.UTC(1899, 11, 30);
    const millis = excelEpoch + value * 24 * 60 * 60 * 1000;
    const iso = new Date(millis).toISOString().slice(0, 10); // yyyy-mm-dd
    return convertIsoToDmy(iso); // dd-mm-yyyy
  }

  // 3) Fallback: normalise string inputs into dd-mm-yyyy if possible
  const raw = sanitiseText(value);
  if (!raw) return "";

  // Already in dd-mm-yyyy
  if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) return raw;

  // ISO yyyy-mm-dd string from backend / API
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return convertIsoToDmy(raw);

  // Try to interpret things like 04/01/2026, 2026/01/04, 04-01-2026, etc.
  const parts = raw.split(/[/-]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 3) {
    let year = parts.find((p) => p.length === 4) ?? parts[2];
    let month: string;
    let day: string;

    if (parts[0].length === 4) {
      // yyyy-mm-dd or yyyy/mm/dd
      [year, month, day] = parts as [string, string, string];
    } else {
      // dd-mm-yyyy or dd/mm/yyyy
      [day, month] = parts as [string, string, string];
      year = parts[2];
    }

    if (year && month && day) {
      const monthNum = parseInt(month, 10);
      const dayNum = parseInt(day, 10);
      const yearNum = parseInt(year, 10);
      if (
        !Number.isNaN(monthNum) &&
        !Number.isNaN(dayNum) &&
        !Number.isNaN(yearNum) &&
        monthNum >= 1 &&
        monthNum <= 12 &&
        dayNum >= 1 &&
        dayNum <= 31
      ) {
        const isoDate = new Date(yearNum, monthNum - 1, dayNum)
          .toISOString()
          .slice(0, 10);
        return convertIsoToDmy(isoDate); // dd-mm-yyyy
      }
    }
  }

  // If we can't understand it, return the original string as a last resort
  return raw;
}

function sanitiseDateInput(value: string): string {
  const digitsOnly = value.replace(/\D/g, "").slice(0, 8);
  const day = digitsOnly.slice(0, 2);
  const month = digitsOnly.slice(2, 4);
  const year = digitsOnly.slice(4, 8);

  if (digitsOnly.length <= 2) return day;
  if (digitsOnly.length <= 4) return `${day}-${month}`.replace(/-$/, "");
  return `${day}-${month}-${year}`.replace(/-$/, "");
}

function isOpenSalesOrder(response: SalesOrderResponse | null | undefined) {
  const status = sanitiseText(response?.header?.so_status ?? "");
  if (!status) return true;
  return status.toUpperCase() === "O";
}

function buildGoodsRow(record: Partial<Record<ColKey, unknown>>): GoodsRow | null {
  const row: GoodsRow = {
    id: uid(),
    line_no: null,
    description: sanitiseText(record.description),
    part_no: sanitiseText(record.part_no),
    due_on: normaliseDate(record.due_on),
    qty: sanitiseNumber(record.qty),
    rate: sanitiseNumber(record.rate),
    per: sanitiseText(record.per).toUpperCase(),
    disc_pct: sanitiseNumber(record.disc_pct),
    prod_qty: 0,
    dely_qty: 0,
    stock_qty: 0,
    reason: "",
  };
  if (
    !row.description &&
    !row.part_no &&
    !row.due_on &&
    !row.qty &&
    !row.rate &&
    !row.per &&
    !row.disc_pct
  )
    return null;
  return row;
}

function rowsFromUploadResponse(upload: SalesOrderUploadResponse): GoodsRow[] {
  if (!upload?.items?.length) return [];
  const mapped: GoodsRow[] = [];
  for (const item of upload.items) {
    const record: Partial<Record<ColKey, unknown>> = {
      description: item?.description ?? "",
      part_no: item?.part_no ?? "",
      due_on: item?.due_on ?? "",
      qty: item?.qty ?? "",
      rate: item?.rate ?? "",
      per: item?.per ?? "",
      disc_pct: item?.disc_pct ?? "",
    };
    const row = buildGoodsRow(record);
    if (row) mapped.push(row);
  }
  return mapped;
}

const groupKey = (row: GoodsRow) =>
  `${(row.description || "").trim().toUpperCase()}|${(row.part_no || "").trim().toUpperCase()}`;

function hasRowContent(row: GoodsRow): boolean {
  return Boolean(
    (row.description || "").trim() ||
      (row.part_no || "").trim() ||
      (row.due_on || "").trim() ||
      (row.qty || "").trim() ||
      (row.rate || "").trim() ||
      (row.per || "").trim() ||
      (row.disc_pct || "").trim(),
  );
}

function formatReadableList(items: string[]): string {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function templateNameFromFileName(fileName: string): string {
  const trimmed = (fileName || "").trim();
  if (!trimmed) return "";
  const segments = trimmed.split(".");
  if (segments.length <= 1) return trimmed;
  segments.pop();
  const stem = segments.join(".").trim();
  return stem || trimmed;
}

function uid() {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase();
}
function blankRow(): GoodsRow {
  return {
    id: uid(),
    line_no: null,
    description: "",
    part_no: "",
    due_on: "",
    qty: "",
    rate: "",
    per: "",
    disc_pct: "",
    prod_qty: 0,
    dely_qty: 0,
    stock_qty: 0,
    reason: "",
  };
}

function normaliseNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === "AbortError";
  if (typeof error === "object" && error && "code" in error) {
    const maybe = (error as { code?: string }).code;
    return maybe === "ERR_CANCELED";
  }
  return false;
}

function formatQuantity(value: number): string {
  return value.toFixed(2);
}

type ItemRowPair = { item: SalesOrderItemPayload; rowIndex: number };

function buildItemMergeKey(item: SalesOrderItemPayload): string {
  return [
    item.description.trim().toUpperCase(),
    item.part_no.trim().toUpperCase(),
    item.due_on.trim(),
    item.rate.toFixed(2),
    item.per.trim().toUpperCase(),
    item.disc_pct.toFixed(2),
  ].join("|");
}

function mergeDuplicateLineItems(
  pairs: ItemRowPair[],
  rows: GoodsRow[],
): { items: SalesOrderItemPayload[]; rows: GoodsRow[] } {
  if (!pairs.length) return { items: [], rows };

  const groups = new Map<string, { item: SalesOrderItemPayload; rowIndices: number[] }>();
  for (const { item, rowIndex } of pairs) {
    const key = buildItemMergeKey(item);
    const existing = groups.get(key);
    if (existing) {
      existing.rowIndices.push(rowIndex);
      const nextQty = Number((existing.item.qty + item.qty).toFixed(2));
      existing.item.qty = nextQty;
      const lineTotal = nextQty * existing.item.rate;
      const discount = (lineTotal * existing.item.disc_pct) / 100;
      existing.item.amount = Number((lineTotal - discount).toFixed(2));
    } else {
      groups.set(key, { item: { ...item }, rowIndices: [rowIndex] });
    }
  }

  let hasMerges = false;
  for (const group of groups.values()) {
    if (group.rowIndices.length > 1) {
      hasMerges = true;
      break;
    }
  }
  if (!hasMerges) {
    return { items: pairs.map(pair => pair.item), rows };
  }

  const leaderMap = new Map<number, SalesOrderItemPayload>();
  const duplicates = new Set<number>();
  for (const group of groups.values()) {
    const sorted = [...group.rowIndices].sort((a, b) => a - b);
    if (!sorted.length) continue;

    let leaderIndex = sorted[0];
    for (const idx of sorted) {
      const row = rows[idx];
      if (row?.line_no != null) {
        leaderIndex = idx;
        break;
      }
    }

    const leaderRow = rows[leaderIndex];
    if (leaderRow?.line_no != null) {
      group.item.line_no = leaderRow.line_no;
    }

    leaderMap.set(leaderIndex, group.item);
    for (const idx of sorted) {
      if (idx !== leaderIndex) {
        duplicates.add(idx);
      }
    }
  }

  const mergedRows: GoodsRow[] = [];
  const mergedItems: SalesOrderItemPayload[] = [];
  for (let idx = 0; idx < rows.length; idx += 1) {
    if (duplicates.has(idx)) continue;
    const row = rows[idx];
    const leaderItem = leaderMap.get(idx);
    if (leaderItem) {
      mergedRows.push({ ...row, qty: formatQuantity(leaderItem.qty), reason: "" });
      mergedItems.push(leaderItem);
    } else {
      mergedRows.push(row);
    }
  }

  return { items: mergedItems, rows: mergedRows };
}

// eslint-disable-next-line react-refresh/only-export-components
export function validateGroupQty(
  lines: Line[],
  editedIndex: number,
  newQty: number,
): { ok: true } | { ok: false; reason: string } {
  if (!Array.isArray(lines) || editedIndex < 0 || editedIndex >= lines.length) {
    return { ok: true };
  }

  const keyOf = (l: Line) =>
    `${(l.so_prod_name || "").trim().toUpperCase()}|${(l.so_part_no || "").trim().toUpperCase()}`;

  const edited = lines[editedIndex];
  const editedKey = keyOf(edited);
  const safeNewQty = Number.isFinite(newQty) ? newQty : 0;

  const totalAfter = lines.reduce((sum, line, idx) => {
    if (keyOf(line) !== editedKey) return sum;
    const candidate = idx === editedIndex ? safeNewQty : normaliseNumber(line?.so_qty);
    return sum + candidate;
  }, 0);

  const anyRow = lines.find(line => keyOf(line) === editedKey);
  if (!anyRow) return { ok: true };

  const prod = normaliseNumber(anyRow.prod_qty);
  const dely = normaliseNumber(anyRow.dely_qty);
  const stk = normaliseNumber(anyRow.stk_qty);
  const minRequired = Math.max(prod, dely, stk);

  if (totalAfter + 1e-9 < minRequired) {
    const label =
      (edited.so_prod_name || "item") +
      ((edited.so_part_no || "").trim() ? ` / ${edited.so_part_no}` : "");
    return {
      ok: false,
      reason: `Total qty for ${label} would be ${formatQuantity(totalAfter)}, but must be ≥ ${formatQuantity(minRequired)} (Produced ${formatQuantity(prod)}, Delivered ${formatQuantity(dely)}, Stock ${formatQuantity(stk)}).`,
    };
  }

  return { ok: true };
}

// numeric guard (digits + one dot)
function decimalKeyGuard(e: React.KeyboardEvent<HTMLInputElement>, current: string) {
  const allowed = ["Backspace","Delete","Tab","ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","Enter"];
  if (allowed.includes(e.key)) return;
  const isCtrl = e.ctrlKey || e.metaKey;
  if (isCtrl && ["a","c","v","x"].includes(e.key.toLowerCase())) return;
  if (e.key.length === 1) {
    const input = e.currentTarget;
    const s = input.selectionStart ?? input.value.length;
    const t = input.selectionEnd ?? input.value.length;
    const next = current.slice(0, s) + e.key + current.slice(t);
    if (!/^(\d+\.?\d*|\.?\d+)?$/.test(next)) e.preventDefault();
    else if (e.key === "." && current.includes(".") && s === t) e.preventDefault();
  } else e.preventDefault();
}
function decimalPasteGuard(
  e: React.ClipboardEvent<HTMLInputElement>,
  setter: (val: string) => void
) {
  e.preventDefault();
  const text = (e.clipboardData.getData("text") || "").toString();
  const only = (text.match(/[0-9.]/g) || []).join("");
  const parts = only.split(".");
  const sanitized = parts.length > 1 ? parts[0] + "." + parts.slice(1).join("") : parts[0] || "";
  setter(sanitized);
}

/** ---------- Component ---------- */
export default function SalesOrderForm() {
  const navigate = useNavigate();
  const { soVoucherNo, so_voucher_no } = useParams();
  const orderKey = ((soVoucherNo || so_voucher_no) ?? "").trim();
  const initialMode: FormMode = orderKey ? "edit" : "create";
  const [formMode, setFormMode] = useState<FormMode>(initialMode);
  const formModeRef = useRef<FormMode>(initialMode);
  const [activeVoucher, setActiveVoucher] = useState<string>(orderKey);
  const { theme } = useAdminTheme();
  const isDarkTheme = theme === "dark";
  const isCreateMode = formMode === "create";
  const isEditMode = formMode === "edit";
  const isDeleteMode = formMode === "delete";
  const isExportMode = formMode === "export";

  const workerRef = useRef<Worker | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  // Header & rows
  const [header, setHeader] = useState<SalesOrderHeader>(() =>
    buildInitialHeader(undefined, { defaultVoucherDate: initialMode === "create" }),
  );
  const [lastKnownUpdatedAt, setLastKnownUpdatedAt] = useState<string | null>(null);
  const [rows, setRows] = useState<GoodsRow[]>([blankRow()]);
  const [virtualScrollTop, setVirtualScrollTop] = useState(0);
  const [virtualViewportHeight, setVirtualViewportHeight] = useState(0);

  // UI state
  const [loading, setLoading] = useState<boolean>(Boolean(orderKey));
  const [saving, setSaving] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [statusKind, setStatusKind] = useState<"info" | "error" | "success">("info");
  const [voucherExists, setVoucherExists] = useState<boolean>(false);
  const [entryMode, setEntryMode] = useState<"manual" | "upload">("manual");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [cancelUploadFn, setCancelUploadFn] = useState<(() => void) | null>(null);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const exportRequestIdRef = useRef(0);
  const [toast, setToast] = useState<{ message: string; kind: "success" | "error" } | null>(
    null,
  );
  const isReadOnlyMode = isDeleteMode || isExportMode;
  const isLockedMode = isEditMode || isDeleteMode || isExportMode;

  const [companyOptions, setCompanyOptions] = useState<CompanySuggestion[]>([]);
  const [companyLoading, setCompanyLoading] = useState<boolean>(false);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [companyModalOpen, setCompanyModalOpen] = useState<boolean>(false);

  const [clientOptions, setClientOptions] = useState<ClientSuggestion[]>([]);
  const [clientLoading, setClientLoading] = useState<boolean>(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [clientModalOpen, setClientModalOpen] = useState<boolean>(false);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [currencyFetchState, setCurrencyFetchState] = useState<CurrencyFetchState>("idle");
  const [currencyError, setCurrencyError] = useState<string | null>(null);
  const [currencyModalOpen, setCurrencyModalOpen] = useState<boolean>(false);

  // Header refs & enter navigation order
  const refVoucherNo = useRef<HTMLInputElement | null>(null);
  const refVoucherDate = useRef<HTMLInputElement | null>(null);
  const refJob = useRef<HTMLInputElement | null>(null);
  const refCompCode = useRef<HTMLInputElement | null>(null);
  const refClientPO = useRef<HTMLInputElement | null>(null);
  const refClientCode = useRef<HTMLInputElement | null>(null);
  const refCurrency = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const skipPrepareRef = useRef<boolean>(false);
  const suppressNextLoadRef = useRef<boolean>(false);
  
  const headerOrder: Array<React.MutableRefObject<HTMLInputElement | HTMLSelectElement | null>> = [
    refCompCode,
    refClientCode,
    refClientPO,
    refVoucherDate,
    refVoucherNo,
    refJob,
  ];
  const headerIndexes = {
    companyCode: 0,
    clientCode: 1,
    clientPo: 2,
    voucherDate: 3,
    voucherNo: 4,
    jobRef: 5,
  } as const;

  const currencyOptions = useMemo<ItemPickerOption<Currency>[]>(
    () =>
      currencies.map((item) => ({
        id: item.currency_code,
        label: `${item.currency_code} — ${item.currency_name}`,
        value: item,
        searchText: [item.currency_code, item.currency_name]
          .filter(Boolean)
          .join(" "),
      })),
    [currencies],
  );

  const companyPickerOptions = useMemo<ItemPickerOption<CompanySuggestion>[]>(
    () =>
      companyOptions.map((item) => {
        return {
          id: item.comp_code,
          label: `${item.comp_code} — ${item.comp_name}`,
          value: item,
          searchText: [item.comp_code, item.comp_name].filter(Boolean).join(" "),
        } satisfies ItemPickerOption<CompanySuggestion>;
      }),
    [companyOptions],
  );

  const clientPickerOptions = useMemo<ItemPickerOption<ClientSuggestion>[]>(
    () =>
      clientOptions.map((item) => {
        return {
          id: item.client_code,
          label: `${item.client_code} — ${item.client_name}`,
          value: item,
          searchText: [item.client_code, item.client_name].filter(Boolean).join(" "),
        } satisfies ItemPickerOption<ClientSuggestion>;
      }),
    [clientOptions],
  );

  useEffect(() => {
    const worker = new Worker(new URL("../../workers/xlsxWorker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    return () => {
      workerRef.current = null;
      worker.terminate();
    };
  }, []);

  useEffect(() => () => {
    uploadAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    setVirtualViewportHeight(container.clientHeight);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setVirtualViewportHeight(entry.contentRect.height);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const parseExcel = useCallback(
    async (file: File): Promise<{ rows: ParsedRecord[]; sheetName?: string }> => {
      const buffer = await file.arrayBuffer();
      const worker = workerRef.current;
      if (!worker) throw new Error("Excel parser is not ready.");

      return new Promise((resolve, reject) => {
        const handleError = (event: ErrorEvent) => {
          worker.removeEventListener("message", handleMessage as EventListener);
          worker.removeEventListener("error", handleError as EventListener);
          reject(new Error(event.message || "Failed to parse Excel"));
        };

        const handleMessage = (event: MessageEvent<any>) => {
          worker.removeEventListener("message", handleMessage as EventListener);
          worker.removeEventListener("error", handleError as EventListener);
          const payload = event.data;
          if (payload?.ok) {
            resolve({ rows: (payload.rows ?? []) as ParsedRecord[], sheetName: payload.sheetName });
          } else {
            reject(new Error(payload?.error ?? "Failed to parse Excel"));
          }
        };

        worker.addEventListener("message", handleMessage as EventListener);
        worker.addEventListener("error", handleError as EventListener);
        worker.postMessage({ arrayBuffer: buffer, hardLimit: 5000 });
      });
    },
    [],
  );

  const ensureXlsxExtension = useCallback((name: string) => {
    const trimmed = (name || "").trim() || "upload.xlsx";
    if (/\.xls[xm]$/i.test(trimmed)) return trimmed;
    return `${trimmed}.xlsx`;
  }, []);

  const createExcelChunkFile = useCallback(
    async (rows: ParsedRecord[], options: { fileName: string; sheetName?: string }) => {
      const XLSX = await import("xlsx");
      const headerRow = [...COL_KEYS];
      const dataRows = rows.map(record => COL_KEYS.map(key => record[key] ?? null));
      const aoa = [headerRow, ...dataRows];

      const worksheet = XLSX.utils.aoa_to_sheet(aoa);
      const workbook = XLSX.utils.book_new();
      const sheetName = (options.sheetName || "Sheet1").slice(0, 31) || "Sheet1";
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

      const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
      const fileName = ensureXlsxExtension(options.fileName || "upload.xlsx");
      return new File([buffer], fileName, {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
    },
    [ensureXlsxExtension],
  );

  const currencyEmptyMessage =
    currencyFetchState === "loading"
      ? "Loading currencies…"
      : currencyFetchState === "error"
        ? currencyError ?? "Failed to load currencies."
        : "No currencies found";

  const companyEmptyMessage = companyLoading
    ? "Loading companies…"
    : companyError
      ? companyError
      : "No companies found";

  const clientEmptyMessage = clientLoading
    ? "Loading clients…"
    : clientError
      ? clientError
      : "No clients found";

  function focusCurrencyField() {
    const el = refCurrency.current;
    if (el) {
      el.focus();
      el.select?.();
    }
  }

  function focusFirstLineItem() {
    const first = document.querySelector<HTMLInputElement>('input[data-first-desc="1"]');
    first?.focus();
    first?.select?.();
  }

  function openCurrencyPicker() {
    if (isReadOnlyMode) return;
    if (currencyFetchState === "error") {
      setCurrencyFetchState("idle");
    }
    setCurrencyModalOpen(true);
  }

  function closeCurrencyPicker() {
    setCurrencyModalOpen(false);
    if (currencyFetchState === "loading") {
      setCurrencyFetchState("idle");
    }
    setCurrencyError(null);
  }

  function handleCurrencySelect(option: ItemPickerOption<Currency>) {
    const code = option.value.currency_code.toUpperCase();
    setHeaderField("currency", code);
    setCurrencyModalOpen(false);
    window.setTimeout(() => {
      focusCurrencyField();
    }, 0);
  }

  function openCompanyPicker() {
    if (isReadOnlyMode || companyLoading) return;
    setCompanyModalOpen(true);
  }

  function closeCompanyPicker() {
    setCompanyModalOpen(false);
  }

  function clearCompanySelection() {
    setHeader((prev) => ({ ...prev, company_code: "", company_name: "" }));
    window.setTimeout(() => {
      focusHeaderFieldByIndex(headerIndexes.companyCode);
    }, 0);
  }

  function handleCompanySelect(option: ItemPickerOption<CompanySuggestion>) {
    const code = (option.value.comp_code || "").toUpperCase();
    setHeader((prev) => ({
      ...prev,
      company_code: code,
      company_name: option.value.comp_name ?? prev.company_name,
    }));
    setCompanyModalOpen(false);
    window.setTimeout(() => {
      focusHeaderFieldByIndex(headerIndexes.clientCode);
    }, 0);
  }

  function openClientPicker() {
    if (isReadOnlyMode || clientLoading) return;
    setClientModalOpen(true);
  }

  function closeClientPicker() {
    setClientModalOpen(false);
  }

  function clearClientSelection() {
    setHeader((prev) => ({ ...prev, client_code: "", client_name: "" }));
    window.setTimeout(() => {
      focusHeaderFieldByIndex(headerIndexes.clientCode);
    }, 0);
  }

  function handleClientSelect(option: ItemPickerOption<ClientSuggestion>) {
    const code = (option.value.client_code || "").toUpperCase();
    setHeader((prev) => ({
      ...prev,
      client_code: code,
      client_name: option.value.client_name ?? prev.client_name,
    }));
    setClientModalOpen(false);
    window.setTimeout(() => {
      focusHeaderFieldByIndex(headerIndexes.clientPo);
    }, 0);
  }

  function handlePickerInputKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    idx: number,
    openPicker?: () => void,
    onClear?: () => void,
  ) {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      focusHeaderFieldByIndex(idx - 1);
      return;
    }

    if (
      openPicker &&
      (e.key === "Enter" || e.key === " ") &&
      !e.shiftKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      !isLockedMode
    ) {
      e.preventDefault();
      openPicker();
      return;
    }

    if (
      openPicker &&
      e.key === "ArrowDown" &&
      !e.shiftKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      !isLockedMode
    ) {
      e.preventDefault();
      openPicker();
      return;
    }

    if (
      (e.key === "Backspace" || e.key === "Delete") &&
      onClear &&
      !isLockedMode
    ) {
      e.preventDefault();
      onClear();
      return;
    }
  }

  function focusHeaderFieldByIndex(idx: number) {
    if (idx >= 0 && idx < headerOrder.length) {
      const element = headerOrder[idx].current;
      if (element) {
        element.focus();
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          element.select?.();
        }
      }
    } else {
      focusFirstLineItem();
    }
  }

  async function handleVoucherLookup(): Promise<boolean> {
    if (isCreateMode) return false;
    if (isExportMode) {
      return handleExportLookup();
    }
    const targetMode: FormMode = isDeleteMode ? "delete" : "edit";
    return loadSalesOrderRecord(header.so_voucher_no, targetMode);
  }

  async function handleExportLookup(): Promise<boolean> {
    const voucher = header.so_voucher_no.trim();
    if (!voucher) {
      setStatusKind("error");
      setStatusMsg("Please enter a Sales Order No to export.");
      return false;
    }

    const requestId = ++exportRequestIdRef.current;

    function isActiveExportRequest() {
      return formModeRef.current === "export" && exportRequestIdRef.current === requestId;
    }

    try {
      setToast(null);
      setExportBusy(true);
      clearFormBeforeLoad(voucher);
      setStatusKind("info");
      setStatusMsg("Loading Sales Order for export…");
      const data = await getSalesOrder(voucher);
      if (!isActiveExportRequest()) return false;
      applySalesOrderResponse(data);
      const resolvedVoucher = (data.header?.so_voucher_no ?? voucher).trim();
      if (!isActiveExportRequest()) return false;
      setActiveVoucher(resolvedVoucher);
      setStatusKind("info");
      setStatusMsg("Preparing Excel export…");

      const blob = await exportSalesOrder(resolvedVoucher);
      if (!isActiveExportRequest()) return false;
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `SalesOrder_${resolvedVoucher}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

      setStatusKind("success");
      setStatusMsg("Sales Order exported successfully.");
      setToast({ message: "Sales Order exported successfully", kind: "success" });
      return true;
    } catch (error) {
      const message = extractApiErrorMessage(error, "Failed to export Sales Order.");
      setStatusKind("error");
      setStatusMsg(message);
      setToast({ message, kind: "error" });
      return false;
    } finally {
      setExportBusy(false);
    }
  }

  useEffect(() => {
    formModeRef.current = formMode;
    if (formMode !== "export") {
      exportRequestIdRef.current += 1;
    }
  }, [formMode]);

  useEffect(() => {
    if (!isCreateMode || loading) return;
    const timer = window.setTimeout(() => {
      refCompCode.current?.focus();
      refCompCode.current?.select?.();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isCreateMode, loading]);

  useEffect(() => {
    if (isEditMode || isDeleteMode || isExportMode) {
      refVoucherNo.current?.focus();
      refVoucherNo.current?.select?.();
    }
  }, [isEditMode, isDeleteMode, isExportMode]);

  useEffect(() => {
    let cancelled = false;
    setCompanyLoading(true);
    setCompanyError(null);

    (async () => {
      try {
        const { items } = await fetchCompanies({ active: "Y", limit: LOOKUP_LIMIT, offset: 0 });
        if (cancelled) return;
        const mapped: CompanySuggestion[] = (items ?? []).map(item => ({
          comp_code: item.comp_code,
          comp_name: item.comp_name,
          comp_city: item.comp_city ?? undefined,
          comp_state: item.comp_state ?? undefined,
          comp_country: item.comp_country ?? undefined,
          comp_contact_person: item.comp_contact_person ?? undefined,
          comp_email: item.comp_email ?? undefined,
          comp_contact_no: item.comp_contact_no ?? undefined,
        }));
        setCompanyOptions(mapped);
      } catch (error) {
        if (cancelled) return;
        setCompanyOptions([]);
        setCompanyError(extractApiErrorMessage(error, "Failed to load companies."));
      } finally {
        if (!cancelled) {
          setCompanyLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setToast(null);
    }, 3000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    setClientLoading(true);
    setClientError(null);

    (async () => {
      try {
        const { items } = await fetchClients({ active: "Y", limit: LOOKUP_LIMIT, offset: 0 });
        if (cancelled) return;
        const mapped: ClientSuggestion[] = (items ?? []).map(item => ({
          client_code: item.client_code,
          client_name: item.client_name,
          client_city: item.client_city ?? undefined,
          client_state: item.client_state ?? undefined,
          client_country: item.client_country ?? undefined,
          client_contact_person: item.client_contact_person ?? undefined,
          client_email: item.client_email ?? undefined,
          client_contact_no: item.client_contact_no ?? undefined,
        }));
        setClientOptions(mapped);
      } catch (error) {
        if (cancelled) return;
        setClientOptions([]);
        setClientError(extractApiErrorMessage(error, "Failed to load clients."));
      } finally {
        if (!cancelled) {
          setClientLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const code = (header.company_code || "").trim().toUpperCase();
    if (!code) return;
    setCompanyOptions(prev => {
      const existingIdx = prev.findIndex(
        item => (item.comp_code || "").toUpperCase() === code,
      );
      if (existingIdx >= 0) {
        if (header.company_name && prev[existingIdx].comp_name !== header.company_name) {
          const next = [...prev];
          next[existingIdx] = { ...next[existingIdx], comp_name: header.company_name };
          return next;
        }
        return prev;
      }
      return [
        ...prev,
        {
          comp_code: code,
          comp_name: header.company_name || code,
        },
      ];
    });
  }, [header.company_code, header.company_name]);

  useEffect(() => {
    const code = (header.client_code || "").trim().toUpperCase();
    if (!code) return;
    setClientOptions(prev => {
      const existingIdx = prev.findIndex(
        item => (item.client_code || "").toUpperCase() === code,
      );
      if (existingIdx >= 0) {
        if (header.client_name && prev[existingIdx].client_name !== header.client_name) {
          const next = [...prev];
          next[existingIdx] = { ...next[existingIdx], client_name: header.client_name };
          return next;
        }
        return prev;
      }
      return [
        ...prev,
        {
          client_code: code,
          client_name: header.client_name || code,
        },
      ];
    });
  }, [header.client_code, header.client_name]);

  useEffect(() => {
    if (!currencyModalOpen) return;
    if (currencyFetchState !== "idle") return;
    setCurrencyError(null);
    setCurrencyFetchState("loading");
  }, [currencyModalOpen, currencyFetchState]);

  useEffect(() => {
    if (currencyFetchState !== "loading") return;
    let cancelled = false;

    (async () => {
      try {
        const data = await listCurrencies();
        if (cancelled) return;
        setCurrencies(data);
        setCurrencyError(null);
        setCurrencyFetchState("loaded");
      } catch (error) {
        if (cancelled) return;
        setCurrencyError(extractApiErrorMessage(error, "Failed to load currencies."));
        setCurrencyFetchState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currencyFetchState]);

  async function onHeaderEnter(
    e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    idx: number,
  ) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (idx === headerIndexes.voucherNo) {
      if (isEditMode || isDeleteMode) {
        const handled = await handleVoucherLookup();
        if (handled && isEditMode) {
          focusHeaderFieldByIndex(headerIndexes.voucherDate);
        }
        return;
      }
      if (isExportMode) {
        await handleVoucherLookup();
        return;
      }
    }

    if (idx === headerIndexes.voucherDate) {
      const nextIdx = e.shiftKey ? idx - 1 : idx + 1;
      focusHeaderFieldByIndex(nextIdx);
      return;
    }

    const nextIdx = e.shiftKey ? idx - 1 : idx + 1;
    focusHeaderFieldByIndex(nextIdx);
  }

  // Focus map for items grid
  const cellRefs = useRef<Map<string, HTMLInputElement | null>>(new Map());
  const pendingFocus = useRef<{ id?: string; col?: ColKey } | null>(null);
  const refKey = (id: string, col: ColKey) => id + ":" + col;
  const setCellRef = (id: string, col: ColKey, el: HTMLInputElement | null) => {
    const k = refKey(id, col);
    if (el) cellRefs.current.set(k, el);
    else cellRefs.current.delete(k);
  };
  const focusCell = (rowIdx: number, colIdx: number) => {
    const r = rows[rowIdx];
    if (!r) return;
    const el = cellRefs.current.get(refKey(r.id, COL_KEYS[colIdx])) || null;
    if (el) { el.focus(); el.select?.(); }
  };
  useEffect(() => {
    if (pendingFocus.current?.id && pendingFocus.current?.col) {
      const el = cellRefs.current.get(refKey(pendingFocus.current.id, pendingFocus.current.col));
      if (el) { el.focus(); el.select?.(); pendingFocus.current = null; }
    }
  }, [rows]);

  // Load (edit mode)
  function applySalesOrderResponse(data: SalesOrderResponse, options?: { mode?: FormMode }) {
    const headerData = data.header ?? ({} as SalesOrderResponse["header"]);
    const isoVoucherDate = (headerData.so_voucher_date || "").slice(0, 10);
    const isoOrderDate = (headerData.order_date || headerData.so_voucher_date || "").slice(0, 10);
    setHeader(
      buildInitialHeader({
        so_voucher_no: headerData.so_voucher_no ?? "",
        so_voucher_date: isoVoucherDate,
        job_ref_no: (headerData.job_ref_no ?? "").toUpperCase(),
        order_date: isoOrderDate,
        client_po_no: (headerData.client_po_no ?? "").toUpperCase(),
        company_code: (headerData.company_code || "").toUpperCase(),
        company_name: headerData.company_name ?? "",
        client_code: (headerData.client_code || "").toUpperCase(),
        client_name: headerData.client_name ?? "",
        currency: (headerData.currency || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3),
      }),
    );
    setLastKnownUpdatedAt(headerData.updated_at ?? null);

    const loaded: GoodsRow[] = (data.items ?? []).map((it: SalesOrderItemResponse) => ({
      id: uid(),
      line_no: it.line_no ?? null,
      description: it.description ?? "",
      part_no: it.part_no ?? "",
      due_on: normaliseDate(it.due_on),
      qty: it.qty != null ? String(it.qty) : "",
      rate: it.rate != null ? String(it.rate) : "",
      per: (it.per ?? "").toString().toUpperCase(),
      disc_pct: it.disc_pct != null ? String(it.disc_pct) : "",
      prod_qty: typeof it.prod_qty === "number" ? it.prod_qty : 0,
      dely_qty: typeof it.dely_qty === "number" ? it.dely_qty : 0,
      stock_qty: typeof it.stock_qty === "number" ? it.stock_qty : 0,
      reason: "",
    }));
    setRows(loaded.length ? loaded : [blankRow()]);
    setVoucherExists(false);
    setEntryMode("manual");
    if (options?.mode) setFormMode(options.mode);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      if (orderKey) {
        if (suppressNextLoadRef.current) {
          suppressNextLoadRef.current = false;
          return;
        }
        if (formMode === "create") {
          return;
        }
        try {
          clearFormBeforeLoad(orderKey);
          const nextMode: FormMode = isDeleteMode ? "delete" : "edit";
          setLoading(true);
          setStatusKind("info");
          setStatusMsg(
            nextMode === "delete"
              ? "Loading Sales Order for deletion…"
              : "Loading existing Sales Order…",
          );
          const data = await getSalesOrder(orderKey);
          if (!alive) return;
          if (!isOpenSalesOrder(data)) {
            setStatusKind("error");
            setStatusMsg(
              nextMode === "delete"
                ? "Only open Sales Orders can be cancelled."
                : "Only open Sales Orders can be edited.",
            );
            return;
          }
          applySalesOrderResponse(data, { mode: nextMode });
          setActiveVoucher(orderKey);
          setStatusKind(nextMode === "delete" ? "info" : "success");
          setStatusMsg(
            nextMode === "delete"
              ? "Sales Order ready for cancellation."
              : "Sales Order loaded successfully.",
          );
        } catch (error) {
          if (!alive) return;
          setStatusKind("error");
          setStatusMsg(extractApiErrorMessage(error, "Failed to load sales order."));
        } finally {
          if (alive) {
            setLoading(false);
          }
        }
        return;
      }

      if (formMode === "create") {
        await beginCreateMode();
      } else if (formMode === "edit" || formMode === "delete") {
        if (skipPrepareRef.current) {
          skipPrepareRef.current = false;
          return;
        }
        prepareForExistingMode(formMode);
      }
    })();
    return () => {
      alive = false;
    };
  }, [orderKey, formMode, isDeleteMode]);

  useEffect(() => {
    if (!isCreateMode) return;
    const code = header.client_code.trim();
    const voucher = header.so_voucher_no.trim();
    if (!code || !voucher) return;
    const computed = `${code}-${voucher}`;
    setHeader(h => (h.job_ref_no === computed ? h : { ...h, job_ref_no: computed }));
  }, [isCreateMode, header.client_code, header.so_voucher_no]);

  // Uniqueness check (create mode only)
  async function onBlurVoucherNo() {
    if (!isCreateMode) return;
    setVoucherExists(false);
  }

  // Totals
  const totals = useMemo(() => {
    let sub = 0, disc = 0, grand = 0;
    for (const r of rows) {
      const q = parseFloat(r.qty) || 0;
      const rate = parseFloat(r.rate) || 0;
      const d = parseFloat(r.disc_pct) || 0;
      const line = q * rate;
      const lineDisc = (line * d) / 100;
      sub += line; disc += lineDisc; grand += (line - lineDisc);
    }
    return { sub, disc, grand };
  }, [rows]);

  const shouldVirtualize = rows.length > VIRTUALIZE_THRESHOLD;
  const effectiveViewport = virtualViewportHeight || scrollContainerRef.current?.clientHeight || 320;
  const overscan = 6;
  const startIndex = shouldVirtualize
    ? Math.max(0, Math.floor(virtualScrollTop / VIRTUAL_ROW_HEIGHT) - overscan)
    : 0;
  const endIndex = shouldVirtualize
    ? Math.min(
        rows.length,
        Math.ceil((virtualScrollTop + effectiveViewport) / VIRTUAL_ROW_HEIGHT) + overscan,
      )
    : rows.length;
  const visibleRows = shouldVirtualize ? rows.slice(startIndex, endIndex) : rows;
  const topPadding = shouldVirtualize ? startIndex * VIRTUAL_ROW_HEIGHT : 0;
  const bottomPadding = shouldVirtualize
    ? Math.max(0, rows.length * VIRTUAL_ROW_HEIGHT - topPadding - visibleRows.length * VIRTUAL_ROW_HEIGHT)
    : 0;

  useEffect(() => {
    if (!shouldVirtualize) {
      setVirtualScrollTop(0);
      scrollContainerRef.current?.scrollTo?.({ top: 0 });
    }
  }, [shouldVirtualize]);

  const handleVirtualScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!shouldVirtualize) return;
      setVirtualScrollTop(event.currentTarget.scrollTop);
    },
    [shouldVirtualize],
  );

  const canSave =
    !saving &&
    !deleting &&
    !isDeleteMode &&
    !isExportMode &&
    header.so_voucher_date.trim() &&
    header.company_code.trim() &&
    header.company_name.trim() &&
    header.client_code.trim() &&
    header.client_name.trim() &&
    header.client_po_no.trim() &&
    header.currency.trim() &&
    !voucherExists &&
    rows.some(r => (parseFloat(r.qty) || 0) > 0);

  const saveDisabledReason = useMemo(() => {
    if (canSave || saving || deleting || loading || isDeleteMode || isExportMode) {
      return "";
    }

    const missing: string[] = [];
    const require = (value: string) => value.trim().length > 0;

    if (!require(header.so_voucher_date)) missing.push("Sales Order Date");
    if (!require(header.company_code) || !require(header.company_name)) missing.push("Company details");
    if (!require(header.client_code) || !require(header.client_name)) missing.push("Client details");
    if (!require(header.client_po_no)) missing.push("Client PO No");
    if (!require(header.currency)) missing.push("Currency");

    if (missing.length) {
      const formatted = formatReadableList(missing);
      const suffix = missing.length > 1 ? "s" : "";
      return `Fill in the required field${suffix}: ${formatted}.`;
    }

    if (voucherExists) {
      return "This Sales Order number already exists. Choose a different number or load the existing order.";
    }

    if (!rows.some(r => (parseFloat(r.qty) || 0) > 0)) {
      return "Add at least one line item with a quantity greater than zero.";
    }

    return "";
  }, [
    canSave,
    saving,
    deleting,
    loading,
    isDeleteMode,
    isExportMode,
    header,
    voucherExists,
    rows,
  ]);

  // basic setters
  function setHeaderField<K extends keyof SalesOrderHeader>(key: K, val: SalesOrderHeader[K]) {
    setHeader(h => ({ ...h, [key]: val }));
  }
  function setRowField(
    id: string,
    patch: Partial<GoodsRow>,
    options?: { preserveReason?: boolean },
  ) {
    setRows(arr =>
      arr.map(r => {
        if (r.id !== id) return r;
        const next: GoodsRow = { ...r, ...patch };
        if (!options?.preserveReason && !("reason" in patch)) {
          next.reason = "";
        }
        return next;
      }),
    );
  }

  async function beginCreateMode(options?: { quiet?: boolean }) {
    setFormMode("create");
    setActiveVoucher("");
    setEntryMode("manual");
    setVoucherExists(false);
    setLastKnownUpdatedAt(null);

    setHeader(
      buildInitialHeader({
        so_voucher_no: "",
        so_voucher_date: "",
        order_date: "",
      }),
    );
    setRows([blankRow()]);
    if (!options?.quiet) {
      setStatusKind("info");
      setStatusMsg("Enter Sales Order details. Sales Order No will be auto-generated on save.");
    }
    window.setTimeout(() => {
      refCompCode.current?.focus();
      refCompCode.current?.select?.();
    }, 0);
  }

  const handleVoucherDateInputChange = useCallback(
    (rawValue: string) => {
      if (isEditMode || isDeleteMode || isExportMode) return;
      const sanitized = sanitiseDateInput(rawValue);
      const trimmed = sanitized.trim();
      const isoValue = convertDmyToIso(trimmed);

      setHeader((prev) => ({
        ...prev,
        so_voucher_date: sanitized,
        order_date: isoValue || prev.order_date,
      }));
    },
    [
      header.order_date,
      isDeleteMode,
      isEditMode,
      isExportMode,
    ],
  );

  function prepareForExistingMode(targetMode: FormMode, options?: { preserveStatus?: boolean }) {
    setFormMode(targetMode);
    setActiveVoucher("");
    setHeader(buildInitialHeader(undefined, { defaultVoucherDate: targetMode === "create" }));
    setRows([blankRow()]);
    setVoucherExists(false);
    setEntryMode("manual");
    setExportBusy(false);
    if (targetMode !== "export") {
      setToast(null);
    }
    if (!options?.preserveStatus) {
      const message =
        targetMode === "delete"
          ? "Enter a Sales Order / Voucher number to load for deletion."
          : targetMode === "export"
            ? "Enter a Sales Order No to export."
            : "Enter a Sales Order / Voucher number to load.";
      setStatusKind("info");
      setStatusMsg(message);
    }
    window.setTimeout(() => {
      refVoucherNo.current?.focus();
      refVoucherNo.current?.select?.();
    }, 0);
  }

  function clearFormBeforeLoad(voucherValue: string) {
    const trimmed = (voucherValue || "").trim();
    setActiveVoucher("");
    setLastKnownUpdatedAt(null);
    setHeader(
      buildInitialHeader(trimmed ? { so_voucher_no: trimmed } : undefined, {
        defaultVoucherDate: false,
      }),
    );
    setRows([blankRow()]);
    setEntryMode("manual");
    setVoucherExists(false);
    scrollContainerRef.current?.scrollTo?.({ top: 0 });
    setVirtualScrollTop(0);
  }

  async function loadSalesOrderRecord(
    voucher: string,
    targetMode: FormMode,
    options?: { updateUrl?: boolean },
  ): Promise<boolean> {
    const value = (voucher || "").trim();
    if (!value) {
      setStatusKind("error");
      setStatusMsg("Please enter a Sales Order / Voucher number.");
      return false;
    }

    try {
      clearFormBeforeLoad(value);
      setLoading(true);
      setStatusKind("info");
      setStatusMsg(
        targetMode === "delete"
          ? "Loading Sales Order for deletion…"
          : "Loading existing Sales Order…",
      );
      const data = await getSalesOrder(value);
      const operationMode: FormMode = targetMode === "delete" ? "delete" : "edit";
      if (!isOpenSalesOrder(data)) {
        setStatusKind("error");
        setStatusMsg(
          operationMode === "delete"
            ? "Only open Sales Orders can be cancelled."
            : "Only open Sales Orders can be edited.",
        );
        return false;
      }
      applySalesOrderResponse(data, { mode: operationMode });
      setActiveVoucher(value);
      setVoucherExists(false);
      setStatusKind(operationMode === "delete" ? "info" : "success");
      setStatusMsg(
        operationMode === "delete"
          ? "Sales Order ready for cancellation."
          : "Sales Order loaded successfully.",
      );
      if (options?.updateUrl !== false) {
        navigate(`/salesorder/${encodeURIComponent(value)}`, { replace: true });
      }
      return true;
    } catch (error) {
      setStatusKind("error");
      setStatusMsg(extractApiErrorMessage(error, "Failed to load sales order."));
      return false;
    } finally {
      setLoading(false);
    }
  }

  function activateMode(nextMode: FormMode) {
    if (nextMode === "create") {
      navigate("/salesorder", { replace: true });
      setFormMode("create");
      setExportBusy(false);
      setToast(null);
      return;
    }

    suppressNextLoadRef.current = true;
    navigate("/salesorder", { replace: true });
    prepareForExistingMode(nextMode);
  }
  function addRowBelow(idx: number) {
    const newR = blankRow();
    setRows(arr => { const copy = [...arr]; copy.splice(idx + 1, 0, newR); return copy; });
    pendingFocus.current = { id: newR.id, col: "description" };
  }
  function buildValidationLines(source: GoodsRow[]): Line[] {
    const voucherNumber = Number(header.so_voucher_no ?? 0);
    return source.map(item => ({
      so_sno: item.line_no,
      so_no: Number.isFinite(voucherNumber) ? voucherNumber : 0,
      so_prod_name: item.description,
      so_part_no: item.part_no,
      so_qty: Number.parseFloat(item.qty) || 0,
      prod_qty: item.prod_qty,
      dely_qty: item.dely_qty,
      stk_qty: item.stock_qty,
    }));
  }

  function deleteRow(id: string) {
    setRows(arr => {
      const index = arr.findIndex(r => r.id === id);
      if (index === -1) return arr;

      const lines = buildValidationLines(arr);
      const check = validateGroupQty(lines, index, 0);
      if (!check.ok) {
        return arr.map((row, rowIdx) =>
          rowIdx === index ? { ...row, reason: check.reason } : row,
        );
      }

      const next = arr.filter((_, rowIdx) => rowIdx !== index);
      return next.length ? next : [blankRow()];
    });
  }

  function updateRowQuantity(id: string, value: string) {
    setRows(arr => {
      const index = arr.findIndex(r => r.id === id);
      if (index === -1) return arr;

      const numeric = Number.parseFloat(value);
      const newQty = Number.isFinite(numeric) ? numeric : 0;
      const lines = buildValidationLines(arr);
      const check = validateGroupQty(lines, index, newQty);
      if (!check.ok) {
        return arr.map((row, rowIdx) =>
          rowIdx === index ? { ...row, reason: check.reason } : row,
        );
      }

      const target = arr[index];
      const targetKey = target ? groupKey(target) : "";
      return arr.map((row, rowIdx) => {
        if (rowIdx === index) {
          return { ...row, qty: value, reason: "" };
        }
        if (targetKey && groupKey(row) === targetKey && row.reason) {
          return { ...row, reason: "" };
        }
        return row;
      });
    });
  }

  function handleUploadButtonClick() {
    if (entryMode !== "upload") {
      setStatusKind("info");
      setStatusMsg("Switch to \"Upload from Excel\" mode to import line items.");
      return;
    }
    if (uploadBusy) {
      setStatusKind("info");
      setStatusMsg("Upload is already in progress. Please wait for it to finish or cancel it.");
      return;
    }
    fileInputRef.current?.click();
  }

  async function handleExcelUpload(file: File) {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setStatusKind("error");
      setStatusMsg("File is too large. Max allowed size is 5 MB.");
      return;
    }

    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setCancelUploadFn(() => () => controller.abort());

    setUploadBusy(true);
    setUploadProgress("Preparing upload…");
    const fileLabel = (file.name || "uploaded file").trim() || "uploaded file";
    const templateName = templateNameFromFileName(file.name);

    let filteredRecords: ParsedRecord[] = [];
    let previewRows: GoodsRow[] = [];

    const applyRows = (nextRows: GoodsRow[], options?: { append?: boolean }) => {
      const safeRows = nextRows.length ? nextRows : [blankRow()];
      let focusTarget: { id: string; col: ColKey } | null = null;

      setRows(prev => {
        const target = safeRows[0];
        focusTarget = target ? { id: target.id, col: "description" } : null;

        if (!options?.append) {
          return safeRows;
        }

        const retained = prev.filter(row => {
          if (row.line_no != null) return true;
          return hasRowContent(row);
        });

        const combined = [...retained, ...safeRows];
        return combined.length ? combined : [blankRow()];
      });

      if (!options?.append) {
        scrollContainerRef.current?.scrollTo?.({ top: 0 });
        setVirtualScrollTop(0);
      }

      pendingFocus.current = focusTarget;
    };

    const applyRowErrors = (
      rowErrors: { row_index?: number; message?: string }[],
      offset = 0,
    ) => {
      if (!Array.isArray(rowErrors) || !previewRows.length) return false;
      setRows(() => {
        const next = previewRows.map(row => ({ ...row }));
        for (const entry of rowErrors) {
          const idx = Number(entry?.row_index ?? Number.NaN);
          if (!Number.isFinite(idx)) continue;
          const candidates = [idx + offset, idx - 1 + offset];
          const targetIndex = candidates.find(candidate => candidate >= 0 && candidate < next.length);
          if (targetIndex == null) continue;
          next[targetIndex] = { ...next[targetIndex], reason: entry?.message ?? "" };
        }
        return next.length ? next : [blankRow()];
      });
      return true;
    };

    const applyRowErrorsFromError = (error: unknown, offset = 0) => {
      if (!isAxiosError(error)) return false;
      const rowErrors = (error.response?.data as { row_errors?: { row_index?: number; message?: string }[] } | undefined)
        ?.row_errors;
      if (Array.isArray(rowErrors)) {
        return applyRowErrors(rowErrors, offset);
      }
      return false;
    };

    try {
      setStatusKind("info");
      setStatusMsg(`Scanning ${fileLabel}…`);

      const scanResult = await scanSalesOrderUpload(file, { signal: controller.signal });
      if (scanResult.status !== "clean") {
        setStatusKind("error");
        setStatusMsg(scanResult.detail || "The uploaded file failed security checks.");
        setUploadProgress("Upload blocked.");
        return;
      }

      setStatusKind("info");
      setStatusMsg(`Parsing ${fileLabel}…`);

      const parsed = await parseExcel(file);
      const parsedRecords = parsed.rows ?? [];
      if (!parsedRecords.length) {
        throw new Error("No line items were found in the selected sheet.");
      }

      for (const record of parsedRecords) {
        const row = buildGoodsRow(record);
        if (row) {
          filteredRecords.push(record);
          previewRows.push(row);
        }
      }

      if (!previewRows.length) {
        throw new Error("No line items were found in the selected sheet.");
      }

      const sheetLabel = (parsed.sheetName || "").trim();
      const sheetFragment = sheetLabel ? ` (sheet "${sheetLabel}")` : "";
      if (!filteredRecords.length) {
        applyRows(previewRows, { append: isEditMode });
        setStatusKind("success");
        setStatusMsg(
          `${previewRows.length} line item${previewRows.length === 1 ? "" : "s"} loaded from ${fileLabel}${sheetFragment}.`,
        );
        setUploadProgress("Upload complete.");
        return;
      }

      setStatusKind("info");
      setStatusMsg(
        `${previewRows.length} line item${previewRows.length === 1 ? "" : "s"} parsed from ${fileLabel}${sheetFragment}. Validating with server…`,
      );

      const chunkCount = Math.ceil(filteredRecords.length / UPLOAD_BATCH_SIZE) || 1;
      const chunkResults: GoodsRow[][] = new Array(chunkCount);
      let finalFileName = fileLabel;
      let finalSheetName = sheetLabel;

      setUploadProgress(`Uploading 0/${filteredRecords.length}…`);

      await uploadInBatches(filteredRecords, {
        bulk: async (chunk: ParsedRecord[], index: number) => {
          try {
            const excelFile = await createExcelChunkFile(chunk, {
              fileName: templateName || fileLabel,
              sheetName: sheetLabel || undefined,
            });
            const response = await uploadSalesOrderItems(excelFile, { signal: controller.signal });
            chunkResults[index] = rowsFromUploadResponse(response);
            if (response.file_name) finalFileName = response.file_name.trim() || finalFileName;
            if (response.sheet_name) finalSheetName = response.sheet_name.trim() || finalSheetName;
          } catch (error) {
            applyRowErrorsFromError(error, index * UPLOAD_BATCH_SIZE);
            throw error;
          }
        },
        batchSize: UPLOAD_BATCH_SIZE,
        concurrency: Math.min(UPLOAD_CONCURRENCY, Math.max(1, chunkCount)),
        onProgress: (done: number, total: number) => {
          setUploadProgress(`Uploading ${done}/${total}…`);
        },
        signal: controller.signal,
      });

      const merged = chunkResults.flat().filter(Boolean);
      const finalRows = merged.length ? merged : previewRows;
      applyRows(finalRows, { append: isEditMode });

      const finalSheetFragment = finalSheetName ? ` (sheet "${finalSheetName}")` : "";
      setStatusKind("success");
      setStatusMsg(
        `${finalRows.length} line item${finalRows.length === 1 ? "" : "s"} loaded from ${finalFileName}${finalSheetFragment}.`,
      );
      setUploadProgress("Upload complete.");
    } catch (error) {
      if (isAbortError(error)) {
        setStatusKind("info");
        setStatusMsg("Upload cancelled.");
        setUploadProgress("Upload cancelled.");
      } else if (isAxiosError(error)) {
        const detail = (error.response?.data as { detail?: string } | undefined)?.detail?.toString?.();
        const rowErrorsApplied = applyRowErrorsFromError(error);
        if (detail && /sheet is not registered/i.test(detail)) {
          setStatusKind("error");
          setStatusMsg("The selected sheet is not registered for upload.");
        } else if (detail && /file is not registered/i.test(detail)) {
          setStatusKind("error");
          setStatusMsg("This file is not registered. Please upload a valid Sales Order Excel file.");
        } else if (rowErrorsApplied) {
          setStatusKind("error");
          setStatusMsg(detail || "Validation errors in uploaded Excel.");
        } else {
          setStatusKind("error");
          setStatusMsg(extractApiErrorMessage(error, "Failed to import line items."));
        }
        setUploadProgress("Upload failed.");
      } else if (error instanceof Error) {
        setStatusKind("error");
        setStatusMsg(error.message);
        setUploadProgress("Upload failed.");
      } else {
        setStatusKind("error");
        setStatusMsg("Failed to import line items.");
        setUploadProgress("Upload failed.");
      }
      uploadAbortRef.current?.abort();
    } finally {
      uploadAbortRef.current = null;
      setCancelUploadFn(null);
      setUploadBusy(false);
    }
  }

  async function onUploadFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      e.target.value = "";
      return;
    }
    if (uploadBusy) {
      setStatusKind("info");
      setStatusMsg("An upload is already in progress. Please wait or cancel the current upload.");
      e.target.value = "";
      return;
    }
    try {
      await handleExcelUpload(file);
    } finally {
      e.target.value = "";
    }
  }
  function resetForm(options?: { preserveStatus?: boolean }) {
    if (!options?.preserveStatus) {
      setStatusMsg("");
      setStatusKind("info");
    }
    if (isCreateMode) {
      void beginCreateMode({ quiet: options?.preserveStatus });
    } else if (isEditMode || isDeleteMode || isExportMode) {
      prepareForExistingMode(formMode);
    }
  }

  function onClearForm() {
    resetForm();
  }

  async function handleCancelSalesOrder() {
    if (!isDeleteMode) return;
    const blocking = rows.filter(r => r.prod_qty > 0 || r.dely_qty > 0 || r.stock_qty > 0);
    if (blocking.length) {
      setRows(arr =>
        arr.map(r =>
          r.prod_qty > 0 || r.dely_qty > 0 || r.stock_qty > 0
            ? { ...r, reason: "Cannot delete. Dependent transactions exist." }
            : r,
        ),
      );
      setStatusKind("error");
      setStatusMsg("Cannot delete Sales Order. Dependent transactions exist.");
      return;
    }

    const voucher = header.so_voucher_no.trim() || activeVoucher;
    if (!voucher) {
      setStatusKind("error");
      setStatusMsg("Enter a Sales Order / Voucher number to delete.");
      return;
    }

    try {
      setDeleting(true);
      setStatusKind("info");
      setStatusMsg("Cancelling Sales Order…");
      await cancelSalesOrder(voucher, { expected_updated_at: lastKnownUpdatedAt });
      setStatusKind("success");
      setStatusMsg("Sales Order cancelled successfully.");
      navigate("/salesorder", { replace: true });
      skipPrepareRef.current = true;
      prepareForExistingMode("delete", { preserveStatus: true });
    } catch (error) {
      const message = extractApiErrorMessage(error, "Failed to cancel Sales Order.");
      if (isAxiosError(error) && error.response?.status === 409) {
        setStatusKind("error");
        setStatusMsg(
          "This Sales Order was updated by someone else. Please reload and try again.",
        );
        setToast({ message, kind: "error" });
        return;
      }
      setStatusKind("error");
      setStatusMsg(message);
    } finally {
      setDeleting(false);
    }
  }

  function handleEntryModeSelect(mode: "manual" | "upload") {
    if (isReadOnlyMode) return;
    setEntryMode(mode);
    if (mode === "manual" && statusKind === "info") {
      setStatusMsg("");
    }
  }

  // Items: Enter navigation
  function handleCellEnter(e: React.KeyboardEvent<HTMLInputElement>, rowIdx: number, colIdx: number) {
    if (e.key === "Escape") {
      e.preventDefault();
      focusCurrencyField();
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();

    if (e.shiftKey) {
      if (colIdx > 0) focusCell(rowIdx, colIdx - 1);
      else if (rowIdx > 0) focusCell(rowIdx - 1, COL_KEYS.length - 1);
      return;
    }

    if (colIdx < COL_KEYS.length - 1) {
      focusCell(rowIdx, colIdx + 1);
    } else {
      if (rowIdx < rows.length - 1) focusCell(rowIdx + 1, 0);
      else addRowBelow(rowIdx);
    }
  }

  // Submit
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    const trimmedVoucherDate = header.so_voucher_date.trim();
    const voucherDateIso = convertDmyToIso(trimmedVoucherDate);
    const existingOrderDate = (header.order_date || "").trim();
    const orderDateIso =
      existingOrderDate && /^\d{4}-\d{2}-\d{2}$/.test(existingOrderDate)
        ? existingOrderDate
        : voucherDateIso;

    const items: SalesOrderItemPayload[] = [];
    const itemRowPairs: ItemRowPair[] = [];
    let hasRowErrors = false;
    const validatedRows: GoodsRow[] = rows.map((row, rowIndex) => {
      const description = row.description.trim();
      const partNo = row.part_no.trim();
      const dueOn = row.due_on.trim();
      const dueOnIso = dueOn ? convertDmyToIso(dueOn) : "";
      const per = row.per.trim();
      const qtyRaw = Number.parseFloat(row.qty) || 0;
      const rateRaw = Number.parseFloat(row.rate) || 0;
      const discRaw = Number.parseFloat(row.disc_pct) || 0;
      const hasContent =
        !!description ||
        !!partNo ||
        !!dueOn ||
        !!per ||
        qtyRaw > 0 ||
        rateRaw > 0 ||
        discRaw > 0;

      if (!hasContent) {
        return { ...row, reason: "" };
      }

      let reason = "";
      if (!description) reason = "Description is required.";
      else if (!partNo) reason = "Part number is required.";
      else if (!dueOn || !isValidDmyDateString(dueOn) || !dueOnIso)
        reason = "Due date is required (dd-mm-yyyy).";
      else if (orderDateIso && dueOnIso < orderDateIso)
        reason = "Due date cannot be earlier than Sales Order Date.";
      else if (!per) reason = "Unit is required.";
      else if (qtyRaw <= 0) reason = "Quantity must be greater than zero.";
      else if (rateRaw <= 0) reason = "Rate must be greater than zero.";
      else if (discRaw < 0 || discRaw > 100) reason = "Discount % must be between 0 and 100.";
      else {
        const qty = Number(qtyRaw.toFixed(2));
        const rate = Number(rateRaw.toFixed(2));
        const disc_pct = Number(discRaw.toFixed(2));
        const lineTotal = qty * rate;
        const discount = (lineTotal * disc_pct) / 100;
        const amount = Number((lineTotal - discount).toFixed(2));
        if (amount <= 0) {
          reason = "Amount must be greater than zero after discount.";
        } else {
          const item: SalesOrderItemPayload = {
            line_no: row.line_no ?? undefined,
            description,
            part_no: partNo,
            due_on: dueOnIso,
            qty,
            rate,
            per: per.toUpperCase(),
            disc_pct,
            amount,
          };
          items.push(item);
          itemRowPairs.push({ item, rowIndex });
        }
      }

      if (reason) {
        hasRowErrors = true;
        return { ...row, reason };
      }
      return { ...row, reason: "" };
    });

    let finalItems = items;
    let finalRows = validatedRows;

    if (!hasRowErrors) {
      const merged = mergeDuplicateLineItems(itemRowPairs, validatedRows);
      finalItems = merged.items;
      finalRows = merged.rows;
    }

    setRows(hasRowErrors ? validatedRows : finalRows);

    if (hasRowErrors) {
      setStatusKind("error");
      setStatusMsg("Fix validation errors before saving the Sales Order.");
      return;
    }

    if (!finalItems.length) {
      setStatusKind("error");
      setStatusMsg("Add at least one valid line item before saving.");
      return;
    }

    const companyCode = header.company_code.trim().toUpperCase();
    const clientCode = header.client_code.trim().toUpperCase();
    const currency = header.currency.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);

    if (!currency) {
      setStatusKind("error");
      setStatusMsg("Currency is required.");
      focusCurrencyField();
      return;
    }

    if (!voucherDateIso) {
      setStatusKind("error");
      setStatusMsg("Enter a valid Sales Order Date (dd-mm-yyyy).");
      refVoucherDate.current?.focus();
      return;
    }

    const trimmedVoucherNo = header.so_voucher_no.trim();
    const trimmedJobRef = header.job_ref_no.trim();

    const payload: SalesOrderPayload = {
      header: {
        so_voucher_no: trimmedVoucherNo || undefined,
        so_voucher_date: voucherDateIso,
        job_ref_no: trimmedJobRef || undefined,
        order_date: orderDateIso || undefined,
        client_po_no: header.client_po_no.trim(),
        company_code: companyCode,
        company_name: header.company_name.trim(),
        client_code: clientCode,
        client_name: header.client_name.trim(),
        currency,
      },
      items: finalItems,
      expected_updated_at: lastKnownUpdatedAt,
    };

    const voucherNo = trimmedVoucherNo;
    try {
      setSaving(true);
      setStatusMsg("");
      const response = isEditMode
        ? await updateSalesOrder(activeVoucher || voucherNo, payload)
        : await createSalesOrder(payload);
      setLastKnownUpdatedAt(response?.header?.updated_at ?? null);
      const savedVoucher = (response?.header?.so_voucher_no ?? voucherNo).trim();
      const successMessage = savedVoucher
        ? `Sales Order ${savedVoucher} saved successfully.`
        : "Sales Order saved successfully.";

      const toastMessage = isEditMode
        ? successMessage
        : savedVoucher
          ? `Sales Order ${savedVoucher} created successfully.`
          : "Sales Order created successfully.";
      setToast({ message: toastMessage, kind: "success" });

      if (isEditMode) {
        setStatusKind("success");
        setStatusMsg(successMessage);
        prepareForExistingMode("edit", { preserveStatus: true });
      } else {
        setStatusKind("success");
        setStatusMsg(successMessage);
        await beginCreateMode({ quiet: true });
      }
    } catch (error) {
      const message = extractApiErrorMessage(error, "Failed to save Sales Order.");
      if (isAxiosError(error) && error.response?.status === 409) {
        setStatusKind("error");
        setStatusMsg(
          "This Sales Order was updated by someone else. Please reload and try again.",
        );
        setToast({ message, kind: "error" });
        return;
      }
      setStatusKind("error");
      setStatusMsg(message);
    } finally {
      setSaving(false);
    }
  }

  // ---- Styles (professional look, no header grid lines) ----
  const pageWrapperStyle: React.CSSProperties = {
    width: "100%",
    display: "flex",
    justifyContent: "center",
    boxSizing: "border-box",
    padding: "0 12px 28px",
  };
  const formStyle: React.CSSProperties = {
    display: "grid",
    gap: 16,
    position: "relative",
    width: "min(1180px, 100%)",
    minWidth: 0,
  };
  const sectionFieldsetStyle: React.CSSProperties = {
    border: "1px solid var(--admin-card-border)",
    borderRadius: 12,
    padding: 12,
    background: "var(--admin-card-bg)",
    boxShadow: "inset 0 1px 0 var(--admin-card-inset)",
    backdropFilter: "blur(3px)",
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
  };
  const fieldsetLegendStyle: React.CSSProperties = {
    padding: "0 12px",
    fontWeight: 700,
    fontSize: 14,
    lineHeight: "24px",
    borderRadius: 999,
    background: "var(--admin-section-bg)",
    color: "var(--admin-label-text)",
    boxShadow: "0 6px 14px rgba(15,23,42,0.18)",
  };
  const HEADER_LABEL_WIDTH = 150;
  const headerTableStyle: React.CSSProperties = {
    display: "table",
    borderCollapse: "separate",
    borderSpacing: "8px 4px",
    width: "100%",
    color: "var(--admin-table-text, #1e293b)",
  };
  const headerLabelStyle: React.CSSProperties = {
    display: "table-cell",
    padding: "0 6px 0 0",
    fontWeight: 600,
    color: "var(--admin-label-text)",
    width: HEADER_LABEL_WIDTH,
    whiteSpace: "nowrap",
    fontSize: 13,
    textAlign: "right",
    verticalAlign: "middle",
  };
  const headerInputStyle: React.CSSProperties = {
    display: "table-cell",
    width: 170,
    border: "1px solid var(--admin-input-border)",
    background: "var(--admin-input-bg)",
    color: "var(--admin-input-text)",
    padding: "3px 6px",
    borderRadius: 4,
    boxSizing: "border-box",
    boxShadow: "0 2px 6px rgba(15,23,42,0.12)",
    fontSize: 13,
    verticalAlign: "middle",
  };
  const lineItemsColumnWidths = [
    "5%",
    "19%",
    "10%",
    "10%",
    "6%",
    "8%",
    "5%",
    "5%",
    "12%",
    "20%",
  ];
  const lineItemsWrapperStyle: React.CSSProperties = {
    overflowX: "auto",
    overflowY: "auto",
    maxHeight: 320,
    border: "1px solid var(--admin-card-border)",
    borderRadius: 16,
    background: "var(--admin-card-bg)",
    boxShadow: "inset 0 1px 0 var(--admin-card-inset)",
    width: "100%",
    maxWidth: "100%",
    boxSizing: "border-box",
  };
  const lineItemsTableStyle: React.CSSProperties = {
    width: "100%",
    minWidth: 1200,
    borderCollapse: "separate",
    borderSpacing: 0,
    tableLayout: "fixed",
    color: "var(--admin-table-text, #1e293b)",
  };
  const lineItemsHeaderCellStyle: React.CSSProperties = {
    padding: "6px 8px",
    borderBottom: "1px solid var(--admin-card-border)",
    textAlign: "center",
    fontWeight: 700,
    fontSize: 11,
    letterSpacing: "0.06em",
    textTransform: "none",
    color: "var(--admin-table-header-text)",
    backgroundColor: "var(--admin-card-bg)",
    backgroundImage: "linear-gradient(135deg, rgba(102,176,255,0.22), rgba(15,108,189,0.08))",
    position: "sticky",
    top: 0,
    zIndex: 2,
  };
  const lineItemsHeaderStickyLeftStyle: React.CSSProperties = {
    left: 0,
    zIndex: 3,
    boxShadow: "2px 0 4px rgba(15, 23, 42, 0.14)",
    borderRight: "1px solid rgba(148, 163, 184, 0.35)",
  };
  const lineItemsCellStyle: React.CSSProperties = {
    padding: "5px 7px",
    borderBottom: "1px solid rgba(148, 163, 184, 0.2)",
    verticalAlign: "middle",
    background: "transparent",
  };
  const lineItemsStickyLeftCellStyle: React.CSSProperties = {
    position: "sticky",
    left: 0,
    zIndex: 1,
    background: "inherit",
    boxShadow: "2px 0 4px rgba(15, 23, 42, 0.08)",
    borderRight: "1px solid rgba(148, 163, 184, 0.25)",
  };
  const lineItemsStaticCellStyle: React.CSSProperties = {
    ...lineItemsCellStyle,
    textAlign: "center",
    fontWeight: 600,
    color: "var(--admin-table-text, #1e293b)",
    fontSize: 12,
  };
  const lineItemsInputStyle: React.CSSProperties = {
    width: "100%",
    border: "1px solid var(--admin-input-border)",
    background: "var(--admin-input-bg)",
    color: "var(--admin-input-text)",
    padding: "4px 6px",
    borderRadius: 4,
    boxSizing: "border-box",
    fontSize: 12,
    boxShadow: "inset 0 1px 0 rgba(15,23,42,0.12)",
  };
  const lineItemsNumericInputStyle: React.CSSProperties = {
    ...lineItemsInputStyle,
    textAlign: "right",
  };
  const lineItemsAmountCellStyle: React.CSSProperties = {
    padding: "6px 8px",
    borderBottom: "1px solid rgba(96, 94, 92, 0.25)",
    textAlign: "right",
    color: "var(--admin-table-text, #1e293b)",
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    background: "linear-gradient(135deg, rgba(16,124,16,0.22), rgba(16,124,16,0.08))",
    position: "relative",
    fontSize: 12,
  };
  const lineItemsReasonCellStyle: React.CSSProperties = {
    padding: "6px 8px",
    borderBottom: "1px solid rgba(96, 94, 92, 0.25)",
    fontSize: 12,
    color: "#a4262c",
    background: "transparent",
  };
  const topActionBarStyle: React.CSSProperties = {
    display: "flex",
    gap: 12,
    alignItems: "center",
    margin: "12px 0 18px",
    flexWrap: "wrap",
    width: "100%",
  };
  const saveHintBoxStyle: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px dashed var(--admin-card-border)",
    background: "var(--admin-section-bg)",
    color: "var(--admin-label-text)",
    fontSize: 13,
    lineHeight: "20px",
  };
  const topActionGroupStyle: React.CSSProperties = {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
  };
  const topActionButtonStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 16px",
    borderRadius: 999,
    border: "1px solid var(--admin-card-border)",
    background: "var(--admin-card-bg)",
    color: "var(--admin-label-text)",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(15,23,42,0.12)",
    transition: "transform 0.15s ease, box-shadow 0.2s ease",
  };
  const topActionActiveStyle: React.CSSProperties = {
    background: "var(--admin-accent-gradient)",
    color: "var(--admin-accent-text)",
    borderColor: "var(--admin-accent-border)",
    boxShadow: "var(--admin-accent-shadow-hover)",
  };
  const topActionDeleteActiveStyle: React.CSSProperties = {
    background: "var(--admin-danger-gradient)",
    color: "#ffffff",
    borderColor: "var(--admin-danger-border)",
    boxShadow: "var(--admin-danger-shadow)",
  };
  const topActionIconStyle: React.CSSProperties = { fontSize: 16 };
  const totalsContainerStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "flex-end",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
    padding: isDarkTheme ? "6px 0" : "6px 12px",
    background: isDarkTheme ? "transparent" : "rgba(255,255,255,0.92)",
    borderRadius: isDarkTheme ? 0 : 14,
    border: isDarkTheme ? undefined : "1px solid rgba(148,163,184,0.45)",
    boxShadow: isDarkTheme ? "none" : "0 8px 24px rgba(15,23,42,0.12)",
  };
  const totalsLabelStyle: React.CSSProperties = {
    fontWeight: 600,
    color: isDarkTheme ? "var(--admin-label-text)" : "#201f1e",
    fontSize: 13,
    lineHeight: 1.2,
  };
  const currencyInputStyle: React.CSSProperties = {
    border: isDarkTheme ? "1px solid var(--admin-input-border)" : "1px solid rgba(148,163,184,0.55)",
    background: isDarkTheme ? "var(--admin-input-bg)" : "#ffffff",
    color: isDarkTheme ? "var(--admin-input-text)" : "#201f1e",
    padding: "4px 10px",
    borderRadius: 8,
    width: 72,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    boxShadow: isDarkTheme ? "0 6px 16px rgba(15,23,42,0.18)" : "0 4px 10px rgba(15,23,42,0.12)",
    fontSize: 12,
  };
  const currencySectionStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minWidth: 180,
  };
  const currencyInputGroupStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
  };
  const totalsValueStyle: React.CSSProperties = {
    border: isDarkTheme ? "1px solid var(--admin-card-border)" : "1px solid rgba(148,163,184,0.45)",
    background: isDarkTheme ? "var(--admin-card-bg)" : "#ffffff",
    color: isDarkTheme ? "var(--admin-table-text, #e2e8f0)" : "#201f1e",
    padding: "6px 10px",
    borderRadius: 10,
    minWidth: 120,
    textAlign: "right",
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
    boxShadow: "inset 0 1px 0 rgba(15,23,42,0.12)",
    fontSize: 12,
  };
  const grandTotalStyle: React.CSSProperties = {
    ...totalsValueStyle,
    border: "2px solid var(--admin-accent-border)",
    minWidth: 150,
    fontWeight: 700,
    fontSize: 12,
    background: isDarkTheme
      ? "linear-gradient(135deg, rgba(102,176,255,0.24), rgba(15,108,189,0.16))"
      : "linear-gradient(135deg, rgba(15,108,189,0.14), rgba(15,108,189,0.05))",
    color: isDarkTheme ? "var(--admin-table-text, #e2e8f0)" : "#201f1e",
  };
  const actionButtonsWrapperStyle: React.CSSProperties = {
    display: "flex",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: 2,
  };
  const baseActionButtonStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 16px",
    borderRadius: 999,
    fontWeight: 600,
    fontSize: 14,
    boxShadow: "0 8px 18px rgba(15,23,42,0.15)",
    transition: "transform 0.15s ease, box-shadow 0.2s ease",
    cursor: "pointer",
  };
  const uploadButtonStyle: React.CSSProperties = {
    ...baseActionButtonStyle,
    background: isDarkTheme
      ? "linear-gradient(135deg, rgba(102,176,255,0.38), rgba(15,108,189,0.48))"
      : "linear-gradient(135deg, rgba(191,219,254,0.9), rgba(102,176,255,0.85))",
    color: isDarkTheme ? "#f3f2f1" : "#0f141a",
    border: "1px solid var(--admin-accent-border)",
  };
  const saveButtonStyle: React.CSSProperties = {
    ...baseActionButtonStyle,
    background: "var(--admin-accent-gradient-strong)",
    color: "var(--admin-accent-text)",
    border: "1px solid var(--admin-accent-border)",
  };
  const clearButtonStyle: React.CSSProperties = {
    ...baseActionButtonStyle,
    background: isDarkTheme
      ? "var(--admin-secondary-bg)"
      : "linear-gradient(135deg, rgba(237,235,233,0.85), rgba(243,242,241,0.65))",
    color: isDarkTheme ? "var(--admin-secondary-text)" : "#201f1e",
    border: "1px solid var(--admin-secondary-border)",
  };
  const cancelButtonStyle: React.CSSProperties = {
    ...baseActionButtonStyle,
    background: isDarkTheme
      ? "var(--admin-danger-bg)"
      : "linear-gradient(135deg, rgba(255,200,200,0.45), rgba(247,168,168,0.85))",
    color: isDarkTheme ? "var(--admin-danger-text)" : "#a4262c",
    border: "1px solid var(--admin-danger-border)",
  };
  const deleteConfirmButtonStyle: React.CSSProperties = {
    ...baseActionButtonStyle,
    background: isDarkTheme
      ? "linear-gradient(135deg, rgba(209,52,56,0.5), rgba(164,38,44,0.65))"
      : "var(--admin-danger-gradient)",
    color: "#fff",
    border: "1px solid var(--admin-danger-border)",
  };
  const toastBaseStyle: React.CSSProperties = {
    position: "fixed",
    bottom: 24,
    right: 24,
    padding: "12px 18px",
    borderRadius: 12,
    fontWeight: 600,
    fontSize: 14,
    boxShadow: "0 12px 30px rgba(15,23,42,0.2)",
    zIndex: 1200,
    display: "flex",
    alignItems: "center",
    gap: 8,
  };
  const toastSuccessStyle: React.CSSProperties = {
    background: "linear-gradient(135deg, #2d9d4d, #107c10)",
    color: "#fff",
  };
  const toastErrorStyle: React.CSSProperties = {
    background: "var(--admin-danger-gradient)",
    color: "#fff",
  };
  const inlineErrorStyle: React.CSSProperties = {
    marginTop: 6,
    fontSize: 12,
    color: "#a4262c",
  };
  const pickerClearButtonStyle: React.CSSProperties = {
    position: "absolute",
    top: "50%",
    right: 6,
    transform: "translateY(-50%)",
    border: "none",
    background: "transparent",
    color: isDarkTheme ? "var(--admin-muted-text, #94a3b8)" : "#64748b",
    cursor: "pointer",
    padding: 0,
    fontSize: 14,
    lineHeight: 1,
  };
  const companyPlaceholder = companyLoading
    ? "Loading companies…"
    : companyError
      ? "Unable to load companies"
      : "Select company";
  const clientPlaceholder = clientLoading
    ? "Loading clients…"
    : clientError
      ? "Unable to load clients"
      : "Select client";
  const entryModeWrapperStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 16,
    marginBottom: 12,
    padding: "8px 12px",
    background: "var(--admin-section-bg)",
    borderRadius: 12,
    border: "1px solid var(--admin-card-border)",
  };
  const entryModeLabelStyle: React.CSSProperties = {
    fontWeight: 600,
    fontSize: 13,
    color: "var(--admin-label-text)",
  };
  const entryModeOptionStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    color: "var(--admin-table-text, #1e293b)",
  };
  const entryModeHelpStyle: React.CSSProperties = {
    fontSize: 12,
    color: "#475569",
    margin: "0 0 12px 4px",
  };
  const uploadProgressWrapperStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    fontSize: 12,
    color: "var(--admin-secondary-text, #475569)",
    margin: "6px 0 12px 4px",
  };
  const uploadCancelButtonStyle: React.CSSProperties = {
    border: "1px solid var(--admin-card-border)",
    background: "var(--admin-card-bg)",
    color: "var(--admin-label-text)",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  };
  const loadingOverlayStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    background: isDarkTheme ? "rgba(15, 23, 42, 0.82)" : "rgba(255, 255, 255, 0.85)",
    backdropFilter: "blur(2px)",
    zIndex: 30,
  };
  const loadingOverlayTextStyle: React.CSSProperties = {
    fontSize: 14,
    fontWeight: 600,
    textAlign: "center",
    maxWidth: 320,
    lineHeight: 1.4,
    color: isDarkTheme ? "#e2e8f0" : "#1e293b",
  };
  const loadingSpinnerStyle: React.CSSProperties = {
    width: 48,
    height: 48,
  };
  const loadingSpinnerStroke = isDarkTheme ? "#a6d3ff" : "#0f6cbd";
  const statusColors = {
    info: { border: "#a6d3ff", background: "#eff6ff", color: "#0f6cbd" },
    success: { border: "#a8d5a5", background: "#e9f7e9", color: "#107c10" },
    error: { border: "#f4abab", background: "#fde7e9", color: "#a4262c" },
  } as const;
  const loadingMessage = statusMsg.trim()
    ? statusMsg
    : isEditMode || isDeleteMode || isExportMode
      ? "Loading Sales Order…"
      : "Loading…";


  useEffect(() => {
    if (!loading) {
      setShowLoadingOverlay(false);
      return;
    }
    if (typeof window === "undefined") {
      setShowLoadingOverlay(true);
      return;
    }
    const timeout = window.setTimeout(() => setShowLoadingOverlay(true), 150);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [loading]);

  return (
    <div style={pageWrapperStyle}>
      <form onSubmit={onSubmit} aria-busy={loading} style={formStyle}>
        {showLoadingOverlay ? (
          <div style={loadingOverlayStyle} role="status" aria-live="polite" aria-busy="true">
            <svg
              style={loadingSpinnerStyle}
              viewBox="0 0 50 50"
              xmlns="http://www.w3.org/2000/svg"
              role="presentation"
            >
              <circle
                cx="25"
                cy="25"
                r="20"
                fill="none"
                stroke={loadingSpinnerStroke}
                strokeWidth="5"
                opacity="0.25"
              />
              <circle
                cx="25"
                cy="25"
                r="20"
                fill="none"
                stroke={loadingSpinnerStroke}
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray="31.4 188.4"
              >
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from="0 25 25"
                  to="360 25 25"
                  dur="0.9s"
                  repeatCount="indefinite"
                />
              </circle>
            </svg>
            <span style={loadingOverlayTextStyle}>{loadingMessage}</span>
          </div>
        ) : null}

        <div style={topActionBarStyle}>
          <div style={topActionGroupStyle}>
            <button
              type="button"
              onClick={() => activateMode("create")}
              aria-pressed={isCreateMode}
              style={{
                ...topActionButtonStyle,
                ...(isCreateMode ? topActionActiveStyle : {}),
              }}
            >
              <span style={topActionIconStyle} aria-hidden="true">➕</span>
              <span>Create</span>
            </button>
            <button
              type="button"
              onClick={() => activateMode("edit")}
              aria-pressed={isEditMode}
              style={{
                ...topActionButtonStyle,
                ...(isEditMode ? topActionActiveStyle : {}),
              }}
            >
              <span style={topActionIconStyle} aria-hidden="true">✏️</span>
              <span>Edit</span>
            </button>
            <button
              type="button"
              onClick={() => activateMode("delete")}
              aria-pressed={isDeleteMode}
              style={{
                ...topActionButtonStyle,
                ...(isDeleteMode ? topActionDeleteActiveStyle : {}),
              }}
            >
              <span style={topActionIconStyle} aria-hidden="true">🗑️</span>
              <span>Delete</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!exportBusy) activateMode("export");
            }}
            aria-pressed={isExportMode}
            disabled={exportBusy}
            style={{
              ...topActionButtonStyle,
              marginLeft: "auto",
              ...(isExportMode ? topActionActiveStyle : {}),
              ...(exportBusy
                ? { opacity: 0.7, cursor: "wait", boxShadow: "none" }
                : {}),
            }}
          >
            <span style={topActionIconStyle} aria-hidden="true">⬇️</span>
            <span>Export</span>
          </button>
        </div>

      <fieldset
        style={{
          ...sectionFieldsetStyle,
          padding: 10,
          position: "relative",
        }}
      >
        <legend style={fieldsetLegendStyle}>Sales Order</legend>

        <div style={headerTableStyle}>
          {/* Row 0 */}
          <div style={{ display: "table-row" }}>
            <label style={{ ...headerLabelStyle, whiteSpace: "nowrap" }}>Company Code/Name</label>
            <div
              style={{
                display: "table-cell",
                padding: 0,
                verticalAlign: "middle",
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div
                  style={{
                    position: "relative",
                    flex: "0 1 320px",
                    minWidth: 200,
                    maxWidth: "100%",
                  }}
                >
                  <input
                    ref={refCompCode}
                    value={
                      header.company_code
                        ? header.company_name
                          ? `${header.company_code} – ${header.company_name}`
                          : header.company_code
                        : ""
                    }
                    onClick={() => {
                      if (!isLockedMode) {
                        openCompanyPicker();
                      }
                    }}
                    onKeyDown={(e) =>
                      handlePickerInputKeyDown(
                        e,
                        headerIndexes.companyCode,
                        !isLockedMode ? openCompanyPicker : undefined,
                        isCreateMode && header.company_code ? clearCompanySelection : undefined,
                      )
                    }
                    readOnly
                    aria-readonly="true"
                    placeholder={companyPlaceholder}
                    style={{
                      ...headerInputStyle,
                      display: "block",
                      width: "100%",
                      minWidth: 200,
                      maxWidth: "100%",
                      borderRadius: 8,
                      cursor: isLockedMode ? "not-allowed" : "pointer",
                      background:
                        isLockedMode || companyLoading
                          ? "var(--admin-section-bg)"
                          : headerInputStyle.background,
                    }}
                  />
                  {isCreateMode && header.company_code ? (
                    <button
                      type="button"
                      onClick={clearCompanySelection}
                      style={{ ...pickerClearButtonStyle, color: isDarkTheme ? "#f4abab" : "#a4262c" }}
                      title="Clear selected company"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </div>
              {!isReadOnlyMode && companyError ? (
                <div style={inlineErrorStyle}>{companyError}</div>
              ) : null}
            </div>

            <label style={headerLabelStyle}>Sales Order Date</label>
            <input
              ref={refVoucherDate}
              type="text"
              value={header.so_voucher_date}
              placeholder="dd-mm-yyyy"
              onChange={(e) => handleVoucherDateInputChange(e.target.value)}
              onKeyDown={(e) => onHeaderEnter(e, headerIndexes.voucherDate)}
              inputMode="numeric"
              pattern="\d{2}-\d{2}-\d{4}"
              maxLength={10}
              required
              disabled={isEditMode || isDeleteMode || isExportMode}
              style={{
                ...headerInputStyle,
                width: 120,
                background:
                  isEditMode || isDeleteMode || isExportMode
                    ? "var(--admin-section-bg)"
                    : headerInputStyle.background,
              }}
            />
          </div>

          {/* Row 1 */}
          <div style={{ display: "table-row" }}>
            <label style={{ ...headerLabelStyle, whiteSpace: "nowrap" }}>Client Code/Name</label>
            <div
              style={{
                display: "table-cell",
                padding: 0,
                verticalAlign: "middle",
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div
                  style={{
                    position: "relative",
                    flex: "0 1 320px",
                    minWidth: 200,
                    maxWidth: "100%",
                  }}
                >
                  <input
                    ref={refClientCode}
                    value={
                      header.client_code
                        ? header.client_name
                          ? `${header.client_code} – ${header.client_name}`
                          : header.client_code
                        : ""
                    }
                    onClick={() => {
                      if (!isLockedMode) {
                        openClientPicker();
                      }
                    }}
                    onKeyDown={(e) =>
                      handlePickerInputKeyDown(
                        e,
                        headerIndexes.clientCode,
                        !isLockedMode ? openClientPicker : undefined,
                        isCreateMode && header.client_code ? clearClientSelection : undefined,
                      )
                    }
                    readOnly
                    aria-readonly="true"
                    placeholder={clientPlaceholder}
                    style={{
                      ...headerInputStyle,
                      display: "block",
                      width: "100%",
                      minWidth: 200,
                      maxWidth: "100%",
                      borderRadius: 8,
                      cursor: isLockedMode ? "not-allowed" : "pointer",
                      background:
                        isLockedMode || clientLoading
                          ? "var(--admin-section-bg)"
                          : headerInputStyle.background,
                    }}
                  />
                  {isCreateMode && header.client_code ? (
                    <button
                      type="button"
                      onClick={clearClientSelection}
                      style={{ ...pickerClearButtonStyle, color: isDarkTheme ? "#f4abab" : "#a4262c" }}
                      title="Clear selected client"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </div>
              {!isReadOnlyMode && clientError ? (
                <div style={inlineErrorStyle}>{clientError}</div>
              ) : null}
            </div>

            <label style={headerLabelStyle}>Sales Order No</label>
            <input
              ref={refVoucherNo}
              value={header.so_voucher_no}
              onChange={(e) => {
                if (isCreateMode) return;
                const value = e.target.value;
                setHeaderField("so_voucher_no", value);
                if (voucherExists) setVoucherExists(false);
              }}
              onKeyDown={(e) => onHeaderEnter(e, headerIndexes.voucherNo)}
              onBlur={onBlurVoucherNo}
              readOnly={isCreateMode}
              aria-readonly={isCreateMode}
              placeholder={isCreateMode ? "Auto-generated on save" : undefined}
              style={{
                ...headerInputStyle,
                width: 190,
                fontWeight: 600,
                background: isCreateMode ? "var(--admin-section-bg)" : headerInputStyle.background,
              }}
            />
          </div>

          {/* Row 2 */}
          <div style={{ display: "table-row" }}>
            <label style={headerLabelStyle}>Client PO No</label>
            <input
              ref={refClientPO}
              value={header.client_po_no || ""}
              onChange={(e) => {
                if (isEditMode || isDeleteMode || isExportMode) return;
                setHeaderField("client_po_no", e.target.value);
              }}
              onKeyDown={(e) => onHeaderEnter(e, headerIndexes.clientPo)}
              readOnly={isEditMode || isDeleteMode || isExportMode}
              aria-readonly={isEditMode || isDeleteMode || isExportMode}
              style={{
                ...headerInputStyle,
                width: 190,
                background:
                  isEditMode || isDeleteMode || isExportMode
                    ? "var(--admin-section-bg)"
                    : headerInputStyle.background,
              }}
            />

            <label style={headerLabelStyle}>Job Ref No</label>
            <input
              ref={refJob}
              value={header.job_ref_no}
              onChange={(e) => {
                if (isCreateMode || isEditMode || isDeleteMode || isExportMode) return;
                setHeaderField("job_ref_no", e.target.value);
              }}
              onKeyDown={(e) => onHeaderEnter(e, headerIndexes.jobRef)}
              readOnly={isCreateMode || isEditMode || isDeleteMode || isExportMode}
              aria-readonly={isCreateMode || isEditMode || isDeleteMode || isExportMode}
              placeholder={isCreateMode ? "Auto-generated on save" : undefined}
              style={{
                ...headerInputStyle,
                width: 190,
                background:
                  isCreateMode || isEditMode || isDeleteMode || isExportMode
                    ? "var(--admin-section-bg)"
                    : headerInputStyle.background,
              }}
            />
          </div>
        </div>
      </fieldset>

      {/* Items grid — Excel columns (fixed widths, no overlap) */}
      <fieldset style={{ ...sectionFieldsetStyle, padding: 14 }}>
        <legend style={fieldsetLegendStyle}>Line Items</legend>

        <div style={{ ...entryModeWrapperStyle, opacity: isReadOnlyMode ? 0.6 : 1 }}>
          <span style={entryModeLabelStyle}>Line Item Entry</span>
          <label style={entryModeOptionStyle}>
            <input
              type="radio"
              name="entry-mode"
              value="manual"
              checked={entryMode === "manual"}
              onChange={() => handleEntryModeSelect("manual")}
              disabled={isReadOnlyMode}
            />
            Manual Entry
          </label>
          <label style={entryModeOptionStyle}>
            <input
              type="radio"
              name="entry-mode"
              value="upload"
              checked={entryMode === "upload"}
              onChange={() => handleEntryModeSelect("upload")}
              disabled={isReadOnlyMode}
            />
            Upload from Excel
          </label>
        </div>
        <p style={entryModeHelpStyle}>
          {isReadOnlyMode
            ? isExportMode
              ? "Line items are read-only while previewing an export."
              : "Line items are read-only in delete mode."
            : entryMode === "upload"
            ? "Choose an authorised Excel file to populate the line items automatically."
            : "Type the line items directly into the grid below."}
        </p>

        {(uploadBusy || uploadProgress) && (
          <div style={uploadProgressWrapperStyle}>
            <span>{uploadProgress || (uploadBusy ? "Working…" : "")}</span>
            {uploadBusy && cancelUploadFn ? (
              <button type="button" onClick={cancelUploadFn} style={uploadCancelButtonStyle}>
                Cancel
              </button>
            ) : null}
          </div>
        )}

        <div
          style={lineItemsWrapperStyle}
          ref={scrollContainerRef}
          onScroll={handleVirtualScroll}
        >
          <table style={lineItemsTableStyle}>
            {/* fixed column widths to keep header and body aligned */}
            <colgroup>
              {lineItemsColumnWidths.map((width, index) => (
                <col key={index} style={{ width }} />
              ))}
            </colgroup>

            <thead>
              <tr>
                <th
                  style={{
                    ...lineItemsHeaderCellStyle,
                    ...lineItemsHeaderStickyLeftStyle,
                  }}
                >
                  Sl No.
                </th>
                <th style={lineItemsHeaderCellStyle}>Description of Goods</th>
                <th style={lineItemsHeaderCellStyle}>Part No</th>
                <th style={lineItemsHeaderCellStyle}>Due on</th>
                <th style={lineItemsHeaderCellStyle}>Quantity</th>
                <th style={lineItemsHeaderCellStyle}>Rate</th>
                <th style={lineItemsHeaderCellStyle}>Per</th>
                <th style={lineItemsHeaderCellStyle}>Disc%</th>
                <th style={lineItemsHeaderCellStyle}>Amount</th>
                <th style={lineItemsHeaderCellStyle}>Reason</th>
              </tr>
            </thead>

            <tbody>
              {shouldVirtualize && topPadding > 0 ? (
                <tr aria-hidden="true">
                  <td
                    colSpan={lineItemsColumnWidths.length}
                    style={{ height: topPadding, padding: 0, border: "none" }}
                  />
                </tr>
              ) : null}
              {visibleRows.map((r, visibleIdx) => {
                const rowIdx = shouldVirtualize ? startIndex + visibleIdx : visibleIdx;
                return (
                  <tr
                    key={r.id}
                    style={{ background: rowIdx % 2 === 0 ? "var(--admin-section-bg)" : "transparent" }}
                  >
                    <td
                    style={{
                      ...lineItemsStaticCellStyle,
                      ...lineItemsStickyLeftCellStyle,
                      background:
                        rowIdx % 2 === 0
                          ? "var(--admin-section-bg)"
                          : "var(--admin-card-bg)",
                    }}
                  >
                    {rowIdx + 1}
                  </td>

                  <td style={{ padding: 0, borderBottom: "1px solid #eef2f7" }}>
                    <input
                      data-first-desc="1"
                      ref={(el) => setCellRef(r.id, "description", el)}
                      value={r.description}
                      onChange={(e) => {
                        if (isReadOnlyMode) return;
                        setRowField(r.id, { description: e.target.value });
                      }}
                      onKeyDown={(e) => handleCellEnter(e, rowIdx, 0)}
                      readOnly={isReadOnlyMode}
                      aria-readonly={isReadOnlyMode}
                      style={{
                        ...lineItemsInputStyle,
                        background: isReadOnlyMode
                          ? "var(--admin-section-bg)"
                          : lineItemsInputStyle.background,
                      }}
                    />
                  </td>

                  <td style={lineItemsCellStyle}>
                    <input
                      ref={(el) => setCellRef(r.id, "part_no", el)}
                      value={r.part_no}
                      onChange={(e) => {
                        if (isReadOnlyMode) return;
                        setRowField(r.id, { part_no: e.target.value });
                      }}
                      onKeyDown={(e) => handleCellEnter(e, rowIdx, 1)}
                      readOnly={isReadOnlyMode}
                      aria-readonly={isReadOnlyMode}
                      style={{
                        ...lineItemsInputStyle,
                        background: isReadOnlyMode
                          ? "var(--admin-section-bg)"
                          : lineItemsInputStyle.background,
                      }}
                    />
                  </td>

                  <td style={lineItemsCellStyle}>
                    <input
                      ref={(el) => setCellRef(r.id, "due_on", el)}
                      type="text"
                      value={r.due_on}
                      placeholder="dd-mm-yyyy"
                      onChange={(e) => {
                        if (isReadOnlyMode) return;
                        const sanitized = sanitiseDateInput(e.target.value);
                        setRowField(r.id, { due_on: sanitized });
                      }}
                      onKeyDown={(e) => handleCellEnter(e, rowIdx, 2)}
                      inputMode="numeric"
                      pattern="\d{2}-\d{2}-\d{4}"
                      maxLength={10}
                      disabled={isReadOnlyMode}
                      style={{
                        ...lineItemsInputStyle,
                        background: isReadOnlyMode
                          ? "var(--admin-section-bg)"
                          : lineItemsInputStyle.background,
                      }}
                    />
                  </td>

                  <td style={lineItemsCellStyle}>
                    <input
                      ref={(el) => setCellRef(r.id, "qty", el)}
                      type="text"
                      inputMode="decimal"
                      value={r.qty}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          handleCellEnter(e, rowIdx, 3);
                          return;
                        }
                        if (e.key === "Enter") {
                          handleCellEnter(e, rowIdx, 3);
                        } else {
                          decimalKeyGuard(e, r.qty);
                        }
                      }}
                      onPaste={(e) =>
                        decimalPasteGuard(e, (v) => {
                          if (isReadOnlyMode) return;
                          updateRowQuantity(r.id, v);
                        })
                      }
                      onChange={(e) => {
                        if (isReadOnlyMode) return;
                        updateRowQuantity(r.id, e.target.value);
                      }}
                      readOnly={isReadOnlyMode}
                      aria-readonly={isReadOnlyMode}
                      style={{
                        ...lineItemsNumericInputStyle,
                        background: isReadOnlyMode
                          ? "var(--admin-section-bg)"
                          : lineItemsNumericInputStyle.background,
                      }}
                    />
                  </td>

                  <td style={lineItemsCellStyle}>
                    <input
                      ref={(el) => setCellRef(r.id, "rate", el)}
                      type="text"
                      inputMode="decimal"
                      value={r.rate}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          handleCellEnter(e, rowIdx, 4);
                          return;
                        }
                        if (e.key === "Enter") {
                          handleCellEnter(e, rowIdx, 4);
                        } else {
                          decimalKeyGuard(e, r.rate);
                        }
                      }}
                      onPaste={(e) =>
                        decimalPasteGuard(e, (v) => {
                          if (isReadOnlyMode) return;
                          setRowField(r.id, { rate: v });
                        })
                      }
                      onChange={(e) => {
                        if (isReadOnlyMode) return;
                        setRowField(r.id, { rate: e.target.value });
                      }}
                      readOnly={isReadOnlyMode}
                      aria-readonly={isReadOnlyMode}
                      style={{
                        ...lineItemsNumericInputStyle,
                        background: isReadOnlyMode
                          ? "var(--admin-section-bg)"
                          : lineItemsNumericInputStyle.background,
                      }}
                    />
                  </td>

                  <td style={lineItemsCellStyle}>
                    <input
                      ref={(el) => setCellRef(r.id, "per", el)}
                      value={r.per}
                      onChange={(e) => {
                        if (isReadOnlyMode) return;
                        setRowField(r.id, { per: e.target.value.toUpperCase().replace(/[^A-Z\s]/g, "") });
                      }}
                      onKeyDown={(e) => handleCellEnter(e, rowIdx, 5)}
                      readOnly={isReadOnlyMode}
                      aria-readonly={isReadOnlyMode}
                      style={{
                        ...lineItemsInputStyle,
                        background: isReadOnlyMode
                          ? "var(--admin-section-bg)"
                          : lineItemsInputStyle.background,
                      }}
                    />
                  </td>

                  <td style={lineItemsCellStyle}>
                    <input
                      ref={(el) => setCellRef(r.id, "disc_pct", el)}
                      type="text"
                      inputMode="decimal"
                      value={r.disc_pct}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          handleCellEnter(e, rowIdx, 6);
                          return;
                        }
                        if (e.key === "Enter") {
                          handleCellEnter(e, rowIdx, 6);
                        } else {
                          decimalKeyGuard(e, r.disc_pct);
                        }
                      }}
                      onPaste={(e) =>
                        decimalPasteGuard(e, (v) => {
                          if (isReadOnlyMode) return;
                          setRowField(r.id, { disc_pct: v });
                        })
                      }
                      onChange={(e) => {
                        if (isReadOnlyMode) return;
                        setRowField(r.id, { disc_pct: e.target.value });
                      }}
                      readOnly={isReadOnlyMode}
                      aria-readonly={isReadOnlyMode}
                      style={{
                        ...lineItemsNumericInputStyle,
                        background: isReadOnlyMode
                          ? "var(--admin-section-bg)"
                          : lineItemsNumericInputStyle.background,
                      }}
                    />
                  </td>

                  <td style={lineItemsAmountCellStyle}>
                    {(
                      (parseFloat(r.qty) || 0) * (parseFloat(r.rate) || 0) -
                      (((parseFloat(r.qty) || 0) * (parseFloat(r.rate) || 0) * (parseFloat(r.disc_pct) || 0)) / 100)
                    ).toFixed(2)}
                    <button
                      type="button"
                      onClick={() => deleteRow(r.id)}
                      title="Delete row"
                      style={{
                        marginLeft: 8,
                        border: "1px solid var(--admin-danger-border)",
                        borderRadius: 6,
                        background: "var(--admin-danger-bg)",
                        color: "var(--admin-danger-text)",
                        width: 24,
                        height: 24,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 14,
                        fontWeight: 700,
                        opacity: isReadOnlyMode ? 0.4 : 1,
                        cursor: isReadOnlyMode ? "not-allowed" : "pointer",
                      }}
                      disabled={isReadOnlyMode}
                    >
                      ×
                    </button>
                  </td>
                    <td style={lineItemsReasonCellStyle}>
                      <ReasonCell text={r.reason} />
                    </td>
                  </tr>
                );
              })}
              {shouldVirtualize && bottomPadding > 0 ? (
                <tr aria-hidden="true">
                  <td
                    colSpan={lineItemsColumnWidths.length}
                    style={{ height: bottomPadding, padding: 0, border: "none" }}
                  />
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </fieldset>

      {/* Totals — Currency FIRST, then Subtotal, Discount, Grand Total */}
      <div style={totalsContainerStyle}>
        <div style={currencySectionStyle}>
          <label style={totalsLabelStyle} htmlFor="sales-order-currency-input">
            Currency
          </label>
          <div style={currencyInputGroupStyle}>
            <input
              id="sales-order-currency-input"
              ref={refCurrency}
              value={header.currency || ""}
              onKeyDown={(e) => {
                if (isEditMode || isDeleteMode || isExportMode) return;
                if (
                  (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") &&
                  !e.shiftKey &&
                  !e.ctrlKey &&
                  !e.altKey &&
                  !e.metaKey
                ) {
                  e.preventDefault();
                  openCurrencyPicker();
                }
              }}
              onClick={() => {
                if (!isEditMode && !isDeleteMode && !isExportMode) {
                  openCurrencyPicker();
                }
              }}
              readOnly
              aria-readonly="true"
              style={{
                ...currencyInputStyle,
                cursor: isLockedMode ? "not-allowed" : "pointer",
                background:
                  isLockedMode
                    ? "var(--admin-section-bg)"
                    : currencyInputStyle.background,
              }}
              maxLength={3}
            />
          </div>
        </div>
        <div style={totalsLabelStyle}>Subtotal</div>
        <div style={totalsValueStyle}>{totals.sub.toFixed(2)}</div>
        <div style={totalsLabelStyle}>Discount</div>
        <div style={totalsValueStyle}>{totals.disc.toFixed(2)}</div>
        <div style={{ ...totalsLabelStyle, fontWeight: 700 }}>Grand Total</div>
        <div style={grandTotalStyle}>{totals.grand.toFixed(2)}</div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.xlsm,.xltx,.xltm"
        style={{ display: "none" }}
        onChange={onUploadFileChange}
      />

      {statusMsg && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: `1px solid ${statusColors[statusKind].border}`,
            background: statusColors[statusKind].background,
            color: statusColors[statusKind].color,
            fontSize: 14,
          }}
        >
          {statusMsg}
        </div>
      )}

      {!isReadOnlyMode && !canSave && !saving && saveDisabledReason && (
        <div style={saveHintBoxStyle}>
          <strong style={{ display: "block", marginBottom: 4 }}>Save unavailable</strong>
          {saveDisabledReason}
        </div>
      )}

      {/* Actions (icons + labels) */}
      <div style={actionButtonsWrapperStyle}>
        {!isReadOnlyMode && (
          <button
            type="button"
            onClick={handleUploadButtonClick}
            title="Upload"
            disabled={entryMode !== "upload" || isReadOnlyMode || uploadBusy}
            style={{
              ...uploadButtonStyle,
              opacity: entryMode === "upload" && !uploadBusy ? 1 : 0.55,
              cursor:
                entryMode === "upload" && !uploadBusy ? "pointer" : "not-allowed",
            }}
          >
            <span role="img" aria-label="upload">📤</span>
            <span>Upload</span>
          </button>
        )}
        {!isReadOnlyMode && (
          <button
            type="submit"
            disabled={!canSave || saving}
            title="Save"
            style={{
              ...saveButtonStyle,
              opacity: (!canSave || saving) ? 0.65 : 1,
              cursor: (!canSave || saving) ? "not-allowed" : "pointer",
            }}
          >
            <span role="img" aria-label="save">💾</span>
            <span>Save</span>
          </button>
        )}
        {isDeleteMode && (
          <button
            type="button"
            onClick={handleCancelSalesOrder}
            disabled={deleting || loading}
            title="Delete Sales Order"
            style={{
              ...deleteConfirmButtonStyle,
              opacity: deleting || loading ? 0.65 : 1,
              cursor: deleting || loading ? "not-allowed" : "pointer",
            }}
          >
            <span role="img" aria-label="confirm delete">🗑️</span>
            <span>Delete Order</span>
          </button>
        )}
        <button
          type="button"
          onClick={onClearForm}
          title="Clear"
          disabled={loading || saving || deleting}
          style={{
            ...clearButtonStyle,
            opacity: loading || saving || deleting ? 0.55 : 1,
            cursor: loading || saving || deleting ? "not-allowed" : "pointer",
          }}
        >
          <span role="img" aria-label="clear">🧹</span>
          <span>Clear</span>
        </button>
        <button
          type="button"
          onClick={() => navigate("/", { replace: true })}
          title="Cancel"
          style={cancelButtonStyle}
        >
          <span role="img" aria-label="cancel">🗙</span>
          <span>Cancel</span>
        </button>
      </div>

      <ItemPickerModal
        isOpen={companyModalOpen}
        title="Select Company"
        options={companyPickerOptions}
        onClose={closeCompanyPicker}
        onSelect={handleCompanySelect}
        onClear={
          !isReadOnlyMode && header.company_code
            ? () => {
                clearCompanySelection();
                closeCompanyPicker();
              }
            : undefined
        }
        disableClear={isReadOnlyMode}
        initialQuery={header.company_code || header.company_name}
        searchPlaceholder="Search company code or name"
        emptyMessage={companyEmptyMessage}
      />

      <ItemPickerModal
        isOpen={clientModalOpen}
        title="Select Client"
        options={clientPickerOptions}
        onClose={closeClientPicker}
        onSelect={handleClientSelect}
        onClear={
          !isReadOnlyMode && header.client_code
            ? () => {
                clearClientSelection();
                closeClientPicker();
              }
            : undefined
        }
        disableClear={isReadOnlyMode}
        initialQuery={header.client_code || header.client_name}
        searchPlaceholder="Search client code or name"
        emptyMessage={clientEmptyMessage}
      />

      <ItemPickerModal
        isOpen={currencyModalOpen}
        title="Select Currency"
        options={currencyOptions}
        onClose={closeCurrencyPicker}
        onSelect={handleCurrencySelect}
        disableClear
        initialQuery={header.currency}
        searchPlaceholder="Search currency code or name"
        emptyMessage={currencyEmptyMessage}
      />
      </form>
      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            ...toastBaseStyle,
            ...(toast.kind === "success" ? toastSuccessStyle : toastErrorStyle),
          }}
        >
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}