/* UFABC Feed Console — Ingestion Page Logic */

const apiBase = "/api/v1";
const INGESTION_DRAFT_KEY = "ufabc-ingestion-draft-v1";
const INGESTION_FOLDERS_CACHE_KEY = "ufabc-ingestion-folders-v1";
const INGESTION_DRAFT_MAX_BYTES = 200 * 1024;

const sourceFileInput = document.getElementById("source-file-input");
const sourceTextEl = document.getElementById("source-text");
const transformBtn = document.getElementById("transform-btn");
const previewSection = document.getElementById("preview-section");
const commitSection = document.getElementById("commit-section");
const metadataKv = document.getElementById("metadata-kv");
const metadataTags = document.getElementById("metadata-tags");
const markdownOutput = document.getElementById("markdown-output");
const filenameInput = document.getElementById("filename-input");
const folderSelect = document.getElementById("folder-select");
const commitBtn = document.getElementById("commit-btn");
const storageMetadataInput = document.getElementById("storage-metadata-input");
const toastEl = document.getElementById("ingestion-toast");
const refreshFoldersBtn = document.getElementById("refresh-folders-btn");
const liveIndicator = document.getElementById("live-indicator");
const themeToggleBtn = document.getElementById("theme-toggle-btn");
const themeIconMoon = document.getElementById("theme-icon-moon");
const themeIconSun = document.getElementById("theme-icon-sun");

let transformedMetadata = null;
let draftSaveTimer = null;

function showToast(message) {
  toastEl.textContent = message;
}

function readJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function estimateBytes(text) {
  return new TextEncoder().encode(text).length;
}

function persistDraft({ includeLargeFields = true, silent = false } = {}) {
  const markdownText = includeLargeFields ? markdownOutput.value : "";
  const sourceText = includeLargeFields ? sourceTextEl.value : sourceTextEl.value.slice(0, 4000);
  const draft = {
    source_text: sourceText,
    markdown_text: markdownText,
    metadata: transformedMetadata,
    filename: filenameInput.value,
    folder_path: folderSelect.value || "",
    storage_metadata: storageMetadataInput.value,
    preview_visible: !previewSection.hidden,
    commit_visible: !commitSection.hidden,
    has_large_fields: includeLargeFields,
  };
  const serialized = JSON.stringify(draft);
  if (estimateBytes(serialized) > INGESTION_DRAFT_MAX_BYTES) {
    if (!silent) {
      showToast("Rascunho grande demais para salvar completo. Mantendo apenas campos essenciais.");
    }
    const reducedDraft = {
      ...draft,
      source_text: sourceTextEl.value.slice(0, 4000),
      markdown_text: "",
      has_large_fields: false,
    };
    localStorage.setItem(INGESTION_DRAFT_KEY, JSON.stringify(reducedDraft));
    return;
  }
  localStorage.setItem(INGESTION_DRAFT_KEY, serialized);
}

function schedulePersistDraft() {
  if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
  draftSaveTimer = window.setTimeout(() => {
    persistDraft({ includeLargeFields: false, silent: true });
  }, 700);
}

function restoreDraft() {
  const draft = readJsonStorage(INGESTION_DRAFT_KEY, null);
  if (!draft || typeof draft !== "object") return;

  sourceTextEl.value = typeof draft.source_text === "string" ? draft.source_text : "";
  markdownOutput.value = typeof draft.markdown_text === "string" ? draft.markdown_text : "";
  filenameInput.value = typeof draft.filename === "string" ? draft.filename : "";
  storageMetadataInput.value =
    typeof draft.storage_metadata === "string" ? draft.storage_metadata : "";
  transformedMetadata = draft.metadata && typeof draft.metadata === "object" ? draft.metadata : null;

  if (transformedMetadata) renderMetadata(transformedMetadata);
  previewSection.hidden = !(draft.preview_visible === true);
  commitSection.hidden = !(draft.commit_visible === true);
  if (draft.has_large_fields === false && !draft.markdown_text) {
    showToast("Rascunho restaurado parcialmente (conteudo grande nao foi salvo).");
  }
}

