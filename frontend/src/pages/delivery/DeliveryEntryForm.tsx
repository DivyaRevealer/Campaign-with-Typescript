import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { isAxiosError } from "axios";

import {
  createDeliveryEntry,
  getDeliveryEntry,
  updateDeliveryEntry,
  validateDeliveryEntry,
  type DeliveryEntryResponse,
} from "@/api/deliveryEntries";
import { getSalesOrder, type SalesOrderResponse } from "@/api/salesorders";
import { extractApiErrorMessage } from "@/api/errors";
import { useAdminTheme } from "../common/useAdminTheme";
import ItemPickerModal, { type ItemPickerOption } from "@/components/ItemPickerModal";
import {
  convertDmyToIso,
  convertIsoToDmy,
  extractValidIsoDateString,
  isValidDmyDateString,
  isValidIsoDateString,
} from "@/utils/date";

import type React from "react";

type StatusKind = "info" | "success" | "warning" | "error";

type DeliveryRow = {
  id: string;
  line_no: number | null;
  description: string;
  part_no: string;
  stock_qty: number | null;
  dely_qty: string;
  dely_date: string;
  so_qty: number | null;
  initial_dely_qty: number;
  error: string | null;
  delyQtyTouched: boolean;
  deliveryDateTouched: boolean;
};

type OrderLineOption = {
  line_no: number;
  description: string;
  part_no: string;
  so_qty: number;
  stock_qty: number;
};

type DeliveryHeader = {
  so_voucher_no: string;
  so_voucher_date: string;
  company_code: string;
  company_name: string;
  client_code: string;
  client_name: string;
  dely_date: string;
};

function uid() {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase();
}

function formatQty(value: number | string | null | undefined) {
  if (value == null) return "";
  const numeric = typeof value === "number" ? value : Number.parseFloat(value);
  if (Number.isNaN(numeric)) return "";
  return numeric.toFixed(2);
}

function formatDisplayDate(value: string | null | undefined) {
  if (!value) return "";
  const trimmed = value.slice(0, 10);
  const parts = trimmed.split("-");
  if (parts.length !== 3) return trimmed;
  const [year, month, day] = parts;
  if (!year || !month || !day) return trimmed;
  return `${day.padStart(2, "0")}-${month.padStart(2, "0")}-${year}`;
}

function transformSalesOrderResponse(order: SalesOrderResponse): DeliveryEntryResponse {
  return {
    has_entry: false,
    header: {
      so_voucher_no: order.header.so_voucher_no ?? "",
      so_voucher_date: order.header.so_voucher_date,
      company_code: order.header.company_code,
      company_name: order.header.company_name,
      client_code: order.header.client_code,
      client_name: order.header.client_name,
      dely_date: "",
      created_by: null,
      created_at: null,
      updated_by: null,
      updated_at: null,
    },
    items: order.items.map((item) => ({
      line_no: item.line_no,
      description: (item.description ?? "").trim(),
      part_no: (item.part_no ?? "").trim(),
      due_on: item.due_on ?? null,
      so_qty: item.qty ?? 0,
      dely_qty: 0,
      stock_qty: item.qty ?? 0,
      dely_date: "",
    })),
  };
}

function sanitiseNumberInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/[^0-9.]/g, "");
  if (!digits) return "";
  const parts = digits.split(".");
  const normalised = parts.length > 1 ? `${parts[0]}.${parts.slice(1).join("")}` : parts[0];
  const numeric = Number.parseFloat(normalised);
  if (Number.isNaN(numeric)) return "";
  return numeric < 0 ? "" : normalised;
}

function decimalKeyGuard(e: React.KeyboardEvent<HTMLInputElement>, current: string) {
  const allowed = [
    "Backspace",
    "Delete",
    "Tab",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
    "Enter",
  ];
  if (allowed.includes(e.key)) return;
  const isCtrl = e.ctrlKey || e.metaKey;
  if (isCtrl && ["a", "c", "v", "x"].includes(e.key.toLowerCase())) return;
  if (e.key.length === 1) {
    const input = e.currentTarget;
    const s = input.selectionStart ?? input.value.length;
    const t = input.selectionEnd ?? input.value.length;
    const next = current.slice(0, s) + e.key + current.slice(t);
    if (!/^(\d+\.?\d*|\.?\d+)?$/.test(next)) e.preventDefault();
    else if (e.key === "." && current.includes(".") && s === t) e.preventDefault();
  } else {
    e.preventDefault();
  }
}

function decimalPasteGuard(e: React.ClipboardEvent<HTMLInputElement>, setter: (val: string) => void) {
  e.preventDefault();
  const text = (e.clipboardData.getData("text") || "").toString();
  const only = (text.match(/[0-9.]/g) || []).join("");
  const parts = only.split(".");
  const sanitized = parts.length > 1 ? `${parts[0]}.${parts.slice(1).join("")}` : parts[0] || "";
  setter(sanitized);
}

type DeliveryRowValidationResult = {
  error: string | null;
  invalidField: "description" | "dely_qty" | "dely_date" | null;
  isActive: boolean;
  hasPositiveQty: boolean;
};

function evaluateDeliveryRow(row: DeliveryRow): DeliveryRowValidationResult {
  const trimmedQty = row.dely_qty.trim();
  const trimmedDate = row.dely_date.trim();
  const trimmedPart = row.part_no.trim();
  const hasLine = row.line_no != null;
  const hasQty = trimmedQty !== "";
  const hasDate = trimmedDate !== "";
  const isActive = hasLine || hasQty || hasDate;

  const parsedQty = Number.parseFloat(trimmedQty);
  const qtyValid = hasQty && Number.isFinite(parsedQty) && parsedQty > 0;
  const hasPositiveQty = hasLine && qtyValid;
  const hasPart = trimmedPart !== "";

  if (!isActive) {
    return { error: null, invalidField: null, isActive: false, hasPositiveQty: false };
  }

  if (!qtyValid) {
    return {
      error: "Quantity must be greater than 0",
      invalidField: "dely_qty",
      isActive,
      hasPositiveQty,
    };
  }

  if (hasPositiveQty && !hasPart) {
    return {
      error:
        "Selected line is missing a part number. Choose a different line or update the sales order.",
      invalidField: "description",
      isActive,
      hasPositiveQty,
    };
  }

  const dateValid = hasDate && isValidDmyDateString(trimmedDate);

  if (!hasDate || !dateValid) {
    return {
      error: "Enter a valid date (dd-mm-yyyy)",
      invalidField: "dely_date",
      isActive,
      hasPositiveQty,
    };
  }

  return { error: null, invalidField: null, isActive, hasPositiveQty };
}

