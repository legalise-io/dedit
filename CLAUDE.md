# CLAUDE.md - dedit Project Guide

> Project context and guidance for AI assistants
> Last Updated: 2024

## Important Notes

- **Preferred OpenAI Model**: `gpt-5-mini` - Use this as the default model for AI features

## Project Overview

**dedit** (Document Editor) is a full-stack document editing solution that enables:
- Editing Microsoft Word documents in the browser
- Track changes with multi-author support
- Comments with threading
- Real-time collaboration
- Lossless round-trip conversion (DOCX ↔ TipTap JSON)

The project is published as an npm package (`dedit-react-editor`) and consists of three main components that work together.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Frontend                                   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    dedit-react-editor                        │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │   │
│  │  │ DocumentEditor│  │   Hooks      │  │   Extensions     │   │   │
│  │  │  Component    │  │ useTrack...  │  │ Insertion        │   │   │
│  │  │              │  │ useComments  │  │ Deletion         │   │   │
│  │  │              │  │ useCollab    │  │ TrackChangesMode │   │   │
│  │  └──────────────┘  └──────────────┘  │ RawStylesStorage │   │   │
│  │                                       └──────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         │                                           │
         │ HTTP/REST                                 │ WebSocket
         ▼                                           ▼
┌─────────────────────┐                 ┌─────────────────────┐
│      Backend        │                 │   Collab Server     │
│    (FastAPI)        │                 │   (Hocuspocus)      │
│  ┌───────────────┐  │                 │                     │
│  │  docx2tiptap  │  │                 │  - Yjs document     │
│  │   (Python)    │  │                 │  - Cursor sync      │
│  │               │  │                 │  - Presence         │
│  └───────────────┘  │                 └─────────────────────┘
└─────────────────────┘
```

## Directory Structure

```
dedit/
├── frontend/                 # React/TipTap editor (npm package)
│   ├── src/
│   │   ├── App.tsx          # Demo application
│   │   ├── main.tsx         # Entry point
│   │   ├── index.css        # All styles including track changes
│   │   ├── lib/             # Published library code
│   │   │   ├── DocumentEditor.tsx    # Main component
│   │   │   ├── hooks/       # React hooks
│   │   │   │   ├── useDocumentEditor.ts  # Core editor hook
│   │   │   │   ├── useTrackChanges.ts    # Track changes logic
│   │   │   │   ├── useComments.ts        # Comments logic
│   │   │   │   └── useCollaboration.ts   # Real-time collab
│   │   │   ├── types/       # TypeScript interfaces
│   │   │   └── utils/       # Utilities
│   │   │       ├── authorColors.ts       # Shared color palette
│   │   │       └── createExportPayload.ts
│   │   ├── extensions/      # TipTap/ProseMirror extensions
│   │   │   ├── Insertion.ts           # Track change insertion mark
│   │   │   ├── Deletion.ts            # Track change deletion mark
│   │   │   ├── TrackChangesMode.ts    # Main track changes logic
│   │   │   ├── RawStylesStorage.ts    # Invisible OOXML storage
│   │   │   ├── Comment.ts             # Comment mark
│   │   │   └── ...
│   │   ├── components/      # UI components
│   │   │   ├── TrackChangesToolbar.tsx
│   │   │   ├── CommentsPanel.tsx
│   │   │   ├── FindReplaceBar.tsx
│   │   │   └── ai/          # AI editing components
│   │   └── context/         # React context providers
│   └── package.json
│
├── backend/                  # Python FastAPI server
│   ├── main.py              # API endpoints
│   └── pyproject.toml
│
├── docx2tiptap/             # Python DOCX conversion library
│   ├── src/docx2tiptap/
│   │   ├── docx_parser.py       # DOCX → Intermediate
│   │   ├── tiptap_converter.py  # Intermediate → TipTap JSON
│   │   ├── docx_exporter.py     # TipTap JSON → DOCX
│   │   ├── comments_parser.py   # Comment extraction
│   │   └── revisions_parser.py  # Track changes extraction
│   ├── DOCUMENTATION.md     # Comprehensive library docs
│   └── pyproject.toml
│
├── collab-server/           # Hocuspocus WebSocket server
│   ├── server.js
│   └── package.json
│
└── docs/                    # Additional documentation
```

## Key Concepts

### 1. Track Changes

Track changes marks edits with author, date, and type (insertion/deletion).

**Data flow:**
1. User types in editor with track changes enabled
2. `TrackChangesMode.ts` intercepts via ProseMirror `appendTransaction`
3. Instead of direct edits, marks are applied (insertion/deletion)
4. Marks include `id`, `author`, `date` attributes
5. On export, marks become OOXML `<w:ins>` / `<w:del>` elements

**Author-based logic:**
- Deleting your own insertion → text disappears (undo your work)
- Deleting another author's insertion → marked as deletion in your color
- Deleting already-deleted text → no-op (text is restored)

**Key files:**
- `frontend/src/extensions/TrackChangesMode.ts` - Core logic
- `frontend/src/extensions/Insertion.ts` - Insertion mark definition
- `frontend/src/extensions/Deletion.ts` - Deletion mark definition
- `frontend/src/lib/utils/authorColors.ts` - Color palette

### 2. Author Colors

Unified color system for track changes and collaboration cursors.

```typescript
// 10 distinct colors, each with primary and light variant
const AUTHOR_COLORS = [
  { primary: "#9333EA", light: "#F3E8FF", name: "purple" },
  { primary: "#2563EB", light: "#DBEAFE", name: "blue" },
  // ...
];

