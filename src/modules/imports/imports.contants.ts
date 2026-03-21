import { contactsImportConfig } from "./import-config/contacts.config";
import { leadsImportConfig } from "./import-config/leads.config";
import type { ImportModule, ImportModuleConfig } from "./imports.types";

export const IMPORT_MODULES: Record<ImportModule, ImportModuleConfig> = {
  contacts: contactsImportConfig,
  leads: leadsImportConfig,
};

export const ALLOWED_IMPORT_MODULES = Object.keys(
  IMPORT_MODULES,
) as ImportModule[];

export const MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_IMPORT_ROWS = 5000;
export const IMPORT_INSERT_CHUNK_SIZE = 200;
