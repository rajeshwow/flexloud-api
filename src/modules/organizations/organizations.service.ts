import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";

type BranchInput = {
  name: string;
  code?: string | null;
  is_head_office?: boolean;

  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  gst_number?: string | null;
  assigned_to?: string | null;

  billing_street?: string | null;
  billing_area?: string | null;
  billing_postal_code?: string | null;
  billing_city?: string | null;
  billing_state?: string | null;
  billing_country?: string | null;

  shipping_street?: string | null;
  shipping_area?: string | null;
  shipping_postal_code?: string | null;
  shipping_city?: string | null;
  shipping_state?: string | null;
  shipping_country?: string | null;

  is_shipping_same_as_billing?: boolean;
  status?: "active" | "inactive";
};

type CreateOrganizationInput = {
  tenantId: string;
  createdBy: string | null;
  updatedBy: string | null;

  name: string;
  gst_number?: string | null;
  email?: string | null;
  next_followup_at?: string | null;

  type?: string | null;
  industry?: string | null;
  assigned_to?: string | null;

  registered_address?: {
    street?: string | null;
    area?: string | null;
    postal_code?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
  } | null;

  branches: BranchInput[];
};

type GetAllOrganizationsInput = {
  tenantId: string;
  page: number;
  limit: number;
  search?: string;
};

const BranchSchema = z.object({
  name: z.string().min(1, "Branch name is required"),
  code: z.string().optional().nullable(),
  is_head_office: z.boolean().optional(),

  contact_person: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z
    .string()
    .email("Invalid email")
    .optional()
    .or(z.literal(""))
    .nullable(),
  gst_number: z.string().optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),

  billing_street: z.string().optional().nullable(),
  billing_area: z.string().optional().nullable(),
  billing_postal_code: z.string().optional().nullable(),
  billing_city: z.string().optional().nullable(),
  billing_state: z.string().optional().nullable(),
  billing_country: z.string().optional().nullable(),

  shipping_street: z.string().optional().nullable(),
  shipping_area: z.string().optional().nullable(),
  shipping_postal_code: z.string().optional().nullable(),
  shipping_city: z.string().optional().nullable(),
  shipping_state: z.string().optional().nullable(),
  shipping_country: z.string().optional().nullable(),

  is_shipping_same_as_billing: z.boolean().optional().default(false),
  status: z.enum(["active", "inactive"]).optional().default("active"),
});

const CreateOrganizationSchema = z
  .object({
    name: z.string().min(2, "Name is required"),
    gst_number: z.string().optional().nullable(),
    email: z
      .string()
      .email("Invalid email")
      .optional()
      .or(z.literal(""))
      .nullable(),
    next_followup_at: z.string().datetime().optional().nullable(),

    type: z.string().optional().nullable(),
    industry: z.string().optional().nullable(),
    assigned_to: z.string().uuid().optional().nullable(),

    registered_address: z
      .object({
        street: z.string().optional().nullable(),
        area: z.string().optional().nullable(),
        postal_code: z.string().optional().nullable(),
        city: z.string().optional().nullable(),
        state: z.string().optional().nullable(),
        country: z.string().optional().nullable(),
      })
      .optional()
      .nullable(),

    branches: z.array(BranchSchema).min(1, "At least one branch is required"),
  })
  .superRefine((data, ctx) => {
    const headOfficeCount = data.branches.filter(
      (b) => b.is_head_office,
    ).length;

    if (headOfficeCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only one head office branch is allowed",
        path: ["branches"],
      });
    }

    const seenCodes = new Set<string>();
    data.branches.forEach((branch, index) => {
      const code = branch.code?.trim()?.toLowerCase();
      if (!code) return;

      if (seenCodes.has(code)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Branch code must be unique within organization",
          path: ["branches", index, "code"],
        });
      }

      seenCodes.add(code);
    });
  });

