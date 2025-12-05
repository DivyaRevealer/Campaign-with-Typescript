import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { fetchClients, type Client, type ClientListResponse } from "../../api/clients";
import ClientForm from "./ClientForm";
import "../common/adminTheme.css";

const statusPill = (active: "Y" | "N") => (
  <span className={`status-pill ${active === "Y" ? "active" : "inactive"}`}>
    {active === "Y" ? "Active" : "Inactive"}
  </span>
);

const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="11" cy="11" r="7" />
    <line x1="20" y1="20" x2="16.65" y2="16.65" />
  </svg>
);

const PlusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export default function ClientList() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const limit = 10;
  const firstLoadRef = useRef(true);

  const load = useCallback(
    async (p = 0, search = q) => {
      const query = search.trim();
      const { items, total }: ClientListResponse = await fetchClients({
        q: query,
        limit,
        offset: p * limit,
      });
      setRows(items);
      setTotal(total);
      setPage(p);
    },
    [q]
  );

  useEffect(() => {
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      load(0, q);
      return;
    }
    const handle = window.setTimeout(() => load(0, q), 400);
    return () => window.clearTimeout(handle);
  }, [q, load]);

  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      load(0, (e.currentTarget.value || "").trim());
    }
  };

  const afterSave = () => {
    setShowCreate(false);
    load(0);
  };

  return (
    <div className="admin-page">
      <div className="admin-toolbar">
        <div className="admin-search">
          <span className="search-icon">
            <SearchIcon />
          </span>
          <input
            placeholder="Search name, city, email or phone"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onEnter}
          />
        </div>
        <div className="admin-actions">
          <button className="admin-add-btn" onClick={() => setShowCreate(true)}>
            <PlusIcon /> Add client
          </button>
        </div>
      </div>

      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead>
            <tr>
              {["Code", "Name", "City", "State", "Phone", "Email", "Status", ""].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.client_code}>
                <td style={{ whiteSpace: "nowrap" }}>{r.client_code}</td>
                <td>{r.client_name}</td>
                <td>{r.client_city || ""}</td>
                <td>{r.client_state || ""}</td>
                <td style={{ whiteSpace: "nowrap" }}>{r.client_contact_no || ""}</td>
                <td>{r.client_email || ""}</td>
                <td>{statusPill(r.active_flag)}</td>
                <td>
                  <Link className="table-link" to={`/clients/${encodeURIComponent(r.client_code)}`}>
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 28, textAlign: "center", color: "#94a3b8" }}>
                  No records found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {total > limit && (
        <div className="admin-pagination">
          <button disabled={page === 0} onClick={() => load(page - 1)}>
            Previous
          </button>
          <span>
            Page {page + 1} / {Math.ceil(total / limit)}
          </span>
          <button disabled={(page + 1) * limit >= total} onClick={() => load(page + 1)}>
            Next
          </button>
        </div>
      )}

      {showCreate && (
        <ClientForm
          onClose={() => setShowCreate(false)}
          onSaved={afterSave}
        />
      )}
    </div>
  );
}