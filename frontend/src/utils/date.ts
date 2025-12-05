export function isValidIsoDateString(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;
  const [yearStr, monthStr, dayStr] = trimmed.split("-");
  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10);
  const day = Number.parseInt(dayStr, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return false;
  }
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function extractValidIsoDateString(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.slice(0, 10);
  return isValidIsoDateString(trimmed) ? trimmed : "";
}

export function isValidDmyDateString(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) return false;
  const [dayStr, monthStr, yearStr] = trimmed.split("-");
  const day = Number.parseInt(dayStr, 10);
  const month = Number.parseInt(monthStr, 10);
  const year = Number.parseInt(yearStr, 10);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) {
    return false;
  }
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function convertDmyToIso(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!isValidDmyDateString(trimmed)) return "";
  const [day, month, year] = trimmed.split("-");
  return `${year}-${month}-${day}`;
}

export function convertIsoToDmy(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = extractValidIsoDateString(value);
  if (!trimmed) return "";
  const [year, month, day] = trimmed.split("-");
  if (!year || !month || !day) return "";
  return `${day.padStart(2, "0")}-${month.padStart(2, "0")}-${year}`;
}