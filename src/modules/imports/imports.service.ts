import { NextFunction, Request, Response } from "express";
import multer from "multer";

import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";

import {
  IMPORT_INSERT_CHUNK_SIZE,
  IMPORT_MODULES,
  MAX_IMPORT_FILE_SIZE,
  MAX_IMPORT_ROWS,
} from "./imports.contants";
import {
  ExecuteImportSchema,
  ImportModuleParamSchema,
  ValidateImportSchema,
} from "./imports.schema";
import type {
  DuplicateMode,
  ImportModule,
  ImportModuleConfig,
  ImportRowError,
  ParsedImportRow,
  ValidatedImportRow,
} from "./imports.types";

import { parseCsvBuffer } from "./parsers/csv.parser";
import { parseExcelBuffer } from "./parsers/excel.parser";
import {
  normalizeCellValue,
  normalizeHeader,
} from "./validators/common.validator";
import { validateContactRows } from "./validators/contacts.validator";
import { validateLeadRows } from "./validators/leads.validator";

export const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMPORT_FILE_SIZE,
  },
});

function getConfigOrThrow(moduleName: string): ImportModuleConfig {
  const config = IMPORT_MODULES[moduleName as ImportModule];

  if (!config) {
    throw new Error(`Unsupported import module: ${moduleName}`);
  }

  return config;
}

async function findOrganizationIdByName(
  client: any,
  tenantId: string,
  organizationName?: string,
) {
  if (!organizationName) return null;

  const result = await client.query(
    `
      SELECT id
      FROM organizations
      WHERE tenant_id = $1
        AND LOWER(name) = LOWER($2)
      LIMIT 1
    `,
    [tenantId, organizationName.trim()],
  );

  return result.rows[0]?.id || null;
}

async function findUserIdByEmail(
  client: any,
  tenantId: string,
  email?: string,
) {
  if (!email) return null;

  const result = await client.query(
    `
      SELECT id
      FROM public.users
      WHERE tenant_id = $1
        AND LOWER(email) = LOWER($2)
      LIMIT 1
    `,
    [tenantId, email.trim()],
  );

  return result.rows[0]?.id || null;
}

function parseUploadedFile(
  buffer: Buffer,
  originalName: string,
): Record<string, any>[] {
  const lowerName = originalName.toLowerCase();

  if (lowerName.endsWith(".csv")) {
    return parseCsvBuffer(buffer);
  }

  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
    return parseExcelBuffer(buffer);
  }

  throw new Error("Only CSV, XLSX, and XLS files are supported.");
}

function buildParsedRows(rows: Record<string, any>[]): ParsedImportRow[] {
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Maximum ${MAX_IMPORT_ROWS} rows allowed per import.`);
  }

  return rows.map((rawRow, index) => {
    const normalized: Record<string, any> = {};

    Object.entries(rawRow).forEach(([header, value]) => {
      normalized[normalizeHeader(header)] = normalizeCellValue(value);
    });

    return {
      rowNumber: index + 2,
      raw: rawRow,
      normalized,
    };
  });
}

function getHeaderAnalysis(
  parsedRows: ParsedImportRow[],
  config: ImportModuleConfig,
) {
  const expectedKeys = config.fields.map((field) => field.key);
  const foundHeaders = parsedRows[0]
    ? Object.keys(parsedRows[0].normalized)
    : [];

  const missingHeaders = config.fields
    .filter((field) => field.required && !foundHeaders.includes(field.key))
    .map((field) => field.key);

  const extraHeaders = foundHeaders.filter(
    (header) => !expectedKeys.includes(header),
  );

  return {
    foundHeaders,
    missingHeaders,
    extraHeaders,
  };
}

function buildSampleCsv(config: ImportModuleConfig) {
  const headers = config.fields.map((f) => f.key).join(",");
  const sampleRow = config.fields.map((f) => f.sampleValue ?? "").join(",");

  return [headers, sampleRow].join("\n");
}

function validateRowsByModule(
  moduleName: ImportModule,
  parsedRows: ParsedImportRow[],
  config: ImportModuleConfig,
): {
  validRows: ValidatedImportRow[];
  errors: ImportRowError[];
} {
  switch (moduleName) {
    case "contacts":
      return validateContactRows(parsedRows, config);
    case "leads":
      return validateLeadRows(parsedRows, config);
    default:
      throw new Error(`No validator found for module: ${moduleName}`);
  }
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

async function createImportJob(
  client: any,
  params: {
    tenantId: string;
    userId: string;
    module: string;
    fileName: string;
    totalRows: number;
    duplicateMode: DuplicateMode;
  },
) {
  const result = await client.query(
    `
      INSERT INTO import_jobs (
        tenant_id,
        module,
        file_name,
        total_rows,
        duplicate_mode,
        status,
        created_by_id,
        updated_by_id
      )
      VALUES ($1, $2, $3, $4, $5, 'processing', $6, $6)
      RETURNING id
    `,
    [
      params.tenantId,
      params.module,
      params.fileName,
      params.totalRows,
      params.duplicateMode,
      params.userId,
    ],
  );

  return result.rows[0];
}

async function saveImportErrors(
  client: any,
  importJobId: string,
  errors: ImportRowError[],
) {
  if (!errors.length) return;

  for (const error of errors) {
    await client.query(
      `
        INSERT INTO import_job_errors (
          import_job_id,
          row_number,
          field,
          message,
          raw_data
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        importJobId,
        error.rowNumber,
        error.field ?? null,
        error.message,
        error.rawData ? JSON.stringify(error.rawData) : null,
      ],
    );
  }
}

