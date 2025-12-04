# docx2tiptap Documentation

> Comprehensive guide for the docx2tiptap library
> Version: 0.1.1

## Overview

**docx2tiptap** is a Python library that provides bidirectional conversion between Microsoft Word documents (.docx) and TipTap/ProseMirror JSON format. It enables rich document editing in web applications while preserving the full fidelity of Word document formatting, track changes, comments, and table structures.

### Key Capabilities

- **Parse DOCX to TipTap JSON** - Convert Word documents into editor-ready JSON
- **Export TipTap JSON to DOCX** - Generate Word documents from editor content
- **Lossless Round-Tripping** - Preserve complex styles through an invisible storage mechanism
- **Track Changes** - Full support for insertions and deletions with author/date metadata
- **Comments** - Extract and export document comments with threading support
- **Tables** - Handle merged cells, borders, colors, and nested content

## Installation

```bash
pip install docx2tiptap
```

### Requirements

- Python 3.10+
- python-docx >= 1.1.0
- lxml (installed as dependency of python-docx)

## Quick Start

### Basic Usage

```python
from docx2tiptap import parse_docx, to_tiptap, create_docx_from_tiptap

# Parse a DOCX file to TipTap JSON
with open("document.docx", "rb") as f:
    elements, comments = parse_docx(f.read())
    tiptap_doc = to_tiptap(elements, comments)

# The tiptap_doc is now ready for use in a TipTap editor
print(tiptap_doc)

# Export TipTap JSON back to DOCX
docx_buffer = create_docx_from_tiptap(tiptap_doc)
with open("output.docx", "wb") as f:
    f.write(docx_buffer.read())
```

### Using a Template

Preserve document styles by using the original document as a template:

```python
# Read the original document
with open("original.docx", "rb") as f:
    original_bytes = f.read()
    elements, comments = parse_docx(original_bytes)
    tiptap_doc = to_tiptap(elements, comments)

# ... edit tiptap_doc in your editor ...

# Export using the original as a template (preserves styles)
docx_buffer = create_docx_from_tiptap(
    tiptap_doc,
    template_bytes=original_bytes
)
```

## API Reference

### `parse_docx(file_content: bytes) -> tuple[list, dict]`

Parse a DOCX file into intermediate document elements.

**Parameters:**
- `file_content`: Raw bytes of the DOCX file

**Returns:**
- `elements`: List of `Paragraph`, `Table`, and `Section` objects
- `comments`: Dictionary mapping comment ID to `Comment` objects

### `to_tiptap(elements: list, comments: dict = None) -> dict`

Convert parsed elements to TipTap document JSON.

**Parameters:**
- `elements`: List of parsed document elements
- `comments`: Optional dictionary of comments

**Returns:**
- TipTap document JSON structure:
  ```json
  {
    "type": "doc",
    "content": [...]
  }
  ```

### `create_docx_from_tiptap(tiptap_json: dict, comments: list = None, template_bytes: bytes = None) -> BytesIO`

Convert TipTap JSON back to a Word document.

**Parameters:**
- `tiptap_json`: TipTap document JSON
- `comments`: Optional list of comment dictionaries
- `template_bytes`: Optional bytes of a .docx file to use as template

**Returns:**
- `BytesIO` buffer containing the .docx file

### `elements_to_dict(elements: list) -> list[dict]`

Convert parsed elements to JSON-serializable dictionaries. Useful for debugging or custom processing.

### `comments_to_dict(comments: dict) -> list[dict]`

Convert Comment objects to JSON-serializable dictionaries.

## Document Structure

### Paragraphs

Paragraphs are converted to TipTap paragraph nodes:

```json
{
  "type": "paragraph",
  "content": [
    {
      "type": "text",
      "text": "Hello world",
      "marks": [
        { "type": "bold" },
        { "type": "italic" }
      ]
    }
  ]
}
```

### Headings

Word headings (Heading 1-6) become TipTap heading nodes:

```json
{
  "type": "heading",
  "attrs": { "level": 1 },
  "content": [
    { "type": "text", "text": "Chapter Title" }
  ]
}
```

### Lists

