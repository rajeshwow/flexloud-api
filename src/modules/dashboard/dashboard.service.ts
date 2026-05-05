import type { NextFunction, Request, Response } from "express";
import { pool } from "../../db/pool";
import { GetDashboardSummarySchema } from "./dashboard.schema";

export type DashboardPeriod = "today" | "week" | "month" | "all";

export type DashboardChartRow = {
  name: string;
  value: number;
};

export type DashboardModuleUsageRow = {
  key: string;
  module: string;
  total: number;
  trend: string;
  status: "Active" | "Growing" | "Needs Attention";
};

export type DashboardActivityRow = {
  id: string;
  title: string;
  description: string;
  time: string;
};

export type GetDashboardSummaryParams = {
  tenantId: string;
  period: DashboardPeriod;
};

type SafeModuleConfig = {
  key: string;
  label: string;
  tableNameCandidates: string[];
  defaultDateColumn?: string;
  defaultDeletedAtColumn?: string;
};

const MODULES: SafeModuleConfig[] = [
  {
    key: "leads",
    label: "Leads",
    tableNameCandidates: ["leads"],
    defaultDateColumn: "created_at",
    defaultDeletedAtColumn: "deleted_at",
  },
  {
    key: "contacts",
    label: "Contacts",
    tableNameCandidates: ["contacts"],
    defaultDateColumn: "created_at",
    defaultDeletedAtColumn: "deleted_at",
  },
  {
    key: "organizations",
    label: "Organizations",
    tableNameCandidates: ["organizations"],
    defaultDateColumn: "created_at",
    defaultDeletedAtColumn: "deleted_at",
  },
  {
    key: "tasks",
    label: "Tasks",
    tableNameCandidates: ["tasks"],
    defaultDateColumn: "created_at",
    defaultDeletedAtColumn: "deleted_at",
  },
  {
    key: "quotes",
    label: "Quotes",
    tableNameCandidates: ["quotes"],
    defaultDateColumn: "created_at",
    defaultDeletedAtColumn: "deleted_at",
  },
  {
    key: "sales_orders",
    label: "Sales Orders",
    tableNameCandidates: ["sales_orders"],
    defaultDateColumn: "created_at",
    defaultDeletedAtColumn: "deleted_at",
  },
  {
    key: "purchase_orders",
    label: "Purchase Orders",
    tableNameCandidates: ["purchase_orders"],
    defaultDateColumn: "created_at",
    defaultDeletedAtColumn: "deleted_at",
  },
  {
    key: "tally_sync_errors",
    label: "Tally Sync Errors",
    tableNameCandidates: ["tally_sync_errors"],
    defaultDateColumn: "created_at",
  },
  {
    key: "visits",
    label: "Visits",
    tableNameCandidates: ["visits"],
    defaultDateColumn: "created_at",
    defaultDeletedAtColumn: "deleted_at",
  },
  {
    key: "interactions",
    label: "Interactions",
    tableNameCandidates: ["interactions"],
    defaultDateColumn: "created_at",
    defaultDeletedAtColumn: "deleted_at",
  },
  {
    key: "users",
    label: "Users",
    tableNameCandidates: ["users"],
    defaultDateColumn: "created_at",
    defaultDeletedAtColumn: "deleted_at",
  },
];

type DashboardFilters = {
  period?: "today" | "week" | "month" | "all";
  start_date?: string;
  end_date?: string;
  assigned_to?: string;
  source?: string;
  columnName?: string;
};

function getPeriodDateCondition(dateColumn: string, period?: string) {
  if (!period || period === "all") return "";

  if (period === "today") {
    return `AND ${dateColumn} >= CURRENT_DATE AND ${dateColumn} < CURRENT_DATE + INTERVAL '1 day'`;
  }

  if (period === "week") {
    return `AND ${dateColumn} >= date_trunc('week', NOW())`;
  }

  if (period === "month") {
    return `AND ${dateColumn} >= date_trunc('month', NOW())`;
  }

  return "";
}