// Consistent color from author name hash
getAuthorColor("John Doe") // Always returns same color
```

**Usage:**
- Track changes: text color (insertion) or strikethrough color (deletion)
- Collaboration: cursor and selection highlight color
- Tooltip shows author name on hover

### 3. Lossless Round-Tripping (Raw Styles Storage)

TipTap strips unknown attributes, causing style loss. Solution: invisible storage node.

**Import flow (Python → Frontend):**
1. `tiptap_converter.py` extracts raw OOXML (tblPr, tblGrid, tcPr, trPr)
2. Base64-encodes and stores in key-value dict
3. Appends `rawStylesStorage` node to document
4. Removes raw attrs from visible nodes (TipTap would strip them anyway)

**Export flow (Frontend → Python):**
1. `docx_exporter.py` finds `rawStylesStorage` node
2. Deserializes key-value data
3. Restores raw XML to table/row/cell elements
4. Removes storage node from output

**Key storage schema:**
```
table:{id}:tblPr          → Table properties
table:{id}:tblGrid        → Column grid
table:{id}:row:{idx}      → Row properties
table:{id}:row:{idx}:cell:{idx} → Cell properties
```

**Key files:**
- `docx2tiptap/src/docx2tiptap/tiptap_converter.py` - `_extract_and_store_raw_styles()`
- `docx2tiptap/src/docx2tiptap/docx_exporter.py` - `_restore_raw_styles()`
- `frontend/src/extensions/RawStylesStorage.ts` - TipTap node definition

### 4. Real-Time Collaboration

Uses Yjs + Hocuspocus for CRDT-based collaboration.

**Components:**
- `useCollaboration.ts` - React hook that creates Yjs doc and extensions
- `collab-server/` - Hocuspocus server for WebSocket sync
- Cursor colors use shared `authorColors` palette

**Usage:**
```typescript
const { extensions, status, connectedUsers } = useCollaboration({
  serverUrl: "ws://localhost:1234",
  documentName: "my-doc",
  user: { name: "John", color: getUserColor("John") },
});
```

## API Endpoints (Backend)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/upload` | POST | Upload DOCX, returns TipTap JSON |
| `/export` | POST | Convert TipTap JSON to DOCX |
| `/documents/{id}` | GET | Retrieve uploaded document |
| `/templates/upload` | POST | Upload custom template |
| `/templates/{id}` | DELETE | Delete template |

