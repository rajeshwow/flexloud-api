import { parse as csvParse } from "csv-parse/sync";
import XLSX from "xlsx";
import { MAX_IMPORT_ROWS } from "./imports.contants";
import type {
  ImportFieldConfig,
  ImportModuleConfig,
  ImportRowError,
  ParsedImportRow,
} from "./imports.types";

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

export function parseUploadedFile(
  buffer: Buffer,
  originalName: string,
): Record<string, any>[] {
  const lowerName = originalName.toLowerCase();

  if (lowerName.endsWith(".csv")) {
    const content = buffer.toString("utf-8");
    const rows = csvParse(content, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      trim: true,
    }) as Record<string, any>[];
    return rows;
  }

  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    return XLSX.utils.sheet_to_json(sheet, {
      defval: null,
      raw: false,
    }) as Record<string, any>[];
  }

  throw new Error("Only CSV, XLSX, and XLS files are supported.");
}

export function buildParsedRows(
  rows: Record<string, any>[],
): ParsedImportRow[] {
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Maximum ${MAX_IMPORT_ROWS} rows allowed per import.`);
  }

  return rows.map((rawRow, index) => {
    const normalized: Record<string, any> = {};

    Object.entries(rawRow).forEach(([header, value]) => {
      normalized[normalizeHeader(header)] = normalizeCellValue(value);
    });

    return {
      rowNumber: index + 2, // header row is row 1
      raw: rawRow,
      normalized,
    };
  });
}

export function getHeaderAnalysis(
  parsedRows: ParsedImportRow[],
  config: ImportModuleConfig,
) {
  const expectedKeys = config.fields.map((f) => f.key);

  const foundHeaders = parsedRows[0]
    ? Object.keys(parsedRows[0].normalized)
    : [];
  const missingHeaders = config.fields
    .filter((f) => f.required && !foundHeaders.includes(f.key))
    .map((f) => f.key);

  const extraHeaders = foundHeaders.filter((h) => !expectedKeys.includes(h));

  return {
    foundHeaders,
    missingHeaders,
    extraHeaders,
  };
}

export function validateAndNormalizeField(
  field: ImportFieldConfig,
  value: any,
): { value: any; error?: string } {
  const normalized = normalizeCellValue(value);

  if (
    field.required &&
    (normalized === null || normalized === undefined || normalized === "")
  ) {
    return { value: null, error: `${field.label} is required` };
  }

  if (normalized === null) return { value: null };

  switch (field.type) {
    case "string": {
      const str = String(normalized).trim();
      if (field.maxLength && str.length > field.maxLength) {
        return {
          value: str,
          error: `${field.label} exceeds max length ${field.maxLength}`,
        };
      }
      return { value: str };
    }

    case "email": {
      const email = normalizeEmail(normalized);
      if (!email) return { value: null };
      if (!isValidEmail(email)) {
        return { value: email, error: `${field.label} must be a valid email` };
      }
      return { value: email };
    }

    case "phone": {
      const phone = normalizePhone(normalized);
      if (!phone) return { value: null };
      if (!isValidPhone(phone)) {
        return {
          value: phone,
          error: `${field.label} must be a valid phone number`,
        };
      }
      return { value: phone };
    }

    case "number": {
      const num = Number(normalized);
      if (Number.isNaN(num)) {
        return { value: normalized, error: `${field.label} must be a number` };
      }
      return { value: num };
    }

    case "date": {
      const date = normalizeDate(normalized);
      if (!date || !isValidDateString(date)) {
        return {
          value: normalized,
          error: `${field.label} must be a valid date`,
        };
      }
      return { value: date };
    }

    case "boolean": {
      const bool = parseBoolean(normalized);
      if (bool === null) {
        return {
          value: normalized,
          error: `${field.label} must be true/false`,
        };
      }
      return { value: bool };
    }

    case "enum": {
      const str = String(normalized).trim().toLowerCase();
      const enumValues = (field.enumValues || []).map((v) => v.toLowerCase());
      if (!enumValues.includes(str)) {
        return {
          value: str,
          error: `${field.label} must be one of: ${(field.enumValues || []).join(", ")}`,
        };
      }
      return { value: str };
    }

    default:
      return { value: normalized };
  }
}

export function validateRows(
  parsedRows: ParsedImportRow[],
  config: ImportModuleConfig,
): {
  validRows: Record<string, any>[];
  errors: ImportRowError[];
} {
  const validRows: Record<string, any>[] = [];
  const errors: ImportRowError[] = [];

  for (const row of parsedRows) {
    const cleanRow: Record<string, any> = {};
    let hasError = false;

    for (const field of config.fields) {
      const result = validateAndNormalizeField(
        field,
        row.normalized[field.key],
      );
      cleanRow[field.key] = result.value;

      if (result.error) {
        hasError = true;
        errors.push({
          rowNumber: row.rowNumber,
          field: field.key,
          message: result.error,
          rawData: row.raw,
        });
      }
    }

    if (config.requiredAtLeastOneOf?.length) {
      const hasAtLeastOne = config.requiredAtLeastOneOf.some(
        (key) => !!cleanRow[key],
      );
      if (!hasAtLeastOne) {
        hasError = true;
        errors.push({
          rowNumber: row.rowNumber,
          field: config.requiredAtLeastOneOf.join(","),
          message: `At least one of [${config.requiredAtLeastOneOf.join(", ")}] is required`,
          rawData: row.raw,
        });
      }
    }

    if (!hasError) {
      validRows.push(cleanRow);
    }
  }

  return { validRows, errors };
}

export function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}
