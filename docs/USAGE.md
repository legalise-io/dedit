# dedit-react-editor Usage Guide

A comprehensive guide for integrating the dedit-react-editor component library into your React application. This library provides a flexible, unstyled document editor with track changes, comments, and AI-assisted editing support, built on TipTap/ProseMirror.

## Table of Contents

1. [Installation](#installation)
2. [Quick Start](#quick-start)
3. [Core Concepts](#core-concepts)
4. [Component API](#component-api)
5. [Hooks API](#hooks-api)
6. [Track Changes](#track-changes)
7. [Comments](#comments)
8. [Toolbar Configuration](#toolbar-configuration)
9. [Styling](#styling)
10. [Export to Word](#export-to-word)
11. [Backend Integration](#backend-integration)
12. [TipTap Document Schema](#tiptap-document-schema)
13. [Custom Extensions](#custom-extensions)
14. [TypeScript Types](#typescript-types)
15. [Complete Examples](#complete-examples)
16. [AI-Assisted Editing](#ai-assisted-editing)
17. [Troubleshooting](#troubleshooting)
18. [License](#license)

---

## Installation

```bash
npm install dedit-react-editor
```

### Peer Dependencies

The library requires React 18+ as a peer dependency:

```bash
npm install react react-dom
```

### Bundle Contents

The package exports:
- `dist/index.js` - ES Module build
- `dist/index.cjs` - CommonJS build
- `dist/index.d.ts` - TypeScript declarations
- `dist/styles.css` - Default styles (optional but recommended)

---

## Quick Start

### Basic Editor

```tsx
import { DocumentEditor } from 'dedit-react-editor';
// Import styles (required for default styling)
import 'dedit-react-editor/styles.css';

function App() {
  const [content, setContent] = useState(null);

  return (
    <DocumentEditor
      initialContent={content}
      onChange={(json) => setContent(json)}
      className="my-editor"
    />
  );
}
```

### With Track Changes

```tsx
import { DocumentEditor, EditorHandle } from 'dedit-react-editor';
import 'dedit-react-editor/styles.css';
import { useRef, useState } from 'react';

function App() {
  const editorRef = useRef<EditorHandle>(null);
  const [content, setContent] = useState(null);
  const [trackChangesEnabled, setTrackChangesEnabled] = useState(true);

  const handleAcceptAll = () => {
    editorRef.current?.acceptAllChanges();
  };

  return (
    <>
      <DocumentEditor
        ref={editorRef}
        initialContent={content}
        onChange={setContent}
        trackChanges={{
          enabled: trackChangesEnabled,
          author: "John Doe",
        }}
        toolbar={[
          "bold",
          "italic",
          "separator",
          "trackChangesToggle",
          "separator",
          "prevChange",
          "nextChange",
          "acceptChange",
          "rejectChange",
        ]}
      />
      <button onClick={handleAcceptAll}>Accept All</button>
    </>
  );
}
```

---

## Core Concepts

### Document Format

The editor uses TipTap's JSON document format, which is based on ProseMirror. Documents are structured as a tree of nodes with optional marks (formatting).

```typescript
interface TipTapDocument {
  type: "doc";
  content: TipTapNode[];
}

interface TipTapNode {
  type: string;           // "paragraph", "heading", "table", etc.
  attrs?: object;         // Node attributes
  content?: TipTapNode[]; // Child nodes
  marks?: TipTapMark[];   // Text formatting
  text?: string;          // For text nodes
}

interface TipTapMark {
  type: string;   // "bold", "italic", "insertion", "deletion", "comment"
  attrs?: object; // Mark attributes
}
```

### Controlled vs Uncontrolled

The editor supports both patterns:

**Uncontrolled** (recommended for most cases):
```tsx
<DocumentEditor
  initialContent={loadedDocument}
  onChange={(json) => saveDocument(json)}
/>
```

**Controlled** (for external state management):
```tsx
<DocumentEditor
  content={externalContent}
  onChange={(json) => setExternalContent(json)}
/>
```

---

## Component API

### DocumentEditor Props

```typescript
interface DocumentEditorProps {
  // Content
  initialContent?: TipTapDocument | Record<string, unknown>;
  content?: TipTapDocument | Record<string, unknown>; // Controlled mode
  onChange?: (content: TipTapDocument) => void;

  // Editor State
  readOnly?: boolean;
  placeholder?: string;

  // Track Changes
  trackChanges?: {
    enabled?: boolean;
    author?: string;
    onAuthorChange?: (author: string) => void;
    onAccept?: (change: TrackedChange) => void;
    onReject?: (change: TrackedChange) => void;
  };

  // Comments
  comments?: {
    data?: CommentData[];
    onAdd?: (range: SelectionRange, text: string) => void;
    onReply?: (commentId: string, text: string) => void;
    onResolve?: (commentId: string) => void;
    onDelete?: (commentId: string) => void;
  };

  // Styling
  className?: string;
  classNames?: {
    root?: string;
    content?: string;
  };
  style?: React.CSSProperties;

  // Toolbar
  toolbar?: ToolbarItem[];

  // Extensions
  extensions?: Extension[];           // Additional extensions
  replaceExtensions?: Extension[];    // Replace all default extensions
  extensionConfig?: {
    heading?: { levels?: number[] };
    table?: { resizable?: boolean };
  };
}
```

### EditorHandle (Ref Methods)

Access these methods via a ref:

```typescript
interface EditorHandle {
  // Content
  getContent(): TipTapDocument;
  setContent(content: TipTapDocument): void;

  // Track Changes
  getChanges(): TrackedChange[];
  acceptChange(changeId: string): void;
  rejectChange(changeId: string): void;
  acceptAllChanges(): void;
  rejectAllChanges(): void;
  setTrackChangesEnabled(enabled: boolean): void;
  setTrackChangesAuthor(author: string): void;

  // Editor Control
  getEditor(): Editor | null;  // TipTap Editor instance
  focus(): void;
  blur(): void;

  // Export
  createExportPayload(options?: ExportOptions): ExportPayload;
}
```

**Example:**
```tsx
const editorRef = useRef<EditorHandle>(null);

// Get current content
const content = editorRef.current?.getContent();

// Accept a specific change
editorRef.current?.acceptChange("ins-abc123");

// Focus the editor
editorRef.current?.focus();
```

---

## Hooks API

The library exports hooks for building custom editor UIs.

### useDocumentEditor

Creates and manages a TipTap editor instance.

```typescript
const {
  editor,      // TipTap Editor instance
  content,     // Current content as JSON
  setContent,  // Update content
  isReady,     // Editor initialization status
  focus,       // Focus the editor
  blur,        // Blur the editor
} = useDocumentEditor({
  initialContent: document,
  onChange: (content) => console.log('Changed:', content),
  readOnly: false,
  trackChangesEnabled: true,
  trackChangesAuthor: 'John Doe',
});
```

### useTrackChanges

Manages track changes functionality.

```typescript
const {
  enabled,        // Whether track changes is on
  setEnabled,     // Toggle track changes
  toggle,         // Toggle shortcut
  author,         // Current author name
  setAuthor,      // Set author name
  changes,        // Array of TrackedChange objects
  acceptChange,   // Accept by ID
  rejectChange,   // Reject by ID
  acceptAll,      // Accept all changes
  rejectAll,      // Reject all changes
  findChangeById, // Find change by ID
} = useTrackChanges(editor, {
  enabled: true,
  author: 'John Doe',
  onAccept: (change) => console.log('Accepted:', change),
  onReject: (change) => console.log('Rejected:', change),
});
```

### useComments

Manages comments functionality.

```typescript
const {
  comments,          // Comment data array
  goToComment,       // Navigate to comment location
  getSelection,      // Get current selection range
  getSelectedText,   // Get selected text
  addComment,        // Add comment to selection
  addCommentMark,    // Add comment mark without callback
  removeCommentMark, // Remove comment mark
  deleteComment,     // Delete comment
  resolveComment,    // Resolve comment
  replyToComment,    // Reply to comment
  getCommentAtCursor,// Get comment ID at cursor
  getCommentById,    // Get comment data by ID
  hasCommentMark,    // Check if comment has mark
} = useComments(editor, {
  data: comments,
  onAdd: (range, text) => createComment(range, text),
  onReply: (id, text) => replyToComment(id, text),
  onResolve: (id) => resolveComment(id),
  onDelete: (id) => deleteComment(id),
});
```

---

## Track Changes

Track changes records insertions and deletions with author attribution.

### Enabling Track Changes

```tsx
<DocumentEditor
  trackChanges={{
    enabled: true,
    author: "John Doe",
  }}
/>
```

### TrackedChange Type

```typescript
interface TrackedChange {
  id: string;                        // Unique identifier
  type: "insertion" | "deletion";    // Change type
  author: string | null;             // Author name
  date: string | null;               // ISO date string
  text: string;                      // Changed text
  from: number;                      // Start position
  to: number;                        // End position
}
```

### Programmatic Control

```tsx
const editorRef = useRef<EditorHandle>(null);

// Get all changes
const changes = editorRef.current?.getChanges();

// Accept/reject specific change
editorRef.current?.acceptChange(changes[0].id);
editorRef.current?.rejectChange(changes[1].id);

// Bulk operations
editorRef.current?.acceptAllChanges();
editorRef.current?.rejectAllChanges();
```

### How It Works

When track changes is enabled:
- **Insertions**: New text is wrapped in an `insertion` mark with author/date
- **Deletions**: Deleted text is kept but wrapped in a `deletion` mark

The marks are stored in the document JSON:

```json
{
  "type": "text",
  "text": "new content",
  "marks": [
    {
      "type": "insertion",
      "attrs": {
        "id": "ins-abc123",
        "author": "John Doe",
        "date": "2024-01-15T10:30:00Z"
      }
    }
  ]
}
```

---

## Comments

Comments are anchored to text ranges in the document.

### CommentData Type

```typescript
interface CommentData {
  id: string;
  author: string;
  date: string;
  text: string;
  initials?: string;
  replies?: CommentData[];
}
```

### Adding Comments

```tsx
const [comments, setComments] = useState<CommentData[]>([]);

<DocumentEditor
  comments={{
    data: comments,
    onAdd: (range, text) => {
      const newComment = {
        id: `comment-${Date.now()}`,
        author: "John Doe",
        date: new Date().toISOString(),
        text: text,
      };
      setComments([...comments, newComment]);
    },
    onResolve: (id) => {
      setComments(comments.filter(c => c.id !== id));
    },
  }}
/>
```

### Comment Marks in Document

Comments are stored as marks on text nodes:

```json
{
  "type": "text",
  "text": "commented text",
  "marks": [
    {
      "type": "comment",
      "attrs": {
        "commentId": "comment-123",
        "author": "John Doe",
        "date": "2024-01-15",
        "text": "This needs review"
      }
    }
  ]
}
```

---

## Toolbar Configuration

The built-in toolbar supports these items:

```typescript
type ToolbarItem =
  | "bold"              // Toggle bold
  | "italic"            // Toggle italic
  | "separator"         // Visual separator
  | "undo"              // Undo last action (Ctrl+Z)
  | "redo"              // Redo last action (Ctrl+Y)
  | "trackChangesToggle"// Toggle track changes on/off
  | "prevChange"        // Navigate to previous change
  | "nextChange"        // Navigate to next change
  | "acceptChange"      // Accept current change
  | "rejectChange"      // Reject current change
  | "acceptAll"         // Accept all changes
  | "rejectAll"         // Reject all changes
  | "addRowBefore"      // Add table row above cursor
  | "addRowAfter"       // Add table row below cursor
  | "deleteRow";        // Delete current table row
```

### Example Configuration

```tsx
<DocumentEditor
  toolbar={[
    "undo",
    "redo",
    "separator",
    "bold",
    "italic",
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
    "separator",
    "addRowBefore",
    "addRowAfter",
    "deleteRow",
  ]}
/>
```

### Custom Toolbar

For a fully custom toolbar, omit the `toolbar` prop and build your own using the ref methods:

```tsx
const editorRef = useRef<EditorHandle>(null);

<div className="my-toolbar">
  <button onClick={() => editorRef.current?.getEditor()?.chain().focus().toggleBold().run()}>
    Bold
  </button>
  <button onClick={() => editorRef.current?.acceptAllChanges()}>
    Accept All
  </button>
</div>

<DocumentEditor ref={editorRef} content={content} />
```

---

## Styling

### Importing Default Styles

The library ships with a complete set of default styles. Import them in your application:

```tsx
import 'dedit-react-editor/styles.css';
```

This includes styles for:
- Editor toolbar and buttons
- Track changes (insertions/deletions)
- Comments and tooltips
- AI components (chat panel, prompt input, API key input)
- Find & replace bar

**For Tailwind CSS users:** The styles are plain CSS and work alongside Tailwind. Import the stylesheet after your Tailwind imports to ensure proper cascade order:

```css
/* globals.css */
@import "tailwindcss";
```

```tsx
// In your component or layout
import 'dedit-react-editor/styles.css';
```

### Custom Styling

If you prefer custom styles, you can skip the CSS import and style the components yourself using the class names below.

### CSS Classes

The component renders this structure:

```html
<div class="[className] [classNames.root]">
  <div class="editor-toolbar">
    <button class="toolbar-btn [is-active]">...</button>
    <div class="toolbar-separator"></div>
  </div>
  <div class="editor-scroll-container">
    <div class="[classNames.content] tiptap">
      <!-- Editor content -->
    </div>
  </div>
</div>
```

### Track Changes Styling

```css
/* Insertions - green underline */
.tiptap .insertion {
  background-color: #d4edda;
  text-decoration: underline;
  text-decoration-color: #28a745;
}

/* Deletions - red strikethrough */
.tiptap .deletion {
  background-color: #f8d7da;
  text-decoration: line-through;
  text-decoration-color: #dc3545;
  color: #999;
}

/* Selected change highlight */
.tiptap ins.selected-change,
.tiptap del.selected-change {
  outline: 2px solid #0066cc;
  outline-offset: 1px;
  border-radius: 2px;
}
```

### Comment Styling

```css
/* Comment highlight */
.tiptap .comment-highlight {
  background-color: #fff3cd;
  border-bottom: 2px solid #ffc107;
}

/* Comment tooltip */
.tiptap .comment-highlight[data-comment-text] {
  position: relative;
  cursor: help;
}

.tiptap .comment-highlight[data-comment-text]::before {
  content: attr(data-comment-author) ": " attr(data-comment-text);
  position: absolute;
  left: 0;
  bottom: 100%;
  margin-bottom: 4px;
  background: #333;
  color: white;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 12px;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.15s;
  z-index: 99999;
}

.tiptap .comment-highlight[data-comment-text]:hover::before {
  opacity: 1;
  visibility: visible;
}
```

### Toolbar Styling

```css
.editor-toolbar {
  display: flex;
  gap: 0.25rem;
  padding: 0.5rem;
  border-bottom: 1px solid #eee;
  background: #fafafa;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}

.toolbar-btn:hover {
  background: #e8e8e8;
}

.toolbar-btn.is-active {
  background: #e0e0e0;
  border-color: #ccc;
}

.toolbar-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.toolbar-separator {
  width: 1px;
  height: 24px;
  background: #ddd;
  margin: 4px;
}
```

---

## Export to Word

The library provides utilities for exporting documents to Word format via a backend API.

### Export Utilities

```typescript
import {
  createExportPayload,
  downloadBlob,
  exportToWord,
} from 'dedit-react-editor';
```

### createExportPayload

Creates a payload for your export API:

```typescript
const payload = createExportPayload(
  editorRef.current.getContent(),
  comments,
  {
    filename: 'my-document.docx',
    template: { type: 'original', documentId: 'doc-123' },
    includeComments: true,
  }
);

// Send to your backend
await fetch('/api/export', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
```

### exportToWord

Complete export flow with download:

```typescript
await exportToWord(
  '/api/export',
  editorRef.current.getContent(),
  comments,
  {
    filename: 'my-document.docx',
    template: { type: 'none' },
  }
);
```

### Template Options

```typescript
interface TemplateConfig {
  type: 'none' | 'original' | 'custom';
  documentId?: string;  // For 'original' - uses uploaded doc as template
  templateId?: string;  // For 'custom' - uses uploaded template
}
```

---

## Backend Integration

The sample implementation includes a Python/FastAPI backend for DOCX parsing and export.

### Architecture Overview

```
┌─────────────────────┐     ┌─────────────────────┐
│   React Frontend    │     │   Python Backend    │
│                     │     │                     │
│  ┌───────────────┐  │     │  ┌───────────────┐  │
│  │ DocumentEditor│  │     │  │ FastAPI App   │  │
│  └───────────────┘  │     │  └───────────────┘  │
│         │           │     │         │           │
│         ▼           │     │         ▼           │
│  TipTap JSON ◄──────┼─────┼── DOCX Parser      │
│         │           │     │         │           │
│         ▼           │     │         ▼           │
│  Export Payload ────┼─────┼──► DOCX Exporter   │
│                     │     │                     │
└─────────────────────┘     └─────────────────────┘
```

### API Endpoints

#### POST /upload

Upload a DOCX file and convert to TipTap JSON.

**Request:**
```
Content-Type: multipart/form-data
Body: file=<docx file>
```

**Response:**
```json
{
  "id": "doc-uuid",
  "filename": "document.docx",
  "tiptap": {
    "type": "doc",
    "content": [...]
  },
  "intermediate": [...],
  "comments": [
    {
      "id": "0",
      "author": "John Doe",
      "date": "2024-01-15T10:30:00Z",
      "text": "Please review this section"
    }
  ]
}
```

#### POST /export

Export TipTap JSON to DOCX.

**Request:**
```json
{
  "tiptap": { "type": "doc", "content": [...] },
  "filename": "document.docx",
  "comments": [...],
  "template": "none" | "original" | "custom",
  "document_id": "doc-uuid",
  "template_id": "template-uuid"
}
```

**Response:**
```
Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
Content-Disposition: attachment; filename="document.docx"
Body: <binary docx data>
```

#### POST /templates/upload

Upload a custom template.

**Request:**
```
Content-Type: multipart/form-data
Body: file=<docx template>
```

**Response:**
```json
{
  "id": "template-uuid",
  "filename": "template.docx"
}
```

### Backend Implementation Details

The backend uses:
- **python-docx**: Reading and writing DOCX files
- **lxml**: XML parsing for track changes and comments
- **FastAPI**: REST API framework

#### DOCX Parsing Flow

1. **Extract DOCX contents** (ZIP archive)
2. **Parse document.xml** for content structure
3. **Parse revisions** (`<w:ins>`, `<w:del>` elements)
4. **Parse comments.xml** for comment data
5. **Convert to TipTap JSON** with marks for track changes/comments

#### DOCX Export Flow

1. **Parse TipTap JSON** nodes and marks
2. **Create Document** (blank or from template)
3. **Process nodes** (paragraphs, headings, tables)
4. **Add track changes** via OOXML elements:
   - `<w:ins>` for insertions
   - `<w:del>` with `<w:delText>` for deletions
5. **Add comments** via python-docx API
6. **Return DOCX bytes**

### Running the Sample Backend

```bash
# Install dependencies
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install fastapi uvicorn python-docx python-multipart lxml

# Run server
uvicorn main:app --reload --port 8000
```

### Backend Code Structure

```
backend/
├── main.py                 # FastAPI application
├── parser/
│   ├── __init__.py        # Exports
│   ├── docx_parser.py     # DOCX to intermediate format
│   ├── revisions_parser.py # Track changes extraction
│   ├── comments_parser.py  # Comments extraction
│   ├── tiptap_converter.py # Intermediate to TipTap JSON
│   └── docx_exporter.py   # TipTap JSON to DOCX
```

---

## TipTap Document Schema

### Supported Node Types

#### Paragraph
```json
{
  "type": "paragraph",
  "content": [
    { "type": "text", "text": "Hello world" }
  ]
}
```

#### Heading
```json
{
  "type": "heading",
  "attrs": { "level": 2 },
  "content": [
    { "type": "text", "text": "Section Title" }
  ]
}
```

#### Table
```json
{
  "type": "table",
  "attrs": { "id": "table-123" },
  "content": [
    {
      "type": "tableRow",
      "content": [
        {
          "type": "tableHeader",
          "content": [
            { "type": "paragraph", "content": [...] }
          ]
        }
      ]
    },
    {
      "type": "tableRow",
      "content": [
        {
          "type": "tableCell",
          "content": [
            { "type": "paragraph", "content": [...] }
          ]
        }
      ]
    }
  ]
}
```

#### Section
```json
{
  "type": "section",
  "attrs": {
    "id": "section-123",
    "level": 1,
    "originalRef": "1.2.3"
  },
  "content": [...]
}
```

### Supported Mark Types

#### Bold
```json
{ "type": "bold" }
```

#### Italic
```json
{ "type": "italic" }
```

#### Insertion (Track Change)
```json
{
  "type": "insertion",
  "attrs": {
    "id": "ins-abc123",
    "author": "John Doe",
    "date": "2024-01-15T10:30:00Z"
  }
}
```

#### Deletion (Track Change)
```json
{
  "type": "deletion",
  "attrs": {
    "id": "del-xyz789",
    "author": "Jane Smith",
    "date": "2024-01-15T11:00:00Z"
  }
}
```

#### Comment
```json
{
  "type": "comment",
  "attrs": {
    "commentId": "comment-123",
    "author": "John Doe",
    "date": "2024-01-15",
    "text": "Please review this"
  }
}
```

---

## Custom Extensions

### Adding Extensions

Add TipTap extensions alongside the defaults:

```tsx
import { Extension } from '@tiptap/core';
import Underline from '@tiptap/extension-underline';

<DocumentEditor
  extensions={[Underline]}
  // ... other props
/>
```

### Replacing All Extensions

For complete control, replace the default extensions:

```tsx
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Insertion, Deletion } from 'dedit-react-editor';

<DocumentEditor
  replaceExtensions={[
    Document,
    Paragraph,
    Text,
    Insertion,
    Deletion,
    // ... only what you need
  ]}
/>
```

### Exported Extensions

The library exports its custom extensions:

```typescript
import {
  Insertion,           // Track changes insertion mark
  Deletion,            // Track changes deletion mark
  Comment,             // Comment mark
  TrackChangesMode,    // Track changes behavior extension
  Section,             // Section node for document structure
  TableWithId,         // Table node with ID support
  ParagraphWithId,     // Paragraph node with UUID support (required for AI editing)
  PersistentSelection, // Shows selection highlight when editor loses focus
} from 'dedit-react-editor';
```

#### ParagraphWithId

A custom paragraph node that automatically assigns a unique UUID to each paragraph. This is **required for AI editing** because it allows the AI to reference specific paragraphs when making edits.

```typescript
import { useEditor } from '@tiptap/react';
import { ParagraphWithId } from 'dedit-react-editor';

const editor = useEditor({
  extensions: [
    // Use ParagraphWithId instead of the default Paragraph
    ParagraphWithId,
    // ... other extensions
  ],
});
```

The paragraph IDs are stored in the document JSON:

```json
{
  "type": "paragraph",
  "attrs": {
    "id": "550e8400-e29b-41d4-a716-446655440000"
  },
  "content": [{ "type": "text", "text": "Hello world" }]
}
```

**Custom Attributes**

You can configure additional attributes to be rendered to the DOM. This is useful when your backend assigns extra metadata (like paragraph indices) that you need to query in the DOM:

```typescript
import { ParagraphWithId } from 'dedit-react-editor';

const editor = useEditor({
  extensions: [
    ParagraphWithId.configure({
      customAttributes: ["paragraphIndex", "sectionId"]
    }),
    // ... other extensions
  ],
});
```

With this configuration:
- Document JSON: `{ "type": "paragraph", "attrs": { "id": "abc", "paragraphIndex": 5, "sectionId": "sec-1" } }`
- Rendered HTML: `<p data-paragraph-id="abc" data-paragraph-index="5" data-section-id="sec-1">...</p>`

Attribute names are automatically converted from camelCase to kebab-case with a `data-` prefix. You can then query these elements:

```typescript
// Find paragraph by index
const paragraph = document.querySelector('[data-paragraph-index="5"]');
paragraph?.scrollIntoView({ behavior: 'smooth' });
```

**Dynamic Styling with className**

The extension includes a built-in `className` attribute that renders as an actual `class` attribute (not `data-class-name`). This allows external components to dynamically style paragraphs:

```typescript
// Set class via editor transaction
editor.commands.command(({ tr, state }) => {
  state.doc.descendants((node, pos) => {
    if (node.type.name === "paragraph" && node.attrs.paragraphIndex === 5) {
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        className: "highlighted",
      });
    }
  });
  return true;
});

// Or in document JSON
{ "type": "paragraph", "attrs": { "id": "p-5", "className": "highlighted" } }
```

Rendered HTML:
```html
<p data-paragraph-id="p-5" class="highlighted">Content here</p>
```

CSS:
```css
.tiptap p.highlighted {
  background-color: #fff3cd;
  border-left: 3px solid #ffc107;
}
```

#### PersistentSelection

An extension that preserves the visual appearance of selected text when the editor loses focus. This is useful for AI editing workflows where users select text, then click on a prompt input to describe what to do with that selection.

The extension is **fully self-contained** - it automatically sets up focus/blur event handlers via TipTap's lifecycle hooks. No additional setup required:

```typescript
import { useEditor } from '@tiptap/react';
import { PersistentSelection } from 'dedit-react-editor';

const editor = useEditor({
  extensions: [
    PersistentSelection,
    // ... other extensions
  ],
});
// That's it! Focus/blur handlers are set up automatically.
```

**How it works:**
1. User selects text in the editor
2. User clicks outside the editor (e.g., on an AI prompt input)
3. The `blur` event fires → selection `{from, to}` is saved to storage
4. The plugin renders `.persistent-selection` decorations on the saved range
5. A gray highlight appears, mimicking the native selection
6. User clicks back in the editor
7. The `focus` event fires → saved selection is cleared, decorations removed
8. Native browser selection takes over again

CSS required for the persistent selection highlight:

```css
.tiptap .persistent-selection {
  background-color: #dfdfdf;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
```

**Note:** The default styles (`dedit-react-editor/styles.css`) already include this CSS.

---

## TypeScript Types

### Full Type Exports

```typescript
import type {
  // Document types
  TipTapDocument,
  TipTapNode,
  TipTapMark,

  // Comment types
  CommentData,
  SelectionRange,

  // Track changes types
  TrackedChange,
  TrackChangesConfig,

  // Comments config
  CommentsConfig,

  // Styling
  ClassNameConfig,

  // Extensions
  ExtensionConfig,

  // Toolbar
  ToolbarItem,

  // Export
  TemplateConfig,
  ExportOptions,
  ExportPayload,

  // Component
  EditorHandle,
  DocumentEditorProps,
  UseDocumentEditorOptions,

  // Hook returns
  UseDocumentEditorReturn,
  UseTrackChangesOptions,
  UseTrackChangesReturn,
  UseCommentsOptions,
  UseCommentsReturn,

  // AI types
  AIEdit,
  AIEditRequest,
  AIEditResponse,
  AIEditorConfig,
  AIEditorState,
  AIResponse,
  ChatMessage,
  SelectionContext,
} from 'dedit-react-editor';
```

---

## Complete Examples

### Full-Featured Editor with Backend

```tsx
import { useRef, useState, useCallback } from 'react';
import {
  DocumentEditor,
  EditorHandle,
  CommentData,
  exportToWord,
} from 'dedit-react-editor';
import 'dedit-react-editor/styles.css';

interface DocumentData {
  id: string;
  filename: string;
  tiptap: Record<string, unknown>;
  comments: CommentData[];
}

function FullEditor() {
  const editorRef = useRef<EditorHandle>(null);
  const [document, setDocument] = useState<DocumentData | null>(null);
  const [comments, setComments] = useState<CommentData[]>([]);
  const [trackChangesEnabled, setTrackChangesEnabled] = useState(false);
  const [currentAuthor, setCurrentAuthor] = useState('Anonymous');

  // Upload document
  const handleUpload = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('http://localhost:8000/upload', {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();
    setDocument(data);
    setComments(data.comments || []);
  };

  // Export document
  const handleExport = async () => {
    if (!editorRef.current || !document) return;

    await exportToWord(
      'http://localhost:8000/export',
      editorRef.current.getContent(),
      comments,
      {
        filename: document.filename,
        template: { type: 'original', documentId: document.id },
      }
    );
  };

  // Add comment
  const handleAddComment = useCallback((range: any, text: string) => {
    const newComment: CommentData = {
      id: `comment-${Date.now()}`,
      author: currentAuthor,
      date: new Date().toISOString(),
      text,
    };
    setComments(prev => [...prev, newComment]);
  }, [currentAuthor]);

  // Resolve comment
  const handleResolveComment = useCallback((commentId: string) => {
    setComments(prev => prev.filter(c => c.id !== commentId));
  }, []);

  return (
    <div className="editor-app">
      {/* Upload */}
      <input
        type="file"
        accept=".docx"
        onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
      />

      {/* Author input */}
      <input
        type="text"
        value={currentAuthor}
        onChange={(e) => setCurrentAuthor(e.target.value)}
        placeholder="Your name"
      />

      {/* Editor */}
      <DocumentEditor
        ref={editorRef}
        initialContent={document?.tiptap}
        onChange={(json) => {
          // Auto-save logic here
        }}
        trackChanges={{
          enabled: trackChangesEnabled,
          author: currentAuthor,
          onAccept: (change) => console.log('Accepted:', change.id),
          onReject: (change) => console.log('Rejected:', change.id),
        }}
        comments={{
          data: comments,
          onAdd: handleAddComment,
          onResolve: handleResolveComment,
        }}
        toolbar={[
          'bold',
          'italic',
          'separator',
          'trackChangesToggle',
          'separator',
          'prevChange',
          'nextChange',
          'acceptChange',
          'rejectChange',
          'separator',
          'acceptAll',
          'rejectAll',
        ]}
        className="document-editor"
      />

      {/* Export button */}
      <button onClick={handleExport} disabled={!document}>
        Export to Word
      </button>

      {/* Comments sidebar */}
      <aside className="comments-panel">
        <h3>Comments ({comments.length})</h3>
        {comments.map(comment => (
          <div key={comment.id} className="comment-item">
            <strong>{comment.author}</strong>
            <p>{comment.text}</p>
            <button onClick={() => handleResolveComment(comment.id)}>
              Resolve
            </button>
          </div>
        ))}
      </aside>
    </div>
  );
}

export default FullEditor;
```

### Using Hooks for Custom UI

```tsx
import { useDocumentEditor, useTrackChanges, useComments } from 'dedit-react-editor';
import 'dedit-react-editor/styles.css';
import { EditorContent } from '@tiptap/react';

function CustomEditor({ initialContent, comments: commentData }) {
  const { editor, setContent } = useDocumentEditor({
    initialContent,
    trackChangesEnabled: true,
    trackChangesAuthor: 'Custom User',
  });

  const {
    enabled: trackChangesOn,
    toggle: toggleTrackChanges,
    changes,
    acceptAll,
    rejectAll,
  } = useTrackChanges(editor);

  const {
    goToComment,
    addComment,
  } = useComments(editor, {
    data: commentData,
  });

  if (!editor) return <div>Loading...</div>;

  return (
    <div>
      {/* Custom toolbar */}
      <div className="my-toolbar">
        <button
          onClick={toggleTrackChanges}
          className={trackChangesOn ? 'active' : ''}
        >
          Track Changes: {trackChangesOn ? 'ON' : 'OFF'}
        </button>

        <span>Changes: {changes.length}</span>

        <button onClick={acceptAll} disabled={changes.length === 0}>
          Accept All
        </button>

        <button onClick={rejectAll} disabled={changes.length === 0}>
          Reject All
        </button>
      </div>

      {/* Editor */}
      <EditorContent editor={editor} className="tiptap" />

      {/* Changes list */}
      <ul className="changes-list">
        {changes.map(change => (
          <li key={change.id}>
            <span className={`change-type ${change.type}`}>
              {change.type}
            </span>
            <span className="change-text">{change.text}</span>
            <span className="change-author">{change.author}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### Complete AI Editor Example

A full example combining the DocumentEditor with all AI components:

```tsx
import { useState, useCallback } from 'react';
import {
  DocumentEditor,
  AIEditorProvider,
  useAIEditor,
  APIKeyInput,
  AIChatPanel,
  PromptInput,
} from 'dedit-react-editor';
import 'dedit-react-editor/styles.css';

function App() {
  return (
    <AIEditorProvider config={{ aiAuthorName: "AI Assistant" }}>
      <AIEditorLayout />
    </AIEditorProvider>
  );
}

function AIEditorLayout() {
  const { setEditor, apiKey } = useAIEditor();
  const [content, setContent] = useState(null);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '1rem', height: '100vh', padding: '1rem' }}>
      {/* Left: Editor */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <DocumentEditor
          initialContent={content}
          onChange={setContent}
          onEditorReady={setEditor}
          trackChanges={{
            enabled: true,
            author: "AI Assistant",
          }}
          toolbar={[
            "bold",
            "italic",
            "separator",
            "trackChangesToggle",
            "prevChange",
            "nextChange",
            "acceptChange",
            "rejectChange",
          ]}
        />
      </div>

      {/* Right: AI Panel */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* API Key (only needed for direct OpenAI mode) */}
        <APIKeyInput showLabel />

        {/* Chat history with edit controls */}
        <AIChatPanel 
          showHeader 
          headerTitle="AI Assistant" 
          maxHeight="400px" 
        />

        {/* Prompt input */}
        <PromptInput 
          placeholder="Ask AI to edit the document..."
          showSelectionIndicator 
        />
      </div>
    </div>
  );
}

export default App;
```

**How it works:**
1. User enters their OpenAI API key in `APIKeyInput`
2. User selects text in the editor (optional) and types a prompt
3. `PromptInput` sends the request to OpenAI with document context
4. AI response appears in `AIChatPanel` with clickable edit links
5. Each edit shows the change with Accept/Reject buttons
6. Accepted edits remain as track changes; rejected edits are reverted

---

## AI-Assisted Editing

The library includes AI components for integrating AI-powered editing capabilities. These components use a **provider pattern** allowing them to be placed anywhere in your layout while still communicating. The AI system supports both **direct OpenAI API calls** (for development/demos) and **backend proxy mode** (for production SaaS applications).

### AI Components Overview

| Component | Purpose |
|-----------|---------|
| `AIEditorProvider` | Context provider - wrap your app with this |
| `APIKeyInput` | Input for user's OpenAI API key (direct mode only) |
| `AIChatPanel` | Displays AI conversation with inline edit controls |
| `PromptInput` | Text input for AI prompts |

### Quick Start with AI (Direct OpenAI Mode)

For development or demos where users provide their own API key:

```tsx
import {
  DocumentEditor,
  AIEditorProvider,
  useAIEditor,
  APIKeyInput,
  AIChatPanel,
  PromptInput,
} from 'dedit-react-editor';
import 'dedit-react-editor/styles.css';

function AIEditorApp() {
  return (
    <AIEditorProvider config={{ aiAuthorName: "AI Assistant" }}>
      <AppContent />
    </AIEditorProvider>
  );
}

function AppContent() {
  const { setEditor } = useAIEditor();

  return (
    <div className="ai-editor-layout">
      {/* API Key input (direct mode) */}
      <div className="settings">
        <APIKeyInput showLabel />
      </div>

      {/* Editor */}
      <div className="editor">
        <DocumentEditor
          content={document}
          onEditorReady={(editor) => setEditor(editor)}
          trackChanges={{ enabled: true, author: "AI Assistant" }}
        />
      </div>

      {/* Chat panel with edit controls */}
      <div className="chat">
        <AIChatPanel />
      </div>

      {/* Prompt input */}
      <div className="prompt">
        <PromptInput />
      </div>
    </div>
  );
}
```

### Backend Proxy Mode (Recommended for Production)

For SaaS applications where you need authentication, auditing, or server-side AI calls:

```tsx
import {
  AIEditorProvider,
  AIEditRequest,
  AIEditResponse,
} from 'dedit-react-editor';
import 'dedit-react-editor/styles.css';

function AIEditorApp() {
  // Custom handler routes all AI calls through your backend
  const handleAIRequest = async (request: AIEditRequest): Promise<AIEditResponse> => {
    const response = await fetch('/api/ai/edit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`,  // Your auth
      },
      body: JSON.stringify({
        ...request,
        documentId: currentDocumentId,  // For auditing
        userId: currentUser.id,          // For auditing
      }),
    });

    if (!response.ok) {
      throw new Error('AI request failed');
    }

    return response.json();
  };

  return (
    <AIEditorProvider
      config={{
        aiAuthorName: "AI Assistant",
        onAIRequest: handleAIRequest,  // Backend proxy mode
      }}
    >
      <AppContent />
    </AIEditorProvider>
  );
}
```

When `onAIRequest` is provided, the API key input is not required.

### AI Request/Response Types

```typescript
// Request sent to your backend (or used internally for direct mode)
interface AIEditRequest {
  prompt: string;
  paragraphs: Array<{ id: string; text: string }>;
  selection?: {
    text: string;
    hasSelection: boolean;
  };
}

// Response expected from your backend
interface AIEditResponse {
  message: string;  // AI's explanation of changes
  edits: Array<{
    paragraphId: string;  // UUID of paragraph to edit
    newText: string;      // Complete new text for paragraph
    reason?: string;      // Why this change was made
  }>;
}
```

### AIEditorConfig Options

```typescript
interface AIEditorConfig {
  // Author name shown on AI-generated track changes
  aiAuthorName?: string;

  // Custom AI request handler - if provided, all AI calls go through this
  // If not provided, falls back to direct OpenAI API (requires apiKey)
  onAIRequest?: (request: AIEditRequest) => Promise<AIEditResponse>;

  // Only used if onAIRequest is not provided (direct OpenAI mode)
  aiModel?: string;        // Default: "gpt-4.1-mini"
  aiTemperature?: number;  // Default: 1.0
}
```

### How AI Edits Work

1. **User sends prompt** via the `PromptInput` component
2. **AI analyzes document** - each paragraph has a unique UUID
3. **AI returns edits** - specifying which paragraphs to change and their new text
4. **Word-level diffing** - the system computes word-level differences automatically
5. **Track changes applied** - deletions and insertions are marked as paired track changes
6. **User reviews in chat** - each edit shows `"old text" → "new text"` with accept/reject buttons
7. **Accept/Reject** - accepting/rejecting an edit handles both the deletion and insertion as a unit

### AIEdit Type

Individual word-level changes tracked by the system:

```typescript
interface AIEdit {
  id: string;
  paragraphId: string;
  deletedText: string;    // Text being removed (empty for pure insertions)
  insertedText: string;   // Text being added (empty for pure deletions)
  reason?: string;        // AI's explanation
  deletionId?: string;    // Track change ID for deletion mark
  insertionId?: string;   // Track change ID for insertion mark
  status: "pending" | "applied" | "accepted" | "rejected";
}
```

### useAIEditor Hook

Access AI state from any component:

```typescript
const {
  // Config
  config,               // Current AIEditorConfig
  setConfig,            // Update config

  // API Key (direct mode only)
  apiKey,               // Current key (or null)
  setApiKey,            // Set/clear key

  // Editor
  editor,               // TipTap editor instance
  setEditor,            // Register editor

  // Selection
  selectionContext,     // {text, from, to, hasSelection}

  // Chat
  messages,             // Message history with edits
  addMessage,           // Add message
  clearMessages,        // Clear history

  // State
  isLoading,            // Request in progress
  error,                // Error message
  setError,             // Set error

  // Actions
  sendPrompt,           // Send prompt to AI
  scrollToEdit,         // Scroll editor to show an edit
  goToEditAndSelect,    // Navigate to and select an edit

  // Edit Management
  acceptEdit,           // Accept an edit (handles paired deletion/insertion)
  rejectEdit,           // Reject an edit (handles paired deletion/insertion)
  getPendingEdits,      // Get all pending edits
  getNextEdit,          // Get next edit after current one
  updateEditStatusByTrackChangeId,  // Sync status from external sources
} = useAIEditor();
```

### AIChatPanel Features

The chat panel displays the conversation and provides inline edit controls:

- **Edit links** - Click to scroll editor to that change
- **Edit display** - Shows `"deleted" → "inserted"` format
- **Accept/Reject buttons** - Per-edit controls
- **Auto-advance** - After accept/reject, automatically advances to next edit
- **Status sync** - Edits accepted/rejected via editor context menu update chat display

### Editor Context Menu

Right-click in the editor to access a context menu for bulk operations:

- **Accept Changes in Selection** - Accept all track changes within selected text
- **Reject Changes in Selection** - Reject all track changes within selected text

The context menu automatically syncs with the AI chat panel.

### Persistent Selection

When the editor loses focus (e.g., when clicking in the chat panel), the current selection remains visually highlighted. This helps users see what text they've selected while interacting with AI features.

### Component Props

#### APIKeyInput

```tsx
<APIKeyInput
  className=""       // Additional CSS class
  showLabel={true}   // Show "OpenAI API Key" label
  compact={false}    // Compact mode (status + change button)
/>
```

#### AIChatPanel

```tsx
<AIChatPanel
  className=""              // Additional CSS class
  showHeader={true}         // Show header with title
  headerTitle="AI Chat"     // Header title
  maxHeight="400px"         // Max height for messages
/>
```

#### PromptInput

```tsx
<PromptInput
  className=""                  // Additional CSS class
  placeholder=""                // Custom placeholder
/>
```

### Backend Implementation Guide

When using backend proxy mode, your backend should:

1. **Authenticate** the request using your auth system
2. **Log/audit** the request for compliance
3. **Build the AI prompt** using the paragraphs and selection context
4. **Call your AI provider** (OpenAI, Anthropic, etc.)
5. **Parse the response** into the expected format
6. **Return edits** with paragraph IDs and new text

Example backend endpoint (pseudocode):

```python
@app.post("/api/ai/edit")
async def ai_edit(request: AIEditRequest, user: User = Depends(get_current_user)):
    # Audit logging
    log_ai_request(user.id, request.document_id, request.prompt)

    # Build prompt with document context
    system_prompt = build_system_prompt(request.paragraphs, request.selection)

    # Call AI provider
    response = await openai.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": request.prompt}
        ],
        response_format={"type": "json_object"}
    )

    # Parse and return
    result = json.loads(response.choices[0].message.content)
    return AIEditResponse(
        message=result["message"],
        edits=result["edits"]
    )
```

### Security Notes

**Direct Mode:**
- API key stored in browser `localStorage`
- Key sent directly to OpenAI
- Suitable for demos/development only

**Backend Proxy Mode (Recommended for Production):**
- API keys stay on server
- Full authentication/authorization control
- Audit trail for compliance
- Rate limiting and cost control
- Can swap AI providers without frontend changes

### CSS Classes

AI components use these CSS classes for styling:

```css
/* API Key Input */
.api-key-input
.api-key-input--compact
.api-key-label
.api-key-form
.api-key-btn

/* Chat Panel */
.ai-chat-panel
.ai-chat-header
.ai-chat-messages
.chat-message
.chat-message--user
.chat-message--assistant
.chat-message--system

/* Edit Display */
.ai-edit-row
.ai-edit-link
.ai-edit-text
.ai-edit-deleted
.ai-edit-inserted
.ai-edit-actions
.ai-edit-accept-btn
.ai-edit-reject-btn

/* Prompt Input */
.prompt-input
.prompt-textarea
.prompt-submit-btn

/* Editor Persistent Selection */
.persistent-selection
```

---

## Troubleshooting

### Common Issues

**Editor not rendering:**
- Ensure React 18+ is installed
- Check that content is valid TipTap JSON format

**Track changes not working:**
- Verify `trackChanges.enabled` is `true`
- Check that `trackChanges.author` is set

**Styles not appearing:**
- The component is unstyled - add your own CSS
- See [Styling](#styling) section for reference styles

**Export failing:**
- Verify backend is running on correct port
- Check browser console for CORS errors
- Ensure document was uploaded first (for `original` template)

### Browser Support

- Chrome 90+
- Firefox 90+
- Safari 14+
- Edge 90+

### Performance Tips

- For large documents (>1000 paragraphs), consider pagination
- Use `onChange` with debouncing for auto-save
- Avoid controlled mode unless necessary

---

## License

AGPL-3.0-only - see LICENSE file for details.
