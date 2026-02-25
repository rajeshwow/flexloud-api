create table if not exists tenants (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id text primary key,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists user_tenants (
  user_id text not null references users(id),
  tenant_id text not null references tenants(id),
  roles text[] not null default '{}',
  primary key (user_id, tenant_id)
);

create table if not exists teams (
  id text primary key,
  tenant_id text not null references tenants(id),
  name text not null,
  manager_user_id text not null references users(id),
  created_at timestamptz not null default now()
);

create table if not exists team_members (
  team_id text not null references teams(id),
  user_id text not null references users(id),
  primary key (team_id, user_id)
);

create table if not exists lead_stage_definitions (
  id text primary key,
  tenant_id text not null references tenants(id),
  name text not null,
  order_index int not null,
  is_terminal boolean not null default false
);

create table if not exists leads (
  id text primary key,
  tenant_id text not null references tenants(id),
  title text not null,
  source text,
  status text not null default 'OPEN',
  owner_user_id text references users(id),
  current_stage_id text references lead_stage_definitions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_leads_tenant_owner on leads(tenant_id, owner_user_id);
create index if not exists idx_leads_tenant_updated on leads(tenant_id, updated_at);

create table if not exists lead_assignments (
  id text primary key,
  tenant_id text not null references tenants(id),
  lead_id text not null references leads(id),
  assigned_to text not null references users(id),
  assigned_by text not null references users(id),
  assigned_at timestamptz not null default now()
);

create table if not exists lead_stage_history (
  id text primary key,
  tenant_id text not null references tenants(id),
  lead_id text not null references leads(id),
  from_stage_id text references lead_stage_definitions(id),
  to_stage_id text not null references lead_stage_definitions(id),
  changed_by text not null references users(id),
  note text,
  changed_at timestamptz not null default now()
);

create table if not exists lead_activities (
  id text primary key,
  tenant_id text not null references tenants(id),
  lead_id text not null references leads(id),
  type text not null,
  body text not null,
  created_by text not null references users(id),
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id text primary key,
  tenant_id text not null references tenants(id),
  user_id text not null references users(id),
  title text not null,
  body text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user on notifications(tenant_id, user_id, created_at desc);

create table if not exists outbox (
  id text primary key,
  tenant_id text not null references tenants(id),
  type text not null,
  payload jsonb not null,
  processed boolean not null default false,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_outbox_unprocessed on outbox(processed, created_at);