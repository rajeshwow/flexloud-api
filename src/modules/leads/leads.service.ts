import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";
import { createActivityLog } from "../activity/activity.service";
import {
  CreateLeadSchema,
  GetLeadsSchema,
  UpdateLeadSchema,
} from "./leads.schema";

type CreateLeadInput = {
  tenantId: string;
  createdBy: string | null;
  updatedBy: string | null;
  lead_number?: string | null;

  first_name: string;
  last_name?: string | null;
  designation?: string | null;
  industry?: string | null;
  emails?:
    | {
        email: string;
        primary?: boolean;
        opt_out?: boolean;
        invalid?: boolean;
      }[]
    | null;

  mobile: string;
  office_phone?: string | null;

  organization_name?: string | null;
  dealer_organization?: string | null;

  status?: string;
  product_category: string;
  priority: string;

  requirements?: string | null;

  next_followup?: string | null;
  followup?: string | null;
  followup_type?: string | null;
  lead_source?: string | null;

  add_description?: string | null;
  description?: string | null;
  referred_by?: string | null;

  assigned_to?: string | null;

  opportunity_name?: string | null;
  opportunity_amount?: number | null;
  expected_close_date?: string | null;
  sales_stage?: string | null;

  primary_address_street?: string | null;
  primary_address_area?: string | null;
  primary_address_postal_code?: string | null;
  primary_address_city?: string | null;
  primary_address_state?: string | null;
  primary_address_country?: string | null;

  alternate_address_street?: string | null;
  alternate_address_area?: string | null;
  alternate_address_postal_code?: string | null;
  alternate_address_city?: string | null;
  alternate_address_state?: string | null;
  alternate_address_country?: string | null;
};

type UpdateLeadInput = Partial<CreateLeadInput> & {
  tenantId: string;
  leadId: string;
  updatedBy: string | null;
};

type GetAllLeadsInput = {
  tenantId: string;
  page: number;
  limit: number;
  search?: string;
  status?: string;
  assigned_to?: string;
};

function generateLeadNumber() {
  const stamp = Date.now().toString().slice(-6);
  return `LEAD-${stamp}`;
}

