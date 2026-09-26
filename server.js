const express = require("express");
const path = require("path");
const { scrapeAifRegistry } = require("./src/sebiScraper");
const { buildReportFiles, summarizeRows } = require("./src/reportBuilder");

const app = express();
const port = Number(process.env.PORT || 3000);

let currentJob = null;
let lastResult = null;

// Auth: Basic auth with credentials from the environment. There is no default password —
// if AUTH_PASSWORD is unset the server refuses every request unless auth is explicitly off.
// PUBLIC_DEMO=1 turns auth off for a read-only public showcase.
const authUser = process.env.AUTH_USER || "admin";
const authPassword = process.env.AUTH_PASSWORD;
const authDisabled =
  process.env.PUBLIC_DEMO === "1" ||
  (process.env.NODE_ENV === "development" && !process.env.ENABLE_AUTH);
const authRealm = "SEBI AIF Report Generator";

if (!authDisabled && !authPassword) {
  console.warn("AUTH_PASSWORD is not set — all requests will be rejected. Set it, or PUBLIC_DEMO=1.");
}

app.use((req, res, next) => {
  if (authDisabled) {
    return next();
  }
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Basic ")) {
    res.set("WWW-Authenticate", `Basic realm="${authRealm}"`);
    return res.status(401).send("Authentication required");
  }
  const decoded = Buffer.from(auth.slice(6), "base64").toString("utf-8");
  const sep = decoded.indexOf(":");
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  if (!authPassword || user !== authUser || pass !== authPassword) {
    res.set("WWW-Authenticate", `Basic realm="${authRealm}"`);
    return res.status(401).send("Invalid credentials");
  }
  next();
});

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

function publicResult(result) {
  if (!result) return null;
  return {
    reportDate: result.reportDate,
    sourceDate: result.sourceDate,
    sourceTotal: result.sourceTotal,
    summary: result.summary,
    rows: result.rows,
    files: result.files,
    warnings: result.warnings,
  };
}

app.get("/api/status", (_req, res) => {
  res.json({
    job: currentJob,
    lastResult: publicResult(lastResult),
  });
});

app.post("/api/fetch", async (_req, res) => {
  if (currentJob && currentJob.state === "running") {
    res.status(409).json({ error: "A fetch is already running." });
    return;
  }

  // In public demo mode, rate-limit fresh scrapes so visitors can't hammer the SEBI site.
  if (process.env.PUBLIC_DEMO === "1" && lastResult) {
    const cooldownMs = Number(process.env.DEMO_COOLDOWN_HOURS || 6) * 60 * 60 * 1000;
    const nextAllowed = new Date(lastResult.reportDate).getTime() + cooldownMs;
    if (Date.now() < nextAllowed) {
      res.status(429).json({
        error: `Demo mode: the latest report is shown below. Next refresh allowed after ${new Date(nextAllowed).toISOString()}.`,
      });
      return;
    }
  }

  const previousResult = lastResult;
  currentJob = {
    state: "running",
    message: "Starting browser...",
    fetched: 0,
    total: null,
    startedAt: new Date().toISOString(),
  };
  lastResult = null;
  res.json({ ok: true });

  try {
    const scrape = await scrapeAifRegistry((progress) => {
      currentJob = {
        ...currentJob,
        ...progress,
        state: "running",
        updatedAt: new Date().toISOString(),
      };
    });

    const summary = summarizeRows(scrape.rows);
    const files = await buildReportFiles({
      rows: scrape.rows,
      reportDate: new Date(),
      sourceDate: scrape.sourceDate,
      sourceTotal: scrape.sourceTotal,
      summary,
    });

    lastResult = {
      ...scrape,
      summary,
      files,
      reportDate: new Date().toISOString(),
    };
    currentJob = {
      state: "complete",
      message: `Fetched ${scrape.rows.length} records.`,
      fetched: scrape.rows.length,
      total: scrape.sourceTotal,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    lastResult = previousResult;
    currentJob = {
      state: "error",
      message: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      completedAt: new Date().toISOString(),
    };
  }
});

app.get("/api/download/:type", (req, res) => {
  if (!lastResult) {
    res.status(404).json({ error: "No report has been generated yet." });
    return;
  }

  const filePath = req.params.type === "xlsx" ? lastResult.files.xlsx : lastResult.files.csv;
  if (!filePath || !["xlsx", "csv"].includes(req.params.type)) {
    res.status(404).json({ error: "Unknown report type." });
    return;
  }
  res.download(filePath);
});

app.listen(port, () => {
  console.log(`SEBI AIF Report Generator running at http://localhost:${port}`);
});