async function buildDashboardWhereParts(params: {
  tableName: string;
  tenantIdParamIndex: number;
  dateColumn?: string;
  filters: DashboardFilters;
  values: any[];
}) {
  const { tableName, tenantIdParamIndex, dateColumn, filters, values } = params;

  const whereParts: string[] = [`tenant_id = $${tenantIdParamIndex}`];

  const hasDeletedAt = await columnExists(tableName, "deleted_at");
  if (hasDeletedAt) {
    whereParts.push(`deleted_at IS NULL`);
  }

  if (dateColumn) {
    const hasDateColumn = await columnExists(tableName, dateColumn);

    if (hasDateColumn) {
      if (filters.start_date && filters.end_date) {
        values.push(filters.start_date);
        const startIndex = values.length;

        values.push(filters.end_date);
        const endIndex = values.length;

        whereParts.push(
          `${dateColumn}::date BETWEEN $${startIndex}::date AND $${endIndex}::date`,
        );
      } else if (filters.period && filters.period !== "all") {
        const periodCondition = getPeriodDateCondition(
          dateColumn,
          filters.period,
        );
        if (periodCondition) {
          whereParts.push(periodCondition.replace(/^AND\s+/i, ""));
        }
      }
    }
  }

  if (filters.assigned_to) {
    const hasAssignedTo = await columnExists(tableName, "assigned_to");
    const hasAssignedToUserId = await columnExists(
      tableName,
      "assigned_to_user_id",
    );

    if (hasAssignedTo) {
      values.push(filters.assigned_to);
      whereParts.push(`assigned_to = $${values.length}`);
    } else if (hasAssignedToUserId) {
      values.push(filters.assigned_to);
      whereParts.push(`assigned_to_user_id = $${values.length}`);
    }
  }

  if (filters.source) {
    const hasSource = await columnExists(tableName, "source");

    if (hasSource) {
      values.push(filters.source);
      whereParts.push(`source = $${values.length}`);
    }
  }

  return whereParts;
}

async function tableExists(tableName: string): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = $1
    ) AS exists
    `,
    [tableName],
  );

  return Boolean(rows[0]?.exists);
}

async function columnExists(
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
    ) AS exists
    `,
    [tableName, columnName],
  );

  return Boolean(rows[0]?.exists);
}

async function resolveExistingTable(
  candidates: string[],
): Promise<string | null> {
  for (const tableName of candidates) {
    if (await tableExists(tableName)) {
      return tableName;
    }
  }
  return null;
}