export const organizationsService = {
  async create(input: CreateOrganizationInput) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const orgQuery = `
        INSERT INTO organizations (
          tenant_id,
          name,
          gst_number,
          email,
          next_followup_at,
          type,
          industry,
          assigned_to,
          registered_street,
          registered_area,
          registered_postal_code,
          registered_city,
          registered_state,
          registered_country,
          created_by,
          updated_by
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15, $16
        )
        RETURNING *;
      `;

      const orgValues = [
        input.tenantId,
        input.name,
        input.gst_number || null,
        input.email || null,
        input.next_followup_at || null,
        input.type || null,
        input.industry || null,
        input.assigned_to || null,
        input.registered_address?.street || null,
        input.registered_address?.area || null,
        input.registered_address?.postal_code || null,
        input.registered_address?.city || null,
        input.registered_address?.state || null,
        input.registered_address?.country || null,
        input.createdBy,
        input.updatedBy,
      ];

      const orgResult = await client.query(orgQuery, orgValues);
      const organization = orgResult.rows[0];

      const createdBranches = [];

      for (const branch of input.branches) {
        const branchQuery = `
          INSERT INTO organization_branches (
            tenant_id,
            organization_id,
            name,
            code,
            is_head_office,
            contact_person,
            phone,
            email,
            gst_number,
            assigned_to,
            billing_street,
            billing_area,
            billing_postal_code,
            billing_city,
            billing_state,
            billing_country,
            shipping_street,
            shipping_area,
            shipping_postal_code,
            shipping_city,
            shipping_state,
            shipping_country,
            is_shipping_same_as_billing,
            status,
            created_by,
            updated_by
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16,
            $17, $18, $19, $20, $21, $22,
            $23, $24, $25, $26
          )
          RETURNING *;
        `;

        const branchValues = [
          input.tenantId,
          organization.id,
          branch.name,
          branch.code || null,
          branch.is_head_office ?? false,
          branch.contact_person || null,
          branch.phone || null,
          branch.email || null,
          branch.gst_number || null,
          branch.assigned_to || null,
          branch.billing_street || null,
          branch.billing_area || null,
          branch.billing_postal_code || null,
          branch.billing_city || null,
          branch.billing_state || null,
          branch.billing_country || null,
          branch.shipping_street || null,
          branch.shipping_area || null,
          branch.shipping_postal_code || null,
          branch.shipping_city || null,
          branch.shipping_state || null,
          branch.shipping_country || null,
          branch.is_shipping_same_as_billing ?? false,
          branch.status || "active",
          input.createdBy,
          input.updatedBy,
        ];

        const branchResult = await client.query(branchQuery, branchValues);
        createdBranches.push(branchResult.rows[0]);
      }

      await client.query("COMMIT");

      return {
        ...organization,
        branches: createdBranches,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async getAll(input: GetAllOrganizationsInput) {
    const page = input.page > 0 ? input.page : 1;
    const limit = input.limit > 0 ? input.limit : 10;
    const offset = (page - 1) * limit;
    const search = input.search?.trim() || "";

    const whereParts = [`o.tenant_id = $1`];
    const values: Array<string | number> = [input.tenantId];

    if (search) {
      values.push(`%${search}%`);
      whereParts.push(
        `(o.name ILIKE $2 OR o.email ILIKE $2 OR o.type ILIKE $2 OR o.industry ILIKE $2)`,
      );
    }

    const whereClause = whereParts.join(" AND ");

    const dataQuery = `
      SELECT
        o.id,
        o.name,
        o.gst_number,
        o.email,
        o.next_followup_at,
        o.type,
        o.industry,
        o.assigned_to,
        o.created_at,
        o.updated_at,
        u.name AS assigned_to_name,
        COALESCE(b.branch_count, 0) AS branch_count,
        b.head_office_name
      FROM organizations o
      LEFT JOIN users u ON u.id = o.assigned_to
      LEFT JOIN (
        SELECT
          ob.organization_id,
          COUNT(*)::int AS branch_count,
          MAX(CASE WHEN ob.is_head_office = true THEN ob.name END) AS head_office_name
        FROM organization_branches ob
        WHERE ob.tenant_id = $1
        GROUP BY ob.organization_id
      ) b ON b.organization_id = o.id
      WHERE ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2};
    `;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM organizations o
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
};

export async function createOrganizationHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const createdBy = req.user?.sub || null;

    const input = CreateOrganizationSchema.parse(req.body);

    const result = await organizationsService.create({
      tenantId,
      createdBy,
      updatedBy: createdBy,
      ...input,
    });

    res.status(201).json({
      message: "Organization created successfully",
      data: result,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        message: "Validation failed",
        errors: error.flatten(),
      });
    }

    if (error?.code === "23505") {
      return res.status(400).json({
        message:
          "Duplicate branch code or multiple head office branches are not allowed",
      });
    }

    next(error);
  }
}

export async function getOrganizationsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 10);
    const search = String(req.query.search || "").trim();

    const result = await organizationsService.getAll({
      tenantId,
      page,
      limit,
      search,
    });

    res.status(200).json({
      message: "Organizations fetched successfully",
      ...result,
    });
  } catch (error) {
    next(error);
  }
}
