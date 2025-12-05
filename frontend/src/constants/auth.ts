export const ACCESS_TOKEN_KEY = "access_token";
export const LOGIN_EVENT = "ims:login";
export const LOGOUT_EVENT = "ims:logout";

export const dispatchAuthEvent = (type: typeof LOGIN_EVENT | typeof LOGOUT_EVENT) => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(type));
  }
};