function getDateRangeForPeriod(period: DashboardPeriod) {
  const now = new Date();

  if (period === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  if (period === "week") {
    const start = new Date(now);
    const day = start.getDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - diff);
    start.setHours(0, 0, 0, 0);

    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    start.setHours(0, 0, 0, 0);

    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  return null;
}

function getGrowthLabel(total: number): string {
  if (total >= 100) return "+12%";
  if (total >= 50) return "+8%";
  if (total >= 20) return "+5%";
  if (total >= 1) return "+2%";
  return "0%";
}

function getModuleStatus(
  total: number,
): "Active" | "Growing" | "Needs Attention" {
  if (total >= 50) return "Growing";
  if (total >= 1) return "Active";
  return "Needs Attention";
}

async function safeCountAllRecords(params: {
  tenantId: string;
  tableName: string;
  deletedAtColumn?: string;
  dateColumn?: string;
  filters?: DashboardFilters;
  columnName?: string;
}) {
  const {
    tenantId,
    tableName,
    deletedAtColumn = "deleted_at",
    dateColumn,
    filters = {},
  } = params;

  const hasTenantId = await columnExists(tableName, "tenant_id");
  if (!hasTenantId) return 0;

  const values: any[] = [tenantId];

  const whereParts = await buildDashboardWhereParts({
    tableName,
    tenantIdParamIndex: 1,
    dateColumn,
    filters,
    values,
  });

  const query = `
    SELECT COUNT(*)::int AS count
    FROM ${tableName}
    WHERE ${whereParts.join(" AND ")}
  `;

  const { rows } = await pool.query<{ count: number }>(query, values);
  return Number(rows[0]?.count || 0);
}

async function safeCountByPeriod(params: {
  tenantId: string;
  tableName: string;
  period: DashboardPeriod;
  dateColumn?: string;
  deletedAtColumn?: string;
}) {
  const {
    tenantId,
    tableName,
    period,
    dateColumn = "created_at",
    deletedAtColumn = "deleted_at",
  } = params;

  const hasTenantId = await columnExists(tableName, "tenant_id");
  if (!hasTenantId) return 0;

  const hasDateColumn = await columnExists(tableName, dateColumn);
  if (!hasDateColumn) {
    return safeCountAllRecords({ tenantId, tableName, deletedAtColumn });
  }

  const hasDeletedAt = await columnExists(tableName, deletedAtColumn);
  const range = getDateRangeForPeriod(period);

  if (!range) {
    return safeCountAllRecords({ tenantId, tableName, deletedAtColumn });
  }

  const query = `
    SELECT COUNT(*)::int AS count
    FROM ${tableName}
    WHERE tenant_id = $1
      ${hasDeletedAt ? `AND ${deletedAtColumn} IS NULL` : ""}
      AND ${dateColumn} >= $2
      AND ${dateColumn} <= $3
  `;

  const { rows } = await pool.query<{ count: number }>(query, [
    tenantId,
    range.start,
    range.end,
  ]);

  return Number(rows[0]?.count || 0);
}

async function getLeadStatusStats(
  tenantId: string,
  filters: DashboardFilters = {},
): Promise<DashboardChartRow[]> {
  const tableName = await resolveExistingTable(["leads"]);
  if (!tableName) return [];

  const hasTenantId = await columnExists(tableName, "tenant_id");
  if (!hasTenantId) return [];

  const hasStatus = await columnExists(tableName, "status");
  if (!hasStatus) return [];

  const values: any[] = [tenantId];

  const whereParts = await buildDashboardWhereParts({
    tableName,
    tenantIdParamIndex: 1,
    dateColumn: "created_at",
    filters,
    values,
  });

  const query = `
    SELECT
      COALESCE(NULLIF(TRIM(status::text), ''), 'Unknown') AS name,
      COUNT(*)::int AS value
    FROM ${tableName}
    WHERE ${whereParts.join(" AND ")}
    GROUP BY 1
    ORDER BY 2 DESC, 1 ASC
  `;

  const { rows } = await pool.query<{ name: string; value: number }>(
    query,
    values,
  );

  return rows.map((row) => ({
    name: row.name,
    value: Number(row.value || 0),
  }));
}

async function getTaskPriorityStats(
  tenantId: string,
  filters: DashboardFilters = {},
): Promise<DashboardChartRow[]> {
  const tableName = await resolveExistingTable(["tasks"]);
  if (!tableName) return [];

  const hasTenantId = await columnExists(tableName, "tenant_id");
  if (!hasTenantId) return [];

  const hasPriorityId = await columnExists(tableName, "priority_id");
  if (!hasPriorityId) return [];

  const hasMasterValuesTable = await tableExists("master_values");
  if (!hasMasterValuesTable) return [];

  const values: any[] = [tenantId];

  const whereParts = await buildDashboardWhereParts({
    tableName,
    tenantIdParamIndex: 1,
    dateColumn: "created_at",
    filters,
    values,
  });

  const query = `
    SELECT
      COALESCE(NULLIF(TRIM(mv.label::text), ''), 'Unknown') AS name,
      COUNT(*)::int AS value
    FROM ${tableName} t
    LEFT JOIN master_values mv
      ON mv.id = t.priority_id
      AND mv.tenant_id = t.tenant_id
      AND mv.deleted_at IS NULL
      AND mv.is_active = TRUE
    WHERE ${whereParts.map((part) => `t.${part}`).join(" AND ")}
    GROUP BY 1
    ORDER BY 2 DESC, 1 ASC
  `;

  const { rows } = await pool.query<{ name: string; value: number }>(
    query,
    values,
  );

  return rows.map((row) => ({
    name: row.name,
    value: Number(row.value || 0),
  }));
}

async function getOpenTasksCount(
  tenantId: string,
  filters: DashboardFilters = {},
): Promise<number> {
  const tableName = await resolveExistingTable(["tasks"]);
  if (!tableName) return 0;

  const hasTenantId = await columnExists(tableName, "tenant_id");
  if (!hasTenantId) return 0;

  const hasStatus = await columnExists(tableName, "status");

  if (!hasStatus) {
    return safeCountAllRecords({
      tenantId,
      tableName,
      dateColumn: "created_at",
      filters,
    });
  }

  const values: any[] = [tenantId];

  const whereParts = await buildDashboardWhereParts({
    tableName,
    tenantIdParamIndex: 1,
    dateColumn: "created_at",
    filters,
    values,
  });

  whereParts.push(
    `LOWER(COALESCE(status, '')) NOT IN ('completed', 'done', 'closed', 'cancelled', 'canceled')`,
  );

  const query = `
    SELECT COUNT(*)::int AS count
    FROM ${tableName}
    WHERE ${whereParts.join(" AND ")}
  `;

  const { rows } = await pool.query<{ count: number }>(query, values);
  return Number(rows[0]?.count || 0);
}

async function getOverdueTasksCount(
  tenantId: string,
  filters: DashboardFilters = {},
): Promise<number> {
  const tableName = await resolveExistingTable(["tasks"]);
  if (!tableName) return 0;

  const hasTenantId = await columnExists(tableName, "tenant_id");
  if (!hasTenantId) return 0;

  const hasEndDate = await columnExists(tableName, "end_date");
  const hasStatus = await columnExists(tableName, "status");

  if (!hasEndDate) return 0;

  const values: any[] = [tenantId];

  const whereParts = await buildDashboardWhereParts({
    tableName,
    tenantIdParamIndex: 1,
    dateColumn: "end_date",
    filters,
    values,
  });

  whereParts.push(`end_date IS NOT NULL`);
  whereParts.push(`end_date < NOW()`);

  if (hasStatus) {
    whereParts.push(
      `LOWER(COALESCE(status, '')) NOT IN ('completed', 'done', 'closed', 'cancelled', 'canceled')`,
    );
  }

  const query = `
    SELECT COUNT(*)::int AS count
    FROM ${tableName}
    WHERE ${whereParts.join(" AND ")}
  `;

  const { rows } = await pool.query<{ count: number }>(query, values);
  return Number(rows[0]?.count || 0);
}

async function getAttendanceTodayCount(
  tenantId: string,
  filters: DashboardFilters,
): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `
    SELECT COUNT(DISTINCT user_id)::int AS count
    FROM attendance_sessions
    WHERE tenant_id = $1
      AND deleted_at IS NULL
      AND attendance_date = CURRENT_DATE
      AND LOWER(COALESCE(status, 'present')) NOT IN ('absent', 'cancelled', 'canceled')
    `,
    [tenantId],
  );

  return Number(rows[0]?.count || 0);
}

