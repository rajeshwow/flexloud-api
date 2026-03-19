import { NextFunction, Request, Response } from "express";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";
import {
  ClockInSchema,
  ClockOutSchema,
  CreateAttendanceRequestSchema,
  GetAttendanceCalendarSchema,
  GetAttendanceHistorySchema,
  GetAttendanceMetricsSchema,
} from "./attendance.schema";

function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLocal(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getMonthRange(year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);

  return {
    startDate: formatDateLocal(start),
    endDate: formatDateLocal(end),
  };
}

function getAllDatesInMonth(year: number, month: number): string[] {
  const totalDays = new Date(year, month, 0).getDate();
  return Array.from({ length: totalDays }, (_, i) =>
    formatDateLocal(new Date(year, month - 1, i + 1)),
  );
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

    const now = new Date();
    const shiftStart = new Date();
    shiftStart.setHours(9, 30, 0, 0);

    const lateByMinutes =
      nextSessionNo === 1
        ? Math.max(
            Math.floor((now.getTime() - shiftStart.getTime()) / 60000),
            0,
          )
        : 0;

    const insertResult = await client.query(
      `
  INSERT INTO attendance_sessions (
    tenant_id,
    user_id,
    attendance_date,
    session_no,
    clock_in_at,
    late_by_minutes,
    status,
    source,
    remarks,
    created_by,
    updated_by
  )
  VALUES ($1, $2, $3, $4, NOW(), $5, 'clocked_in', $6, $7, $8, $8)
  RETURNING *
  `,
      [
        tenantId,
        userId,
        today,
        nextSessionNo,
        lateByMinutes,
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
export async function getAttendanceCalendarHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.sub as string;

    const parsed = GetAttendanceCalendarSchema.parse(req.query);
    const { month, year } = parsed;

    const { startDate, endDate } = getMonthRange(year, month);

    const [sessionsResult, requestsResult] = await Promise.all([
      pool.query(
        `
        SELECT
          attendance_date,
          clock_in_at,
          clock_out_at,
          worked_minutes,
          late_by_minutes,
          status,
          session_no
        FROM attendance_sessions
        WHERE tenant_id = $1
          AND user_id = $2
          AND attendance_date BETWEEN $3 AND $4
          AND deleted_at IS NULL
        ORDER BY attendance_date ASC, session_no DESC
        `,
        [tenantId, userId, startDate, endDate],
      ),
      pool.query(
        `
        SELECT
          id,
          request_type,
          leave_type,
          from_date,
          to_date,
          status
        FROM attendance_requests
        WHERE tenant_id = $1
          AND user_id = $2
          AND deleted_at IS NULL
          AND from_date <= $4
          AND to_date >= $3
        ORDER BY created_at DESC
        `,
        [tenantId, userId, startDate, endDate],
      ),
    ]);

    const allDates = getAllDatesInMonth(year, month);

    const sessionMap = new Map<string, any[]>();
    for (const row of sessionsResult.rows) {
      const key = formatDateLocal(new Date(row.attendance_date));
      const arr = sessionMap.get(key) || [];
      arr.push(row);
      sessionMap.set(key, arr);
    }

    const requestMap = new Map<string, any>();
    for (const request of requestsResult.rows) {
      let cursor = new Date(request.from_date);
      const end = new Date(request.to_date);

      while (cursor <= end) {
        const key = formatDateLocal(cursor);
        if (!requestMap.has(key)) {
          requestMap.set(key, request);
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    const days = allDates.map((dateStr) => {
      const sessions = sessionMap.get(dateStr) || [];
      const request = requestMap.get(dateStr) || null;

      const totalWorkedMinutes = sessions.reduce(
        (sum, row) => sum + Number(row.worked_minutes || 0),
        0,
      );

      const firstClockIn = sessions.length
        ? sessions
            .map((s) => s.clock_in_at)
            .filter(Boolean)
            .sort()[0]
        : null;

      const lastClockOut = sessions.length
        ? sessions
            .map((s) => s.clock_out_at)
            .filter(Boolean)
            .sort()
            .slice(-1)[0] || null
        : null;

      let status = "absent";
      let request_label: string | null = null;

      const dayOfWeek = new Date(dateStr).getDay();
      const isWeeklyOff = dayOfWeek === 0; // Sunday

      if (request?.request_type === "leave" && request?.status === "approved") {
        status = "leave";
      } else if (sessions.length > 0) {
        status = "present";
      } else if (request?.status === "pending") {
        status = "pending";
        request_label =
          request.request_type === "leave"
            ? "Leave Request"
            : "Attendance Adjustment";
      } else if (isWeeklyOff) {
        status = "weekly_off";
      }

      return {
        date: dateStr,
        status,
        shift_label: "09:30 AM - 06:30 PM",
        clock_in_at: firstClockIn,
        clock_out_at: lastClockOut,
        worked_minutes: totalWorkedMinutes,
        late_by_minutes: 0,
        request_label,
        request_status: request?.status || null,
      };
    });

    return res.json({
      success: true,
      data: {
        month,
        year,
        days,
      },
    });
  } catch (error) {
    next(error);
  }
}
export async function getAttendanceMetricsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.sub as string;

    const parsed = GetAttendanceMetricsSchema.parse(req.query);
    const { month, year } = parsed;

    const { startDate, endDate } = getMonthRange(year, month);

    const result = await pool.query(
      `
      WITH day_wise AS (
        SELECT
          attendance_date,
          SUM(COALESCE(worked_minutes, 0))::int AS total_worked_minutes,
          MAX(COALESCE(late_by_minutes, 0))::int AS late_by_minutes,
          COUNT(*)::int AS total_sessions
        FROM attendance_sessions
        WHERE tenant_id = $1
          AND user_id = $2
          AND attendance_date BETWEEN $3 AND $4
          AND deleted_at IS NULL
        GROUP BY attendance_date
      )
      SELECT
        COALESCE(AVG(total_worked_minutes), 0)::int AS avg_work_duration_minutes,
        COALESCE(AVG(late_by_minutes), 0)::int AS avg_late_by_minutes,
        COUNT(*) FILTER (WHERE total_sessions > 0)::int AS present_days
      FROM day_wise
      `,
      [tenantId, userId, startDate, endDate],
    );

    return res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
}

export async function createAttendanceRequestHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.sub as string;
    const parsed = CreateAttendanceRequestSchema.parse(req.body);

    const today = getTodayDateString();

    if (parsed.from_date < today) {
      return res.status(400).json({
        success: false,
        message: "Past dates are not allowed for requests.",
      });
    }

    const duplicateCheck = await pool.query(
      `
      SELECT id
      FROM attendance_requests
      WHERE tenant_id = $1
        AND user_id = $2
        AND deleted_at IS NULL
        AND status = 'pending'
        AND from_date <= $4
        AND to_date >= $3
      LIMIT 1
      `,
      [tenantId, userId, parsed.from_date, parsed.to_date],
    );

    if (duplicateCheck.rowCount) {
      return res.status(400).json({
        success: false,
        message: "A pending request already exists for selected dates.",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO attendance_requests (
        tenant_id,
        user_id,
        request_type,
        leave_type,
        from_date,
        to_date,
        reason,
        status,
        created_by,
        updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $2, $2)
      RETURNING *
      `,
      [
        tenantId,
        userId,
        parsed.request_type,
        parsed.leave_type ?? null,
        parsed.from_date,
        parsed.to_date,
        parsed.reason,
      ],
    );

    return res.status(201).json({
      success: true,
      message: "Attendance request created successfully.",
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
}
