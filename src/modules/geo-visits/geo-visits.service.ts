import { Request, Response } from "express";
import { pool } from "../../db/pool";
import {
  CreateGeoVisitSchema,
  GetGeoVisitsSchema,
  UpdateGeoVisitCheckOutSchema,
} from "./geo-visits.schema";

function getTenantId(req: Request) {
  return (
    (req as any).tenantId || (req as any).tenant_id || (req as any).tenant?.id
  );
}

function getUserId(req: Request) {
  return (req as any).user?.sub || (req as any).user?.id;
}

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function calculateDistanceMeters(
  lat1: number,
  lng1: number,
  lat2?: number | null,
  lng2?: number | null,
) {
  if (
    lat2 === undefined ||
    lat2 === null ||
    lng2 === undefined ||
    lng2 === null
  ) {
    return null;
  }

  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

export async function createGeoVisitHandler(req: Request, res: Response) {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserId(req);

    if (!tenantId) {
      return res.status(400).json({ message: "Tenant not found in request" });
    }

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const parsed = CreateGeoVisitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid request body",
        errors: parsed.error.flatten(),
      });
    }

    const payload = parsed.data;

    const existingOpenVisit = await pool.query(
      `
      SELECT id
      FROM geo_visit_logs
      WHERE tenant_id = $1
        AND module_name = $2
        AND record_id = $3
        AND user_id = $4
        AND check_out_at IS NULL
        AND status = 'checked_in'
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [tenantId, payload.module_name, payload.record_id, userId],
    );

    if (existingOpenVisit.rows.length) {
      return res.status(409).json({
        message: "An active geo visit already exists for this record and user",
      });
    }

    const distanceMeters = calculateDistanceMeters(
      payload.check_in_lat,
      payload.check_in_lng,
      payload.target_lat,
      payload.target_lng,
    );

    const result = await pool.query(
      `
      INSERT INTO geo_visit_logs (
        tenant_id,
        module_name,
        record_id,
        user_id,
        check_in_lat,
        check_in_lng,
        check_in_address,
        target_lat,
        target_lng,
        distance_from_target_meters,
        notes,
        geo_photo_url,
        metadata,
        status
      )
      VALUES (
        $1,$2,$3,$4,
        $5,$6,$7,
        $8,$9,$10,
        $11,$12,$13,
        'checked_in'
      )
      RETURNING *
      `,
      [
        tenantId,
        payload.module_name,
        payload.record_id,
        userId,
        payload.check_in_lat,
        payload.check_in_lng,
        payload.check_in_address || null,
        payload.target_lat ?? null,
        payload.target_lng ?? null,
        distanceMeters,
        payload.notes || null,
        payload.geo_photo_url || null,
        payload.metadata || {},
      ],
    );

    return res.status(201).json({
      message: "Geo visit checked in successfully",
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error("createGeoVisitHandler error", error);
    return res.status(500).json({
      message: "Failed to create geo visit",
      error: error?.message || "Unknown error",
    });
  }
}

export async function checkOutGeoVisitHandler(req: Request, res: Response) {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserId(req);
    const { id } = req.params;

    if (!tenantId) {
      return res.status(400).json({ message: "Tenant not found in request" });
    }

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const parsed = UpdateGeoVisitCheckOutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid request body",
        errors: parsed.error.flatten(),
      });
    }

    const payload = parsed.data;

    const existing = await pool.query(
      `
      SELECT *
      FROM geo_visit_logs
      WHERE id = $1
        AND tenant_id = $2
        AND user_id = $3
      LIMIT 1
      `,
      [id, tenantId, userId],
    );

    if (!existing.rows.length) {
      return res.status(404).json({ message: "Geo visit not found" });
    }

    const visit = existing.rows[0];

    if (visit.check_out_at) {
      return res.status(409).json({ message: "Geo visit already checked out" });
    }

    const mergedNotes = payload.notes?.trim()
      ? [visit.notes, payload.notes].filter(Boolean).join("\n")
      : visit.notes;

    const result = await pool.query(
      `
      UPDATE geo_visit_logs
      SET
        check_out_at = NOW(),
        check_out_lat = $1,
        check_out_lng = $2,
        check_out_address = $3,
        notes = $4,
        status = 'checked_out',
        updated_at = NOW()
      WHERE id = $5
        AND tenant_id = $6
        AND user_id = $7
      RETURNING *
      `,
      [
        payload.check_out_lat,
        payload.check_out_lng,
        payload.check_out_address || null,
        mergedNotes || null,
        id,
        tenantId,
        userId,
      ],
    );

    return res.status(200).json({
      message: "Geo visit checked out successfully",
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error("checkOutGeoVisitHandler error", error);
    return res.status(500).json({
      message: "Failed to check out geo visit",
      error: error?.message || "Unknown error",
    });
  }
}

export async function getGeoVisitsHandler(req: Request, res: Response) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(400).json({ message: "Tenant not found in request" });
    }

    const parsed = GetGeoVisitsSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid query params",
        errors: parsed.error.flatten(),
      });
    }

    const { module_name, record_id, user_id, status, limit, offset } =
      parsed.data;

    const values: any[] = [tenantId];
    const where: string[] = [`tenant_id = $1`];

    if (module_name) {
      values.push(module_name);
      where.push(`module_name = $${values.length}`);
    }

    if (record_id) {
      values.push(record_id);
      where.push(`record_id = $${values.length}`);
    }

    if (user_id) {
      values.push(user_id);
      where.push(`user_id = $${values.length}`);
    }

    if (status) {
      values.push(status);
      where.push(`status = $${values.length}`);
    }

    values.push(limit);
    const limitIndex = values.length;

    values.push(offset);
    const offsetIndex = values.length;

    const result = await pool.query(
      `
      SELECT *
      FROM geo_visit_logs
      WHERE ${where.join(" AND ")}
      ORDER BY check_in_at DESC
      LIMIT $${limitIndex}
      OFFSET $${offsetIndex}
      `,
      values,
    );

    const totalValues = values.slice(0, limitIndex - 1);

    const totalResult = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM geo_visit_logs
      WHERE ${where.join(" AND ")}
      `,
      totalValues,
    );

    return res.status(200).json({
      data: result.rows,
      total: totalResult.rows[0]?.total || 0,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error("getGeoVisitsHandler error", error);
    return res.status(500).json({
      message: "Failed to fetch geo visits",
      error: error?.message || "Unknown error",
    });
  }
}

export async function getGeoVisitByIdHandler(req: Request, res: Response) {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;

    if (!tenantId) {
      return res.status(400).json({ message: "Tenant not found in request" });
    }

    const result = await pool.query(
      `
      SELECT *
      FROM geo_visit_logs
      WHERE id = $1
        AND tenant_id = $2
      LIMIT 1
      `,
      [id, tenantId],
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "Geo visit not found" });
    }

    return res.status(200).json({
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error("getGeoVisitByIdHandler error", error);
    return res.status(500).json({
      message: "Failed to fetch geo visit",
      error: error?.message || "Unknown error",
    });
  }
}
