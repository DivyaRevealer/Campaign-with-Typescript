import AdminThemeToggle from "../pages/common/AdminThemeToggle";
import { useAdminTheme } from "../pages/common/useAdminTheme";
import UserBadge from "./UserBadge.tsx";

import "../pages/common/adminTheme.css";
import "./topbar.css";

export default function Topbar() {
  const { theme, toggleTheme } = useAdminTheme();

  return (
    <header className="ims-topbar">
      <h1 className="ims-topbar__title">Campaign Management System</h1>
      <div className="ims-topbar__actions">
        <AdminThemeToggle theme={theme} onToggle={toggleTheme} />
        <div className="ims-topbar__user" aria-live="polite">
          <UserBadge />
        </div>
      </div>
    </header>
  );
}