import { useState, useCallback, useRef } from "react";
import { DocumentEditor, type EditorHandle, type TipTapDocument } from "./lib";
import FileUpload from "./components/FileUpload";
import {
  AIEditorProvider,
  useAIEditor,
  APIKeyInput,
  AIChatPanel,
  PromptInput,
} from "./components/ai";

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

  // Register editor with AI context when it becomes available
  const handleEditorChange = useCallback(
    (content: TipTapDocument | Record<string, unknown>) => {
      setEditorJson(content as Record<string, unknown>);
      // Register editor with AI context on first change
      const editor = editorRef.current?.getEditor();
      if (editor) {
        setEditor(editor);
      }
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
        {/* Settings Area - API Key */}
        <div className="ai-settings-area">
          <APIKeyInput showLabel />
        </div>

        {/* Editor Area */}
        <div className="ai-editor-area">
          <div className="editor-panel">
            <div className="panel-header">
              <span>Editor</span>
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
            <div className="editor-content">
              <DocumentEditor
                ref={editorRef}
                content={document?.tiptap || undefined}
                onChange={handleEditorChange}
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
              />
            </div>
            {showJson && (
              <div
                className="json-content"
                style={{ borderTop: "1px solid #eee" }}
              >
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
      <AppContent />
    </AIEditorProvider>
  );
}

export default App;
