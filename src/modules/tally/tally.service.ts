import axios from "axios";
import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env";
import { pool } from "../../db/pool";
import {
  mapTallyLedgerToOrganization,
  mapTallyStockItemToProduct,
} from "./tally.mapper";
import {
  PullLedgersSchema,
  PullOutstandingsSchema,
  PullPurchaseOrdersSchema,
  PullSalesOrdersSchema,
  PullStockItemsSchema,
  UpsertTallyConnectionSchema,
} from "./tally.schema";
import type { TallyLedgerPayload } from "./tally.types";

type TallyVoucherItemPayload = {
  itemName?: string;
  stockItemName?: string;
  description?: string;
  quantity?: number | string | null;
  rate?: number | string | null;
  amount?: number | string | null;
  unit?: string | null;
};

type TallyOutstandingPayload = {
  costCenterGuid?: string;
  costCenterName?: string;
  costCategory?: string;
  costCenterAmount?: string | number;
  guid?: string | null;
  tallyGuid?: string | null;

  ledgerGuid?: string | null;
  ledger_guid?: string | null;

  ledgerName?: string | null;
  ledger_name?: string | null;
  partyName?: string | null;
  party_name?: string | null;

  voucherGuid?: string | null;
  voucher_guid?: string | null;

  voucherNumber?: string | null;
  voucher_number?: string | null;

  voucherType?: string | null;
  voucher_type?: string | null;

  voucherDate?: string | null;
  voucher_date?: string | null;

  dueDate?: string | null;
  due_date?: string | null;

  billRef?: string | null;
  bill_ref?: string | null;
  reference?: string | null;

  billType?: string | null;
  bill_type?: string | null;

  billAmount?: number | string | null;
  bill_amount?: number | string | null;
  amount?: number | string | null;

  pendingAmount?: number | string | null;
  pending_amount?: number | string | null;
  outstandingAmount?: number | string | null;
  outstanding_amount?: number | string | null;

  cost_center_guid?: string | null;
  cost_center_name?: string | null;
  cost_category?: string | null;
  cost_center_amount?: number | string | null;
};

type TallyEmployeePayload = {
  guid?: string | null;
  tallyGuid?: string | null;
  masterId?: string | number | null;
  alterId?: string | number | null;

  employeeNumber?: string | null;
  employee_number?: string | null;
  number?: string | null;

  name?: string | null;
  employeeName?: string | null;
  employee_name?: string | null;

  designation?: string | null;
  department?: string | null;
  function?: string | null;

  email?: string | null;
  phone?: string | null;
  mobile?: string | null;

  dateOfJoining?: string | null;
  date_of_joining?: string | null;
  joiningDate?: string | null;
  joining_date?: string | null;

  status?: string | null;
};

type TallyVoucherPayload = {
  voucher_date: string;
  DATE: any;
  VOUCHERDATE: any;
  guid?: string | null;
  masterId?: string | number | null;
  alterId?: string | number | null;
  voucherNumber?: string | null;
  number?: string | null;
  date?: string | null;
  voucherDate?: string | null;
  voucherType?: string | null;
  partyName?: string | null;
  ledgerName?: string | null;
  referenceNumber?: string | null;
  voucherGuid?: string | null;
  voucher_guid?: string | null;

  basicOrderRef?: string | null;
  basic_order_ref?: string | null;
  orderRef?: string | null;
  order_ref?: string | null;
  basicBuyerOrderNo?: string | null;
  basic_buyer_order_no?: string | null;
  referenceDate?: string | null;
  narration?: string | null;
  totalAmount?: number | string | null;
  amount?: number | string | null;
  status?: string | null;
  items?: TallyVoucherItemPayload[];

  costCenterGuid?: string | null;
  costCenterName?: string | null;
  costCategory?: string | null;
  costCenterAmount?: number | string | null;

  cost_center_guid?: string | null;
  cost_center_name?: string | null;
  cost_category?: string | null;
  cost_center_amount?: number | string | null;

  cost_center_allocations?: any[];
  costCenterAllocations?: any[];
};

function getTenantIdFromReq(req: Request) {
  const tenantId =
    (req as any)?.tenantId ||
    (req as any)?.tenant_id ||
    (req as any)?.tenant?.id ||
    (req as any)?.user?.tenant_id;

  if (!tenantId) throw new Error("Tenant id missing");
  return tenantId;
}

function getUserIdFromReq(req: Request) {
  return (
    (req as any)?.user?.sub ||
    (req as any)?.user?.id ||
    (req as any)?.user_id ||
    null
  );
}

