import { useState } from 'react'
import DocumentEditor from './components/DocumentEditor'
import FileUpload from './components/FileUpload'

interface DocumentData {
  id: string
  filename: string
  tiptap: Record<string, unknown>
  intermediate: unknown[]
}

function App() {
  const [document, setDocument] = useState<DocumentData | null>(null)
  const [editorJson, setEditorJson] = useState<Record<string, unknown> | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleUpload = async (file: File) => {
    setIsLoading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('http://localhost:8000/upload', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || 'Upload failed')
      }

      const data: DocumentData = await response.json()
      setDocument(data)
      setEditorJson(data.tiptap)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload document')
    } finally {
      setIsLoading(false)
    }
  }

  const handleEditorUpdate = (json: Record<string, unknown>) => {
    setEditorJson(json)
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Document Editor PoC</h1>
        <p>Upload a Word document to convert and edit</p>
      </header>

      <section className="upload-section">
        <FileUpload onUpload={handleUpload} isLoading={isLoading} />
        {document && (
          <p style={{ marginTop: '1rem', color: '#666' }}>
            Loaded: {document.filename}
          </p>
        )}
      </section>

      {error && <div className="error">{error}</div>}

      <div className="editor-container">
        <div className="editor-panel">
          <div className="panel-header">Editor</div>
          <div className="editor-content">
            <DocumentEditor
              content={document?.tiptap || null}
              onUpdate={handleEditorUpdate}
            />
          </div>
        </div>

        <div className="json-panel">
          <div className="panel-header">Tiptap JSON</div>
          <div className="json-content">
            <pre>
              {editorJson
                ? JSON.stringify(editorJson, null, 2)
                : JSON.stringify({ type: 'doc', content: [] }, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
