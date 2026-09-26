const { chromium } = require("playwright");

const SEBI_AIF_URL =
  "https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&intmId=16";

function parseCount(text) {
  const match = String(text || "").match(/of\s+([\d,]+)\s+records/i);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

function normalizeSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function inferCategory(registrationNumber) {
  if (registrationNumber.includes("AIF1")) return "Category I";
  if (registrationNumber.includes("AIF2")) return "Category II";
  if (registrationNumber.includes("AIF3")) return "Category III";
  return "";
}

function splitCityState(address) {
  const parts = String(address || "")
    .split(",")
    .map((part) => normalizeSpace(part))
    .filter(Boolean);

  if (parts.length < 2) return { city: "", state: "" };

  const last = parts[parts.length - 1];
  if (/^\d{4,}$/.test(last) && parts.length >= 3) {
    return {
      city: parts[parts.length - 3].toUpperCase(),
      state: parts[parts.length - 2].toUpperCase(),
    };
  }

  return {
    city: parts[parts.length - 2].toUpperCase(),
    state: parts[parts.length - 1].toUpperCase(),
  };
}

function mapRecord(record, index) {
  const registrationNumber = normalizeSpace(record["Registration No."]);
  const address = normalizeSpace(record.Address);
  const { city, state } = splitCityState(address);

  return {
    "Sr No": index + 1,
    "Fund Name": normalizeSpace(record.Name).toUpperCase(),
    "Registration Number": registrationNumber,
    Category: inferCategory(registrationNumber),
    "Contact Person": normalizeSpace(record["Contact Person"]),
    "Email Address": normalizeSpace(record["E-mail"]),
    "Full Address": address,
    City: city,
    State: state,
    "Registration Validity": normalizeSpace(record.Validity),
  };
}

async function extractPage(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const cards = [...document.querySelectorAll("#ajax_cat .card-table, .card-table")];

    return cards
      .map((card) => {
        const record = {};
        card.querySelectorAll(".card-view").forEach((row) => {
          const title = clean(row.querySelector(".title")?.innerText);
          const value = clean(row.querySelector(".value")?.innerText);
          if (title) record[title.replace(/\s+/g, " ")] = value;
        });
        return record;
      })
      .filter((record) => record["Registration No."] || record.Name);
  });
}

async function readPageMeta(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const pageText = clean(document.querySelector("#ajax_cat .pagination_inner p, .pagination_inner p")?.innerText);
    const noteText = clean([...document.querySelectorAll("h4, .org-benchmark")]
      .map((node) => node.innerText)
      .find((text) => /Registered intermediaries as on date/i.test(text)));
    const hasNext = Boolean(document.querySelector("#ajax_cat a[title='Next'], a[title='Next']"));
    return { pageText, noteText, hasNext };
  });
}

async function waitForPageChange(page, previousText) {
  await page.waitForFunction(
    (oldText) => {
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const nextText = clean(document.querySelector("#ajax_cat .pagination_inner p, .pagination_inner p")?.innerText);
      return nextText && nextText !== oldText && !/Please wait/i.test(document.body.innerText);
    },
    previousText,
    { timeout: 20000 }
  );
  await page.waitForSelector("#ajax_cat .card-table, .card-table", { timeout: 20000 });
}

async function clickNext(page) {
  const previous = await page.locator("#ajax_cat .pagination_inner p, .pagination_inner p").first().innerText();
  await page.locator("#ajax_cat a[title='Next'], a[title='Next']").first().click();
  await waitForPageChange(page, normalizeSpace(previous));
}

async function scrapeAifRegistry(onProgress = () => {}) {
  const headless = process.env.SEBI_HEADLESS !== "0";
  const browser = await chromium.launch({
    headless,
    slowMo: headless ? 0 : 60,
  });

  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  });

  const seen = new Map();
  let sourceTotal = null;
  let sourceDate = "";
  const warnings = [];

  try {
    onProgress({ message: "Opening SEBI registry...", fetched: 0, total: null });
    await page.goto(SEBI_AIF_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".card-table", { timeout: 60000 });

    for (let pageNumber = 1; pageNumber <= 150; pageNumber += 1) {
      const meta = await readPageMeta(page);
      sourceTotal = sourceTotal || parseCount(meta.pageText);
      if (meta.noteText && !sourceDate) {
        sourceDate = meta.noteText.replace(/^.*as on date\s*/i, "").replace(/[()]/g, "").trim();
      }

      const records = await extractPage(page);
      records.forEach((record) => {
        const registrationNumber = normalizeSpace(record["Registration No."]);
        if (registrationNumber && !seen.has(registrationNumber)) {
          seen.set(registrationNumber, record);
        }
      });

      onProgress({
        message: `Fetched ${seen.size}${sourceTotal ? ` / ${sourceTotal}` : ""} records...`,
        fetched: seen.size,
        total: sourceTotal,
      });

      if (sourceTotal && seen.size >= sourceTotal) break;
      if (!meta.hasNext) break;

      const beforeCount = seen.size;
      await clickNext(page);
      if (pageNumber > 1 && beforeCount === seen.size && !sourceTotal) {
        warnings.push("Pagination continued without increasing the record count.");
      }
    }

    if (!seen.size) {
      throw new Error("No SEBI AIF records were found. The page markup may have changed.");
    }

    if (sourceTotal && seen.size !== sourceTotal) {
      warnings.push(`SEBI showed ${sourceTotal} records, but ${seen.size} unique records were captured.`);
    }

    const rows = [...seen.values()]
      .sort((a, b) => normalizeSpace(a.Name).localeCompare(normalizeSpace(b.Name), "en", { sensitivity: "base" }))
      .map(mapRecord);

    return {
      rows,
      sourceTotal,
      sourceDate,
      warnings,
      sourceUrl: SEBI_AIF_URL,
    };
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    if (/Unauthorized Activity|Unauthorized Request Blocked/i.test(body)) {
      throw new Error("SEBI blocked the browser request. Try again after a few minutes, or run with the visible browser open.");
    }
    throw error;
  } finally {
    await browser.close();
  }
}

module.exports = {
  scrapeAifRegistry,
  inferCategory,
  splitCityState,
  SEBI_AIF_URL,
};
