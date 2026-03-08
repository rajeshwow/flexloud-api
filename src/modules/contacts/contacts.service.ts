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
