import { isAxiosError } from "axios";

type ValidationError = { msg?: string };

type ErrorDetail = string | ValidationError[] | undefined;

type ApiErrorResponse = {
  detail?: ErrorDetail;
};

const isValidationErrorArray = (value: unknown): value is ValidationError[] =>
  Array.isArray(value) && value.every((item) => item && typeof item.msg === "string");

export const extractApiErrorMessage = (error: unknown, fallback: string) => {
  if (isAxiosError<ApiErrorResponse>(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
    if (isValidationErrorArray(detail)) {
      const joined = detail
        .map((entry) => entry.msg?.trim())
        .filter((msg): msg is string => Boolean(msg))
        .join("; ");
      if (joined) {
        return joined;
      }
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
};