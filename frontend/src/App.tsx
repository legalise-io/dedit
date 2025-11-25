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

  const handleExport = async () => {
    if (!editorJson) return;

    setIsExporting(true);
    setError(null);

    try {
      const response = await fetch("http://localhost:8000/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tiptap: editorJson,
          filename: document?.filename || "document.docx",
        }),
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
          <div
            style={{
              marginTop: "1rem",
              display: "flex",
              alignItems: "center",
              gap: "1rem",
            }}
          >
            <p style={{ color: "#666", margin: 0 }}>
              Loaded: {document.filename}
            </p>
            <button
              onClick={handleExport}
              disabled={isExporting || !editorJson}
              className="export-button"
            >
              {isExporting ? "Exporting..." : "Export as Word"}
            </button>
          </div>
        )}
      </section>

      {error && <div className="error">{error}</div>}

      <div className="editor-container">
        <div className="sidebar-panel">
          <TrackChangesToolbar editor={editor} />
          <CommentsPanel editor={editor} comments={comments} />
        </div>

        <div className="editor-panel">
          <div className="panel-header">Editor</div>
          <div className="editor-content">
            <DocumentEditor
              content={document?.tiptap || null}
              onUpdate={handleEditorUpdate}
              onEditorReady={handleEditorReady}
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