async function getActiveUsersCount(tenantId: string): Promise<number> {
  const tableName = await resolveExistingTable(["users"]);
  if (!tableName) return 0;

  const hasTenantId = await columnExists(tableName, "tenant_id");
  if (!hasTenantId) return 0;

  const hasDeletedAt = await columnExists(tableName, "deleted_at");
  const hasIsActive = await columnExists(tableName, "is_active");
  const hasStatus = await columnExists(tableName, "status");

  const query = `
    SELECT COUNT(*)::int AS count
    FROM ${tableName}
    WHERE tenant_id = $1
      ${hasDeletedAt ? "AND deleted_at IS NULL" : ""}
      ${hasIsActive ? "AND is_active = TRUE" : ""}
      ${hasStatus ? "AND LOWER(COALESCE(status, 'active')) != 'inactive'" : ""}
  `;

  const { rows } = await pool.query<{ count: number }>(query, [tenantId]);
  return Number(rows[0]?.count || 0);
}

async function getRecentActivities(
  tenantId: string,
  filters: DashboardFilters = {},
): Promise<DashboardActivityRow[]> {
  const activities: DashboardActivityRow[] = [];

  const activityConfigs = [
    {
      tableCandidates: ["leads"],
      title: "Lead created",
      descriptionPrefix: "Recent lead entry created",
      dateColumn: "created_at",
    },
    {
      tableCandidates: ["contacts"],
      title: "Contact created",
      descriptionPrefix: "Recent contact entry created",
      dateColumn: "created_at",
    },
    {
      tableCandidates: ["organizations"],
      title: "Organization created",
      descriptionPrefix: "Recent organization added",
      dateColumn: "created_at",
    },
    {
      tableCandidates: ["quotes"],
      title: "Quote created",
      descriptionPrefix: "Recent quote record created",
      dateColumn: "created_at",
    },
    {
      tableCandidates: ["visits"],
      title: "Visit recorded",
      descriptionPrefix: "Recent visit captured",
      dateColumn: "created_at",
    },
    {
      tableCandidates: ["interactions"],
      title: "Interaction added",
      descriptionPrefix: "Recent call/meeting added",
      dateColumn: "created_at",
    },
    {
      tableCandidates: ["tasks"],
      title: "Task created",
      descriptionPrefix: "Recent task added",
      dateColumn: "created_at",
    },
  ];

  for (const config of activityConfigs) {
    const tableName = await resolveExistingTable(config.tableCandidates);
    if (!tableName) continue;

    const hasTenantId = await columnExists(tableName, "tenant_id");
    const hasDate = await columnExists(tableName, config.dateColumn);
    if (!hasTenantId || !hasDate) continue;

    const values: any[] = [tenantId];

    const whereParts = await buildDashboardWhereParts({
      tableName,
      tenantIdParamIndex: 1,
      dateColumn: config.dateColumn,
      filters,
      values,
    });

    const query = `
      SELECT id::text AS id, ${config.dateColumn} AS created_at
      FROM ${tableName}
      WHERE ${whereParts.join(" AND ")}
      ORDER BY ${config.dateColumn} DESC
      LIMIT 1
    `;

    const { rows } = await pool.query<{ id: string; created_at: string }>(
      query,
      values,
    );

    if (!rows.length) continue;

    activities.push({
      id: rows[0].id,
      title: config.title,
      description: config.descriptionPrefix,
      time: rows[0].created_at,
    });
  }

  return activities
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 8);
}

