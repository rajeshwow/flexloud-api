import { NextFunction, Request, Response } from "express";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";
import {
  ClockInSchema,
  ClockOutSchema,
  GetAttendanceHistorySchema,
} from "./attendance.schema";

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

export async function getMyTodayAttendanceHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.sub;
    console.log("my today attendance", userId);

    const today = getTodayDateString();

    const sessionsQuery = `
      SELECT *
      FROM attendance_sessions
      WHERE tenant_id = $1
        AND user_id = $2
        AND attendance_date = $3
        AND deleted_at IS NULL
      ORDER BY session_no DESC, created_at DESC
    `;

    const sessionsResult = await pool.query(sessionsQuery, [
      tenantId,
      userId,
      today,
    ]);
    const sessions = sessionsResult.rows;

    const activeSession = sessions.find((s) => !s.clock_out_at) || null;
    const totalWorkedMinutes = sessions.reduce(
      (sum, s) => sum + Number(s.worked_minutes || 0),
      0,
    );

    return res.json({
      success: true,
      data: {
        is_clocked_in: !!activeSession,
        active_session: activeSession,
        today_sessions: sessions,
        total_worked_minutes_today: totalWorkedMinutes,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function clockInHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const tenantId = getTenantId(req);
    const userId = req.user?.sub;
    const parsed = ClockInSchema.parse(req.body);

    const today = getTodayDateString();

    const existingOpen = await client.query(
      `
      SELECT id
      FROM attendance_sessions
      WHERE tenant_id = $1
        AND user_id = $2
        AND clock_out_at IS NULL
        AND deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, userId],
    );

    if (existingOpen.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "You are already clocked in.",
      });
    }

    const sessionNoResult = await client.query(
      `
      SELECT COALESCE(MAX(session_no), 0) + 1 AS next_session_no
      FROM attendance_sessions
      WHERE tenant_id = $1
        AND user_id = $2
        AND attendance_date = $3
        AND deleted_at IS NULL
      `,
      [tenantId, userId, today],
    );

    const nextSessionNo = Number(sessionNoResult.rows[0]?.next_session_no || 1);

    const insertResult = await client.query(
      `
      INSERT INTO attendance_sessions (
        tenant_id,
        user_id,
        attendance_date,
        session_no,
        clock_in_at,
        status,
        source,
        remarks,
        created_by,
        updated_by
      )
      VALUES ($1, $2, $3, $4, NOW(), 'clocked_in', $5, $6, $7, $7)
      RETURNING *
      `,
      [
        tenantId,
        userId,
        today,
        nextSessionNo,
        parsed.source,
        parsed.remarks ?? null,
        userId,
      ],
    );

    const session = insertResult.rows[0];

    await client.query(
      `
      INSERT INTO attendance_activity_logs (
        tenant_id,
        attendance_session_id,
        user_id,
        action,
        meta,
        created_by
      )
      VALUES ($1, $2, $3, 'clock_in', $4, $3)
      `,
      [tenantId, session.id, userId, JSON.stringify({ source: parsed.source })],
    );

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: "Clock-in successful.",
      data: session,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
}

export async function clockOutHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const tenantId = getTenantId(req);
    const userId = req.user?.sub;
    const parsed = ClockOutSchema.parse(req.body);

    const activeResult = await client.query(
      `
      SELECT *
      FROM attendance_sessions
      WHERE tenant_id = $1
        AND user_id = $2
        AND clock_out_at IS NULL
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [tenantId, userId],
    );

    if (!activeResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "No active clock-in session found.",
      });
    }

    const activeSession = activeResult.rows[0];

    const updateResult = await client.query(
      `
      UPDATE attendance_sessions
      SET
        clock_out_at = NOW(),
        worked_minutes = GREATEST(FLOOR(EXTRACT(EPOCH FROM (NOW() - clock_in_at)) / 60), 0),
        status = 'clocked_out',
        remarks = COALESCE($1, remarks),
        updated_at = NOW(),
        updated_by = $2
      WHERE id = $3
      RETURNING *
      `,
      [parsed.remarks ?? null, userId, activeSession.id],
    );

    const session = updateResult.rows[0];

    await client.query(
      `
      INSERT INTO attendance_activity_logs (
        tenant_id,
        attendance_session_id,
        user_id,
        action,
        meta,
        created_by
      )
      VALUES ($1, $2, $3, 'clock_out', $4, $3)
      `,
      [
        tenantId,
        session.id,
        userId,
        JSON.stringify({ worked_minutes: session.worked_minutes }),
      ],
    );

    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "Clock-out successful.",
      data: session,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
}

export async function getMyAttendanceHistoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.sub as string;
    const parsed = GetAttendanceHistorySchema.parse(req.query);

    const page = parsed.page;
    const limit = parsed.limit;
    const offset = (page - 1) * limit;

    let whereClause = `
      WHERE tenant_id = $1
        AND user_id = $2
        AND deleted_at IS NULL
    `;
    const values: Array<string | number> = [tenantId, userId];
    let idx = values.length + 1;

    if (parsed.from) {
      whereClause += ` AND attendance_date >= $${idx}`;
      values.push(parsed.from);
      idx++;
    }

    if (parsed.to) {
      whereClause += ` AND attendance_date <= $${idx}`;
      values.push(parsed.to);
      idx++;
    }

    const listQuery = `
      SELECT *
      FROM attendance_sessions
      ${whereClause}
      ORDER BY attendance_date DESC, session_no DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    values.push(limit, offset);

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM attendance_sessions
      ${whereClause}
    `;

    const [listResult, countResult] = await Promise.all([
      pool.query(listQuery, values),
      pool.query(countQuery, values.slice(0, idx - 1)),
    ]);

    return res.json({
      success: true,
      data: listResult.rows,
      pagination: {
        page,
        limit,
        total: countResult.rows[0]?.total || 0,
      },
    });
  } catch (error) {
    next(error);
  }
}
