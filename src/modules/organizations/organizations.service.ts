import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";

type BranchInput = {
  id?: string;
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
  billing_city_id?: string | null;
  billing_state_id?: string | null;
  billing_country_id?: string | null;

  shipping_street?: string | null;
  shipping_area?: string | null;
  shipping_postal_code?: string | null;
  shipping_city_id?: string | null;
  shipping_state_id?: string | null;
  shipping_country_id?: string | null;

  is_shipping_same_as_billing?: boolean;
  status?: "active" | "inactive";
};
type CreateOrganizationInput = z.infer<typeof CreateOrganizationSchema> & {
  tenantId: string;
  createdBy: string | null;
  updatedBy: string | null;
};

type UpdateOrganizationInput = z.infer<typeof UpdateOrganizationSchema> & {
  tenantId: string;
  organizationId: string;
  updatedBy: string | null;
};

type GetAllOrganizationsInput = {
  tenantId: string;
  page: number;
  limit: number;
  search?: string;
};

const BranchSchema = z.object({
  id: z.string().uuid().optional(),
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
  billing_city_id: z.string().uuid().optional().nullable(),
  billing_state_id: z.string().uuid().optional().nullable(),
  billing_country_id: z.string().uuid().optional().nullable(),

  shipping_street: z.string().optional().nullable(),
  shipping_area: z.string().optional().nullable(),
  shipping_postal_code: z.string().optional().nullable(),
  shipping_city_id: z.string().uuid().optional().nullable(),
  shipping_state_id: z.string().uuid().optional().nullable(),
  shipping_country_id: z.string().uuid().optional().nullable(),

  is_shipping_same_as_billing: z.boolean().optional().default(false),
  status: z.enum(["active", "inactive"]).optional().default("active"),
});

