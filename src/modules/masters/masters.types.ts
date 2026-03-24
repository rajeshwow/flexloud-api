export type MasterTypeItem = {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  description: string | null;
  module_name: string | null;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type MasterValueItem = {
  id: string;
  tenant_id: string;
  master_type_id: string;
  label: string;
  value: string;
  description: string | null;
  color: string | null;
  parent_id: string | null;
  is_default: boolean;
  is_system: boolean;
  is_active: boolean;
  sort_order: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
