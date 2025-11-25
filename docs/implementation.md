# Implementation Plan: Document Editor PoC

> Created: 2025-11-25
> Status: Planning

## Overview

Build a proof of concept demonstrating the core workflow: **DOCX → Structured JSON → Tiptap Editor → AI Manipulation**. The PoC focuses on validating that section references can be preserved through the entire pipeline.

## Scope

### In Scope (PoC)
- Parse a Word document and extract sections with computed numbering
- Convert to a Tiptap-compatible JSON structure with preserved section IDs
- **Parse and preserve tables, including rich textual content within cells**
- Display in a minimal Tiptap editor with table editing support
- Demonstrate programmatic manipulation (simulating AI edits)

### Out of Scope (PoC)
- Real-time collaboration (Y.js)
- Production-quality UI
- Full Word formatting preservation (bold/italic preserved, complex styles deferred)
- Actual AI integration
- DOCX export
- Merged cells / complex table layouts

## Architecture

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   DOCX      │ -> │   Parser    │ -> │  Tiptap     │ -> │    AI       │
│   Upload    │    │  (Python)   │    │  Editor     │    │  Edits      │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                         │                   │
                         v                   v
                   ┌─────────────┐    ┌─────────────┐
                   │  JSON       │    │  JSON       │
                   │  (Sections) │    │  (Tiptap)   │
                   └─────────────┘    └─────────────┘
