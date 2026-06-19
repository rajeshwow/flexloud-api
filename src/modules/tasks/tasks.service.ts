import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import { emitMyDayRefresh } from "../../common/socket";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";
import { calculateTaskPerformance } from "./task-performance.service";
import {
  CreateTaskSchema,
  GetTasksSchema,
  UpdateTaskSchema,
} from "./tasks.schema";

function buildTaskNumber() {
  const short = randomUUID().split("-")[0].toUpperCase();
  return `TASK-${short}`;
}

async function logTaskActivity({
  tenantId,
  taskId,
  action,
  fieldName,
  oldValue,
  newValue,
  description,
  performedBy,
}: {
  tenantId: string;
  taskId: string;
  action: string;
  fieldName?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  description?: string | null;
  performedBy?: string | null;
}) {
  await pool.query(
    `
    INSERT INTO task_activities (
      tenant_id, task_id, action, field_name, old_value, new_value, description, performed_by
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `,
    [
      tenantId,
      taskId,
      action,
      fieldName ?? null,
      oldValue ?? null,
      newValue ?? null,
      description ?? null,
      performedBy ?? null,
    ],
  );
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
        priority_id,
        start_date,
        end_date,
        assigned_to,
        related_to_type,
        related_to_id,
        repeat_task,
        repeat_task_end,
        task_duration,
        task_duration_minutes,
        created_by,
        updated_by
      )
      VALUES (
        gen_random_uuid(),
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17
      )
      RETURNING *;
    `;

    const values = [
      tenantId,
      taskNumber,
      parsed.subject,
      parsed.description ?? null,
      parsed.status,
      parsed.priority_id ?? null,
      parsed.start_date,
      parsed.end_date,
      parsed.assigned_to ?? null,
      parsed.related_to_type,
      parsed.related_to_id ?? null,
      parsed.repeat_task,
      parsed.repeat_task_end ?? null,
      parsed.task_duration ?? null,
      parsed.task_duration_minutes ?? null,
      userId,
      userId,
    ];

    const result = await pool.query(query, values);
    await calculateTaskPerformance(result.rows[0].id, tenantId);
    await logTaskActivity({
      tenantId,
      taskId: result.rows[0].id,
      action: "created",
      description: "Task created",
      performedBy: userId,
    });

    const createdTask = result.rows[0];

    if (createdTask.assigned_to) {
      emitMyDayRefresh(tenantId, createdTask.assigned_to, "task_assigned", {
        entity_type: "task",
        entity_id: createdTask.id,
        title: createdTask.subject,
        task_number: createdTask.task_number,
        // lead_display_id: createdTask.lead_display_id,
      });
    }

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

    if (parsed.priority_id) {
      whereClause += ` AND t.priority_id = $${idx}`;
      values.push(parsed.priority_id);
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
        COALESCE(
          NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''),
          u.name,
          u.email
        ) AS assigned_to_name,
        pmv.id AS priority_id,
        pmv.label AS priority_name,
        pmv.value AS priority_value,
        tpm.final_score,
        tpm.score_band,
        tpm.activity_count,
        tpm.first_response_minutes,
        tpm.overdue_days,
        tpm.is_overdue,
        tpm.completed_on_time,
        tpm.completion_score,
tpm.activity_score,
tpm.response_score,
tpm.overdue_penalty,
tpm.priority_multiplier,
        CASE
          WHEN t.related_to_type = 'organization' THEN org.name
          WHEN t.related_to_type = 'contact' THEN
            COALESCE(
              NULLIF(TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))), ''),
              c.email
            )
          WHEN t.related_to_type = 'lead' THEN
            COALESCE(
              NULLIF(TRIM(CONCAT(COALESCE(l.first_name, ''), ' ', COALESCE(l.last_name, ''))), ''),
              l.organization_name,
              l.lead_display_id,
              l.lead_number
            )
          WHEN t.related_to_type = 'opportunity' THEN o.name
          ELSE NULL
        END AS related_to_name
      FROM tasks t
      LEFT JOIN users u
        ON u.id = t.assigned_to
      LEFT JOIN master_values pmv
        ON pmv.id = t.priority_id
      LEFT JOIN organizations org
        ON t.related_to_type = 'organization'
       AND org.id = t.related_to_id
       AND org.tenant_id = t.tenant_id
      LEFT JOIN contacts c
        ON t.related_to_type = 'contact'
       AND c.id = t.related_to_id
       AND c.tenant_id = t.tenant_id
      LEFT JOIN leads l
        ON t.related_to_type = 'lead'
       AND l.id = t.related_to_id
       AND l.tenant_id = t.tenant_id
      LEFT JOIN opportunities o
        ON t.related_to_type = 'opportunity'
       AND o.id = t.related_to_id
       AND o.tenant_id = t.tenant_id
             LEFT JOIN task_performance_metrics tpm
        ON tpm.task_id = t.id
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
        COALESCE(
          NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''),
          u.name,
          u.email
        ) AS assigned_to_name,
        pmv.id AS priority_id,
        pmv.label AS priority_name,
        pmv.value AS priority_value,
         tpm.final_score,
        tpm.score_band,
        tpm.activity_count,
        tpm.first_response_minutes,
        tpm.overdue_days,
        tpm.is_overdue,
        tpm.completed_on_time,
        tpm.completion_score,
tpm.activity_score,
tpm.response_score,
tpm.overdue_penalty,
tpm.priority_multiplier,
        CASE
          WHEN t.related_to_type = 'organization' THEN org.name
          WHEN t.related_to_type = 'contact' THEN
            COALESCE(
              NULLIF(TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))), ''),
              c.email
            )
          WHEN t.related_to_type = 'lead' THEN
            COALESCE(
              NULLIF(TRIM(CONCAT(COALESCE(l.first_name, ''), ' ', COALESCE(l.last_name, ''))), ''),
              l.organization_name,
              l.lead_display_id,
              l.lead_number
            )
         WHEN t.related_to_type = 'opportunity' THEN o.name
          ELSE NULL
        END AS related_to_name
      FROM tasks t
      LEFT JOIN users u
        ON u.id = t.assigned_to
      LEFT JOIN master_values pmv
        ON pmv.id = t.priority_id
      LEFT JOIN organizations org
        ON t.related_to_type = 'organization'
       AND org.id = t.related_to_id
       AND org.tenant_id = t.tenant_id
      LEFT JOIN contacts c
        ON t.related_to_type = 'contact'
       AND c.id = t.related_to_id
       AND c.tenant_id = t.tenant_id
      LEFT JOIN leads l
        ON t.related_to_type = 'lead'
       AND l.id = t.related_to_id
       AND l.tenant_id = t.tenant_id
      LEFT JOIN opportunities o
        ON t.related_to_type = 'opportunity'
       AND o.id = t.related_to_id
       AND o.tenant_id = t.tenant_id
       LEFT JOIN task_performance_metrics tpm
  ON tpm.task_id = t.id
      WHERE t.id = $1
        AND t.tenant_id = $2
        AND t.deleted_at IS NULL
      LIMIT 1;
    `;

    const result = await pool.query(query, [id, tenantId]);

    if (!result.rows.length) {
      return res.status(404).json({
        message: "Task not found",
        statusCode: 404,
      });
    }

    return res.status(200).json({
      message: "Task fetched successfully",
      data: result.rows[0],
      statusCode: 200,
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
      return res.status(404).json({
        message: "Task not found",
        statusCode: 404,
      });
    }

    const existing = existingResult.rows[0];

    const oldAssignedTo = existing.assigned_to;

    const nextStartDate = parsed.start_date ?? existing.start_date;
    const nextEndDate = parsed.end_date ?? existing.end_date;

    if (new Date(nextEndDate).getTime() < new Date(nextStartDate).getTime()) {
      return res.status(400).json({
        message: "End date must be after start date",
        statusCode: 400,
      });
    }

    const query = `
      UPDATE tasks
      SET
        subject = $1,
        description = $2,
        status = $3,
        priority_id = $4,
        start_date = $5,
        end_date = $6,
        assigned_to = $7,
        related_to_type = $8,
        related_to_id = $9,
        repeat_task = $10,
        repeat_task_end = $11,
        task_duration = $12,
        task_duration_minutes = $13,
        updated_by = $14,
        updated_at = now()
      WHERE id = $15
        AND tenant_id = $16
        AND deleted_at IS NULL
      RETURNING *;
    ` as any;

    const values = [
      parsed.subject ?? existing.subject,
      parsed.description !== undefined
        ? parsed.description
        : existing.description,
      parsed.status ?? existing.status,
      parsed.priority_id !== undefined
        ? parsed.priority_id
        : existing.priority_id,
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
      parsed.task_duration !== undefined
        ? parsed.task_duration
        : existing.task_duration,
      parsed.task_duration_minutes !== undefined
        ? parsed.task_duration_minutes
        : existing.task_duration_minutes,
      userId,
      id,
      tenantId,
    ];

    const result = await pool.query(query, values);

    if (!result.rows.length) {
      return res.status(404).json({
        message: "Task not found",
        statusCode: 404,
      });
    }

    const updatedTask = result.rows[0] as any;
    const newAssignedTo = updatedTask.assigned_to;

    await calculateTaskPerformance(id, tenantId);

    if (oldAssignedTo && oldAssignedTo !== newAssignedTo) {
      emitMyDayRefresh(tenantId, oldAssignedTo, "task_reassigned_from", {
        entity_type: "task",
        entity_id: updatedTask.id,
        title: updatedTask.subject,
        task_number: updatedTask.task_number,
        // lead_display_id: updatedTask.lead_display_id,
      });
    }

    if (newAssignedTo) {
      emitMyDayRefresh(tenantId, newAssignedTo, "task_updated", {
        entity_type: "task",
        entity_id: updatedTask.id,
        title: updatedTask.subject,
        task_number: updatedTask.task_number,
        // lead_display_id: updatedTask.lead_display_id,
      });
    }

    return res.status(200).json({
      message: "Task updated successfully",
      data: updatedTask,
      statusCode: 200,
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
      return res.status(404).json({
        message: "Task not found",
        statusCode: 404,
      });
    }

    return res.status(200).json({
      message: "Task deleted successfully",
      statusCode: 200,
    });
  } catch (error) {
    next(error);
  }
}
