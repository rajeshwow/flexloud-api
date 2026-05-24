import { Request } from "express";

export type AppRequest = Request & {
  tenant?: {
    id?: string;
    tenant_id?: string;
  };
  user?: {
    id?: string;
    user_id?: string;
    sub?: string;
    tenant_id?: string;
  };
};

export function getTenantIdFromRequest(req: AppRequest): string {
  const tenantId =
    req.tenant?.id ||
    req.tenant?.tenant_id ||
    req.user?.tenant_id ||
    (req as any).tenantId ||
    (req as any).tenant_id ||
    req.headers["x-tenant-id"];

  if (!tenantId) {
    throw new Error("Tenant not resolved");
  }

  return String(tenantId);
}

export function getUserIdFromRequest(req: AppRequest): string {
  const userId =
    req.user?.id ||
    req.user?.user_id ||
    req.user?.sub ||
    (req as any).userId ||
    (req as any).user_id;

  if (!userId) {
    throw new Error("User not resolved");
  }

  return String(userId);
}

export function pushSqlParam(values: unknown[], value: unknown) {
  values.push(value);
  return `$${values.length}`;
}

/**
 * Strict user-based Tally data filter.
 *
 * No admin bypass.
 * No role-name check.
 *
 * User can see record only when:
 * 1. record.tenant_id matches
 * 2. record.tally_company_id is mapped to cost center
 * 3. user is assigned to same cost center
 */
export function addTallyRecordAccessFilter(input: {
  where: string[];
  values: unknown[];
  userId: string;
  recordAlias: string;
  costCenterExpression: string;
  tallyCompanyId?: string | null;
}) {
  const {
    where,
    values,
    userId,
    recordAlias,
    costCenterExpression,
    tallyCompanyId,
  } = input;

  if (tallyCompanyId) {
    const companyParam = pushSqlParam(values, tallyCompanyId);
    where.push(`${recordAlias}.tally_company_id = ${companyParam}::uuid`);
  }

  const userParam = pushSqlParam(values, userId);

  where.push(`
    ${recordAlias}.tally_company_id IS NOT NULL
    AND ${costCenterExpression} IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM user_cost_centers ucc
      INNER JOIN tally_company_cost_center_access cca
        ON cca.tenant_id = ucc.tenant_id
       AND cca.cost_center_id = ucc.cost_center_id
       AND cca.tally_company_id = ${recordAlias}.tally_company_id
       AND cca.is_active = true
       AND cca.deleted_at IS NULL
      WHERE ucc.tenant_id = ${recordAlias}.tenant_id
        AND ucc.user_id = ${userParam}::uuid
        AND ucc.cost_center_id = ${costCenterExpression}
        AND ucc.is_active = true
        AND ucc.deleted_at IS NULL
    )
  `);
}

/**
 * Strict user-based cost center master filter.
 *
 * User can see cost center only when:
 * 1. user is assigned to that cost center
 * 2. if tallyCompanyId is provided, that cost center is allowed for that company
 */
export function addCostCenterMasterAccessFilter(input: {
  where: string[];
  values: unknown[];
  tenantAlias: string;
  costCenterAlias: string;
  userId: string;
  tallyCompanyId?: string | null;
}) {
  const {
    where,
    values,
    tenantAlias,
    costCenterAlias,
    userId,
    tallyCompanyId,
  } = input;

  const userParam = pushSqlParam(values, userId);

  where.push(`
    EXISTS (
      SELECT 1
      FROM user_cost_centers ucc
      WHERE ucc.tenant_id = ${tenantAlias}.tenant_id
        AND ucc.cost_center_id = ${costCenterAlias}.id
        AND ucc.user_id = ${userParam}::uuid
        AND ucc.is_active = true
        AND ucc.deleted_at IS NULL
    )
  `);

  if (tallyCompanyId) {
    const companyParam = pushSqlParam(values, tallyCompanyId);

    where.push(`
      EXISTS (
        SELECT 1
        FROM tally_company_cost_center_access cca
        WHERE cca.tenant_id = ${tenantAlias}.tenant_id
          AND cca.cost_center_id = ${costCenterAlias}.id
          AND cca.tally_company_id = ${companyParam}::uuid
          AND cca.is_active = true
          AND cca.deleted_at IS NULL
      )
    `);
  }
}