function toErrorMessage(error, fallbackMessage) {
  if (error instanceof Error && error.message.trim() !== "") return error.message;
  return fallbackMessage;
}

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

function setLiveStatus(online) {
  const dot = liveIndicator.querySelector(".pulse-dot");
  if (!dot) return;
  if (online) {
    dot.classList.remove("offline");
  } else {
    dot.classList.add("offline");
  }
}

function displayFolderPath(folderPath) {
  return folderPath ? `/${folderPath}` : "/";
}

function renderMetadata(metadata) {
  const keyOrder = [
    "id",
    "titulo",
    "tipo",
    "dominio",
    "subdominio",
    "versao",
    "status",
    "fonte",
    "atualizado_em",
  ];
  const rows = keyOrder
    .filter((key) => key in metadata)
    .map(
      (key) => `
        <div class="metadata-kv__row">
          <span class="metadata-kv__key">${key}</span>
          <span class="metadata-kv__value">${String(metadata[key])}</span>
        </div>
      `,
    )
    .join("");
  metadataKv.innerHTML = rows || '<p class="metadata-kv__value">No metadata.</p>';

  const tags = Array.isArray(metadata.tags) ? metadata.tags : [];
  metadataTags.innerHTML = tags
    .map((tag) => `<span class="metadata-tag">${tag}</span>`)
    .join("");
}

function parseStorageMetadata() {
  const raw = storageMetadataInput.value.trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Storage metadata deve ser um objeto JSON.");
  }
  return parsed;
}

function renderFolderOptions(paths, selectedValue = "") {
  const normalized = Array.from(new Set((paths || []).filter((item) => typeof item === "string")))
    .sort((a, b) => a.localeCompare(b));
  const options = ['<option value="">/</option>'];
  for (const path of normalized) {
    if (!path) continue;
    options.push(`<option value="${path}">${displayFolderPath(path)}</option>`);
  }
  folderSelect.innerHTML = options.join("");
  if (normalized.includes(selectedValue)) {
    folderSelect.value = selectedValue;
  } else {
    folderSelect.value = "";
  }
}

async function fetchFoldersFromFilesFallback() {
  const response = await fetch(`${apiBase}/files/feed?limit=200&offset=0`);
  if (!response.ok) throw new Error("Nao foi possivel carregar pastas (fallback).");
  const payload = await response.json();
  const files = Array.isArray(payload) ? payload : [];
  const folders = files
    .map((item) => (item && typeof item.folder_path === "string" ? item.folder_path : ""))
    .filter((path) => path !== "");
  return Array.from(new Set(folders));
}

async function refreshFolders() {
  const selectedBefore = folderSelect.value || readJsonStorage(INGESTION_DRAFT_KEY, {}).folder_path || "";
  try {
    const response = await fetch(`${apiBase}/files/tree`);
    if (!response.ok) throw new Error("tree-failed");
    const payload = await response.json();
    const folders = Array.isArray(payload.folders) ? payload.folders.map((item) => item.path) : [];
    renderFolderOptions(folders, selectedBefore);
    localStorage.setItem(INGESTION_FOLDERS_CACHE_KEY, JSON.stringify(folders));
    return;
  } catch {
    try {
      const folders = await fetchFoldersFromFilesFallback();
      renderFolderOptions(folders, selectedBefore);
      localStorage.setItem(INGESTION_FOLDERS_CACHE_KEY, JSON.stringify(folders));
      return;
    } catch (fallbackError) {
      const cached = readJsonStorage(INGESTION_FOLDERS_CACHE_KEY, []);
      if (Array.isArray(cached) && cached.length > 0) {
        renderFolderOptions(cached, selectedBefore);
        throw new Error("Pastas indisponiveis no momento. Exibindo cache local.");
      }
      throw new Error("Nao foi possivel carregar as pastas.");
    }
  }
}