## Development Commands

### Frontend
```bash
cd frontend
npm install
npm run dev          # Start dev server (Vite)
npm run build        # Build library
npm run build:lib    # Build as npm package
```

### Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e ../docx2tiptap
pip install fastapi uvicorn python-multipart
uvicorn main:app --reload --port 8000
```

### Collaboration Server
```bash
cd collab-server
npm install
npm run dev
```

### Full Stack (using Procfile.dev)
```bash
# From project root
overmind start -f Procfile.dev
# Or: foreman start -f Procfile.dev
```

## TipTap Extensions Reference

| Extension | Purpose |
|-----------|---------|
| `Insertion` | Mark for tracked insertions (renders as `<ins>`) |
| `Deletion` | Mark for tracked deletions (renders as `<del>`) |
| `TrackChangesMode` | Plugin that intercepts edits and creates marks |
| `RawStylesStorage` | Invisible node storing OOXML for round-tripping |
| `Comment` | Mark for comment highlights |
| `Section` | Custom node for document sections |
| `TableWithId` | Table extension with UUID support |
| `ParagraphWithId` | Paragraph with tracking ID |
| `PersistentSelection` | Maintains selection highlight when blurred |
| `SearchAndReplace` | Find/replace functionality |

## Common Tasks

### Adding a new track change feature
1. Modify `TrackChangesMode.ts` appendTransaction logic
2. Update mark schemas in `Insertion.ts` / `Deletion.ts` if needed
3. Add CSS in `index.css` for visual styling
4. Update `useTrackChanges.ts` for React integration

### Modifying author colors
1. Edit `frontend/src/lib/utils/authorColors.ts`
2. Update CSS custom properties in `index.css` if needed
3. Colors auto-apply to both track changes and collaboration

### Adding new OOXML preservation
1. Extract in `tiptap_converter.py` `_extract_and_store_raw_styles()`
2. Use consistent key naming: `{element}:{id}:{property}`
3. Restore in `docx_exporter.py` `_restore_raw_styles()`

### Debugging track changes
1. Check browser console for ProseMirror transaction logs
2. Use `tr.getMeta()` to inspect transaction metadata
3. Examine marks on text nodes via editor.getJSON()

## Testing

```bash
# Frontend
cd frontend && npm test

# Python library
cd docx2tiptap && pytest

# Type checking
cd frontend && npx tsc --noEmit
```

## Key Dependencies

**Frontend:**
- `@tiptap/react` - React bindings for TipTap
- `@tiptap/pm` - ProseMirror core
- `@tiptap/extension-table` - Table support
- `@hocuspocus/provider` - Collaboration client
- `yjs` - CRDT for real-time sync

**Backend:**
- `fastapi` - API framework
- `python-docx` - DOCX manipulation
- `lxml` - XML parsing

**Collaboration:**
- `@hocuspocus/server` - WebSocket server

## Gotchas & Tips

1. **Track changes infinite loop**: Always check `tr.getMeta("trackChangesProcessed")` to prevent recursive processing

2. **Raw styles lost**: Ensure `RawStylesStorage` extension is registered in TipTap editor

3. **Author colors not matching**: Use `getUserColor(name)` not `generateUserColor()` for consistency

4. **Table merges broken**: The cleanup in `docx_exporter.py` `_cleanup_merged_cells()` handles python-docx merge artifacts

5. **Comments not appearing**: Verify comment marks have `commentId` attribute and Comment extension is registered

## Related Documentation

- `docx2tiptap/DOCUMENTATION.md` - Full library documentation
- `docs/USAGE.md` - User guide
- `docs/track-changes-plan.md` - Track changes implementation details
- `README.md` - npm package documentation
