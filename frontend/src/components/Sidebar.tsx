import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { ACCESS_TOKEN_KEY, LOGOUT_EVENT, dispatchAuthEvent } from "@/constants/auth";

import "./sidebar.css";

type Group = "master" | "txn" | "reports" | "campaign";

const SIDEBAR_COLLAPSE_KEY = "ims::sidebar-collapsed";

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
  });
  const [open, setOpen] = useState<Record<Group, boolean>>({
    master: true,
    txn: true,
    reports: true,
    campaign: true,
  });
  const { pathname } = useLocation();
  const toggle = (group: Group) => setOpen((state) => ({ ...state, [group]: !state[group] }));
  const isActive = (to: string) => pathname === to;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const toggleSidebar = () => setCollapsed((state) => !state);

  const signout = () => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    dispatchAuthEvent(LOGOUT_EVENT);
  };

  return (
    <aside className={`ims-sidebar ${collapsed ? "collapsed" : ""}`}>
      <button
        type="button"
        className="ims-sidebar-collapse-toggle"
        onClick={toggleSidebar}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <span
          className={`chevron ${collapsed ? "collapsed" : ""}`}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" role="presentation" focusable="false">
            <path
              d="M14 6l-6 6 6 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      <div className="ims-side-nav">
        <div className={`ims-group ${open.master ? "open" : ""}`}>
          <button
            className="ims-group-hd"
            onClick={() => toggle("master")}
            type="button"
            aria-expanded={open.master}
            title={collapsed ? "Master" : undefined}
          >
            <span className="ico" aria-hidden="true">
              📦
            </span>
            <span className="label">Master</span>
            <span className="caret" aria-hidden="true">
              {open.master ? "▾" : "▸"}
            </span>
          </button>
          <nav aria-label="Master navigation">
            <Link
              to="/companies"
              className={isActive("/companies") ? "active" : ""}
              title={collapsed ? "Company Master" : undefined}
            >
              <span className="ico" aria-hidden="true">
                🏢
              </span>
              <span className="label">Company Master</span>
            </Link>
            <Link
              to="/clients"
              className={isActive("/clients") ? "active" : ""}
              title={collapsed ? "Customer Master" : undefined}
            >
              <span className="ico" aria-hidden="true">
                👤
              </span>
              <span className="label">Customer Master</span>
            </Link>
            {/*
            <Link to="/items" className={isActive("/items") ? "active" : ""}>
              <span className="ico" aria-hidden="true">
                🧱
              </span>
              Item Master
            </Link>
            */}
          </nav>
        </div>

        <div className={`ims-group ${open.txn ? "open" : ""}`}>
          <button
            className="ims-group-hd"
            onClick={() => toggle("txn")}
            type="button"
            aria-expanded={open.txn}
            title={collapsed ? "Transaction" : undefined}
          >
            <span className="ico" aria-hidden="true">
              🧾
            </span>
            <span className="label">Transaction</span>
            <span className="caret" aria-hidden="true">
              {open.txn ? "▾" : "▸"}
            </span>
          </button>
          <nav aria-label="Transaction navigation">
            <Link
              to="/salesorder"
              className={isActive("/salesorder") ? "active" : ""}
              title={collapsed ? "Sales Order" : undefined}
            >
              <span className="ico" aria-hidden="true">
                📄
              </span>
              <span className="label">Sales Order</span>
            </Link>
            {/*
            <Link to="/po" className={isActive("/po") ? "active" : ""}>
              <span className="ico" aria-hidden="true">
                🛒
              </span>
              Purchase Order
            </Link>
            */}
            {/*
            <Link to="/inventory" className={isActive("/inventory") ? "active" : ""}>
              <span className="ico" aria-hidden="true">
                🗃
              </span>
              Inventory
            </Link>
            */}
            <Link
              to="/production"
              className={isActive("/production") ? "active" : ""}
              title={collapsed ? "Production" : undefined}
            >
              <span className="ico" aria-hidden="true">
                🏭
              </span>
              <span className="label">Production</span>
            </Link>
            <Link
              to="/delivery"
              className={isActive("/delivery") ? "active" : ""}
              title={collapsed ? "Delivery" : undefined}
            >
              <span className="ico" aria-hidden="true">
                🚚
              </span>
              <span className="label">Delivery</span>
            </Link>
          </nav>
        </div>

        <div className={`ims-group ${open.reports ? "open" : ""}`}>
          <button
            className="ims-group-hd"
            onClick={() => toggle("reports")}
            type="button"
            aria-expanded={open.reports}
            title={collapsed ? "Reports" : undefined}
          >
            <span className="ico" aria-hidden="true">
              📊
            </span>
            <span className="label">Reports</span>
            <span className="caret" aria-hidden="true">
              {open.reports ? "▾" : "▸"}
            </span>
          </button>
          <nav aria-label="Reports navigation">
            <Link
              to="/reports/summary"
              className={isActive("/reports/summary") ? "active" : ""}
              title={collapsed ? "Summary" : undefined}
            >
              <span className="ico" aria-hidden="true">
                📈
              </span>
              <span className="label">Summary</span>
            </Link>
            <Link
              to="/reports/production"
              className={isActive("/reports/production") ? "active" : ""}
              title={collapsed ? "Production Reports" : undefined}
            >
              <span className="ico" aria-hidden="true">
                🏭
              </span>
              <span className="label">Production</span>
            </Link>
            <Link
              to="/reports/delivery"
              className={isActive("/reports/delivery") ? "active" : ""}
              title={collapsed ? "Delivery Reports" : undefined}
            >
              <span className="ico" aria-hidden="true">
                🚚
              </span>
              <span className="label">Delivery</span>
            </Link>
          </nav>
        </div>

        <div className={`ims-group ${open.campaign ? "open" : ""}`}>
          <button
            className="ims-group-hd"
            onClick={() => toggle("campaign")}
            type="button"
            aria-expanded={open.campaign}
            title={collapsed ? "Campaign" : undefined}
          >
            <span className="ico" aria-hidden="true">
              🎯
            </span>
            <span className="label">Campaign</span>
            <span className="caret" aria-hidden="true">
              {open.campaign ? "▾" : "▸"}
            </span>
          </button>
          <nav aria-label="Campaign navigation">
            <Link
              to="/campaign/dashboard"
              className={isActive("/campaign/dashboard") ? "active" : ""}
              title={collapsed ? "Dashboard" : undefined}
            >
              <span className="ico" aria-hidden="true">
                📊
              </span>
              <span className="label">Dashboard</span>
            </Link>
            <Link
              to="/campaign/new"
              className={isActive("/campaign/new") ? "active" : ""}
              title={collapsed ? "Create Campaign" : undefined}
            >
              <span className="ico" aria-hidden="true">
                ➕
              </span>
              <span className="label">Create Campaign</span>
            </Link>
            <Link
              to="/campaign/summary"
              className={isActive("/campaign/summary") ? "active" : ""}
              title={collapsed ? "Campaign Summary" : undefined}
            >
              <span className="ico" aria-hidden="true">
                📋
              </span>
              <span className="label">Campaign Summary</span>
            </Link>
            <Link
              to="/template/create"
              className={isActive("/template/create") ? "active" : ""}
              title={collapsed ? "Create Template" : undefined}
            >
              <span className="ico" aria-hidden="true">
                📝
              </span>
              <span className="label">Create Template</span>
            </Link>
            <Link
              to="/template/run"
              className={isActive("/template/run") ? "active" : ""}
              title={collapsed ? "Run Template" : undefined}
            >
              <span className="ico" aria-hidden="true">
                ▶️
              </span>
              <span className="label">Run Template</span>
            </Link>
          </nav>
        </div>
      </div>

      <div className="ims-side-footer">
        <Link
          className="btn-logout"
          to="/login"
          onClick={signout}
          title={collapsed ? "Sign out" : undefined}
        >
          <span className="ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="presentation" focusable="false">
              <path
                d="M10 4H7a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h3"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <path
                d="M13 8l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <path
                d="M17 12H6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </span>
          <span className="label">Sign out</span>
        </Link>
      </div>
    </aside>
  );
}