async function safeSumNumericColumn(params: {
  tenantId: string;
  tableName: string;
  columnName: string;
  deletedAtColumn?: string;
  dateColumn?: string;
  filters?: DashboardFilters;
}) {
  const { tenantId, tableName, columnName, dateColumn, filters = {} } = params;

  const hasTenantId = await columnExists(tableName, "tenant_id");
  const hasColumn = await columnExists(tableName, columnName);

  if (!hasTenantId || !hasColumn) return 0;

  const values: any[] = [tenantId];

  const whereParts = await buildDashboardWhereParts({
    tableName,
    tenantIdParamIndex: 1,
    dateColumn,
    filters,
    values,
  });

  const query = `
    SELECT COALESCE(SUM(${columnName}), 0)::numeric AS total
    FROM ${tableName}
    WHERE ${whereParts.join(" AND ")}
  `;

  const { rows } = await pool.query<{ total: string }>(query, values);

  return Number(rows[0]?.total || 0);
}

async function getSalesMetrics(params: {
  tenantId: string;
  totalQuotes: number;
  openTasks: number;
  totalLeads: number;
  filters?: DashboardFilters;
}) {
  const { tenantId, totalQuotes, openTasks, totalLeads, filters = {} } = params;

  const salesOrdersTable = await resolveExistingTable(["sales_orders"]);
  const purchaseOrdersTable = await resolveExistingTable(["purchase_orders"]);

  const [
    totalSalesOrders,
    totalPurchaseOrders,
    totalRevenue,
    totalPurchaseAmount,
  ] = await Promise.all([
    salesOrdersTable
      ? safeCountAllRecords({
          tenantId,
          tableName: salesOrdersTable,
          columnName: "total_amount",

          dateColumn: "created_at",
          filters,
        })
      : 0,

    purchaseOrdersTable
      ? safeCountAllRecords({
          tenantId,
          tableName: purchaseOrdersTable,
          columnName: "total_amount",

          dateColumn: "created_at",
          filters,
        })
      : 0,

    salesOrdersTable
      ? safeSumNumericColumn({
          tenantId,
          tableName: salesOrdersTable,
          columnName: "total_amount",
          dateColumn: "created_at",
          filters,
        })
      : 0,

    purchaseOrdersTable
      ? safeSumNumericColumn({
          tenantId,
          tableName: purchaseOrdersTable,
          columnName: "total_amount",
        })
      : 0,
  ]);

  const conversionRate =
    totalQuotes > 0
      ? Number(((totalSalesOrders / totalQuotes) * 100).toFixed(2))
      : 0;

  return {
    totalSalesOrders,
    totalPurchaseOrders,
    totalRevenue,
    totalPurchaseAmount,
    pendingInvoices: 0,
    conversionRate,
    monthlyTrend: [
      { name: "Leads", value: totalLeads },
      { name: "Quotes", value: totalQuotes },
      { name: "SO", value: totalSalesOrders },
      { name: "PO", value: totalPurchaseOrders },
      { name: "Tasks", value: openTasks },
    ],
  };
}

