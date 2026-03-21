import type {
  ImportModuleConfig,
  ImportRowError,
  ParsedImportRow,
  ValidatedImportRow,
} from "../imports.types";
import {
  isValidDateString,
  isValidEmail,
  isValidPhone,
  normalizeCellValue,
  normalizeDate,
  normalizeEmail,
  normalizePhone,
  parseBoolean,
} from "./common.validator";

export function validateLeadRows(
  parsedRows: ParsedImportRow[],
  config: ImportModuleConfig,
): {
  validRows: ValidatedImportRow[];
  errors: ImportRowError[];
} {
  const validRows: ValidatedImportRow[] = [];
  const errors: ImportRowError[] = [];

  for (const row of parsedRows) {
    const cleanRow: Record<string, any> = {};
    let hasError = false;

    for (const field of config.fields) {
      let value = normalizeCellValue(row.normalized[field.key]);

      if (field.type === "email") value = normalizeEmail(value);
      if (field.type === "mobile") value = normalizePhone(value);
      if (field.type === "date") value = normalizeDate(value);

      cleanRow[field.key] = value;

      if (field.required && !value) {
        hasError = true;
        errors.push({
          rowNumber: row.rowNumber,
          field: field.key,
          message: `${field.label} is required`,
          rawData: row.raw,
        });
        continue;
      }

      if (value && field.type === "email" && !isValidEmail(value)) {
        hasError = true;
        errors.push({
          rowNumber: row.rowNumber,
          field: field.key,
          message: `${field.label} must be a valid email`,
          rawData: row.raw,
        });
      }

      if (value && field.type === "mobile" && !isValidPhone(value)) {
        hasError = true;
        errors.push({
          rowNumber: row.rowNumber,
          field: field.key,
          message: `${field.label} must be a valid phone`,
          rawData: row.raw,
        });
      }

      if (value && field.type === "number") {
        const num = Number(value);
        if (Number.isNaN(num)) {
          hasError = true;
          errors.push({
            rowNumber: row.rowNumber,
            field: field.key,
            message: `${field.label} must be a number`,
            rawData: row.raw,
          });
        } else {
          cleanRow[field.key] = num;
        }
      }

      if (value && field.type === "date" && !isValidDateString(value)) {
        hasError = true;
        errors.push({
          rowNumber: row.rowNumber,
          field: field.key,
          message: `${field.label} must be a valid date`,
          rawData: row.raw,
        });
      }

      if (value !== null && value !== undefined && field.type === "boolean") {
        const parsedBool = parseBoolean(value);
        if (parsedBool === null) {
          hasError = true;
          errors.push({
            rowNumber: row.rowNumber,
            field: field.key,
            message: `${field.label} must be true/false`,
            rawData: row.raw,
          });
        } else {
          cleanRow[field.key] = parsedBool;
        }
      }

      if (value && field.type === "enum") {
        const allowed = (field.enumValues || []).map((item) =>
          item.toLowerCase(),
        );
        const normalized = String(value).trim().toLowerCase();

        if (!allowed.includes(normalized)) {
          hasError = true;
          errors.push({
            rowNumber: row.rowNumber,
            field: field.key,
            message: `${field.label} must be one of: ${(field.enumValues || []).join(", ")}`,
            rawData: row.raw,
          });
        } else {
          cleanRow[field.key] = normalized;
        }
      }
    }

    if (!cleanRow.emails && !cleanRow.mobile) {
      hasError = true;
      errors.push({
        rowNumber: row.rowNumber,
        field: "emails,mobile",
        message: "At least one of Emails or Mobile is required",
        rawData: row.raw,
      });
    }

    if (!hasError) {
      validRows.push({
        rowNumber: row.rowNumber,
        raw: row.raw,
        data: cleanRow,
      });
    }
  }

  return { validRows, errors };
}
