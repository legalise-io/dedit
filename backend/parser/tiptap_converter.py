"""
Tiptap Converter - Transforms parsed DOCX elements into Tiptap JSON schema.

The Tiptap schema follows ProseMirror conventions:
- Documents contain an array of nodes
- Each node has a type, optional attrs, and optional content
- Text nodes have marks for formatting (bold, italic, etc.)
"""

import uuid
from typing import Optional

from .docx_parser import Paragraph, Section, Table, TextRun, elements_to_dict


def text_run_to_tiptap(run: TextRun) -> dict:
    """Convert a TextRun to a Tiptap text node with marks."""
    node = {"type": "text", "text": run.text}

    marks = []
    if run.bold:
        marks.append({"type": "bold"})
    if run.italic:
        marks.append({"type": "italic"})

    if marks:
        node["marks"] = marks

    return node


def paragraph_to_tiptap(para: Paragraph) -> dict:
    """Convert a Paragraph to a Tiptap paragraph or heading node."""
    content = [text_run_to_tiptap(run) for run in para.runs if run.text]

    # Handle numbered items - prepend the number to the content
    if para.numbering and content:
        # Insert numbering as plain text at the start
        numbering_text = {"type": "text", "text": f"{para.numbering} "}
        content.insert(0, numbering_text)

    # Determine if this is a heading
    if para.level > 0:
        return {
            "type": "heading",
            "attrs": {"level": min(para.level, 6)},  # Tiptap supports h1-h6
            "content": content,  # Empty content array is valid, empty text nodes are not
        }

    return {
        "type": "paragraph",
        "content": content,  # Empty content array is valid, empty text nodes are not
    }


def table_to_tiptap(table: Table) -> dict:
    """Convert a Table to Tiptap table nodes."""
    rows = []

    for row_idx, row in enumerate(table.rows):
        cells = []
        for cell in row.cells:
            # Convert cell content
            cell_content = []
            for elem in cell.content:
                if isinstance(elem, Paragraph):
                    cell_content.append(paragraph_to_tiptap(elem))
                elif isinstance(elem, Table):
                    # Nested tables - Tiptap tables don't typically nest,
                    # so we flatten to paragraphs with indication
                    cell_content.append(
                        {
                            "type": "paragraph",
                            "content": [
                                {
                                    "type": "text",
                                    "text": "[Nested table content]",
                                }
                            ],
                        }
                    )
                elif isinstance(elem, dict):
                    # Already converted dict format
                    cell_content.append(convert_dict_element(elem))

            # Ensure cell has content
            if not cell_content:
                cell_content = [{"type": "paragraph"}]

            # First row uses tableHeader, rest use tableCell
            cell_type = "tableHeader" if row_idx == 0 else "tableCell"
            cells.append({"type": cell_type, "content": cell_content})

        rows.append({"type": "tableRow", "content": cells})

    return {"type": "table", "attrs": {"id": table.id}, "content": rows}


def convert_dict_element(elem: dict) -> dict:
    """Convert a dictionary element (from elements_to_dict) to Tiptap format."""
    if elem["type"] == "paragraph":
        content = []
        for run in elem.get("runs", []):
            if run["text"]:
                node = {"type": "text", "text": run["text"]}
                marks = []
                if run.get("bold"):
                    marks.append({"type": "bold"})
                if run.get("italic"):
                    marks.append({"type": "italic"})
                if marks:
                    node["marks"] = marks
                content.append(node)

        # Handle numbering
        if elem.get("numbering") and content:
            numbering_text = {"type": "text", "text": f"{elem['numbering']} "}
            content.insert(0, numbering_text)

        # Handle headings
        if elem.get("level", 0) > 0:
            return {
                "type": "heading",
                "attrs": {"level": min(elem["level"], 6)},
                "content": content,
            }

        return {
            "type": "paragraph",
            "content": content,
        }

    elif elem["type"] == "table":
        rows = []
        for row_idx, row in enumerate(elem.get("rows", [])):
            cells = []
            for cell in row.get("cells", []):
                cell_content = [
                    convert_dict_element(c) for c in cell.get("content", [])
                ]
                if not cell_content:
                    cell_content = [{"type": "paragraph"}]

                cell_type = "tableHeader" if row_idx == 0 else "tableCell"
                cells.append({"type": cell_type, "content": cell_content})

            rows.append({"type": "tableRow", "content": cells})

        return {
            "type": "table",
            "attrs": {"id": elem.get("id", str(uuid.uuid4()))},
            "content": rows,
        }

    elif elem["type"] == "section":
        # Sections become a wrapper with heading + content
        content = []

        # Add section heading if there's a title
        if elem.get("title"):
            content.append(
                {
                    "type": "heading",
                    "attrs": {"level": elem.get("level", 1)},
                    "content": [{"type": "text", "text": elem["title"]}],
                }
            )

        # Add section content
        for item in elem.get("content", []):
            content.append(convert_dict_element(item))

        # Add children (nested sections)
        for child in elem.get("children", []):
            content.append(convert_dict_element(child))

        return {
            "type": "section",
            "attrs": {
                "id": elem.get("id", str(uuid.uuid4())),
                "originalRef": elem.get("originalRef"),
                "level": elem.get("level", 1),
            },
            "content": content if content else [{"type": "paragraph"}],
        }

    return {"type": "paragraph"}


def to_tiptap(elements: list) -> dict:
    """
    Convert a list of parsed document elements to a Tiptap document.

    Args:
        elements: List of Paragraph, Table, Section objects or dicts

    Returns:
        Tiptap document JSON structure
    """
    content = []

    for elem in elements:
        if isinstance(elem, Paragraph):
            content.append(paragraph_to_tiptap(elem))
        elif isinstance(elem, Table):
            content.append(table_to_tiptap(elem))
        elif isinstance(elem, Section):
            # Convert Section to dict first, then to Tiptap
            section_dict = elements_to_dict([elem])[0]
            content.append(convert_dict_element(section_dict))
        elif isinstance(elem, dict):
            content.append(convert_dict_element(elem))

    # Ensure document has content
    if not content:
        content = [{"type": "paragraph"}]

    return {"type": "doc", "content": content}