async function getLastTallySyncMinutesAgo(tenantId: string): Promise<number> {
  const queries: string[] = [];
  const values: any[] = [tenantId];

  const salesOrdersTable = await resolveExistingTable(["sales_orders"]);
  const purchaseOrdersTable = await resolveExistingTable(["purchase_orders"]);
  const tallySyncErrorsTable = await resolveExistingTable([
    "tally_sync_errors",
  ]);

  if (salesOrdersTable) {
    queries.push(`
      SELECT MAX(COALESCE(updated_at, created_at)) AS last_at
      FROM sales_orders
      WHERE tenant_id = $1
        AND deleted_at IS NULL
    `);
  }

  if (purchaseOrdersTable) {
    queries.push(`
      SELECT MAX(COALESCE(updated_at, created_at)) AS last_at
      FROM purchase_orders
      WHERE tenant_id = $1
        AND deleted_at IS NULL
    `);
  }

  if (tallySyncErrorsTable) {
    queries.push(`
      SELECT MAX(created_at) AS last_at
      FROM tally_sync_errors
      WHERE tenant_id = $1
    `);
  }

  if (!queries.length) return 0;

  const finalQuery = `
    SELECT MAX(last_at) AS last_at
    FROM (
      ${queries.join(" UNION ALL ")}
    ) x
  `;

  const { rows } = await pool.query<{ last_at: string | null }>(
    finalQuery,
    values,
  );

  const lastAt = rows[0]?.last_at;
  if (!lastAt) return 0;

  const diffMs = Date.now() - new Date(lastAt).getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return 0;

  return Math.floor(diffMs / 60000);
}

async function getTallyMetrics(tenantId: string, filters: DashboardFilters) {
  const salesOrdersTable = await resolveExistingTable(["sales_orders"]);
  const purchaseOrdersTable = await resolveExistingTable(["purchase_orders"]);
  const tallySyncErrorsTable = await resolveExistingTable([
    "tally_sync_errors",
  ]);

  const ledgersTable = await resolveExistingTable([
    "tally_ledgers",
    "ledgers",
    "organizations",
  ]);

  const stockItemsTable = await resolveExistingTable([
    "tally_stock_items",
    "stock_items",
    "products",
  ]);

  const [
    ledgersSynced,
    stockItemsSynced,
    salesVouchers,
    purchaseVouchers,
    syncErrors,
    lastSyncMinutesAgo,
  ] = await Promise.all([
    ledgersTable
      ? safeCountAllRecords({
          tenantId,
          tableName: ledgersTable,
          dateColumn: "created_at",
          filters,
        })
      : 0,

    stockItemsTable
      ? safeCountAllRecords({
          tenantId,
          tableName: stockItemsTable,
          dateColumn: "created_at",
          filters,
        })
      : 0,

    salesOrdersTable
      ? safeCountAllRecords({
          tenantId,
          tableName: salesOrdersTable,
          dateColumn: "created_at",
          filters,
        })
      : 0,

    purchaseOrdersTable
      ? safeCountAllRecords({
          tenantId,
          tableName: purchaseOrdersTable,
          dateColumn: "created_at",
          filters,
        })
      : 0,

    tallySyncErrorsTable
      ? safeCountAllRecords({
          tenantId,
          tableName: tallySyncErrorsTable,
          dateColumn: "created_at",
          filters,
        })
      : 0,

    getLastTallySyncMinutesAgo(tenantId),
  ]);

  return {
    ledgersSynced,
    stockItemsSynced,
    salesVouchers,
    purchaseVouchers,
    syncErrors,
    lastSyncMinutesAgo,
    syncChart: [
      { name: "Ledgers", value: ledgersSynced },
      { name: "Stock", value: stockItemsSynced },
      { name: "Sales", value: salesVouchers },
      { name: "Purchase", value: purchaseVouchers },
      { name: "Errors", value: syncErrors },
    ],
  };
}

