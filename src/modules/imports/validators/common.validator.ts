import XLSX from "xlsx";

export function normalizeHeader(header: string): string {
  return String(header || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export function normalizeCellValue(value: any) {
  if (value === undefined || value === null) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }

  return value;
}

export function normalizeEmail(value: any) {
  if (!value) return null;
  return String(value).trim().toLowerCase();
}

export function normalizePhone(value: any) {
  if (!value) return null;
  return (
    String(value)
      .replace(/[^\d+]/g, "")
      .trim() || null
  );
}

export function parseBoolean(value: any): boolean | null {
  if (value === null || value === undefined || value === "") return null;

  const normalized = String(value).trim().toLowerCase();

  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;

  return null;
}

export function normalizeDate(value: any): string | null {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number") {
    const excelDate = XLSX.SSF.parse_date_code(value);
    if (excelDate) {
      const yyyy = String(excelDate.y).padStart(4, "0");
      const mm = String(excelDate.m).padStart(2, "0");
      const dd = String(excelDate.d).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
  }

  const str = String(value).trim();
  if (!str) return null;

  const date = new Date(str);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString().slice(0, 10);
}

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isValidPhone(value: string) {
  return /^[+]?[0-9]{7,15}$/.test(value);
}

export function isValidDateString(value: string) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}
