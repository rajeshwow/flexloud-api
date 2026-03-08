import { pool } from "../../db/pool";

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

  billing_street: string;
  billing_area: string;
  billing_postal_code: string;
  billing_city: string;
  billing_state: string;
  billing_country: string;

  shipping_street?: string | null;
  shipping_area?: string | null;
  shipping_postal_code?: string | null;
  shipping_city?: string | null;
  shipping_state?: string | null;
  shipping_country?: string | null;

  is_shipping_same_as_billing?: boolean;
};

type GetAllOrganizationsInput = {
  tenantId: string;
  page: number;
  limit: number;
  search?: string;
};

export const organizationsService = {
  async create(input: CreateOrganizationInput) {
    const query = `
      INSERT INTO organizations (
        tenant_id,
        name,
        gst_number,
        email,
        next_followup_at,
        type,
        industry,
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
        created_by,
        updated_by
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20,
        $21, $22, $23
      )
      RETURNING *;
    `;

    const values = [
      input.tenantId,
      input.name,
      input.gst_number || null,
      input.email || null,
      input.next_followup_at || null,
      input.type || null,
      input.industry || null,
      input.assigned_to || null,

      input.billing_street,
      input.billing_area,
      input.billing_postal_code,
      input.billing_city,
      input.billing_state,
      input.billing_country,

      input.shipping_street || null,
      input.shipping_area || null,
      input.shipping_postal_code || null,
      input.shipping_city || null,
      input.shipping_state || null,
      input.shipping_country || null,

      input.is_shipping_same_as_billing ?? false,
      input.createdBy,
      input.updatedBy,
    ];

    const { rows } = await pool.query(query, values);
    return rows[0];
  },
  async getAll(input: GetAllOrganizationsInput) {
    const page = input.page > 0 ? input.page : 1;
    const limit = input.limit > 0 ? input.limit : 10;
    const offset = (page - 1) * limit;
    const search = input.search?.trim() || "";

    const whereParts = [`o.tenant_id = $1`];
    const values: any[] = [input.tenantId];

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
          u.name AS assigned_to_name
        FROM organizations o
        LEFT JOIN users u ON u.id = o.assigned_to
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
