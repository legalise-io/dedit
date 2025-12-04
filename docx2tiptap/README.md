# docx2tiptap

Parse DOCX files and convert to TipTap/ProseMirror JSON format.

## Installation

```bash
pip install docx2tiptap
```

## Usage

```python
from docx2tiptap import parse_docx, to_tiptap, create_docx_from_tiptap

# Parse DOCX to TipTap JSON
with open("document.docx", "rb") as f:
    elements, comments = parse_docx(f.read())
    tiptap_doc = to_tiptap(elements, comments)

# Export TipTap JSON back to DOCX
docx_buffer = create_docx_from_tiptap(tiptap_doc)
with open("output.docx", "wb") as f:
    f.write(docx_buffer.read())
```

## Features

- Parse DOCX paragraphs, headings, and tables
- Handle merged cells (colspan/rowspan)
- Preserve track changes (insertions/deletions)
- Extract and export comments
- Convert to/from TipTap JSON format

## License

AGPL-3.0-or-later
