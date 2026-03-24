/* ═══════════════════════════════════════════════════════════════
   UFABC Feed Console — Approval Page Logic
   ═══════════════════════════════════════════════════════════════ */

// ── DOM References ──
const refreshBtn = document.getElementById("refresh-btn");
const themeToggleBtn = document.getElementById("theme-toggle-btn");
const themeIconMoon = document.getElementById("theme-icon-moon");
const themeIconSun = document.getElementById("theme-icon-sun");
const liveIndicator = document.getElementById("live-indicator");
const statusFilters = document.getElementById("status-filters");
const searchInput = document.getElementById("search-input");
const statsLabel = document.getElementById("stats-label");
const tbody = document.getElementById("approval-tbody");
const emptyEl = document.getElementById("approval-empty");
const pagePrev = document.getElementById("page-prev");
const pageNext = document.getElementById("page-next");
const pageInfo = document.getElementById("page-info");
const previewModal = document.getElementById("preview-modal");
const previewFileLabel = document.getElementById("preview-file");
const previewMetadata = document.getElementById("preview-metadata");
const previewIframe = document.getElementById("preview-iframe");
const closePreviewBtn = document.getElementById("close-preview-btn");
const modalTitle = document.getElementById("modal-title");

const apiBase = "/api/v1";
const PAGE_SIZE = 20;

// ── State ──
let allFiles = [];
let activeStatus = "all";
let searchQuery = "";
let currentPage = 1;
let pollingTimer = null;
const POLL_INTERVAL = 5000;
let lastTreeHash = "";

// ── SVG Icons ──
const ICON_DOWNLOAD = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
const ICON_EYE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_MORE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>';
const ICON_DELETE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

