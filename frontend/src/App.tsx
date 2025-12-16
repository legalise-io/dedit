import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  DocumentEditor,
  type EditorHandle,
  type TipTapDocument,
  type ContextItem,
  type ContextItemResolver,
  useCollaboration,
  generateUserColor,
  type CollaborationUser,
} from "./lib";
import FileUpload from "./components/FileUpload";
import {
  AIEditorProvider,
  useAIEditor,
  APIKeyInput,
  AIChatPanel,
  PromptInput,
} from "./components/ai";

/**
 * Sample context item resolver that handles file drops.
 * Reads text files and creates context items from them.
 */
const sampleContextItemResolver: ContextItemResolver = async (dataTransfer) => {
  const items: ContextItem[] = [];

  // Handle dropped files
  for (const file of Array.from(dataTransfer.files)) {
    // Only handle text-based files
    if (
      file.type.startsWith("text/") ||
      file.type === "application/json" ||
      file.name.endsWith(".md") ||
      file.name.endsWith(".txt") ||
      file.name.endsWith(".json") ||
      file.name.endsWith(".csv")
    ) {
      try {
        const content = await file.text();
        items.push({
          id: crypto.randomUUID(),
          label: file.name,
          content:
            content.length > 10000
              ? content.slice(0, 10000) + "\n... (truncated)"
              : content,
          type: "file",
          mimeType: file.type || "text/plain",
          metadata: {
            size: file.size,
            lastModified: file.lastModified,
          },
        });
      } catch (err) {
        console.error(`Failed to read file ${file.name}:`, err);
      }
    }
  }

  // Handle dropped text
  const text = dataTransfer.getData("text/plain");
  if (text && items.length === 0) {
    items.push({
      id: crypto.randomUUID(),
      label: "Dropped text",
      content: text.length > 5000 ? text.slice(0, 5000) + "..." : text,
      type: "snippet",
    });
  }

  return items;
};

interface CommentData {
  id: string;
  author: string;
  date: string;
  text: string;
  replies?: CommentData[];
}

interface DocumentData {
  id: string;
  filename: string;
  tiptap: Record<string, unknown>;
  intermediate: unknown[];
  comments: CommentData[];
}

interface TemplateData {
  id: string;
  filename: string;
}

type TemplateOption = "none" | "original" | "custom";

// Collaboration configuration
const COLLAB_SERVER_URL = "ws://localhost:1234";
const COLLAB_DOCUMENT_NAME = "sample-document";

/**
 * Collaborative editor wrapper that uses the useCollaboration hook.
 * This is a separate component because hooks must be called unconditionally.
 */
interface CollaborativeEditorProps {
  editorRef: React.RefObject<EditorHandle>;
  user: CollaborationUser;
  onEditorReady: (editor: import("@tiptap/react").Editor) => void;
  onChange: (content: TipTapDocument | Record<string, unknown>) => void;
  trackChangesEnabled: boolean;
  onTrackChangesEnabledChange: (enabled: boolean) => void;
  showJson: boolean;
  editorJson: Record<string, unknown> | null;
  /** Initial content to seed the collaborative document with (if empty) */
  initialContent?: Record<string, unknown>;
  /** Document name for collaboration room */
  documentName?: string;
}

