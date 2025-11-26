# dedit-react-editor

A flexible, unstyled React component for document editing with track changes and comments support. Built on TipTap/ProseMirror.

## Installation

```bash
npm install dedit-react-editor
```

### Peer Dependencies

Ensure you have these installed in your project:

```bash
npm install react react-dom @tiptap/react @tiptap/core @tiptap/pm
```

## Quick Start

```tsx
import { DocumentEditor } from 'dedit-react-editor';

function MyApp() {
  const [content, setContent] = useState(null);

  return (
    <DocumentEditor
      initialContent={content}
      onChange={setContent}
      className="my-editor"
    />
  );
}
```

## Basic Usage

### Uncontrolled Component

Use `initialContent` for a simple uncontrolled editor:

```tsx
import { DocumentEditor } from 'dedit-react-editor';

function Editor() {
  const handleChange = (json) => {
    console.log('Document changed:', json);
  };

  return (
    <DocumentEditor
      initialContent={{
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello world!' }],
          },
        ],
      }}
      onChange={handleChange}
    />
  );
}
```

### Controlled Component

Use `content` prop for controlled behavior:

```tsx
import { DocumentEditor } from 'dedit-react-editor';

function Editor() {
  const [content, setContent] = useState(initialDocument);

  return (
    <DocumentEditor
      content={content}
      onChange={setContent}
    />
  );
}
```

## Track Changes

Enable track changes to mark insertions and deletions instead of directly modifying text:

```tsx
import { useRef, useState } from 'react';
import { DocumentEditor, EditorHandle } from 'dedit-react-editor';

function EditorWithTrackChanges() {
  const editorRef = useRef<EditorHandle>(null);
  const [content, setContent] = useState(initialDocument);
  const [trackChangesEnabled, setTrackChangesEnabled] = useState(true);

  return (
    <div>
      {/* Toggle track changes */}
      <button onClick={() => setTrackChangesEnabled(!trackChangesEnabled)}>
        Track Changes: {trackChangesEnabled ? 'ON' : 'OFF'}
      </button>

      {/* Accept/Reject controls */}
      <button onClick={() => editorRef.current?.acceptAllChanges()}>
        Accept All
      </button>
      <button onClick={() => editorRef.current?.rejectAllChanges()}>
        Reject All
      </button>

      <DocumentEditor
        editorRef={editorRef}
        content={content}
        onChange={setContent}
        trackChanges={{
          enabled: trackChangesEnabled,
          author: 'John Doe',
        }}
      />
    </div>
  );
}
```

### Handling Individual Changes

Use the `useTrackChanges` hook for granular control:

```tsx
import { useRef, useState } from 'react';
import { 
  DocumentEditor, 
  EditorHandle,
  useTrackChanges,
} from 'dedit-react-editor';

function EditorWithChangesList() {
  const editorRef = useRef<EditorHandle>(null);
  const [content, setContent] = useState(initialDocument);

  // Get the editor instance
  const editor = editorRef.current?.getEditor();

  // Use the track changes hook
  const { 
    changes, 
    acceptChange, 
    rejectChange,
    acceptAll,
    rejectAll,
  } = useTrackChanges(editor, {
    enabled: true,
    author: 'John Doe',
  });

  return (
    <div className="editor-layout">
      <DocumentEditor
        editorRef={editorRef}
        content={content}
        onChange={setContent}
        trackChanges={{
          enabled: true,
          author: 'John Doe',
        }}
      />

      {/* Changes sidebar */}
      <aside>
        <h3>Changes ({changes.length})</h3>
        <button onClick={acceptAll}>Accept All</button>
        <button onClick={rejectAll}>Reject All</button>
        
        <ul>
          {changes.map((change) => (
            <li key={change.id}>
              <span className={change.type}>
                {change.type === 'insertion' ? 'Added' : 'Deleted'}:
              </span>
              <span>"{change.text}"</span>
              <span>by {change.author}</span>
              <button onClick={() => acceptChange(change.id)}>Accept</button>
              <button onClick={() => rejectChange(change.id)}>Reject</button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
```

