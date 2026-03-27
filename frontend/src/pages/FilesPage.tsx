import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "../lib/api";
import {
  clearSessionState,
  loadSessionState,
  saveSessionState,
} from "../lib/sessionState";
import { useResize } from "../hooks/useResize";
import { useTheme } from "../hooks/useTheme";

interface FileItem {
  id: string;
  original_filename: string;
  stored_filename: string;
  folder_path: string;
  content_type: string | null;
  size_bytes: number;
  status: string;
  document_metadata: Record<string, unknown>;
  storage_metadata: Record<string, unknown>;
  created_at: string;
}

interface FolderItem {
  path: string;
  name: string;
  depth: number;
}

type UploadState =
  | "queued"
  | "validating"
  | "valid"
  | "invalid"
  | "uploading"
  | "uploaded"
  | "failed";

interface UploadQueueItem {
  id: string;
  file: File;
  status: UploadState;
  error: string;
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

interface ChatDraft {
  currentFolder: string;
  selectedContextIds: string[];
  chatMessages: Array<{ role: string; content: string }>;
  chatInput: string;
}

const FILES_CHAT_DRAFT_KEY = "ufabc:files:chat-draft:v1";
const FILES_DEFAULT_CHAT_DRAFT: ChatDraft = {
  currentFolder: "",
  selectedContextIds: [],
  chatMessages: [],
  chatInput: "",
};

function sanitizeChatDraft(draft: ChatDraft): ChatDraft {
  return {
    currentFolder: draft.currentFolder.slice(0, 255),
    selectedContextIds: draft.selectedContextIds.slice(0, 80),
    chatMessages: draft.chatMessages.slice(-30).map((message) => ({
      role: message.role,
      content: message.content.slice(0, 3000),
    })),
    chatInput: draft.chatInput.slice(0, 4000),
  };
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

function formatApiErrorDetail(detail: unknown, fallback: string): string {
  if (!detail) return fallback;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const items = detail
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") {
          const record = entry as Record<string, unknown>;
          const message = typeof record.msg === "string" ? record.msg : "";
          const loc = Array.isArray(record.loc)
            ? record.loc
                .map((part) => String(part))
                .filter(Boolean)
                .join(".")
            : "";
          if (message && loc) return `${loc}: ${message}`;
          if (message) return message;
        }
        return "";
      })
      .filter(Boolean);
    if (items.length > 0) return items.join(" | ");
  }
  if (typeof detail === "object") return JSON.stringify(detail);
  return fallback;
}

function uploadStatusLabel(status: UploadState): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "validating":
      return "Validating";
    case "valid":
      return "Ready";
    case "invalid":
      return "Invalid";
    case "uploading":
      return "Uploading";
    case "uploaded":
      return "Uploaded";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