function CollaborativeEditor({
  editorRef,
  user,
  onEditorReady,
  onChange,
  trackChangesEnabled,
  onTrackChangesEnabledChange,
  showJson,
  editorJson,
  initialContent,
  documentName = COLLAB_DOCUMENT_NAME,
}: CollaborativeEditorProps) {
  const {
    extensions,
    status,
    connectedUsers,
    isReady,
    needsSeeding,
    markSeeded,
  } = useCollaboration({
    serverUrl: COLLAB_SERVER_URL,
    documentName,
    user,
    initialContent,
  });

  // Handle seeding the document when editor is ready
  const handleEditorReady = useCallback(
    (editor: import("@tiptap/react").Editor) => {
      console.log("[CollaborativeEditor] Editor ready", {
        needsSeeding,
        hasInitialContent: !!initialContent,
        status,
      });
      if (needsSeeding && initialContent) {
        console.log(
          "[CollaborativeEditor] Seeding document with initial content",
        );
        editor.commands.setContent(initialContent);
        markSeeded();
      } else if (initialContent && !needsSeeding) {
        console.log(
          "[CollaborativeEditor] Document already has content, not seeding",
        );
      }
      onEditorReady(editor);
    },
    [needsSeeding, initialContent, markSeeded, onEditorReady, status],
  );

  return (
    <>
      <div
        style={{
          padding: "0.5rem",
          background: status === "connected" ? "#e8f5e9" : "#fff3e0",
          borderBottom: "1px solid #eee",
          fontSize: "0.75rem",
          display: "flex",
          alignItems: "center",
          gap: "1rem",
        }}
      >
        <span>
          Status:{" "}
          <strong
            style={{ color: status === "connected" ? "green" : "orange" }}
          >
            {status}
          </strong>
        </span>
        <span>Document: {documentName}</span>
        <span>
          Users: {connectedUsers.map((u) => u.name).join(", ") || "Just you"}
        </span>
      </div>
      {!isReady ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "#666",
          }}
        >
          Connecting to collaboration server...
        </div>
      ) : (
        <DocumentEditor
          ref={editorRef}
          onChange={onChange}
          onEditorReady={handleEditorReady}
          extensions={extensions}
          toolbar={[
            "undo",
            "redo",
            "separator",
            "bold",
            "italic",
            "separator",
            "findReplace",
            "separator",
            "addRowBefore",
            "addRowAfter",
            "deleteRow",
            "separator",
            "trackChangesToggle",
            "separator",
            "prevChange",
            "nextChange",
            "acceptChange",
            "rejectChange",
            "separator",
            "acceptAll",
            "rejectAll",
          ]}
          trackChanges={{
            enabled: trackChangesEnabled,
            author: user.name,
            onEnabledChange: onTrackChangesEnabledChange,
          }}
          enableContextMenu
        />
      )}
      {showJson && (
        <div className="json-content" style={{ borderTop: "1px solid #eee" }}>
          <pre
            style={{
              fontSize: "0.7rem",
              maxHeight: "200px",
              overflow: "auto",
            }}
          >
            {editorJson
              ? JSON.stringify(editorJson, null, 2)
              : JSON.stringify({ type: "doc", content: [] }, null, 2)}
          </pre>
        </div>
      )}
    </>
  );
}