## Comments

Add commenting functionality:

```tsx
import { useState } from 'react';
import { DocumentEditor, CommentData } from 'dedit-react-editor';

function EditorWithComments() {
  const [content, setContent] = useState(initialDocument);
  const [comments, setComments] = useState<CommentData[]>([]);

  const handleAddComment = (range, text) => {
    const newComment: CommentData = {
      id: `comment-${Date.now()}`,
      author: 'Current User',
      date: new Date().toISOString(),
      text,
    };
    setComments([...comments, newComment]);
  };

  const handleResolveComment = (commentId) => {
    setComments(comments.filter(c => c.id !== commentId));
  };

  return (
    <DocumentEditor
      content={content}
      onChange={setContent}
      comments={{
        data: comments,
        onAdd: handleAddComment,
        onResolve: handleResolveComment,
        onReply: (commentId, text) => {
          // Handle reply
        },
        onDelete: (commentId) => {
          setComments(comments.filter(c => c.id !== commentId));
        },
      }}
    />
  );
}
```

## Exporting Documents

### Create Export Payload

Use the imperative handle to create an export payload for your backend:

```tsx
import { useRef } from 'react';
import { DocumentEditor, EditorHandle } from 'dedit-react-editor';

function EditorWithExport() {
  const editorRef = useRef<EditorHandle>(null);

  const handleExport = async () => {
    const payload = editorRef.current?.createExportPayload({
      filename: 'my-document.docx',
      includeComments: true,
      template: {
        type: 'none', // 'none' | 'original' | 'custom'
      },
    });

    // Send to your backend
    const response = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Download the file
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'my-document.docx';
    a.click();
  };

  return (
    <div>
      <button onClick={handleExport}>Export to Word</button>
      <DocumentEditor editorRef={editorRef} />
    </div>
  );
}
```

### Using the Export Utility

For simpler export workflows:

```tsx
import { exportToWord } from 'dedit-react-editor';

const handleExport = async () => {
  const content = editorRef.current?.getContent();
  
  await exportToWord('/api/export', content, comments, {
    filename: 'document.docx',
    template: { type: 'original', documentId: 'doc-123' },
  });
};
```

### Template Options

```tsx
// No template - plain document
template: { type: 'none' }

// Use original document as template (preserves styles)
template: { type: 'original', documentId: 'uploaded-doc-id' }

// Use custom template
template: { type: 'custom', templateId: 'template-id' }
```

## Styling

The component is unstyled by default. Add your own styles:

### Using className Props

```tsx
<DocumentEditor
  className="editor-root"
  classNames={{
    root: 'editor-container',
    content: 'editor-content',
    insertion: 'track-insertion',
    deletion: 'track-deletion',
    comment: 'comment-highlight',
  }}
/>
```

### Example CSS

```css
/* Editor container */
.editor-root {
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 1rem;
}

/* Content area */
.editor-content {
  min-height: 300px;
  outline: none;
}

/* Track changes styling */
.editor-content ins.insertion {
  background-color: #d4edda;
  text-decoration: none;
}

.editor-content del.deletion {
  background-color: #f8d7da;
  text-decoration: line-through;
  color: #721c24;
}

/* Comment highlights */
.editor-content .comment-highlight {
  background-color: #fff3cd;
}
```

## Imperative Handle API

Access editor functionality programmatically via `editorRef`:

```tsx
const editorRef = useRef<EditorHandle>(null);

// Content
editorRef.current?.getContent();           // Get TipTap JSON
editorRef.current?.setContent(json);       // Set content

// Track changes
editorRef.current?.getChanges();           // Get all tracked changes
editorRef.current?.acceptChange(id);       // Accept specific change
editorRef.current?.rejectChange(id);       // Reject specific change
editorRef.current?.acceptAllChanges();     // Accept all changes
editorRef.current?.rejectAllChanges();     // Reject all changes
editorRef.current?.setTrackChangesEnabled(true);
editorRef.current?.setTrackChangesAuthor('Jane');

// Editor control
editorRef.current?.focus();                // Focus editor
editorRef.current?.blur();                 // Blur editor
editorRef.current?.getEditor();            // Get raw TipTap editor

// Export
editorRef.current?.createExportPayload(options);
```