function toNumber(value: any, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function cleanText(value: any) {
  if (value === null || value === undefined) return null;
  const v = String(value).trim();
  return v || null;
}

function normalizeRef(value: any) {
  const text = cleanText(value);
  if (!text) return null;

  return text
    .replace(/^crm\s*so\s*no\s*[:#-]?\s*/i, "")
    .replace(/^sales\s*order\s*[:#-]?\s*/i, "")
    .trim();
}

function formatSalesOrderVoucherNumber(value: any) {
  const text = cleanText(value);
  if (!text) return null;

  const normalized = text.toUpperCase();
  const crmStyleMatch = normalized.match(/^SO-(\d+)$/);
  if (crmStyleMatch) {
    return `SO-${crmStyleMatch[1].padStart(7, "0")}`;
  }

  const numericOnlyMatch = normalized.match(/^\d+$/);
  if (numericOnlyMatch) {
    return `SO-${numericOnlyMatch[0].padStart(7, "0")}`;
  }

  return text;
}

function formatPurchaseOrderVoucherNumber(value: any) {
  const text = cleanText(value);
  if (!text) return null;

  const normalized = text.toUpperCase();
  const crmStyleMatch = normalized.match(/^PO-(\d+)$/);
  if (crmStyleMatch) {
    return `PO-${crmStyleMatch[1].padStart(7, "0")}`;
  }

  if (/^\d+$/.test(normalized)) {
    return `PO-${normalized.padStart(7, "0")}`;
  }

  return text;
}

function pickFirstText(...values: any[]) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }

  return null;
}

function normalizeDate(value: any) {
  if (!value) return null;
  const v = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);

  if (/^\d{8}$/.test(v)) {
    return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  }

  return v;
}

function normalizeBillType(value: any) {
  const v = String(value || "")
    .trim()
    .toLowerCase();

  if (
    v === "payable" ||
    v === "payables" ||
    v === "purchase" ||
    v === "creditor" ||
    v === "sundry creditor" ||
    v === "sundry creditors"
  ) {
    return "payable";
  }

  return "receivable";
}

function normalizeDateOrNull(value?: string | null) {
  if (!value) return null;

  const text = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }

  return null;
}

type TallyCompanyContext = {
  id: string;
  tally_guid: string | null;
  name: string;
};

function extractTallyCompanyFromPayload(row: any, connection: any) {
  const tallyCompanyGuid =
    cleanText(row?.tallyCompanyGuid) ||
    cleanText(row?.tally_company_guid) ||
    cleanText(row?.companyGuid) ||
    cleanText(row?.company_guid) ||
    cleanText(connection?.company_guid);

  const tallyCompanyName =
    cleanText(row?.tallyCompanyName) ||
    cleanText(row?.tally_company_name) ||
    cleanText(row?.companyName) ||
    cleanText(row?.company_name) ||
    cleanText(connection?.company_name);

  return {
    tallyCompanyGuid,
    tallyCompanyName,
  };
}

async function resolveTallyCompany(
  client: any,
  tenantId: string,
  row: any,
  connection: any,
): Promise<TallyCompanyContext> {
  const { tallyCompanyGuid, tallyCompanyName } = extractTallyCompanyFromPayload(
    row,
    connection,
  );

  const finalName = tallyCompanyName || tallyCompanyGuid;

  if (!finalName) {
    throw new Error(
      "Tally company details missing. Send companyName/companyGuid from sync agent or save Tally connection first.",
    );
  }

  const existing = await client.query(
    `
    SELECT id, tally_guid, name
    FROM tally_companies
    WHERE tenant_id = $1
      AND deleted_at IS NULL
      AND (
        ($2::text IS NOT NULL AND tally_guid = $2)
        OR lower(trim(name)) = lower(trim($3))
      )
    ORDER BY
      CASE WHEN $2::text IS NOT NULL AND tally_guid = $2 THEN 0 ELSE 1 END
    LIMIT 1
    `,
    [tenantId, tallyCompanyGuid, finalName],
  );

  if (existing.rows[0]) {
    const updated = await client.query(
      `
      UPDATE tally_companies
      SET
        tally_guid = COALESCE($3, tally_guid),
        name = COALESCE($4, name),
        formal_name = COALESCE($4, formal_name),
        is_active = true,
        raw_tally_data = COALESCE($5::jsonb, raw_tally_data),
        deleted_at = NULL,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING id, tally_guid, name
      `,
      [
        tenantId,
        existing.rows[0].id,
        tallyCompanyGuid,
        finalName,
        connection ? JSON.stringify(connection) : null,
      ],
    );

    return updated.rows[0];
  }

  const inserted = await client.query(
    `
    INSERT INTO tally_companies (
      tenant_id,
      tally_guid,
      name,
      formal_name,
      country,
      state,
      is_active,
      raw_tally_data,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $3, 'India', NULL, true, $4::jsonb, now(), now())
    RETURNING id, tally_guid, name
    `,
    [
      tenantId,
      tallyCompanyGuid,
      finalName,
      connection ? JSON.stringify(connection) : null,
    ],
  );

  return inserted.rows[0];
}

async function resolveCostCenterId(
  client: any,
  tenantId: string,
  input: {
    cost_center_guid?: string | null;
    cost_center_name?: string | null;
  },
) {
  const guid = input.cost_center_guid
    ? String(input.cost_center_guid).trim()
    : null;
  const name = input.cost_center_name
    ? String(input.cost_center_name).trim()
    : null;

  if (!guid && !name) return null;

  if (guid) {
    const { rows } = await client.query(
      `
      SELECT id
      FROM cost_centers
      WHERE tenant_id = $1
        AND tally_guid = $2
      LIMIT 1
      `,
      [tenantId, guid],
    );

    if (rows[0]?.id) return rows[0].id;
  }

  if (name) {
    const { rows } = await client.query(
      `
      SELECT id
      FROM cost_centers
      WHERE tenant_id = $1
        AND lower(name) = lower($2)
      LIMIT 1
      `,
      [tenantId, name],
    );

    if (rows[0]?.id) return rows[0].id;

    const created = await client.query(
      `
      INSERT INTO cost_centers (
        tenant_id,
        tally_guid,
        name,
        status,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, 'active', now(), now())
      ON CONFLICT (tenant_id, tally_guid)
      DO UPDATE SET
        name = EXCLUDED.name,
        updated_at = now()
      RETURNING id
      `,
      [tenantId, guid || null, name],
    );

    return created.rows[0]?.id || null;
  }

  return null;
}

function normalizeOutstandingRow(row: TallyOutstandingPayload) {
  const ledgerGuid =
    cleanText(row.ledgerGuid) ||
    cleanText(row.ledger_guid) ||
    cleanText(row.tallyGuid) ||
    cleanText(row.guid);

  const ledgerName =
    cleanText(row.ledgerName) ||
    cleanText(row.ledger_name) ||
    cleanText(row.partyName) ||
    cleanText(row.party_name);

  const voucherNumber =
    cleanText(row.voucherNumber) || cleanText(row.voucher_number);

  const billRef =
    cleanText(row.billRef) ||
    cleanText(row.bill_ref) ||
    cleanText(row.reference) ||
    voucherNumber ||
    ledgerName;

  return {
    tally_guid: cleanText(row.tallyGuid) || cleanText(row.guid) || ledgerGuid,
    ledger_guid: ledgerGuid,
    ledger_name: ledgerName,

    voucher_guid: cleanText(row.voucherGuid) || cleanText(row.voucher_guid),

    voucher_number: voucherNumber,

    voucher_type: cleanText(row.voucherType) || cleanText(row.voucher_type),

    // voucher_date:
    //   normalizeDate(row.voucherDate) || normalizeDate(row.voucher_date),

    // due_date: normalizeDate(row.dueDate) || normalizeDate(row.due_date),

    voucher_date: normalizeDateOrNull(row.voucherDate || row.voucher_date),
    due_date: normalizeDateOrNull(row.dueDate || row.due_date),

    bill_ref: billRef,

    bill_type: normalizeBillType(row.billType || row.bill_type),

    bill_amount: toNumber(row.billAmount ?? row.bill_amount ?? row.amount, 0),

    pending_amount: toNumber(
      row.pendingAmount ??
        row.pending_amount ??
        row.outstandingAmount ??
        row.outstanding_amount ??
        row.amount,
      0,
    ),

    cost_center_guid:
      cleanText(row.cost_center_guid) || cleanText(row.costCenterGuid),

    cost_center_name:
      cleanText(row.cost_center_name) || cleanText(row.costCenterName),

    cost_category: cleanText(row.cost_category) || cleanText(row.costCategory),

    cost_center_amount: toNumber(
      row.cost_center_amount ?? row.costCenterAmount,
      0,
    ),
  };
}

function normalizeEmployeeRow(row: TallyEmployeePayload) {
  const tallyGuid = cleanText(row.tallyGuid) || cleanText(row.guid);

  const employeeNumber =
    cleanText(row.employeeNumber) ||
    cleanText(row.employee_number) ||
    cleanText(row.number) ||
    cleanText(row.masterId);

  const name =
    cleanText(row.name) ||
    cleanText(row.employeeName) ||
    cleanText(row.employee_name);

  return {
    tally_guid: tallyGuid || employeeNumber || name,
    tally_master_id: row.masterId ? String(row.masterId) : null,
    tally_alter_id: row.alterId ? String(row.alterId) : null,

    employee_number: employeeNumber,
    name,

    designation: cleanText(row.designation),
    department: cleanText(row.department || row.function),

    email: cleanText(row.email),
    phone: cleanText(row.phone || row.mobile),

    date_of_joining:
      normalizeDate(row.dateOfJoining) ||
      normalizeDate(row.date_of_joining) ||
      normalizeDate(row.joiningDate) ||
      normalizeDate(row.joining_date),

    status: cleanText(row.status) || "active",
  };
}

function buildTallyEmployeeFallbackEmail(input: {
  tenantId: string;
  tallyGuid: string;
  employeeNumber?: string | null;
  name?: string | null;
}) {
  const base =
    cleanText(input.employeeNumber) ||
    cleanText(input.tallyGuid) ||
    cleanText(input.name) ||
    "employee";

  const safeBase = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");

  return `${safeBase || "employee"}.${input.tenantId.slice(0, 8)}@tally.local`;
}

async function createJob(input: {
  tenantId: string;
  connectionId?: string | null;
  syncType: string;
  direction: string;
  userId?: string | null;
}) {
  const result = await pool.query(
    `
    INSERT INTO tally_sync_jobs
    (
      tenant_id,
      connection_id,
      sync_type,
      direction,
      status,
      started_at,
      created_by_id
    )
    VALUES ($1,$2,$3,$4,'running',NOW(),$5)
    RETURNING *
    `,
    [
      input.tenantId,
      input.connectionId || null,
      input.syncType,
      input.direction,
      input.userId || null,
    ],
  );

  return result.rows[0];
}

async function finishJob(input: {
  jobId: string;
  tenantId: string;
  connectionId?: string | null;
  status: "success" | "failed" | "partial";
  totalRecords: number;
  successCount: number;
  failedCount: number;
  errorMessage?: string | null;
}) {
  const completedAt = new Date();

  await pool.query(
    `
    UPDATE tally_sync_jobs
    SET
      status = $2,
      finished_at = $3,
      completed_at = $3,
      total_records = $4,
      success_count = $5,
      failed_count = $6,
      error_message = $7
    WHERE id = $1
      AND tenant_id = $8
    `,
    [
      input.jobId,
      input.status,
      completedAt,
      input.totalRecords,
      input.successCount,
      input.failedCount,
      input.errorMessage || null,
      input.tenantId,
    ],
  );

  await pool.query(
    `
    UPDATE tally_connections
    SET
      last_sync_at = $2,
      last_synced_at = CASE
        WHEN $3 IN ('success', 'partial') THEN $2
        ELSE last_synced_at
      END,
      last_success_at = CASE
        WHEN $3 IN ('success', 'partial') THEN $2
        ELSE last_success_at
      END,
      last_error = CASE
        WHEN $3 = 'failed' THEN $4
        WHEN $5 > 0 THEN $4
        ELSE NULL
      END,
      updated_at = now()
    WHERE tenant_id = $1
      AND ($6::uuid IS NULL OR id = $6::uuid)
    `,
    [
      input.tenantId,
      completedAt,
      input.status,
      input.errorMessage ||
        (input.failedCount ? `${input.failedCount} records failed` : null),
      input.failedCount,
      input.connectionId || null,
    ],
  );
}

async function logSyncError(input: {
  tenantId: string;
  jobId: string;
  entityType: string;
  tallyGuid?: string | null;
  tallyName?: string | null;
  errorMessage: string;
  rawPayload?: unknown;
}) {
  await pool.query(
    `
    INSERT INTO tally_sync_errors
    (
      tenant_id,
      job_id,
      entity_type,
      tally_guid,
      tally_name,
      error_message,
      raw_payload
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    `,
    [
      input.tenantId,
      input.jobId,
      input.entityType,
      input.tallyGuid || null,
      input.tallyName || null,
      input.errorMessage,
      input.rawPayload ? JSON.stringify(input.rawPayload) : null,
    ],
  );
}

async function upsertMapping(
  client: any,
  input: {
    tenantId: string;
    entityType: string;
    crmEntityId: string;
    tallyGuid?: string | null;
    tallyMasterId?: string | number | null;
    tallyAlterId?: string | number | null;
    tallyName?: string | null;
  },
) {
  if (!input.tallyGuid) return;

  await client.query(
    `
    INSERT INTO tally_entity_mappings
    (
      tenant_id,
      entity_type,
      crm_entity_id,
      tally_guid,
      tally_master_id,
      tally_alter_id,
      tally_name,
      last_synced_at,
      created_at,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW(),NOW())
    ON CONFLICT (tenant_id, entity_type, tally_guid)
    DO UPDATE SET
      crm_entity_id = EXCLUDED.crm_entity_id,
      tally_master_id = EXCLUDED.tally_master_id,
      tally_alter_id = EXCLUDED.tally_alter_id,
      tally_name = EXCLUDED.tally_name,
      last_synced_at = NOW(),
      updated_at = NOW()
    `,
    [
      input.tenantId,
      input.entityType,
      input.crmEntityId,
      input.tallyGuid,
      input.tallyMasterId || null,
      input.tallyAlterId || null,
      input.tallyName || null,
    ],
  );
}

async function findOrganizationIdByName(
  client: any,
  tenantId: string,
  name?: string | null,
) {
  const partyName = cleanText(name);
  if (!partyName) return null;

  const result = await client.query(
    `
  SELECT id
  FROM organizations
  WHERE tenant_id = $1
    AND LOWER(name) = LOWER($2)
  LIMIT 1
  `,
    [tenantId, partyName],
  );

  return result.rows[0]?.id || null;
}

async function findProductIdByName(
  client: any,
  tenantId: string,
  name?: string | null,
) {
  const productName = cleanText(name);
  if (!productName) return null;

  const result = await client.query(
    `
    SELECT id
    FROM products
    WHERE tenant_id = $1
      AND LOWER(name) = LOWER($2)
    LIMIT 1
    `,
    [tenantId, productName],
  );

  return result.rows[0]?.id || null;
}

export async function getTallyConnection(tenantId: string) {
  const result = await pool.query(
    `
    SELECT *
    FROM tally_connections
    WHERE tenant_id = $1
    LIMIT 1
    `,
    [tenantId],
  );

  return result.rows[0] || null;
}

export async function saveTallyConnection(input: {
  tenantId: string;
  userId?: string | null;
  company_name?: string;
  tally_url: string;
  sync_direction: "pull" | "push" | "both";
  sync_frequency_minutes: number;
  is_active: boolean;
}) {
  const existing = await pool.query(
    `
    SELECT id
    FROM tally_connections
    WHERE tenant_id = $1
    LIMIT 1
    `,
    [input.tenantId],
  );

  if (existing.rowCount) {
    const result = await pool.query(
      `
      UPDATE tally_connections
      SET company_name = $2,
          tally_url = $3,
          sync_direction = $4,
          sync_frequency_minutes = $5,
          is_active = $6,
          updated_by_id = $7,
          updated_at = NOW()
      WHERE tenant_id = $1
      RETURNING *
      `,
      [
        input.tenantId,
        input.company_name || null,
        input.tally_url,
        input.sync_direction,
        input.sync_frequency_minutes,
        input.is_active,
        input.userId || null,
      ],
    );

    return result.rows[0];
  }

  const result = await pool.query(
    `
    INSERT INTO tally_connections
    (
      tenant_id,
      company_name,
      tally_url,
      sync_direction,
      sync_frequency_minutes,
      is_active,
      created_by_id,
      updated_by_id,
      created_at,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$7,NOW(),NOW())
    RETURNING *
    `,
    [
      input.tenantId,
      input.company_name || null,
      input.tally_url,
      input.sync_direction,
      input.sync_frequency_minutes,
      input.is_active,
      input.userId || null,
    ],
  );

  return result.rows[0];
}

/* ----------------------------- LEDGERS ----------------------------- */

export async function pullTallyLedgers(input: {
  tenantId: string;
  userId?: string | null;
  records: any[];
}) {
  const connection = await getTallyConnection(input.tenantId);

  const job = await createJob({
    tenantId: input.tenantId,
    connectionId: connection?.id || null,
    syncType: "ledger",
    direction: "pull",
    userId: input.userId || null,
  });

  const client = await pool.connect();
  let successCount = 0;
  let failedCount = 0;

  try {
    await client.query("BEGIN");

    for (const row of input.records) {
      try {
        const mapped = mapTallyLedgerToOrganization(row);

        const tallyCompany = await resolveTallyCompany(
          client,
          input.tenantId,
          row,
          connection,
        );

        await client.query(
          `
  INSERT INTO tally_ledgers
  (
    tenant_id,
    tally_company_id,
    tally_company_guid,
    tally_company_name,
    tally_guid,
    name,
    parent,
    gstin,
    email,
    phone,
    state,
    country,
    opening_balance,
    closing_balance,
    synced_at
  )
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
  ON CONFLICT (tenant_id, tally_company_id, tally_guid)
  WHERE tally_company_id IS NOT NULL
    AND tally_guid IS NOT NULL
    AND tally_guid <> ''
  DO UPDATE SET
    tally_company_guid = EXCLUDED.tally_company_guid,
    tally_company_name = EXCLUDED.tally_company_name,
    name = EXCLUDED.name,
    parent = EXCLUDED.parent,
    gstin = EXCLUDED.gstin,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    state = EXCLUDED.state,
    country = EXCLUDED.country,
    opening_balance = EXCLUDED.opening_balance,
    closing_balance = EXCLUDED.closing_balance,
    synced_at = NOW()
  `,
          [
            input.tenantId,
            tallyCompany.id,
            tallyCompany.tally_guid,
            tallyCompany.name,
            row.guid,
            row.name,
            row.parent || null,
            row.gstin || row.gstNumber || null,
            row.email || null,
            row.phone || row.mobile || null,
            row.state || null,
            row.country || null,
            toNumber(row.openingBalance ?? row.opening_balance),
            toNumber(row.closingBalance ?? row.closing_balance),
          ],
        );

        if (!mapped) {
          successCount++;
          continue;
        }

        const existingMapping = row.guid
          ? await client.query(
              `
              SELECT crm_entity_id
              FROM tally_entity_mappings
              WHERE tenant_id = $1
                AND entity_type = 'ledger'
                AND tally_guid = $2
              LIMIT 1
              `,
              [input.tenantId, row.guid],
            )
          : { rowCount: 0, rows: [] as any[] };

        let organizationId: string;

        if (
          existingMapping.rowCount &&
          existingMapping.rows[0]?.crm_entity_id
        ) {
          organizationId = existingMapping.rows[0].crm_entity_id;

          await client.query(
            `
            UPDATE organizations
            SET name = $3,
                gst_number = $4,
                email = $5,
                type = $6,
                registered_street = $7,
                registered_city = $8,
                registered_state = $9,
                registered_country = $10,
                updated_by = $11,
                updated_at = NOW()
            WHERE id = $1
              AND tenant_id = $2
            `,
            [
              organizationId,
              input.tenantId,
              mapped.name,
              mapped.gst_number,
              mapped.email,
              mapped.type,
              mapped.registered_street,
              mapped.registered_city,
              mapped.registered_state,
              mapped.registered_country,
              input.userId || null,
            ],
          );
        } else {
          const existingByName = await client.query(
            `
            SELECT id
            FROM organizations
            WHERE tenant_id = $1
              AND LOWER(name) = LOWER($2)
            LIMIT 1
            `,
            [input.tenantId, mapped.name],
          );

          if (existingByName.rowCount) {
            organizationId = existingByName.rows[0].id;

            await client.query(
              `
              UPDATE organizations
              SET gst_number = COALESCE($3, gst_number),
                  email = COALESCE($4, email),
                  type = COALESCE($5, type),
                  registered_street = COALESCE($6, registered_street),
                  registered_city = COALESCE($7, registered_city),
                  registered_state = COALESCE($8, registered_state),
                  registered_country = COALESCE($9, registered_country),
                  updated_by = $10,
                  updated_at = NOW()
              WHERE id = $1
                AND tenant_id = $2
              `,
              [
                organizationId,
                input.tenantId,
                mapped.gst_number,
                mapped.email,
                mapped.type,
                mapped.registered_street,
                mapped.registered_city,
                mapped.registered_state,
                mapped.registered_country,
                input.userId || null,
              ],
            );
          } else {
            const orgResult = await client.query(
              `
              INSERT INTO organizations
              (
                tenant_id,
                name,
                gst_number,
                email,
                type,
                registered_street,
                registered_city,
                registered_state,
                registered_country,
                created_by,
                updated_by,
                created_at,
                updated_at
              )
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,NOW(),NOW())
              RETURNING id
              `,
              [
                input.tenantId,
                mapped.name,
                mapped.gst_number,
                mapped.email,
                mapped.type,
                mapped.registered_street,
                mapped.registered_city,
                mapped.registered_state,
                mapped.registered_country,
                input.userId || null,
              ],
            );

            organizationId = orgResult.rows[0].id;
          }
        }

        await upsertMapping(client, {
          tenantId: input.tenantId,
          entityType: "ledger",
          crmEntityId: organizationId,
          tallyGuid: row.guid,
          tallyMasterId: row.masterId,
          tallyAlterId: row.alterId,
          tallyName: row.name,
        });

        await upsertMapping(client, {
          tenantId: input.tenantId,
          entityType: "organization",
          crmEntityId: organizationId,
          tallyGuid: row.guid,
          tallyMasterId: row.masterId,
          tallyAlterId: row.alterId,
          tallyName: row.name,
        });

        successCount++;
      } catch (error: any) {
        failedCount++;

        await logSyncError({
          tenantId: input.tenantId,
          jobId: job.id,
          entityType: "ledger",
          tallyGuid: row.guid || null,
          tallyName: row.name || null,
          errorMessage: error?.message || "Unknown ledger sync error",
          rawPayload: row,
        });
      }
    }

    // await updateConnectionSyncStatus({
    //   tenantId: input.tenantId,
    //   failedCount,
    //   errorLabel: "ledger records",
    // });

    await finishJob({
      jobId: job.id,
      status:
        failedCount === 0 ? "success" : successCount > 0 ? "partial" : "failed",
      totalRecords: input.records.length,
      successCount,
      failedCount,
      tenantId: input.tenantId,
      connectionId: connection?.id || null,
    });

    await client.query("COMMIT");

    return {
      job_id: job.id,
      total: input.records.length,
      success: successCount,
      failed: failedCount,
    };
  } catch (error: any) {
    await client.query("ROLLBACK");

    await finishJob({
      jobId: job.id,
      status: "failed",
      totalRecords: input.records.length,
      successCount,
      failedCount,
      errorMessage: error?.message || "Ledger sync failed",
      tenantId: input.tenantId,
      connectionId: connection?.id || null,
    });

    throw error;
  } finally {
    client.release();
  }
}

/* ----------------------------- OUTSTANDINGS ----------------------------- */

export async function pullTallyOutstandings(input: {
  tenantId: string;
  userId?: string | null;
  records: TallyOutstandingPayload[];
}) {
  const connection = await getTallyConnection(input.tenantId);

  const job = await createJob({
    tenantId: input.tenantId,
    connectionId: connection?.id || null,
    syncType: "outstanding",
    direction: "pull",
    userId: input.userId || null,
  });

  const client = await pool.connect();
  let successCount = 0;
  let failedCount = 0;

  try {
    await client.query("BEGIN");

    for (const row of input.records || []) {
      try {
        const mapped = normalizeOutstandingRow(row);

        const tallyCompany = await resolveTallyCompany(
          client,
          input.tenantId,
          row,
          connection,
        );

        const costCenterId = await resolveCostCenterId(client, input.tenantId, {
          cost_center_guid: mapped.cost_center_guid,
          cost_center_name: mapped.cost_center_name,
        });

        if (!mapped.ledger_name) {
          throw new Error("ledger_name is required for outstanding sync");
        }

        if (!mapped.bill_ref) {
          throw new Error("bill_ref is required for outstanding sync");
        }

        if (!mapped.ledger_guid) {
          const ledgerResult = await client.query(
            `
  SELECT tally_guid
  FROM tally_ledgers
  WHERE tenant_id = $1
    AND tally_company_id = $3::uuid
    AND lower(trim(name)) = lower(trim($2))
  LIMIT 1
  `,
            [input.tenantId, mapped.ledger_name, tallyCompany.id],
          );

          mapped.ledger_guid = ledgerResult.rows?.[0]?.tally_guid || null;
        }

        if (!mapped.voucher_number) {
          mapped.voucher_number = mapped.bill_ref;
        }

        if (!mapped.tally_guid) {
          mapped.tally_guid = [
            mapped.ledger_guid || mapped.ledger_name,
            mapped.bill_ref,
            mapped.voucher_number,
            mapped.voucher_date || "",
          ].join("::");
        }

        const existingOutstanding = await client.query(
          `
  SELECT id
  FROM tally_outstandings
  WHERE tenant_id = $1
    AND tally_company_id = $6::uuid
    AND COALESCE(NULLIF(ledger_guid, ''), 'NO_LEDGER_GUID')
        = COALESCE(NULLIF($2, ''), 'NO_LEDGER_GUID')
    AND lower(trim(COALESCE(ledger_name, '')))
        = lower(trim(COALESCE($3, '')))
    AND COALESCE(NULLIF(bill_ref, ''), 'NO_BILL_REF')
        = COALESCE(NULLIF($4, ''), 'NO_BILL_REF')
    AND COALESCE(NULLIF(voucher_number, ''), 'NO_VOUCHER_NUMBER')
        = COALESCE(NULLIF($5, ''), 'NO_VOUCHER_NUMBER')
  LIMIT 1
  FOR UPDATE
  `,
          [
            input.tenantId,
            mapped.ledger_guid,
            mapped.ledger_name,
            mapped.bill_ref,
            mapped.voucher_number,
            tallyCompany.id,
          ],
        );

        if (existingOutstanding.rowCount) {
          await client.query(
            `
  UPDATE tally_outstandings
  SET
    tally_guid = $3,
    ledger_guid = $4,
    ledger_name = $5,
    voucher_guid = $6,
    voucher_number = $7,
    voucher_type = $8,
    voucher_date = $9,
    due_date = $10,
    bill_ref = $11,
    bill_type = $12,
    bill_amount = $13,
    pending_amount = $14,
    synced_at = NOW(),
    cost_center_guid = $15,
    cost_center_name = $16,
    cost_center_id = $17,
    cost_category = $18,
    cost_center_amount = $19,
    tally_company_id = $20,
    tally_company_guid = $21,
    tally_company_name = $22
  WHERE id = $1
    AND tenant_id = $2
  `,
            [
              existingOutstanding.rows[0].id,
              input.tenantId,
              mapped.tally_guid,
              mapped.ledger_guid,
              mapped.ledger_name,
              mapped.voucher_guid,
              mapped.voucher_number,
              mapped.voucher_type,
              mapped.voucher_date,
              mapped.due_date,
              mapped.bill_ref,
              mapped.bill_type,
              mapped.bill_amount,
              mapped.pending_amount,
              mapped.cost_center_guid,
              mapped.cost_center_name,
              costCenterId,
              mapped.cost_category,
              mapped.cost_center_amount,
              tallyCompany.id,
              tallyCompany.tally_guid,
              tallyCompany.name,
            ],
          );
        } else {
          await client.query(
            `
  INSERT INTO tally_outstandings
  (
    tenant_id,
    tally_company_id,
    tally_company_guid,
    tally_company_name,
    tally_guid,
    ledger_guid,
    ledger_name,
    voucher_guid,
    voucher_number,
    voucher_type,
    voucher_date,
    due_date,
    bill_ref,
    bill_type,
    bill_amount,
    pending_amount,
    synced_at,
    cost_center_guid,
    cost_center_name,
    cost_center_id,
    cost_category,
    cost_center_amount
  )
  VALUES
  (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),$17,$18,$19,$20,$21
  )
  `,
            [
              input.tenantId,
              tallyCompany.id,
              tallyCompany.tally_guid,
              tallyCompany.name,
              mapped.tally_guid,
              mapped.ledger_guid,
              mapped.ledger_name,
              mapped.voucher_guid,
              mapped.voucher_number,
              mapped.voucher_type,
              mapped.voucher_date,
              mapped.due_date,
              mapped.bill_ref,
              mapped.bill_type,
              mapped.bill_amount,
              mapped.pending_amount,
              mapped.cost_center_guid,
              mapped.cost_center_name,
              costCenterId,
              mapped.cost_category,
              mapped.cost_center_amount,
            ],
          );
        }

        successCount++;
      } catch (error: any) {
        failedCount++;

        await logSyncError({
          tenantId: input.tenantId,
          jobId: job.id,
          entityType: "outstanding",
          tallyGuid:
            (row as any).ledgerGuid ||
            (row as any).ledger_guid ||
            (row as any).guid ||
            null,
          tallyName:
            (row as any).ledgerName ||
            (row as any).ledger_name ||
            (row as any).partyName ||
            null,
          errorMessage: error?.message || "Unknown outstanding sync error",
          rawPayload: row,
        });
      }
    }

    // await updateConnectionSyncStatus({
    //   tenantId: input.tenantId,
    //   failedCount,
    //   errorLabel: "outstanding records",
    // });

    await finishJob({
      jobId: job.id,
      status:
        failedCount === 0 ? "success" : successCount > 0 ? "partial" : "failed",
      totalRecords: input.records.length,
      successCount,
      failedCount,
      tenantId: input.tenantId,
      connectionId: connection?.id || null,
    });

    await client.query("COMMIT");

    return {
      job_id: job.id,
      total: input.records.length,
      success: successCount,
      failed: failedCount,
    };
  } catch (error: any) {
    await client.query("ROLLBACK");

    await finishJob({
      jobId: job.id,
      status: "failed",
      totalRecords: input.records.length,
      successCount,
      failedCount,
      errorMessage: error?.message || "Outstanding sync failed",
      tenantId: input.tenantId,
      connectionId: connection?.id || null,
    });

    throw error;
  } finally {
    client.release();
  }
}

/* ----------------------------- EMPLOYEES ----------------------------- */

export async function getTallyEmployees(input: {
  tenantId: string;
  page?: number;
  limit?: number;
  search?: string;
  department?: string;
  designation?: string;
}) {
  const page = Math.max(Number(input.page || 1), 1);
  const limit = Math.min(Math.max(Number(input.limit || 20), 1), 100);
  const offset = (page - 1) * limit;

  const values: any[] = [input.tenantId];
  const where: string[] = [`u.tenant_id = $1`, `u.tally_guid IS NOT NULL`];

  if (input.search) {
    values.push(`%${input.search}%`);
    const idx = values.length;

    where.push(`
      (
        u.name ILIKE $${idx}
        OR u.email ILIKE $${idx}
        OR u.phone ILIKE $${idx}
        OR u.employee_number ILIKE $${idx}
        OR u.employee_code ILIKE $${idx}
        OR u.department ILIKE $${idx}
        OR u.designation ILIKE $${idx}
      )
    `);
  }

  if (input.department) {
    values.push(input.department);
    where.push(`u.department = $${values.length}`);
  }

  if (input.designation) {
    values.push(input.designation);
    where.push(`u.designation = $${values.length}`);
  }

  const whereClause = `WHERE ${where.join(" AND ")}`;

  const countResult = await pool.query(
    `
    SELECT COUNT(*)::int AS total
    FROM public.users u
    ${whereClause}
    `,
    values,
  );

  values.push(limit);
  const limitIdx = values.length;

  values.push(offset);
  const offsetIdx = values.length;

  const result = await pool.query(
    `
    SELECT
      u.id,
      u.tenant_id,
      u.email,
      u.name,
      u.role,
      u.username,
      u.display_name,
      u.first_name,
      u.last_name,
      u.phone,
      u.designation,
      u.department,
      u.employee_code,
      u.employee_number,
      u.is_active,
      u.tally_guid,
      u.tally_master_id,
      u.tally_alter_id,
      u.date_of_joining,
      u.user_source,
      u.created_at,
      u.updated_at
    FROM public.users u
    ${whereClause}
    ORDER BY u.updated_at DESC NULLS LAST, u.created_at DESC
    LIMIT $${limitIdx}
    OFFSET $${offsetIdx}
    `,
    values,
  );

  return {
    rows: result.rows,
    total: countResult.rows[0]?.total || 0,
    page,
    limit,
  };
}

export async function pullTallyEmployees(input: {
  tenantId: string;
  userId?: string | null;
  records: TallyEmployeePayload[];
}) {
  const connection = await getTallyConnection(input.tenantId);

  const job = await createJob({
    tenantId: input.tenantId,
    connectionId: connection?.id || null,
    syncType: "employee",
    direction: "pull",
    userId: input.userId || null,
  });

  const client = await pool.connect();

  let successCount = 0;
  let failedCount = 0;

  try {
    await client.query("BEGIN");

    for (const row of input.records || []) {
      try {
        const mapped = normalizeEmployeeRow(row);

        if (!mapped.name) {
          throw new Error("Employee name is required");
        }

        if (!mapped.tally_guid) {
          throw new Error("Employee tally_guid is required");
        }

        const email =
          cleanText(mapped.email)?.toLowerCase() ||
          buildTallyEmployeeFallbackEmail({
            tenantId: input.tenantId,
            tallyGuid: mapped.tally_guid,
            employeeNumber: mapped.employee_number,
            name: mapped.name,
          });

        const displayName = mapped.name;
        const firstName =
          mapped.name.split(" ").filter(Boolean)[0] || mapped.name;
        const employeeCode =
          mapped.employee_number || mapped.tally_master_id || null;

        /**
         * Important:
         * Users table has unique constraints on email and tally_guid.
         * So we do not rely only on ON CONFLICT(tally_guid).
         *
         * Priority:
         * 1. Existing user by tally_guid
         * 2. Existing user by email
         * 3. Insert new user
         */
        const existingByTally = await client.query(
          `
          SELECT id
          FROM public.users
          WHERE tenant_id = $1
            AND tally_guid = $2
          LIMIT 1
          FOR UPDATE
          `,
          [input.tenantId, mapped.tally_guid],
        );

        const existingByEmail =
          existingByTally.rowCount > 0
            ? { rowCount: 0, rows: [] as any[] }
            : await client.query(
                `
                SELECT id
                FROM public.users
                WHERE tenant_id = $1
                  AND lower(email) = lower($2)
                LIMIT 1
                FOR UPDATE
                `,
                [input.tenantId, email],
              );

        const existingUserId =
          existingByTally.rows[0]?.id || existingByEmail.rows[0]?.id || null;

        if (existingUserId) {
          await client.query(
            `
            UPDATE public.users
            SET
              email = $3,
              name = $4,
              role = COALESCE(NULLIF(role, ''), 'employee'),
              display_name = $5,
              first_name = COALESCE(first_name, $6),
              phone = $7,
              designation = $8,
              department = $9,
              employee_code = $10,
              employee_number = $11,
              tally_guid = $12,
              tally_master_id = $13,
              tally_alter_id = $14,
              date_of_joining = $15,
              user_source = 'tally',
              is_active = true,
              updated_at = NOW(),
              updated_by = $16
            WHERE tenant_id = $1
              AND id = $2
            `,
            [
              input.tenantId,
              existingUserId,
              email,
              mapped.name,
              displayName,
              firstName,
              mapped.phone,
              mapped.designation,
              mapped.department,
              employeeCode,
              mapped.employee_number,
              mapped.tally_guid,
              mapped.tally_master_id,
              mapped.tally_alter_id,
              mapped.date_of_joining,
              input.userId || null,
            ],
          );
        } else {
          await client.query(
            `
            INSERT INTO public.users
            (
              tenant_id,
              email,
              name,
              role,
              username,
              display_name,
              first_name,
              phone,
              designation,
              department,
              employee_code,
              employee_number,
              is_active,
              tally_guid,
              tally_master_id,
              tally_alter_id,
              date_of_joining,
              user_source,
              created_by,
              updated_by,
              created_at,
              updated_at
            )
            VALUES
            (
              $1,
              $2,
              $3,
              'employee',
              NULL,
              $4,
              $5,
              $6,
              $7,
              $8,
              $9,
              $10,
              true,
              $11,
              $12,
              $13,
              $14,
              'tally',
              $15,
              $15,
              NOW(),
              NOW()
            )
            `,
            [
              input.tenantId,
              email,
              mapped.name,
              displayName,
              firstName,
              mapped.phone,
              mapped.designation,
              mapped.department,
              employeeCode,
              mapped.employee_number,
              mapped.tally_guid,
              mapped.tally_master_id,
              mapped.tally_alter_id,
              mapped.date_of_joining,
              input.userId || null,
            ],
          );
        }

        successCount++;
      } catch (error: any) {
        failedCount++;

        await logSyncError({
          tenantId: input.tenantId,
          jobId: job.id,
          entityType: "employee",
          tallyGuid: row.guid || row.tallyGuid || null,
          tallyName: row.name || row.employeeName || row.employee_name || null,
          errorMessage: error?.message || "Unknown employee sync error",
          rawPayload: row,
        });
      }
    }

    // await updateConnectionSyncStatus({
    //   tenantId: input.tenantId,
    //   failedCount,
    //   errorLabel: "employee records",
    // });

    await finishJob({
      jobId: job.id,
      status:
        failedCount === 0 ? "success" : successCount > 0 ? "partial" : "failed",
      totalRecords: input.records.length,
      successCount,
      failedCount,
      tenantId: input.tenantId,
      connectionId: connection?.id || null,
    });

    await client.query("COMMIT");

    return {
      job_id: job.id,
      total: input.records.length,
      success: successCount,
      failed: failedCount,
    };
  } catch (error: any) {
    await client.query("ROLLBACK");

    await finishJob({
      jobId: job.id,
      status: "failed",
      totalRecords: input.records.length,
      successCount,
      failedCount,
      errorMessage: error?.message || "Employee sync failed",
      tenantId: input.tenantId,
      connectionId: connection?.id || null,
    });

    throw error;
  } finally {
    client.release();
  }
}

/* ----------------------------- STOCK ITEMS ----------------------------- */

export async function pullTallyStockItems(input: {
  tenantId: string;
  userId?: string | null;
  records: any[];
}) {
  const connection = await getTallyConnection(input.tenantId);

  const job = await createJob({
    tenantId: input.tenantId,
    connectionId: connection?.id || null,
    syncType: "stock_item",
    direction: "pull",
    userId: input.userId || null,
  });

  const client = await pool.connect();
  let successCount = 0;
  let failedCount = 0;

  try {
    await client.query("BEGIN");

    for (const row of input.records) {
      try {
        const mapped = mapTallyStockItemToProduct(row);
        const tallyCompany = await resolveTallyCompany(
          client,
          input.tenantId,
          row,
          connection,
        );

        const existingMapping = row.guid
          ? await client.query(
              `
              SELECT crm_entity_id
              FROM tally_entity_mappings
              WHERE tenant_id = $1
                AND entity_type = 'stock_item'
                AND tally_guid = $2
              LIMIT 1
              `,
              [input.tenantId, row.guid],
            )
          : { rowCount: 0, rows: [] as any[] };

        let productId: string;

        if (
          existingMapping.rowCount &&
          existingMapping.rows[0]?.crm_entity_id
        ) {
          productId = existingMapping.rows[0].crm_entity_id;

          const updateByMappingResult = await client.query(
            `
  UPDATE products
  SET name = $3,
      part_number = $4,
      hsn_code = $5,
      unit_uqc = $6,
      category = $7,
      description = $8,
      status = $9,
      cost_price_currency = $10,
      cost_price = $11,
      msp_currency = $12,
      msp = $13,
      selling_price_currency = $14,
      selling_price = $15,
      tax = $16,
      opening_stock = $17,
      opening_stock_value = $18,
      stock_on_hand = $19,
      available_for_sale = $20,
      updated_by = $21,
      
      updated_at = NOW()
  WHERE id = $1
    AND tenant_id = $2
  `,
            [
              productId,
              input.tenantId,
              mapped.name,
              mapped.part_number,
              mapped.hsn_code,
              mapped.unit_uqc,
              mapped.category,
              mapped.description,
              mapped.status,
              mapped.cost_price_currency,
              mapped.cost_price,
              mapped.msp_currency,
              mapped.msp,
              mapped.selling_price_currency,
              mapped.selling_price,
              mapped.tax,
              mapped.opening_stock,
              mapped.opening_stock_value,
              mapped.stock_on_hand,
              mapped.available_for_sale,
              input.userId || null,
            ],
          );

          if (updateByMappingResult.rowCount === 0) {
            await client.query(
              `
    DELETE FROM tally_entity_mappings
    WHERE tenant_id = $1
      AND entity_type IN ('stock_item', 'product')
      AND tally_guid = $2
    `,
              [input.tenantId, row.guid],
            );

            const existingByPartNumberAfterStaleMapping = mapped.part_number
              ? await client.query(
                  `
        SELECT id
        FROM products
        WHERE tenant_id = $1
          AND part_number = $2
        LIMIT 1
        `,
                  [input.tenantId, mapped.part_number],
                )
              : { rowCount: 0, rows: [] as any[] };

            if (existingByPartNumberAfterStaleMapping.rowCount) {
              productId = existingByPartNumberAfterStaleMapping.rows[0].id;

              await client.query(
                `
      UPDATE products
      SET name = $3,
          hsn_code = $4,
          unit_uqc = $5,
          category = $6,
          description = $7,
          status = $8,
          cost_price_currency = $9,
          cost_price = $10,
          msp_currency = $11,
          msp = $12,
          selling_price_currency = $13,
          selling_price = $14,
          tax = $15,
          opening_stock = $16,
          opening_stock_value = $17,
          stock_on_hand = $18,
          available_for_sale = $19,
          updated_by = $20,
          updated_at = NOW()
      WHERE id = $1
        AND tenant_id = $2
      `,
                [
                  productId,
                  input.tenantId,
                  mapped.name,
                  mapped.hsn_code,
                  mapped.unit_uqc,
                  mapped.category,
                  mapped.description,
                  mapped.status,
                  mapped.cost_price_currency,
                  mapped.cost_price,
                  mapped.msp_currency,
                  mapped.msp,
                  mapped.selling_price_currency,
                  mapped.selling_price,
                  mapped.tax,
                  mapped.opening_stock,
                  mapped.opening_stock_value,
                  mapped.stock_on_hand,
                  mapped.available_for_sale,
                  input.userId || null,
                ],
              );
            } else {
              const productResult = await client.query(
                `
      INSERT INTO products
      (
        tenant_id,
        name,
        part_number,
        hsn_code,
        unit_uqc,
        category,
        description,
        status,
        cost_price_currency,
        cost_price,
        msp_currency,
        msp,
        selling_price_currency,
        selling_price,
        tax,
        opening_stock,
        opening_stock_value,
        stock_on_hand,
        committed_stock,
        available_for_sale,
        qty_to_be_invoiced_shipped,
        qty_to_be_received_billed,
        source,
        created_by,
        updated_by,
        created_at,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,'tally',$23,$23,NOW(),NOW()
      )
      RETURNING id
      `,
                [
                  input.tenantId,
                  mapped.name,
                  mapped.part_number,
                  mapped.hsn_code,
                  mapped.unit_uqc,
                  mapped.category,
                  mapped.description,
                  mapped.status,
                  mapped.cost_price_currency,
                  mapped.cost_price,
                  mapped.msp_currency,
                  mapped.msp,
                  mapped.selling_price_currency,
                  mapped.selling_price,
                  mapped.tax,
                  mapped.opening_stock,
                  mapped.opening_stock_value,
                  mapped.stock_on_hand,
                  mapped.committed_stock,
                  mapped.available_for_sale,
                  mapped.qty_to_be_invoiced_shipped,
                  mapped.qty_to_be_received_billed,
                  input.userId || null,
                ],
              );

              productId = productResult.rows[0].id;
            }
          }
        } else {
          const existingByPartNumber = mapped.part_number
            ? await client.query(
                `
                SELECT id
                FROM products
                WHERE tenant_id = $1
                  AND part_number = $2
                LIMIT 1
                `,
                [input.tenantId, mapped.part_number],
              )
            : { rowCount: 0, rows: [] as any[] };

          if (existingByPartNumber.rowCount) {
            productId = existingByPartNumber.rows[0].id;

            await client.query(
              `
  UPDATE products
  SET name = $3,
      hsn_code = $4,
      unit_uqc = $5,
      category = $6,
      description = $7,
      status = $8,
      cost_price_currency = $9,
      cost_price = $10,
      msp_currency = $11,
      msp = $12,
      selling_price_currency = $13,
      selling_price = $14,
      tax = $15,
      opening_stock = $16,
      opening_stock_value = $17,
      stock_on_hand = $18,
      available_for_sale = $19,
      updated_by = $20,
      updated_at = NOW()
  WHERE id = $1
    AND tenant_id = $2
  `,
              [
                productId,
                input.tenantId,
                mapped.name,
                mapped.hsn_code,
                mapped.unit_uqc,
                mapped.category,
                mapped.description,
                mapped.status,
                mapped.cost_price_currency,
                mapped.cost_price,
                mapped.msp_currency,
                mapped.msp,
                mapped.selling_price_currency,
                mapped.selling_price,
                mapped.tax,
                mapped.opening_stock,
                mapped.opening_stock_value,
                mapped.stock_on_hand,
                mapped.available_for_sale,
                input.userId || null,
              ],
            );
          } else {
            const productResult = await client.query(
              `
  INSERT INTO products
  (
    tenant_id,
    name,
    part_number,
    hsn_code,
    unit_uqc,
    category,
    description,
    status,
    cost_price_currency,
    cost_price,
    msp_currency,
    msp,
    selling_price_currency,
    selling_price,
    tax,
    opening_stock,
    opening_stock_value,
    stock_on_hand,
    committed_stock,
    available_for_sale,
    qty_to_be_invoiced_shipped,
    qty_to_be_received_billed,
    source,
    created_by,
    updated_by,
    created_at,
    updated_at
  )
  VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
    $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
    $21,$22,'tally',$23,$23,NOW(),NOW()
  )
  RETURNING id
  `,
              [
                input.tenantId,
                mapped.name,
                mapped.part_number,
                mapped.hsn_code,
                mapped.unit_uqc,
                mapped.category,
                mapped.description,
                mapped.status,
                mapped.cost_price_currency,
                mapped.cost_price,
                mapped.msp_currency,
                mapped.msp,
                mapped.selling_price_currency,
                mapped.selling_price,
                mapped.tax,
                mapped.opening_stock,
                mapped.opening_stock_value,
                mapped.stock_on_hand,
                mapped.committed_stock,
                mapped.available_for_sale,
                mapped.qty_to_be_invoiced_shipped,
                mapped.qty_to_be_received_billed,
                input.userId || null,
              ],
            );

            productId = productResult.rows[0].id;
          }
        }

        await client.query(
          `
  UPDATE products
  SET
    tally_company_id = $3,
    tally_company_guid = $4,
    tally_company_name = $5,
    updated_at = NOW()
  WHERE tenant_id = $1
    AND id = $2
  `,
          [
            input.tenantId,
            productId,
            tallyCompany.id,
            tallyCompany.tally_guid,
            tallyCompany.name,
          ],
        );

        await upsertMapping(client, {
          tenantId: input.tenantId,
          entityType: "stock_item",
          crmEntityId: productId,
          tallyGuid: row.guid,
          tallyMasterId: row.masterId,
          tallyAlterId: row.alterId,
          tallyName: row.name,
        });

        successCount++;
      } catch (error: any) {
        failedCount++;

        await logSyncError({
          tenantId: input.tenantId,
          jobId: job.id,
          entityType: "stock_item",
          tallyGuid: row.guid || null,
          tallyName: row.name || null,
          errorMessage: error?.message || "Unknown stock item sync error",
          rawPayload: row,
        });
      }
    }

    // await updateConnectionSyncStatus({
    //   tenantId: input.tenantId,
    //   failedCount,
    //   errorLabel: "stock item records",
    // });

    await finishJob({
      jobId: job.id,
      status:
        failedCount === 0 ? "success" : successCount > 0 ? "partial" : "failed",
      totalRecords: input.records.length,
      successCount,
      failedCount,
      tenantId: input.tenantId,
      connectionId: connection?.id || null,
    });

    await client.query("COMMIT");

    return {
      job_id: job.id,
      total: input.records.length,
      success: successCount,
      failed: failedCount,
    };
  } catch (error: any) {
    await client.query("ROLLBACK");

    await finishJob({
      jobId: job.id,
      status: "failed",
      totalRecords: input.records.length,
      successCount,
      failedCount,
      errorMessage: error?.message || "Stock item sync failed",
      tenantId: input.tenantId,
      connectionId: connection?.id || null,
    });

    throw error;
  } finally {
    client.release();
  }
}

/* ----------------------------- PO / SO COMMON ----------------------------- */

/* ----------------------------- PO / SO COMMON ----------------------------- */

async function pullTallyVouchers(input: {
  tenantId: string;
  userId?: string | null;
  records: TallyVoucherPayload[];
  entityType: "purchase_order" | "sales_order";
}) {
  const isPO = input.entityType === "purchase_order";

  const headerTable = isPO ? "purchase_orders" : "sales_orders";
  const itemTable = isPO ? "purchase_order_items" : "sales_order_items";
  const orderFkColumn = isPO ? "purchase_order_id" : "sales_order_id";

  const connection = await getTallyConnection(input.tenantId);

  const job = await createJob({
    tenantId: input.tenantId,
    connectionId: connection?.id || null,
    syncType: input.entityType,
    direction: "pull",
    userId: input.userId || null,
  });

  const client = await pool.connect();
  let successCount = 0;
  let failedCount = 0;

  try {
    await client.query("BEGIN");

    for (const row of input.records || []) {
      try {
        const voucherNo = cleanText(
          row.voucherNumber || row.number || row.referenceNumber || row.guid,
        );
        const normalizedVoucherNo = isPO
          ? formatPurchaseOrderVoucherNumber(voucherNo)
          : formatSalesOrderVoucherNumber(voucherNo);

        if (!voucherNo) {
          throw new Error("Voucher number is required");
        }

        const tallyGuid = cleanText(row.guid);
        const tallyCompany = await resolveTallyCompany(
          client,
          input.tenantId,
          row,
          connection,
        );
        const partyName = cleanText(row.partyName || row.ledgerName);
        const organizationId = await findOrganizationIdByName(
          client,
          input.tenantId,
          partyName,
        );

        const voucherDate = normalizeDate(
          row.voucherDate ||
            row.voucher_date ||
            row.date ||
            row.DATE ||
            row.VOUCHERDATE,
        );

        console.log("[CRM SAVE VOUCHER DATE]", {
          entityType: input.entityType,
          voucherNumber: row.voucherNumber,
          rawVoucherDate: row.voucherDate,
          rawVoucher_date: row.voucher_date,
          rawDate: row.date,
          finalVoucherDate: voucherDate,
        });

        const poDate = isPO ? voucherDate : null;
        const soDate = !isPO ? voucherDate : null;
        const tallyVoucherGuid = pickFirstText(
          (row as any).voucherGuid,
          (row as any).voucher_guid,
          row.guid,
        );

        const referenceNumber = normalizeRef(
          pickFirstText(
            row.referenceNumber,
            (row as any).basicOrderRef,
            (row as any).basic_order_ref,
            (row as any).orderRef,
            (row as any).order_ref,
            (row as any).basicBuyerOrderNo,
            (row as any).basic_buyer_order_no,
          ),
        );

        const totalAmount = toNumber(row.totalAmount ?? row.amount);
        const status = cleanText(row.status) || "draft";

        const costCenterGuid = cleanText(
          (row as any).cost_center_guid || (row as any).costCenterGuid,
        );

        const costCenterName = cleanText(
          (row as any).cost_center_name || (row as any).costCenterName,
        );

        const costCategory = cleanText(
          (row as any).cost_category || (row as any).costCategory,
        );

        const costCenterAmount = toNumber(
          (row as any).cost_center_amount || (row as any).costCenterAmount,
        );

        const costCenterAllocations =
          (row as any).cost_center_allocations ||
          (row as any).costCenterAllocations ||
          [];

        const costCenterId = await resolveCostCenterId(client, input.tenantId, {
          cost_center_guid: costCenterGuid,
          cost_center_name: costCenterName,
        });

        let orderId: string | null = null;

        const existingOrder = await client.query(
          `
  SELECT id
  FROM ${headerTable}
  WHERE tenant_id = $1
    AND deleted_at IS NULL
    AND (
      (
        $2::text IS NOT NULL
        AND (
          tally_guid = $2
          ${isPO ? "" : "OR voucher_guid = $2"}
        )
      )
      OR ($3::text IS NOT NULL AND voucher_number = $3)
      OR ($4::text IS NOT NULL AND reference_number = $4)
      OR ($5::text IS NOT NULL AND tally_voucher_number = $5)
    )
  ORDER BY
    CASE
      WHEN $2::text IS NOT NULL AND tally_guid = $2 THEN 1
      ${isPO ? "" : "WHEN $2::text IS NOT NULL AND voucher_guid = $2 THEN 2"}
      WHEN $5::text IS NOT NULL AND tally_voucher_number = $5 THEN 3
      WHEN $3::text IS NOT NULL AND voucher_number = $3 THEN 4
      WHEN $4::text IS NOT NULL AND reference_number = $4 THEN 5
      ELSE 99
    END
  LIMIT 2
  FOR UPDATE
  `,
          [
            input.tenantId,
            tallyVoucherGuid || tallyGuid,
            normalizedVoucherNo,
            referenceNumber,
            voucherNo,
          ],
        );

        if (existingOrder.rowCount > 1) {
          throw new Error(
            `Multiple ${input.entityType} records matched voucher ${voucherNo}`,
          );
        }

        if (existingOrder.rowCount) {
          orderId = existingOrder.rows[0].id;

          if (isPO) {
            await client.query(
              `
  UPDATE purchase_orders
  SET
    tally_guid = COALESCE($3, tally_guid),
    voucher_number = COALESCE($4, voucher_number),
    tally_voucher_number = $5,
    voucher_date = COALESCE($6, voucher_date),
    po_date = COALESCE($6, po_date),
    supplier_name = $7,
    reference_number = $8,
    total_amount = $9,
    status = $10,
    raw_tally_data = $11,
    cost_center_guid = $12,
    cost_center_name = $13,
    cost_center_id = $14,
    cost_category = $15,
    cost_center_amount = $16,
    cost_center_allocations = $17,
    tally_company_id = $18,
    tally_company_guid = $19,
    tally_company_name = $20,
    updated_at = NOW()
  WHERE id = $1
    AND tenant_id = $2
  `,
              [
                orderId,
                input.tenantId,
                tallyGuid,
                normalizedVoucherNo,
                voucherNo,
                voucherDate,
                partyName,
                referenceNumber,
                totalAmount,
                status,
                JSON.stringify(row),
                costCenterGuid,
                costCenterName,
                costCenterId,
                costCategory,
                costCenterAmount,
                JSON.stringify(costCenterAllocations),
                tallyCompany.id,
                tallyCompany.tally_guid,
                tallyCompany.name,
              ],
            );
          } else {
            await client.query(
              `
  UPDATE sales_orders
  SET
    tally_guid = COALESCE($3, tally_guid),
    voucher_guid = COALESCE($3, voucher_guid),
    voucher_number = COALESCE($4, voucher_number),
    tally_voucher_number = $5,
    voucher_date = COALESCE($6, voucher_date),
    so_date = COALESCE($6, so_date),
    customer_name = $7,
    reference_number = $8,
    source = COALESCE(source, 'crm'),
    sync_status = 'synced',
    tally_entry_status = 'created',
    last_synced_from_tally_at = NOW(),
    total_amount = $9,
    status = $10,
    raw_tally_data = $11,
    customer_id = $12,
    organization_id = $12,
    cost_center_guid = $13,
    cost_center_name = $14,
    cost_center_id = $15,
    cost_category = $16,
    cost_center_amount = $17,
    cost_center_allocations = $18,
    tally_company_id = $19,
    tally_company_guid = $20,
    tally_company_name = $21,
    updated_at = NOW()
  WHERE id = $1
    AND tenant_id = $2
  `,
              [
                orderId,
                input.tenantId,
                tallyVoucherGuid || tallyGuid,
                normalizedVoucherNo,
                voucherNo,
                voucherDate,
                partyName,
                referenceNumber,
                totalAmount,
                status,
                JSON.stringify(row),
                organizationId,
                costCenterGuid,
                costCenterName,
                costCenterId,
                costCategory,
                costCenterAmount,
                JSON.stringify(costCenterAllocations),
                tallyCompany.id,
                tallyCompany.tally_guid,
                tallyCompany.name,
              ],
            );
          }
        } else {
          if (isPO) {
            const orderResult = await client.query(
              `
  INSERT INTO purchase_orders
  (
    tenant_id,
    tally_company_id,
    tally_company_guid,
    tally_company_name,
    tally_guid,
    voucher_number,
    tally_voucher_number,
    voucher_date,
    po_date,
    supplier_name,
    reference_number,
    total_amount,
    status,
    raw_tally_data,
    cost_center_guid,
    cost_center_name,
    cost_center_id,
    cost_category,
    cost_center_amount,
    cost_center_allocations,
    created_at,
    updated_at
  )
  VALUES
  (
    $1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW(),NOW()
  )
  RETURNING id
  `,
              [
                input.tenantId,
                tallyCompany.id,
                tallyCompany.tally_guid,
                tallyCompany.name,
                tallyGuid,
                normalizedVoucherNo,
                voucherNo,
                voucherDate,
                partyName,
                referenceNumber,
                totalAmount,
                status,
                JSON.stringify(row),
                costCenterGuid,
                costCenterName,
                costCenterId,
                costCategory,
                costCenterAmount,
                JSON.stringify(costCenterAllocations),
              ],
            );

            orderId = orderResult.rows[0].id;
          } else {
            const orderResult = await client.query(
              `
  INSERT INTO sales_orders
  (
    tenant_id,
    tally_company_id,
    tally_company_guid,
    tally_company_name,
    tally_guid,
    voucher_guid,
    voucher_number,
    tally_voucher_number,
    voucher_date,
    so_date,
    customer_name,
    reference_number,
    source,
    sync_status,
    tally_entry_status,
    last_synced_from_tally_at,
    total_amount,
    status,
    raw_tally_data,
    customer_id,
    organization_id,
    cost_center_guid,
    cost_center_name,
    cost_center_id,
    cost_category,
    cost_center_amount,
    cost_center_allocations,
    created_at,
    updated_at
  )
  VALUES
  (
    $1,$2,$3,$4,$5,$5,$6,$7,$8,$8,$9,$10,
    'tally','synced','created',NOW(),
    $11,$12,$13,$14,$14,$15,$16,$17,$18,$19,$20,NOW(),NOW()
  )
  RETURNING id
  `,
              [
                input.tenantId,
                tallyCompany.id,
                tallyCompany.tally_guid,
                tallyCompany.name,
                tallyVoucherGuid || tallyGuid,
                normalizedVoucherNo,
                voucherNo,
                voucherDate,
                partyName,
                referenceNumber,
                totalAmount,
                status,
                JSON.stringify(row),
                organizationId,
                costCenterGuid,
                costCenterName,
                costCenterId,
                costCategory,
                costCenterAmount,
                JSON.stringify(costCenterAllocations),
              ],
            );

            orderId = orderResult.rows[0].id;
          }
        }

        if (!orderId) {
          throw new Error("Order id was not created");
        }

        await client.query(
          `
          DELETE FROM ${itemTable}
          WHERE tenant_id = $1
            AND ${orderFkColumn} = $2
          `,
          [input.tenantId, orderId],
        );

        const items = Array.isArray(row.items) ? row.items : [];

        for (let index = 0; index < items.length; index++) {
          const item = items[index];

          const productName = cleanText(item.stockItemName || item.itemName);
          const productId = await findProductIdByName(
            client,
            input.tenantId,
            productName,
          );

          const qty = toNumber(item.quantity);
          const rate = toNumber(item.rate);
          const amount = toNumber(item.amount, qty * rate);

          await client.query(
            `
            INSERT INTO ${itemTable}
            (
              tenant_id,
              ${orderFkColumn},
              product_id,
              item_name,
              description,
              quantity,
              unit,
              rate,
              amount,
              sort_order,
              created_at,
              updated_at
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
            `,
            [
              input.tenantId,
              orderId,
              productId,
              productName,
              cleanText(item.description),
              qty,
              cleanText(item.unit),
              rate,
              amount,
              index + 1,
            ],
          );
        }

        await upsertMapping(client, {
          tenantId: input.tenantId,
          entityType: input.entityType,
          crmEntityId: orderId,
          tallyGuid,
          tallyMasterId: row.masterId,
          tallyAlterId: row.alterId,
          tallyName: voucherNo,
        });

        successCount++;
      } catch (error: any) {
        failedCount++;

        await logSyncError({
          tenantId: input.tenantId,
          jobId: job.id,
          entityType: input.entityType,
          tallyGuid: row.guid || null,
          tallyName: row.voucherNumber || row.number || row.partyName || null,
          errorMessage: error?.message || "Unknown voucher sync error",
          rawPayload: row,
        });
      }
    }

    // await updateConnectionSyncStatus({
    //   tenantId: input.tenantId,
    //   failedCount,
    //   errorLabel: `${input.entityType} records`,
    // });

    await finishJob({
      jobId: job.id,
      status:
        failedCount === 0 ? "success" : successCount > 0 ? "partial" : "failed",
      totalRecords: input.records.length,
      successCount,
      failedCount,
      tenantId: input.tenantId,
      connectionId: connection?.id || null,
    });

    await client.query("COMMIT");

    return {
      job_id: job.id,
      total: input.records.length,
      success: successCount,
      failed: failedCount,
    };
  } catch (error: any) {
    await client.query("ROLLBACK");

    await finishJob({
      jobId: job.id,
      status: "failed",
      totalRecords: input.records.length,
      successCount,
      failedCount,
      errorMessage: error?.message || "Voucher sync failed",
      tenantId: input.tenantId,
      connectionId: connection?.id || null,
    });

    throw error;
  } finally {
    client.release();
  }
}

export async function pullTallyPurchaseOrders(input: {
  tenantId: string;
  userId?: string | null;
  records: TallyVoucherPayload[];
}) {
  return pullTallyVouchers({
    ...input,
    entityType: "purchase_order",
  });
}

export async function pullTallySalesOrders(input: {
  tenantId: string;
  userId?: string | null;
  records: TallyVoucherPayload[];
}) {
  return pullTallyVouchers({
    ...input,
    entityType: "sales_order",
  });
}

/* ----------------------------- HISTORY / ERRORS ----------------------------- */

export async function getTallySyncHistory(tenantId: string) {
  const result = await pool.query(
    `
    SELECT *
    FROM tally_sync_jobs
    WHERE tenant_id = $1
    ORDER BY created_at DESC
    LIMIT 50
    `,
    [tenantId],
  );

  return result.rows;
}

export async function getTallySyncErrors(input: {
  tenantId: string;
  jobId?: string;
}) {
  const values: any[] = [input.tenantId];
  let whereClause = `WHERE tenant_id = $1`;

  if (input.jobId) {
    values.push(input.jobId);
    whereClause += ` AND job_id = $2`;
  }

  const result = await pool.query(
    `
    SELECT *
    FROM tally_sync_errors
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT 100
    `,
    values,
  );

  return result.rows;
}

/* ----------------------------- HANDLERS ----------------------------- */

export async function getTallyConnectionHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = req.tenantId;

    const { rows } = await pool.query(
      `
      SELECT
        id,
        tenant_id,
        company_name,
        company_guid,
        tally_url,
        direction,
        frequency_minutes,
        is_active,
        last_synced_at,
        last_company_checked_at,
        created_at,
        updated_at
      FROM tally_connections
      WHERE tenant_id = $1
      LIMIT 1
      `,
      [tenantId],
    );

    return res.status(200).json({
      statusCode: 200,
      message: "Tally connection fetched successfully",
      data: rows[0] || null,
    });
  } catch (error) {
    next(error);
  }
}