// Inner component that uses the AI context
function AppContent() {
  const { setEditor } = useAIEditor();
  const editorRef = useRef<EditorHandle>(null);

  const [document, setDocument] = useState<DocumentData | null>(null);
  const [editorJson, setEditorJson] = useState<Record<string, unknown> | null>(
    null,
  );
  const [comments, setComments] = useState<CommentData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackChangesEnabled, setTrackChangesEnabled] = useState(false);
  const [templateOption, setTemplateOption] = useState<TemplateOption>("none");
  const [customTemplate, setCustomTemplate] = useState<TemplateData | null>(
    null,
  );
  const [isUploadingTemplate, setIsUploadingTemplate] = useState(false);
  const [showJson, setShowJson] = useState(false);

  // Collaboration state
  const [collabEnabled, setCollabEnabled] = useState(false);
  const [collabRoomId, setCollabRoomId] = useState<string>("");
  const [userName, setUserName] = useState(
    () => `User-${Math.random().toString(36).slice(2, 6)}`,
  );
  const userColor = useMemo(() => generateUserColor(), []);

  // The effective room ID: manual input takes precedence, then document ID, then default
  const effectiveRoomId = collabRoomId || document?.id || COLLAB_DOCUMENT_NAME;

  const collabUser: CollaborationUser = useMemo(
    () => ({ name: userName, color: userColor }),
    [userName, userColor],
  );

  const handleEditorChange = useCallback(
    (content: TipTapDocument | Record<string, unknown>) => {
      setEditorJson(content as Record<string, unknown>);
    },
    [],
  );

  // Register editor with AI context via callback
  const handleEditorReady = useCallback(
    (editor: import("@tiptap/react").Editor) => {
      setEditor(editor);
    },
    [setEditor],
  );

  const handleUpload = async (file: File) => {
    setIsLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("http://localhost:8000/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Upload failed");
      }

      const data: DocumentData = await response.json();
      setDocument(data);
      setEditorJson(data.tiptap);
      setComments(data.comments || []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to upload document",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleTemplateUpload = async (file: File) => {
    setIsUploadingTemplate(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("http://localhost:8000/templates/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Template upload failed");
      }

      const data = await response.json();
      setCustomTemplate({ id: data.id, filename: file.name });
      setTemplateOption("custom");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to upload template",
      );
    } finally {
      setIsUploadingTemplate(false);
    }
  };

  const handleExport = async () => {
    if (!editorJson) return;

    setIsExporting(true);
    setError(null);

    try {
      const exportRequest: Record<string, unknown> = {
        tiptap: editorJson,
        filename: document?.filename || "document.docx",
        comments: comments,
        template: templateOption,
      };

      // Add document_id if using original template
      if (templateOption === "original" && document) {
        exportRequest.document_id = document.id;
      }

      // Add template_id if using custom template
      if (templateOption === "custom" && customTemplate) {
        exportRequest.template_id = customTemplate.id;
      }

      const response = await fetch("http://localhost:8000/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(exportRequest),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Export failed");
      }

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = window.document.createElement("a");
      a.href = url;
      a.download = document?.filename || "document.docx";
      window.document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to export document",
      );
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>AI Document Editor</h1>
        <p>Upload a Word document and use AI to edit and analyze</p>
      </header>

      <section className="upload-section">
        <FileUpload onUpload={handleUpload} isLoading={isLoading} />
        {document && (
          <div className="document-actions">
            <p style={{ color: "#666", margin: 0 }}>
              Loaded: {document.filename}
            </p>

            <div className="export-options">
              <div className="template-selector">
                <label className="template-label">Export Template:</label>
                <div className="template-radio-group">
                  <label className="template-radio">
                    <input
                      type="radio"
                      name="template"
                      value="none"
                      checked={templateOption === "none"}
                      onChange={() => setTemplateOption("none")}
                    />
                    <span>No template (plain)</span>
                  </label>
                  <label className="template-radio">
                    <input
                      type="radio"
                      name="template"
                      value="original"
                      checked={templateOption === "original"}
                      onChange={() => setTemplateOption("original")}
                    />
                    <span>Original document styles</span>
                  </label>
                  <label className="template-radio">
                    <input
                      type="radio"
                      name="template"
                      value="custom"
                      checked={templateOption === "custom"}
                      onChange={() => setTemplateOption("custom")}
                      disabled={!customTemplate}
                    />
                    <span>
                      Custom template
                      {customTemplate && ` (${customTemplate.filename})`}
                    </span>
                  </label>
                </div>

                <div className="template-upload">
                  <label className="template-upload-btn">
                    <input
                      type="file"
                      accept=".docx"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleTemplateUpload(file);
                        e.target.value = "";
                      }}
                      style={{ display: "none" }}
                    />
                    {isUploadingTemplate
                      ? "Uploading..."
                      : "Upload Custom Template"}
                  </label>
                </div>
              </div>

              <button
                onClick={handleExport}
                disabled={
                  isExporting ||
                  !editorJson ||
                  (templateOption === "custom" && !customTemplate)
                }
                className="export-button"
              >
                {isExporting ? "Exporting..." : "Export as Word"}
              </button>
            </div>
          </div>
        )}
      </section>

      {error && <div className="error">{error}</div>}

      {/* AI Editor Layout - Components in separate areas */}
      <div className="ai-editor-layout ai-editor-layout--two-column">
        {/* Settings Area - API Key and Collaboration */}
        <div className="ai-settings-area">
          <APIKeyInput showLabel />
          <div
            style={{
              marginTop: "1rem",
              padding: "0.5rem",
              background: "#f5f5f5",
              borderRadius: "4px",
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={collabEnabled}
                onChange={(e) => setCollabEnabled(e.target.checked)}
              />
              <span style={{ fontWeight: 500 }}>Enable Collaboration</span>
            </label>
            {collabEnabled && (
              <div style={{ marginTop: "0.5rem" }}>
                <label style={{ fontSize: "0.75rem", color: "#666" }}>
                  Your name:
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    style={{
                      marginLeft: "0.5rem",
                      padding: "0.25rem",
                      border: "1px solid #ccc",
                      borderRadius: "3px",
                      fontSize: "0.75rem",
                    }}
                  />
                </label>
                <div style={{ marginTop: "0.5rem" }}>
                  <label
                    style={{
                      fontSize: "0.75rem",
                      color: "#666",
                      display: "block",
                    }}
                  >
                    Room ID (to join existing):
                  </label>
                  <input
                    type="text"
                    value={collabRoomId}
                    onChange={(e) => setCollabRoomId(e.target.value)}
                    placeholder={document?.id || COLLAB_DOCUMENT_NAME}
                    style={{
                      marginTop: "0.25rem",
                      padding: "0.25rem",
                      border: "1px solid #ccc",
                      borderRadius: "3px",
                      fontSize: "0.75rem",
                      width: "100%",
                      boxSizing: "border-box",
                    }}
                  />
                  <div
                    style={{
                      marginTop: "0.25rem",
                      fontSize: "0.65rem",
                      color: "#888",
                    }}
                  >
                    Current: {effectiveRoomId}
                  </div>
                </div>
                <div
                  style={{
                    marginTop: "0.25rem",
                    fontSize: "0.7rem",
                    color: "#888",
                  }}
                >
                  Server: {COLLAB_SERVER_URL}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Editor Area */}
        <div className="ai-editor-area">
          <div className="editor-panel">
            <div className="panel-header">
              <span>Editor {collabEnabled && "(Collaborative)"}</span>
              <button
                type="button"
                onClick={() => setShowJson(!showJson)}
                style={{
                  marginLeft: "auto",
                  padding: "0.25rem 0.5rem",
                  fontSize: "0.75rem",
                  background: showJson ? "#e0e0e0" : "transparent",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                {showJson ? "Hide JSON" : "Show JSON"}
              </button>
            </div>
            <div
              className="editor-content"
              style={{
                height: "500px",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              {collabEnabled ? (
                <CollaborativeEditor
                  editorRef={editorRef}
                  user={collabUser}
                  onEditorReady={handleEditorReady}
                  onChange={handleEditorChange}
                  trackChangesEnabled={trackChangesEnabled}
                  onTrackChangesEnabledChange={setTrackChangesEnabled}
                  showJson={showJson}
                  editorJson={editorJson}
                  initialContent={document?.tiptap}
                  documentName={effectiveRoomId}
                />
              ) : (
                <>
                  <DocumentEditor
                    ref={editorRef}
                    content={document?.tiptap || undefined}
                    onChange={handleEditorChange}
                    onEditorReady={handleEditorReady}
                    toolbar={[
                      "undo",
                      "redo",
                      "separator",
                      "bold",
                      "italic",
                      "separator",
                      "findReplace",
                      "separator",
                      "addRowBefore",
                      "addRowAfter",
                      "deleteRow",
                      "separator",
                      "trackChangesToggle",
                      "separator",
                      "prevChange",
                      "nextChange",
                      "acceptChange",
                      "rejectChange",
                      "separator",
                      "acceptAll",
                      "rejectAll",
                    ]}
                    trackChanges={{
                      enabled: trackChangesEnabled,
                      author: "Current User",
                      onEnabledChange: setTrackChangesEnabled,
                    }}
                    enableContextMenu
                  />
                  {showJson && (
                    <div
                      className="json-content"
                      style={{ borderTop: "1px solid #eee" }}
                    >
                      <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 8px", borderBottom: "1px solid #eee" }}>
                        <button
                          onClick={() => {
                            const json = editorJson
                              ? JSON.stringify(editorJson, null, 2)
                              : JSON.stringify({ type: "doc", content: [] }, null, 2);
                            navigator.clipboard.writeText(json);
                          }}
                          style={{
                            fontSize: "0.7rem",
                            padding: "2px 8px",
                            cursor: "pointer",
                          }}
                        >
                          Copy JSON
                        </button>
                      </div>
                      <pre
                        style={{
                          fontSize: "0.7rem",
                          maxHeight: "200px",
                          overflow: "auto",
                        }}
                      >
                        {editorJson
                          ? JSON.stringify(editorJson, null, 2)
                          : JSON.stringify(
                              { type: "doc", content: [] },
                              null,
                              2,
                            )}
                      </pre>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Chat Area - Conversation history */}
        <div className="ai-chat-area">
          <AIChatPanel
            showHeader
            headerTitle="AI Assistant"
            maxHeight="350px"
          />
        </div>

        {/* Prompt Area - Input at bottom */}
        <div className="ai-prompt-area">
          <PromptInput showSelectionIndicator />
        </div>
      </div>
    </div>
  );
}

// Main App wraps everything in AIEditorProvider
function App() {
  return (
    <AIEditorProvider aiAuthorName="AI Assistant">
      <AppContentWithConfig />
    </AIEditorProvider>
  );
}

// Wrapper that sets the config after provider is mounted
function AppContentWithConfig() {
  const { setConfig } = useAIEditor();

  // Set the context item resolver on mount
  useEffect(() => {
    setConfig({ onResolveContextItems: sampleContextItemResolver });
  }, [setConfig]);

  return <AppContent />;
}

export default App;
