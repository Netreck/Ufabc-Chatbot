/* ═══════════════════════════════════════════════════════════════
   UFABC Feed Console — Application Logic
   ═══════════════════════════════════════════════════════════════ */

// ── DOM References ──
const uploadForm = document.getElementById("upload-form");
const fileInput = document.getElementById("file-input");
const storageMetadataInput = document.getElementById("storage-metadata-input");
const uploadResult = document.getElementById("upload-result");
const uploadTargetFolder = document.getElementById("upload-target-folder");
const uploadSubmitBtn = document.getElementById("upload-submit-btn");
const uploadQueue = document.getElementById("upload-queue");
const uploadQueueList = document.getElementById("upload-queue-list");
const uploadQueueSummary = document.getElementById("upload-queue-summary");
const uploadQueueClear = document.getElementById("upload-queue-clear");
const refreshBtn = document.getElementById("refresh-btn");
const createFolderForm = document.getElementById("create-folder-form");
const createFolderInput = document.getElementById("create-folder-input");
const folderTree = document.getElementById("folder-tree");
const currentFolderLabel = document.getElementById("current-folder-label");
const fileListEl = document.getElementById("file-list");
const chatContextInfo = document.getElementById("chat-context-info");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatMessagesEl = document.getElementById("chat-messages");
const chatSubmitBtn = chatForm.querySelector('button[type="submit"]');
const clearChatContextBtn = document.getElementById("clear-chat-context-btn");
const loadedFilesList = document.getElementById("loaded-files-list");
const previewModal = document.getElementById("preview-modal");
const previewFileLabel = document.getElementById("preview-file");
const previewMetadata = document.getElementById("preview-metadata");
const previewIframe = document.getElementById("preview-iframe");
const closePreviewBtn = document.getElementById("close-preview-btn");
const modalTitle = document.getElementById("modal-title");
const liveIndicator = document.getElementById("live-indicator");
const dropZone = document.getElementById("drop-zone");
const themeToggleBtn = document.getElementById("theme-toggle-btn");
const themeIconMoon = document.getElementById("theme-icon-moon");
const themeIconSun = document.getElementById("theme-icon-sun");
const folderCtxMenu = document.getElementById("folder-ctx-menu");
const ctxDeleteFolder = document.getElementById("ctx-delete-folder");
const resizeFolderHandle = document.getElementById("resize-folder");
const resizeChatHandle = document.getElementById("resize-chat");
const folderPanelEl = document.getElementById("folder-panel");
const workspaceEl = document.querySelector(".workspace");
const fsGridEl = document.querySelector(".fs-grid");

// Sidebar panel switching
const sidebarBtns = document.querySelectorAll(".sidebar__btn[data-panel]");
const panelChat = document.getElementById("panel-chat");

const apiBase = "/api/v1";

// ── SVG Icons (inline) ──
const ICON_DOWNLOAD = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
const ICON_DELETE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
const ICON_CHEVRON = '<svg class="chevron-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

// ── State ──
let filesystem = { folders: [], files: [] };
let currentFolderPath = "";
let previewedFileId = null;
const selectedContextFileIds = new Set();
let pollingTimer = null;
const POLL_INTERVAL = 5000;
let lastTreeHash = "";
let ctxMenuFolderPath = null;
let fileClickTimer = null;
let folderClickTimer = null;
let draggingFileId = "";
const collapsedFolders = new Set(
  JSON.parse(localStorage.getItem("ufabc-collapsed-folders") || "[]"),
);

function persistCollapsedFolders() {
  localStorage.setItem("ufabc-collapsed-folders", JSON.stringify([...collapsedFolders]));
}