export async function saveTallyConnectionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantIdFromReq(req);
    const userId = getUserIdFromReq(req);
    const body = UpsertTallyConnectionSchema.parse(req.body);

    const data = await saveTallyConnection({
      ...body,
      tenantId,
      userId,
    } as any);

    res.json({
      message: "Tally connection saved successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateTallyRunningCompanyHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantIdFromReq(req);

    const companyName = cleanText(req.body?.company_name);
    const companyGuid = cleanText(req.body?.company_guid);
    const tallyUrl = cleanText(req.body?.tally_url) || "http://localhost:9000";

    if (!companyName) {
      return sendTallyResponse(res, 400, "company_name is required", null);
    }

    const { rows } = await pool.query(
      `
      INSERT INTO tally_connections
      (
        tenant_id,
        company_name,
        company_guid,
        tally_url,
        sync_direction,
        sync_frequency_minutes,
        is_active,
        last_company_checked_at,
        created_at,
        updated_at
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        'pull',
        10,
        true,
        now(),
        now(),
        now()
      )
      ON CONFLICT (tenant_id)
      DO UPDATE SET
        company_name = EXCLUDED.company_name,
        company_guid = EXCLUDED.company_guid,
        tally_url = COALESCE(EXCLUDED.tally_url, tally_connections.tally_url),
        last_company_checked_at = now(),
        updated_at = now()
      RETURNING *
      `,
      [tenantId, companyName, companyGuid, tallyUrl],
    );

    await resolveTallyCompany(
      pool,
      tenantId,
      {
        companyName,
        companyGuid,
      },
      rows[0],
    );

    return sendTallyResponse(
      res,
      200,
      "Tally running company updated successfully",
      rows[0],
    );
  } catch (error) {
    next(error);
  }
}

