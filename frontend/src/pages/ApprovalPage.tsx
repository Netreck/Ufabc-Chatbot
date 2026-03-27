import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "../lib/api";
import {
  clearSessionState,
  loadSessionState,
  saveSessionState,
} from "../lib/sessionState";

function RowMenu({
  fileId,
  onDelete,
}: {
  fileId: string;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="row-menu-wrap" ref={ref}>
      <button
        className="btn btn--ghost btn--xs row-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        title="More options"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      {open && (
        <div className="row-menu">
          <button
            className="row-menu__item row-menu__item--danger"
            onClick={() => {
              setOpen(false);
              onDelete(fileId);
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
            <span>Delete</span>
          </button>
        </div>
      )}
    </div>
  );
}

interface FileItem {
  id: string;
  original_filename: string;
  folder_path: string;
  status: string;
  size_bytes: number;
  created_at: string;
  document_metadata: Record<string, unknown>;
  storage_metadata: Record<string, unknown>;
}

interface PreviewFile {
  id: string;
  name: string;
  markdown: string;
  status: string;
  folderPath: string;
  sizeBytes: number;
  createdAt: string;
  documentMetadata: Record<string, unknown>;
  storageMetadata: Record<string, unknown>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.map((item) => formatMetadataValue(item)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function metadataEntries(metadata?: Record<string, unknown>) {
  return Object.entries(metadata || {}).filter(
    ([, value]) => value !== null && value !== undefined && value !== ""
  );
}

function parseContentDispositionFilename(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]);
  const basicMatch = headerValue.match(/filename="?([^"]+)"?/i);
  return basicMatch?.[1] ?? null;
}

const STATUSES = ["all", "pending", "processing", "indexed", "failed"] as const;
const PAGE_SIZE = 20;

interface ApprovalDraft {
  activeStatus: string;
  searchQuery: string;
  currentPage: number;
  selectedIds: string[];
}

const APPROVAL_DRAFT_KEY = "ufabc:approval:draft:v1";
const APPROVAL_DEFAULT_DRAFT: ApprovalDraft = {
  activeStatus: "all",
  searchQuery: "",
  currentPage: 1,
  selectedIds: [],
};

function sanitizeApprovalDraft(draft: ApprovalDraft): ApprovalDraft {
  return {
    activeStatus: STATUSES.includes(draft.activeStatus as (typeof STATUSES)[number])
      ? draft.activeStatus
      : "all",
    searchQuery: draft.searchQuery.slice(0, 300),
    currentPage: Math.max(1, Math.floor(draft.currentPage || 1)),
    selectedIds: draft.selectedIds.slice(0, 200),
  };
}