async function findExistingRecord(
  client: any,
  config: ImportModuleConfig,
  tenantId: string,
  row: Record<string, any>,
) {
  if (!config.uniqueBy?.length) return null;

  const usableKeys = config.uniqueBy.filter((key) => !!row[key]);
  if (!usableKeys.length) return null;

  const conditions: string[] = [];
  const values: any[] = [tenantId];
  let idx = 2;

  for (const key of usableKeys) {
    conditions.push(`${key} = $${idx}`);
    values.push(row[key]);
    idx++;
  }

  const result = await client.query(
    `
      SELECT id
      FROM ${config.tableName}
      WHERE tenant_id = $1
        AND (${conditions.join(" OR ")})
      LIMIT 1
    `,
    values,
  );

  return result.rows[0] || null;
}

function serializeDbValueByKey(
  key: string,
  value: any,
  jsonFields: string[] = [],
) {
  if (value === undefined) return value;

  if (jsonFields.includes(key)) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) return JSON.stringify(value);

  if (value && typeof value === "object" && !(value instanceof Date)) {
    return JSON.stringify(value);
  }

  return value;
}

async function insertRow(
  client: any,
  config: ImportModuleConfig,
  data: Record<string, any>,
) {
  const keys = Object.keys(data);
  const jsonFields = (config as any).jsonFields || [];

  const values = keys.map((key) =>
    serializeDbValueByKey(key, data[key], jsonFields),
  );

  const placeholders = keys.map((_, index) => `$${index + 1}`);

  const result = await client.query(
    `
      INSERT INTO ${config.tableName} (${keys.join(", ")})
      VALUES (${placeholders.join(", ")})
      RETURNING id
    `,
    values,
  );

  return result.rows[0];
}

async function updateRow(
  client: any,
  config: ImportModuleConfig,
  recordId: string,
  data: Record<string, any>,
) {
  const keys = Object.keys(data);
  const jsonFields = (config as any).jsonFields || [];

  const values = keys.map((key) =>
    serializeDbValueByKey(key, data[key], jsonFields),
  );

  const setClause = keys
    .map((key, index) => `${key} = $${index + 1}`)
    .join(", ");

  const result = await client.query(
    `
      UPDATE ${config.tableName}
      SET ${setClause}
      WHERE id = $${keys.length + 1}
      RETURNING id
    `,
    [...values, recordId],
  );

  return result.rows[0];
}

