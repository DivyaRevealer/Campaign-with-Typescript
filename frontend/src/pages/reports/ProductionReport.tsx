import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { isAxiosError } from "axios";

import { getProductionReport, type ProductionReportResponse } from "@/api/productionReports";
import ExportMenu from "@/components/ExportMenu";
import { exportToExcel, sanitizeFileName, sanitizeSheetName } from "@/utils/excel";

import "../common/adminTheme.css";
import "./productionReport.css";

const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="11" cy="11" r="7" />
    <line x1="20" y1="20" x2="16.65" y2="16.65" />
  </svg>
);

const ClearIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);

const columns = ["Description of Goods", "Part No", "Date", "Quantity"] as const;

const formatDate = (value?: string | null) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(parsed);
};

const formatQuantity = (value: string) => {
  if (!value) return "0";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return value;
  const options: Intl.NumberFormatOptions = {
    minimumFractionDigits: numeric % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  };
  return new Intl.NumberFormat("en-IN", options).format(numeric);
};

export default function ProductionReport() {
  const [soNo, setSoNo] = useState("");
  const [report, setReport] = useState<ProductionReportResponse | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasRequested, setHasRequested] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const totalQuantity = useMemo(() => {
    if (!report?.items?.length) return "0";
    const parsedQuantities = report.items.map((item) => Number(item.prod_qty));
    if (parsedQuantities.some((value) => Number.isNaN(value))) {
      return "—";
    }
    const sum = parsedQuantities.reduce((acc, value) => acc + value, 0);
    return formatQuantity(String(sum));
  }, [report]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = soNo.trim();

    if (!query) {
      setValidationError("Please enter a Sales Order No.");
      setApiError(null);
      setReport(null);
      setHasRequested(false);
      return;
    }

    setValidationError(null);
    setApiError(null);
    setLoading(true);
    setHasRequested(true);

    try {
      const data = await getProductionReport(query);
      setReport(data);
    } catch (error) {
      setReport(null);
      if (isAxiosError(error)) {
        const detail = error.response?.data?.detail;
        if (typeof detail === "string" && detail.trim()) {
          setApiError(detail);
        } else {
          setApiError("Unable to load the production report. Please try again.");
        }
      } else {
        setApiError("Unable to load the production report. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const onClearSearch = () => {
    setSoNo("");
    setReport(null);
    setValidationError(null);
    setApiError(null);
    setHasRequested(false);
    searchInputRef.current?.focus();
  };

  const canExport = Boolean(report && report.items.length > 0);

  const handleExport = () => {
    if (!report || report.items.length === 0) {
      return;
    }

    const header = [...columns];
    const rows = report.items.map((item) => [
      item.description ?? "",
      item.part_no ?? "",
      formatDate(item.prod_date),
      formatQuantity(item.prod_qty),
    ]);

    const safeFileName = `${sanitizeFileName(report.so_no, "production-report")}.xlsx`;
    const sheetName = sanitizeSheetName(report.so_no, "Production");

    exportToExcel({ header, rows, fileName: safeFileName, sheetName });
  };

  return (
    <div className="admin-page production-report-page">
      <header className="production-report__header">
        <div className="production-report__header-content">
          <h1>Production Report</h1>
          <p>Look up completed production quantities by entering a Sales Order No.</p>
        </div>
        <div className="production-report__header-actions">
          <ExportMenu onSelectExcel={handleExport} disabled={!canExport} />
        </div>
      </header>

      <form className="production-report__search-form" onSubmit={onSubmit} role="search" aria-label="Production report search">
        <div className={`admin-search${soNo ? " admin-search--has-value" : ""}`}>
          <label className="visually-hidden" htmlFor="production-report-search">
            Sales Order No
          </label>
          <span className="search-icon">
            <SearchIcon />
          </span>
          <input
            id="production-report-search"
            placeholder="Search by Sales Order No"
            value={soNo}
            onChange={(event) => {
              setSoNo(event.target.value);
              if (validationError) {
                setValidationError(null);
              }
            }}
            autoComplete="off"
            ref={searchInputRef}
          />
          {soNo && (
            <button
              type="button"
              className="admin-search__clear"
              onClick={onClearSearch}
              aria-label="Clear search"
              disabled={loading}
            >
              <ClearIcon />
            </button>
          )}
        </div>
      </form>
      {validationError && <p className="inline-message" role="alert">{validationError}</p>}

      {apiError && (
        <div className="message-banner" role="alert">
          {apiError}
        </div>
      )}

      {report && report.items.length > 0 && (
        <div className="production-report__summary" role="status">
          <span>
            Sales Order: <strong>{report.so_no}</strong>
          </span>
          <span>
            Lines: <strong>{report.items.length}</strong>
          </span>
          <span>
            Total Quantity: <strong>{totalQuantity}</strong>
          </span>
        </div>
      )}

      <div className="admin-table-wrapper" aria-live="polite">
        {loading && <div className="production-report__status">Fetching production details…</div>}

        {!loading && hasRequested && report && report.items.length === 0 && (
          <div className="production-report__status">
            No production records found for <strong>{report.so_no}</strong>.
          </div>
        )}

        {!loading && !report && !apiError && !validationError && !hasRequested && (
          <div className="production-report__status">
            Enter a Sales Order No above to view the production report.
          </div>
        )}

        {!loading && report && report.items.length > 0 && (
          <table className="admin-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.items.map((item, index) => (
                <tr key={`${item.description}-${item.part_no ?? ""}-${item.prod_date ?? index}`}>
                  <td>{item.description}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{item.part_no || ""}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{formatDate(item.prod_date)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{formatQuantity(item.prod_qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}