function shouldDisplayRowError(
  row: DeliveryRow,
  evaluation: DeliveryRowValidationResult,
): boolean {
  if (!evaluation.error) return false;
  if (evaluation.invalidField === "dely_qty") {
    return row.delyQtyTouched;
  }
  if (evaluation.invalidField === "dely_date") {
    return row.deliveryDateTouched;
  }
  if (evaluation.invalidField === "description") {
    return evaluation.hasPositiveQty;
  }
  return false;
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

export default function DeliveryEntryForm() {
  const navigate = useNavigate();
  const { soVoucherNo } = useParams();
  const orderKey = soVoucherNo ? soVoucherNo.trim() : "";
  const { theme } = useAdminTheme();
  const isDarkTheme = theme === "dark";

  const [voucherInput, setVoucherInput] = useState(orderKey);
  const [header, setHeader] = useState<DeliveryHeader>({
    so_voucher_no: "",
    so_voucher_date: "",
    company_code: "",
    company_name: "",
    client_code: "",
    client_name: "",
    dely_date: "",
  });
  const [lastKnownUpdatedAt, setLastKnownUpdatedAt] = useState<string | null>(null);
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [orderLineOptions, setOrderLineOptions] = useState<OrderLineOption[]>([]);
  const [hasEntry, setHasEntry] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; kind: "success" | "error" } | null>(
    null,
  );
  const [, setStatusMsg] = useState("");
  const [, setStatusKind] = useState<StatusKind>("info");
  const voucherInputRef = useRef<HTMLInputElement | null>(null);
  const lastResponseRef = useRef<DeliveryEntryResponse | null>(null);
  const lastFailedVoucherRef = useRef<string | null>(null);
  type FocusableCellKey = "description" | "dely_qty" | "dely_date";
  const cellRefs = useRef<
    Map<string, Partial<Record<FocusableCellKey, HTMLSelectElement | HTMLInputElement | HTMLButtonElement>>>
  >(new Map());
  const pendingFocusRef = useRef<{ rowId: string; cell: FocusableCellKey } | null>(null);
  const [itemPickerState, setItemPickerState] = useState<{
    rowId: string;
    initialQuery: string;
  } | null>(null);

  const hasLoadedOrder = header.so_voucher_no !== "";
  const rowValidationSummary = useMemo(() => {
    type SummaryEntry = {
      localError: string | null;
      displayError: string | null;
      isActive: boolean;
      hasPositiveQty: boolean;
      invalidField: "description" | "dely_qty" | "dely_date" | null;
    };
    const map = new Map<string, SummaryEntry>();
    let hasInvalidRow = false;
    let hasPositiveQtyRow = false;

    rows.forEach((row) => {
      const evaluation = evaluateDeliveryRow(row);
      const showLocalError = shouldDisplayRowError(row, evaluation);
      const displayError = showLocalError ? evaluation.error : row.error ?? null;

      if (evaluation.isActive && (evaluation.error ?? row.error)) {
        hasInvalidRow = true;
      }

      if (evaluation.hasPositiveQty) {
        hasPositiveQtyRow = true;
      }

      map.set(row.id, {
        localError: showLocalError ? evaluation.error : null,
        displayError,
        isActive: evaluation.isActive,
        hasPositiveQty: evaluation.hasPositiveQty,
        invalidField: evaluation.invalidField,
      });
    });

    return { map, hasInvalidRow, hasPositiveQtyRow };
  }, [rows]);

  const isReady =
    hasLoadedOrder &&
    header.dely_date !== "" &&
    rowValidationSummary.hasPositiveQtyRow &&
    !rowValidationSummary.hasInvalidRow;

  const registerCellRef = useCallback(
    (rowId: string, key: FocusableCellKey, element: HTMLSelectElement | HTMLInputElement | HTMLButtonElement | null) => {
      const map = cellRefs.current;
      if (!map.has(rowId)) {
        map.set(rowId, {});
      }
      const rowMap = map.get(rowId)!;
      if (element) {
        rowMap[key] = element;
      } else {
        delete rowMap[key];
        if (Object.keys(rowMap).length === 0) {
          map.delete(rowId);
        }
      }
    },
    [],
  );

  const focusCell = useCallback(
    (rowId: string, key: FocusableCellKey) => {
      const element = cellRefs.current.get(rowId)?.[key];
      if (!element) return;
      element.focus();
      if (key === "dely_qty" && "select" in element && typeof element.select === "function") {
        element.select();
      }
    },
    [],
  );

  function createEmptyRow(defaultDate = ""): DeliveryRow {
    const trimmedDefault = defaultDate.trim();
    const initialDate = trimmedDefault
      ? isValidDmyDateString(trimmedDefault)
        ? trimmedDefault
        : convertIsoToDmy(trimmedDefault)
      : "";
    return {
      id: uid(),
      line_no: null,
      description: "",
      part_no: "",
      stock_qty: null,
      dely_qty: "",
      dely_date: initialDate,
      so_qty: null,
      initial_dely_qty: 0,
      error: null,
      delyQtyTouched: false,
      deliveryDateTouched: Boolean(initialDate),
    };
  }

  const addEmptyRow = useCallback(() => {
    setRows((prev) => {
      const newRow = createEmptyRow();
      pendingFocusRef.current = { rowId: newRow.id, cell: "description" };
      return [...prev, newRow];
    });
  }, []);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const element = cellRefs.current.get(pending.rowId)?.[pending.cell];
    if (element) {
      element.focus();
      if (pending.cell === "dely_qty" && "select" in element && typeof element.select === "function") {
        element.select();
      }
    }
    pendingFocusRef.current = null;
  }, [rows]);

  const applyDeliveryResponse = useCallback((response: DeliveryEntryResponse) => {
    lastResponseRef.current = response;
    const delyDate = extractValidIsoDateString(response.header.dely_date);
    const defaultDelyDate = response.has_entry ? "" : convertIsoToDmy(delyDate);
    setVoucherInput(response.header.so_voucher_no);
    setHeader({
      so_voucher_no: response.header.so_voucher_no,
      so_voucher_date: response.header.so_voucher_date,
      company_code: response.header.company_code,
      company_name: response.header.company_name,
      client_code: response.header.client_code,
      client_name: response.header.client_name,
      dely_date: delyDate,
    });
    setLastKnownUpdatedAt(response.header.updated_at ?? null);
    setOrderLineOptions(() => {
      const unique = new Map<string, OrderLineOption>();
      response.items
        .map((item) => {
          const stockQty = Number(item.stock_qty ?? item.so_qty ?? 0);
          const soQty = Number(item.so_qty ?? 0);
          return {
            ...item,
            stockQty,
            soQty,
          };
        })
        .filter((item) => Number.isFinite(item.stockQty) && item.stockQty > 0)
        .forEach((item) => {
          const description = (item.description ?? "").trim();
          const partNo = (item.part_no ?? "").trim();
          const key = `${description.toLowerCase()}|${partNo.toLowerCase()}`;
          if (!unique.has(key)) {
            unique.set(key, {
              line_no: item.line_no,
              description,
              part_no: partNo,
              so_qty: Number.isFinite(item.soQty) ? item.soQty : 0,
              stock_qty: item.stockQty,
            });
          }
        });
      return Array.from(unique.values());
    });
    setRows([createEmptyRow(defaultDelyDate)]);
    setHasEntry(response.has_entry);
  }, []);

  const loadDeliveryEntry = useCallback(
    async (voucher: string) => {
      const trimmed = voucher.trim();
      if (!trimmed) {
        setStatusKind("warning");
        setStatusMsg("Enter a Sales Order / Voucher number to load.");
        return;
    }
    try {
      setLoading(true);
      lastFailedVoucherRef.current = null;
      setStatusKind("info");
      setStatusMsg("Loading delivery entry…");
      const response = await getDeliveryEntry(trimmed);
      applyDeliveryResponse(response);
      setStatusKind(response.has_entry ? "success" : "info");
      setStatusMsg(
        response.has_entry
          ? "Delivery entry loaded successfully."
          : "Sales order loaded. Enter delivery quantities.",
      );
      if (trimmed !== orderKey) {
        navigate(`/delivery/${encodeURIComponent(trimmed)}`, { replace: true });
      }
    } catch (error) {
      if (isAxiosError(error)) {
        try {
          const order = await getSalesOrder(trimmed);
          const orderStatus = (order.header.so_status ?? "").trim().toUpperCase();
          if (orderStatus !== "O") {
            throw new Error("Only open sales orders can be delivered.");
          }
          const transformed = transformSalesOrderResponse(order);
          applyDeliveryResponse(transformed);
          setStatusKind("info");
          setStatusMsg("Sales order loaded. Enter delivery quantities.");
          if (trimmed !== orderKey) {
            navigate(`/delivery/${encodeURIComponent(trimmed)}`, { replace: true });
          }
          return;
        } catch (salesOrderError) {
          lastFailedVoucherRef.current = trimmed;
          setStatusKind("error");
          if (isAxiosError(salesOrderError)) {
            setStatusMsg(
              extractApiErrorMessage(salesOrderError, "Failed to load sales order."),
            );
          } else if (salesOrderError instanceof Error) {
            setStatusMsg(salesOrderError.message);
          } else {
            setStatusMsg("Failed to load sales order.");
          }
          return;
        }
      }
      lastFailedVoucherRef.current = trimmed;
      setStatusKind("error");
      setStatusMsg(extractApiErrorMessage(error, "Failed to load delivery entry."));
    } finally {
      setLoading(false);
    }
  }, [applyDeliveryResponse, lastFailedVoucherRef, navigate, orderKey]);
  
  useEffect(() => {
    voucherInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (orderKey) {
      void loadDeliveryEntry(orderKey);
    }
  }, [orderKey, loadDeliveryEntry]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [toast]);
  
  function handleVoucherInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setVoucherInput(e.target.value.toUpperCase());
  }

  function handleDelyDateChange(rowId: string, value: string) {
    const sanitized = sanitiseDateInput(value);
    const trimmed = sanitized.trim();
    const isoValue = convertDmyToIso(trimmed);

    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? {
              ...row,
              dely_date: sanitized,
              error: null,
              deliveryDateTouched: row.deliveryDateTouched || trimmed !== "",
            }
          : row,
      ),
    );

    setHeader((prev) => ({
      ...prev,
      dely_date: trimmed === "" ? "" : isoValue,
    }));
  }

  function handleDelyDateBlur(rowId: string) {
    let focusTarget: FocusableCellKey | null = null;
    let nextIso: string | null = null;

    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;
        const trimmed = row.dely_date.trim();
        let nextValue = trimmed;
        if (trimmed) {
          if (isValidDmyDateString(trimmed)) {
            const [day, month, year] = trimmed.split("-");
            nextValue = `${day.padStart(2, "0")}-${month.padStart(2, "0")}-${year}`;
            nextIso = convertDmyToIso(nextValue);
          } else {
            nextIso = "";
          }
        } else {
          nextIso = "";
        }

        const updatedRow = {
          ...row,
          dely_date: nextValue,
          deliveryDateTouched: row.deliveryDateTouched || trimmed !== "",
        };
        const evaluation = evaluateDeliveryRow(updatedRow);
        const showError = shouldDisplayRowError(updatedRow, evaluation);
        focusTarget = showError ? evaluation.invalidField : null;
        return updatedRow;
      }),
    );

    if (nextIso !== null) {
      const isoToSet = nextIso;
      setHeader((prev) => ({
        ...prev,
        dely_date: isoToSet,
      }));
    }

    if (focusTarget) {
      setTimeout(() => focusCell(rowId, focusTarget!), 0);
    }
  }

  async function handleVoucherBlur() {
    if (!voucherInput.trim() || voucherInput.trim() === header.so_voucher_no) return;
    await handleVoucherLookup();
  }

  async function handleVoucherLookup() {
    const voucher = voucherInput.trim();
    if (!voucher) {
      setStatusKind("warning");
      setStatusMsg("Enter a Sales Order / Voucher number to continue.");
      return;
    }
    if (voucher === header.so_voucher_no) return;
    await loadDeliveryEntry(voucher);
  }

  const updateRowById = useCallback(
    (rowId: string, updater: (row: DeliveryRow) => DeliveryRow) => {
      setRows((prev) => prev.map((row) => (row.id === rowId ? updater(row) : row)));
    },
    [],
  );

  const applyOrderLineOption = useCallback(
    (rowId: string, option: OrderLineOption | null) => {
      if (!option) {
        updateRowById(rowId, (row) => ({
          ...row,
          line_no: null,
          description: "",
          part_no: "",
          stock_qty: null,
          so_qty: null,
          initial_dely_qty: 0,
          dely_qty: "",
          dely_date: "",
          error: null,
          delyQtyTouched: false,
          deliveryDateTouched: false,
        }));
        return;
      }
      updateRowById(rowId, (row) => {
        const stockQty = Number(option.stock_qty);
        const soQty = Number(option.so_qty);
        const description = (option.description ?? "").trim();
        const partNo = (option.part_no ?? "").trim();
        return {
          ...row,
          line_no: option.line_no,
          description,
          part_no: partNo,
          stock_qty: Number.isFinite(stockQty) ? stockQty : null,
          so_qty: Number.isFinite(soQty) ? soQty : null,
          initial_dely_qty: 0,
          dely_date: row.line_no === option.line_no ? row.dely_date : "",
          error: null,
          delyQtyTouched: row.line_no === option.line_no ? row.delyQtyTouched : false,
          deliveryDateTouched:
            row.line_no === option.line_no ? row.deliveryDateTouched : false,
        };
      });
    },
    [updateRowById],
  );

  const openItemPicker = useCallback(
    (rowId: string, initialQuery = "") => {
      if (orderLineOptions.length === 0) return;
      setItemPickerState({ rowId, initialQuery });
    },
    [orderLineOptions],
  );

  const closeItemPicker = useCallback(
    (focusDescription: boolean) => {
      setItemPickerState((prev) => {
        if (prev && focusDescription) {
          requestAnimationFrame(() => focusCell(prev.rowId, "description"));
        }
        return null;
      });
    },
    [focusCell],
  );

  const handleItemPickerSelect = useCallback(
    (rowId: string, option: OrderLineOption) => {
      pendingFocusRef.current = { rowId, cell: "dely_qty" };
      applyOrderLineOption(rowId, option);
      setItemPickerState(null);
    },
    [applyOrderLineOption],
  );

  const handleItemPickerClear = useCallback(
    (rowId: string) => {
      pendingFocusRef.current = { rowId, cell: "description" };
      applyOrderLineOption(rowId, null);
      setItemPickerState(null);
    },
    [applyOrderLineOption],
  );

  useEffect(() => {
    if (!itemPickerState) return;
    const { rowId } = itemPickerState;
    if (!rows.some((row) => row.id === rowId)) {
      setItemPickerState(null);
    }
  }, [itemPickerState, rows]);

  function handleDelQtyChange(rowId: string, value: string) {
    updateRowById(rowId, (row) => {
      const sanitized = sanitiseNumberInput(value);
      const touched = row.delyQtyTouched || value.trim() !== "";
      return {
        ...row,
        dely_qty: sanitized,
        error: null,
        delyQtyTouched: touched,
      };
    });
  }

  function handleDelQtyBlur(rowId: string) {
    let focusTarget: FocusableCellKey | null = null;
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;
        const trimmed = row.dely_qty.trim();
        let nextValue = trimmed;
        if (trimmed) {
          const qty = Number.parseFloat(trimmed);
          nextValue = Number.isFinite(qty) ? formatQty(qty) : "";
        } else {
          nextValue = "";
        }

        const updatedRow = {
          ...row,
          dely_qty: nextValue,
          delyQtyTouched: row.delyQtyTouched || trimmed !== "",
        };
        const evaluation = evaluateDeliveryRow(updatedRow);
        const showError = shouldDisplayRowError(updatedRow, evaluation);
        focusTarget = showError ? evaluation.invalidField : null;
        return updatedRow;
      }),
    );

    if (focusTarget) {
      setTimeout(() => focusCell(rowId, focusTarget!), 0);
    }
  }

  function handleDeleteRow(rowId: string) {
    setRows((prev) => {
      if (prev.length === 1) {
        const newRow = createEmptyRow();
        pendingFocusRef.current = { rowId: newRow.id, cell: "description" };
        return [newRow];
      }
      const nextRows = prev.filter((row) => row.id !== rowId);
      const removedIndex = prev.findIndex((row) => row.id === rowId);
      if (removedIndex !== -1) {
        const nextRow = nextRows[Math.min(removedIndex, nextRows.length - 1)];
        if (nextRow) {
          pendingFocusRef.current = { rowId: nextRow.id, cell: "description" };
        }
      }
      return nextRows;
    });
  }

  async function handleSave() {
    if (!hasLoadedOrder) {
      setStatusKind("warning");
      setStatusMsg("Load a sales order before saving delivery entry.");
      return;
    }
    if (!header.dely_date) {
      setStatusKind("warning");
      setStatusMsg("Enter a delivery date before saving delivery entry.");
      return;
    }
    if (!isValidIsoDateString(header.dely_date)) {
      setStatusKind("error");
      setStatusMsg("Enter a valid delivery date before saving delivery entry.");
      setToast({ message: "❌ Enter a valid delivery date before saving.", kind: "error" });
      return;
    }

    const rowsWithQtyButNoLine = rows.filter((row) => {
      const qty = row.dely_qty ? Number.parseFloat(row.dely_qty) || 0 : 0;
      return qty > 0 && row.line_no == null;
    });
    if (rowsWithQtyButNoLine.length > 0) {
      const ids = new Set(rowsWithQtyButNoLine.map((row) => row.id));
      setRows((prev) =>
        prev.map((row) =>
          ids.has(row.id)
            ? {
                ...row,
                error: "Select a line item before saving.",
              }
            : row,
        ),
      );
      setStatusKind("error");
      setStatusMsg("Select a line item for each quantity before saving.");
      return;
    }

    const rowsWithMissingPart = rows.filter((row) => {
      const qty = row.dely_qty ? Number.parseFloat(row.dely_qty) || 0 : 0;
      return qty > 0 && row.line_no != null && row.part_no.trim() === "";
    });

    if (rowsWithMissingPart.length > 0) {
      const ids = new Set(rowsWithMissingPart.map((row) => row.id));
      setRows((prev) =>
        prev.map((row) =>
          ids.has(row.id)
            ? {
                ...row,
                error:
                  "Selected line is missing a part number. Choose a different line or update the sales order.",
              }
            : row,
        ),
      );
      setStatusKind("error");
      setStatusMsg("Resolve missing part numbers before saving.");
      setToast({ message: "❌ Fix missing part numbers before saving.", kind: "error" });
      return;
    }

    const rowsWithInvalidDates = rows.reduce<
      Array<{ id: string; message: string }>
    >((acc, row) => {
      if (row.line_no == null || row.dely_qty.trim() === "") return acc;
      const trimmedDate = row.dely_date.trim();
      if (!trimmedDate || !isValidDmyDateString(trimmedDate)) {
        acc.push({ id: row.id, message: "Enter a valid date (dd-mm-yyyy)" });
      }
      return acc;
    }, []);

    if (rowsWithInvalidDates.length > 0) {
      const invalidIdToMessage = new Map(rowsWithInvalidDates.map((row) => [row.id, row.message]));
      setRows((prev) =>
        prev.map((row) =>
          invalidIdToMessage.has(row.id)
            ? {
                ...row,
                error: invalidIdToMessage.get(row.id) ?? row.error,
              }
            : row,
        ),
      );
      setStatusKind("error");
      setStatusMsg("Enter a valid delivery date for each line item before saving.");
      setToast({ message: "❌ Fix invalid delivery dates before saving.", kind: "error" });
      return;
    }

    const preparedEntries = rows
      .filter((row) => row.line_no != null && row.dely_qty.trim() !== "")
      .map((row) => {
        const parsed = row.dely_qty ? Number.parseFloat(row.dely_qty) || 0 : 0;
        const clamped = parsed < 0 ? 0 : parsed;
        const rounded = Number(clamped.toFixed(2));
        const isoDate = convertDmyToIso(row.dely_date);
        const trimmedDescription = row.description.trim();
        const trimmedPart = row.part_no.trim();
        return {
          rowId: row.id,
          line_no: row.line_no as number,
          dely_qty: rounded,
          description: trimmedDescription,
          part_no: trimmedPart,
          dely_date: isoDate || header.dely_date,
          previous_dely_qty: Number.isFinite(row.initial_dely_qty)
            ? Number(row.initial_dely_qty)
            : 0,
        };
      })
      .filter((entry) => entry.dely_qty > 0);

    if (preparedEntries.length === 0) {
      setStatusKind("warning");
      setStatusMsg("Add at least one line item with quantity before saving delivery entry.");
      return;
    }

    try {
      setSaving(true);
      setRows((prev) => prev.map((row) => ({ ...row, error: null })));

      const validation = await validateDeliveryEntry({
        so_voucher_no: header.so_voucher_no,
        items: preparedEntries.map((entry) => ({
          line_no: entry.line_no,
          description: entry.description,
          part_no: entry.part_no,
          dely_qty: entry.dely_qty,
          dely_date: entry.dely_date || null,
          previous_dely_qty: entry.previous_dely_qty,
        })),
      });

      const normaliseKey = (value: string | null | undefined) =>
        (value ?? "").trim().toLowerCase();
      const preparedEntryIndex = preparedEntries.map((entry) => ({
        rowId: entry.rowId,
        line_no: entry.line_no,
        description: normaliseKey(entry.description),
        part_no: normaliseKey(entry.part_no),
      }));
      const assignedRowIds = new Set<string>();
      const takeFirstMatch = (
        predicate: (candidate: (typeof preparedEntryIndex)[number]) => boolean,
      ): string | null => {
        const match = preparedEntryIndex.find(
          (candidate) => !assignedRowIds.has(candidate.rowId) && predicate(candidate),
        );
        if (!match) return null;
        assignedRowIds.add(match.rowId);
        return match.rowId;
      };

      const errorMap = new Map<string, string | null>();
      validation.items.forEach((item, index) => {
        const normalisedDescription = normaliseKey(item?.description);
        const normalisedPartNo = normaliseKey(item?.part_no);

        let matchedRowId: string | null = null;

        if (item?.line_no != null) {
          matchedRowId = takeFirstMatch((candidate) => candidate.line_no === item.line_no);
        }

        if (!matchedRowId && (normalisedDescription || normalisedPartNo)) {
          matchedRowId = takeFirstMatch(
            (candidate) =>
              candidate.description === normalisedDescription &&
              candidate.part_no === normalisedPartNo,
          );
        }

        if (!matchedRowId) {
          const fallback = preparedEntries[index];
          if (fallback && !assignedRowIds.has(fallback.rowId)) {
            assignedRowIds.add(fallback.rowId);
            matchedRowId = fallback.rowId;
          }
        }

        if (!matchedRowId) return;
        errorMap.set(matchedRowId, item?.error ?? null);
        const corresponding = preparedEntries[index];
        if (!corresponding) return;
        errorMap.set(corresponding.rowId, item?.error ?? null);
      });

      if (!validation.valid) {
        setRows((prev) =>
          prev.map((row) => ({
            ...row,
            error: errorMap.has(row.id) ? errorMap.get(row.id) ?? null : row.error,
          })),
        );
        setStatusKind("error");
        setStatusMsg("Resolve the highlighted errors before saving.");
        return;
      }

      setStatusKind("info");
      setStatusMsg(hasEntry ? "Updating delivery entry…" : "Creating delivery entry…");

      const payload = {
        so_voucher_no: header.so_voucher_no,
        dely_date: header.dely_date,
        items: preparedEntries.map((entry) => ({
          line_no: entry.line_no,
          dely_qty: entry.dely_qty,
          dely_date: entry.dely_date || header.dely_date || null,
        })),
        expected_updated_at: lastKnownUpdatedAt,
      };

      await (hasEntry
        ? updateDeliveryEntry(header.so_voucher_no, payload)
        : createDeliveryEntry(payload));

      setStatusKind("success");
      setStatusMsg("Delivery entry saved successfully.");
      setToast({ message: "✅ Delivery Saved Successfully", kind: "success" });
      handleClear(true);
    } catch (error) {
      const message = extractApiErrorMessage(error, "Failed to save delivery entry.");
      if (isAxiosError(error) && error.response?.status === 409) {
        setStatusKind("error");
        setStatusMsg(
          "This delivery entry was updated by someone else. Please reload and try again.",
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

  function handleClear(skipStatus = false) {
    if (!skipStatus) {
      setStatusKind("info");
      setStatusMsg("Cleared delivery entry form.");
    }
    lastResponseRef.current = null;
    lastFailedVoucherRef.current = null;
    setLastKnownUpdatedAt(null);
    setVoucherInput("");
    setHeader({
      so_voucher_no: "",
      so_voucher_date: "",
      company_code: "",
      company_name: "",
      client_code: "",
      client_name: "",
      dely_date: "",
    });
    setRows([createEmptyRow("")]);
    setOrderLineOptions([]);
    setHasEntry(false);
    setItemPickerState(null);
    requestAnimationFrame(() => {
      voucherInputRef.current?.focus();
    });
  }

  function handleCancel() {
    navigate("/");
  }

  const sectionFieldsetStyle: React.CSSProperties = {
    border: "1px solid var(--admin-card-border)",
    borderRadius: 12,
    padding: 12,
    background: "var(--admin-card-bg)",
    boxShadow: "inset 0 1px 0 var(--admin-card-inset)",
    backdropFilter: "blur(3px)",
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
  const pageWrapperStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 18,
    width: "100%",
  };
  const headerTableStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns:
      "max-content minmax(220px, 1fr) max-content minmax(220px, 1fr)",
    columnGap: 16,
    rowGap: 12,
    width: "100%",
    color: "var(--admin-table-text, #1e293b)",
    alignItems: "center",
  };
  const headerRowStyle: React.CSSProperties = {
    display: "contents",
  };
  const headerLabelStyle: React.CSSProperties = {
    fontWeight: 700,
    letterSpacing: "0.02em",
    color: "var(--admin-label-text)",
    whiteSpace: "nowrap",
    fontSize: 13,
    textAlign: "right",
    justifySelf: "end",
  };
  const headerOffsetLabelStyle: React.CSSProperties = {
    ...headerLabelStyle,
  };
  const headerCellStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
  };
  const headerOffsetCellStyle: React.CSSProperties = {
    ...headerCellStyle,
  };
  const headerInputShellStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
  };
  const headerValueBoxStyle: React.CSSProperties = {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: 8,
    border: "1px solid var(--admin-input-border)",
    background: "var(--admin-input-bg)",
    color: "var(--admin-input-text)",
    padding: "4px 8px",
    minHeight: 34,
    borderRadius: 12,
    boxShadow: "0 4px 12px rgba(15,23,42,0.12)",
    minWidth: 0,
  };
  const headerCompactValueBoxStyle: React.CSSProperties = {
    ...headerValueBoxStyle,
    flex: "initial",
    width: "100%",
    maxWidth: 150,
  };
  const headerAlignedValueBoxStyle: React.CSSProperties = {
    ...headerValueBoxStyle,
    flex: "initial",
    width: 150,
  };
  const headerInputStyle: React.CSSProperties = {
    flex: 1,
    border: 0,
    background: "transparent",
    color: "var(--admin-input-text)",
    fontSize: 14,
    fontWeight: 600,
    outline: "none",
    minWidth: 0,
  };
  const headerInfoPrimaryStyle: React.CSSProperties = {
    fontWeight: 700,
    fontSize: 13,
    color: "var(--admin-table-text, #1e293b)",
  };
  const lineItemsColumnWidths = [360, 180, 80, 80, 140, 250, 50];
  const lineItemsTotalWidth = lineItemsColumnWidths.reduce(
    (sum, width) => sum + width,
    0,
  );
  const lineItemsPanelMaxWidth = Math.min(1280, lineItemsTotalWidth + 80);
  const lineItemsWrapperStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: lineItemsPanelMaxWidth,
    margin: "0 auto",
    maxHeight: 320,
    overflowX: "auto",
    overflowY: "auto",
    border: "1px solid var(--admin-card-border)",
    borderRadius: 16,
    background: "var(--admin-card-bg)",
    boxShadow: "inset 0 1px 0 var(--admin-card-inset)",
    position: "relative",
  };
  const lineItemsTableStyle: React.CSSProperties = {
    width: "100%",
    minWidth: lineItemsTotalWidth,
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
    color: "var(--admin-table-header-text)",
    backgroundColor: "var(--admin-card-bg)",
    backgroundImage: "linear-gradient(135deg, rgba(102,176,255,0.22), rgba(15,108,189,0.08))",
    position: "sticky",
    top: 0,
    zIndex: 2,
  };
  const lineItemsActionHeaderCellStyle: React.CSSProperties = {
    ...lineItemsHeaderCellStyle,
    position: "sticky",
    right: 0,
    zIndex: 3,
    boxShadow: "-6px 0 12px rgba(15,23,42,0.08)",
  };
  const lineItemsCellStyle: React.CSSProperties = {
    padding: "6px 7px",
    borderBottom: "1px solid rgba(148, 163, 184, 0.18)",
    verticalAlign: "middle",
    background: "transparent",
    fontSize: 13,
  };
  const lineItemsInputStyle: React.CSSProperties = {
    width: "100%",
    border: "1px solid var(--admin-input-border)",
    background: "var(--admin-input-bg)",
    color: "var(--admin-input-text)",
    padding: "5px 6px",
    borderRadius: 6,
    boxSizing: "border-box",
    fontSize: 13,
    boxShadow: "inset 0 1px 0 rgba(15,23,42,0.12)",
  };
  const lineItemsNumericInputStyle: React.CSSProperties = {
    ...lineItemsInputStyle,
    textAlign: "right",
  };
  const lineItemsDateInputStyle: React.CSSProperties = {
    ...lineItemsInputStyle,
    textAlign: "left",
  };
  const lineItemsDropdownButtonStyle: React.CSSProperties = {
    ...lineItemsInputStyle,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    cursor: "pointer",
    fontWeight: 500,
    textAlign: "left",
  };
  const lineItemsActionCellStyle: React.CSSProperties = {
    ...lineItemsCellStyle,
    textAlign: "center",
    position: "sticky",
    right: 0,
    background: "var(--admin-card-bg)",
    boxShadow: "-6px 0 10px rgba(15,23,42,0.06)",
    zIndex: 1,
  };
  const itemPickerOptions = useMemo<ItemPickerOption<OrderLineOption>[]>(
    () =>
      orderLineOptions.map((option) => {
        const description = option.description?.trim() ?? "";
        const partNo = option.part_no?.trim() ?? "";
        const stockQtyValue = Number(option.stock_qty);
        const stockQty = Number.isFinite(stockQtyValue)
          ? formatQty(stockQtyValue)
          : "";
        const idParts = [
          option.line_no != null ? `line-${option.line_no}` : "unassigned",
          description.toLowerCase(),
          partNo.toLowerCase(),
        ];
        return {
          id: idParts
            .map((part) => part.trim())
            .filter((part) => part.length > 0)
            .join("-"),
          label: description || (partNo ? `Part No: ${partNo}` : "Unnamed item"),
          description: partNo ? `Part No: ${partNo}` : "No part number",
          meta: stockQty ? `Stock Qty: ${stockQty}` : undefined,
          value: option,
          searchText: `${description} ${partNo} ${stockQty} ${option.line_no ?? ""}`.trim(),
        } satisfies ItemPickerOption<OrderLineOption>;
      }),
    [orderLineOptions],
  );
  const activePickerRow = itemPickerState
    ? rows.find((candidate) => candidate.id === itemPickerState.rowId) ?? null
    : null;
  const itemPickerClearDisabled =
    !activePickerRow ||
    (activePickerRow.line_no == null && !activePickerRow.description && !activePickerRow.part_no);
  const voucherDateDisplay = formatDisplayDate(header.so_voucher_date);
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
    padding: "7px 18px",
    borderRadius: 999,
    fontWeight: 600,
    fontSize: 14,
    boxShadow: "0 8px 18px rgba(15,23,42,0.15)",
    transition: "transform 0.15s ease, box-shadow 0.2s ease",
    cursor: "pointer",
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
  const toastBaseStyle: React.CSSProperties = {
    position: "fixed",
    bottom: 24,
    right: 24,
    padding: "12px 18px",
    borderRadius: 12,
    fontWeight: 600,
    fontSize: 14,
    boxShadow: "0 12px 30px rgba(15,23,42,0.2)",
    zIndex: 1000,
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
  if (loading) return <div>Loading…</div>;

  return (
    <div style={pageWrapperStyle}>
      <fieldset style={sectionFieldsetStyle}>
        <legend style={fieldsetLegendStyle}>Delivery</legend>
        <div style={headerTableStyle}>
          <div style={headerRowStyle}>
            <label style={headerLabelStyle} htmlFor="voucher-no">
              Sales Order No
            </label>
            <div style={headerCellStyle}>
              <div style={headerInputShellStyle}>
                <div style={headerCompactValueBoxStyle}>
                  <input
                    id="voucher-no"
                    ref={voucherInputRef}
                    value={voucherInput}
                    onChange={handleVoucherInputChange}
                    onBlur={handleVoucherBlur}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleVoucherLookup();
                      }
                    }}
                    style={headerInputStyle}
                    placeholder="Enter SO number"
                    autoComplete="off"
                  />
                </div>
              </div>
            </div>
            <label style={headerOffsetLabelStyle}>Company</label>
            <div style={headerOffsetCellStyle}>
              <div
                style={{
                  ...headerValueBoxStyle,
                  flex: "initial",
                  width: "100%",
                  maxWidth: 350,
                }}
              >
                <span style={headerInfoPrimaryStyle}>{header.company_name || "—"}</span>
              </div>
            </div>
          </div>

          <div style={headerRowStyle}>
            <label style={headerLabelStyle}>Sales Order Date</label>
            <div style={headerCellStyle}>
              <div style={headerAlignedValueBoxStyle}>
                <span style={{ ...headerInfoPrimaryStyle, fontWeight: 600 }}>
                  {voucherDateDisplay || "—"}
                </span>
              </div>
            </div>
            <label style={headerOffsetLabelStyle}>Client</label>
            <div style={headerOffsetCellStyle}>
              <div style={{ ...headerValueBoxStyle, flex: "initial", width: "100%", maxWidth: 350 }}>
                <span style={headerInfoPrimaryStyle}>{header.client_name || "—"}</span>
              </div>
            </div>
          </div>

        </div>
      </fieldset>

      <fieldset style={{ ...sectionFieldsetStyle, padding: 12 }}>
        <legend style={fieldsetLegendStyle}>Line Items</legend>
        <div style={lineItemsWrapperStyle}>
          <table style={lineItemsTableStyle}>
            <colgroup>
              {lineItemsColumnWidths.map((width, index) => (
                <col key={index} style={{ width }} />
              ))}
