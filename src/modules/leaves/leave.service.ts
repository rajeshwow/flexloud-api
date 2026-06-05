import { NextFunction, Request, Response } from "express";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";
import {
  ApplyLeaveSchema,
  CancelLeaveSchema,
  GetMyLeavesSchema,
} from "./leave.schema";

function calculateLeaveDays(startDate: string, endDate: string) {
  const start = new Date(startDate);
  const end = new Date(endDate);

  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  const diffMs = end.getTime() - start.getTime();
  return diffMs / (1000 * 60 * 60 * 24) + 1;
}

export async function applyLeaveHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.sub;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const parsed = ApplyLeaveSchema.parse(req.body);
    const totalDays = calculateLeaveDays(parsed.start_date, parsed.end_date);

    const overlappingResult = await pool.query(
      `
      SELECT id
      FROM leave_requests
      WHERE tenant_id = $1
        AND user_id = $2
        AND deleted_at IS NULL
        AND status IN ('pending', 'approved')
        AND daterange(start_date, end_date, '[]') && daterange($3::date, $4::date, '[]')
      LIMIT 1
      `,
      [tenantId, userId, parsed.start_date, parsed.end_date],
    );

    if (overlappingResult.rowCount) {
      return res.status(400).json({
        success: false,
        message: "You already have a leave request for overlapping dates.",
      });
    }

    const assignedTasksResult = await pool.query(
      `
      SELECT
        id,
        task_number,
        subject,
        status,
        start_date,
        end_date
      FROM tasks
      WHERE tenant_id = $1
        AND assigned_to = $2
        AND deleted_at IS NULL
        AND status <> 'completed'
        AND start_date::date <= $4::date
        AND end_date::date >= $3::date
      ORDER BY start_date ASC
      `,
      [tenantId, userId, parsed.start_date, parsed.end_date],
    );

    if (assignedTasksResult.rowCount) {
      return res.status(209).json({
        success: false,
        statusCode: 209,
        code: "LEAVE_TASK_CONFLICT",
        message:
          "You cannot apply leave because task(s) are assigned to you for selected leave date(s).",
        data: {
          task_id: assignedTasksResult.rows[0].id,
          task_ids: assignedTasksResult.rows.map((task) => task.id),
          tasks: assignedTasksResult.rows,
        },
      });
    }

    const result = await pool.query(
      `
      INSERT INTO leave_requests (
        tenant_id,
        user_id,
        leave_type,
        start_date,
        end_date,
        total_days,
        reason,
        applied_to_user_id,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
      RETURNING *
      `,
      [
        tenantId,
        userId,
        parsed.leave_type,
        parsed.start_date,
        parsed.end_date,
        totalDays,
        parsed.reason ?? null,
        parsed.applied_to_user_id ?? null,
      ],
    );

    return res.status(201).json({
      success: true,
      message: "Leave applied successfully.",
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
}

export async function getMyLeavesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.sub as string;

    const parsed = GetMyLeavesSchema.parse(req.query);

    const offset = (parsed.page - 1) * parsed.limit;

    let whereClause = `
      WHERE lr.tenant_id = $1
        AND lr.user_id = $2
        AND lr.deleted_at IS NULL
    `;
    const values: Array<string | number> = [tenantId, userId];
    let idx = values.length + 1;

    if (parsed.status) {
      whereClause += ` AND lr.status = $${idx}`;
      values.push(parsed.status);
      idx++;
    }

    if (parsed.leave_type) {
      whereClause += ` AND lr.leave_type = $${idx}`;
      values.push(parsed.leave_type);
      idx++;
    }

    if (parsed.search?.trim()) {
      whereClause += ` AND COALESCE(lr.reason, '') ILIKE $${idx}`;
      values.push(`%${parsed.search.trim()}%`);
      idx++;
    }

    const listQuery = `
      SELECT
        lr.id,
        lr.leave_type,
        lr.start_date,
        lr.end_date,
        lr.total_days,
        lr.reason,
        lr.status,
        lr.rejection_reason,
        lr.created_at,
        lr.updated_at,
        approver.first_name || ' ' || approver.last_name AS approved_by_name,
        applied_to.first_name || ' ' || applied_to.last_name AS applied_to_name
      FROM leave_requests lr
      LEFT JOIN users approver ON approver.id = lr.approved_by
      LEFT JOIN users applied_to ON applied_to.id = lr.applied_to_user_id
      ${whereClause}
      ORDER BY lr.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM leave_requests lr
      ${whereClause}
    `;

    const [listResult, countResult] = await Promise.all([
      pool.query(listQuery, [...values, parsed.limit, offset]),
      pool.query(countQuery, values),
    ]);

    return res.json({
      success: true,
      data: listResult.rows,
      pagination: {
        page: parsed.page,
        limit: parsed.limit,
        total: countResult.rows[0]?.total || 0,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function cancelLeaveHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.sub;

    const parsed = CancelLeaveSchema.parse({ id: req.params.id });

    const existingResult = await pool.query(
      `
      SELECT id, status
      FROM leave_requests
      WHERE id = $1
        AND tenant_id = $2
        AND user_id = $3
        AND deleted_at IS NULL
      LIMIT 1
      `,
      [parsed.id, tenantId, userId],
    );

    if (!existingResult.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Leave request not found.",
      });
    }

    if (existingResult.rows[0].status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Only pending leave requests can be cancelled.",
      });
    }

    const result = await pool.query(
      `
      UPDATE leave_requests
      SET
        status = 'cancelled',
        cancelled_at = NOW(),
        cancelled_by = $2,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [parsed.id, userId],
    );

    return res.json({
      success: true,
      message: "Leave request cancelled successfully.",
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
}