// ── Utility ──
function formatDate(isoDate) {
  return new Date(isoDate).toLocaleString();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function toErrorMessage(error, fallbackMessage) {
  if (error instanceof Error && error.message.trim() !== "") return error.message;
  return fallbackMessage;
}

function displayFolderPath(folderPath) {
  return folderPath ? `/${folderPath}` : "/";
}

function getFileById(fileId) {
  return filesystem.files.find((item) => item.id === fileId) || null;
}

function getFolderItemsSorted() {
  const items = Array.isArray(filesystem.folders) ? [...filesystem.folders] : [];
  items.sort((a, b) => a.path.localeCompare(b.path));
  return items;
}

function getFolderChildrenSet(folders) {
  const hasChildren = new Set();
  const pathSet = new Set(folders.map((f) => f.path));
  for (const folder of folders) {
    const lastSlash = folder.path.lastIndexOf("/");
    const parentPath = lastSlash === -1 ? "" : folder.path.substring(0, lastSlash);
    if (pathSet.has(parentPath) || parentPath === "") {
      hasChildren.add(parentPath);
    }
  }
  return hasChildren;
}

function isAncestorCollapsed(folderPath) {
  if (collapsedFolders.has("")) return true;
  const parts = folderPath.split("/");
  for (let i = 1; i < parts.length; i++) {
    if (collapsedFolders.has(parts.slice(0, i).join("/"))) return true;
  }
  return false;
}

function pruneCollapsedFolders() {
  const knownPaths = getKnownFolderPaths();
  for (const path of collapsedFolders) {
    if (path !== "" && !knownPaths.has(path)) collapsedFolders.delete(path);
  }
  persistCollapsedFolders();
}

function getCurrentFolderFiles() {
  const folder = currentFolderPath || "";
  return filesystem.files
    .filter((item) => (item.folder_path || "") === folder)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
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
// RENDER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function renderContextInfo() {
  if (selectedContextFileIds.size === 0) {
    chatContextInfo.textContent = "";
    return;
  }
  chatContextInfo.textContent = `${selectedContextFileIds.size} file(s) in context`;
}

function renderLoadedFiles() {
  if (selectedContextFileIds.size === 0) {
    loadedFilesList.innerHTML = '<p class="loaded-files__empty">No files loaded for context. Drag files here or click "Use in Smoke".</p>';
    return;
  }

  const chips = Array.from(selectedContextFileIds)
    .map((fileId) => {
      const file = getFileById(fileId);
      const name = file ? file.original_filename : fileId;
      return `
        <span class="loaded-file-chip">
          ${name}
          <button class="loaded-file-chip__remove" data-remove-context="${fileId}" title="Remove from context">&times;</button>
        </span>
      `;
    })
    .join("");
  loadedFilesList.innerHTML = chips;
}

// ── Preview Modal ──
function openPreview(preview) {
  previewedFileId = preview.id;
  modalTitle.textContent = preview.original_filename;
  previewFileLabel.textContent = `ID: ${preview.id}`;
  previewMetadata.textContent = JSON.stringify(
    {
      document_metadata: preview.document_metadata,
      storage_metadata: preview.storage_metadata,
      status: preview.status,
    },
    null,
    2,
  );
  // srcdoc takes precedence over src — must remove it before setting src
  previewIframe.removeAttribute("srcdoc");
  previewIframe.src = `${apiBase}/files/feed/${preview.id}/preview/frame`;
  previewModal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closePreview() {
  previewedFileId = null;
  previewModal.hidden = true;
  previewIframe.removeAttribute("src");
  previewIframe.removeAttribute("srcdoc");
  document.body.style.overflow = "";
}

// ── Folder Tree ──
function renderFolderTree() {
  const folders = getFolderItemsSorted();
  const hasChildrenSet = getFolderChildrenSet(folders);
  const rootActive = currentFolderPath === "" ? "active" : "";
  const rootCollapsed = collapsedFolders.has("");
  const rootChevronClass = rootCollapsed ? "" : "expanded";

  const rootChevron = hasChildrenSet.has("")
    ? `<button type="button" class="folder-chevron ${rootChevronClass}" data-action="toggle-collapse" data-folder-path="">${ICON_CHEVRON}</button>`
    : '<span class="folder-chevron-spacer"></span>';

  const rootNode = `<div class="folder-row folder-row--root">
    ${rootChevron}
    <button type="button" class="folder-node ${rootActive}" data-folder-path="" style="padding-left: 4px;">/</button>
  </div>`;

  const folderNodes = folders
    .map((folder) => {
      if (isAncestorCollapsed(folder.path)) return "";

      const isActive = folder.path === currentFolderPath ? "active" : "";
      const indent = 4 + (folder.depth + 1) * 14;
      const folderHasChildren = hasChildrenSet.has(folder.path);
      const isCollapsed = collapsedFolders.has(folder.path);
      const chevronClass = isCollapsed ? "" : "expanded";

      const chevron = folderHasChildren
        ? `<button type="button" class="folder-chevron ${chevronClass}" data-action="toggle-collapse" data-folder-path="${folder.path}">${ICON_CHEVRON}</button>`
        : '<span class="folder-chevron-spacer"></span>';

      return `<div class="folder-row" draggable="true" data-folder-path="${folder.path}">
        ${chevron}
        <button type="button" class="folder-node ${isActive}" data-folder-path="${folder.path}" style="padding-left: ${indent}px;">${folder.name}</button>
        <button type="button" class="folder-delete-btn" data-action="delete-folder" data-folder-path="${folder.path}" title="Delete folder">${ICON_DELETE}</button>
      </div>`;
    })
    .join("");

  folderTree.innerHTML = `${rootNode}${folderNodes}`;
}

// ── File List (vertical card rows — click filename to preview, icon buttons) ──
function renderFileList() {
  const items = getCurrentFolderFiles();
  if (!items.length) {
    fileListEl.innerHTML = '<div class="file-list__empty">No files in this folder.</div>';
    return;
  }

  fileListEl.innerHTML = items
    .map((item) => {
      const documentId = item.document_metadata?.id || "?";
      const documentVersion = item.document_metadata?.versao || "?";
      const isSmoke = selectedContextFileIds.has(item.id);
      const smokeLabel = isSmoke ? "In context" : "Use in Smoke";
      const smokeActiveClass = isSmoke ? "active" : "";
      const selectedClass = isSmoke ? "selected-context" : "";
      const approveBtn = item.status === "indexed"
        ? ""
        : `<button type="button" class="btn btn--ghost btn--xs" data-action="mark-indexed" data-id="${item.id}" title="Approve (set as indexed)">Approve</button>`;

      return `
        <div class="file-row ${selectedClass}" draggable="true" data-file-id="${item.id}">
          <div class="file-row__top">
            <span class="file-row__name" data-action="open-preview" data-id="${item.id}" title="Click to preview">${item.original_filename}</span>
            <span class="badge ${item.status}">${item.status}</span>
          </div>
          <div class="file-row__meta">
            <code>doc:${documentId} v${documentVersion}</code>
            <span>${formatBytes(item.size_bytes)}</span>
            <span>${formatDate(item.created_at)}</span>
          </div>
          <div class="file-row__actions">
            <a href="${apiBase}/files/feed/${item.id}/download" target="_blank" rel="noopener noreferrer" class="btn btn--ghost btn--xs" title="Download">${ICON_DOWNLOAD}</a>
            <button type="button" class="btn btn--smoke btn--xs ${smokeActiveClass}" data-action="toggle-smoke-context" data-id="${item.id}">${smokeLabel}</button>
            ${approveBtn}
            <button type="button" class="btn btn--danger btn--xs" data-action="delete-file" data-id="${item.id}" title="Delete">${ICON_DELETE}</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderAll() {
  uploadTargetFolder.textContent = `Target: ${displayFolderPath(currentFolderPath)}`;
  currentFolderLabel.textContent = displayFolderPath(currentFolderPath);
  renderFolderTree();
  renderFileList();
  renderContextInfo();
  renderLoadedFiles();
}

function pruneSelectionState() {
  const existingIds = new Set(filesystem.files.map((item) => item.id));
  for (const fileId of selectedContextFileIds) {
    if (!existingIds.has(fileId)) selectedContextFileIds.delete(fileId);
  }
  if (previewedFileId && !existingIds.has(previewedFileId)) {
    closePreview();
  }
  pruneCollapsedFolders();
}

function getKnownFolderPaths() {
  const folderPaths = new Set([""]);
  for (const folder of filesystem.folders) folderPaths.add(folder.path);
  return folderPaths;
}

// ═══════════════════════════════════════════════════════════════
// CHAT BUBBLES
// ═══════════════════════════════════════════════════════════════

function addChatBubble(text, role) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble chat-bubble--${role}`;
  bubble.textContent = text;
  chatMessagesEl.appendChild(bubble);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  return bubble;
}

function removeBubble(el) {
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

// ═══════════════════════════════════════════════════════════════
// API CALLS
// ═══════════════════════════════════════════════════════════════

async function refreshFilesystem({ force = false } = {}) {
  try {
    const response = await fetch(`${apiBase}/files/tree`);
    if (!response.ok) throw new Error("Failed to fetch filesystem tree.");

    const payload = await response.json();
    const newHash = JSON.stringify(payload);

    // Skip re-render if data unchanged (avoids animation replay + click interference)
    if (!force && newHash === lastTreeHash) {
      setLiveStatus(true);
      return;
    }
    lastTreeHash = newHash;

    filesystem = { folders: payload.folders || [], files: payload.files || [] };

    const knownFolders = getKnownFolderPaths();
    if (!knownFolders.has(currentFolderPath)) currentFolderPath = "";

    pruneSelectionState();
    renderAll();
    setLiveStatus(true);
  } catch (error) {
    setLiveStatus(false);
    throw error;
  }
}

// ── Upload Queue State ──
let uploadQueueItems = []; // { id, file, status: 'pending'|'validating'|'uploading'|'success'|'error', error, result }
let isUploading = false;

function generateUploadId() {
  return `uq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function validateFiles(files) {
  const body = new FormData();
  for (const file of files) body.append("files", file);
  try {
    const response = await fetch(`${apiBase}/files/feed/validate`, { method: "POST", body });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

async function uploadSingleFile(file, storageMetadataRaw) {
  const body = new FormData();
  body.append("file", file);
  if (storageMetadataRaw && storageMetadataRaw.trim() !== "") {
    body.append("storage_metadata", storageMetadataRaw);
  }
  if (currentFolderPath) body.append("folder_path", currentFolderPath);

  const response = await fetch(`${apiBase}/files/feed`, { method: "POST", body });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || "Upload failed.");
  }
  return response.json();
}

function addFilesToQueue(fileList) {
  const files = Array.from(fileList);
  if (!files.length) return;

  for (const file of files) {
    uploadQueueItems.push({
      id: generateUploadId(),
      file,
      status: "pending",
      error: null,
      validationErrors: [],
      result: null,
    });
  }
  renderUploadQueue();
  uploadQueue.hidden = false;

  // Validate all pending files immediately
  validateQueuedFiles(files);
}

async function validateQueuedFiles(files) {
  // Collect validating items in order matching the files array
  const validatingItems = [];
  for (const item of uploadQueueItems) {
    if (item.status === "pending" && files.some((f) => f === item.file)) {
      item.status = "validating";
      validatingItems.push(item);
    }
  }
  renderUploadQueue();

  const validation = await validateFiles(files);
  if (validation && validation.results) {
    // Match by index — results come back in same order as files sent
    for (let i = 0; i < validation.results.length; i++) {
      const vr = validation.results[i];
      const item = validatingItems[i];
      if (!item) continue;
      if (!vr.valid) {
        item.status = "error";
        item.validationErrors = vr.errors || [];
        item.error = vr.errors.join(" \u2022 ");
      } else {
        item.status = "ready";
        item.validationErrors = [];
      }
    }
  } else {
    // Validation endpoint failed — mark as ready anyway, upload will catch errors
    for (const item of validatingItems) {
      item.status = "ready";
    }
  }
  renderUploadQueue();
}

async function processUploadQueue() {
  if (isUploading) return;
  isUploading = true;
  uploadSubmitBtn.disabled = true;
  uploadSubmitBtn.textContent = "Uploading...";

  const storageMetadataRaw = storageMetadataInput.value;

  for (const item of uploadQueueItems) {
    if (item.status !== "ready") continue;
    item.status = "uploading";
    renderUploadQueue();

    try {
      item.result = await uploadSingleFile(item.file, storageMetadataRaw);
      item.status = "success";
    } catch (error) {
      item.status = "error";
      item.error = error.message || "Upload failed.";
      item.validationErrors = [item.error];
    }
    renderUploadQueue();
  }

  isUploading = false;
  uploadSubmitBtn.disabled = false;
  uploadSubmitBtn.textContent = "Upload";

  const succeeded = uploadQueueItems.filter((i) => i.status === "success").length;
  const failed = uploadQueueItems.filter((i) => i.status === "error").length;
  const total = uploadQueueItems.length;

  if (failed === 0 && succeeded > 0) {
    showToast(`All ${succeeded} file${succeeded > 1 ? "s" : ""} uploaded successfully.`);
  } else if (succeeded > 0) {
    showToast(`${succeeded}/${total} uploaded. ${failed} failed — check errors below.`);
  } else if (failed > 0) {
    showToast(`All ${failed} file${failed > 1 ? "s" : ""} failed. Check errors below.`);
  }

  uploadForm.reset();
  if (dropZoneText) {
    dropZoneText.textContent = defaultDropText;
    dropZone.classList.remove("has-file");
  }
  await refreshFilesystem({ force: true });
}

function removeQueueItem(itemId) {
  uploadQueueItems = uploadQueueItems.filter((i) => i.id !== itemId);
  if (uploadQueueItems.length === 0) uploadQueue.hidden = true;
  renderUploadQueue();
}

function clearUploadQueue() {
  // Only clear completed/errored items, keep in-progress
  if (isUploading) {
    uploadQueueItems = uploadQueueItems.filter((i) => i.status === "uploading");
  } else {
    uploadQueueItems = [];
    uploadQueue.hidden = true;
  }
  renderUploadQueue();
}

function renderUploadQueue() {
  if (!uploadQueueItems.length) {
    uploadQueue.hidden = true;
    return;
  }

  const succeeded = uploadQueueItems.filter((i) => i.status === "success").length;
  const failed = uploadQueueItems.filter((i) => i.status === "error").length;
  const pending = uploadQueueItems.filter((i) => ["pending", "validating", "ready"].includes(i.status)).length;
  const uploading = uploadQueueItems.filter((i) => i.status === "uploading").length;

  const parts = [];
  if (uploading) parts.push(`${uploading} uploading`);
  if (pending) parts.push(`${pending} ready`);
  if (succeeded) parts.push(`${succeeded} done`);
  if (failed) parts.push(`${failed} failed`);
  uploadQueueSummary.textContent = parts.join(" \u00b7 ");

  const hasUploadable = uploadQueueItems.some((i) => i.status === "ready");
  uploadSubmitBtn.disabled = isUploading || !hasUploadable;

  uploadQueueList.innerHTML = uploadQueueItems
    .map((item) => {
      const statusIcon = {
        pending: "\u23f3",
        validating: "\u23f3",
        ready: "\u2705",
        uploading: "\u25b6",
        success: "\u2714",
        error: "\u2718",
      }[item.status] || "?";

      const statusClass = `uq-item--${item.status}`;
      const sizeStr = formatBytes(item.file.size);

      let errorsHtml = "";
      if (item.validationErrors && item.validationErrors.length > 0) {
        errorsHtml = `<div class="uq-item__errors">${item.validationErrors.map((e) => `<div class="uq-item__error">${escapeHtml(e)}</div>`).join("")}</div>`;
      }

      return `<div class="uq-item ${statusClass}" data-uq-id="${item.id}">
        <div class="uq-item__row">
          <span class="uq-item__icon">${statusIcon}</span>
          <span class="uq-item__name" title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</span>
          <span class="uq-item__size">${sizeStr}</span>
          <span class="uq-item__status">${item.status}</span>
          <button type="button" class="uq-item__remove" data-uq-remove="${item.id}" title="Remove">&times;</button>
        </div>
        ${errorsHtml}
      </div>`;
    })
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function createFolder(path) {
  const response = await fetch(`${apiBase}/files/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || "Failed to create folder.");
  }
  return response.json();
}

async function deleteFolder(path) {
  const response = await fetch(`${apiBase}/files/folders/${encodeURIComponent(path)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || "Failed to delete folder.");
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

async function moveFeedFile(fileId, targetFolderPath) {
  const response = await fetch(`${apiBase}/files/feed/${fileId}/move`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_folder_path: targetFolderPath }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || "Failed to move file.");
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

async function renameFeedFile(fileId, newFilename) {
  const response = await fetch(`${apiBase}/files/feed/${fileId}/rename`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_filename: newFilename }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || "Failed to rename file.");
  }
  return response.json();
}

async function renameFeedFolder(oldPath, newName) {
  const response = await fetch(`${apiBase}/files/folders/${encodeURIComponent(oldPath)}/rename`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_name: newName }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || "Failed to rename folder.");
  }
  return response.json();
}

async function moveFeedFolder(sourcePath, targetParentPath) {
  const response = await fetch(`${apiBase}/files/folders/${encodeURIComponent(sourcePath)}/move`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_parent_path: targetParentPath }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || "Failed to move folder.");
  }
  return response.json();
}

// ═══════════════════════════════════════════════════════════════
// REAL-TIME POLLING
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

function startPolling() {
  stopPolling();
  pollingTimer = setInterval(async () => {
    try {
      await refreshFilesystem();
    } catch {
      // silently handle polling errors; indicator shows status
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
// RESIZABLE PANELS
// ═══════════════════════════════════════════════════════════════

function initResize(handleEl, getTarget, setSize, minPx, maxPx) {
  let startX = 0;
  let startSize = 0;
  let direction = 1;

  function onMouseDown(e) {
    e.preventDefault();
    const target = getTarget();
    if (!target) return;
    startX = e.clientX;
    startSize = target.getBoundingClientRect().width;
    handleEl.classList.add("dragging");
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function onMouseMove(e) {
    const delta = (e.clientX - startX) * direction;
    const newSize = Math.min(maxPx, Math.max(minPx, startSize + delta));
    setSize(newSize);
  }

  function onMouseUp() {
    handleEl.classList.remove("dragging");
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  handleEl.addEventListener("mousedown", (e) => {
    direction = handleEl.classList.contains("resize-handle--chat") ? -1 : 1;
    onMouseDown(e);
  });
}

// Folder panel resize
initResize(
  resizeFolderHandle,
  () => folderPanelEl,
  (w) => { fsGridEl.style.setProperty("--folder-panel-width", `${w}px`); },
  100,
  500,
);

// Chat panel resize
initResize(
  resizeChatHandle,
  () => panelChat,
  (w) => { workspaceEl.style.setProperty("--chat-panel-width", `${w}px`); },
  200,
  600,
);

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function buildFolderPathFromInput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const isAbsolute = trimmed.startsWith("/");
  const cleaned = trimmed.replace(/^\/+/, "");
  if (!cleaned) return "";
  if (isAbsolute || !currentFolderPath) return cleaned;
  return `${currentFolderPath}/${cleaned}`;
}

function showToast(message) {
  uploadResult.textContent = message;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { uploadResult.textContent = ""; }, 6000);
}

function getDraggedFileId(dataTransfer) {
  if (draggingFileId) return draggingFileId;
  if (!dataTransfer) return "";
  return dataTransfer.getData("application/x-file-id") || dataTransfer.getData("text/plain") || "";
}

function hasDraggedFile(dataTransfer) {
  if (draggingFileId) return true;
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types || []);
  if (types.includes("application/x-folder-path")) return false;
  return types.includes("application/x-file-id");
}

function addFileToSmokeContext(fileId) {
  if (!fileId) return;
  const file = getFileById(fileId);
  if (!file) {
    showToast("File not found.");
    return;
  }

  const alreadyInContext = selectedContextFileIds.has(fileId);
  selectedContextFileIds.add(fileId);
  renderContextInfo();
  renderFileList();
  renderLoadedFiles();
  showToast(alreadyInContext ? "File already in Smoke context." : "File loaded into Smoke context.");
}

// ═══════════════════════════════════════════════════════════════
// INLINE RENAME
// ═══════════════════════════════════════════════════════════════

function startFileRename(fileId, nameEl) {
  if (nameEl.querySelector("input")) return;

  const currentName = nameEl.textContent.trim();
  const input = document.createElement("input");
  input.type = "text";
  input.value = currentName;
  input.className = "rename-input";

  nameEl.textContent = "";
  nameEl.appendChild(input);
  input.focus();
  input.select();

  let committed = false;

  async function save() {
    const newName = input.value.trim();
    if (!newName || newName === currentName) {
      restore();
      return;
    }
    try {
      await renameFeedFile(fileId, newName);
      showToast(`Renamed to ${newName}.`);
      await refreshFilesystem({ force: true });
    } catch (error) {
      showToast(toErrorMessage(error, "Failed to rename file."));
      restore();
    }
  }

  function restore() {
    nameEl.textContent = currentName;
  }

  function commit() {
    if (committed) return;
    committed = true;
    save();
  }

  function abort() {
    if (committed) return;
    committed = true;
    restore();
  }

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); abort(); }
  });
  input.addEventListener("blur", () => commit());
  input.addEventListener("click", (e) => e.stopPropagation());
}

function startFolderRename(folderPath, folderNode) {
  if (folderNode.querySelector("input")) return;

  const currentName = folderPath.split("/").pop();
  const input = document.createElement("input");
  input.type = "text";
  input.value = currentName;
  input.className = "rename-input rename-input--folder";

  folderNode.textContent = "";
  folderNode.appendChild(input);
  input.focus();
  input.select();

  let committed = false;

  async function save() {
    const newName = input.value.trim();
    if (!newName || newName === currentName) {
      restore();
      return;
    }
    try {
      const result = await renameFeedFolder(folderPath, newName);
      showToast(`Renamed folder to ${newName}.`);
      if (currentFolderPath === folderPath) {
        currentFolderPath = result.path;
      } else if (currentFolderPath.startsWith(folderPath + "/")) {
        currentFolderPath = currentFolderPath.replace(folderPath, result.path);
      }
      await refreshFilesystem({ force: true });
    } catch (error) {
      showToast(toErrorMessage(error, "Failed to rename folder."));
      restore();
    }
  }

  function restore() {
    folderNode.textContent = currentName;
  }

  function commit() {
    if (committed) return;
    committed = true;
    save();
  }

  function abort() {
    if (committed) return;
    committed = true;
    restore();
  }

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); abort(); }
  });
  input.addEventListener("blur", () => commit());
  input.addEventListener("click", (e) => e.stopPropagation());
}

// ═══════════════════════════════════════════════════════════════
// CONTEXT MENU (right-click on folders)
// ═══════════════════════════════════════════════════════════════

function showCtxMenu(x, y, folderPath) {
  ctxMenuFolderPath = folderPath;
  folderCtxMenu.hidden = false;
  folderCtxMenu.style.left = `${x}px`;
  folderCtxMenu.style.top = `${y}px`;
}

function hideCtxMenu() {
  folderCtxMenu.hidden = true;
  ctxMenuFolderPath = null;
}

document.addEventListener("click", () => hideCtxMenu());
document.addEventListener("contextmenu", (e) => {
  if (!folderCtxMenu.contains(e.target)) hideCtxMenu();
});

folderTree.addEventListener("contextmenu", (e) => {
  const target = e.target;
  if (!(target instanceof Element)) return;
  const folderNode = target.closest(".folder-node");
  if (!(folderNode instanceof HTMLButtonElement)) return;

  const folderPath = folderNode.dataset.folderPath;
  // Don't allow deleting root
  if (folderPath === "" || folderPath === undefined) return;

  e.preventDefault();
  showCtxMenu(e.clientX, e.clientY, folderPath);
});

ctxDeleteFolder.addEventListener("click", async () => {
  const path = ctxMenuFolderPath;
  hideCtxMenu();
  if (!path) return;

  if (!window.confirm(`Delete folder /${path} and all its contents?`)) return;

  try {
    await deleteFolder(path);
    showToast(`Deleted folder /${path}.`);
    if (currentFolderPath === path || currentFolderPath.startsWith(path + "/")) {
      currentFolderPath = "";
    }
    await refreshFilesystem({ force: true });
  } catch (error) {
    showToast(toErrorMessage(error, "Failed to delete folder."));
  }
});

// ═══════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════

// ── Theme toggle ──
themeToggleBtn.addEventListener("click", toggleTheme);

// ── Sidebar panel switching ──
sidebarBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const panel = btn.dataset.panel;
    sidebarBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    if (panel === "chat") {
      panelChat.classList.add("visible");
    } else {
      panelChat.classList.remove("visible");
    }
  });
});

// ── Show selected filenames before upload ──
const dropZoneText = dropZone?.querySelector(".paste-zone__text");
const defaultDropText = dropZoneText?.textContent || "";

// ── Upload ──
uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  // If queue has ready items, process them
  const hasReady = uploadQueueItems.some((i) => i.status === "ready");
  if (hasReady) {
    // Validate storage metadata JSON before uploading
    if (storageMetadataInput.value.trim() !== "") {
      try { JSON.parse(storageMetadataInput.value); }
      catch { showToast("Invalid storage metadata JSON."); return; }
    }
    await processUploadQueue();
    return;
  }

  // Otherwise, add files from input to queue
  const files = fileInput.files;
  if (!files || files.length === 0) {
    showToast("Choose files before uploading.");
    return;
  }
  addFilesToQueue(files);
});

// ── Drop zone visual feedback ──
if (dropZone) {
  ["dragenter", "dragover"].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    dropZone.addEventListener(evt, () => {
      dropZone.classList.remove("drag-over");
    });
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (files?.length) {
      addFilesToQueue(files);
    }
  });
}

fileInput.addEventListener("change", () => {
  const files = fileInput.files;
  if (!files || files.length === 0) return;
  if (files.length === 1 && dropZoneText) {
    dropZoneText.textContent = files[0].name;
    dropZone.classList.add("has-file");
  } else if (dropZoneText) {
    dropZoneText.textContent = `${files.length} files selected`;
    dropZone.classList.add("has-file");
  }
  addFilesToQueue(files);
  // Reset input so re-selecting same files triggers change
  fileInput.value = "";
});

// ── Upload queue interactions ──
uploadQueueClear.addEventListener("click", clearUploadQueue);
uploadQueueList.addEventListener("click", (e) => {
  const removeBtn = e.target.closest("[data-uq-remove]");
  if (removeBtn) removeQueueItem(removeBtn.dataset.uqRemove);
});

// ── Create folder ──
createFolderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const raw = createFolderInput.value;
  const path = buildFolderPathFromInput(raw);
  if (!path) {
    showToast("Enter a valid folder path.");
    return;
  }
  try {
    const created = await createFolder(path);
    showToast(`Folder created: /${created.path}`);
    createFolderForm.reset();
    await refreshFilesystem({ force: true });
  } catch (error) {
    showToast(toErrorMessage(error, "Failed to create folder."));
  }
});

// ── Refresh ──
refreshBtn.addEventListener("click", async () => {
  try {
    await refreshFilesystem({ force: true });
    showToast("Refreshed.");
  } catch (error) {
    showToast(toErrorMessage(error, "Failed to refresh."));
  }
});

// ── Preview modal ──
closePreviewBtn.addEventListener("click", closePreview);
previewModal.addEventListener("click", (event) => {
  if (event.target === previewModal) closePreview();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !previewModal.hidden) closePreview();
});

// ── Chat context clear ──
clearChatContextBtn.addEventListener("click", () => {
  selectedContextFileIds.clear();
  renderContextInfo();
  renderFileList();
  renderLoadedFiles();
});

// ── Loaded files chip removal ──
loadedFilesList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const btn = target.closest("[data-remove-context]");
  if (!btn) return;
  const fileId = btn.dataset.removeContext;
  if (fileId) {
    selectedContextFileIds.delete(fileId);
    renderContextInfo();
    renderFileList();
    renderLoadedFiles();
  }
});

// ── Folder tree navigation + collapse toggle + inline delete ──
folderTree.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  // Chevron toggle (collapse/expand)
  const chevronBtn = target.closest("[data-action='toggle-collapse']");
  if (chevronBtn) {
    event.stopPropagation();
    const path = chevronBtn.dataset.folderPath;
    if (path === undefined) return;
    if (collapsedFolders.has(path)) {
      collapsedFolders.delete(path);
    } else {
      collapsedFolders.add(path);
    }
    persistCollapsedFolders();
    renderFolderTree();
    return;
  }

  // Inline delete button
  const deleteBtn = target.closest("[data-action='delete-folder']");
  if (deleteBtn) {
    const path = deleteBtn.dataset.folderPath;
    if (!path) return;
    if (!window.confirm(`Delete folder /${path} and all its contents?`)) return;
    try {
      await deleteFolder(path);
      showToast(`Deleted folder /${path}.`);
      if (currentFolderPath === path || currentFolderPath.startsWith(path + "/")) {
        currentFolderPath = "";
      }
      await refreshFilesystem({ force: true });
    } catch (error) {
      showToast(toErrorMessage(error, "Failed to delete folder."));
    }
    return;
  }

  // Navigate to folder (delayed to allow double-click rename)
  const folderNode = target.closest(".folder-node");
  if (!(folderNode instanceof HTMLButtonElement)) return;
  if (folderNode.querySelector("input")) return;
  clearTimeout(folderClickTimer);
  folderClickTimer = setTimeout(() => {
    currentFolderPath = folderNode.dataset.folderPath || "";
    renderAll();
  }, 250);
});

// ── Drag & Drop files and folders ──
fileListEl.addEventListener("dragstart", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const row = target.closest(".file-row[data-file-id]");
  if (!row || !event.dataTransfer) return;
  const fileId = row.dataset.fileId || "";
  draggingFileId = fileId;
  event.dataTransfer.setData("application/x-file-id", fileId);
  event.dataTransfer.setData("text/plain", fileId);
  event.dataTransfer.effectAllowed = "copyMove";
});

folderTree.addEventListener("dragstart", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const row = target.closest(".folder-row[data-folder-path]");
  if (!row || !event.dataTransfer) return;
  const folderPath = row.dataset.folderPath;
  if (!folderPath) return;
  draggingFileId = "";
  event.dataTransfer.setData("application/x-folder-path", folderPath);
  event.dataTransfer.effectAllowed = "move";
});

function clearFolderDropHighlight() {
  for (const node of folderTree.querySelectorAll(".folder-node.drop-over")) {
    node.classList.remove("drop-over");
  }
}

folderTree.addEventListener("dragover", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const folderNode = target.closest(".folder-node");
  if (!(folderNode instanceof HTMLButtonElement)) return;
  event.preventDefault();
  clearFolderDropHighlight();
  folderNode.classList.add("drop-over");
});

folderTree.addEventListener("dragleave", () => clearFolderDropHighlight());

folderTree.addEventListener("drop", async (event) => {
  const target = event.target;
  if (!(target instanceof Element) || !event.dataTransfer) return;
  const folderNode = target.closest(".folder-node");
  if (!(folderNode instanceof HTMLButtonElement)) return;

  event.preventDefault();
  clearFolderDropHighlight();

  const targetFolderPath = folderNode.dataset.folderPath ?? "";

  // Check if a folder is being dropped
  const draggedFolderPath = event.dataTransfer.getData("application/x-folder-path");
  if (draggedFolderPath) {
    if (draggedFolderPath === targetFolderPath) return;
    if (targetFolderPath.startsWith(draggedFolderPath + "/")) return;
    const currentParent = draggedFolderPath.includes("/")
      ? draggedFolderPath.substring(0, draggedFolderPath.lastIndexOf("/"))
      : "";
    if (currentParent === targetFolderPath) return;

    try {
      const result = await moveFeedFolder(draggedFolderPath, targetFolderPath);
      showToast(`Moved folder to ${displayFolderPath(targetFolderPath)}.`);
      if (currentFolderPath === draggedFolderPath) {
        currentFolderPath = result.path;
      } else if (currentFolderPath.startsWith(draggedFolderPath + "/")) {
        currentFolderPath = currentFolderPath.replace(draggedFolderPath, result.path);
      }
      await refreshFilesystem({ force: true });
    } catch (error) {
      showToast(toErrorMessage(error, "Failed to move folder."));
    }
    return;
  }

  // Otherwise handle file drop
  const fileId = getDraggedFileId(event.dataTransfer);
  if (!fileId) return;

  try {
    await moveFeedFile(fileId, targetFolderPath);
    showToast(`Moved file to ${displayFolderPath(targetFolderPath)}.`);
    await refreshFilesystem({ force: true });
  } catch (error) {
    showToast(toErrorMessage(error, "Failed to move file."));
  }
});

function clearContextDropHighlight() {
  loadedFilesList.classList.remove("drop-over");
}

function clearChatDropHighlight() {
  panelChat.classList.remove("drop-over");
}

function handleSmokeContextDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  clearContextDropHighlight();
  clearChatDropHighlight();
  if (!hasDraggedFile(event.dataTransfer)) return;

  const fileId = getDraggedFileId(event.dataTransfer);
  if (!fileId) {
    showToast("Could not read dragged file.");
    return;
  }

  addFileToSmokeContext(fileId);
}

panelChat.addEventListener("dragover", (event) => {
  if (!hasDraggedFile(event.dataTransfer)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  panelChat.classList.add("drop-over");
});

panelChat.addEventListener("dragleave", (event) => {
  const target = event.target;
  if (!(target instanceof Node)) return;
  const related = event.relatedTarget;
  if (related instanceof Node && panelChat.contains(related)) return;
  clearChatDropHighlight();
});

panelChat.addEventListener("drop", (event) => {
  handleSmokeContextDrop(event);
});

loadedFilesList.addEventListener("dragover", (event) => {
  if (!hasDraggedFile(event.dataTransfer)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  loadedFilesList.classList.add("drop-over");
  panelChat.classList.add("drop-over");
});

loadedFilesList.addEventListener("dragleave", (event) => {
  const target = event.target;
  if (!(target instanceof Node)) return;
  const related = event.relatedTarget;
  if (related instanceof Node && loadedFilesList.contains(related)) return;
  clearContextDropHighlight();
});

loadedFilesList.addEventListener("drop", (event) => {
  handleSmokeContextDrop(event);
});

document.addEventListener("dragend", () => {
  clearFolderDropHighlight();
  clearContextDropHighlight();
  clearChatDropHighlight();
  draggingFileId = "";
});

// ── Double-click to rename (files and folders) ──
fileListEl.addEventListener("dblclick", (event) => {
  clearTimeout(fileClickTimer);
  const target = event.target;
  if (!(target instanceof Element)) return;
  const nameEl = target.closest(".file-row__name");
  if (!nameEl) return;
  const fileId = nameEl.dataset.id;
  if (!fileId) return;
  startFileRename(fileId, nameEl);
});

folderTree.addEventListener("dblclick", (event) => {
  clearTimeout(folderClickTimer);
  const target = event.target;
  if (!(target instanceof Element)) return;
  const folderNode = target.closest(".folder-node");
  if (!(folderNode instanceof HTMLButtonElement)) return;
  const folderPath = folderNode.dataset.folderPath;
  if (folderPath === "" || folderPath === undefined) return;
  startFolderRename(folderPath, folderNode);
});

// ── File list actions (click filename to preview, toggle smoke, delete, approve) ──
fileListEl.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  // Click filename → open preview popup (delayed to allow double-click rename)
  const nameEl = target.closest("[data-action='open-preview']");
  if (nameEl) {
    if (nameEl.querySelector("input")) return;
    const fileId = nameEl.dataset.id;
    if (!fileId) return;
    clearTimeout(fileClickTimer);
    fileClickTimer = setTimeout(async () => {
      try {
        const preview = await fetchPreview(fileId);
        openPreview(preview);
      } catch (error) {
        showToast(toErrorMessage(error, "Failed to load preview."));
      }
    }, 250);
    return;
  }

  // Button actions
  const button = target.closest("button[data-action]");
  if (!(button instanceof HTMLButtonElement)) return;

  const action = button.dataset.action;
  const fileId = button.dataset.id;
  if (!action || !fileId) return;

  if (action === "toggle-smoke-context") {
    if (selectedContextFileIds.has(fileId)) {
      selectedContextFileIds.delete(fileId);
    } else {
      selectedContextFileIds.add(fileId);
    }
    renderContextInfo();
    renderFileList();
    renderLoadedFiles();
    return;
  }

  if (action === "delete-file") {
    const file = getFileById(fileId);
    const label = file ? `${file.original_filename} (${fileId})` : fileId;
    if (!window.confirm(`Delete file ${label}?`)) return;
  }

  button.disabled = true;
  try {
    if (action === "mark-indexed") {
      await markIndexed(fileId);
      showToast("File approved and marked as indexed.");
      await refreshFilesystem({ force: true });
      return;
    }
    if (action === "delete-file") {
      await deleteFeedFile(fileId);
      selectedContextFileIds.delete(fileId);
      if (previewedFileId === fileId) closePreview();
      await refreshFilesystem({ force: true });
      showToast(`Deleted file ${fileId}.`);
    }
  } catch (error) {
    showToast(toErrorMessage(error, "Action failed."));
  } finally {
    button.disabled = false;
  }
});

// ── Chat (shows user message immediately as bubble) ──
chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  // Show user bubble immediately
  addChatBubble(text, "user");
  chatForm.reset();
  if (chatSubmitBtn) chatSubmitBtn.disabled = true;

  // Show loading bubble
  const loadingBubble = addChatBubble("Thinking...", "loading");

  const payload = { messages: [{ role: "user", content: text }] };
  if (selectedContextFileIds.size > 0) {
    payload.context_file_ids = Array.from(selectedContextFileIds);
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 25000);

  try {
    const response = await fetch(`${apiBase}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload.detail || "Chat request failed.");
    }

    const responsePayload = await response.json();
    const loadedCount = Array.isArray(responsePayload.context_files_loaded)
      ? responsePayload.context_files_loaded.length
      : 0;
    const reply = typeof responsePayload.reply === "string" ? responsePayload.reply : "";

    // Remove loading bubble, add assistant response
    removeBubble(loadingBubble);

    if (!reply) {
      addChatBubble("Empty response received.", "assistant");
    } else if (loadedCount > 0) {
      addChatBubble(`[${loadedCount} context files loaded] ${reply}`, "assistant");
    } else {
      addChatBubble(reply, "assistant");
    }
  } catch (error) {
    removeBubble(loadingBubble);

    if (error instanceof DOMException && error.name === "AbortError") {
      addChatBubble("Chat timeout after 25s.", "assistant");
      return;
    }
    const message = toErrorMessage(error, "Chat request failed.");
    if (message === "Failed to fetch") {
      addChatBubble("Cannot reach backend.", "assistant");
      return;
    }
    addChatBubble(message, "assistant");
  } finally {
    window.clearTimeout(timeoutId);
    if (chatSubmitBtn) chatSubmitBtn.disabled = false;
  }
});

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

applyTheme(getStoredTheme());
closePreview();
refreshFilesystem({ force: true })
  .then(() => startPolling())
  .catch((error) => {
    showToast(toErrorMessage(error, "Failed to load filesystem."));
    startPolling();
  });
