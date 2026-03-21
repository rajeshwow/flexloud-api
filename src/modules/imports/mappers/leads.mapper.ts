function removeUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function toLeadEmailsJson(value: any) {
  if (!value) return undefined;

  const emails = Array.isArray(value)
    ? value
    : String(value)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

  return emails.map((email, index) => ({
    email,
    invalid: false,
    opt_out: false,
    primary: index === 0,
  }));
}

function toJsonEmailArray(value: any) {
  if (!value) return undefined;

  if (Array.isArray(value)) return value;

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function mapLeadRowForInsert(
  row: Record<string, any>,
  ctx: { tenantId: string; userId: string },
) {
  return removeUndefined({
    tenant_id: ctx.tenantId,
    lead_number: row.lead_number,
    first_name: row.first_name,
    last_name: row.last_name,
    designation: row.designation,
    industry: row.industry,
    mobile: row.mobile,
    office_phone: row.office_phone,
    organization_name: row.organization_name,
    emails: toLeadEmailsJson(row.emails),
    dealer_organization: row.dealer_organization,
    priority: row.priority,
    status: row.status ?? "new",
    product_category: row.product_category,
    requirements: row.requirements,
    next_followup: row.next_followup,
    followup: row.followup,
    followup_type: row.followup_type,
    lead_source: row.lead_source,
    add_description: row.add_description,
    description: row.description,
    assigned_to: row.assigned_to,
    referred_by: row.referred_by,
    opportunity_name: row.opportunity_name,
    opportunity_amount: row.opportunity_amount,
    expected_close_date: row.expected_close_date,
    sales_stage: row.sales_stage,
    primary_address_street: row.primary_address_street,
    primary_address_area: row.primary_address_area,
    primary_address_postalcode: row.primary_address_postalcode,
    primary_address_city: row.primary_address_city,
    primary_address_state: row.primary_address_state,
    primary_address_country: row.primary_address_country,
    alt_address_street: row.alt_address_street,
    alt_address_area: row.alt_address_area,
    alt_address_postalcode: row.alt_address_postalcode,
    alt_address_city: row.alt_address_city,
    alt_address_state: row.alt_address_state,
    alt_address_country: row.alt_address_country,
    created_by: ctx.userId,
    updated_by: ctx.userId,
  });
}

export function mapLeadRowForUpdate(
  row: Record<string, any>,
  ctx: { userId: string },
) {
  return removeUndefined({
    lead_number: row.lead_number,
    first_name: row.first_name,
    last_name: row.last_name,
    designation: row.designation,
    industry: row.industry,
    mobile: row.mobile,
    office_phone: row.office_phone,
    organization_name: row.organization_name,
    emails: toLeadEmailsJson(row.emails),
    dealer_organization: row.dealer_organization,
    priority: row.priority,
    status: row.status ?? "new",
    product_category: row.product_category,
    requirements: row.requirements,
    next_followup: row.next_followup,
    followup: row.followup,
    followup_type: row.followup_type,
    lead_source: row.lead_source,
    add_description: row.add_description,
    description: row.description,
    assigned_to: row.assigned_to,
    referred_by: row.referred_by,
    opportunity_name: row.opportunity_name,
    opportunity_amount: row.opportunity_amount,
    expected_close_date: row.expected_close_date,
    sales_stage: row.sales_stage,
    primary_address_street: row.primary_address_street,
    primary_address_area: row.primary_address_area,
    primary_address_postalcode: row.primary_address_postalcode,
    primary_address_city: row.primary_address_city,
    primary_address_state: row.primary_address_state,
    primary_address_country: row.primary_address_country,
    alt_address_street: row.alt_address_street,
    alt_address_area: row.alt_address_area,
    alt_address_postalcode: row.alt_address_postalcode,
    alt_address_city: row.alt_address_city,
    alt_address_state: row.alt_address_state,
    alt_address_country: row.alt_address_country,
    updated_by: ctx.userId,
    updated_at: new Date(),
  });
}