</colgroup>
            <thead>
              <tr>
                <th style={lineItemsHeaderCellStyle}>Description of Goods</th>
                <th style={lineItemsHeaderCellStyle}>Part No</th>
                <th style={lineItemsHeaderCellStyle}>Stock Qty</th>
                <th style={lineItemsHeaderCellStyle}>Dely Qty</th>
                <th style={lineItemsHeaderCellStyle}>Dely Date</th>
                <th style={lineItemsHeaderCellStyle}>Reason</th>
                <th style={lineItemsActionHeaderCellStyle} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const validation = rowValidationSummary.map.get(row.id);
                const displayError = validation?.displayError ?? null;
                const rowIndex = rows.findIndex((candidate) => candidate.id === row.id);
                const nextRow = rowIndex >= 0 && rowIndex < rows.length - 1 ? rows[rowIndex + 1] : null;
                const clearDisabled = row.line_no == null && !row.description && !row.part_no;
                const hasError = Boolean(displayError);
                const errorBackground = hasError
                  ? isDarkTheme
                    ? "rgba(239,68,68,0.16)"
                    : "rgba(248,113,113,0.16)"
                  : "transparent";
                const dropdownButtonStyle: React.CSSProperties = {
                  ...lineItemsDropdownButtonStyle,
                  color: row.description
                    ? "var(--admin-input-text)"
                    : "var(--admin-muted-text, #94a3b8)",
                  cursor: orderLineOptions.length === 0 ? "not-allowed" : "pointer",
                  opacity: orderLineOptions.length === 0 ? 0.6 : 1,
                };
                const inputErrorStyle: React.CSSProperties | undefined = hasError
                  ? {
                      borderColor: "rgba(209,52,56,0.65)",
                      boxShadow: "0 0 0 1px rgba(209,52,56,0.35)",
                      background: isDarkTheme
                        ? "rgba(96,17,22,0.35)"
                        : "rgba(255,224,224,0.75)",
                    }
                  : undefined;
                const cellBaseStyle = hasError
                  ? { ...lineItemsCellStyle, background: errorBackground }
                  : lineItemsCellStyle;
                const actionCellStyle = hasError
                  ? { ...lineItemsActionCellStyle, background: errorBackground }
                  : lineItemsActionCellStyle;
                const errorCellStyle: React.CSSProperties = hasError
                  ? {
                      ...lineItemsCellStyle,
                      background: errorBackground,
                      color: isDarkTheme ? "#f4abab" : "#a4262c",
                      fontWeight: 600,
                      fontSize: 12,
                    }
                  : {
                      ...lineItemsCellStyle,
                      color: isDarkTheme ? "var(--admin-muted-text, #94a3b8)" : "#605e5c",
                      fontSize: 12,
                    };
                const pickerInitialQuery = row.description || row.part_no || "";
                const stockQtyDisplay = formatQty(row.stock_qty);
                return (
                  <tr key={row.id}>
                    <td style={cellBaseStyle}>
                      <button
                        type="button"
                        onClick={() => openItemPicker(row.id, pickerInitialQuery)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
                            event.preventDefault();
                            openItemPicker(row.id, pickerInitialQuery);
                          } else if (event.key === "ArrowDown") {
                            event.preventDefault();
                            openItemPicker(row.id, pickerInitialQuery);
                          } else if (event.key === "Backspace" || event.key === "Delete") {
                            if (!clearDisabled) {
                              event.preventDefault();
                              handleItemPickerClear(row.id);
                            }
                          }
                        }}
                        ref={(element) => registerCellRef(row.id, "description", element)}
                        style={{
                          ...dropdownButtonStyle,
                          ...(inputErrorStyle ? inputErrorStyle : {}),
                        }}
                        disabled={orderLineOptions.length === 0}
                        aria-haspopup="dialog"
                        aria-expanded={itemPickerState?.rowId === row.id}
                      >
                        <span
                          style={{
                            flex: 1,
                            display: "flex",
                            alignItems: "center",
                            minWidth: 0,
                          }}
                        >
                          <span
                            style={{
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              width: "100%",
                            }}
                          >
                            {row.description || "Select item"}
                          </span>
                        </span>
                        <span style={{ opacity: 0.5 }}>▾</span>
                      </button>
                    </td>
                    <td style={cellBaseStyle}>
                      <input
                        type="text"
                        value={row.part_no}
                        readOnly
                        tabIndex={-1}
                        style={{
                          ...lineItemsInputStyle,
                          fontWeight: 500,
                          cursor: "not-allowed",
                          color: row.part_no
                            ? "var(--admin-input-text)"
                            : "var(--admin-muted-text, #94a3b8)",
                          ...(inputErrorStyle ? inputErrorStyle : {}),
                        }}
                        disabled
                      />
                    </td>
                    <td style={cellBaseStyle}>
                      <input
                        type="text"
                        value={stockQtyDisplay}
                        readOnly
                        tabIndex={-1}
                        style={{
                          ...lineItemsNumericInputStyle,
                          fontWeight: 500,
                          cursor: "not-allowed",
                          color: stockQtyDisplay
                            ? "var(--admin-input-text)"
                            : "var(--admin-muted-text, #94a3b8)",
                          ...(inputErrorStyle ? inputErrorStyle : {}),
                        }}
                        disabled
                      />
                    </td>
                    <td style={cellBaseStyle}>
                      <input
                        type="text"
                        value={row.dely_qty}
                        onChange={(e) => handleDelQtyChange(row.id, e.target.value)}
                        onBlur={() => handleDelQtyBlur(row.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            focusCell(row.id, "dely_date");
                            return;
                          }
                          decimalKeyGuard(e, row.dely_qty);
                        }}
                        onPaste={(e) =>
                          decimalPasteGuard(e, (val) => handleDelQtyChange(row.id, val))
                        }
                        ref={(element) => registerCellRef(row.id, "dely_qty", element)}
                        style={{
                          ...lineItemsNumericInputStyle,
                          ...(inputErrorStyle ? inputErrorStyle : {}),
                        }}
                        disabled={row.line_no == null}
                      />
                    </td>
                    <td style={cellBaseStyle}>
                      <input
                        type="text"
                        value={row.dely_date}
                        placeholder="dd-mm-yyyy"
                        onChange={(event) =>
                          handleDelyDateChange(row.id, event.target.value)
                        }
                        onBlur={() => handleDelyDateBlur(row.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            if (nextRow) {
                              focusCell(nextRow.id, "description");
                            } else {
                              addEmptyRow();
                            }
                          }
                        }}
                        inputMode="numeric"
                        pattern="\d{2}-\d{2}-\d{4}"
                        maxLength={10}
                        ref={(element) => registerCellRef(row.id, "dely_date", element)}
                        style={{
                          ...lineItemsDateInputStyle,
                          ...(inputErrorStyle ? inputErrorStyle : {}),
                        }}
                        disabled={row.line_no == null}
                      />
                    </td>
                    <td style={errorCellStyle}>{displayError ?? ""}</td>
                    <td style={actionCellStyle}>
                      <button
                        type="button"
                        onClick={() => handleDeleteRow(row.id)}
                        style={{
                          ...lineItemsInputStyle,
                          padding: "4px 8px",
                          fontWeight: 700,
                          cursor: "pointer",
                          ...(inputErrorStyle ? inputErrorStyle : {}),
                        }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </fieldset>

      <div style={actionButtonsWrapperStyle}>
        <button
          type="button"
          onClick={handleSave}
          disabled={!isReady || saving}
          title="Save"
          style={{
            ...saveButtonStyle,
            opacity: !isReady || saving ? 0.65 : 1,
            cursor: !isReady || saving ? "not-allowed" : "pointer",
          }}
        >
          <span role="img" aria-label="save">
            💾
          </span>
          <span>{saving ? "Saving…" : "Save"}</span>
        </button>
        <button type="button" onClick={() => handleClear()} title="Clear" style={clearButtonStyle}>
          <span role="img" aria-label="clear">
            🧹
          </span>
          <span>Clear</span>
        </button>
        <button type="button" onClick={handleCancel} title="Cancel" style={cancelButtonStyle}>
          <span role="img" aria-label="cancel">
            ❌
          </span>
          <span>Cancel</span>
        </button>
      </div>
      <ItemPickerModal
        isOpen={Boolean(itemPickerState)}
        title="Select line item"
        options={itemPickerOptions}
        onClose={() => closeItemPicker(true)}
        onSelect={(option) => {
          if (!itemPickerState) return;
          handleItemPickerSelect(itemPickerState.rowId, option.value);
        }}
        onClear={
          itemPickerState ? () => handleItemPickerClear(itemPickerState.rowId) : undefined
        }
        disableClear={itemPickerClearDisabled}
        initialQuery={itemPickerState?.initialQuery ?? ""}
        searchPlaceholder="Search description or part no"
        emptyMessage="No matches found"
      />
      {toast && (
        <div
          style={{
            ...toastBaseStyle,
            ...(toast.kind === "success" ? toastSuccessStyle : toastErrorStyle),
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}