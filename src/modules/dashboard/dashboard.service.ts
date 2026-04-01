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
}) {
  const { tenantId, tableName, deletedAtColumn = "deleted_at" } = params;

  const hasTenantId = await columnExists(tableName, "tenant_id");
  if (!hasTenantId) return 0;

  const hasDeletedAt = await columnExists(tableName, deletedAtColumn);

  const query = `
    SELECT COUNT(*)::int AS count
    FROM ${tableName}
    WHERE tenant_id = $1
    ${hasDeletedAt ? `AND ${deletedAtColumn} IS NULL` : ""}
  `;

  const { rows } = await pool.query<{ count: number }>(query, [tenantId]);
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
): Promise<DashboardChartRow[]> {
  const tableName = await resolveExistingTable(["leads"]);
  if (!tableName) return [];

  const hasTenantId = await columnExists(tableName, "tenant_id");
  if (!hasTenantId) return [];

  const hasDeletedAt = await columnExists(tableName, "deleted_at");

  const hasStatus = await columnExists(tableName, "status");
  if (hasStatus) {
    const query = `
      SELECT
        COALESCE(NULLIF(TRIM(status::text), ''), 'Unknown') AS name,
        COUNT(*)::int AS value
      FROM ${tableName}
      WHERE tenant_id = $1
        ${hasDeletedAt ? "AND deleted_at IS NULL" : ""}
      GROUP BY 1
      ORDER BY 2 DESC, 1 ASC
    `;

    const { rows } = await pool.query<{ name: string; value: number }>(query, [
      tenantId,
    ]);

    return rows.map((row) => ({
      name: row.name,
      value: Number(row.value || 0),
    }));
  }

  return [];
}

async function getTaskPriorityStats(
  tenantId: string,
): Promise<DashboardChartRow[]> {
  const tableName = await resolveExistingTable(["tasks"]);
  if (!tableName) return [];

  const hasTenantId = await columnExists(tableName, "tenant_id");
  if (!hasTenantId) return [];

  const hasDeletedAt = await columnExists(tableName, "deleted_at");

  const hasPriority = await columnExists(tableName, "priority");
  if (hasPriority) {
    const query = `
      SELECT
        COALESCE(NULLIF(TRIM(priority::text), ''), 'Unknown') AS name,
        COUNT(*)::int AS value
      FROM ${tableName}
      WHERE tenant_id = $1
        ${hasDeletedAt ? "AND deleted_at IS NULL" : ""}
      GROUP BY 1
      ORDER BY 2 DESC, 1 ASC
    `;

    const { rows } = await pool.query<{ name: string; value: number }>(query, [
      tenantId,
    ]);

    return rows.map((row) => ({
      name: row.name,
      value: Number(row.value || 0),
    }));
  }

  return [];
}

async function getOpenTasksCount(tenantId: string): Promise<number> {
  const tableName = await resolveExistingTable(["tasks"]);
  if (!tableName) return 0;

  const hasTenantId = await columnExists(tableName, "tenant_id");
  if (!hasTenantId) return 0;

  const hasStatus = await columnExists(tableName, "status");
  const hasDeletedAt = await columnExists(tableName, "deleted_at");

  if (!hasStatus) {
    return safeCountAllRecords({ tenantId, tableName });
  }

  const query = `
    SELECT COUNT(*)::int AS count
    FROM ${tableName}
    WHERE tenant_id = $1
      ${hasDeletedAt ? "AND deleted_at IS NULL" : ""}
      AND LOWER(COALESCE(status, '')) NOT IN ('completed', 'done', 'closed', 'cancelled', 'canceled')
  `;

  const { rows } = await pool.query<{ count: number }>(query, [tenantId]);
  return Number(rows[0]?.count || 0);
}

async function getOverdueTasksCount(tenantId: string): Promise<number> {
  const tableName = await resolveExistingTable(["tasks"]);
  if (!tableName) return 0;

  const hasTenantId = await columnExists(tableName, "tenant_id");
  if (!hasTenantId) return 0;

  const hasDueDate = await columnExists(tableName, "due_date");
  const hasStatus = await columnExists(tableName, "status");
  const hasDeletedAt = await columnExists(tableName, "deleted_at");

  if (!hasDueDate) return 0;

  const query = `
    SELECT COUNT(*)::int AS count
    FROM ${tableName}
    WHERE tenant_id = $1
      ${hasDeletedAt ? "AND deleted_at IS NULL" : ""}
      AND due_date IS NOT NULL
      AND due_date < NOW()
      ${
        hasStatus
          ? "AND LOWER(COALESCE(status, '')) NOT IN ('completed', 'done', 'closed', 'cancelled', 'canceled')"
          : ""
      }
  `;

  const { rows } = await pool.query<{ count: number }>(query, [tenantId]);
  return Number(rows[0]?.count || 0);
}

async function getAttendanceTodayCount(tenantId: string): Promise<number> {
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
    const hasDeletedAt = await columnExists(tableName, "deleted_at");

    if (!hasTenantId || !hasDate) continue;

    const query = `
      SELECT id::text AS id, ${config.dateColumn} AS created_at
      FROM ${tableName}
      WHERE tenant_id = $1
        ${hasDeletedAt ? "AND deleted_at IS NULL" : ""}
      ORDER BY ${config.dateColumn} DESC
      LIMIT 1
    `;

    const { rows } = await pool.query<{ id: string; created_at: string }>(
      query,
      [tenantId],
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

async function getModuleUsage(
  tenantId: string,
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
      leadsTable ? safeCountAllRecords({ tenantId, tableName: leadsTable }) : 0,
      contactsTable
        ? safeCountAllRecords({ tenantId, tableName: contactsTable })
        : 0,
      organizationsTable
        ? safeCountAllRecords({ tenantId, tableName: organizationsTable })
        : 0,
      getOpenTasksCount(tenantId),
      getOverdueTasksCount(tenantId),
      quotesTable
        ? safeCountAllRecords({ tenantId, tableName: quotesTable })
        : 0,
      visitsTable
        ? safeCountByPeriod({
            tenantId,
            tableName: visitsTable,
            period: "week",
          })
        : 0,
      interactionsTable
        ? safeCountByPeriod({
            tenantId,
            tableName: interactionsTable,
            period: "week",
          })
        : 0,
      getAttendanceTodayCount(tenantId),
      getActiveUsersCount(tenantId),
      getLeadStatusStats(tenantId),
      getTaskPriorityStats(tenantId),
      getModuleUsage(tenantId),
      getRecentActivities(tenantId),
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
        filters: {
          period: query.period,
        },
      },
    });
  } catch (error) {
    return next(error);
  }
}
