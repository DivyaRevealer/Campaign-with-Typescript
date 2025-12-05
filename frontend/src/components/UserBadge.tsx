import { useEffect, useMemo, useRef, useState } from "react";

import { getMe } from "../api/me";
import {
  ACCESS_TOKEN_KEY,
  LOGIN_EVENT,
  LOGOUT_EVENT,
} from "@/constants/auth";

import "./UserBadge.css";

const REFRESH_COOKIE = "ims_refresh=";

const isBrowser = typeof window !== "undefined";

const readAuthSignature = () => {
  if (!isBrowser) return "";
  const token = window.localStorage.getItem(ACCESS_TOKEN_KEY) ?? "";
  const hasRefresh = document.cookie.includes(REFRESH_COOKIE) ? "1" : "0";
  return `${token}|${hasRefresh}`;
};

const computeInitials = (value: string) => {
  if (!value) return "";
  const parts = value.trim().split(/\s+/).slice(0, 2);
  const initials = parts.map((segment) => segment[0]?.toUpperCase() ?? "");
  return initials.join("");
};

export default function UserBadge() {
  const [displayName, setDisplayName] = useState("");
  const [hidden, setHidden] = useState(() =>
    isBrowser ? window.location.pathname.startsWith("/login") : true,
  );
  const signatureRef = useRef(readAuthSignature());

  useEffect(() => {
    if (!isBrowser) return undefined;

    const loadUser = async () => {
      try {
        const user = await getMe();
        const name = user?.inv_display_name || user?.inv_user_name || "";
        setDisplayName(name);
      } catch {
        setDisplayName("");
      }
    };

    const evaluateVisibility = () => {
      const onLoginPage = window.location.pathname.startsWith("/login");
      setHidden(onLoginPage);
      if (!onLoginPage) loadUser();
    };

    evaluateVisibility();

    const handleFocus = () => evaluateVisibility();
    const handleAuthChange = () => {
      signatureRef.current = readAuthSignature();
      if (!window.location.pathname.startsWith("/login")) loadUser();
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("popstate", evaluateVisibility);
    window.addEventListener("hashchange", evaluateVisibility);
    window.addEventListener(LOGIN_EVENT, handleAuthChange as EventListener);
    window.addEventListener(LOGOUT_EVENT, handleAuthChange as EventListener);
    window.addEventListener("storage", handleAuthChange);

    const intervalId = window.setInterval(() => {
      const currentSignature = readAuthSignature();
      if (currentSignature !== signatureRef.current) {
        signatureRef.current = currentSignature;
        if (!window.location.pathname.startsWith("/login")) loadUser();
      }
    }, 2000);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("popstate", evaluateVisibility);
      window.removeEventListener("hashchange", evaluateVisibility);
      window.removeEventListener(LOGIN_EVENT, handleAuthChange as EventListener);
      window.removeEventListener(LOGOUT_EVENT, handleAuthChange as EventListener);
      window.removeEventListener("storage", handleAuthChange);
      window.clearInterval(intervalId);
    };
  }, []);

  const initials = useMemo(() => computeInitials(displayName), [displayName]);

  if (hidden || !displayName) return null;

  return (
    <div className="user-badge" role="status" aria-live="polite">
      <span className="user-badge__avatar" aria-hidden="true">
        {initials || "U"}
      </span>
      <span className="user-badge__label">
        <span>{displayName}</span>
        <small>Signed in</small>
      </span>
    </div>
  );
}