## Advanced: Custom Editor with Hooks

For complete control, use the hooks directly:

```tsx
import { 
  useDocumentEditor, 
  useTrackChanges,
  useComments,
} from 'dedit-react-editor';
import { EditorContent } from '@tiptap/react';

function CustomEditor() {
  const { editor, content, setContent, isReady } = useDocumentEditor({
    initialContent: myDocument,
    onChange: handleChange,
    trackChangesEnabled: true,
    trackChangesAuthor: 'Custom User',
  });

  const trackChanges = useTrackChanges(editor, {
    enabled: true,
    author: 'Custom User',
  });

  const comments = useComments(editor, {
    data: myComments,
    onAdd: handleAddComment,
  });

  if (!isReady) return <div>Loading...</div>;

  return (
    <div>
      <MyCustomToolbar 
        onAcceptAll={trackChanges.acceptAll}
        changes={trackChanges.changes}
      />
      <EditorContent editor={editor} />
      <MyCustomCommentsSidebar 
        comments={comments.comments}
        onGoTo={comments.goToComment}
      />
    </div>
  );
}
```

## Available Exports

```tsx
import {
  // Main component
  DocumentEditor,

  // Hooks
  useDocumentEditor,
  useTrackChanges,
  useComments,

  // Utilities
  createExportPayload,
  exportToWord,
  downloadBlob,

  // TipTap extensions (for custom setups)
  Insertion,
  Deletion,
  Comment,
  TrackChangesMode,
  Section,
  TableWithId,

  // Types
  type DocumentEditorProps,
  type EditorHandle,
  type TipTapDocument,
  type TrackedChange,
  type CommentData,
  type TrackChangesConfig,
  type CommentsConfig,
  type ExportOptions,
  type ExportPayload,
} from 'dedit-react-editor';
```

## Props Reference

### DocumentEditorProps

| Prop | Type | Description |
|------|------|-------------|
| `initialContent` | `TipTapDocument` | Initial content (uncontrolled) |
| `content` | `TipTapDocument` | Controlled content |
| `onChange` | `(content) => void` | Called on content change |
| `editorRef` | `RefObject<EditorHandle>` | Imperative handle ref |
| `readOnly` | `boolean` | Make editor read-only |
| `placeholder` | `string` | Placeholder text |
| `trackChanges` | `TrackChangesConfig` | Track changes configuration |
| `comments` | `CommentsConfig` | Comments configuration |
| `className` | `string` | Root element class |
| `classNames` | `ClassNameConfig` | Granular class names |
| `style` | `CSSProperties` | Inline styles |
| `extensions` | `Extension[]` | Additional TipTap extensions |
| `extensionConfig` | `ExtensionConfig` | Configure built-in extensions |

### TrackChangesConfig

| Prop | Type | Description |
|------|------|-------------|
| `enabled` | `boolean` | Enable track changes mode |
| `author` | `string` | Author name for changes |
| `onAuthorChange` | `(author) => void` | Called when author changes |
| `onAccept` | `(change) => void` | Called when change accepted |
| `onReject` | `(change) => void` | Called when change rejected |

### CommentsConfig

| Prop | Type | Description |
|------|------|-------------|
| `data` | `CommentData[]` | Array of comments |
| `onAdd` | `(range, text) => void` | Called when comment added |
| `onReply` | `(id, text) => void` | Called on reply |
| `onResolve` | `(id) => void` | Called when resolved |
| `onDelete` | `(id) => void` | Called when deleted |

## Backend API Contract

The export payload structure for your backend:

```typescript
interface ExportPayload {
  tiptap: TipTapDocument;      // The document content
  comments: CommentData[];      // Comments to include
  template: 'none' | 'original' | 'custom';
  document_id?: string;         // For 'original' template
  template_id?: string;         // For 'custom' template
  filename: string;
}
```

Your backend should accept this JSON and return a Word document blob.

## License

MIT