const BaseOrganizationSchema = z
  .object({
    name: z.string().min(2, "Name is required"),
    gst_number: z.string().optional().nullable(),
    source: z.enum(["system", "tally"]).optional().default("system"),
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
        city_id: z.string().uuid().optional().nullable(),
        state_id: z.string().uuid().optional().nullable(),
        country_id: z.string().uuid().optional().nullable(),
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

    if (headOfficeCount === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "One head office branch is required",
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

const CreateOrganizationSchema = BaseOrganizationSchema;
const UpdateOrganizationSchema = BaseOrganizationSchema;

const IdParamSchema = z.object({
  id: z.string().uuid("Invalid organization id"),
});

function normalizeNullableString(value?: string | null) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

async function getOrganizationRowById(
  tenantId: string,
  organizationId: string,
) {
  const orgQuery = `
    SELECT
      o.id,
      o.tenant_id,
      o.name,
      o.gst_number,
      o.email,
      o.next_followup_at,
      o.type,
      o.industry,
      industry_mv.label AS industry_name,
      industry_mv.value AS industry_value,
      o.assigned_to,
      u.name AS assigned_to_name,
o.source,

      o.registered_street,
      o.registered_area,
      o.registered_postal_code,

      o.registered_country_id,
      reg_country.label AS registered_country_name,

      o.registered_state_id,
      reg_state.label AS registered_state_name,

      o.registered_city_id,
      reg_city.label AS registered_city_name,

      o.created_at,
      o.updated_at
    FROM organizations o
    LEFT JOIN users u
      ON u.id = o.assigned_to
    LEFT JOIN master_values industry_mv
      ON (
        industry_mv.id::text = o.industry
        OR industry_mv.value = o.industry
      )
      AND industry_mv.deleted_at IS NULL
    LEFT JOIN master_values reg_country
      ON reg_country.id = o.registered_country_id
      AND reg_country.deleted_at IS NULL
    LEFT JOIN master_values reg_state
      ON reg_state.id = o.registered_state_id
      AND reg_state.deleted_at IS NULL
    LEFT JOIN master_values reg_city
      ON reg_city.id = o.registered_city_id
      AND reg_city.deleted_at IS NULL
    WHERE o.tenant_id = $1
      AND o.id = $2
    LIMIT 1;
  `;

  const orgResult = await pool.query(orgQuery, [tenantId, organizationId]);
  return orgResult.rows[0] || null;
}

async function getOrganizationBranches(
  tenantId: string,
  organizationId: string,
) {
  const branchQuery = `
    SELECT
      ob.id,
      ob.tenant_id,
      ob.organization_id,
      ob.name,
      ob.code,
      ob.is_head_office,
      ob.contact_person,
      ob.phone,
      ob.email,
      ob.gst_number,
      ob.assigned_to,
      u.name AS assigned_to_name,

      ob.billing_street,
      ob.billing_area,
      ob.billing_postal_code,
      ob.billing_city_id,
      billing_city.label AS billing_city_name,
      ob.billing_state_id,
      billing_state.label AS billing_state_name,
      ob.billing_country_id,
      billing_country.label AS billing_country_name,

      ob.shipping_street,
      ob.shipping_area,
      ob.shipping_postal_code,
      ob.shipping_city_id,
      shipping_city.label AS shipping_city_name,
      ob.shipping_state_id,
      shipping_state.label AS shipping_state_name,
      ob.shipping_country_id,
      shipping_country.label AS shipping_country_name,

      ob.is_shipping_same_as_billing,
      ob.status,
      ob.created_at,
      ob.updated_at
    FROM organization_branches ob
    LEFT JOIN users u
      ON u.id = ob.assigned_to
    LEFT JOIN master_values billing_city
      ON billing_city.id = ob.billing_city_id
      AND billing_city.deleted_at IS NULL
    LEFT JOIN master_values billing_state
      ON billing_state.id = ob.billing_state_id
      AND billing_state.deleted_at IS NULL
    LEFT JOIN master_values billing_country
      ON billing_country.id = ob.billing_country_id
      AND billing_country.deleted_at IS NULL
    LEFT JOIN master_values shipping_city
      ON shipping_city.id = ob.shipping_city_id
      AND shipping_city.deleted_at IS NULL
    LEFT JOIN master_values shipping_state
      ON shipping_state.id = ob.shipping_state_id
      AND shipping_state.deleted_at IS NULL
    LEFT JOIN master_values shipping_country
      ON shipping_country.id = ob.shipping_country_id
      AND shipping_country.deleted_at IS NULL
    WHERE ob.tenant_id = $1
      AND ob.organization_id = $2
    ORDER BY ob.is_head_office DESC, ob.created_at ASC;
  `;

  const branchResult = await pool.query(branchQuery, [
    tenantId,
    organizationId,
  ]);
  return branchResult.rows;
}

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
          registered_city_id,
          registered_state_id,
          registered_country_id,
          source,
          created_by,
          updated_by
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14,$15, $16, $17
        )
        RETURNING *;
      `;

      const orgValues = [
        input.tenantId,
        input.name,
        normalizeNullableString(input.gst_number),
        normalizeNullableString(input.email),
        input.next_followup_at || null,
        normalizeNullableString(input.type),
        normalizeNullableString(input.industry),
        input.assigned_to || null,
        normalizeNullableString(input.registered_address?.street),
        normalizeNullableString(input.registered_address?.area),
        normalizeNullableString(input.registered_address?.postal_code),
        input.registered_address?.city_id || null,
        input.registered_address?.state_id || null,
        input.registered_address?.country_id || null,
        input.source || "system",
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
            billing_city_id,
            billing_state_id,
            billing_country_id,
            shipping_street,
            shipping_area,
            shipping_postal_code,
            shipping_city_id,
            shipping_state_id,
            shipping_country_id,
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
          normalizeNullableString(branch.code),
          branch.is_head_office ?? false,
          normalizeNullableString(branch.contact_person),
          normalizeNullableString(branch.phone),
          normalizeNullableString(branch.email),
          normalizeNullableString(branch.gst_number),
          branch.assigned_to || null,
          normalizeNullableString(branch.billing_street),
          normalizeNullableString(branch.billing_area),
          normalizeNullableString(branch.billing_postal_code),
          branch.billing_city_id || null,
          branch.billing_state_id || null,
          branch.billing_country_id || null,
          normalizeNullableString(branch.shipping_street),
          normalizeNullableString(branch.shipping_area),
          normalizeNullableString(branch.shipping_postal_code),
          branch.shipping_city_id || null,
          branch.shipping_state_id || null,
          branch.shipping_country_id || null,
          branch.is_shipping_same_as_billing ?? false,
          branch.status || "active",
          input.createdBy,
          input.updatedBy,
        ];

        const branchResult = await client.query(branchQuery, branchValues);
        createdBranches.push(branchResult.rows[0]);
      }

      await client.query("COMMIT");

      const fullOrganization = await this.getById(
        input.tenantId,
        organization.id,
      );

      return fullOrganization || { ...organization, branches: createdBranches };
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
        `(o.name ILIKE $2 OR o.email ILIKE $2 OR o.gst_number ILIKE $2)`,
      );
    }

    const whereClause = whereParts.join(" AND ");

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM organizations o
      WHERE ${whereClause};
    `;

    const countResult = await pool.query(countQuery, values);
    const total = countResult.rows[0]?.total || 0;

    const dataQuery = `
      SELECT
        o.id,
        o.tenant_id,
        o.name,
        o.gst_number,
        o.email,
        o.next_followup_at,
        o.type,
        o.industry,
        industry_mv.label AS industry_name,
        industry_mv.value AS industry_value,
        o.assigned_to,
        o.source,

        o.registered_street,
        o.registered_area,
        o.registered_postal_code,

        o.registered_country_id,
        reg_country.label AS registered_country_name,

        o.registered_state_id,
        reg_state.label AS registered_state_name,

        o.registered_city_id,
        reg_city.label AS registered_city_name,

        o.created_at,
        o.updated_at,

        u.name AS assigned_to_name,

        COALESCE(b.branch_count, 0) AS branch_count,
        b.head_office_name,
        b.head_office,

COALESCE(b.branches, '[]'::jsonb) AS branches
      FROM organizations o
      LEFT JOIN users u
        ON u.id = o.assigned_to

      LEFT JOIN master_values industry_mv
        ON (
          industry_mv.id::text = o.industry
          OR industry_mv.value = o.industry
        )
        AND industry_mv.deleted_at IS NULL

      LEFT JOIN master_values reg_country
        ON reg_country.id = o.registered_country_id
        AND reg_country.deleted_at IS NULL

      LEFT JOIN master_values reg_state
        ON reg_state.id = o.registered_state_id
        AND reg_state.deleted_at IS NULL

      LEFT JOIN master_values reg_city
        ON reg_city.id = o.registered_city_id
        AND reg_city.deleted_at IS NULL

      LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::int AS branch_count,

    MAX(CASE WHEN ob.is_head_office = true THEN ob.name END) AS head_office_name,

    jsonb_agg(
      jsonb_build_object(
        'id', ob.id,
        'tenant_id', ob.tenant_id,
        'organization_id', ob.organization_id,
        'name', ob.name,
        'code', ob.code,
        'is_head_office', ob.is_head_office,
        'contact_person', ob.contact_person,
        'phone', ob.phone,
        'email', ob.email,
        'gst_number', ob.gst_number,
        'assigned_to', ob.assigned_to,

        'billing_street', ob.billing_street,
        'billing_area', ob.billing_area,
        'billing_postal_code', ob.billing_postal_code,
        'billing_city_id', ob.billing_city_id,
        'billing_city', billing_city.label,
        'billing_city_name', billing_city.label,
        'billing_state_id', ob.billing_state_id,
        'billing_state', billing_state.label,
        'billing_state_name', billing_state.label,
        'billing_country_id', ob.billing_country_id,
        'billing_country', billing_country.label,
        'billing_country_name', billing_country.label,

        'shipping_street', ob.shipping_street,
        'shipping_area', ob.shipping_area,
        'shipping_postal_code', ob.shipping_postal_code,
        'shipping_city_id', ob.shipping_city_id,
        'shipping_city', shipping_city.label,
        'shipping_city_name', shipping_city.label,
        'shipping_state_id', ob.shipping_state_id,
        'shipping_state', shipping_state.label,
        'shipping_state_name', shipping_state.label,
        'shipping_country_id', ob.shipping_country_id,
        'shipping_country', shipping_country.label,
        'shipping_country_name', shipping_country.label,

        'is_shipping_same_as_billing', ob.is_shipping_same_as_billing,
        'status', ob.status
      )
      ORDER BY ob.is_head_office DESC, ob.created_at ASC
    ) AS branches,

    (
      SELECT jsonb_build_object(
        'id', hob.id,
        'tenant_id', hob.tenant_id,
        'organization_id', hob.organization_id,
        'name', hob.name,
        'code', hob.code,
        'is_head_office', hob.is_head_office,
        'contact_person', hob.contact_person,
        'phone', hob.phone,
        'email', hob.email,
        'gst_number', hob.gst_number,
        'assigned_to', hob.assigned_to,

        'billing_street', hob.billing_street,
        'billing_area', hob.billing_area,
        'billing_postal_code', hob.billing_postal_code,
        'billing_city_id', hob.billing_city_id,
        'billing_city', h_billing_city.label,
        'billing_city_name', h_billing_city.label,
        'billing_state_id', hob.billing_state_id,
        'billing_state', h_billing_state.label,
        'billing_state_name', h_billing_state.label,
        'billing_country_id', hob.billing_country_id,
        'billing_country', h_billing_country.label,
        'billing_country_name', h_billing_country.label,

        'shipping_street', hob.shipping_street,
        'shipping_area', hob.shipping_area,
        'shipping_postal_code', hob.shipping_postal_code,
        'shipping_city_id', hob.shipping_city_id,
        'shipping_city', h_shipping_city.label,
        'shipping_city_name', h_shipping_city.label,
        'shipping_state_id', hob.shipping_state_id,
        'shipping_state', h_shipping_state.label,
        'shipping_state_name', h_shipping_state.label,
        'shipping_country_id', hob.shipping_country_id,
        'shipping_country', h_shipping_country.label,
        'shipping_country_name', h_shipping_country.label,

        'is_shipping_same_as_billing', hob.is_shipping_same_as_billing,
        'status', hob.status
      )
      FROM organization_branches hob
      LEFT JOIN master_values h_billing_city
        ON h_billing_city.id = hob.billing_city_id
        AND h_billing_city.deleted_at IS NULL
      LEFT JOIN master_values h_billing_state
        ON h_billing_state.id = hob.billing_state_id
        AND h_billing_state.deleted_at IS NULL
      LEFT JOIN master_values h_billing_country
        ON h_billing_country.id = hob.billing_country_id
        AND h_billing_country.deleted_at IS NULL
      LEFT JOIN master_values h_shipping_city
        ON h_shipping_city.id = hob.shipping_city_id
        AND h_shipping_city.deleted_at IS NULL
      LEFT JOIN master_values h_shipping_state
        ON h_shipping_state.id = hob.shipping_state_id
        AND h_shipping_state.deleted_at IS NULL
      LEFT JOIN master_values h_shipping_country
        ON h_shipping_country.id = hob.shipping_country_id
        AND h_shipping_country.deleted_at IS NULL
      WHERE hob.tenant_id = o.tenant_id
        AND hob.organization_id = o.id
      ORDER BY hob.is_head_office DESC, hob.created_at ASC
      LIMIT 1
    ) AS head_office

  FROM organization_branches ob

  LEFT JOIN master_values billing_city
    ON billing_city.id = ob.billing_city_id
    AND billing_city.deleted_at IS NULL
  LEFT JOIN master_values billing_state
    ON billing_state.id = ob.billing_state_id
    AND billing_state.deleted_at IS NULL
  LEFT JOIN master_values billing_country
    ON billing_country.id = ob.billing_country_id
    AND billing_country.deleted_at IS NULL

  LEFT JOIN master_values shipping_city
    ON shipping_city.id = ob.shipping_city_id
    AND shipping_city.deleted_at IS NULL
  LEFT JOIN master_values shipping_state
    ON shipping_state.id = ob.shipping_state_id
    AND shipping_state.deleted_at IS NULL
  LEFT JOIN master_values shipping_country
    ON shipping_country.id = ob.shipping_country_id
    AND shipping_country.deleted_at IS NULL

  WHERE ob.tenant_id = o.tenant_id
    AND ob.organization_id = o.id
) b ON true

      WHERE ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2};
    `;

    const dataResult = await pool.query(dataQuery, [...values, limit, offset]);

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

  async getById(tenantId: string, organizationId: string) {
    const organization = await getOrganizationRowById(tenantId, organizationId);

    if (!organization) return null;

    const branches = await getOrganizationBranches(tenantId, organizationId);

    return {
      ...organization,
      branch_count: branches.length,
      head_office_name:
        branches.find((branch) => branch.is_head_office)?.name || null,
      branches,
    };
  },

  async update(input: UpdateOrganizationInput) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existingOrgResult = await client.query(
        `
          SELECT id
          FROM organizations
          WHERE tenant_id = $1
            AND id = $2
          LIMIT 1
        `,
        [input.tenantId, input.organizationId],
      );

      if (!existingOrgResult.rowCount) {
        throw Object.assign(new Error("Organization not found"), {
          statusCode: 404,
        });
      }

      const updateOrgQuery = `
        UPDATE organizations
        SET
          name = $3,
          gst_number = $4,
          email = $5,
          next_followup_at = $6,
          type = $7,
          industry = $8,
          assigned_to = $9,
          registered_street = $10,
          registered_area = $11,
          registered_postal_code = $12,
          registered_city_id = $13,
          registered_state_id = $14,
          registered_country_id = $15,
          updated_by = $16,
          source = $17,
          updated_at = NOW()
        WHERE tenant_id = $1
          AND id = $2
        RETURNING *;
      `;

      await client.query(updateOrgQuery, [
        input.tenantId, // $1
        input.organizationId, // $2
        input.name, // $3
        normalizeNullableString(input.gst_number), // $4
        normalizeNullableString(input.email), // $5
        input.next_followup_at || null, // $6
        normalizeNullableString(input.type), // $7
        normalizeNullableString(input.industry), // $8
        input.assigned_to || null, // $9
        normalizeNullableString(input.registered_address?.street), // $10
        normalizeNullableString(input.registered_address?.area), // $11
        normalizeNullableString(input.registered_address?.postal_code), // $12
        input.registered_address?.city_id || null, // $13
        input.registered_address?.state_id || null, // $14
        input.registered_address?.country_id || null, // $15
        input.updatedBy, // $16
        input.source || "system", // $17
      ]);

      await client.query(
        `
          DELETE FROM organization_branches
          WHERE tenant_id = $1
            AND organization_id = $2
        `,
        [input.tenantId, input.organizationId],
      );

      for (const branch of input.branches) {
        await client.query(
          `
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
              billing_city_id,
              billing_state_id,
              billing_country_id,
              shipping_street,
              shipping_area,
              shipping_postal_code,
              shipping_city_id,
              shipping_state_id,
              shipping_country_id,
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
          `,
          [
            input.tenantId,
            input.organizationId,
            branch.name,
            normalizeNullableString(branch.code),
            branch.is_head_office ?? false,
            normalizeNullableString(branch.contact_person),
            normalizeNullableString(branch.phone),
            normalizeNullableString(branch.email),
            normalizeNullableString(branch.gst_number),
            branch.assigned_to || null,
            normalizeNullableString(branch.billing_street),
            normalizeNullableString(branch.billing_area),
            normalizeNullableString(branch.billing_postal_code),
            branch.billing_city_id || null,
            branch.billing_state_id || null,
            branch.billing_country_id || null,
            normalizeNullableString(branch.shipping_street),
            normalizeNullableString(branch.shipping_area),
            normalizeNullableString(branch.shipping_postal_code),
            branch.shipping_city_id || null,
            branch.shipping_state_id || null,
            branch.shipping_country_id || null,
            branch.is_shipping_same_as_billing ?? false,
            branch.status || "active",
            input.updatedBy,
            input.updatedBy,
          ],
        );
      }

      await client.query("COMMIT");

      return await this.getById(input.tenantId, input.organizationId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
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
    const updatedBy = req.user?.sub || null;

    const parsed = CreateOrganizationSchema.parse(req.body);

    const result = await organizationsService.create({
      tenantId: tenantId,
      createdBy: createdBy,
      updatedBy: updatedBy,
      ...parsed,
    });

    return res.status(201).json({
      success: true,
      message: "Organization created successfully",
      data: result,
    });
  } catch (error) {
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
    const search = String(req.query.search || "");

    const result = await organizationsService.getAll({
      tenantId,
      page,
      limit,
      search,
    });

    return res.status(200).json({
      success: true,
      message: "Organizations fetched successfully",
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

export async function getOrganizationByIdHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const { id } = IdParamSchema.parse(req.params);

    const result = await organizationsService.getById(tenantId, id);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Organization fetched successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateOrganizationHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const updatedBy = req.user?.sub || null;
    const { id } = IdParamSchema.parse(req.params);
    const parsed = UpdateOrganizationSchema.parse(req.body);

    const result = await organizationsService.update({
      tenantId,
      organizationId: id,
      updatedBy,
      ...parsed,
    });

    return res.status(200).json({
      success: true,
      message: "Organization updated successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}
