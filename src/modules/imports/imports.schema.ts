import { z } from "zod";
import { ALLOWED_IMPORT_MODULES } from "./imports.contants";

export const ImportModuleParamSchema = z.object({
  slug: z.string().trim().min(1),
  module: z.enum(ALLOWED_IMPORT_MODULES as [string, ...string[]]),
});

export const ValidateImportSchema = z.object({
  duplicateMode: z.enum(["skip", "update", "allow"]).optional().default("skip"),
});

export const ExecuteImportSchema = z.object({
  duplicateMode: z.enum(["skip", "update", "allow"]).optional().default("skip"),
});

export type ImportModuleParamInput = z.infer<typeof ImportModuleParamSchema>;
export type ValidateImportInput = z.infer<typeof ValidateImportSchema>;
export type ExecuteImportInput = z.infer<typeof ExecuteImportSchema>;