Numbered and bulleted lists are converted with computed numbering:

- Bullet points become `"• Item"`
- Numbered items become `"1. Item"`, `"a. Sub-item"`, etc.
- Multi-level lists are properly computed based on Word's numbering definitions

### Tables

Tables support full cell merging (colspan/rowspan) and styling:

```json
{
  "type": "table",
  "attrs": {
    "id": "uuid-here"
  },
  "content": [
    {
      "type": "tableRow",
      "content": [
        {
          "type": "tableHeader",
          "attrs": { "colspan": 2 },
          "content": [...]
        }
      ]
    },
    {
      "type": "tableRow",
      "content": [
        {
          "type": "tableCell",
          "attrs": { "backgroundColor": "#f0f0f0" },
          "content": [...]
        }
      ]
    }
  ]
}
```

## Track Changes

### How Track Changes Work

Word documents store track changes as OOXML elements:
- `<w:ins>` - Insertions (added text)
- `<w:del>` - Deletions (removed text)

Each revision includes:
- **id**: Unique identifier
- **author**: Who made the change
- **date**: When the change was made

### TipTap Representation

Track changes become marks on text nodes:

```json
{
  "type": "text",
  "text": "new text",
  "marks": [
    {
      "type": "insertion",
      "attrs": {
        "id": "ins-0-1",
        "author": "John Doe",
        "date": "2024-01-15T10:30:00Z"
      }
    }
  ]
}
```

```json
{
  "type": "text",
  "text": "removed text",
  "marks": [
    {
      "type": "deletion",
      "attrs": {
        "id": "del-0-2",
        "author": "Jane Smith",
        "date": "2024-01-15T11:00:00Z"
      }
    }
  ]
}
```

### Exporting Track Changes

When exporting back to DOCX, the library recreates proper OOXML:

```xml
<w:ins w:id="0" w:author="John Doe" w:date="2024-01-15T10:30:00Z">
  <w:r><w:t>new text</w:t></w:r>
</w:ins>

<w:del w:id="1" w:author="Jane Smith" w:date="2024-01-15T11:00:00Z">
  <w:r><w:delText>removed text</w:delText></w:r>
</w:del>
```

## Comments

### Extracting Comments

Comments are extracted from `word/comments.xml`:

```python
elements, comments = parse_docx(docx_bytes)
# comments is a dict: comment_id -> Comment object

for comment_id, comment in comments.items():
    print(f"{comment.author}: {comment.text}")
```

### Comment Structure

```python
@dataclass
class Comment:
    id: str
    author: str
    date: Optional[str]
    text: str
    initials: Optional[str]
    replies: list["Comment"]
```

### TipTap Representation

Comments become marks on text nodes:

```json
{
  "type": "text",
  "text": "commented text",
  "marks": [
    {
      "type": "comment",
      "attrs": {
        "commentId": "0",
        "author": "Reviewer",
        "text": "Please clarify this section"
      }
    }
  ]
}
```

### Exporting Comments

```python
comments_list = [
    {
        "id": "0",
        "author": "Reviewer",
        "text": "Please clarify this section",
        "date": "2024-01-15T10:00:00Z"
    }
]

docx_buffer = create_docx_from_tiptap(tiptap_doc, comments=comments_list)
```

## Lossless Round-Tripping with Raw Styles Storage

### The Challenge

TipTap/ProseMirror schemas only allow known attributes. Complex OOXML styling (cell borders, row heights, table grids) would be stripped when loaded into the editor, causing style loss on export.

### The Solution: Invisible Storage Node

docx2tiptap uses an **invisible storage node** pattern to preserve raw OOXML:

1. **On Import**: Raw XML is extracted from tables, rows, and cells
2. **Storage**: XML is base64-encoded and stored in a hidden node
3. **On Export**: Raw XML is restored to the document structure

### How It Works

#### 1. Extraction (tiptap_converter.py)

When converting to TipTap, raw OOXML properties are:
- Extracted from tables (`tblPr`, `tblGrid`)
- Extracted from rows (`trPr`)
- Extracted from cells (`tcPr`)
- Stored as base64-encoded strings in a key-value dictionary
- Removed from the visible attributes (to prevent TipTap from stripping them)