export async function upsertTallyConnectionHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = req.tenantId;
    const userId = req.user?.id || null;

    const body = UpsertTallyConnectionSchema.parse(req.body);

    const { rows } = await pool.query(
      `
      INSERT INTO tally_connections (
        tenant_id,
        company_name,
        company_guid,
        tally_url,
        direction,
        frequency_minutes,
        is_active,
        last_company_checked_at,
        created_by,
        updated_by,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        now(),
        $8,
        $8,
        now(),
        now()
      )
      ON CONFLICT (tenant_id)
      DO UPDATE SET
        company_name = COALESCE(EXCLUDED.company_name, tally_connections.company_name),
        company_guid = COALESCE(EXCLUDED.company_guid, tally_connections.company_guid),
        tally_url = COALESCE(EXCLUDED.tally_url, tally_connections.tally_url),
        direction = COALESCE(EXCLUDED.direction, tally_connections.direction),
        frequency_minutes = COALESCE(EXCLUDED.frequency_minutes, tally_connections.frequency_minutes),
        is_active = COALESCE(EXCLUDED.is_active, tally_connections.is_active),
        last_company_checked_at = now(),
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
      RETURNING *
      `,
      [
        tenantId,
        body.company_name || null,
        body.company_guid || null,
        body.tally_url || "http://localhost:9000",
        body.direction || "pull",
        body.frequency_minutes || 10,
        body.is_active ?? true,
        userId,
      ],
    );

    return res.status(200).json({
      statusCode: 200,
      message: "Tally connection updated successfully",
      data: rows[0],
    });
  } catch (error) {
    next(error);
  }
}