async function resolveLookupFieldsByModule(
  client: any,
  moduleName: ImportModule,
  tenantId: string,
  userId: string,
  rowMeta: ValidatedImportRow,
): Promise<{
  data?: Record<string, any>;
  error?: ImportRowError;
}> {
  const rowData = { ...rowMeta.data };

  switch (moduleName) {
    case "contacts": {
      const organizationId = await findOrganizationIdByName(
        client,
        tenantId,
        rowData.organization_name,
      );

      if (rowData.organization_name && !organizationId) {
        return {
          error: {
            rowNumber: rowMeta.rowNumber,
            field: "organization_name",
            message: `Organization not found: ${rowData.organization_name}`,
            rawData: rowMeta.raw,
          },
        };
      }

      const assignedToUserId = await findUserIdByEmail(
        client,
        tenantId,
        rowData.assigned_to_email,
      );

      if (rowData.assigned_to_email && !assignedToUserId) {
        return {
          error: {
            rowNumber: rowMeta.rowNumber,
            field: "assigned_to_email",
            message: `User not found for email: ${rowData.assigned_to_email}`,
            rawData: rowMeta.raw,
          },
        };
      }

      return {
        data: {
          ...rowData,
          organization_id: organizationId || null,
          assigned_to: assignedToUserId || userId,
        },
      };
    }

    case "leads": {
      const organizationId = await findOrganizationIdByName(
        client,
        tenantId,
        rowData.organization_name,
      );

      if (rowData.organization_name && !organizationId) {
        return {
          error: {
            rowNumber: rowMeta.rowNumber,
            field: "organization_name",
            message: `Organization not found: ${rowData.organization_name}`,
            rawData: rowMeta.raw,
          },
        };
      }

      const assignedToUserId = await findUserIdByEmail(
        client,
        tenantId,
        rowData.assigned_to_email,
      );

      if (rowData.assigned_to_email && !assignedToUserId) {
        return {
          error: {
            rowNumber: rowMeta.rowNumber,
            field: "assigned_to_email",
            message: `User not found for email: ${rowData.assigned_to_email}`,
            rawData: rowMeta.raw,
          },
        };
      }

      return {
        data: {
          ...rowData,
          organization_id: organizationId || null,
          assigned_to: assignedToUserId || userId,
        },
      };
    }

    default:
      return {
        data: rowData,
      };
  }
}

