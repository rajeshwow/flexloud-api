import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";
import {
  CreateTaskSchema,
  GetTasksSchema,
  UpdateTaskSchema,
} from "./tasks.schema";

function buildTaskNumber() {
  const short = randomUUID().split("-")[0].toUpperCase();
  return `TASK-${short}`;
}

export async function createTaskHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const parsed = CreateTaskSchema.parse(req.body);
    const userId = req.user?.id ?? null;

    const taskNumber = buildTaskNumber();

    const query = `
      INSERT INTO tasks (
        id,
        tenant_id,
        task_number,
        subject,
        description,
        status,
        priority,
        start_date,
        end_date,
        assigned_to,
        related_to_type,
        related_to_id,
        repeat_task,
        repeat_task_end,
        task_duration_minutes,
        created_by,
        updated_by
      )
      VALUES (
        gen_random_uuid(),
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16
      )
      RETURNING *;
    `;

    const values = [
      tenantId,
      taskNumber,
      parsed.subject,
      parsed.description ?? null,
      parsed.status,
      parsed.priority,
      parsed.start_date,
      parsed.end_date,
      parsed.assigned_to ?? null,
      parsed.related_to_type,
      parsed.related_to_id ?? null,
      parsed.repeat_task,
      parsed.repeat_task_end ?? null,
      parsed.task_duration_minutes ?? null,
      userId,
      userId,
    ];

    const result = await pool.query(query, values);

    return res.status(201).json({
      message: "Task created successfully",
      data: result.rows[0],
      statusCode: 201,
    });
  } catch (error) {
    next(error);
  }
}

export async function getTasksHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const parsed = GetTasksSchema.parse(req.query);

    const page = parsed.page;
    const limit = parsed.limit;
    const offset = (page - 1) * limit;

    let whereClause = `WHERE t.tenant_id = $1 AND t.deleted_at IS NULL`;
    const values: Array<string | number> = [tenantId];
    let idx = values.length + 1;

    if (parsed.search?.trim()) {
      whereClause += `
        AND (
          t.subject ILIKE $${idx}
          OR t.task_number ILIKE $${idx}
          OR COALESCE(t.description, '') ILIKE $${idx}
        )
      `;
      values.push(`%${parsed.search.trim()}%`);
      idx++;
    }

    if (parsed.status) {
      whereClause += ` AND t.status = $${idx}`;
      values.push(parsed.status);
      idx++;
    }

    if (parsed.priority) {
      whereClause += ` AND t.priority = $${idx}`;
      values.push(parsed.priority);
      idx++;
    }

    if (parsed.assigned_to) {
      whereClause += ` AND t.assigned_to = $${idx}`;
      values.push(parsed.assigned_to);
      idx++;
    }

    if (parsed.related_to_type) {
      whereClause += ` AND t.related_to_type = $${idx}`;
      values.push(parsed.related_to_type);
      idx++;
    }

    const listQuery = `
      SELECT
        t.*,
        CASE
          WHEN u.id IS NOT NULL
          THEN CONCAT(COALESCE(u.name))
          ELSE NULL
        END AS assigned_to_name
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assigned_to
      ${whereClause}
      ORDER BY t.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1};
    `;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM tasks t
      ${whereClause};
    `;

    const listValues = [...values, limit, offset];

    const [listResult, countResult] = await Promise.all([
      pool.query(listQuery, listValues),
      pool.query(countQuery, values),
    ]);

    return res.status(200).json({
      message: "Tasks fetched successfully",
      data: listResult.rows,
      pagination: {
        page,
        limit,
        total: countResult.rows[0]?.total ?? 0,
      },
      statusCode: 200,
    });
  } catch (error) {
    next(error);
  }
}

export async function getTaskByIdHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;

    const query = `
      SELECT
        t.*,
        CASE
          WHEN u.id IS NOT NULL
          THEN CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))
          ELSE NULL
        END AS assigned_to_name
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assigned_to
      WHERE t.id = $1
        AND t.tenant_id = $2
        AND t.deleted_at IS NULL
      LIMIT 1;
    `;

    const result = await pool.query(query, [id, tenantId]);

    if (!result.rows.length) {
      return res.status(404).json({ message: "Task not found" });
    }

    return res.status(200).json({
      message: "Task fetched successfully",
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
}

export async function updateTaskHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const parsed = UpdateTaskSchema.parse(req.body);
    const userId = req.user?.id ?? null;

    const existingResult = await pool.query(
      `
      SELECT *
      FROM tasks
      WHERE id = $1
        AND tenant_id = $2
        AND deleted_at IS NULL
      LIMIT 1;
      `,
      [id, tenantId],
    );

    if (!existingResult.rows.length) {
      return res.status(404).json({ message: "Task not found" });
    }

    const existing = existingResult.rows[0];

    const nextStartDate = parsed.start_date ?? existing.start_date;
    const nextEndDate = parsed.end_date ?? existing.end_date;

    if (new Date(nextEndDate).getTime() < new Date(nextStartDate).getTime()) {
      return res.status(400).json({
        message: "End date must be after start date",
      });
    }

    const query = `
      UPDATE tasks
      SET
        subject = $1,
        description = $2,
        status = $3,
        priority = $4,
        start_date = $5,
        end_date = $6,
        assigned_to = $7,
        related_to_type = $8,
        related_to_id = $9,
        repeat_task = $10,
        repeat_task_end = $11,
        task_duration_minutes = $12,
        updated_by = $13,
        updated_at = now()
      WHERE id = $14
        AND tenant_id = $15
        AND deleted_at IS NULL
      RETURNING *;
    `;

    const values = [
      parsed.subject ?? existing.subject,
      parsed.description !== undefined
        ? parsed.description
        : existing.description,
      parsed.status ?? existing.status,
      parsed.priority ?? existing.priority,
      nextStartDate,
      nextEndDate,
      parsed.assigned_to !== undefined
        ? parsed.assigned_to
        : existing.assigned_to,
      parsed.related_to_type ?? existing.related_to_type,
      parsed.related_to_id !== undefined
        ? parsed.related_to_id
        : existing.related_to_id,
      parsed.repeat_task ?? existing.repeat_task,
      parsed.repeat_task_end !== undefined
        ? parsed.repeat_task_end
        : existing.repeat_task_end,
      parsed.task_duration_minutes !== undefined
        ? parsed.task_duration_minutes
        : existing.task_duration_minutes,
      userId,
      id,
      tenantId,
    ];

    const result = await pool.query(query, values);

    return res.status(200).json({
      message: "Task updated successfully",
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteTaskHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const userId = req.user?.id ?? null;

    const result = await pool.query(
      `
      UPDATE tasks
      SET
        deleted_at = now(),
        updated_at = now(),
        updated_by = $3
      WHERE id = $1
        AND tenant_id = $2
        AND deleted_at IS NULL
      RETURNING id;
      `,
      [id, tenantId, userId],
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "Task not found" });
    }

    return res.status(200).json({
      message: "Task deleted successfully",
    });
  } catch (error) {
    next(error);
  }
}
