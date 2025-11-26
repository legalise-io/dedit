import { useState, useCallback } from "react";
import { Editor } from "@tiptap/react";
import DocumentEditor from "./components/DocumentEditor";
import FileUpload from "./components/FileUpload";
import TrackChangesToolbar from "./components/TrackChangesToolbar";
import CommentsPanel from "./components/CommentsPanel";

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

function App() {
  const [document, setDocument] = useState<DocumentData | null>(null);
  const [editorJson, setEditorJson] = useState<Record<string, unknown> | null>(
    null,
  );
  const [editor, setEditor] = useState<Editor | null>(null);
  const [comments, setComments] = useState<CommentData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackChangesEnabled, setTrackChangesEnabled] = useState(false);
  const [trackChangesAuthor, setTrackChangesAuthor] = useState(() => {
    return localStorage.getItem("trackChangesAuthor") || "Current User";
  });
  const [templateOption, setTemplateOption] = useState<TemplateOption>("none");
  const [customTemplate, setCustomTemplate] = useState<TemplateData | null>(
    null,
  );
  const [isUploadingTemplate, setIsUploadingTemplate] = useState(false);

  const handleAuthorChange = useCallback((author: string) => {
    setTrackChangesAuthor(author);
    localStorage.setItem("trackChangesAuthor", author);
  }, []);

  const handleEditorReady = useCallback((editorInstance: Editor) => {
    setEditor(editorInstance);
  }, []);

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

  const handleEditorUpdate = (json: Record<string, unknown>) => {
    setEditorJson(json);
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
        <h1>Document Editor PoC</h1>
        <p>Upload a Word document to convert and edit</p>
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

      <div className="editor-container">
        <div className="sidebar-panel">
          <TrackChangesToolbar
            editor={editor}
            trackChangesEnabled={trackChangesEnabled}
            onTrackChangesToggle={setTrackChangesEnabled}
            author={trackChangesAuthor}
            onAuthorChange={handleAuthorChange}
          />
          <CommentsPanel editor={editor} comments={comments} />
        </div>

        <div className="editor-panel">
          <div className="panel-header">Editor</div>
          <div className="editor-content">
            <DocumentEditor
              content={document?.tiptap || null}
              onUpdate={handleEditorUpdate}
              onEditorReady={handleEditorReady}
              toolbar={["bold", "italic"]}
            />
          </div>
        </div>

        <div className="json-panel">
          <div className="panel-header">Tiptap JSON</div>
          <div className="json-content">
            <pre>
              {editorJson
                ? JSON.stringify(editorJson, null, 2)
                : JSON.stringify({ type: "doc", content: [] }, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
