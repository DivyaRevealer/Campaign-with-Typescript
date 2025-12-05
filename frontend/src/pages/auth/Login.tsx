import { useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import http from "../../api/http";
import { extractApiErrorMessage } from "../../api/errors";
import {
  ACCESS_TOKEN_KEY,
  LOGIN_EVENT,
  dispatchAuthEvent,
} from "@/constants/auth";

import logo from "@/assets/logo.png";

import "./Login.css";

export default function Login() {
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const usernameInputRef = useRef<HTMLInputElement>(null);

  const handleUsernameChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (message) setMessage("");
    setUsername(event.target.value);
  };

  const handlePasswordChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (message) setMessage("");
    setPassword(event.target.value);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setMessage("");
    setIsSubmitting(true);

    try {
      const response = await http.post<{ access_token?: string }>("/auth/login", { username, password });
      const token = response.data?.access_token;

      if (token) {
        localStorage.setItem(ACCESS_TOKEN_KEY, token);
        dispatchAuthEvent(LOGIN_EVENT);
        nav("/", { replace: true });
        return;
      } else {
        setMessage("No access token returned");
      }
    } catch (error) {
      setIsSubmitting(false);
      setMessage(extractApiErrorMessage(error, "Login failed"));
      setPassword("");
      requestAnimationFrame(() => {
        usernameInputRef.current?.focus();
        usernameInputRef.current?.select?.();
      });
      return;
    }

    setIsSubmitting(false);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <img src={logo} alt="Company logo" className="login-logo" />
          <h1 className="login-heading" style={{ textAlign: 'center' }}>Inventory Management System</h1>
          {/*
          <p className="login-subtitle">
            Track stock levels, fulfil orders, and keep your operations aligned in
            one secure workspace.
          </p>
          */}
        </div>

        <form className="login-form" onSubmit={submit}>

          <label className="login-label" htmlFor="username">
            Username
          </label>
          <input
            id="username"
            className="login-input"
            placeholder="Username*"
            value={username}
            onChange={handleUsernameChange}
            ref={usernameInputRef}
            autoComplete="username"
            autoFocus
            required
          />

          <label className="login-label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            className="login-input"
            placeholder="Password*"
            value={password}
            onChange={handlePasswordChange}
            autoComplete="current-password"
            required
          />

          {message && (
            <p className="login-error-text" role="alert" aria-live="polite">
              {message}
            </p>
          )}

          <button className="login-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

      </div>
      <p className="login-footer">Powered by Revealer</p>
    </div>
  );
}