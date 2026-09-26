const fetchButton = document.querySelector("#fetchButton");
const statusLabel = document.querySelector("#statusLabel");
const statusDetail = document.querySelector("#statusDetail");
const progressBar = document.querySelector("#progressBar");
const metrics = document.querySelector("#metrics");
const downloadPanel = document.querySelector("#downloadPanel");
const previewBody = document.querySelector("#previewBody");
const filterInput = document.querySelector("#filterInput");

let rows = [];
let pollTimer = null;

function setStatus(label, detail, progress = 0, max = 100) {
  statusLabel.textContent = label;
  statusDetail.textContent = detail;
  progressBar.max = max;
  progressBar.value = progress;
}

function renderMetrics(summary) {
  document.querySelector("#metricTotal").textContent = summary.total;
  document.querySelector("#metricCat1").textContent = summary.categoryI;
  document.querySelector("#metricCat2").textContent = summary.categoryII;
  document.querySelector("#metricCat3").textContent = summary.categoryIII;
  metrics.hidden = false;
}

function renderRows() {
  const filter = filterInput.value.trim().toLowerCase();
  const visible = rows
    .filter((row) => !filter || Object.values(row).join(" ").toLowerCase().includes(filter))
    .slice(0, 300);

  if (!visible.length) {
    previewBody.innerHTML = '<tr><td colspan="9" class="empty">No matching rows.</td></tr>';
    return;
  }

  previewBody.innerHTML = visible
    .map(
      (row) => `<tr>
        <td>${row["Sr No"] ?? ""}</td>
        <td>${row["Fund Name"] ?? ""}</td>
        <td>${row["Registration Number"] ?? ""}</td>
        <td>${row.Category ?? ""}</td>
        <td>${row["Contact Person"] ?? ""}</td>
        <td>${row["Email Address"] ?? ""}</td>
        <td>${row.City ?? ""}</td>
        <td>${row.State ?? ""}</td>
        <td>${row["Registration Validity"] ?? ""}</td>
      </tr>`
    )
    .join("");
}

async function loadStatus() {
  const response = await fetch("/api/status");
  const data = await response.json();

  if (data.job?.state === "running") {
    const total = data.job.total || 100;
    const fetched = data.job.fetched || 0;
    setStatus("Fetching", data.job.message || "Working...", fetched, total);
    fetchButton.disabled = true;
    return;
  }

  fetchButton.disabled = false;
  clearInterval(pollTimer);
  pollTimer = null;

  if (data.job?.state === "error") {
    setStatus("Error", data.job.message || "The fetch failed.");
    return;
  }

  if (data.lastResult) {
    rows = data.lastResult.rows || [];
    renderMetrics(data.lastResult.summary);
    renderRows();
    downloadPanel.hidden = false;
    setStatus("Complete", `Fetched ${rows.length} records. Excel and CSV are ready.`, rows.length, rows.length || 100);
  }
}

fetchButton.addEventListener("click", async () => {
  fetchButton.disabled = true;
  rows = [];
  metrics.hidden = true;
  downloadPanel.hidden = true;
  previewBody.innerHTML = '<tr><td colspan="9" class="empty">Fetching latest SEBI data...</td></tr>';
  setStatus("Starting", "Opening the SEBI page in a browser session...");

  const response = await fetch("/api/fetch", { method: "POST" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    setStatus("Error", data.error || "Could not start the fetch.");
    fetchButton.disabled = false;
    return;
  }

  pollTimer = setInterval(loadStatus, 1200);
  await loadStatus();
});

filterInput.addEventListener("input", renderRows);
loadStatus();