async function prepareIngestion() {
  const sourceText = sourceTextEl.value.trim();
  if (sourceText.length < 20) {
    throw new Error("Cole pelo menos 20 caracteres para transformar.");
  }

  const sourceFilename = sourceFileInput.files[0]?.name || null;
  const response = await fetch(`${apiBase}/ingestion/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_text: sourceText, source_filename: sourceFilename }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || "Falha na transformacao com GPT-4o.");
  }

  markdownOutput.value = payload.markdown_text || "";
  filenameInput.value = payload.suggested_filename || "documento-rag.md";
  transformedMetadata = payload.metadata || null;
  renderMetadata(transformedMetadata || {});

  previewSection.hidden = false;
  commitSection.hidden = false;
  persistDraft({ includeLargeFields: true });
  showToast(`Transformado com ${payload.model || "gpt-4o"}. Revise e confirme o upload.`);
}

async function commitIngestion() {
  const markdownText = markdownOutput.value.trim();
  if (!markdownText) throw new Error("Markdown vazio.");

  const filename = filenameInput.value.trim();
  if (!filename) throw new Error("Defina o nome do arquivo.");

  const payload = {
    markdown_text: markdownText,
    filename,
    folder_path: folderSelect.value || "",
    storage_metadata: parseStorageMetadata(),
  };

  const response = await fetch(`${apiBase}/ingestion/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.detail || "Falha ao confirmar upload.");
  }

  const file = body.file || {};
  persistDraft({ includeLargeFields: true });
  showToast(`Upload concluido: ${file.original_filename || filename} em ${displayFolderPath(file.folder_path || "")}.`);
}

sourceFileInput.addEventListener("change", async () => {
  const file = sourceFileInput.files[0];
  if (!file) return;
  const text = await file.text();
  sourceTextEl.value = text;
  persistDraft({ includeLargeFields: false, silent: true });
});

transformBtn.addEventListener("click", async () => {
  transformBtn.disabled = true;
  transformBtn.textContent = "Transformando...";
  try {
    await prepareIngestion();
  } catch (error) {
    showToast(toErrorMessage(error, "Falha ao transformar texto."));
  } finally {
    transformBtn.disabled = false;
    transformBtn.textContent = "Transformar com GPT-4o";
  }
});

commitBtn.addEventListener("click", async () => {
  commitBtn.disabled = true;
  commitBtn.textContent = "Carregando...";
  try {
    await commitIngestion();
    await refreshFolders();
  } catch (error) {
    showToast(toErrorMessage(error, "Falha ao confirmar upload."));
  } finally {
    commitBtn.disabled = false;
    commitBtn.textContent = "Confirmar e carregar";
  }
});

refreshFoldersBtn.addEventListener("click", async () => {
  refreshFoldersBtn.disabled = true;
  try {
    await refreshFolders();
    setLiveStatus(true);
    showToast("Pastas atualizadas.");
  } catch (error) {
    setLiveStatus(false);
    showToast(toErrorMessage(error, "Falha ao atualizar pastas."));
  } finally {
    refreshFoldersBtn.disabled = false;
  }
});

themeToggleBtn.addEventListener("click", toggleTheme);
sourceTextEl.addEventListener("input", schedulePersistDraft);
markdownOutput.addEventListener("input", schedulePersistDraft);
filenameInput.addEventListener("input", schedulePersistDraft);
storageMetadataInput.addEventListener("input", schedulePersistDraft);
folderSelect.addEventListener("change", schedulePersistDraft);

document.addEventListener("DOMContentLoaded", async () => {
  applyTheme(getStoredTheme());
  restoreDraft();
  try {
    await refreshFolders();
    setLiveStatus(true);
  } catch (error) {
    setLiveStatus(false);
    showToast(toErrorMessage(error, "Falha ao carregar pastas."));
  }
  persistDraft({ includeLargeFields: false, silent: true });
});
