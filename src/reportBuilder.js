const fs = require("fs/promises");
const path = require("path");
const ExcelJS = require("exceljs");

const columns = [
  "Sr No",
  "Fund Name",
  "Registration Number",
  "Category",
  "Contact Person",
  "Email Address",
  "Full Address",
  "City",
  "State",
  "Registration Validity",
];

function pad(value) {
  return String(value).padStart(2, "0");
}

function dateStamp(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function displayDate(date) {
  return date.toLocaleDateString("en-IN", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function summarizeRows(rows) {
  return rows.reduce(
    (summary, row) => {
      summary.total += 1;
      if (row.Category === "Category I") summary.categoryI += 1;
      if (row.Category === "Category II") summary.categoryII += 1;
      if (row.Category === "Category III") summary.categoryIII += 1;
      return summary;
    },
    { total: 0, categoryI: 0, categoryII: 0, categoryIII: 0 }
  );
}

function buildCsv({ rows, reportDate, summary }) {
  const headerRows = [
    [`=== SEBI AIF REGISTRY - ${displayDate(reportDate)} ===`, ...Array(9).fill("")],
    ["Total AIFs", summary.total, ...Array(8).fill("")],
    ["Category I  (IN/AIF1 - VC/SME/Social/Infra)", summary.categoryI, ...Array(8).fill("")],
    ["Category II (IN/AIF2 - PE/Debt/Real Estate)", summary.categoryII, ...Array(8).fill("")],
    ["Category III(IN/AIF3 - Hedge/Multi-Strategy)", summary.categoryIII, ...Array(8).fill("")],
    Array(10).fill(""),
    columns,
  ];

  const lines = headerRows
    .concat(rows.map((row) => columns.map((column) => row[column] ?? "")))
    .map((row) => row.map(csvEscape).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

async function buildXlsx({ rows, reportDate, sourceDate, sourceTotal, summary, xlsxPath }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SEBI AIF Report Generator";
  workbook.created = reportDate;
  workbook.modified = reportDate;

  const sheet = workbook.addWorksheet("SEBI AIF Registry", {
    views: [{ state: "frozen", ySplit: 7 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  sheet.mergeCells("A1:J1");
  sheet.getCell("A1").value = `SEBI AIF Registry - ${displayDate(reportDate)}`;
  sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17324D" } };
  sheet.getCell("A1").alignment = { vertical: "middle" };
  sheet.getRow(1).height = 28;

  const summaryRows = [
    ["Source as on", sourceDate || "Current SEBI page", "Source total", sourceTotal || summary.total],
    ["Total AIFs", summary.total, "Captured unique records", rows.length],
    ["Category I", summary.categoryI, "Category II", summary.categoryII],
    ["Category III", summary.categoryIII, "", ""],
  ];

  summaryRows.forEach((values, index) => {
    const row = sheet.getRow(index + 2);
    row.values = values;
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF2F8" } };
      cell.border = { bottom: { style: "thin", color: { argb: "FFD6E1EA" } } };
    });
    row.getCell(1).font = { bold: true };
    row.getCell(3).font = { bold: true };
  });

  sheet.addRow([]);
  const headerRow = sheet.addRow(columns);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F6F73" } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FF17324D" } } };
  });

  rows.forEach((row) => {
    const sheetRow = sheet.addRow(columns.map((column) => row[column] ?? ""));
    sheetRow.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = { bottom: { style: "hair", color: { argb: "FFE2E8F0" } } };
    });
  });

  sheet.columns = [
    { width: 8 },
    { width: 38 },
    { width: 22 },
    { width: 14 },
    { width: 24 },
    { width: 32 },
    { width: 58 },
    { width: 18 },
    { width: 24 },
    { width: 24 },
  ];
  sheet.autoFilter = { from: "A7", to: "J7" };

  await workbook.xlsx.writeFile(xlsxPath);
}

async function buildReportFiles({ rows, reportDate, sourceDate, sourceTotal, summary }) {
  const reportsDir = path.join(__dirname, "..", "reports");
  await fs.mkdir(reportsDir, { recursive: true });

  const baseName = `SEBI_AIF_Report_${dateStamp(reportDate)}`;
  const csvPath = path.join(reportsDir, `${baseName}.csv`);
  const xlsxPath = path.join(reportsDir, `${baseName}.xlsx`);

  await fs.writeFile(csvPath, buildCsv({ rows, reportDate, summary }), "utf8");
  await buildXlsx({ rows, reportDate, sourceDate, sourceTotal, summary, xlsxPath });

  return { csv: csvPath, xlsx: xlsxPath };
}

module.exports = {
  buildReportFiles,
  buildCsv,
  summarizeRows,
  columns,
};