```python
def _extract_and_store_raw_styles(content: list) -> dict | None:
    """Extract raw OOXML styles into a key-value store."""
    styles = {}
    
    # For each table, row, and cell:
    # styles["table:{id}:tblPr"] = base64_encoded_xml
    # styles["table:{id}:tblGrid"] = base64_encoded_xml
    # styles["table:{id}:row:{idx}"] = base64_encoded_xml
    # styles["table:{id}:row:{idx}:cell:{idx}"] = base64_encoded_xml
    
    return styles
```

The styles dictionary is appended to the document as a hidden node:

```json
{
  "type": "rawStylesStorage",
  "attrs": {
    "data": "{\"table:uuid:tblPr\":\"base64...\", ...}"
  }
}
```

#### 2. Frontend Integration

The TipTap editor needs a corresponding extension to handle this node:

```typescript
// RawStylesStorage.ts
import { Node } from '@tiptap/core'

export const RawStylesStorage = Node.create({
  name: 'rawStylesStorage',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      data: { default: '{}' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-raw-styles-storage]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', {
      'data-raw-styles-storage': '',
      style: 'display: none;',  // Invisible to user
      ...HTMLAttributes
    }]
  },
})
```

**Important**: Register this extension in your TipTap editor:

```typescript
import { RawStylesStorage } from './extensions/RawStylesStorage'

const editor = new Editor({
  extensions: [
    // ... other extensions
    RawStylesStorage,
  ],
})
```

#### 3. Restoration (docx_exporter.py)

When exporting back to DOCX, raw styles are restored:

```python
def _restore_raw_styles(tiptap_json: dict) -> dict:
    """Restore raw OOXML from storage node back into content."""
    # Find rawStylesStorage node
    # Deserialize the key-value data
    # Put rawTblPr, rawTblGrid, rawXml back into table/row/cell attrs
    # Remove the storage node from content
    return modified_doc
```

The exporter then uses these raw XML strings to recreate exact OOXML:

```python
def _restore_raw_table_properties(table, raw_tblPr: str, raw_tblGrid: str):
    """Deserialize base64 XML and insert into document."""
    tbl = table._tbl
    if raw_tblPr:
        new_tblPr = _base64_to_element(raw_tblPr)
        # Replace existing tblPr with original
        tbl.insert(0, new_tblPr)
```

### Key-Value Schema

The storage uses path-based keys:

| Key Pattern | Content |
|-------------|---------|
| `table:{id}:tblPr` | Table properties (borders, alignment, etc.) |
| `table:{id}:tblGrid` | Column grid definitions |
| `table:{id}:row:{idx}` | Row properties (height, header row, etc.) |
| `table:{id}:row:{idx}:cell:{idx}` | Cell properties (borders, shading, width) |

### What Gets Preserved

- Table borders and grid lines
- Cell background colors
- Column widths
- Row heights
- Header row settings
- Cell vertical alignment
- Custom border styles
- Any other OOXML properties

## Integration Guide

### Backend Integration (Python/FastAPI)

```python
from fastapi import FastAPI, UploadFile, Response
from docx2tiptap import parse_docx, to_tiptap, create_docx_from_tiptap

app = FastAPI()

@app.post("/upload")
async def upload_docx(file: UploadFile):
    content = await file.read()
    elements, comments = parse_docx(content)
    tiptap_doc = to_tiptap(elements, comments)
    return {
        "document": tiptap_doc,
        "comments": comments_to_dict(comments)
    }

@app.post("/export")
async def export_docx(data: dict):
    tiptap_json = data["document"]
    comments = data.get("comments", [])
    template = data.get("template")  # Optional base64 template
    
    template_bytes = base64.b64decode(template) if template else None
    
    buffer = create_docx_from_tiptap(
        tiptap_json,
        comments=comments,
        template_bytes=template_bytes
    )
    
    return Response(
        content=buffer.read(),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
```

### Frontend Integration (React/TipTap)