export function FilesPage() {
  const initialChatDraft = loadSessionState<ChatDraft>(
    FILES_CHAT_DRAFT_KEY,
    FILES_DEFAULT_CHAT_DRAFT
  );
  const { theme, toggle } = useTheme();
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [currentFolder, setCurrentFolder] = useState(initialChatDraft.currentFolder);
  const [selectedContextIds, setSelectedContextIds] = useState<Set<string>>(
    () => new Set(initialChatDraft.selectedContextIds)
  );
  const [chatMessages, setChatMessages] = useState(initialChatDraft.chatMessages);
  const [chatInput, setChatInput] = useState(initialChatDraft.chatInput);
  const [chatLoading, setChatLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [editMode, setEditMode] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [draggingFileId, setDraggingFileId] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [chatDropOver, setChatDropOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatDraftRef = useRef<ChatDraft>(initialChatDraft);
  const lastTreeHashRef = useRef("");
  const folderPanelRef = useRef<HTMLElement>(null);
  const chatPanelRef = useRef<HTMLElement>(null);
  const fsGridRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  const folderResize = useResize(
    () => folderPanelRef.current,
    (w) => fsGridRef.current?.style.setProperty("--folder-panel-width", `${w}px`),
    100,
    500,
    1
  );
  const chatResize = useResize(
    () => chatPanelRef.current,
    (w) => workspaceRef.current?.style.setProperty("--chat-panel-width", `${w}px`),
    200,
    600,
    -1
  );

  const loadTree = useCallback(async () => {
    const res = await apiFetch("/files/tree");
    if (!res.ok) return;
    const data = await res.json();
    const nextHash = JSON.stringify(data);
    if (nextHash === lastTreeHashRef.current) return;
    lastTreeHashRef.current = nextHash;
    setFolders(data.folders || []);
    setFiles(data.files || []);
  }, []);

  useEffect(() => {
    if (previewFile) return;
    loadTree();
    const interval = setInterval(loadTree, 5000);
    return () => clearInterval(interval);
  }, [loadTree, previewFile]);

  useEffect(() => {
    if (!previewFile) return;
    document.body.classList.add("preview-open");
    return () => document.body.classList.remove("preview-open");
  }, [previewFile]);

  useEffect(() => {
    chatDraftRef.current = sanitizeChatDraft({
      currentFolder,
      selectedContextIds: Array.from(selectedContextIds),
      chatMessages,
      chatInput,
    });
  }, [currentFolder, selectedContextIds, chatMessages, chatInput]);

  useEffect(() => {
    return () => {
      saveSessionState(FILES_CHAT_DRAFT_KEY, chatDraftRef.current);
    };
  }, []);

  const currentFiles = files
    .filter((f) => (f.folder_path || "") === currentFolder)
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  const documentMetadata = metadataEntries(previewFile?.documentMetadata);
  const storageMetadata = metadataEntries(previewFile?.storageMetadata);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const validItems = uploadQueue.filter((item) => item.status === "valid");
    if (!validItems.length) return;

    setUploading(true);
    try {
      setUploadQueue((prev) =>
        prev.map((item) =>
          item.status === "valid" ? { ...item, status: "uploading", error: "" } : item
        )
      );

      const form = new FormData();
      for (const item of validItems) {
        form.append("files", item.file);
      }
      if (currentFolder) form.append("folder_path", currentFolder);

      const res = await apiFetch("/files/feed/batch", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Batch upload failed");
      }

      const resultMap = new Map<string, { success: boolean; error?: string }[]>();
      for (const result of data.results || []) {
        const bucket = resultMap.get(result.filename) || [];
        bucket.push({ success: !!result.success, error: result.error || "" });
        resultMap.set(result.filename, bucket);
      }

      setUploadQueue((prev) =>
        prev.map((item) => {
          if (item.status !== "uploading") return item;
          const bucket = resultMap.get(item.file.name);
          const next = bucket?.shift();
          if (!next) {
            return { ...item, status: "failed", error: "No upload result returned by server." };
          }
          return next.success
            ? { ...item, status: "uploaded", error: "" }
            : { ...item, status: "failed", error: next.error || "Upload failed." };
        })
      );

      await loadTree();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Batch upload failed";
      setUploadQueue((prev) =>
        prev.map((item) =>
          item.status === "uploading" ? { ...item, status: "failed", error: message } : item
        )
      );
    } finally {
      setUploading(false);
    }
  }

  async function validateFiles(files: File[]) {
    if (!files.length) {
      setUploadQueue([]);
      return;
    }
    const nextQueue: UploadQueueItem[] = files.map((file, index) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
      file,
      status: "validating",
      error: "",
    }));
    setUploadQueue(nextQueue);

    const form = new FormData();
    for (const file of files) form.append("files", file);
    try {
      const res = await apiFetch("/files/feed/validate", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        const message = formatApiErrorDetail(data.detail, "Validation failed");
        setUploadQueue((prev) =>
          prev.map((item) => ({ ...item, status: "failed", error: message }))
        );
        return;
      }

      const results: Array<{ filename: string; valid: boolean; errors: string[] }> =
        data.results || [];
      const resultMap = new Map<string, Array<{ valid: boolean; errors: string[] }>>();
      for (const result of results) {
        const bucket = resultMap.get(result.filename) || [];
        bucket.push({ valid: !!result.valid, errors: result.errors || [] });
        resultMap.set(result.filename, bucket);
      }

      setUploadQueue((prev) =>
        prev.map((item) => {
          const bucket = resultMap.get(item.file.name);
          const match = bucket?.shift();
          if (!match) {
            return {
              ...item,
              status: "failed",
              error: "Validation result missing for this file.",
            };
          }
          if (match.valid) return { ...item, status: "valid", error: "" };
          return {
            ...item,
            status: "invalid",
            error: match.errors.join(" ") || "Invalid file.",
          };
        })
      );
    } catch {
      setUploadQueue((prev) =>
        prev.map((item) => ({
          ...item,
          status: "failed",
          error: "Validation request failed. Please try again.",
        }))
      );
    }
  }

  async function handleFileSelection() {
    const files = Array.from(fileInputRef.current?.files || []);
    await validateFiles(files);
  }

  async function handleDelete(id: string) {
    const file = files.find((item) => item.id === id);
    const label = file?.original_filename || id;
    if (!confirm(`Delete "${label}"?`)) return;
    await apiFetch(`/files/feed/${id}`, { method: "DELETE" });
    await loadTree();
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

  async function moveFileToFolder(fileId: string, targetFolderPath: string) {
    const res = await apiFetch(`/files/feed/${fileId}/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_folder_path: targetFolderPath }),
    });
    if (!res.ok) return;
    await loadTree();
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

  async function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).elements.namedItem(
      "folderName"
    ) as HTMLInputElement;
    const name = input.value.trim();
    if (!name) return;
    const path = currentFolder ? `${currentFolder}/${name}` : name;
    await apiFetch("/files/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    input.value = "";
    await loadTree();
  }

  function toggleContext(id: string) {
    setSelectedContextIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleChat(e: React.FormEvent) {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const userMsg = { role: "user" as const, content: chatInput };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setChatLoading(true);

    try {
      const res = await apiFetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...chatMessages, userMsg],
          context_file_ids: Array.from(selectedContextIds),
        }),
      });
      const data = await res.json();
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply },
      ]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error: failed to get response." },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  function clearChatDraft() {
    clearSessionState(FILES_CHAT_DRAFT_KEY);
    setCurrentFolder(FILES_DEFAULT_CHAT_DRAFT.currentFolder);
    setSelectedContextIds(new Set());
    setChatMessages(FILES_DEFAULT_CHAT_DRAFT.chatMessages);
    setChatInput(FILES_DEFAULT_CHAT_DRAFT.chatInput);
    chatDraftRef.current = FILES_DEFAULT_CHAT_DRAFT;
  }

  function clearUploadQueue() {
    setUploadQueue([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar__left">
          <h1 className="topbar__title">UFABC Feed Console</h1>
          <span className="topbar__badge">Files</span>
        </div>
        <div className="topbar__actions">
          <button className="btn btn--ghost btn--sm" onClick={clearChatDraft}>
            Clear Draft
          </button>
          <button className="btn btn--ghost btn--sm" onClick={toggle}>
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          <button
            className="btn btn--outline btn--sm"
            onClick={loadTree}
          >
            Refresh
          </button>
        </div>
      </header>

      <div className="workspace" ref={workspaceRef}>
        <section className="panel-fs">
          {/* Upload zone */}
          <div className="paste-zone">
            <form onSubmit={handleUpload} className="paste-zone__form">
              <div className="paste-zone__drop">
                <span className="paste-zone__text">
                  Drop .md files here or click to browse
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,text/markdown"
                  multiple
                  id="file-input"
                  onChange={handleFileSelection}
                />
              </div>
              <div className="paste-zone__meta">
                <button
                  type="submit"
                  className="btn btn--primary btn--sm"
                  disabled={
                    uploading || !uploadQueue.some((item) => item.status === "valid")
                  }
                >
                  {uploading ? "Uploading..." : "Upload"}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={clearUploadQueue}
                  disabled={!uploadQueue.length || uploading}
                >
                  Clear Queue
                </button>
              </div>
            </form>
            <p className="paste-zone__target">
              Target: {currentFolder ? `/${currentFolder}` : "/"}
            </p>
            {uploadQueue.length > 0 && (
              <div className="upload-queue">
                {uploadQueue.map((item) => (
                  <div key={item.id} className="upload-queue__item">
                    <span className="upload-queue__name">{item.file.name}</span>
                    <span className={`upload-queue__status upload-queue__status--${item.status}`}>
                      {uploadStatusLabel(item.status)}
                    </span>
                    {item.error && (
                      <p className="upload-queue__error">{item.error}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Folder tree + file list */}
          <div className="fs-grid" ref={fsGridRef}>
            <aside className="folder-panel" ref={folderPanelRef}>
              <div className="folder-panel__header">
                <span className="folder-panel__title">Folders</span>
                <form
                  onSubmit={handleCreateFolder}
                  className="folder-panel__create"
                >
                  <input
                    name="folderName"
                    type="text"
                    className="input input--mini"
                    placeholder="New folder..."
                    required
                  />
                  <button
                    type="submit"
                    className="btn btn--ghost btn--xs"
                    title="Create folder"
                  >
                    +
                  </button>
                </form>
              </div>
              <div className="folder-tree">
                <button
                  className={`folder-node ${currentFolder === "" ? "active" : ""} ${dragOverFolder === "" ? "drop-over" : ""}`}
                  onClick={() => setCurrentFolder("")}
                  onDragOver={(e) => {
                    if (!draggingFileId) return;
                    e.preventDefault();
                    setDragOverFolder("");
                  }}
                  onDragLeave={() => {
                    if (dragOverFolder === "") setDragOverFolder(null);
                  }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    if (!draggingFileId) return;
                    await moveFileToFolder(draggingFileId, "");
                    setDragOverFolder(null);
                    setDraggingFileId(null);
                  }}
                >
                  /
                </button>
                {folders.map((f) => (
                  <button
                    key={f.path}
                    className={`folder-node ${currentFolder === f.path ? "active" : ""} ${dragOverFolder === f.path ? "drop-over" : ""}`}
                    style={{ paddingLeft: `${(f.depth + 1) * 14 + 4}px` }}
                    onClick={() => setCurrentFolder(f.path)}
                    onDragOver={(e) => {
                      if (!draggingFileId) return;
                      e.preventDefault();
                      setDragOverFolder(f.path);
                    }}
                    onDragLeave={() => {
                      if (dragOverFolder === f.path) setDragOverFolder(null);
                    }}
                    onDrop={async (e) => {
                      e.preventDefault();
                      if (!draggingFileId) return;
                      await moveFileToFolder(draggingFileId, f.path);
                      setDragOverFolder(null);
                      setDraggingFileId(null);
                    }}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            </aside>

            <div
              className="resize-handle resize-handle--folder"
              ref={folderResize.handleRef}
              onMouseDown={folderResize.onMouseDown}
              title="Drag to resize"
            />

            <div className="file-list-area">
              <div className="file-list-header">
                <p className="file-list-header__path">
                  {currentFolder ? `/${currentFolder}` : "/"}
                </p>
                {selectedContextIds.size > 0 && (
                  <p className="file-list-header__context">
                    {selectedContextIds.size} file(s) in context
                  </p>
                )}
              </div>
              <div className="file-list">
                {currentFiles.length === 0 ? (
                  <p style={{ padding: "var(--space-4)", color: "var(--text-muted)" }}>
                    No files in this folder.
                  </p>
                ) : (
                  currentFiles.map((file) => (
                    <div
                      key={file.id}
                      className={`file-row ${selectedContextIds.has(file.id) ? "file-row--selected" : ""}`}
                      draggable
                      onDragStart={(e) => {
                        setDraggingFileId(file.id);
                        e.dataTransfer.setData("text/plain", file.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        setDraggingFileId(null);
                        setDragOverFolder(null);
                        setChatDropOver(false);
                      }}
                    >
                      <div className="file-row__info">
                        <span
                          className="file-row__name"
                          onClick={() => handlePreview(file)}
                          style={{ cursor: "pointer" }}
                        >
                          {file.original_filename}
                        </span>
                        <span className="file-row__meta">
                          {formatBytes(file.size_bytes)} &middot;{" "}
                          <span className={`badge ${file.status}`}>
                            {file.status}
                          </span>{" "}
                          &middot; {formatDate(file.created_at)}
                        </span>
                      </div>
                      <div className="file-row__actions">
                        <button
                          className="btn btn--ghost btn--xs"
                          onClick={() => toggleContext(file.id)}
                          title="Toggle chat context"
                        >
                          {selectedContextIds.has(file.id) ? "- ctx" : "+ ctx"}
                        </button>
                        <button
                          className="btn btn--ghost btn--xs"
                          onClick={() => handleDownload(file)}
                          title="Download file"
                        >
                          Download
                        </button>
                        <button
                          className="btn btn--danger btn--xs file-delete-btn"
                          onClick={() => handleDelete(file.id)}
                          title="Delete"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Chat resize handle */}
        <div
          className="resize-handle resize-handle--chat"
          ref={chatResize.handleRef}
          onMouseDown={chatResize.onMouseDown}
          title="Drag to resize"
        />

        {/* Chat panel */}
        <aside
          className={`panel-chat ${chatDropOver ? "drop-over" : ""}`}
          ref={chatPanelRef}
          onDragOver={(e) => {
            if (!draggingFileId) return;
            e.preventDefault();
            setChatDropOver(true);
          }}
          onDragLeave={(e) => {
            const related = e.relatedTarget;
            if (related instanceof Node && e.currentTarget.contains(related)) return;
            setChatDropOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            const fileId = draggingFileId || e.dataTransfer.getData("text/plain");
            if (!fileId) return;
            setSelectedContextIds((prev) => {
              const next = new Set(prev);
              next.add(fileId);
              return next;
            });
            setChatDropOver(false);
            setDraggingFileId(null);
          }}
        >
          <div className="panel-chat__header">
            <h2 className="panel-chat__title">Smoke Test Chat</h2>
            <button
              className="btn btn--ghost btn--xs"
              onClick={() => {
                setSelectedContextIds(new Set());
                setChatMessages([]);
              }}
            >
              Clear
            </button>
          </div>

          <div className="loaded-files">
            {selectedContextIds.size === 0 ? (
              <p className="loaded-files__empty">No files loaded for context.</p>
            ) : (
              Array.from(selectedContextIds).map((id) => {
                const f = files.find((x) => x.id === id);
                return (
                  <span key={id} className="loaded-file-chip">
                    {f?.original_filename || id}
                    <button
                      className="loaded-file-chip__remove"
                      onClick={() => toggleContext(id)}
                    >
                      &times;
                    </button>
                  </span>
                );
              })
            )}
          </div>

          <div className="chat-messages">
            {chatMessages.map((msg, i) => (
              <div key={i} className={`chat-bubble chat-bubble--${msg.role}`}>
                {msg.content}
              </div>
            ))}
            {chatLoading && (
              <div className="chat-bubble chat-bubble--assistant">
                Thinking...
              </div>
            )}
          </div>

          <form onSubmit={handleChat} className="chat-input-area">
            <input
              type="text"
              className="input chat-input"
              placeholder="Ask something..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              required
            />
            <button type="submit" className="btn btn--primary btn--icon">
              Send
            </button>
          </form>
        </aside>
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
              <div className="modal__title-area">
                <h2 className="modal__title">{previewFile.name}</h2>
              </div>
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
                  title="Close"
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
