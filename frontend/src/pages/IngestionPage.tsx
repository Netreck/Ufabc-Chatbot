import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import {
  clearSessionState,
  loadSessionState,
  saveSessionState,
} from "../lib/sessionState";

interface Metadata {
  [key: string]: unknown;
}

interface IngestionDraft {
  sourceText: string;
  markdownText: string;
  metadata: Metadata | null;
  filename: string;
  folderPath: string;
  storageMeta: string;
  showPreview: boolean;
}

const INGESTION_DRAFT_KEY = "ufabc:ingestion:draft:v1";
const INGESTION_DEFAULT_DRAFT: IngestionDraft = {
  sourceText: "",
  markdownText: "",
  metadata: null,
  filename: "",
  folderPath: "",
  storageMeta: "",
  showPreview: false,
};

function sanitizeIngestionDraft(draft: IngestionDraft): IngestionDraft {
  return {
    sourceText: draft.sourceText.slice(0, 200_000),
    markdownText: draft.markdownText.slice(0, 200_000),
    metadata: draft.metadata,
    filename: draft.filename.slice(0, 255),
    folderPath: draft.folderPath.slice(0, 255),
    storageMeta: draft.storageMeta.slice(0, 20_000),
    showPreview: draft.showPreview,
  };
}

export function IngestionPage() {
  const initialDraft = loadSessionState<IngestionDraft>(
    INGESTION_DRAFT_KEY,
    INGESTION_DEFAULT_DRAFT
  );
  const [sourceText, setSourceText] = useState(initialDraft.sourceText);
  const [markdownText, setMarkdownText] = useState(initialDraft.markdownText);
  const [metadata, setMetadata] = useState<Metadata | null>(initialDraft.metadata);
  const [filename, setFilename] = useState(initialDraft.filename);
  const [folderPath, setFolderPath] = useState(initialDraft.folderPath);
  const [folders, setFolders] = useState<string[]>([]);
  const [storageMeta, setStorageMeta] = useState(initialDraft.storageMeta);
  const [transforming, setTransforming] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [toast, setToast] = useState("");
  const [showPreview, setShowPreview] = useState(initialDraft.showPreview);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<IngestionDraft>(initialDraft);

  const loadFolders = useCallback(async () => {
    try {
      const res = await apiFetch("/files/tree");
      if (!res.ok) return;
      const data = await res.json();
      setFolders(
        (data.folders || []).map((f: { path: string }) => f.path)
      );
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    draftRef.current = sanitizeIngestionDraft({
      sourceText,
      markdownText,
      metadata,
      filename,
      folderPath,
      storageMeta,
      showPreview,
    });
  }, [sourceText, markdownText, metadata, filename, folderPath, storageMeta, showPreview]);

  useEffect(() => {
    return () => {
      saveSessionState(INGESTION_DRAFT_KEY, draftRef.current);
    };
  }, []);

  async function handleFileLoad() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    setSourceText(await file.text());
  }

  async function handleTransform() {
    if (sourceText.trim().length < 20) {
      setToast("Paste at least 20 characters to transform.");
      return;
    }
    setTransforming(true);
    setToast("");
    try {
      const res = await apiFetch("/ingestion/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_text: sourceText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Transform failed");

      setMarkdownText(data.markdown_text || "");
      setFilename(data.suggested_filename || "documento-rag.md");
      setMetadata(data.metadata || null);
      setShowPreview(true);
      setToast(`Transformed with ${data.model || "gpt-4o"}. Review and commit.`);
    } catch (err: unknown) {
      setToast(err instanceof Error ? err.message : "Transform failed");
    } finally {
      setTransforming(false);
    }
  }

  async function handleCommit() {
    if (!markdownText.trim()) {
      setToast("Markdown is empty.");
      return;
    }
    if (!filename.trim()) {
      setToast("Set a filename.");
      return;
    }

    let parsedStorageMeta = {};
    if (storageMeta.trim()) {
      try {
        parsedStorageMeta = JSON.parse(storageMeta);
      } catch {
        setToast("Storage metadata must be valid JSON.");
        return;
      }
    }

    setCommitting(true);
    try {
      const res = await apiFetch("/ingestion/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          markdown_text: markdownText,
          filename,
          folder_path: folderPath,
          storage_metadata: parsedStorageMeta,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Commit failed");

      const file = data.file || {};
      setToast(
        `Upload done: ${file.original_filename || filename} in ${folderPath ? `/${folderPath}` : "/"}`
      );
      await loadFolders();
    } catch (err: unknown) {
      setToast(err instanceof Error ? err.message : "Commit failed");
    } finally {
      setCommitting(false);
    }
  }

  const metadataKeys = [
    "id", "titulo", "tipo", "dominio", "subdominio",
    "versao", "status", "fonte", "atualizado_em",
  ];

  function clearDraft() {
    clearSessionState(INGESTION_DRAFT_KEY);
    const clean = INGESTION_DEFAULT_DRAFT;
    setSourceText(clean.sourceText);
    setMarkdownText(clean.markdownText);
    setMetadata(clean.metadata);
    setFilename(clean.filename);
    setFolderPath(clean.folderPath);
    setStorageMeta(clean.storageMeta);
    setShowPreview(clean.showPreview);
    setToast("Draft cleared.");
    draftRef.current = clean;
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar__left">
          <h1 className="topbar__title">Ingestion Pipeline</h1>
          <span className="topbar__badge">GPT-4o</span>
        </div>
        <div className="topbar__actions">
          <button className="btn btn--ghost btn--sm" onClick={clearDraft}>
            Clear Draft
          </button>
          <button className="btn btn--outline btn--sm" onClick={loadFolders}>
            Refresh Folders
          </button>
        </div>
      </header>

      <div className="ingestion-layout">
        {/* Source input */}
        <section className="ingestion-section">
          <h2 className="section-title">1. Source Text</h2>
          <div className="ingestion-file-input">
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.html"
              onChange={handleFileLoad}
            />
          </div>
          <textarea
            className="ingestion-textarea"
            placeholder="Paste or type the raw text to transform into RAG format..."
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            rows={12}
          />
          <button
            className="btn btn--primary"
            onClick={handleTransform}
            disabled={transforming}
          >
            {transforming ? "Transforming..." : "Transform with GPT-4o"}
          </button>
        </section>

        {/* Preview */}
        {showPreview && (
          <section className="ingestion-section">
            <h2 className="section-title">2. Preview & Edit</h2>

            {metadata && (
              <div className="metadata-card">
                <div className="metadata-kv">
                  {metadataKeys
                    .filter((k) => k in metadata)
                    .map((k) => (
                      <div key={k} className="metadata-kv__row">
                        <span className="metadata-kv__key">{k}</span>
                        <span className="metadata-kv__value">
                          {String(metadata[k])}
                        </span>
                      </div>
                    ))}
                </div>
                {Array.isArray(metadata.tags) && (
                  <div className="metadata-tags">
                    {metadata.tags.map((tag) => (
                      <span key={String(tag)} className="metadata-tag">
                        {String(tag)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <textarea
              className="ingestion-textarea ingestion-textarea--output"
              value={markdownText}
              onChange={(e) => setMarkdownText(e.target.value)}
              rows={16}
              spellCheck={false}
            />
          </section>
        )}

        {/* Commit */}
        {showPreview && (
          <section className="ingestion-section">
            <h2 className="section-title">3. Commit to Feed</h2>
            <div className="ingestion-commit-grid">
              <div className="ingestion-field">
                <label>Filename</label>
                <input
                  type="text"
                  className="input"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder="documento-rag.md"
                />
              </div>
              <div className="ingestion-field">
                <label>Folder</label>
                <select
                  className="input"
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                >
                  <option value="">/</option>
                  {folders.map((p) => (
                    <option key={p} value={p}>
                      /{p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ingestion-field">
                <label>Storage metadata (JSON, optional)</label>
                <input
                  type="text"
                  className="input"
                  value={storageMeta}
                  onChange={(e) => setStorageMeta(e.target.value)}
                  placeholder='{"pipeline":"ingestion-ui"}'
                />
              </div>
            </div>
            <button
              className="btn btn--primary"
              onClick={handleCommit}
              disabled={committing}
            >
              {committing ? "Committing..." : "Confirm & Upload"}
            </button>
          </section>
        )}

        {toast && <p className="toast-msg">{toast}</p>}
      </div>
    </>
  );
}
