import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { isAxiosError } from "axios";

import { getSummaryReport, type SummaryReportResponse, type SummaryReportItem } from "@/api/summaryReports";
import ExportMenu from "@/components/ExportMenu";
import { exportToExcel, sanitizeFileName, sanitizeSheetName } from "@/utils/excel";

import "../common/adminTheme.css";
import "./summaryReport.css";

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

type NumericSummaryKey =
  | "ordered_qty"
  | "delivered_qty"
  | "yet_to_deliver_qty"
  | "stock_in_hand_qty"
  | "yet_to_produce_qty";

const sumField = (items: SummaryReportItem[], key: NumericSummaryKey) => {
  let hasInvalid = false;
  const total = items.reduce((acc, item) => {
    const rawValue = item[key];
    if (rawValue == null || rawValue === "") {
      return acc;
    }
    const numeric = Number(rawValue);
    if (Number.isNaN(numeric)) {
      hasInvalid = true;
      return acc;
    }
    return acc + numeric;
  }, 0);

  if (hasInvalid) {
    return "—";
  }
  return formatQuantity(String(total));
};

export default function SummaryReport() {
  const [soNo, setSoNo] = useState("");
  const [report, setReport] = useState<SummaryReportResponse | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasRequested, setHasRequested] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const totals = useMemo(() => {
    if (!report?.items?.length) {
      return null;
    }

    return {
      ordered: sumField(report.items, "ordered_qty"),
      delivered: sumField(report.items, "delivered_qty"),
      yetToDeliver: sumField(report.items, "yet_to_deliver_qty"),
      yetToProduce: sumField(report.items, "yet_to_produce_qty"),
    };
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
      const data = await getSummaryReport(query);
      setReport(data);
    } catch (error) {
      setReport(null);
      if (isAxiosError(error)) {
        const detail = error.response?.data?.detail;
        if (typeof detail === "string" && detail.trim()) {
          setApiError(detail);
        } else {
          setApiError("Unable to load the summary report. Please try again.");
        }
      } else {
        setApiError("Unable to load the summary report. Please try again.");
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

    const header = [
      "Description of Goods",
      "Part No",
      "Ordered",
      "Delivered",
      "Yet to Deliver",
      "Stock in Hand",
      "Yet to Produce",
    ];

    const rows = report.items.map((item) => [
      item.description ?? "",
      item.part_no ?? "",
      formatQuantity(item.ordered_qty),
      formatQuantity(item.delivered_qty),
      formatQuantity(item.yet_to_deliver_qty),
      formatQuantity(item.stock_in_hand_qty),
      formatQuantity(item.yet_to_produce_qty),
    ]);

    const safeFileName = `${sanitizeFileName(report.so_no, "summary-report")}.xlsx`;
    const sheetName = sanitizeSheetName(report.so_no, "Summary");

    exportToExcel({ header, rows, fileName: safeFileName, sheetName });
  };

  return (
    <div className="admin-page summary-report-page">
      <header className="summary-report__header">
        <div className="summary-report__header-content">
          <h1>Summary Report</h1>
          <p>Look up order, delivery, and production balances by Sales Order No.</p>
        </div>
        <div className="summary-report__header-actions">
          <ExportMenu onSelectExcel={handleExport} disabled={!canExport} />
        </div>
      </header>

      <form className="summary-report__search-form" onSubmit={onSubmit} role="search" aria-label="Summary report search">
        <div className={`admin-search${soNo ? " admin-search--has-value" : ""}`}>
          <label className="visually-hidden" htmlFor="summary-report-search">
            Sales Order No
          </label>
          <span className="search-icon">
            <SearchIcon />
          </span>
          <input
            id="summary-report-search"
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
        <div className="summary-report__summary" role="status">
          <span>
            Sales Order: <strong>{report.so_no}</strong>
          </span>
          <span>
            Lines: <strong>{report.items.length}</strong>
          </span>
          <span>
            Total Ordered: <strong>{totals ? totals.ordered : "—"}</strong>
          </span>
          <span>
            Total Delivered: <strong>{totals ? totals.delivered : "—"}</strong>
          </span>
          <span>
            Yet to Deliver: <strong>{totals ? totals.yetToDeliver : "—"}</strong>
          </span>
          <span>
            Yet to Produce: <strong>{totals ? totals.yetToProduce : "—"}</strong>
          </span>
        </div>
      )}

      <div className="admin-table-wrapper" aria-live="polite">
        {loading && <div className="summary-report__status">Fetching summary details…</div>}

        {!loading && hasRequested && report && report.items.length === 0 && (
          <div className="summary-report__status">
            No summary records found for <strong>{report.so_no}</strong>.
          </div>
        )}

        {!loading && !report && !apiError && !validationError && !hasRequested && (
          <div className="summary-report__status">
            Enter a Sales Order No above to view the summary report.
          </div>
        )}

        {!loading && report && report.items.length > 0 && (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Description of Goods</th>
                <th>Part No</th>
                <th style={{ textAlign: "right" }}>Ordered</th>
                <th style={{ textAlign: "right" }}>Delivered</th>
                <th style={{ textAlign: "right" }}>Yet to Deliver</th>
                <th style={{ textAlign: "right" }}>Stock in Hand</th>
                <th style={{ textAlign: "right" }}>Yet to Produce</th>
              </tr>
            </thead>
            <tbody>
              {report.items.map((item, index) => (
                <tr key={`${item.description}-${item.part_no ?? ""}-${index}`}>
                  <td>{item.description}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{item.part_no || ""}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{formatQuantity(item.ordered_qty)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{formatQuantity(item.delivered_qty)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{formatQuantity(item.yet_to_deliver_qty)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{formatQuantity(item.stock_in_hand_qty)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{formatQuantity(item.yet_to_produce_qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}