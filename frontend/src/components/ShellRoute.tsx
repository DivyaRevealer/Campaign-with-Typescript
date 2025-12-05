import Sidebar from "./Sidebar.tsx";
import Topbar from "./Topbar.tsx";
import "./sidebar.css";
import { Outlet } from "react-router-dom";

export default function ShellRoute() {
  return (
    <div className="ims-shell">
      <Sidebar />
      <div className="ims-main">
        <Topbar />
        <main className="ims-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}