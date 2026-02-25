import { randomUUID } from "crypto";
import { z } from "zod";
import { pool } from "../../db/pool";

type CreateTenantInput = {
  name: string;
  slug: string;
};

export async function createTenant(input: CreateTenantInput) {
  const tenantId = randomUUID();

  const client = await pool.connect();
  try {
    const q = `
      INSERT INTO tenants (id, name, slug)
      VALUES ($1, $2, $3)
      RETURNING id, name, slug, created_at
    `;
    const { rows } = await client.query(q, [tenantId, input.name, input.slug]);
    return rows[0];
  } catch (e: any) {
    // slug unique conflict
    if (e?.code === "23505") {
      throw Object.assign(new Error("Tenant slug already exists"), {
        statusCode: 409,
      });
    }
    throw e;
  } finally {
    client.release();
  }
}

const BootstrapInputSchema = z.object({
  tenantId: z.string().min(5),
  adminEmail: z.string().email(),
  adminName: z.string().min(2),
  adminSub: z.string().min(3).optional(),
});

export async function bootstrapTenant(
  input: z.infer<typeof BootstrapInputSchema>,
) {
  const data = BootstrapInputSchema.parse(input);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) Ensure tenant exists
    const tenantRes = await client.query(
      `SELECT id, slug, name FROM tenants WHERE id = $1`,
      [data.tenantId],
    );
    if (tenantRes.rowCount === 0) {
      throw Object.assign(new Error("Tenant not found"), { statusCode: 404 });
    }

    // 2) Create admin user (idempotent)
    //    If user exists, keep it.
    const adminUserId = randomUUID();

    const userInsert = await client.query(
      `
      INSERT INTO users (id, tenant_id, email, name, role, identity_sub)
      VALUES ($1, $2, $3, $4, 'ADMIN', $5)
      ON CONFLICT (tenant_id, email)
      DO UPDATE SET name = EXCLUDED.name
      RETURNING id, email, name, role
      `,
      [
        adminUserId,
        data.tenantId,
        data.adminEmail,
        data.adminName,
        data.adminSub ?? null,
      ],
    );

    const adminUser = userInsert.rows[0];

    // 3) Create default team (optional but useful)
    const teamId = randomUUID();
    const teamRes = await client.query(
      `
      INSERT INTO teams (id, tenant_id, name)
      VALUES ($1, $2, 'Default Team')
      ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, name
      `,
      [teamId, data.tenantId],
    );
    const team = teamRes.rows[0];

    // 4) Add admin to team (idempotent)
    await client.query(
      `
      INSERT INTO team_members (team_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      `,
      [team.id, adminUser.id],
    );

    // 5) Default stages (idempotent)
    //    Only insert if tenant has zero stages.
    const stageCount = await client.query(
      `SELECT COUNT(1)::int AS c FROM stages WHERE tenant_id = $1`,
      [data.tenantId],
    );

    if (stageCount.rows[0].c === 0) {
      const stages = [
        { name: "New", position: 1, terminal: false, terminal_type: null },
        {
          name: "Contacted",
          position: 2,
          terminal: false,
          terminal_type: null,
        },
        {
          name: "Qualified",
          position: 3,
          terminal: false,
          terminal_type: null,
        },
        {
          name: "Won",
          position: 4,
          terminal: true,
          terminal_type: "WON" as const,
        },
        {
          name: "Lost",
          position: 5,
          terminal: true,
          terminal_type: "LOST" as const,
        },
      ];

      for (const s of stages) {
        await client.query(
          `
          INSERT INTO stages (id, tenant_id, name, position, is_terminal, terminal_type)
          VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            randomUUID(),
            data.tenantId,
            s.name,
            s.position,
            s.terminal,
            s.terminal_type,
          ],
        );
      }
    }

    await client.query("COMMIT");

    return {
      tenant: tenantRes.rows[0],
      adminUser,
      team,
      stagesCreated: stageCount.rows[0].c === 0,
    };
  } catch (e: any) {
    await client.query("ROLLBACK");
    if (e?.statusCode) throw e;
    throw e;
  } finally {
    client.release();
  }
}
