import { NextFunction, Request, Response } from "express";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";
import {
  CreateVisitSchema,
  GetVisitsListSchema,
  UpdateVisitSchema,
} from "./visits.schema";

function getDurationInMinutes(start?: string, end?: string) {
  if (!start || !end) return null;

  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();

  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return null;
  }

  return Math.round((endMs - startMs) / (1000 * 60));
}

function formatDuration(minutes?: number | null) {
  if (minutes == null) return null;

  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hrs > 0 && mins > 0) return `${hrs}h ${mins}m`;
  if (hrs > 0) return `${hrs}h`;
  return `${mins}m`;
}

function getTotalCost(data: {
  spare_cost?: number;
  employee_cost?: number;
  travelling_cost?: number;
  other_cost?: number;
}) {
  return (
    Number(data.spare_cost || 0) +
    Number(data.employee_cost || 0) +
    Number(data.travelling_cost || 0) +
    Number(data.other_cost || 0)
  );
}

export async function createVisitHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.sub;

    const parsed = CreateVisitSchema.parse(req.body);

    const durationInMinutes = getDurationInMinutes(
      parsed.start_date,
      parsed.end_date,
    );
    const duration = formatDuration(durationInMinutes);
    const totalCost = getTotalCost(parsed);

    const result = await pool.query(
      `
      INSERT INTO visits (
        tenant_id,
        name,
        status,
        regarding,
        ticket_status,
        start_date,
        end_date,
        next_followup_date,
        duration,
        duration_in_minutes,
        remarks,
        assigned_to_user_id,
        organization_id,
        contact_id,
        lead_id,
        case_id,
        checkin_address,
        checkout_address,
        checkin_latitude,
        checkin_longitude,
        checkout_latitude,
        checkout_longitude,
        spare_cost,
        employee_cost,
        travelling_cost,
        other_cost,
        total_cost,
        created_by_id,
        updated_by_id
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25,
        $26, $27, $28, $29
      )
      RETURNING *
      `,
      [
        tenantId,
        parsed.name,
        parsed.status ?? null,
        parsed.regarding,
        parsed.ticket_status ?? null,
        parsed.start_date ?? null,
        parsed.end_date ?? null,
        parsed.next_followup_date ?? null,
        duration,
        durationInMinutes,
        parsed.remarks,
        parsed.assigned_to_user_id ?? null,
        parsed.organization_id ?? null,
        parsed.contact_id ?? null,
        parsed.lead_id ?? null,
        parsed.case_id ?? null,
        parsed.checkin_address ?? null,
        parsed.checkout_address ?? null,
        parsed.checkin_latitude ?? null,
        parsed.checkin_longitude ?? null,
        parsed.checkout_latitude ?? null,
        parsed.checkout_longitude ?? null,
        parsed.spare_cost ?? 0,
        parsed.employee_cost ?? 0,
        parsed.travelling_cost ?? 0,
        parsed.other_cost ?? 0,
        totalCost,
        userId ?? null,
        userId ?? null,
      ],
    );

    const visit = result.rows[0];

    return res.status(201).json({
      success: true,
      message: "Visit created successfully",
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
}

export async function getVisitsListHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const parsed = GetVisitsListSchema.parse(req.query);

    const page = parsed.page;
    const limit = parsed.limit;
    const offset = (page - 1) * limit;

    const values: any[] = [tenantId];
    let whereClause = `WHERE v.tenant_id = $1 AND v.deleted_at IS NULL`;

    if (parsed.search) {
      values.push(`%${parsed.search}%`);
      whereClause += ` AND v.name ILIKE $${values.length}`;
    }

    if (parsed.status) {
      values.push(parsed.status);
      whereClause += ` AND v.status = $${values.length}`;
    }

    if (parsed.regarding) {
      values.push(parsed.regarding);
      whereClause += ` AND v.regarding = $${values.length}`;
    }

    if (parsed.assigned_to_user_id) {
      values.push(parsed.assigned_to_user_id);
      whereClause += ` AND v.assigned_to_user_id = $${values.length}`;
    }

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM visits v
      ${whereClause}
    `;

    const countResult = await pool.query(countQuery, values);
    const total = countResult.rows[0]?.total || 0;

    values.push(limit);
    values.push(offset);

    const listQuery = `
      SELECT
        v.*,
        assigned_user.name AS assigned_to_name
      FROM visits v
      LEFT JOIN users assigned_user
        ON assigned_user.id = v.assigned_to_user_id
      ${whereClause}
      ORDER BY v.created_at DESC
      LIMIT $${values.length - 1}
      OFFSET $${values.length}
    `;

    const result = await pool.query(listQuery, values);

    return res.status(200).json({
      success: true,
      message: "Visits fetched successfully",
      data: {
        items: result.rows,
        total,
        page,
        limit,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getVisitByIdHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT
        v.*,
        assigned_user.name AS assigned_to_name,
        created_user.name AS created_by_name,
        updated_user.name AS updated_by_name
      FROM visits v
      LEFT JOIN users assigned_user
        ON assigned_user.id = v.assigned_to_user_id
      LEFT JOIN users created_user
        ON created_user.id = v.created_by_id
      LEFT JOIN users updated_user
        ON updated_user.id = v.updated_by_id
      WHERE v.id = $1
        AND v.tenant_id = $2
        AND v.deleted_at IS NULL
      LIMIT 1
      `,
      [id, tenantId],
    );

    if (!result.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Visit not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Visit fetched successfully",
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
}