export const leadsService = {
  async create(input: CreateLeadInput) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const leadId = randomUUID();
      const leadNumber = input.lead_number || generateLeadNumber();

      const query = `
        INSERT INTO leads (
          id,
          tenant_id,
          lead_number,
          first_name,
          last_name,
          designation,
          industry,
          mobile,
          office_phone,
          organization_name,
          emails,
          dealer_organization,
          status,
          product_category,
          priority,
          requirements,
          next_followup,
          followup,
          followup_type,
          lead_source,
          add_description,
          description,
          referred_by,
          assigned_to,
          opportunity_name,
          opportunity_amount,
          expected_close_date,
          sales_stage,
          primary_address_street,
          primary_address_area,
          primary_address_postalcode,
          primary_address_city,
          primary_address_state,
          primary_address_country,
          alt_address_street,
          alt_address_area,
          alt_address_postalcode,
          alt_address_city,
          alt_address_state,
          alt_address_country,
          created_by,
          updated_by
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
          $31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42
        )
        RETURNING *;
      `;

      const values = [
        leadId,
        input.tenantId,
        leadNumber,
        input.first_name,
        input.last_name ?? null,
        input.designation ?? null,
        input.industry ?? null,
        input.mobile,
        input.office_phone ?? null,
        input.organization_name ?? null,
        input.emails ? JSON.stringify(input.emails) : null,
        input.dealer_organization ?? null,
        input.status ?? "new",
        input.product_category,
        input.priority,
        input.requirements ?? null,
        input.next_followup ?? null,
        input.followup ?? null,
        input.followup_type ?? null,
        input.lead_source ?? null,
        input.add_description ?? null,
        input.description ?? null,
        input.referred_by ?? null,
        input.assigned_to ?? null,
        input.opportunity_name ?? null,
        input.opportunity_amount ?? null,
        input.expected_close_date ?? null,
        input.sales_stage ?? null,
        input.primary_address_street ?? null,
        input.primary_address_area ?? null,
        input.primary_address_postal_code ?? null,
        input.primary_address_city ?? null,
        input.primary_address_state ?? null,
        input.primary_address_country ?? null,
        input.alternate_address_street ?? null,
        input.alternate_address_area ?? null,
        input.alternate_address_postal_code ?? null,
        input.alternate_address_city ?? null,
        input.alternate_address_state ?? null,
        input.alternate_address_country ?? null,
        input.createdBy,
        input.updatedBy,
      ];

      const result = await client.query(query, values);
      const newLead = result.rows[0];

      await createActivityLog(
        {
          tenantId: input.tenantId,
          entityType: "lead",
          entityId: newLead.id,
          actionType: "created",
          title: "Lead created",
          description: `Lead ${newLead.first_name ?? ""} ${newLead.last_name ?? ""} created`,
          metadata: {
            lead_number: newLead.lead_number,
            status: newLead.status,
          },
          createdById: input.createdBy,
        },
        client,
      );

      await client.query("COMMIT");
      return newLead;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async getAll(input: GetAllLeadsInput) {
    const page = input.page > 0 ? input.page : 1;
    const limit = input.limit > 0 ? input.limit : 10;
    const offset = (page - 1) * limit;

    let whereClause = `WHERE l.tenant_id = $1 AND l.deleted_at IS NULL`;
    const values: Array<string | number> = [input.tenantId];
    let idx = values.length + 1;

    if (input.search?.trim()) {
      whereClause += `
      AND (
        l.first_name ILIKE $${idx}
        OR l.last_name ILIKE $${idx}
        OR l.mobile ILIKE $${idx}
        OR l.lead_number ILIKE $${idx}
        OR l.organization_name ILIKE $${idx}
      )
    `;
      values.push(`%${input.search.trim()}%`);
      idx++;
    }

    if (input.status) {
      whereClause += ` AND l.status = $${idx}`;
      values.push(input.status);
      idx++;
    }

    if (input.assigned_to) {
      whereClause += ` AND l.assigned_to = $${idx}`;
      values.push(input.assigned_to);
      idx++;
    }

    const listQuery = `
      SELECT
        l.*,
        TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS assigned_to_name
      FROM leads l
      LEFT JOIN users u ON u.id = l.assigned_to
      ${whereClause}
      ORDER BY l.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1};
    `;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM leads l
      ${whereClause};
    `;

    const listValues = [...values, limit, offset];

    const [listResult, countResult] = await Promise.all([
      pool.query(listQuery, listValues),
      pool.query(countQuery, values),
    ]);

    const total = countResult.rows[0]?.total ?? 0;

    return {
      data: listResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async getById(tenantId: string, leadId: string) {
    const query = `
      SELECT
        l.*,
        TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS assigned_to_name
      FROM leads l
      LEFT JOIN users u ON u.id = l.assigned_to
      WHERE l.id = $1
        AND l.tenant_id = $2
        AND l.deleted_at IS NULL
      LIMIT 1;
    `;

    const result = await pool.query(query, [leadId, tenantId]);
    return result.rows[0] || null;
  },

  async update(input: UpdateLeadInput) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const fields: string[] = [];
      const values: Array<string | number | null | object> = [];
      let idx = 1;

      const payload: Record<string, unknown> = {
        lead_number: input.lead_number,
        first_name: input.first_name,
        last_name: input.last_name,
        designation: input.designation,
        industry: input.industry,
        mobile: input.mobile,
        office_phone: input.office_phone,
        organization_name: input.organization_name,
        emails: input.emails ? JSON.stringify(input.emails) : input.emails,
        dealer_organization: input.dealer_organization,
        status: input.status,
        product_category: input.product_category,
        priority: input.priority,
        requirements: input.requirements,
        next_followup: input.next_followup,
        followup: input.followup,
        followup_type: input.followup_type,
        lead_source: input.lead_source,
        add_description: input.add_description,
        description: input.description,
        referred_by: input.referred_by,
        assigned_to: input.assigned_to,
        opportunity_name: input.opportunity_name,
        opportunity_amount: input.opportunity_amount,
        expected_close_date: input.expected_close_date,
        sales_stage: input.sales_stage,
        primary_address_street: input.primary_address_street,
        primary_address_area: input.primary_address_area,
        primary_address_postalcode: input.primary_address_postal_code,
        primary_address_city: input.primary_address_city,
        primary_address_state: input.primary_address_state,
        primary_address_country: input.primary_address_country,
        alt_address_street: input.alternate_address_street,
        alt_address_area: input.alternate_address_area,
        alt_address_postalcode: input.alternate_address_postal_code,
        alt_address_city: input.alternate_address_city,
        alt_address_state: input.alternate_address_state,
        alt_address_country: input.alternate_address_country,
        updated_by: input.updatedBy,
      };

      Object.entries(payload).forEach(([key, value]) => {
        if (value !== undefined) {
          fields.push(`${key} = $${idx}`);
          values.push(value as string | number | null | object);
          idx++;
        }
      });

      fields.push(`updated_at = NOW()`);

      const query = `
        UPDATE leads
        SET ${fields.join(", ")}
        WHERE id = $${idx}
          AND tenant_id = $${idx + 1}
          AND deleted_at IS NULL
        RETURNING *;
      `;

      values.push(input.leadId, input.tenantId);

      const result = await client.query(query, values);
      const updatedLead = result.rows[0] || null;

      if (!updatedLead) {
        await client.query("ROLLBACK");
        return null;
      }

      await createActivityLog(
        {
          tenantId: input.tenantId,
          entityType: "lead",
          entityId: input.leadId,
          actionType: "updated",
          title: "Lead updated",
          description: "Lead details updated",
          metadata: {
            updated_fields: Object.keys(payload).filter(
              (key) => payload[key] !== undefined,
            ),
          },
          createdById: input.updatedBy,
        },
        client,
      );

      await client.query("COMMIT");
      return updatedLead;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async remove(tenantId: string, leadId: string) {
    const query = `
      UPDATE leads
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1
        AND tenant_id = $2
        AND deleted_at IS NULL
      RETURNING id;
    `;

    const result = await pool.query(query, [leadId, tenantId]);
    return result.rows[0] || null;
  },
};

export async function createLeadHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.sub || null;
    const body = CreateLeadSchema.parse(req.body);

    const lead = await leadsService.create({
      tenantId,
      lead_number: body.lead_number,
      createdBy: userId,
      updatedBy: userId,
      ...body,
    });

    return res.status(201).json({
      message: "Lead created successfully",
      data: lead,
    });
  } catch (error) {
    next(error);
  }
}

export async function getLeadsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const query = GetLeadsSchema.parse(req.query);

    const result = await leadsService.getAll({
      tenantId,
      page: query.page,
      limit: query.limit,
      search: query.search,
      status: query.status,
      assigned_to: query.assigned_to,
    });

    return res.status(200).json({
      message: "Leads fetched successfully",
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

export async function getLeadByIdHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const leadId = z.string().uuid().parse(req.params.id);

    const lead = await leadsService.getById(tenantId, leadId);

    if (!lead) {
      return res.status(404).json({
        message: "Lead not found",
      });
    }

    return res.status(200).json({
      message: "Lead fetched successfully",
      data: lead,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateLeadHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.sub || null;
    const leadId = z.string().uuid().parse(req.params.id);
    const body = UpdateLeadSchema.parse(req.body);

    const updatedLead = await leadsService.update({
      tenantId,
      leadId,
      updatedBy: userId,
      ...body,
    });

    if (!updatedLead) {
      return res.status(404).json({
        message: "Lead not found",
      });
    }

    return res.status(200).json({
      message: "Lead updated successfully",
      data: updatedLead,
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteLeadHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const leadId = z.string().uuid().parse(req.params.id);

    const deleted = await leadsService.remove(tenantId, leadId);

    if (!deleted) {
      return res.status(404).json({
        message: "Lead not found",
      });
    }

    return res.status(200).json({
      message: "Lead deleted successfully",
    });
  } catch (error) {
    next(error);
  }
}
