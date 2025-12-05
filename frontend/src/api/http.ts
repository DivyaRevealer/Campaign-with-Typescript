import axios, {
  AxiosHeaders,
  type AxiosError,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";

import {
  ACCESS_TOKEN_KEY,
  LOGIN_EVENT,
  LOGOUT_EVENT,
  dispatchAuthEvent,
} from "@/constants/auth";

const httpInstance: AxiosInstance = axios.create({
  baseURL: "/api",
  withCredentials: true, // for refresh cookie
});

type RetryableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

const applyAuthorizationHeader = (config: InternalAxiosRequestConfig, token: string) => {
  const headers = config.headers;
  if (headers instanceof AxiosHeaders) {
    headers.set("Authorization", `Bearer ${token}`);
    return;
  }

  const merged = AxiosHeaders.from(headers ? headers : {});
  merged.set("Authorization", `Bearer ${token}`);
  config.headers = merged;
};

const triggerLogout = () => {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  dispatchAuthEvent(LOGOUT_EVENT);
};

const ensureHeader = (
  config: InternalAxiosRequestConfig,
  name: string,
  value: string,
) => {
  const headers = config.headers;
  if (headers instanceof AxiosHeaders) {
    if (!headers.has(name)) {
      headers.set(name, value);
    }
    return;
  }

  const mergedHeaders = AxiosHeaders.from(headers ?? {});
  if (!mergedHeaders.has(name)) {
    mergedHeaders.set(name, value);
  }
  config.headers = mergedHeaders;
};

httpInstance.interceptors.request.use((config) => {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (token) {
    applyAuthorizationHeader(config, token);
  }

  const method = (config.method || "get").toLowerCase();
  if (["post", "put", "patch", "delete"].includes(method)) {
    const key =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    ensureHeader(config, "Idempotency-Key", key);
  }

  return config;
});

let isRefreshing = false;
let subscribers: Array<(token: string) => void> = [];

const onRefreshed = (token: string) => {
  subscribers.forEach((cb) => cb(token));
  subscribers = [];
};

const addSubscriber = (cb: (token: string) => void) => {
  subscribers.push(cb);
};

httpInstance.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const { response, config } = error;
    if (!response || response.status !== 401 || !config) {
      return Promise.reject(error);
    }

    const requestConfig = config as RetryableConfig;
    const requestUrl = requestConfig.url ?? "";
    const strippedUrl = requestUrl.replace(/^https?:\/\/[^/]+/i, "");
    const normalizedUrlBase = strippedUrl.replace(/^\/+/, "/");
    const normalizedUrl = normalizedUrlBase.startsWith("/")
      ? normalizedUrlBase
      : `/${normalizedUrlBase}`;

    // Do not attempt to refresh the token for authentication endpoints.
    // When the user enters invalid credentials we should immediately return
    // the 401 response so the login form can recover without being blocked by
    // the refresh retry logic.
    if (normalizedUrl.startsWith("/auth/login") || normalizedUrl.startsWith("/auth/refresh")) {
      return Promise.reject(error);
    }
    
    if (requestConfig._retry) {
      triggerLogout();
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
      return Promise.reject(error);
    }
    requestConfig._retry = true;

    if (isRefreshing) {
      return new Promise<AxiosResponse>((resolve, reject) => {
        addSubscriber((token) => {
          try {
            applyAuthorizationHeader(requestConfig, token);
            resolve(httpInstance(requestConfig));
          } catch (subscribeError) {
            reject(subscribeError);
          }
        });
      });
    }

    try {
      isRefreshing = true;
      const refreshResponse = await axios.post<{ access_token?: string }>(
        "/api/auth/refresh",
        null,
        { withCredentials: true },
      );
      const token = refreshResponse.data?.access_token;
      if (!token) {
        throw new Error("No token returned from refresh endpoint");
      }
      localStorage.setItem(ACCESS_TOKEN_KEY, token);
      dispatchAuthEvent(LOGIN_EVENT);
      onRefreshed(token);
      applyAuthorizationHeader(requestConfig, token);
      return httpInstance(requestConfig);
    } catch (refreshError) {
      triggerLogout();
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);

export const http = httpInstance;
export default httpInstance;