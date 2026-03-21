export function mapContactRowForInsert(
  row: Record<string, any>,
  ctx: { tenantId: string; userId: string },
) {
  return {
    tenant_id: ctx.tenantId,
    organization_id: row.organization_id || null,
    assigned_to: row.assigned_to || ctx.userId,

    first_name: row.first_name || null,
    last_name: row.last_name || null,
    email: row.email || null,
    mobile: row.mobile || null,
    city: row.city || null,
    state: row.state || null,
    country: row.country || null,

    created_by: ctx.userId,
    updated_by: ctx.userId,
  };
}

export function mapContactRowForUpdate(
  row: Record<string, any>,
  ctx: { userId: string },
) {
  return {
    organization_id: row.organization_id || null,
    assigned_to: row.assigned_to || ctx.userId,

    first_name: row.first_name || null,
    last_name: row.last_name || null,
    email: row.email || null,
    mobile: row.mobile || null,
    city: row.city || null,
    state: row.state || null,
    country: row.country || null,

    updated_by: ctx.userId,
    updated_at: new Date(),
  };
}
