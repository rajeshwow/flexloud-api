import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";

type CreateContactInput = {
  tenantId: string;
  createdBy: string | null;
  updatedBy: string | null;

  first_name: string;
  last_name?: string | null;
  mobile?: string | null;
  email?: string | null;

  city?: string | null;
  state?: string | null;
  country?: string | null;

  organization_id?: string | null;
  assigned_to?: string | null;
};

type GetAllContactsInput = {
  tenantId: string;
  page: number;
  limit: number;
  search?: string;
};

const CreateContactSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().optional().nullable(),
  mobile: z.string().optional().nullable(),
  birthdate: z.string().optional().nullable(),
  primary_contact: z.string().optional().nullable(),

  emails: z
    .array(
      z.object({
        email: z.string().email("Invalid email"),
        primary: z.boolean().optional(),
        opt_out: z.boolean().optional(),
        invalid: z.boolean().optional(),
      }),
    )
    .optional()
    .default([]),

  primary_address: z
    .object({
      street: z.string().optional().nullable(),
      area: z.string().optional().nullable(),
      postal_code: z.string().optional().nullable(),
      city: z.string().optional().nullable(),
      state: z.string().optional().nullable(),
      country: z.string().optional().nullable(),
    })
    .optional(),

  alternate_address: z
    .object({
      street: z.string().optional().nullable(),
      area: z.string().optional().nullable(),
      postal_code: z.string().optional().nullable(),
      city: z.string().optional().nullable(),
      state: z.string().optional().nullable(),
      country: z.string().optional().nullable(),
    })
    .optional(),

  organization_id: z.string().uuid().optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
});

export const contactsService = {
  async create(input: CreateContactInput) {
    const query = `
      INSERT INTO contacts (
        tenant_id,
        first_name,
        last_name,
        mobile,
        email,
        city,
        state,
        country,
        organization_id,
        assigned_to,
        created_by,
        updated_by
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      )
      RETURNING *;
    `;

    const values = [
      input.tenantId,
      input.first_name,
      input.last_name || null,
      input.mobile || null,
      input.email || null,
      input.city || null,
      input.state || null,
      input.country || null,
      input.organization_id || null,
      input.assigned_to || null,
      input.createdBy,
      input.updatedBy,
    ];

    const { rows } = await pool.query(query, values);
    return rows[0];
  },

  async getAll(input: GetAllContactsInput) {
    const page = input.page > 0 ? input.page : 1;
    const limit = input.limit > 0 ? input.limit : 10;
    const offset = (page - 1) * limit;
    const search = input.search?.trim() || "";

    const whereParts = [`c.tenant_id = $1`];
    const values: Array<string | number> = [input.tenantId];

    if (search) {
      values.push(`%${search}%`);
      whereParts.push(`
        (
          c.first_name ILIKE $2 OR
          c.last_name ILIKE $2 OR
          c.mobile ILIKE $2 OR
          c.email ILIKE $2 OR
          c.city ILIKE $2
        )
      `);
    }

    const whereClause = whereParts.join(" AND ");

    const dataQuery = `
      SELECT
        c.id,
        c.first_name,
        c.last_name,
        c.mobile,
        c.email,
        c.city,
        c.state,
        c.country,
        c.organization_id,
        c.assigned_to,
        c.created_at,
        c.updated_at,
        o.name AS organization_name,
        u.name AS assigned_to_name
      FROM contacts c
      LEFT JOIN organizations o ON o.id = c.organization_id
      LEFT JOIN users u ON u.id = c.assigned_to
      WHERE ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2};
    `;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM contacts c
      WHERE ${whereClause};
    `;

    const dataValues = [...values, limit, offset];

    const [dataResult, countResult] = await Promise.all([
      pool.query(dataQuery, dataValues),
      pool.query(countQuery, values),
    ]);

    const total = countResult.rows[0]?.total || 0;

    return {
      data: dataResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async getById(id: string, tenantId: string) {
    const query = `
      SELECT
        c.*,
        o.name AS organization_name,
        u.name AS assigned_to_name
      FROM contacts c
      LEFT JOIN organizations o ON o.id = c.organization_id
      LEFT JOIN users u ON u.id = c.assigned_to
      WHERE c.id = $1 AND c.tenant_id = $2
      LIMIT 1;
    `;

    const { rows } = await pool.query(query, [id, tenantId]);
    return rows[0] || null;
  },
};

export async function createContactHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const createdBy = req.user?.sub || null;

    const input = CreateContactSchema.parse(req.body);

    const primaryEmail =
      input.emails?.find((item) => item.primary)?.email ||
      input.emails?.[0]?.email ||
      null;

    const result = await contactsService.create({
      tenantId,
      createdBy,
      updatedBy: createdBy,
      first_name: input.first_name,
      last_name: input.last_name ?? null,
      mobile: input.mobile ?? null,
      email: primaryEmail,
      city: input.primary_address?.city ?? null,
      state: input.primary_address?.state ?? null,
      country: input.primary_address?.country ?? null,
      organization_id: input.organization_id ?? null,
      assigned_to: input.assigned_to ?? null,
    });

    res.status(201).json({
      message: "Contact created successfully",
      data: result,
      status: "success",
      statusCode: 201,
    });
  } catch (error) {
    next(error);
  }
}

export async function getContactsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 10);
    const search = String(req.query.search || "").trim();

    const result = await contactsService.getAll({
      tenantId,
      page,
      limit,
      search,
    });

    res.status(200).json({
      message: "Contacts fetched successfully",
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

export async function getContactByIdHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;

    const result = await contactsService.getById(id, tenantId);

    if (!result) {
      return res.status(404).json({
        message: "Contact not found",
      });
    }

    res.status(200).json({
      message: "Contact fetched successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}