async function getDashboardUsers(tenantId: string) {
  const usersTable = await resolveExistingTable(["users"]);
  if (!usersTable) return [];

  const hasTenantId = await columnExists(usersTable, "tenant_id");
  if (!hasTenantId) return [];

  const hasDeletedAt = await columnExists(usersTable, "deleted_at");
  const hasName = await columnExists(usersTable, "name");
  const hasEmail = await columnExists(usersTable, "email");

  const query = `
    SELECT
      id::text AS id,
      ${hasName ? "name" : "NULL"} AS name,
      ${hasEmail ? "email" : "NULL"} AS email
    FROM users
    WHERE tenant_id = $1
      ${hasDeletedAt ? "AND deleted_at IS NULL" : ""}
    ORDER BY ${hasName ? "name" : "created_at"} ASC
    LIMIT 200
  `;

  const { rows } = await pool.query<{
    id: string;
    name: string | null;
    email: string | null;
  }>(query, [tenantId]);

  return rows.map((row) => ({
    id: row.id,
    name: row.name || row.email || "User",
    email: row.email,
  }));
}

async function getTeamMetrics(params: {
  tenantId: string;
  activeUsers: number;
  attendanceToday: number;
  visitsThisWeek: number;
  interactionsThisWeek: number;
  openTasks: number;
  overdueTasks: number;
}) {
  const {
    tenantId,
    activeUsers,
    attendanceToday,
    visitsThisWeek,
    interactionsThisWeek,
    openTasks,
    overdueTasks,
  } = params;

  const users = await getDashboardUsers(tenantId);

  return {
    productivityChart: [
      { name: "Users", value: activeUsers },
      { name: "Present", value: attendanceToday },
      { name: "Visits", value: visitsThisWeek },
      { name: "Events", value: interactionsThisWeek },
      { name: "Open Tasks", value: openTasks },
      { name: "Overdue", value: overdueTasks },
    ],
    users: users.map((user) => ({
      ...user,
      leads: 0,
      tasks: 0,
      visits: 0,
      status: "Active",
    })),
  };
}

async function getModuleUsage(
  tenantId: string,
  filters: DashboardFilters = {},
): Promise<DashboardModuleUsageRow[]> {
  const rows: DashboardModuleUsageRow[] = [];

  for (let i = 0; i < MODULES.length; i += 1) {
    const moduleConfig = MODULES[i];
    const tableName = await resolveExistingTable(
      moduleConfig.tableNameCandidates,
    );

    if (!tableName) {
      rows.push({
        key: String(i + 1),
        module: moduleConfig.label,
        total: 0,
        trend: "0%",
        status: "Needs Attention",
      });
      continue;
    }

    const total = await safeCountAllRecords({
      tenantId,
      tableName,
      deletedAtColumn: moduleConfig.defaultDeletedAtColumn,
      dateColumn: moduleConfig.defaultDateColumn || "created_at",
      filters,
    });

    rows.push({
      key: String(i + 1),
      module: moduleConfig.label,
      total,
      trend: getGrowthLabel(total),
      status: getModuleStatus(total),
    });
  }

  return rows;
}

