import { parse as csvParse } from "csv-parse/sync";

export function parseCsvBuffer(buffer: Buffer): Record<string, any>[] {
  const content = buffer.toString("utf-8");

  const rows = csvParse(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
  });

  return rows as Record<string, any>[];
}