export async function updateVisitHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.sub;
    const { id } = req.params;

    const parsed = UpdateVisitSchema.parse(req.body);

    const existingResult = await pool.query(
      `
      SELECT *
      FROM visits
      WHERE id = $1
        AND tenant_id = $2
        AND deleted_at IS NULL
      LIMIT 1
      `,
      [id, tenantId],
    );

    if (!existingResult.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Visit not found",
      });
    }

    const existing = existingResult.rows[0];

    const startDate = parsed.start_date ?? existing.start_date ?? null;
    const endDate = parsed.end_date ?? existing.end_date ?? null;

    const durationInMinutes = getDurationInMinutes(startDate, endDate);
    const duration = formatDuration(durationInMinutes);

    const totalCost = getTotalCost({
      spare_cost: parsed.spare_cost ?? existing.spare_cost,
      employee_cost: parsed.employee_cost ?? existing.employee_cost,
      travelling_cost: parsed.travelling_cost ?? existing.travelling_cost,
      other_cost: parsed.other_cost ?? existing.other_cost,
    });

    const result = await pool.query(
      `
      UPDATE visits
      SET
        name = COALESCE($3, name),
        status = COALESCE($4, status),
        regarding = COALESCE($5, regarding),
        ticket_status = COALESCE($6, ticket_status),
        start_date = COALESCE($7, start_date),
        end_date = COALESCE($8, end_date),
        next_followup_date = COALESCE($9, next_followup_date),
        duration = $10,
        duration_in_minutes = $11,
        remarks = COALESCE($12, remarks),
        assigned_to_user_id = COALESCE($13, assigned_to_user_id),
        organization_id = COALESCE($14, organization_id),
        contact_id = COALESCE($15, contact_id),
        lead_id = COALESCE($16, lead_id),
        case_id = COALESCE($17, case_id),
        checkin_address = COALESCE($18, checkin_address),
        checkout_address = COALESCE($19, checkout_address),
        checkin_latitude = COALESCE($20, checkin_latitude),
        checkin_longitude = COALESCE($21, checkin_longitude),
        checkout_latitude = COALESCE($22, checkout_latitude),
        checkout_longitude = COALESCE($23, checkout_longitude),
        spare_cost = COALESCE($24, spare_cost),
        employee_cost = COALESCE($25, employee_cost),
        travelling_cost = COALESCE($26, travelling_cost),
        other_cost = COALESCE($27, other_cost),
        total_cost = $28,
        updated_at = now(),
        updated_by_id = $29
      WHERE id = $1
        AND tenant_id = $2
      RETURNING *
      `,
      [
        id,
        tenantId,
        parsed.name ?? null,
        parsed.status ?? null,
        parsed.regarding ?? null,
        parsed.ticket_status ?? null,
        parsed.start_date ?? null,
        parsed.end_date ?? null,
        parsed.next_followup_date ?? null,
        duration,
        durationInMinutes,
        parsed.remarks ?? null,
        parsed.assigned_to_user_id ?? null,
        parsed.organization_id ?? null,
        parsed.contact_id ?? null,
        parsed.lead_id ?? null,
        parsed.case_id ?? null,
        parsed.checkin_address ?? null,
        parsed.checkout_address ?? null,
        parsed.checkin_latitude ?? null,
        parsed.checkin_longitude ?? null,
        parsed.checkout_latitude ?? null,
        parsed.checkout_longitude ?? null,
        parsed.spare_cost ?? null,
        parsed.employee_cost ?? null,
        parsed.travelling_cost ?? null,
        parsed.other_cost ?? null,
        totalCost,
        userId ?? null,
      ],
    );

    return res.status(200).json({
      success: true,
      message: "Visit updated successfully",
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
}