```

## Tech Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Parser | Python + `python-docx` | Extract DOCX with computed list numbers and tables |
| Backend API | FastAPI | Serve parsed documents, handle edits |
| Editor | Tiptap (React) | Structured document editing |
| Frontend | React + Vite | Minimal UI shell |

## Data Models

### 1. Intermediate Section Format (from Parser)

```json
{
  "id": "uuid-123",
  "originalRef": "2a",
  "level": 2,
  "title": "Scope of Services",
  "content": [
    { "type": "paragraph", "text": "The contractor shall provide..." },
    {
      "type": "table",
      "id": "uuid-456",
      "rows": [
        {
          "cells": [
            { "content": [{ "type": "paragraph", "text": "Service" }] },
            { "content": [{ "type": "paragraph", "text": "Description" }] }
          ]
        },
        {
          "cells": [
            { "content": [{ "type": "paragraph", "text": "Consulting" }] },
            { "content": [
              { "type": "paragraph", "text": "Strategic advice including:" },
              { "type": "bulletList", "items": ["Market analysis", "Risk assessment"] }
            ]}
          ]
        }
      ]
    }
  ],
  "children": []
}
```

### 2. Tiptap Document Schema

```json
{
  "type": "doc",
  "content": [
    {
      "type": "section",
      "attrs": {
        "id": "uuid-123",
        "originalRef": "2a",
        "level": 1
      },
      "content": [
        {
          "type": "heading",
          "attrs": { "level": 1 },
          "content": [{ "type": "text", "text": "2a. Scope of Services" }]
        },
        {
          "type": "paragraph",
          "content": [{ "type": "text", "text": "The contractor shall provide..." }]
        },
        {
          "type": "table",
          "attrs": { "id": "uuid-456" },
          "content": [
            {
              "type": "tableRow",
              "content": [
                {
                  "type": "tableCell",
                  "content": [
                    { "type": "paragraph", "content": [{ "type": "text", "text": "Service" }] }
                  ]
                },
                {
                  "type": "tableCell",
                  "content": [
                    { "type": "paragraph", "content": [{ "type": "text", "text": "Description" }] }
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
                    { "type": "paragraph", "content": [{ "type": "text", "text": "Consulting" }] }
                  ]
                },
                {
                  "type": "tableCell",
                  "content": [
                    { "type": "paragraph", "content": [{ "type": "text", "text": "Strategic advice including:" }] },
                    {
                      "type": "bulletList",
                      "content": [
                        { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Market analysis" }] }] },
                        { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Risk assessment" }] }] }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

## Implementation Tasks

### Phase 1: Parser (Python Backend)

**1.1 Project Setup**
- [ ] Initialize Python project with Poetry/uv
- [ ] Install dependencies: `fastapi`, `uvicorn`, `python-docx`, `python-multipart`
- [ ] Create basic FastAPI app structure

**1.2 DOCX Parser**
- [ ] Create `parser/docx_parser.py`
- [ ] Implement section extraction with `python-docx`
- [ ] Handle numbered list detection and numbering resolution
- [ ] **Parse tables with full cell content (paragraphs, lists, nested content)**
- [ ] **Extract text formatting (bold, italic) as marks**
- [ ] Generate UUIDs for each section and table
- [ ] Output intermediate JSON format

**1.3 Table Parser**
- [ ] Create `parser/table_parser.py`
- [ ] Extract table structure (rows, cells)
- [ ] Parse cell content recursively (cells can contain paragraphs, lists, even nested tables)
- [ ] Preserve cell-level formatting and alignment
- [ ] Handle empty cells gracefully

**1.4 Tiptap Converter**
- [ ] Create `parser/tiptap_converter.py`
- [ ] Transform intermediate JSON to Tiptap document schema
- [ ] Handle nested sections (children become nested section nodes)
- [ ] **Convert table structures to Tiptap table nodes**
- [ ] **Map cell content to valid Tiptap cell content (block nodes)**

**1.5 API Endpoints**
- [ ] `POST /upload` - Accept DOCX, return Tiptap JSON
- [ ] `GET /documents/{id}` - Retrieve parsed document
- [ ] `PATCH /documents/{id}` - Apply JSON patch (AI edit simulation)

### Phase 2: Editor (React Frontend)

**2.1 Project Setup**
- [ ] Initialize React project with Vite
- [ ] Install dependencies: `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-unique-id`, `@tiptap/extension-table`

**2.2 Custom Tiptap Extensions**
- [ ] Create `Section` node extension with `originalRef` and `id` attributes
- [ ] **Configure table extensions (Table, TableRow, TableCell, TableHeader)**
- [ ] **Add ID attributes to table nodes for AI targeting**
- [ ] Configure editor to use custom schema

**2.3 Editor Component**
- [ ] Create `DocumentEditor` component
- [ ] Load document JSON from API
- [ ] Display sections with visible reference numbers
- [ ] Basic styling (clean, readable)

**2.4 Upload Flow**
- [ ] File upload component
- [ ] POST to backend, receive Tiptap JSON
- [ ] Initialize editor with document

### Phase 3: Programmatic Manipulation Demo

**3.1 Edit Simulation**
- [ ] Create UI button: "Simulate AI Edit"
- [ ] Implement example transformations:
  - Move section 2a to position after section 3
  - Update content within a section by ID
  - Add a new subsection
  - **Update a table cell's content by table ID and row/column index**
  - **Add a row to a table**
- [ ] Verify `originalRef` is preserved after operations

**3.2 Validation**
- [ ] Display document JSON alongside editor
- [ ] Highlight that section references remain stable

## File Structure

```
dedit/
├── docs/
│   ├── editor.md
│   └── implementation.md
├── backend/
│   ├── pyproject.toml
│   ├── main.py
│   ├── parser/
│   │   ├── __init__.py
│   │   ├── docx_parser.py
│   │   ├── table_parser.py
│   │   └── tiptap_converter.py
│   └── api/
│       ├── __init__.py
│       └── routes.py
└── frontend/
    ├── package.json
    ├── vite.config.ts
    ├── src/
    │   ├── App.tsx
    │   ├── components/
    │   │   ├── DocumentEditor.tsx
    │   │   └── FileUpload.tsx
    │   └── extensions/
    │       ├── Section.ts
    │       └── TableWithId.ts
    └── index.html
```

## Key Technical Decisions

### 1. Numbering Strategy: "Baked" References

The parser will convert dynamic Word numbering into static attributes:

```python
# Word XML might represent this as nested <w:numPr> 
# We resolve it to:
{
    "originalRef": "2a",  # Immutable - from original document
    "displayRef": "2a",   # Could be recalculated for display
}
```

This means:
- Moving "Section 2a" to a new position keeps `originalRef="2a"`
- Cross-references in text ("see Section 2a") remain valid
- Editor can optionally show computed numbering separately

### 2. Section as a First-Class Node

Instead of using generic `<div>` or relying on heading levels, we create a proper `Section` node:

```typescript
// Sections are containers that can hold headings, paragraphs, and nested sections
const Section = Node.create({
  name: 'section',
  group: 'block',
  content: 'heading block*',  // Must start with heading, then any blocks
  defining: true,
  addAttributes() {
    return {
      id: { default: null },
      originalRef: { default: null },
      level: { default: 1 }
    }
  }
})
```

### 3. Table Support

Tables are first-class citizens in the document model:

**Parser behavior:**
- `python-docx` provides direct access to table objects via `document.tables`
- Each cell can contain multiple paragraphs, lists, or even nested tables
- Cell content is parsed recursively using the same logic as body content

**Tiptap representation:**
- Uses `@tiptap/extension-table` with custom ID attributes
- Tables receive UUIDs for AI targeting
- Cell content supports all block-level nodes (paragraphs, lists, etc.)

```typescript
// Table with ID for AI manipulation
const TableWithId = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      id: { default: null }
    }
  }
})
```

**Why this matters for AI editing:**
- AI can reference "the table in section 2a" or "table uuid-456"
- Cell updates target specific row/column coordinates
- Rich cell content (lists, multiple paragraphs) is preserved and editable

### 4. AI Edit Interface

Edits are expressed as operations on the JSON document:

```typescript
interface AIEdit {
  type: 'move' | 'update' | 'insert' | 'delete' | 'tableUpdate';
  targetId: string;        // UUID of section or table
  payload: any;            // Depends on operation type
}

// Example: Move section
{
  type: 'move',
  targetId: 'uuid-123',    // Section with originalRef="2a"
  payload: {
    after: 'uuid-456'      // Move after this section
  }
}

// Example: Update table cell
{
  type: 'tableUpdate',
  targetId: 'uuid-456',    // Table UUID
  payload: {
    row: 1,
    column: 1,
    content: [
      { "type": "paragraph", "content": [{ "type": "text", "text": "Updated description" }] }
    ]
  }
}

// Example: Add table row
{
  type: 'tableUpdate',
  targetId: 'uuid-456',
  payload: {
    action: 'addRow',
    afterRow: 1,
    cells: [
      { content: [{ "type": "paragraph", "content": [{ "type": "text", "text": "New Service" }] }] },
      { content: [{ "type": "paragraph", "content": [{ "type": "text", "text": "New Description" }] }] }
    ]
  }
}
```

## Validation Criteria

The PoC is successful if:

1. **Import**: A DOCX with numbered sections (e.g., 1, 1a, 1b, 2, 2a) is correctly parsed
2. **Preservation**: Each section has a stable `originalRef` attribute matching the source
3. **Display**: Editor shows sections with their reference numbers
4. **Manipulation**: Programmatic moves/edits preserve `originalRef`
5. **Integrity**: After moving "Section 2a" to a new location, it's still identifiable as "2a"
6. **Tables**: Tables are parsed with all cell content intact
7. **Rich Cells**: Table cells containing multiple paragraphs or lists render correctly
8. **Table Edits**: AI can target and modify table cells by ID and coordinates

## Open Questions

1. **Nested sections**: How deep should nesting go? (Recommend: 3-4 levels max for PoC)
2. **Merged cells**: Should merged table cells be supported? (Recommend: defer - out of scope)
3. **Cross-references**: Should we detect and link "see Section 2a" text? (Recommend: defer)
4. **Nested tables**: Should tables inside table cells be supported? (Recommend: defer - rare in practice)

## Next Steps

1. Review and approve this plan
2. Begin Phase 1.1: Python project setup
3. Create a sample DOCX with numbered sections for testing
