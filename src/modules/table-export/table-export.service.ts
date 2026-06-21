import type { Request, Response } from "express";
import { sendRowsAsXlsx } from "../../common/export-xlsx";
import { pool } from "../../db/pool";
import { exportQuerySchema } from "./table-export.schema";

type ExportModuleKey =
  | "leads"
  | "contacts"
  | "organizations"
  | "quotes"
  | "visits";

type DbColumn = {
  column_name: string;
  data_type: string;
};

type ExportConfig = {
  tableName: string;
  filenamePrefix: string;
  sheetName: string;
  preferredSearchColumns: string[];
  preferredOrderColumns: string[];
};

const EXPORT_CONFIGS: Record<ExportModuleKey, ExportConfig> = {
  leads: {
    tableName: "leads",
    filenamePrefix: "leads",
    sheetName: "Leads",
    preferredSearchColumns: [
      "lead_display_id",
      "title",
      "name",
      "email",
      "phone",
      "mobile",
      "company_name",
    ],
    preferredOrderColumns: ["created_at", "lead_display_id", "updated_at"],
  },

  contacts: {
    tableName: "contacts",
    filenamePrefix: "contacts",
    sheetName: "Contacts",
    preferredSearchColumns: [
      "first_name",
      "last_name",
      "name",
      "email",
      "phone",
      "mobile",
      "designation",
    ],
    preferredOrderColumns: ["created_at", "name", "first_name"],
  },

  organizations: {
    tableName: "organizations",
    filenamePrefix: "organizations",
    sheetName: "Organizations",
    preferredSearchColumns: [
      "name",
      "email",
      "phone",
      "mobile",
      "gst_number",
      "industry",
    ],
    preferredOrderColumns: ["created_at", "name", "updated_at"],
  },

  quotes: {
    tableName: "quotes",
    filenamePrefix: "quotes",
    sheetName: "Quotes",
    preferredSearchColumns: [
      "quote_number",
      "subject",
      "title",
      "status",
      "customer_name",
    ],
    preferredOrderColumns: ["created_at", "quote_number", "updated_at"],
  },

  visits: {
    tableName: "visits",
    filenamePrefix: "visits",
    sheetName: "Visits",
    preferredSearchColumns: [
      "visit_number",
      "title",
      "purpose",
      "status",
      "location",
      "remarks",
    ],
    preferredOrderColumns: ["created_at", "visit_date", "updated_at"],
  },
};

const HIDDEN_COLUMNS = new Set([
  "tenant_id",
  "deleted_at",
  "password",
  "password_hash",
  "raw_tally_data",
]);

const FILTER_KEYS = [
  "status",
  "assigned_to",
  "created_by",
  "updated_by",
  "organization_id",
  "contact_id",
  "customer_id",
  "quote_id",
  "status_id",
  "priority_id",
  "source_id",
];

const TEXT_LIKE_TYPES = new Set([
  "character varying",
  "text",
  "character",
  "citext",
  "uuid",
]);