export async function getDashboardSummaryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId =
      (req as any).tenantId ||
      (req.user as any)?.tenantId ||
      (req as any)?.auth?.tenantId;

    if (!tenantId) {
      return res.status(401).json({
        statusCode: 401,
        message: "Unauthorized",
      });
    }

    const query = GetDashboardSummarySchema.parse(req.query);

    const filters: DashboardFilters = {
      period: query.start_date && query.end_date ? undefined : query.period,
      start_date: query.start_date,
      end_date: query.end_date,
      assigned_to: query.assigned_to,
      source: query.source,
    };

    const leadsTable = await resolveExistingTable(["leads"]);
    const contactsTable = await resolveExistingTable(["contacts"]);
    const organizationsTable = await resolveExistingTable(["organizations"]);
    const quotesTable = await resolveExistingTable(["quotes"]);
    const visitsTable = await resolveExistingTable(["visits"]);
    const interactionsTable = await resolveExistingTable(["interactions"]);

    const [
      totalLeads,
      totalContacts,
      totalOrganizations,
      openTasks,
      overdueTasks,
      totalQuotes,
      visitsThisWeek,
      interactionsThisWeek,
      attendanceToday,
      activeUsers,
      leadStatusStats,
      taskPriorityStats,
      moduleUsage,
      recentActivities,
    ] = await Promise.all([
      leadsTable
        ? safeCountAllRecords({
            tenantId,
            tableName: leadsTable,
            dateColumn: "created_at",
            filters,
          })
        : 0,

      contactsTable
        ? safeCountAllRecords({
            tenantId,
            tableName: contactsTable,
            dateColumn: "created_at",
            filters,
          })
        : 0,

      organizationsTable
        ? safeCountAllRecords({
            tenantId,
            tableName: organizationsTable,
            dateColumn: "created_at",
            filters,
          })
        : 0,

      getOpenTasksCount(tenantId, filters),

      getOverdueTasksCount(tenantId, filters),

      quotesTable
        ? safeCountAllRecords({
            tenantId,
            tableName: quotesTable,
            dateColumn: "created_at",
            filters,
          })
        : 0,

      visitsTable
        ? safeCountAllRecords({
            tenantId,
            tableName: visitsTable,
            dateColumn: "created_at",
            filters,
          })
        : 0,

      interactionsTable
        ? safeCountAllRecords({
            tenantId,
            tableName: interactionsTable,
            dateColumn: "created_at",
            filters,
          })
        : 0,

      getAttendanceTodayCount(tenantId, filters),
      getActiveUsersCount(tenantId),

      getLeadStatusStats(tenantId, filters),
      getTaskPriorityStats(tenantId, filters),
      getModuleUsage(tenantId, filters),
      getRecentActivities(tenantId, filters),
    ]);

    const [salesMetrics, tallyMetrics, teamMetrics, users] = await Promise.all([
      getSalesMetrics({
        tenantId,
        totalQuotes,
        openTasks,
        totalLeads,
        filters,
      }),

      getTallyMetrics(tenantId, filters),

      getTeamMetrics({
        tenantId,
        activeUsers,
        attendanceToday,
        visitsThisWeek,
        interactionsThisWeek,
        openTasks,
        overdueTasks,
      }),

      getDashboardUsers(tenantId),
    ]);

    return res.status(200).json({
      statusCode: 200,
      message: "Dashboard summary fetched successfully",
      data: {
        metrics: {
          totalLeads,
          totalContacts,
          totalOrganizations,
          openTasks,
          overdueTasks,
          totalQuotes,
          visitsThisWeek,
          interactionsThisWeek,
          attendanceToday,
          activeUsers,
        },
        leadStatusStats,
        taskPriorityStats,
        moduleUsage,
        recentActivities,
        salesMetrics,
        tallyMetrics,
        teamMetrics,
        users,
        filters: {
          period: filters.period,
          start_date: filters.start_date,
          end_date: filters.end_date,
          assigned_to: filters.assigned_to,
          source: filters.source,
        },
      },
    });
  } catch (error) {
    return next(error);
  }
}