// ── Utility ──
function formatDate(isoDate) {
  return new Date(isoDate).toLocaleString();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function displayFolderPath(folderPath) {
  return folderPath ? `/${folderPath}` : "/";
}

// ═══════════════════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════════════════

function getStoredTheme() {
  return localStorage.getItem("ufabc-theme") || "dark";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("ufabc-theme", theme);
  if (theme === "light") {
    themeIconMoon.style.display = "none";
    themeIconSun.style.display = "";
  } else {
    themeIconMoon.style.display = "";
    themeIconSun.style.display = "none";
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  applyTheme(current === "dark" ? "light" : "dark");
}

// ═══════════════════════════════════════════════════════════════
// FILTERING & PAGINATION
// ═══════════════════════════════════════════════════════════════

function getFilteredFiles() {
  let filtered = allFiles;

  if (activeStatus !== "all") {
    filtered = filtered.filter((f) => f.status === activeStatus);
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter((f) =>
      f.original_filename.toLowerCase().includes(q) ||
      displayFolderPath(f.folder_path).toLowerCase().includes(q)
    );
  }

  // Sort by date descending
  filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return filtered;
}

function getTotalPages(filtered) {
  return Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
}

function getPageSlice(filtered) {
  const start = (currentPage - 1) * PAGE_SIZE;
  return filtered.slice(start, start + PAGE_SIZE);
}

// ═══════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════

function render() {
  const filtered = getFilteredFiles();
  const totalPages = getTotalPages(filtered);

  if (currentPage > totalPages) currentPage = totalPages;

  const pageFiles = getPageSlice(filtered);

  // Stats
  statsLabel.textContent = `${filtered.length} file${filtered.length !== 1 ? "s" : ""}`;

  // Empty state
  if (pageFiles.length === 0) {
    tbody.innerHTML = "";
    emptyEl.hidden = false;
  } else {
    emptyEl.hidden = true;
    tbody.innerHTML = pageFiles
      .map((file) => {
        const approveBtn = file.status === "indexed"
          ? `<span class="badge indexed" style="font-size: var(--text-xs);">Approved</span>`
          : `<button class="btn btn--primary btn--xs" data-action="approve" data-id="${file.id}">Approve</button>`;

        return `<tr>
          <td class="col-name">
            <span class="table-filename" data-action="preview" data-id="${file.id}">${file.original_filename}</span>
          </td>
          <td class="col-folder">
            <span class="table-folder">${displayFolderPath(file.folder_path)}</span>
          </td>
          <td class="col-status">
            <span class="badge ${file.status}">${file.status}</span>
          </td>
          <td class="col-size">
            <span class="table-size">${formatBytes(file.size_bytes)}</span>
          </td>
          <td class="col-date">
            <span class="table-date">${formatDate(file.created_at)}</span>
          </td>
          <td class="col-actions">
            <div class="table-actions">
              <button class="btn btn--ghost btn--xs" data-action="preview" data-id="${file.id}" title="Preview">${ICON_EYE}</button>
              <a href="${apiBase}/files/feed/${file.id}/download" target="_blank" rel="noopener noreferrer" class="btn btn--ghost btn--xs" title="Download">${ICON_DOWNLOAD}</a>
              ${approveBtn}
              <div class="row-menu-wrap">
                <button class="btn btn--ghost btn--xs row-menu-trigger" data-action="toggle-menu" data-id="${file.id}" title="More options">${ICON_MORE}</button>
                <div class="row-menu" data-menu-for="${file.id}" hidden>
                  <button class="row-menu__item row-menu__item--danger" data-action="delete" data-id="${file.id}">
                    ${ICON_DELETE}
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            </div>
          </td>
        </tr>`;
      })
      .join("");
  }

  // Pagination
  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
  pagePrev.disabled = currentPage <= 1;
  pageNext.disabled = currentPage >= totalPages;
}

// ═══════════════════════════════════════════════════════════════
// PREVIEW MODAL
// ═══════════════════════════════════════════════════════════════

function openPreview(file) {
  modalTitle.textContent = file.original_filename;
  previewFileLabel.textContent = `ID: ${file.id}`;
  previewMetadata.textContent = JSON.stringify(
    {
      document_metadata: file.document_metadata,
      storage_metadata: file.storage_metadata,
      status: file.status,
    },
    null,
    2,
  );
  previewIframe.removeAttribute("srcdoc");
  previewIframe.src = `${apiBase}/files/feed/${file.id}/preview/frame`;
  previewModal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closePreview() {
  previewModal.hidden = true;
  previewIframe.removeAttribute("src");
  previewIframe.removeAttribute("srcdoc");
  document.body.style.overflow = "";
}

// ═══════════════════════════════════════════════════════════════
// API CALLS
// ═══════════════════════════════════════════════════════════════

function setLiveStatus(online) {
  const dot = liveIndicator.querySelector(".pulse-dot");
  if (online) {
    dot.classList.remove("offline");
    dot.title = "Connected to SeaweedFS";
  } else {
    dot.classList.add("offline");
    dot.title = "Disconnected";
  }
}

async function refreshData({ force = false } = {}) {
  try {
    const response = await fetch(`${apiBase}/files/tree`);
    if (!response.ok) throw new Error("Failed to fetch filesystem tree.");

    const payload = await response.json();
    const newHash = JSON.stringify(payload);

    if (!force && newHash === lastTreeHash) {
      setLiveStatus(true);
      return;
    }
    lastTreeHash = newHash;

    allFiles = payload.files || [];
    render();
    setLiveStatus(true);
  } catch (error) {
    setLiveStatus(false);
    throw error;
  }
}

async function markIndexed(fileId) {
  const response = await fetch(`${apiBase}/files/feed/${fileId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "indexed" }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || "Failed to update file status.");
  }
}

async function fetchPreview(fileId) {
  const response = await fetch(`${apiBase}/files/feed/${fileId}/preview`);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || "Failed to load file preview.");
  }
  return response.json();
}

async function deleteFeedFile(fileId) {
  const response = await fetch(`${apiBase}/files/feed/${fileId}`, { method: "DELETE" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || "Failed to delete file.");
  }
}

// ═══════════════════════════════════════════════════════════════
// POLLING
// ═══════════════════════════════════════════════════════════════

function startPolling() {
  stopPolling();
  pollingTimer = setInterval(async () => {
    try {
      await refreshData();
    } catch {
      // indicator shows status
    }
  }, POLL_INTERVAL);
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

// ═══════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════

themeToggleBtn.addEventListener("click", toggleTheme);

refreshBtn.addEventListener("click", async () => {
  try {
    await refreshData({ force: true });
  } catch {
    // indicator shows status
  }
});

// Status filter chips
statusFilters.addEventListener("click", (event) => {
  const chip = event.target.closest(".filter-chip");
  if (!chip) return;
  statusFilters.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
  chip.classList.add("active");
  activeStatus = chip.dataset.status;
  currentPage = 1;
  render();
});

// Search
searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value.trim();
  currentPage = 1;
  render();
});

// Pagination
pagePrev.addEventListener("click", () => {
  if (currentPage > 1) {
    currentPage--;
    render();
  }
});

pageNext.addEventListener("click", () => {
  const filtered = getFilteredFiles();
  const totalPages = getTotalPages(filtered);
  if (currentPage < totalPages) {
    currentPage++;
    render();
  }
});

// ── Row Menu (three-dot) ──
function closeAllMenus() {
  document.querySelectorAll(".row-menu:not([hidden])").forEach((m) => {
    m.hidden = true;
  });
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".row-menu-wrap")) {
    closeAllMenus();
  }
});

// Table actions (preview + approve + menu + delete)
tbody.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const actionEl = target.closest("[data-action]");
  if (!actionEl) return;

  const action = actionEl.dataset.action;
  const fileId = actionEl.dataset.id;
  if (!action || !fileId) return;

  if (action === "toggle-menu") {
    event.stopPropagation();
    const menu = document.querySelector(`.row-menu[data-menu-for="${fileId}"]`);
    if (!menu) return;
    const wasHidden = menu.hidden;
    closeAllMenus();
    menu.hidden = !wasHidden;
    return;
  }

  if (action === "preview") {
    try {
      const preview = await fetchPreview(fileId);
      openPreview(preview);
    } catch (error) {
      alert(error.message || "Failed to load preview.");
    }
    return;
  }

  if (action === "approve") {
    actionEl.disabled = true;
    actionEl.textContent = "...";
    try {
      await markIndexed(fileId);
      await refreshData({ force: true });
    } catch (error) {
      alert(error.message || "Failed to approve file.");
      actionEl.disabled = false;
      actionEl.textContent = "Approve";
    }
    return;
  }

  if (action === "delete") {
    closeAllMenus();
    const file = allFiles.find((f) => f.id === fileId);
    const name = file ? file.original_filename : fileId;
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

    try {
      await deleteFeedFile(fileId);
      await refreshData({ force: true });
    } catch (error) {
      alert(error.message || "Failed to delete file.");
    }
  }
});

// Preview modal
closePreviewBtn.addEventListener("click", closePreview);
previewModal.addEventListener("click", (event) => {
  if (event.target === previewModal) closePreview();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !previewModal.hidden) closePreview();
});

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

applyTheme(getStoredTheme());
closePreview();
refreshData({ force: true })
  .then(() => startPolling())
  .catch(() => startPolling());