export async function pullTallyLedgersHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantIdFromReq(req);
    const userId = getUserIdFromReq(req);
    const body = PullLedgersSchema.parse(req.body) as TallyLedgerPayload;

    const data = await pullTallyLedgers({
      tenantId,
      userId,
      records: body?.records || [],
    });

    res.json({
      message: "Tally ledgers synced successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function pullTallyOutstandingsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantIdFromReq(req);
    const userId = getUserIdFromReq(req);

    const body = PullOutstandingsSchema.parse(req.body);

    const data = await pullTallyOutstandings({
      tenantId,
      userId,
      records: body.records || [],
    });

    res.json({
      statusCode: 200,
      message: "Tally outstandings synced successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function getTallyEmployeesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantIdFromReq(req);

    const data = await getTallyEmployees({
      tenantId,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20,
      search: req.query.search ? String(req.query.search) : undefined,
      department: req.query.department
        ? String(req.query.department)
        : undefined,
      designation: req.query.designation
        ? String(req.query.designation)
        : undefined,
    });

    res.json({ data });
  } catch (error) {
    next(error);
  }
}

export async function pullTallyCostCenters(input: {
  tenantId: string;
  userId?: string | null;
  records: any[];
}) {
  const client = await pool.connect();

  let successCount = 0;
  let failedCount = 0;

  try {
    await client.query("BEGIN");

    for (const row of input.records || []) {
      try {
        const name = String(row.name || "").trim();

        if (!name) {
          throw new Error("cost center name is required");
        }

        const tallyGuid = row.guid ? String(row.guid).trim() : null;

        const connection = await getTallyConnection(input.tenantId);

        const tallyCompany = await resolveTallyCompany(
          client,
          input.tenantId,
          row,
          connection,
        );

        const { rows } = await client.query(
          `
  INSERT INTO cost_centers (
    tenant_id,
    tally_company_id,
    tally_company_guid,
    tally_company_name,
    tally_guid,
    name,
    parent_name,
    description,
    status,
    created_at,
    updated_at
  )
  VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, 'active', now(), now()
  )
  ON CONFLICT (tenant_id, tally_guid)
  DO UPDATE SET
    tally_company_id = EXCLUDED.tally_company_id,
    tally_company_guid = EXCLUDED.tally_company_guid,
    tally_company_name = EXCLUDED.tally_company_name,
    name = EXCLUDED.name,
    parent_name = EXCLUDED.parent_name,
    description = EXCLUDED.description,
    updated_at = now()
  RETURNING id
  `,
          [
            input.tenantId,
            tallyCompany.id,
            tallyCompany.tally_guid,
            tallyCompany.name,
            tallyGuid || name,
            name,
            row.parent || row.category || null,
            row.description || null,
          ],
        );

        successCount++;
      } catch (error: any) {
        failedCount++;
        console.error("[TALLY][COST_CENTER][ERROR]", {
          name: row?.name,
          guid: row?.guid,
          error: error?.message,
        });
      }
    }

    await client.query("COMMIT");

    return {
      successCount,
      failedCount,
      totalCount: input.records?.length || 0,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function pullTallyEmployeesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantIdFromReq(req);
    const userId = getUserIdFromReq(req);

    const records = Array.isArray(req.body?.records) ? req.body.records : [];

    const data = await pullTallyEmployees({
      tenantId,
      userId,
      records,
    });

    res.json({
      message: "Tally employees synced successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function pullCostCentersHandler(req: any, res: any, next: any) {
  try {
    const tenantId = req.tenant?.id || req.tenantId;
    const userId = req.user?.id || null;

    const result = await pullTallyCostCenters({
      tenantId,
      userId,
      records: req.body?.records || [],
    });

    res.json({
      statusCode: 200,
      message: "Cost centers synced successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function pullTallyStockItemsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantIdFromReq(req);
    const userId = getUserIdFromReq(req);
    const body = PullStockItemsSchema.parse(req.body);

    const data = await pullTallyStockItems({
      tenantId,
      userId,
      records: body.records || [],
    });

    res.json({
      message: "Tally stock items synced successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function pullTallyPurchaseOrdersHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantIdFromReq(req);
    const userId = getUserIdFromReq(req);

    const body = PullPurchaseOrdersSchema.parse(req.body) as any;

    console.log("[PURCHASE ORDER RAW BODY SAMPLE]", body.records.slice(0, 1));

    const data = await pullTallyPurchaseOrders({
      tenantId,
      userId,
      records: body.records || [],
    });

    res.json({
      statusCode: 200,
      message: "Tally purchase orders synced successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function pullTallySalesOrdersHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantIdFromReq(req);
    const userId = getUserIdFromReq(req);

    const body = PullSalesOrdersSchema.parse(req.body) as any;

    console.log("[SALES ORDER RAW BODY SAMPLE]", body.records.slice(0, 1));

    const data = await pullTallySalesOrders({
      tenantId,
      userId,
      records: body.records || [],
    });

    res.json({
      statusCode: 200,
      message: "Tally sales orders synced successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function getTallySyncHistoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantIdFromReq(req);
    const data = await getTallySyncHistory(tenantId);
    res.json({ data });
  } catch (error) {
    next(error);
  }
}

export async function getTallySyncErrorsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantIdFromReq(req);
    const jobId = req.query.job_id ? String(req.query.job_id) : undefined;

    const data = await getTallySyncErrors({
      tenantId,
      jobId,
    });

    res.json({ data });
  } catch (error) {
    next(error);
  }
}

function sendTallyResponse(
  res: Response,
  statusCode: number,
  message: string,
  data: any = null,
) {
  return res.status(statusCode).json({
    statusCode,
    message,
    data,
  });
}

export async function getTallySyncStatusHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantIdFromReq(req);

    const [connectionResult, lastSyncResult, lastErrorsResult] =
      await Promise.all([
        pool.query(
          `
          SELECT
            id,
            company_name,
            tally_url,
            sync_direction,
            sync_frequency_minutes,
            is_active,
            last_synced_at,
            created_at,
            updated_at
          FROM tally_connections
          WHERE tenant_id = $1
          ORDER BY updated_at DESC NULLS LAST, created_at DESC
          LIMIT 1
          `,
          [tenantId],
        ),

        pool.query(
          `
  WITH recent_jobs AS (
    SELECT
      id,
      connection_id,
      sync_type,
      direction,
      status,
      COALESCE(total_records, 0) AS total_records,
      COALESCE(success_count, 0) AS success_count,
      COALESCE(failed_count, 0) AS failed_count,
      started_at,
      completed_at,
      created_at
    FROM tally_sync_jobs
    WHERE tenant_id = $1
      AND created_at >= (
        SELECT COALESCE(MAX(created_at), now())
        FROM tally_sync_jobs
        WHERE tenant_id = $1
      ) - INTERVAL '30 minutes'
    ORDER BY created_at DESC
  )
  SELECT
    'full_sync' AS sync_type,
    'pull' AS direction,
    CASE
      WHEN COUNT(*) = 0 THEN 'no_sync'
      WHEN COUNT(*) FILTER (WHERE status = 'failed') > 0 THEN 'partial_failed'
      WHEN COUNT(*) FILTER (WHERE status = 'running') > 0 THEN 'running'
      ELSE 'success'
    END AS status,
    COALESCE(SUM(total_records), 0) AS total_records,
    COALESCE(SUM(success_count), 0) AS success_count,
    COALESCE(SUM(failed_count), 0) AS failed_count,
    MAX(COALESCE(started_at, created_at)) AS started_at,
    MAX(COALESCE(completed_at, created_at)) AS completed_at,
    MAX(created_at) AS created_at,
    json_agg(
      json_build_object(
        'id', id,
        'sync_type', sync_type,
        'direction', direction,
        'status', status,
        'total_records', total_records,
        'success_count', success_count,
        'failed_count', failed_count,
        'started_at', started_at,
        'completed_at', completed_at,
        'created_at', created_at
      )
      ORDER BY created_at DESC
    ) FILTER (WHERE id IS NOT NULL) AS jobs
  FROM recent_jobs
  `,
          [tenantId],
        ),

        pool.query(
          `
          SELECT
            id,
            job_id,
            entity_type,
            tally_guid,
            tally_name,
            error_message,
            created_at
          FROM tally_sync_errors
          WHERE tenant_id = $1
          ORDER BY created_at DESC
          LIMIT 5
          `,
          [tenantId],
        ),
      ]);

    const lastSync = lastSyncResult.rows[0] || null;

    if (lastSync?.completed_at && lastSync.status === "success") {
      await pool.query(
        `
    UPDATE tally_connections
    SET
      last_synced_at = $2,
      updated_at = now()
    WHERE tenant_id = $1
    `,
        [tenantId, lastSync.completed_at],
      );
    }

    return sendTallyResponse(res, 200, "Tally sync status fetched", {
      connection: {
        ...(connectionResult.rows[0] || {}),
        last_synced_at:
          connectionResult.rows[0]?.last_synced_at ||
          lastSync?.completed_at ||
          null,
      },
      last_sync: lastSync,
      recent_errors: lastErrorsResult.rows || [],
    });
  } catch (error) {
    next(error);
  }
}

export async function checkTallyConnectionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    getTenantIdFromReq(req);

    const agentUrl = env.TALLY_AGENT_URL;
    const controlToken = env.TALLY_AGENT_TOKEN;

    if (!agentUrl || !controlToken) {
      return sendTallyResponse(
        res,
        500,
        "TALLY_AGENT_URL or TALLY_AGENT_TOKEN is missing in backend",
        {
          reachable: false,
        },
      );
    }

    try {
      const response = await axios.get(`${agentUrl}/health`, {
        timeout: 10000,
        headers: {
          Authorization: `Bearer ${controlToken}`,
        },
      });

      return sendTallyResponse(res, 200, "Tally agent connection successful", {
        reachable: true,
        agent: response.data,
      });
    } catch (error: any) {
      return sendTallyResponse(res, 200, "Tally agent connection failed", {
        reachable: false,
        error:
          error?.response?.data?.message ||
          error?.message ||
          "Unable to reach Tally sync agent",
      });
    }
  } catch (error) {
    next(error);
  }
}

export async function runTallyManualSyncHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    getTenantIdFromReq(req);

    const agentUrl = env.TALLY_AGENT_URL;
    const controlToken = env.TALLY_AGENT_TOKEN;

    if (!agentUrl || !controlToken) {
      return sendTallyResponse(
        res,
        500,
        "TALLY_AGENT_URL or TALLY_AGENT_TOKEN is missing in backend",
        null,
      );
    }

    try {
      const response = await axios.post(
        `${agentUrl}/sync/run`,
        {
          reason: "manual_frontend_trigger",
        },
        {
          timeout: 15000,
          headers: {
            Authorization: `Bearer ${controlToken}`,
            "Content-Type": "application/json",
          },
        },
      );

      return sendTallyResponse(res, 200, "Tally sync started", response.data);
    } catch (error: any) {
      return sendTallyResponse(
        res,
        error?.response?.status || 500,
        error?.response?.data?.message || "Unable to start Tally sync",
        error?.response?.data || {
          message: error?.message,
        },
      );
    }
  } catch (error) {
    next(error);
  }
}

export async function getTallyAgentSyncStateHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantIdFromReq(req);

    const companyName = cleanText(req.query.company_name);
    const companyGuid = cleanText(req.query.company_guid);

    const { rows } = await pool.query(
      `
      SELECT
        id,
        tenant_id,
        company_name,
        company_guid,
        tally_url,
        sync_direction,
        sync_frequency_minutes,
        is_active,
        last_synced_at,
        last_sync_at,
        last_success_at,
        last_error,
        last_company_checked_at,
        created_at,
        updated_at
      FROM tally_connections
      WHERE tenant_id = $1
        AND (
          $2::text IS NULL
          OR company_guid = $2
        )
        AND (
          $3::text IS NULL
          OR lower(trim(company_name)) = lower(trim($3))
        )
      ORDER BY updated_at DESC NULLS LAST, created_at DESC
      LIMIT 1
      `,
      [tenantId, companyGuid, companyName],
    );

    return res.status(200).json({
      statusCode: 200,
      message: "Tally sync state fetched successfully",
      data: rows[0] || null,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateTallyAgentSyncStateHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantIdFromReq(req);

    const companyName = cleanText(req.body?.company_name);
    const companyGuid = cleanText(req.body?.company_guid);
    const syncMode = cleanText(req.body?.sync_mode) || "incremental";
    const startedAt = cleanText(req.body?.started_at);
    const completedAt = cleanText(req.body?.completed_at);
    const status = cleanText(req.body?.status) || "success";
    const errorMessage = cleanText(req.body?.error_message);

    const { rows } = await pool.query(
      `
      INSERT INTO tally_sync_jobs
      (
        tenant_id,
        sync_type,
        direction,
        status,
        started_at,
        completed_at,
        finished_at,
        error_message,
        created_at
      )
      VALUES
      (
        $1,
        $2,
        'pull',
        $3,
        COALESCE($4::timestamptz, now()),
        COALESCE($5::timestamptz, now()),
        COALESCE($5::timestamptz, now()),
        $6,
        now()
      )
      RETURNING *
      `,
      [
        tenantId,
        syncMode === "historical" ? "historical_sync" : "incremental_sync",
        status,
        startedAt,
        completedAt,
        errorMessage,
      ],
    );

    await pool.query(
      `
      UPDATE tally_connections
      SET
        company_name = COALESCE($2, company_name),
        company_guid = COALESCE($3, company_guid),
        last_sync_at = COALESCE($4::timestamptz, now()),
        last_synced_at = CASE
          WHEN $5 IN ('success', 'partial') THEN COALESCE($4::timestamptz, now())
          ELSE last_synced_at
        END,
        last_success_at = CASE
          WHEN $5 IN ('success', 'partial') THEN COALESCE($4::timestamptz, now())
          ELSE last_success_at
        END,
        last_error = CASE
          WHEN $5 = 'failed' THEN $6
          ELSE NULL
        END,
        updated_at = now()
      WHERE tenant_id = $1
        AND (
          ($3::text IS NOT NULL AND company_guid = $3)
          OR ($2::text IS NOT NULL AND lower(trim(company_name)) = lower(trim($2)))
          OR ($2::text IS NULL AND $3::text IS NULL)
        )
      `,
      [tenantId, companyName, companyGuid, completedAt, status, errorMessage],
    );

    return res.status(200).json({
      statusCode: 200,
      message: "Tally sync state updated successfully",
      data: rows[0],
    });
  } catch (error) {
    next(error);
  }
}

export async function markHistoricalSyncProgressHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantIdFromReq(req);

    const companyName = cleanText(req.body?.company_name);
    const companyGuid = cleanText(req.body?.company_guid);
    const fromDate = cleanText(req.body?.from_date);
    const toDate = cleanText(req.body?.to_date);
    const status = cleanText(req.body?.status) || "started";
    const errorMessage = cleanText(req.body?.error_message);

    const { rows } = await pool.query(
      `
      INSERT INTO tally_sync_jobs
      (
        tenant_id,
        sync_type,
        direction,
        status,
        started_at,
        completed_at,
        finished_at,
        error_message,
        created_at
      )
      VALUES
      (
        $1,
        'historical_sync',
        'pull',
        $2,
        now(),
        CASE WHEN $2 IN ('success', 'failed') THEN now() ELSE NULL END,
        CASE WHEN $2 IN ('success', 'failed') THEN now() ELSE NULL END,
        $3,
        now()
      )
      RETURNING *
      `,
      [
        tenantId,
        status === "started" ? "running" : status,
        [
          companyName ? `company=${companyName}` : null,
          companyGuid ? `company_guid=${companyGuid}` : null,
          fromDate ? `from_date=${fromDate}` : null,
          toDate ? `to_date=${toDate}` : null,
          errorMessage,
        ]
          .filter(Boolean)
          .join(" | ") || null,
      ],
    );

    return res.status(200).json({
      statusCode: 200,
      message: "Historical sync progress marked successfully",
      data: rows[0],
    });
  } catch (error) {
    next(error);
  }
}
export async function runTallyHistoricalSyncHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    getTenantIdFromReq(req);

    const agentUrl = env.TALLY_AGENT_URL;
    const controlToken = env.TALLY_AGENT_TOKEN;

    if (!agentUrl || !controlToken) {
      return sendTallyResponse(
        res,
        500,
        "TALLY_AGENT_URL or TALLY_AGENT_TOKEN is missing in backend",
        null,
      );
    }

    const startYear =
      req.body?.startYear !== undefined ? Number(req.body.startYear) : 2022;
    const companyName = cleanText(req.body?.companyName) || undefined;

    try {
      const response = await axios.post(
        `${agentUrl}/sync/historical`,
        {
          startYear,
          companyName,
        },
        {
          timeout: 15000,
          headers: {
            Authorization: `Bearer ${controlToken}`,
            "Content-Type": "application/json",
          },
        },
      );

      return sendTallyResponse(
        res,
        response.status || 202,
        response.data?.message || "Historical sync started",
        response.data?.data ?? response.data,
      );
    } catch (error: any) {
      return sendTallyResponse(
        res,
        error?.response?.status || 500,
        error?.response?.data?.message || "Unable to start historical sync",
        error?.response?.data || {
          message: error?.message,
        },
      );
    }
  } catch (error) {
    next(error);
  }
}

export async function getTallyHistoricalSyncStatusHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    getTenantIdFromReq(req);

    const agentUrl = env.TALLY_AGENT_URL;
    const controlToken = env.TALLY_AGENT_TOKEN;

    if (!agentUrl || !controlToken) {
      return sendTallyResponse(
        res,
        500,
        "TALLY_AGENT_URL or TALLY_AGENT_TOKEN is missing in backend",
        null,
      );
    }

    try {
      const response = await axios.get(`${agentUrl}/sync/historical/status`, {
        timeout: 10000,
        headers: {
          Authorization: `Bearer ${controlToken}`,
        },
      });

      return sendTallyResponse(
        res,
        200,
        response.data?.message || "Historical sync status fetched",
        response.data?.data ?? response.data,
      );
    } catch (error: any) {
      return sendTallyResponse(
        res,
        error?.response?.status || 500,
        error?.response?.data?.message ||
          "Unable to fetch historical sync status",
        error?.response?.data || {
          message: error?.message,
        },
      );
    }
  } catch (error) {
    next(error);
  }
}
