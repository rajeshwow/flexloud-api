import { NextFunction, Request, Response } from "express";
import { PoolClient } from "pg";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";
import {
  CreateMasterTypeSchema,
  CreateMasterValueSchema,
  GetMasterTypesSchema,
  GetMasterValuesSchema,
  UpdateMasterTypeSchema,
  UpdateMasterValueSchema,
} from "./masters.schema";

type MasterTypeRow = {
  id: string;
  code: string;
  name: string;
};

type MasterValueRow = {
  id: string;
  tenant_id: string;
  master_type_id: string;
  label: string;
  value: string;
  description: string | null;
  color: string | null;
  parent_id: string | null;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
  metadata: Record<string, unknown>;
};

async function resolveMasterTypeId(
  tenantId: string,
  input: { master_type_id?: string; type_code?: string },
) {
  if (input.master_type_id) return input.master_type_id;

  const result = await pool.query(
    `
      SELECT id
      FROM master_types
      WHERE tenant_id = $1
        AND code = $2
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [tenantId, input.type_code],
  );

  if (!result.rowCount) {
    throw new Error("Master type not found.");
  }

  return result.rows[0].id as string;
}

async function getMasterTypeById(
  tenantId: string,
  masterTypeId: string,
  client: PoolClient,
): Promise<MasterTypeRow> {
  const result = await client.query(
    `
      SELECT id, code, name
      FROM master_types
      WHERE tenant_id = $1
        AND id = $2
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [tenantId, masterTypeId],
  );

  if (!result.rowCount) {
    throw new Error("Master type not found.");
  }

  return result.rows[0];
}

async function getMasterValueById(
  tenantId: string,
  valueId: string,
  client: PoolClient,
): Promise<(MasterValueRow & { master_type_code: string }) | null> {
  const result = await client.query(
    `
      SELECT
        mv.*,
        mt.code AS master_type_code
      FROM master_values mv
      INNER JOIN master_types mt ON mt.id = mv.master_type_id
      WHERE mv.tenant_id = $1
        AND mv.id = $2
        AND mv.deleted_at IS NULL
      LIMIT 1
    `,
    [tenantId, valueId],
  );

  return result.rowCount ? result.rows[0] : null;
}

async function validateParentRelation(params: {
  tenantId: string;
  masterTypeId: string;
  parentId: string | null;
  currentValueId?: string;
  client: PoolClient;
}) {
  const client = params.client;
  const { tenantId, masterTypeId, parentId, currentValueId } = params;

  if (!parentId) return;

  if (currentValueId && parentId === currentValueId) {
    throw new Error("A master value cannot be its own parent.");
  }

  const currentType = await getMasterTypeById(tenantId, masterTypeId, client);
  const parentValue = await getMasterValueById(tenantId, parentId, client);

  if (!parentValue) {
    throw new Error("Parent master value not found.");
  }

  if (currentValueId) {
    let cursor: string | null = parentValue.parent_id;

    while (cursor) {
      if (cursor === currentValueId) {
        throw new Error("Circular parent hierarchy is not allowed.");
      }

      const ancestor = await getMasterValueById(tenantId, cursor, client);
      if (!ancestor) break;
      cursor = ancestor.parent_id;
    }
  }

  if (
    currentType.code === "state" &&
    parentValue.master_type_code !== "country"
  ) {
    throw new Error("State must have a parent from country type.");
  }

  if (currentType.code === "city" && parentValue.master_type_code !== "state") {
    throw new Error("City must have a parent from state type.");
  }
}

export async function createMasterTypeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.sub ?? null;
    const parsed = CreateMasterTypeSchema.parse(req.body);

    const result = await pool.query(
      `
        INSERT INTO master_types (
          tenant_id,
          code,
          name,
          description,
          module_name,
          is_active,
          created_by_id,
          updated_by_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *
      `,
      [
        tenantId,
        parsed.code,
        parsed.name,
        parsed.description ?? null,
        parsed.module_name ?? null,
        parsed.is_active ?? true,
        userId,
        userId,
      ],
    );

    return res.status(201).json({
      success: true,
      message: "Master type created successfully.",
      data: result.rows[0],
    });
  } catch (error: any) {
    if (error?.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "Master type code already exists.",
      });
    }
    return next(error);
  }
}

