import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar, Doughnut, Line } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Filler,
  Tooltip,
  Legend
);

interface FileItem {
  id: string;
  original_filename: string;
  folder_path: string;
  status: string;
  size_bytes: number;
  created_at: string;
  document_metadata: Record<string, unknown>;
}

interface FolderItem {
  path: string;
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function getPalette() {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    ok: v("--ok") || "#34d399",
    warn: v("--warn") || "#fbbf24",
    fail: v("--fail") || "#f87171",
    info: v("--info") || "#60a5fa",
    accent: v("--accent") || "#22c55e",
    muted: v("--text-muted") || "#63636e",
    secondary: v("--text-secondary") || "#a0a0ab",
    primary: v("--text-primary") || "#ececef",
    gridLine: v("--border-subtle") || "#1e1e23",
    panelBg: v("--bg-panel") || "#16161a",
  };
}

export function AnalyticsPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [lastUpdated, setLastUpdated] = useState("");
  const [themeKey, setThemeKey] = useState(
    () => document.documentElement.getAttribute("data-theme") || "dark"
  );
  const lastTreeHashRef = useRef("");

  const loadData = useCallback(async () => {
    try {
      const res = await apiFetch("/files/tree");
      if (!res.ok) return;
      const data = await res.json();
      const nextHash = JSON.stringify(data);
      if (nextHash === lastTreeHashRef.current) return;
      lastTreeHashRef.current = nextHash;
      setFiles(data.files || []);
      setFolders(data.folders || []);
      setLastUpdated(
        new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 30000);
    return () => clearInterval(timer);
  }, [loadData]);

  // Re-render charts when theme changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const nextTheme = document.documentElement.getAttribute("data-theme") || "dark";
      setThemeKey((prev) => (prev === nextTheme ? prev : nextTheme));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const p = useMemo(() => getPalette(), [themeKey]);

  useEffect(() => {
    // Keep Chart.js defaults synced with active theme without redoing on unrelated renders.
    ChartJS.defaults.color = p.secondary;
    ChartJS.defaults.borderColor = p.gridLine;
    ChartJS.defaults.font.family = "'JetBrains Mono', 'IBM Plex Mono', monospace";
    ChartJS.defaults.font.size = 11;
  }, [p.gridLine, p.secondary]);

  const summary = useMemo(() => {
    const statusCounts = { pending: 0, processing: 0, indexed: 0, failed: 0 };
    let totalBytes = 0;

    files.forEach((file) => {
      totalBytes += file.size_bytes || 0;
      if (file.status in statusCounts) {
        statusCounts[file.status as keyof typeof statusCounts] += 1;
      }
    });

    return {
      total: files.length,
      indexed: statusCounts.indexed,
      pending: statusCounts.pending,
      failed: statusCounts.failed,
      totalBytes,
      statusCounts,
    };
  }, [files]);

  const tooltipStyle = useMemo(
    () => ({
      backgroundColor: p.panelBg,
      titleColor: p.primary,
      bodyColor: p.secondary,
      borderColor: p.gridLine,
      borderWidth: 1,
      cornerRadius: 8,
      padding: 10,
      displayColors: true,
      boxPadding: 4,
    }),
    [p.gridLine, p.panelBg, p.primary, p.secondary]
  );

  // ── 1. Status Doughnut ──
  const doughnutData = useMemo(
    () => ({
      labels: ["Pending", "Processing", "Indexed", "Failed"],
      datasets: [
        {
          data: [
            summary.statusCounts.pending,
            summary.statusCounts.processing,
            summary.statusCounts.indexed,
            summary.statusCounts.failed,
          ],
          backgroundColor: [p.warn, p.info, p.ok, p.fail],
          borderColor: p.panelBg,
          borderWidth: 3,
          hoverBorderColor: p.panelBg,
          hoverOffset: 6,
        },
      ],
    }),
    [p.fail, p.info, p.ok, p.panelBg, p.warn, summary.statusCounts]
  );

  // ── 2. Files per Folder (Bar) ──
  const folderBarData = useMemo(() => {
    const folderCounts: Record<string, number> = {};
    files.forEach((f) => {
      const folder = f.folder_path || "(root)";
      folderCounts[folder] = (folderCounts[folder] || 0) + 1;
    });
    const topFolders = Object.entries(folderCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);

    return {
      labels: topFolders.map(([name]) =>
        name.length > 18 ? name.slice(0, 16) + "\u2026" : name
      ),
      datasets: [
        {
          label: "Files",
          data: topFolders.map(([, count]) => count),
          backgroundColor: p.accent + "cc",
          hoverBackgroundColor: p.accent,
          borderRadius: 4,
          borderSkipped: false as const,
          maxBarThickness: 36,
        },
      ],
    };
  }, [files, p.accent]);

  // ── 3. Uploads Over Time (Line) ──
  const uploadsLineData = useMemo(() => {
    const dateCounts: Record<string, number> = {};
    files.forEach((f) => {
      const day = (f.created_at || "").slice(0, 10);
      if (day) dateCounts[day] = (dateCounts[day] || 0) + 1;
    });
    const dailySorted = Object.entries(dateCounts).sort((a, b) =>
      a[0].localeCompare(b[0])
    );
    let cumulative = 0;
    const cumulData = dailySorted.map(([, count]) => {
      cumulative += count;
      return cumulative;
    });

    return {
      labels: dailySorted.map(([d]) => {
        const date = new Date(d + "T00:00:00");
        return date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
      }),
      datasets: [
        {
          label: "Daily Uploads",
          data: dailySorted.map(([, c]) => c),
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
    };
  }, [files, p.accent, p.info, p.panelBg]);

  // ── 4. Status per Folder (Stacked Bar) ──
  const statusFolderData = useMemo(() => {
    const matrix: Record<
      string,
      { pending: number; processing: number; indexed: number; failed: number }
    > = {};
    const allStatuses = ["pending", "processing", "indexed", "failed"] as const;
    const statusColors = {
      pending: p.warn,
      processing: p.info,
      indexed: p.ok,
      failed: p.fail,
    };

    files.forEach((f) => {
      const folder = f.folder_path || "(root)";
      if (!matrix[folder]) {
        matrix[folder] = { pending: 0, processing: 0, indexed: 0, failed: 0 };
      }
      if (f.status in matrix[folder]) {
        matrix[folder][f.status as keyof (typeof matrix)[string]]++;
      }
    });
    const matrixFolders = Object.keys(matrix).sort();

    return {
      labels: matrixFolders.map((n) =>
        n.length > 18 ? n.slice(0, 16) + "\u2026" : n
      ),
      datasets: allStatuses.map((s) => ({
        label: s.charAt(0).toUpperCase() + s.slice(1),
        data: matrixFolders.map((folder) => matrix[folder][s]),
        backgroundColor: statusColors[s] + "cc",
        hoverBackgroundColor: statusColors[s],
        borderRadius: 2,
        borderSkipped: false as const,
      })),
    };
  }, [files, p.fail, p.info, p.ok, p.warn]);

  // ── 5. File Size Histogram ──
  const histogramData = useMemo(() => {
    const kb = 1024;
    const bins = [
      { label: "< 1 KB", max: 1 * kb },
      { label: "1\u201310 KB", max: 10 * kb },
      { label: "10\u201350 KB", max: 50 * kb },
      { label: "50\u2013100 KB", max: 100 * kb },
      { label: "100\u2013500 KB", max: 500 * kb },
      { label: "500 KB\u20131 MB", max: 1024 * kb },
      { label: "> 1 MB", max: Infinity },
    ];
    const binCounts = bins.map(() => 0);
    files.forEach((f) => {
      const size = f.size_bytes || 0;
      for (let i = 0; i < bins.length; i++) {
        if (size < bins[i].max || i === bins.length - 1) {
          binCounts[i]++;
          break;
        }
      }
    });
    const binColors = [p.ok, p.ok, p.accent, p.accent, p.info, p.warn, p.fail];

    return {
      labels: bins.map((b) => b.label),
      datasets: [
        {
          label: "Files",
          data: binCounts,
          backgroundColor: binColors.map((c) => c + "cc"),
          borderRadius: 4,
          borderSkipped: false as const,
          maxBarThickness: 40,
        },
      ],
    };
  }, [files, p.accent, p.fail, p.info, p.ok, p.warn]);

  // ── 6. Top Document Types (Horizontal Bar) ──
  const docTypesData = useMemo(() => {
    const typeCounts: Record<string, number> = {};
    files.forEach((f) => {
      const tipo = (f.document_metadata?.tipo as string) || "(unknown)";
      typeCounts[tipo] = (typeCounts[tipo] || 0) + 1;
    });
    const topTypes = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    const typeBarColors = [
      p.accent, p.ok, p.info, p.warn, p.fail,
      p.accent + "88", p.ok + "88", p.info + "88", p.warn + "88", p.fail + "88",
    ];

    return {
      labels: topTypes.map(([t]) =>
        t.length > 25 ? t.slice(0, 23) + "\u2026" : t
      ),
      datasets: [
        {
          label: "Files",
          data: topTypes.map(([, c]) => c),
          backgroundColor: topTypes.map(
            (_, i) => typeBarColors[i % typeBarColors.length] + "cc"
          ),
          hoverBackgroundColor: topTypes.map(
            (_, i) => typeBarColors[i % typeBarColors.length]
          ),
          borderRadius: 4,
          borderSkipped: false as const,
        },
      ],
    };
  }, [files, p.accent, p.fail, p.info, p.ok, p.warn]);

  // ── Recent Uploads ──
  const recent = useMemo(
    () =>
      [...files]
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
        .slice(0, 10),
    [files]
  );

  // Shared chart options
  const barOptions = useCallback(
    (opts?: { stacked?: boolean; indexAxis?: "y" }) => ({
      responsive: true,
      maintainAspectRatio: false,
      ...(opts?.indexAxis ? { indexAxis: "y" as const } : {}),
      plugins: {
        legend: {
          display: !!opts?.stacked,
          position: "bottom" as const,
          labels: { boxWidth: 12, padding: 14 },
        },
        tooltip: tooltipStyle,
      },
      scales: {
        x: {
          ...(opts?.stacked ? { stacked: true } : {}),
          grid: { display: opts?.indexAxis === "y", color: p.gridLine },
          ticks: {
            ...(opts?.indexAxis !== "y" ? { maxRotation: 45 } : {}),
            stepSize: 1,
            precision: 0,
            color: p.secondary,
          },
          ...(opts?.indexAxis === "y" ? { beginAtZero: true } : {}),
        },
        y: {
          ...(opts?.stacked ? { stacked: true } : {}),
          beginAtZero: true,
          ticks: { stepSize: 1, precision: 0, color: p.secondary },
          grid: { display: opts?.indexAxis !== "y", color: p.gridLine },
        },
      },
    }),
    [p.gridLine, p.secondary, tooltipStyle]
  );

  return (
    <>
      <header className="topbar">
        <div className="topbar__left">
          <h1 className="topbar__title">Analytics Dashboard</h1>
          {lastUpdated && (
            <span className="topbar__badge">Updated {lastUpdated}</span>
          )}
        </div>
        <div className="topbar__actions">
          <button className="btn btn--outline btn--sm" onClick={loadData}>
            Refresh
          </button>
        </div>
      </header>

      <div className="analytics-layout">
        {/* KPI cards */}
        <div className="kpi-grid">
          <div className="kpi-card">
            <span className="kpi-card__label">Total Files</span>
            <span className="kpi-card__value">{summary.total}</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-card__label">Indexed</span>
            <span className="kpi-card__value kpi-card__value--ok">
              {summary.indexed}
            </span>
          </div>
          <div className="kpi-card">
            <span className="kpi-card__label">Pending</span>
            <span className="kpi-card__value kpi-card__value--warn">
              {summary.pending}
            </span>
          </div>
          <div className="kpi-card">
            <span className="kpi-card__label">Failed</span>
            <span className="kpi-card__value kpi-card__value--fail">
              {summary.failed}
            </span>
          </div>
          <div className="kpi-card">
            <span className="kpi-card__label">Folders</span>
            <span className="kpi-card__value">{folders.length}</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-card__label">Total Size</span>
            <span className="kpi-card__value">{formatBytes(summary.totalBytes)}</span>
          </div>
        </div>

        {/* Charts — 6 panels like the old dashboard */}
        <div className="analytics-charts-grid">
          <div className="analytics-card">
            <h3 className="analytics-card__title">Status Distribution</h3>
            <div className="chart-container">
              <Doughnut
                data={doughnutData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  cutout: "65%",
                  plugins: {
                    legend: { position: "bottom", labels: { boxWidth: 12, padding: 14 } },
                    tooltip: tooltipStyle,
                  },
                }}
              />
            </div>
          </div>

          <div className="analytics-card">
            <h3 className="analytics-card__title">Files per Folder</h3>
            <div className="chart-container">
              <Bar data={folderBarData} options={barOptions()} />
            </div>
          </div>

          <div className="analytics-card">
            <h3 className="analytics-card__title">Uploads Over Time</h3>
            <div className="chart-container">
              <Line
                data={uploadsLineData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  interaction: { mode: "index", intersect: false },
                  plugins: {
                    legend: { position: "bottom", labels: { boxWidth: 12, padding: 14 } },
                    tooltip: tooltipStyle,
                  },
                  scales: {
                    x: { grid: { display: false }, ticks: { color: p.secondary } },
                    y: {
                      beginAtZero: true,
                      ticks: { stepSize: 1, precision: 0, color: p.secondary },
                      grid: { color: p.gridLine },
                    },
                  },
                }}
              />
            </div>
          </div>

          <div className="analytics-card">
            <h3 className="analytics-card__title">Status per Folder</h3>
            <div className="chart-container">
              <Bar data={statusFolderData} options={barOptions({ stacked: true })} />
            </div>
          </div>

          <div className="analytics-card">
            <h3 className="analytics-card__title">File Size Distribution</h3>
            <div className="chart-container">
              <Bar data={histogramData} options={barOptions()} />
            </div>
          </div>

          <div className="analytics-card">
            <h3 className="analytics-card__title">Top Document Types</h3>
            <div className="chart-container">
              <Bar data={docTypesData} options={barOptions({ indexAxis: "y" })} />
            </div>
          </div>
        </div>

        {/* Recent uploads table */}
        <div className="analytics-card analytics-card--wide">
          <h3 className="analytics-card__title">Recent Uploads</h3>
          <table className="approval-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Folder</th>
                <th>Status</th>
                <th>Size</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((f) => (
                <tr key={f.id}>
                  <td>{f.original_filename}</td>
                  <td>{f.folder_path || "(root)"}</td>
                  <td>
                    <span className={`badge ${f.status}`}>{f.status}</span>
                  </td>
                  <td>{formatBytes(f.size_bytes)}</td>
                  <td>
                    {new Date(f.created_at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {recent.length === 0 && (
            <p style={{ padding: "var(--space-4)", color: "var(--text-muted)" }}>
              No files yet.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
