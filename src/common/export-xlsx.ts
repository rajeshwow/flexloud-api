import ExcelJS from "exceljs";
import type { Response } from "express";

type ExportColumn = {
  key: string;
  header: string;
  width?: number;
};

function formatCellValue(value: unknown) {
  if (value === null || value === undefined) return "";

  if (value instanceof Date) {
    return value.toISOString().slice(0, 19).replace("T", " ");
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return value;
}

function safeSheetName(name: string) {
  return name.replace(/[\\/*?:[\]]/g, "").slice(0, 31) || "Export";
}

export async function sendRowsAsXlsx(params: {
  res: Response;
  filename: string;
  sheetName: string;
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
}) {
  const { res, filename, sheetName, columns, rows } = params;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Flexloud CRM";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(safeSheetName(sheetName));

  worksheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width || Math.max(column.header.length + 6, 18),
  }));

  rows.forEach((row) => {
    const formattedRow: Record<string, unknown> = {};

    columns.forEach((column) => {
      formattedRow[column.key] = formatCellValue(row[column.key]);
    });

    worksheet.addRow(formattedRow);
  });

  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );

  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  await workbook.xlsx.write(res);
  res.end();
}