export async function getMasterTypesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const parsed = GetMasterTypesSchema.parse(req.query);

    const conditions: string[] = [`tenant_id = $1`, `deleted_at IS NULL`];
    const values: any[] = [tenantId];
    let index = values.length;

    if (parsed.search) {
      index += 1;
      conditions.push(`(name ILIKE $${index} OR code ILIKE $${index})`);
      values.push(`%${parsed.search}%`);
    }

    if (parsed.module_name) {
      index += 1;
      conditions.push(`module_name = $${index}`);
      values.push(parsed.module_name);
    }

    if (parsed.is_active) {
      index += 1;
      conditions.push(`is_active = $${index}`);
      values.push(parsed.is_active === "true");
    }

    const result = await pool.query(
      `
        SELECT *
        FROM master_types
        WHERE ${conditions.join(" AND ")}
        ORDER BY name ASC
      `,
      values,
    );

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    return next(error);
  }
}

export async function updateMasterTypeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.sub ?? null;
    const { id } = req.params;
    const parsed = UpdateMasterTypeSchema.parse(req.body);

    const existing = await pool.query(
      `
        SELECT *
        FROM master_types
        WHERE id = $1
          AND tenant_id = $2
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [id, tenantId],
    );

    if (!existing.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Master type not found.",
      });
    }

    const current = existing.rows[0];

    const result = await pool.query(
      `
        UPDATE master_types
        SET
          name = $1,
          description = $2,
          module_name = $3,
          is_active = $4,
          updated_by_id = $5
        WHERE id = $6
          AND tenant_id = $7
        RETURNING *
      `,
      [
        parsed.name ?? current.name,
        parsed.description !== undefined
          ? parsed.description
          : current.description,
        parsed.module_name !== undefined
          ? parsed.module_name
          : current.module_name,
        parsed.is_active ?? current.is_active,
        userId,
        id,
        tenantId,
      ],
    );

    return res.json({
      success: true,
      message: "Master type updated successfully.",
      data: result.rows[0],
    });
  } catch (error) {
    return next(error);
  }
}

export async function createMasterValueHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const tenantId = getTenantId(req);
    const userId = req.user?.sub ?? null;
    const parsed = CreateMasterValueSchema.parse(req.body);

    const masterTypeId = await resolveMasterTypeId(tenantId, parsed);

    await validateParentRelation({
      tenantId,
      masterTypeId,
      parentId: parsed.parent_id ?? null,
      client,
    });

    if (parsed.is_default) {
      await client.query(
        `
          UPDATE master_values
          SET is_default = FALSE, updated_by_id = $1
          WHERE tenant_id = $2
            AND master_type_id = $3
            AND deleted_at IS NULL
        `,
        [userId, tenantId, masterTypeId],
      );
    }

    const result = await client.query(
      `
        INSERT INTO master_values (
          tenant_id,
          master_type_id,
          label,
          value,
          description,
          color,
          parent_id,
          is_default,
          is_active,
          sort_order,
          metadata,
          created_by_id,
          updated_by_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        RETURNING *
      `,
      [
        tenantId,
        masterTypeId,
        parsed.label,
        parsed.value,
        parsed.description ?? null,
        parsed.color ?? null,
        parsed.parent_id ?? null,
        parsed.is_default ?? false,
        parsed.is_active ?? true,
        parsed.sort_order ?? 0,
        parsed.metadata ?? {},
        userId,
        userId,
      ],
    );

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: "Master value created successfully.",
      data: result.rows[0],
    });
  } catch (error: any) {
    await client.query("ROLLBACK");

    if (error?.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "Master value already exists for this type.",
      });
    }

    if (
      error instanceof Error &&
      [
        "Master type not found.",
        "Parent master value not found.",
        "A master value cannot be its own parent.",
        "Circular parent hierarchy is not allowed.",
        "State must have a parent from country type.",
        "City must have a parent from state type.",
      ].includes(error.message)
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    return next(error);
  } finally {
    client.release();
  }
}

export async function getMasterValuesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const parsed = GetMasterValuesSchema.parse(req.query) as any;

    let masterTypeId = parsed.master_type_id;
    if (!masterTypeId && parsed.type_code) {
      masterTypeId = await resolveMasterTypeId(tenantId, {
        type_code: parsed.type_code,
      });
    }

    const conditions: string[] = [
      `mv.tenant_id = $1`,
      `mv.master_type_id = $2`,
      `mv.deleted_at IS NULL`,
    ];

    const values: any[] = [tenantId, masterTypeId];
    let index = values.length;

    if (parsed.search) {
      index += 1;
      conditions.push(`(mv.label ILIKE $${index} OR mv.value ILIKE $${index})`);
      values.push(`%${parsed.search}%`);
    }

    if (parsed.parent_id) {
      index += 1;
      conditions.push(`mv.parent_id = $${index}`);
      values.push(parsed.parent_id);
    }

    if (parsed.parent_value) {
      index += 1;
      conditions.push(`parent.value = $${index}`);
      values.push(parsed.parent_value);
    }

    if (parsed.is_active) {
      index += 1;
      conditions.push(`mv.is_active = $${index}`);
      values.push(parsed.is_active === "true");
    }

    const result = await pool.query(
      `
        SELECT
          mv.*,
          mt.code AS master_type_code,
          mt.name AS master_type_name,
          parent.label AS parent_label,
          parent.value AS parent_value
        FROM master_values mv
        INNER JOIN master_types mt ON mt.id = mv.master_type_id
        LEFT JOIN master_values parent ON parent.id = mv.parent_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY mv.sort_order ASC, mv.label ASC
      `,
      values,
    );

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    if (error instanceof Error && error.message === "Master type not found.") {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }
    return next(error);
  }
}

export async function updateMasterValueHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const tenantId = getTenantId(req);
    const userId = req.user?.sub ?? null;
    const { id } = req.params;
    const parsed = UpdateMasterValueSchema.parse(req.body);

    const existing = await client.query(
      `
        SELECT *
        FROM master_values
        WHERE id = $1
          AND tenant_id = $2
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [id, tenantId],
    );

    if (!existing.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Master value not found.",
      });
    }

    const current = existing.rows[0] as MasterValueRow;

    const nextParentId =
      parsed.parent_id !== undefined ? parsed.parent_id : current.parent_id;

    await validateParentRelation({
      tenantId,
      masterTypeId: current.master_type_id,
      parentId: nextParentId,
      currentValueId: id,
      client,
    });

    if (parsed.is_default === true) {
      await client.query(
        `
          UPDATE master_values
          SET is_default = FALSE, updated_by_id = $1
          WHERE tenant_id = $2
            AND master_type_id = $3
            AND deleted_at IS NULL
        `,
        [userId, tenantId, current.master_type_id],
      );
    }

    const result = await client.query(
      `
        UPDATE master_values
        SET
          label = $1,
          value = $2,
          description = $3,
          color = $4,
          parent_id = $5,
          is_default = $6,
          is_active = $7,
          sort_order = $8,
          metadata = $9,
          updated_by_id = $10
        WHERE id = $11
          AND tenant_id = $12
        RETURNING *
      `,
      [
        parsed.label ?? current.label,
        parsed.value ?? current.value,
        parsed.description !== undefined
          ? parsed.description
          : current.description,
        parsed.color !== undefined ? parsed.color : current.color,
        nextParentId,
        parsed.is_default ?? current.is_default,
        parsed.is_active ?? current.is_active,
        parsed.sort_order ?? current.sort_order,
        parsed.metadata ?? current.metadata,
        userId,
        id,
        tenantId,
      ],
    );

    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "Master value updated successfully.",
      data: result.rows[0],
    });
  } catch (error: any) {
    await client.query("ROLLBACK");

    if (error?.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "Master value already exists for this type.",
      });
    }

    if (
      error instanceof Error &&
      [
        "Parent master value not found.",
        "A master value cannot be its own parent.",
        "Circular parent hierarchy is not allowed.",
        "State must have a parent from country type.",
        "City must have a parent from state type.",
      ].includes(error.message)
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    return next(error);
  } finally {
    client.release();
  }
}

export async function deleteMasterValueHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.sub ?? null;
    const { id } = req.params;

    const existing = await pool.query(
      `
        SELECT id
        FROM master_values
        WHERE id = $1
          AND tenant_id = $2
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [id, tenantId],
    );

    if (!existing.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Master value not found.",
      });
    }

    const childCheck = await pool.query(
      `
        SELECT id
        FROM master_values
        WHERE tenant_id = $1
          AND parent_id = $2
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [tenantId, id],
    );

    if (childCheck.rowCount) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete master value because child values exist.",
      });
    }

    const result = await pool.query(
      `
        UPDATE master_values
        SET
          deleted_at = NOW(),
          deleted_by_id = $1,
          updated_by_id = $1
        WHERE id = $2
          AND tenant_id = $3
          AND deleted_at IS NULL
        RETURNING id
      `,
      [userId, id, tenantId],
    );

    return res.json({
      success: true,
      message: "Master value deleted successfully.",
    });
  } catch (error) {
    return next(error);
  }
}
