/* ═══════════════════════════════════════════════════════════════
   UFABC Feed Console — Analytics Dashboard
   Fetches data from /api/v1/files/tree and renders Chart.js visuals.
   ═══════════════════════════════════════════════════════════════ */

const apiBase = "/api/v1";

/* ── Chart instances (destroy before re-create) ── */
let charts = {};
let lastTreeHash = "";

/* ── Theme-aware palette ── */
function getPalette() {
  const s = getComputedStyle(document.documentElement);
  const v = (n) => s.getPropertyValue(n).trim();
  return {
    ok:       v("--ok")       || "#34d399",
    warn:     v("--warn")     || "#fbbf24",
    fail:     v("--fail")     || "#f87171",
    info:     v("--info")     || "#60a5fa",
    accent:   v("--accent")   || "#22c55e",
    muted:    v("--text-muted")    || "#63636e",
    secondary: v("--text-secondary") || "#a0a0ab",
    primary:  v("--text-primary")  || "#ececef",
    gridLine: v("--border-subtle") || "#1e1e23",
    panelBg:  v("--bg-panel")      || "#16161a",
  };
}

/* ── Chart.js global defaults ── */
function applyChartDefaults() {
  const p = getPalette();
  Chart.defaults.color = p.secondary;
  Chart.defaults.borderColor = p.gridLine;
  Chart.defaults.font.family = "'JetBrains Mono', 'IBM Plex Mono', monospace";
  Chart.defaults.font.size = 11;
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
  Chart.defaults.plugins.legend.labels.padding = 14;
  Chart.defaults.plugins.tooltip.backgroundColor = p.panelBg;
  Chart.defaults.plugins.tooltip.titleColor = p.primary;
  Chart.defaults.plugins.tooltip.bodyColor = p.secondary;
  Chart.defaults.plugins.tooltip.borderColor = p.gridLine;
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.displayColors = true;
  Chart.defaults.plugins.tooltip.boxPadding = 4;
}

/* ═══════════════════════════════════════════════════════════════
   DATA FETCHING
   ═══════════════════════════════════════════════════════════════ */
