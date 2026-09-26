# SEBI AIF Registry Extractor

SEBI publishes its register of Alternative Investment Funds (2,000+ funds across Categories I, II
and III) as a paginated web page with anti-bot protection. There's no official download. This app
drives a real headless browser through every page, cleans the records, and exports an
analysis-ready Excel report and CSV.

Built for a friend in fund research who was otherwise copying the registry by hand.

## What it does

- **Extraction.** Playwright runs a real Chromium session, so it isn't blocked by SEBI's firewall
  the way plain HTTP scrapers are. It walks every page with a live progress bar.
- **Cleaning.** Normalises fund name, registration number, category, manager, contact, address,
  city, state and validity period.
- **Reports.** A formatted `.xlsx` (frozen headers, auto-filters, category summary bands) and a
  plain `.csv`.

All data comes from SEBI's public register.

## Run it

```bash
npm install
npx playwright install chromium
cp .env.example .env    # set AUTH_PASSWORD
npm start               # http://localhost:8080
```

Or with Docker (the image already contains Chromium):

```bash
docker build -t sebi-aif-extractor .
docker run -p 8080:8080 -e AUTH_PASSWORD=your-password sebi-aif-extractor
```

Set `PUBLIC_DEMO=1` instead to run without a login; fresh scrapes are then limited to one every
six hours so a public instance can't be used to hammer the SEBI site.

## Stack

Node.js, Express 5, Playwright, ExcelJS.
