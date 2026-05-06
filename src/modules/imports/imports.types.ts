export type ImportModule = "contacts" | "leads";

export type ImportFieldType =
  | "string"
  | "email"
  | "mobile"
  | "phone"
  | "number"
  | "date"
  | "boolean"
  | "enum";

export type DuplicateMode = "skip" | "update" | "allow";

export type ImportFieldConfig = {
  key: string;
  label: string;
  required?: boolean;
  type: ImportFieldType;
  maxLength?: number;
  enumValues?: string[];
  sampleValue?: string | number | boolean;
};

export type ImportRowError = {
  rowNumber: number;
  field?: string;
  message: string;
  rawData?: Record<string, any>;
};

export type ParsedImportRow = {
  rowNumber: number;
  raw: Record<string, any>;
  normalized: Record<string, any>;
};

export type ValidatedImportRow = {
  rowNumber: number;
  raw: Record<string, any>;
  data: Record<string, any>;
};

export type ImportModuleConfig = {
  module: ImportModule;
  label: string;
  tableName: string;
  sampleFileName: string;
  fields: ImportFieldConfig[];
  uniqueBy?: string[];
  requiredAtLeastOneOf?: string[];
  mapRowForInsert: (
    row: Record<string, any>,
    ctx: { tenantId: string; userId: string },
  ) => Record<string, any>;
  buildUpdateSet?: (
    row: Record<string, any>,
    ctx: { tenantId: string; userId: string },
  ) => Record<string, any>;
};