async function fetchTree() {
  const res = await fetch(`${apiBase}/files/tree`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ═══════════════════════════════════════════════════════════════
   KPI CARDS
   ═══════════════════════════════════════════════════════════════ */
function updateKPIs(files, folders) {
  const el = (id) => document.getElementById(id);

  const total = files.length;
  const indexed = files.filter((f) => f.status === "indexed").length;
  const pending = files.filter((f) => f.status === "pending").length;
  const failed = files.filter((f) => f.status === "failed").length;
  const totalBytes = files.reduce((sum, f) => sum + (f.size_bytes || 0), 0);

  el("kpi-total-val").textContent = total.toLocaleString();
  el("kpi-indexed-val").textContent = indexed.toLocaleString();
  el("kpi-pending-val").textContent = pending.toLocaleString();
  el("kpi-failed-val").textContent = failed.toLocaleString();
  el("kpi-folders-val").textContent = folders.length.toLocaleString();
  el("kpi-size-val").textContent = formatBytes(totalBytes);
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

/* ═══════════════════════════════════════════════════════════════
   CHART BUILDERS
   ═══════════════════════════════════════════════════════════════ */

function destroyAll() {
  Object.values(charts).forEach((c) => c.destroy());
  charts = {};
}

/* ── 1. Status Doughnut ── */
function buildStatusDoughnut(files) {
  const p = getPalette();
  const counts = { pending: 0, processing: 0, indexed: 0, failed: 0 };
  files.forEach((f) => { if (counts[f.status] !== undefined) counts[f.status]++; });

  const ctx = document.getElementById("chart-status-doughnut");
  charts.statusDoughnut = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Pending", "Processing", "Indexed", "Failed"],
      datasets: [{
        data: [counts.pending, counts.processing, counts.indexed, counts.failed],
        backgroundColor: [p.warn, p.info, p.ok, p.fail],
        borderColor: p.panelBg,
        borderWidth: 3,
        hoverBorderColor: p.panelBg,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "65%",
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: (item) => {
              const total = item.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total ? ((item.raw / total) * 100).toFixed(1) : 0;
              return ` ${item.label}: ${item.raw} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

/* ── 2. Files per Folder (Bar) ── */
function buildFolderBar(files) {
  const p = getPalette();
  const folderCounts = {};
  files.forEach((f) => {
    const folder = f.folder_path || "(root)";
    folderCounts[folder] = (folderCounts[folder] || 0) + 1;
  });

  const sorted = Object.entries(folderCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  const ctx = document.getElementById("chart-folder-bar");
  charts.folderBar = new Chart(ctx, {
    type: "bar",
    data: {
      labels: sorted.map(([name]) => name.length > 18 ? name.slice(0, 16) + "…" : name),
      datasets: [{
        label: "Files",
        data: sorted.map(([, count]) => count),
        backgroundColor: p.accent + "cc",
        hoverBackgroundColor: p.accent,
        borderRadius: 4,
        borderSkipped: false,
        maxBarThickness: 36,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxRotation: 45 },
        },
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, precision: 0 },
          grid: { color: p.gridLine },
        },
      },
    },
  });
}

/* ── 3. Uploads Over Time (Line) ── */
function buildUploadsLine(files) {
  const p = getPalette();
  const dateCounts = {};
  files.forEach((f) => {
    const day = (f.created_at || "").slice(0, 10);
    if (day) dateCounts[day] = (dateCounts[day] || 0) + 1;
  });

  const sorted = Object.entries(dateCounts).sort((a, b) => a[0].localeCompare(b[0]));

  // Cumulative line
  let cumulative = 0;
  const cumulData = sorted.map(([, count]) => { cumulative += count; return cumulative; });

  const ctx = document.getElementById("chart-uploads-line");
  charts.uploadsLine = new Chart(ctx, {
    type: "line",
    data: {
      labels: sorted.map(([d]) => {
        const date = new Date(d + "T00:00:00");
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      }),
      datasets: [
        {
          label: "Daily Uploads",
          data: sorted.map(([, c]) => c),
          borderColor: p.accent,
          backgroundColor: p.accent + "18",
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointBackgroundColor: p.accent,
          pointBorderColor: p.panelBg,
          pointBorderWidth: 2,
        },
        {
          label: "Cumulative",
          data: cumulData,
          borderColor: p.info + "88",
          borderDash: [6, 3],
          fill: false,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "bottom" } },
      scales: {
        x: { grid: { display: false } },
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, precision: 0 },
          grid: { color: p.gridLine },
        },
      },
    },
  });
}

/* ── 4. Status per Folder (Stacked Bar) ── */
function buildStatusFolderBar(files) {
  const p = getPalette();
  const matrix = {};
  const statuses = ["pending", "processing", "indexed", "failed"];
  const statusColors = { pending: p.warn, processing: p.info, indexed: p.ok, failed: p.fail };

  files.forEach((f) => {
    const folder = f.folder_path || "(root)";
    if (!matrix[folder]) matrix[folder] = { pending: 0, processing: 0, indexed: 0, failed: 0 };
    if (matrix[folder][f.status] !== undefined) matrix[folder][f.status]++;
  });

  const folders = Object.keys(matrix).sort();

  const ctx = document.getElementById("chart-status-folder-bar");
  charts.statusFolderBar = new Chart(ctx, {
    type: "bar",
    data: {
      labels: folders.map((n) => n.length > 18 ? n.slice(0, 16) + "…" : n),
      datasets: statuses.map((s) => ({
        label: s.charAt(0).toUpperCase() + s.slice(1),
        data: folders.map((f) => matrix[f][s]),
        backgroundColor: statusColors[s] + "cc",
        hoverBackgroundColor: statusColors[s],
        borderRadius: 2,
        borderSkipped: false,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { maxRotation: 45 },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: { stepSize: 1, precision: 0 },
          grid: { color: p.gridLine },
        },
      },
    },
  });
}

/* ── 5. File Size Histogram ── */
function buildSizeHistogram(files) {
  const p = getPalette();
  const kb = 1024;
  const bins = [
    { label: "< 1 KB", max: 1 * kb },
    { label: "1–10 KB", max: 10 * kb },
    { label: "10–50 KB", max: 50 * kb },
    { label: "50–100 KB", max: 100 * kb },
    { label: "100–500 KB", max: 500 * kb },
    { label: "500 KB–1 MB", max: 1024 * kb },
    { label: "> 1 MB", max: Infinity },
  ];

  const counts = bins.map(() => 0);
  files.forEach((f) => {
    const size = f.size_bytes || 0;
    for (let i = 0; i < bins.length; i++) {
      if (size < bins[i].max || i === bins.length - 1) { counts[i]++; break; }
    }
  });

  const ctx = document.getElementById("chart-size-histogram");
  charts.sizeHistogram = new Chart(ctx, {
    type: "bar",
    data: {
      labels: bins.map((b) => b.label),
      datasets: [{
        label: "Files",
        data: counts,
        backgroundColor: bins.map((_, i) => {
          const colors = [p.ok, p.ok, p.accent, p.accent, p.info, p.warn, p.fail];
          return colors[i] + "cc";
        }),
        borderRadius: 4,
        borderSkipped: false,
        maxBarThickness: 40,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, precision: 0 },
          grid: { color: p.gridLine },
        },
      },
    },
  });
}

/* ── 6. Top Document Types (Horizontal Bar) ── */
function buildDocTypes(files) {
  const p = getPalette();
  const typeCounts = {};
  files.forEach((f) => {
    const tipo = f.document_metadata?.tipo || "(unknown)";
    typeCounts[tipo] = (typeCounts[tipo] || 0) + 1;
  });

  const sorted = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const barColors = [
    p.accent, p.ok, p.info, p.warn, p.fail,
    p.accent + "88", p.ok + "88", p.info + "88", p.warn + "88", p.fail + "88",
  ];

  const ctx = document.getElementById("chart-doc-types");
  charts.docTypes = new Chart(ctx, {
    type: "bar",
    data: {
      labels: sorted.map(([t]) => t.length > 25 ? t.slice(0, 23) + "…" : t),
      datasets: [{
        label: "Files",
        data: sorted.map(([, c]) => c),
        backgroundColor: sorted.map((_, i) => barColors[i % barColors.length] + "cc"),
        hoverBackgroundColor: sorted.map((_, i) => barColors[i % barColors.length]),
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { stepSize: 1, precision: 0 },
          grid: { color: p.gridLine },
        },
        y: { grid: { display: false } },
      },
    },
  });
}

/* ═══════════════════════════════════════════════════════════════
   RECENT UPLOADS TABLE
   ═══════════════════════════════════════════════════════════════ */
function renderRecentTable(files) {
  const tbody = document.getElementById("recent-tbody");
  const empty = document.getElementById("recent-empty");

  const recent = [...files]
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
    .slice(0, 10);

  if (recent.length === 0) {
    tbody.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  tbody.innerHTML = recent
    .map((f) => {
      const date = f.created_at
        ? new Date(f.created_at).toLocaleString("en-US", {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          })
        : "—";
      return `<tr>
        <td class="recent-table__name">${esc(f.original_filename)}</td>
        <td class="recent-table__folder">${esc(f.folder_path || "(root)")}</td>
        <td><span class="badge ${f.status}">${f.status}</span></td>
        <td class="recent-table__size">${formatBytes(f.size_bytes || 0)}</td>
        <td class="recent-table__date">${date}</td>
      </tr>`;
    })
    .join("");
}

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

/* ═══════════════════════════════════════════════════════════════
   MAIN RENDER
   ═══════════════════════════════════════════════════════════════ */
async function refreshDashboard({ force = false } = {}) {
  try {
    const tree = await fetchTree();
    const files = tree.files || [];
    const folders = tree.folders || [];
    const treeHash = JSON.stringify(tree);

    // Update connection indicator
    const dot = document.querySelector("#live-indicator .pulse-dot");
    if (dot) dot.classList.remove("offline");

    if (!force && treeHash === lastTreeHash) {
      return;
    }
    lastTreeHash = treeHash;

    // KPIs
    updateKPIs(files, folders);

    // Destroy old charts & rebuild
    destroyAll();
    applyChartDefaults();
    buildStatusDoughnut(files);
    buildFolderBar(files);
    buildUploadsLine(files);
    buildStatusFolderBar(files);
    buildSizeHistogram(files);
    buildDocTypes(files);

    // Recent table
    renderRecentTable(files);

    // Timestamp
    const ts = document.getElementById("last-updated");
    if (ts) {
      ts.textContent = "Updated " + new Date().toLocaleTimeString("en-US", {
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      });
    }
  } catch (err) {
    console.error("Dashboard refresh failed:", err);
    const dot = document.querySelector("#live-indicator .pulse-dot");
    if (dot) dot.classList.add("offline");
  }
}

/* ═══════════════════════════════════════════════════════════════
   THEME TOGGLE (shared pattern)
   ═══════════════════════════════════════════════════════════════ */
function initTheme() {
  const saved = localStorage.getItem("ufabc-theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  syncThemeIcons(saved);
}

function syncThemeIcons(theme) {
  const moon = document.getElementById("theme-icon-moon");
  const sun = document.getElementById("theme-icon-sun");
  if (moon) moon.style.display = theme === "dark" ? "block" : "none";
  if (sun) sun.style.display = theme === "light" ? "block" : "none";
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("ufabc-theme", next);
  syncThemeIcons(next);
  // Rebuild charts with new palette
  refreshDashboard({ force: true });
}

/* ═══════════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  initTheme();

  document.getElementById("theme-toggle-btn")?.addEventListener("click", toggleTheme);
  document.getElementById("refresh-btn")?.addEventListener("click", () => {
    refreshDashboard({ force: true });
  });

  refreshDashboard({ force: true });

  // Auto-refresh every 30 seconds
  setInterval(refreshDashboard, 30_000);
});
