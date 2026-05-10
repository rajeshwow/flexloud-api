import type { NextFunction, Request, Response } from "express";
import { pool } from "../../db/pool";
import {
  mapTallyLedgerToOrganization,
  mapTallyStockItemToProduct,
} from "./tally.mapper";
import {
  PullLedgersSchema,
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
  guid?: string | null;
  masterId?: string | number | null;
  alterId?: string | number | null;
  voucherNumber?: string | null;
  number?: string | null;
  date?: string | null;
  partyName?: string | null;
  ledgerName?: string | null;
  referenceNumber?: string | null;
  referenceDate?: string | null;
  narration?: string | null;
  totalAmount?: number | string | null;
  amount?: number | string | null;
  status?: string | null;
  items?: TallyVoucherItemPayload[];
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

    voucher_date:
      normalizeDate(row.voucherDate) || normalizeDate(row.voucher_date),

    due_date: normalizeDate(row.dueDate) || normalizeDate(row.due_date),

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
  status: "success" | "failed" | "partial";
  totalRecords: number;
  successCount: number;
  failedCount: number;
  errorMessage?: string | null;
}) {
  await pool.query(
    `
    UPDATE tally_sync_jobs
    SET status = $2,
        finished_at = NOW(),
        total_records = $3,
        success_count = $4,
        failed_count = $5,
        error_message = $6
    WHERE id = $1
    `,
    [
      input.jobId,
      input.status,
      input.totalRecords,
      input.successCount,
      input.failedCount,
      input.errorMessage || null,
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

async function updateConnectionSyncStatus(input: {
  tenantId: string;
  failedCount: number;
  errorLabel: string;
}) {
  await pool.query(
    `
    UPDATE tally_connections
    SET last_sync_at = NOW(),
        last_success_at = CASE WHEN $2 = 0 THEN NOW() ELSE last_success_at END,
        last_error = CASE WHEN $2 = 0 THEN NULL ELSE $3 END,
        updated_at = NOW()
    WHERE tenant_id = $1
    `,
    [
      input.tenantId,
      input.failedCount,
      input.failedCount
        ? `${input.failedCount} ${input.errorLabel} failed`
        : null,
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
      AND deleted_at IS NULL
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

        await client.query(
          `
          INSERT INTO tally_ledgers
          (
            tenant_id,
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
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
          ON CONFLICT (tenant_id, tally_guid)
          DO UPDATE SET
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
            row.guid,
            mapped.name || row.name,
            row.parent || null,
            mapped.gst_number || row.gstin || row.gstNumber || null,
            mapped.email || row.email || null,
            row.phone || row.mobile || null,
            mapped.registered_state || row.state || null,
            mapped.registered_country || row.country || null,
            toNumber(row.openingBalance ?? row.opening_balance),
            toNumber(row.closingBalance ?? row.closing_balance),
          ],
        );

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

    await updateConnectionSyncStatus({
      tenantId: input.tenantId,
      failedCount,
      errorLabel: "ledger records",
    });

    await finishJob({
      jobId: job.id,
      status:
        failedCount === 0 ? "success" : successCount > 0 ? "partial" : "failed",
      totalRecords: input.records.length,
      successCount,
      failedCount,
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

        if (!mapped.ledger_guid) {
          throw new Error("ledger_guid is required for outstanding sync");
        }

        if (!mapped.ledger_name) {
          throw new Error("ledger_name is required for outstanding sync");
        }

        if (!mapped.bill_ref) {
          throw new Error("bill_ref is required for outstanding sync");
        }

        await client.query(
          `
          INSERT INTO tally_outstandings
          (
            tenant_id,
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
            synced_at
          )
          VALUES
          (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()
          )
          ON CONFLICT (tenant_id, ledger_guid, bill_ref, voucher_number)
          DO UPDATE SET
            tally_guid = EXCLUDED.tally_guid,
            ledger_name = EXCLUDED.ledger_name,
            voucher_guid = EXCLUDED.voucher_guid,
            voucher_type = EXCLUDED.voucher_type,
            voucher_date = EXCLUDED.voucher_date,
            due_date = EXCLUDED.due_date,
            bill_type = EXCLUDED.bill_type,
            bill_amount = EXCLUDED.bill_amount,
            pending_amount = EXCLUDED.pending_amount,
            synced_at = NOW()
          `,
          [
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
          ],
        );

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

    await updateConnectionSyncStatus({
      tenantId: input.tenantId,
      failedCount,
      errorLabel: "outstanding records",
    });

    await finishJob({
      jobId: job.id,
      status:
        failedCount === 0 ? "success" : successCount > 0 ? "partial" : "failed",
      totalRecords: input.records.length,
      successCount,
      failedCount,
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

    await updateConnectionSyncStatus({
      tenantId: input.tenantId,
      failedCount,
      errorLabel: "employee records",
    });

    await finishJob({
      jobId: job.id,
      status:
        failedCount === 0 ? "success" : successCount > 0 ? "partial" : "failed",
      totalRecords: input.records.length,
      successCount,
      failedCount,
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

          await client.query(
            `
            UPDATE products
            SET name = $3,
                part_number = $4,
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
              mapped.part_number,
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
                  unit_uqc = $4,
                  category = $5,
                  description = $6,
                  status = $7,
                  cost_price_currency = $8,
                  cost_price = $9,
                  msp_currency = $10,
                  msp = $11,
                  selling_price_currency = $12,
                  selling_price = $13,
                  tax = $14,
                  opening_stock = $15,
                  opening_stock_value = $16,
                  stock_on_hand = $17,
                  available_for_sale = $18,
                  updated_by = $19,
                  updated_at = NOW()
              WHERE id = $1
                AND tenant_id = $2
              `,
              [
                productId,
                input.tenantId,
                mapped.name,
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
                created_by,
                updated_by,
                created_at,
                updated_at
              )
              VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                $21,$22,$22,NOW(),NOW()
              )
              RETURNING id
              `,
              [
                input.tenantId,
                mapped.name,
                mapped.part_number,
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

    await updateConnectionSyncStatus({
      tenantId: input.tenantId,
      failedCount,
      errorLabel: "stock item records",
    });

    await finishJob({
      jobId: job.id,
      status:
        failedCount === 0 ? "success" : successCount > 0 ? "partial" : "failed",
      totalRecords: input.records.length,
      successCount,
      failedCount,
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
    });

    throw error;
  } finally {
    client.release();
  }
}

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
  const orderNumberColumn = isPO ? "po_number" : "so_number";
  const dateColumn = isPO ? "po_date" : "so_date";
  const partyColumn = isPO ? "vendor_id" : "customer_id";

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

    for (const row of input.records) {
      try {
        const voucherNo = cleanText(row.voucherNumber || row.number);
        if (!voucherNo) throw new Error("Voucher number is required");

        const partyName = cleanText(row.partyName || row.ledgerName);
        const organizationId = await findOrganizationIdByName(
          client,
          input.tenantId,
          partyName,
        );

        const orderDate = normalizeDate(row.date);
        const referenceNumber = cleanText(row.referenceNumber);
        const referenceDate = normalizeDate(row.referenceDate);
        const narration = cleanText(row.narration);
        const totalAmount = toNumber(row.totalAmount ?? row.amount);
        const status = cleanText(row.status) || "draft";

        const existingMapping = row.guid
          ? await client.query(
              `
              SELECT crm_entity_id
              FROM tally_entity_mappings
              WHERE tenant_id = $1
                AND entity_type = $2
                AND tally_guid = $3
              LIMIT 1
              `,
              [input.tenantId, input.entityType, row.guid],
            )
          : { rowCount: 0, rows: [] as any[] };

        let orderId: string;

        if (
          existingMapping.rowCount &&
          existingMapping.rows[0]?.crm_entity_id
        ) {
          orderId = existingMapping.rows[0].crm_entity_id;

          await client.query(
            `
            UPDATE ${headerTable}
            SET ${orderNumberColumn} = $3,
                ${dateColumn} = COALESCE($4, ${dateColumn}),
                ${partyColumn} = $5,
                party_name = $6,
                reference_number = $7,
                reference_date = $8,
                narration = $9,
                total_amount = $10,
                status = $11,
                source = 'tally',
                updated_by = $12,
                updated_at = NOW()
            WHERE id = $1
              AND tenant_id = $2
            `,
            [
              orderId,
              input.tenantId,
              voucherNo,
              orderDate,
              organizationId,
              partyName,
              referenceNumber,
              referenceDate,
              narration,
              totalAmount,
              status,
              input.userId || null,
            ],
          );
        } else {
          const existingByNumber = await client.query(
            `
            SELECT id
            FROM ${headerTable}
            WHERE tenant_id = $1
              AND ${orderNumberColumn} = $2
            LIMIT 1
            `,
            [input.tenantId, voucherNo],
          );

          if (existingByNumber.rowCount) {
            orderId = existingByNumber.rows[0].id;

            await client.query(
              `
              UPDATE ${headerTable}
              SET ${dateColumn} = COALESCE($3, ${dateColumn}),
                  ${partyColumn} = $4,
                  party_name = $5,
                  reference_number = $6,
                  reference_date = $7,
                  narration = $8,
                  total_amount = $9,
                  status = $10,
                  source = 'tally',
                  updated_by = $11,
                  updated_at = NOW()
              WHERE id = $1
                AND tenant_id = $2
              `,
              [
                orderId,
                input.tenantId,
                orderDate,
                organizationId,
                partyName,
                referenceNumber,
                referenceDate,
                narration,
                totalAmount,
                status,
                input.userId || null,
              ],
            );
          } else {
            const orderResult = await client.query(
              `
              INSERT INTO ${headerTable}
              (
                tenant_id,
                ${orderNumberColumn},
                ${dateColumn},
                ${partyColumn},
                party_name,
                reference_number,
                reference_date,
                narration,
                total_amount,
                status,
                source,
                created_by,
                updated_by,
                created_at,
                updated_at
              )
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'tally',$11,$11,NOW(),NOW())
              RETURNING id
              `,
              [
                input.tenantId,
                voucherNo,
                orderDate,
                organizationId,
                partyName,
                referenceNumber,
                referenceDate,
                narration,
                totalAmount,
                status,
                input.userId || null,
              ],
            );

            orderId = orderResult.rows[0].id;
          }
        }

        await client.query(
          `
          DELETE FROM ${itemTable}
          WHERE tenant_id = $1
            AND ${isPO ? "purchase_order_id" : "sales_order_id"} = $2
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
              ${isPO ? "purchase_order_id" : "sales_order_id"},
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
          tallyGuid: row.guid,
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
          tallyName: row.voucherNumber || row.number || null,
          errorMessage:
            error?.message || `Unknown ${input.entityType} sync error`,
          rawPayload: row,
        });
      }
    }

    await updateConnectionSyncStatus({
      tenantId: input.tenantId,
      failedCount,
      errorLabel: `${input.entityType} records`,
    });

    await finishJob({
      jobId: job.id,
      status:
        failedCount === 0 ? "success" : successCount > 0 ? "partial" : "failed",
      totalRecords: input.records.length,
      successCount,
      failedCount,
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
      errorMessage: error?.message || `${input.entityType} sync failed`,
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
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantIdFromReq(req);
    const data = await getTallyConnection(tenantId);
    res.json({ data });
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

    const records = Array.isArray(req.body?.records) ? req.body.records : [];

    const data = await pullTallyOutstandings({
      tenantId,
      userId,
      records,
    });

    res.json({
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
    const body = PullPurchaseOrdersSchema.parse(req.body);

    const data = await pullTallyPurchaseOrders({
      tenantId,
      userId,
      records: body.records,
    });

    res.json({
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
    const body = PullSalesOrdersSchema.parse(req.body);

    const data = await pullTallySalesOrders({
      tenantId,
      userId,
      records: body.records,
    });

    res.json({
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