export async function getImportTemplateMetaHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsedParams = ImportModuleParamSchema.parse(req.params);
    const config = getConfigOrThrow(parsedParams.module);

    return res.json({
      success: true,
      data: {
        module: config.module,
        label: config.label,
        sampleFileName: config.sampleFileName,
        uniqueBy: config.uniqueBy ?? [],
        requiredAtLeastOneOf: config.requiredAtLeastOneOf ?? [],
        fields: config.fields.map((field) => ({
          key: field.key,
          label: field.label,
          required: !!field.required,
          type: field.type,
          enumValues: field.enumValues ?? [],
          sampleValue: field.sampleValue ?? "",
        })),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function downloadImportSampleHandler(req: Request, res: Response) {
  const moduleKey = String(req.params.module || "").toLowerCase();

  const config = getConfigOrThrow(moduleKey);

  const csv = buildSampleCsv(config);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${config.sampleFileName || `${moduleKey}_import_sample.csv`}"`,
  );
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  return res.status(200).send(csv);
}

export async function validateImportHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsedParams = ImportModuleParamSchema.parse(req.params);
    ValidateImportSchema.parse(req.body);

    const file = req.file;
    if (!file) {
      return res.status(400).json({
        success: false,
        message: "File is required",
      });
    }

    const config = getConfigOrThrow(parsedParams.module);

    const rawRows = parseUploadedFile(file.buffer, file.originalname);
    const parsedRows = buildParsedRows(rawRows);
    const headerAnalysis = getHeaderAnalysis(parsedRows, config);

    if (headerAnalysis.missingHeaders.length) {
      return res.status(400).json({
        success: false,
        message: "Required headers missing",
        data: headerAnalysis,
      });
    }

    const { validRows, errors } = validateRowsByModule(
      config.module,
      parsedRows,
      config,
    );

    return res.json({
      success: true,
      data: {
        module: config.module,
        fileName: file.originalname,
        totalRows: parsedRows.length,
        validRows: validRows.length,
        invalidRows: new Set(errors.map((error) => error.rowNumber)).size,
        foundHeaders: headerAnalysis.foundHeaders,
        missingHeaders: headerAnalysis.missingHeaders,
        extraHeaders: headerAnalysis.extraHeaders,
        errors,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function executeImportHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const client = await pool.connect();

  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.sub;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const parsedParams = ImportModuleParamSchema.parse(req.params);
    const parsedBody = ExecuteImportSchema.parse(req.body);

    const file = req.file;
    if (!file) {
      return res.status(400).json({
        success: false,
        message: "File is required",
      });
    }

    const config = getConfigOrThrow(parsedParams.module);

    const rawRows = parseUploadedFile(file.buffer, file.originalname);
    const parsedRows = buildParsedRows(rawRows);
    const headerAnalysis = getHeaderAnalysis(parsedRows, config);

    if (headerAnalysis.missingHeaders.length) {
      return res.status(400).json({
        success: false,
        message: "Required headers missing",
        data: headerAnalysis,
      });
    }

    const { validRows, errors } = validateRowsByModule(
      config.module,
      parsedRows,
      config,
    );

    await client.query("BEGIN");

    const importJob = await createImportJob(client, {
      tenantId,
      userId,
      module: config.module,
      fileName: file.originalname,
      totalRows: parsedRows.length,
      duplicateMode: parsedBody.duplicateMode,
    });

    await saveImportErrors(client, importJob.id, errors);

    let importedRows = 0;
    let skippedRows = 0;

    const failedRowNumbers = new Set<number>(
      errors.map((error) => error.rowNumber),
    );
    const runtimeErrors: ImportRowError[] = [];
    const duplicateErrors: ImportRowError[] = [];

    const chunks = chunkArray(validRows, IMPORT_INSERT_CHUNK_SIZE);

    for (const chunk of chunks) {
      for (const rowMeta of chunk) {
        await client.query("SAVEPOINT import_row_savepoint");

        try {
          const resolved = await resolveLookupFieldsByModule(
            client,
            config.module,
            tenantId,
            userId,
            rowMeta,
          );

          if (resolved.error) {
            await client.query("ROLLBACK TO SAVEPOINT import_row_savepoint");
            runtimeErrors.push(resolved.error);
            continue;
          }

          const resolvedRowData = resolved.data || rowMeta.data;

          const existingRecord = await findExistingRecord(
            client,
            config,
            tenantId,
            resolvedRowData,
          );

          if (existingRecord && parsedBody.duplicateMode === "skip") {
            await client.query("ROLLBACK TO SAVEPOINT import_row_savepoint");
            skippedRows++;
            duplicateErrors.push({
              rowNumber: rowMeta.rowNumber,
              field: config.uniqueBy?.join(",") || "duplicate",
              message: "Duplicate record found, skipped",
              rawData: rowMeta.raw,
            });
            continue;
          }

          if (existingRecord && parsedBody.duplicateMode === "update") {
            if (!config.buildUpdateSet) {
              await client.query("ROLLBACK TO SAVEPOINT import_row_savepoint");
              skippedRows++;
              duplicateErrors.push({
                rowNumber: rowMeta.rowNumber,
                field: "duplicate",
                message:
                  "Duplicate record found but update mapping is not configured",
                rawData: rowMeta.raw,
              });
              continue;
            }

            const updatePayload = config.buildUpdateSet(resolvedRowData, {
              tenantId,
              userId,
            });

            await updateRow(client, config, existingRecord.id, updatePayload);
            await client.query("RELEASE SAVEPOINT import_row_savepoint");
            importedRows++;
            continue;
          }

          const insertPayload = config.mapRowForInsert(resolvedRowData, {
            tenantId,
            userId,
          });

          // console.log("LEAD INSERT PAYLOAD:", insertPayload);

          await insertRow(client, config, insertPayload);
          await client.query("RELEASE SAVEPOINT import_row_savepoint");
          importedRows++;
        } catch (error: any) {
          await client.query("ROLLBACK TO SAVEPOINT import_row_savepoint");

          runtimeErrors.push({
            rowNumber: rowMeta.rowNumber,
            message: error?.message || "Failed to import row",
            rawData: rowMeta.raw,
          });
        }
      }
    }

    await saveImportErrors(client, importJob.id, duplicateErrors);
    await saveImportErrors(client, importJob.id, runtimeErrors);

    duplicateErrors.forEach((item) => failedRowNumbers.add(item.rowNumber));
    runtimeErrors.forEach((item) => failedRowNumbers.add(item.rowNumber));

    const failedRows = failedRowNumbers.size;

    await client.query(
      `
        UPDATE import_jobs
        SET
          valid_rows = $1,
          imported_rows = $2,
          failed_rows = $3,
          status = $4,
          updated_by_id = $5,
          updated_at = now()
        WHERE id = $6
      `,
      [
        validRows.length,
        importedRows,
        failedRows,
        failedRows > 0 ? "completed_with_errors" : "completed",
        userId,
        importJob.id,
      ],
    );

    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "Import completed",
      data: {
        importJobId: importJob.id,
        module: config.module,
        totalRows: parsedRows.length,
        validRows: validRows.length,
        importedRows,
        skippedRows,
        failedRows,
        foundHeaders: headerAnalysis.foundHeaders,
        missingHeaders: headerAnalysis.missingHeaders,
        extraHeaders: headerAnalysis.extraHeaders,
        validationErrors: errors,
        duplicateErrors,
        runtimeErrors,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
}
