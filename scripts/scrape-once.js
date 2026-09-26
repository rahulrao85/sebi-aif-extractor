const { scrapeAifRegistry } = require("../src/sebiScraper");
const { buildReportFiles, summarizeRows } = require("../src/reportBuilder");

(async () => {
  const scrape = await scrapeAifRegistry((progress) => {
    process.stdout.write(`\r${progress.message || "Working..."}`);
  });
  process.stdout.write("\n");

  const summary = summarizeRows(scrape.rows);
  const files = await buildReportFiles({
    rows: scrape.rows,
    reportDate: new Date(),
    sourceDate: scrape.sourceDate,
    sourceTotal: scrape.sourceTotal,
    summary,
  });

  console.log(`Fetched ${scrape.rows.length} records.`);
  console.log(`XLSX: ${files.xlsx}`);
  console.log(`CSV: ${files.csv}`);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