function quoteIdent(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function getTenantId(req: Request) {
  const requestAny = req as any;

  return (
    requestAny.tenant?.id ||
    requestAny.tenantId ||
    requestAny.user?.tenant_id ||
    null
  );
}

function humanizeColumnName(columnName: string) {
  const specialLabels: Record<string, string> = {
    id: "ID",
    lead_display_id: "Lead ID",
    quote_number: "Quote Number",
    visit_number: "Visit Number",
    gst_number: "GST Number",
    pan_number: "PAN Number",
    email: "Email",
    phone: "Phone",
    mobile: "Mobile",
    created_at: "Created At",
    updated_at: "Updated At",
    created_by: "Created By",
    updated_by: "Updated By",
    assigned_to: "Assigned To",
  };

  if (specialLabels[columnName]) return specialLabels[columnName];

  return columnName
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

async function getTableColumns(tableName: string): Promise<DbColumn[]> {
  const result = await pool.query(
    `
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
      ORDER BY ordinal_position ASC
    `,
    [tableName],
  );

  return result.rows;
}

function hasColumn(columns: DbColumn[], columnName: string) {
  return columns.some((column) => column.column_name === columnName);
}

function getOrderColumn(config: ExportConfig, columns: DbColumn[]) {
  const preferred = config.preferredOrderColumns.find((columnName) =>
    hasColumn(columns, columnName),
  );

  if (preferred) return preferred;

  if (hasColumn(columns, "created_at")) return "created_at";

  return columns[0]?.column_name || "id";
}

function getDateColumn(columns: DbColumn[]) {
  if (hasColumn(columns, "created_at")) return "created_at";
  if (hasColumn(columns, "date")) return "date";
  if (hasColumn(columns, "visit_date")) return "visit_date";
  if (hasColumn(columns, "quote_date")) return "quote_date";

  return null;
}

export async function exportTenantTable(
  req: Request,
  res: Response,
  moduleKey: ExportModuleKey,
) {
  try {
    const config = EXPORT_CONFIGS[moduleKey];

    if (!config) {
      return res.status(400).json({
        statusCode: 400,
        message: "Invalid export module",
        data: null,
      });
    }

    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(400).json({
        statusCode: 400,
        message: "Tenant context not found",
        data: null,
      });
    }

    const query = exportQuerySchema.parse(req.query);
    const columns = await getTableColumns(config.tableName);

    if (!columns.length) {
      return res.status(404).json({
        statusCode: 404,
        message: `Table not found for ${moduleKey}`,
        data: null,
      });
    }

    const exportColumns = columns.filter(
      (column) => !HIDDEN_COLUMNS.has(column.column_name),
    );

    const columnNames = exportColumns.map((column) => column.column_name);

    const whereClauses: string[] = [`t.${quoteIdent("tenant_id")} = $1`];
    const values: unknown[] = [tenantId];

    if (hasColumn(columns, "deleted_at")) {
      whereClauses.push(`t.${quoteIdent("deleted_at")} IS NULL`);
    }

    if (query.q) {
      const searchableColumns = exportColumns.filter((column) => {
        return (
          config.preferredSearchColumns.includes(column.column_name) ||
          TEXT_LIKE_TYPES.has(column.data_type)
        );
      });

      if (searchableColumns.length) {
        values.push(`%${query.q}%`);
        const searchParamIndex = values.length;

        whereClauses.push(
          `(${searchableColumns
            .slice(0, 20)
            .map(
              (column) =>
                `CAST(t.${quoteIdent(column.column_name)} AS TEXT) ILIKE $${searchParamIndex}`,
            )
            .join(" OR ")})`,
        );
      }
    }

    FILTER_KEYS.forEach((filterKey) => {
      const filterValue = (query as Record<string, unknown>)[filterKey];

      if (filterValue && hasColumn(columns, filterKey)) {
        values.push(filterValue);
        whereClauses.push(`t.${quoteIdent(filterKey)} = $${values.length}`);
      }
    });

    const dateColumn = getDateColumn(columns);
    const fromDate = query.from_date || query.date_from;
    const toDate = query.to_date || query.date_to;

    if (dateColumn && fromDate) {
      values.push(fromDate);
      whereClauses.push(
        `t.${quoteIdent(dateColumn)}::date >= $${values.length}::date`,
      );
    }

    if (dateColumn && toDate) {
      values.push(toDate);
      whereClauses.push(
        `t.${quoteIdent(dateColumn)}::date <= $${values.length}::date`,
      );
    }

    const limit = query.limit || 50000;
    values.push(limit);

    const orderColumn = getOrderColumn(config, columns);

    const selectSql = columnNames
      .map((columnName) => `t.${quoteIdent(columnName)}`)
      .join(", ");

    const sql = `
      SELECT ${selectSql}
      FROM ${quoteIdent(config.tableName)} t
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY t.${quoteIdent(orderColumn)} DESC
      LIMIT $${values.length}
    `;

    const result = await pool.query(sql, values);

    const today = new Date().toISOString().slice(0, 10);

    await sendRowsAsXlsx({
      res,
      filename: `${config.filenamePrefix}-${today}.xlsx`,
      sheetName: config.sheetName,
      columns: columnNames.map((columnName) => ({
        key: columnName,
        header: humanizeColumnName(columnName),
        width: 22,
      })),
      rows: result.rows,
    });
  } catch (error) {
    console.error(`${moduleKey} export failed`, error);

    return res.status(500).json({
      statusCode: 500,
      message: "Export failed",
      data: null,
    });
  }
}

export const exportLeadsTable = (req: Request, res: Response) =>
  exportTenantTable(req, res, "leads");

export const exportContactsTable = (req: Request, res: Response) =>
  exportTenantTable(req, res, "contacts");

export const exportOrganizationsTable = (req: Request, res: Response) =>
  exportTenantTable(req, res, "organizations");

export const exportQuotesTable = (req: Request, res: Response) =>
  exportTenantTable(req, res, "quotes");

export const exportVisitsTable = (req: Request, res: Response) =>
  exportTenantTable(req, res, "visits");