```typescript
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Table from '@tiptap/extension-table'
import { RawStylesStorage } from './extensions/RawStylesStorage'
import { Insertion } from './extensions/Insertion'
import { Deletion } from './extensions/Deletion'
import { Comment } from './extensions/Comment'

function DocumentEditor({ initialContent }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Table.configure({ resizable: true }),
      RawStylesStorage,  // Required for lossless round-tripping
      Insertion,
      Deletion,
      Comment,
    ],
    content: initialContent,
  })

  const handleExport = async () => {
    const json = editor.getJSON()
    const response = await fetch('/export', {
      method: 'POST',
      body: JSON.stringify({ document: json }),
    })
    // Download the file...
  }

  return <EditorContent editor={editor} />
}
```

### Required TipTap Extensions

For full feature support, implement these TipTap extensions:

1. **RawStylesStorage** - Invisible node for style preservation
2. **Insertion** - Mark for tracked insertions
3. **Deletion** - Mark for tracked deletions
4. **Comment** - Mark for comment highlights
5. **Table/TableRow/TableCell** - With extended attributes for merge support

## Architecture

### Module Structure

```
docx2tiptap/
├── __init__.py           # Public API exports
├── docx_parser.py        # DOCX -> Intermediate format
├── tiptap_converter.py   # Intermediate -> TipTap JSON
├── docx_exporter.py      # TipTap JSON -> DOCX
├── comments_parser.py    # Comment extraction
└── revisions_parser.py   # Track changes extraction
```

### Data Flow

```
┌─────────────┐     parse_docx()     ┌──────────────────┐
│  .docx file │ ──────────────────►  │ Intermediate     │
└─────────────┘                      │ (Paragraph,      │
                                     │  Table, etc.)    │
                                     └────────┬─────────┘
                                              │
                                              │ to_tiptap()
                                              ▼
┌─────────────┐   create_docx_from   ┌──────────────────┐
│  .docx file │ ◄────────────────── │  TipTap JSON     │
└─────────────┘     _tiptap()        │  + rawStyles     │
                                     └──────────────────┘
                                              │
                                              │ (sent to frontend)
                                              ▼
                                     ┌──────────────────┐
                                     │  TipTap Editor   │
                                     │  (with storage   │
                                     │   node intact)   │
                                     └──────────────────┘
```

### Intermediate Data Structures

```python
@dataclass
class Paragraph:
    runs: list[TextRun]
    style: Optional[str]
    numbering: Optional[str]
    level: int

@dataclass
class TextRun:
    text: str
    bold: bool
    italic: bool
    revision: Optional[dict]
    comment_ids: list[str]

@dataclass
class Table:
    id: str
    rows: list[TableRow]
    style: Optional[TableStyle]
    raw_tblPr: Optional[str]    # Base64 OOXML
    raw_tblGrid: Optional[str]  # Base64 OOXML

@dataclass
class TableCell:
    content: list
    colspan: int
    rowspan: int
    style: Optional[CellStyle]
    raw_xml: Optional[str]      # Base64 OOXML
```

## Troubleshooting

### Styles Not Preserved

**Problem**: Table styles are lost after round-trip.

**Solution**: Ensure the `RawStylesStorage` extension is registered in TipTap:
```typescript
extensions: [
  // ...
  RawStylesStorage,
]
```

### Track Changes Not Appearing

**Problem**: Insertions/deletions not visible in editor.

**Solution**: Register the Insertion and Deletion mark extensions and add CSS:
```css
.insertion {
  color: green;
  text-decoration: underline;
}
.deletion {
  color: red;
  text-decoration: line-through;
}
```

### Tables Missing Merged Cells

**Problem**: Merged cells appear as separate cells.

**Solution**: Configure TipTap tables with merge support:
```typescript
Table.configure({
  resizable: true,
  allowTableNodeSelection: true,
})
```

### Comments Not Linked to Text

**Problem**: Comments exist but aren't associated with text ranges.

**Solution**: Ensure comment marks are applied to text nodes and the Comment extension handles `commentId` attribute.

## License

AGPL-3.0-or-later

## Contributing

Contributions are welcome! Please see the repository for contribution guidelines.

Repository: https://github.com/jvsteiner/dedit-react-editor