export function ApprovalPage() {
  const initialDraft = loadSessionState<ApprovalDraft>(
    APPROVAL_DRAFT_KEY,
    APPROVAL_DEFAULT_DRAFT
  );
  const [files, setFiles] = useState<FileItem[]>([]);
  const [activeStatus, setActiveStatus] = useState<string>(initialDraft.activeStatus);
  const [searchQuery, setSearchQuery] = useState(initialDraft.searchQuery);
  const [currentPage, setCurrentPage] = useState(initialDraft.currentPage);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialDraft.selectedIds)
  );
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [editMode, setEditMode] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef<ApprovalDraft>(initialDraft);
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
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (previewFile) return;
    loadData();
    const timer = setInterval(loadData, 5000);
    return () => clearInterval(timer);
  }, [loadData, previewFile]);

  useEffect(() => {
    if (!previewFile) return;
    document.body.classList.add("preview-open");
    return () => document.body.classList.remove("preview-open");
  }, [previewFile]);

  useEffect(() => {
    draftRef.current = sanitizeApprovalDraft({
      activeStatus,
      searchQuery,
      currentPage,
      selectedIds: Array.from(selectedIds),
    });
  }, [activeStatus, searchQuery, currentPage, selectedIds]);

  useEffect(() => {
    return () => {
      saveSessionState(APPROVAL_DRAFT_KEY, draftRef.current);
    };
  }, []);

  const filtered = files
    .filter((f) => activeStatus === "all" || f.status === activeStatus)
    .filter((f) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        f.original_filename.toLowerCase().includes(q) ||
        (f.folder_path || "").toLowerCase().includes(q)
      );
    })
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(currentPage, totalPages);
  const pageFiles = filtered.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );
  const documentMetadata = metadataEntries(previewFile?.documentMetadata);
  const storageMetadata = metadataEntries(previewFile?.storageMetadata);

  async function handleApprove(id: string) {
    await apiFetch(`/files/feed/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "indexed" }),
    });
    await loadData();
  }

  async function handleDelete(id: string) {
    const file = files.find((f) => f.id === id);
    if (!confirm(`Delete "${file?.original_filename}"? Cannot be undone.`))
      return;
    await apiFetch(`/files/feed/${id}`, { method: "DELETE" });
    selectedIds.delete(id);
    setSelectedIds(new Set(selectedIds));
    await loadData();
  }

  async function handlePreview(file: FileItem) {
    const res = await apiFetch(`/files/feed/${file.id}/preview`);
    if (!res.ok) return;
    const data = await res.json();
    setPreviewFile({
      id: file.id,
      name: file.original_filename,
      markdown: data.markdown_text,
      status: String(data.status ?? file.status),
      folderPath: file.folder_path || "",
      sizeBytes: file.size_bytes,
      createdAt: file.created_at,
      documentMetadata:
        (data.document_metadata as Record<string, unknown>) || file.document_metadata || {},
      storageMetadata:
        (data.storage_metadata as Record<string, unknown>) || file.storage_metadata || {},
    });
    setEditMode(false);
  }

  async function handleDownload(file: FileItem) {
    const res = await apiFetch(`/files/feed/${file.id}/download`);
    if (!res.ok) return;
    const blob = await res.blob();
    const fallbackName = file.original_filename || "download.md";
    const downloadedName =
      parseContentDispositionFilename(res.headers.get("content-disposition")) || fallbackName;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = downloadedName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function refreshPreview(fileId: string) {
    const currentFile = files.find((item) => item.id === fileId);
    const res = await apiFetch(`/files/feed/${fileId}/preview`);
    if (!res.ok) return;
    const data = await res.json();
    setPreviewFile((prev) => ({
      id: fileId,
      name: String(data.original_filename ?? currentFile?.original_filename ?? prev?.name ?? ""),
      markdown: String(data.markdown_text ?? prev?.markdown ?? ""),
      status: String(data.status ?? currentFile?.status ?? prev?.status ?? "pending"),
      folderPath: currentFile?.folder_path ?? prev?.folderPath ?? "",
      sizeBytes: currentFile?.size_bytes ?? prev?.sizeBytes ?? 0,
      createdAt: currentFile?.created_at ?? prev?.createdAt ?? "",
      documentMetadata:
        (data.document_metadata as Record<string, unknown>) ??
        currentFile?.document_metadata ??
        prev?.documentMetadata ??
        {},
      storageMetadata:
        (data.storage_metadata as Record<string, unknown>) ??
        currentFile?.storage_metadata ??
        prev?.storageMetadata ??
        {},
    }));
  }

  async function handleSaveEdit() {
    if (!previewFile) return;
    const markdownText = editorRef.current?.value ?? previewFile.markdown;
    await apiFetch(`/files/feed/${previewFile.id}/content`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown_text: markdownText }),
    });
    await refreshPreview(previewFile.id);
    setEditMode(false);
  }

  async function handleBulkApprove() {
    const targets = files.filter((f) => selectedIds.has(f.id));
    if (!targets.length) return;
    if (!confirm(`Approve ${targets.length} file(s)?`)) return;
    await Promise.allSettled(targets.map((f) => handleApprove(f.id)));
    setSelectedIds(new Set());
  }

  async function handleBulkDelete() {
    const targets = files.filter((f) => selectedIds.has(f.id));
    if (!targets.length) return;
    if (!confirm(`Delete ${targets.length} file(s)? Cannot be undone.`)) return;
    await Promise.allSettled(
      targets.map((f) =>
        apiFetch(`/files/feed/${f.id}`, { method: "DELETE" })
      )
    );
    setSelectedIds(new Set());
    await loadData();
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  function clearDraft() {
    clearSessionState(APPROVAL_DRAFT_KEY);
    setActiveStatus(APPROVAL_DEFAULT_DRAFT.activeStatus);
    setSearchQuery(APPROVAL_DEFAULT_DRAFT.searchQuery);
    setCurrentPage(APPROVAL_DEFAULT_DRAFT.currentPage);
    setSelectedIds(new Set());
    draftRef.current = APPROVAL_DEFAULT_DRAFT;
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar__left">
          <h1 className="topbar__title">Approval Queue</h1>
          <span className="topbar__badge">{filtered.length} files</span>
        </div>
        <div className="topbar__actions">
          <button className="btn btn--ghost btn--sm" onClick={clearDraft}>
            Clear Draft
          </button>
          <button className="btn btn--outline btn--sm" onClick={loadData}>
            Refresh
          </button>
        </div>
      </header>

      <div className="approval-layout">
        {/* Filters */}
        <div className="approval-filters">
          <div className="filter-chips">
            {STATUSES.map((s) => (
              <button
                key={s}
                className={`filter-chip ${activeStatus === s ? "active" : ""}`}
                onClick={() => {
                  setActiveStatus(s);
                  setCurrentPage(1);
                }}
              >
                {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <input
            type="text"
            className="input input--search"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
          />
        </div>

        {/* Bulk bar */}
        {selectedIds.size > 0 && (
          <div className="bulk-bar">
            <span>{selectedIds.size} selected</span>
            <button
              className="btn btn--primary btn--xs"
              onClick={handleBulkApprove}
            >
              Approve Selected
            </button>
            <button
              className="btn btn--danger btn--xs"
              onClick={handleBulkDelete}
            >
              Delete Selected
            </button>
            <button
              className="btn btn--ghost btn--xs"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear
            </button>
          </div>
        )}

        {/* Table */}
        <div className="approval-table-wrap">
          <table className="approval-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}></th>
                <th>Name</th>
                <th>Folder</th>
                <th>Status</th>
                <th>Size</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageFiles.map((file) => (
                <tr
                  key={file.id}
                  className={selectedIds.has(file.id) ? "row-selected" : ""}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(file.id)}
                      onChange={() => toggleSelect(file.id)}
                    />
                  </td>
                  <td>
                    <span
                      className="table-filename"
                      onClick={() => handlePreview(file)}
                      style={{ cursor: "pointer" }}
                    >
                      {file.original_filename}
                    </span>
                  </td>
                  <td>{file.folder_path ? `/${file.folder_path}` : "/"}</td>
                  <td>
                    <span className={`badge ${file.status}`}>
                      {file.status}
                    </span>
                  </td>
                  <td>{formatBytes(file.size_bytes)}</td>
                  <td>{formatDate(file.created_at)}</td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="btn btn--ghost btn--xs"
                        onClick={() => handlePreview(file)}
                      >
                        Preview
                      </button>
                      <button
                        className="btn btn--ghost btn--xs"
                        onClick={() => handleDownload(file)}
                      >
                        Download
                      </button>
                      {file.status !== "indexed" && (
                        <button
                          className="btn btn--primary btn--xs"
                          onClick={() => handleApprove(file.id)}
                        >
                          Approve
                        </button>
                      )}
                      <RowMenu
                        fileId={file.id}
                        onDelete={handleDelete}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pageFiles.length === 0 && (
            <p
              style={{
                padding: "var(--space-6)",
                textAlign: "center",
                color: "var(--text-muted)",
              }}
            >
              No files match the current filter.
            </p>
          )}
        </div>

        {/* Pagination */}
        <div className="approval-pagination">
          <button
            className="btn btn--ghost btn--sm"
            disabled={page <= 1}
            onClick={() => setCurrentPage(page - 1)}
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            className="btn btn--ghost btn--sm"
            disabled={page >= totalPages}
            onClick={() => setCurrentPage(page + 1)}
          >
            Next
          </button>
        </div>
      </div>

      {/* Preview modal */}
      {previewFile &&
        createPortal(
          <div
            className="modal-overlay"
            onClick={(e) => {
              if (e.target === e.currentTarget) setPreviewFile(null);
            }}
          >
            <div className="modal" role="dialog">
              <div className="modal__header">
                <h2 className="modal__title">{previewFile.name}</h2>
                <div className="modal__header-actions">
                  {!editMode ? (
                    <button
                      className="btn btn--ghost btn--xs"
                      onClick={() => setEditMode(true)}
                    >
                      Edit
                    </button>
                  ) : (
                    <>
                      <button
                        className="btn btn--primary btn--xs"
                        onClick={handleSaveEdit}
                      >
                        Save
                      </button>
                      <button
                        className="btn btn--ghost btn--xs"
                        onClick={() => setEditMode(false)}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  <button
                    className="modal__close"
                    onClick={() => setPreviewFile(null)}
                  >
                    &times;
                  </button>
                </div>
              </div>
              <div className="modal__body">
                <div className="preview-layout">
                  <section className="preview-meta-panel">
                    <div className="preview-meta-grid">
                      <div className="preview-meta-item">
                        <span className="preview-meta-label">Status</span>
                        <span className="preview-meta-value">
                          <span className={`badge ${previewFile.status}`}>
                            {previewFile.status}
                          </span>
                        </span>
                      </div>
                      <div className="preview-meta-item">
                        <span className="preview-meta-label">Folder</span>
                        <span className="preview-meta-value">
                          {previewFile.folderPath ? `/${previewFile.folderPath}` : "/"}
                        </span>
                      </div>
                      <div className="preview-meta-item">
                        <span className="preview-meta-label">Size</span>
                        <span className="preview-meta-value">
                          {formatBytes(previewFile.sizeBytes)}
                        </span>
                      </div>
                      <div className="preview-meta-item">
                        <span className="preview-meta-label">Created</span>
                        <span className="preview-meta-value">
                          {formatDate(previewFile.createdAt)}
                        </span>
                      </div>
                    </div>

                    <div className="preview-meta-sections">
                      <div className="preview-meta-block">
                        <h3 className="preview-meta-block__title">Document metadata</h3>
                        {documentMetadata.length ? (
                          <dl className="preview-meta-list">
                            {documentMetadata.map(([key, value]) => (
                              <div className="preview-meta-list__row" key={key}>
                                <dt>{key}</dt>
                                <dd>{formatMetadataValue(value)}</dd>
                              </div>
                            ))}
                          </dl>
                        ) : (
                          <p className="preview-meta-empty">No document metadata.</p>
                        )}
                      </div>
                      <div className="preview-meta-block">
                        <h3 className="preview-meta-block__title">Storage metadata</h3>
                        {storageMetadata.length ? (
                          <dl className="preview-meta-list">
                            {storageMetadata.map(([key, value]) => (
                              <div className="preview-meta-list__row" key={key}>
                                <dt>{key}</dt>
                                <dd>{formatMetadataValue(value)}</dd>
                              </div>
                            ))}
                          </dl>
                        ) : (
                          <p className="preview-meta-empty">No storage metadata.</p>
                        )}
                      </div>
                    </div>
                  </section>

                  {editMode ? (
                    <textarea
                      key={`${previewFile.id}:${previewFile.markdown.length}`}
                      ref={editorRef}
                      className="preview-editor"
                      defaultValue={previewFile.markdown}
                      spellCheck={false}
                    />
                  ) : (
                    <pre className="preview-content">{previewFile.markdown}</pre>
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
