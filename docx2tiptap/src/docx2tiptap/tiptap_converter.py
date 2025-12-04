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

# Module-level comments dict for lookup during conversion
_comments_lookup: dict = {}


def text_run_to_tiptap(run: TextRun) -> dict:
    """Convert a TextRun to a Tiptap text node with marks."""
    node = {"type": "text", "text": run.text}

    marks = []
    if run.bold:
        marks.append({"type": "bold"})
    if run.italic:
        marks.append({"type": "italic"})

    # Add revision marks (track changes)
    if run.revision:
        rev = run.revision
        if rev.get("type") == "insertion":
            marks.append(
                {
                    "type": "insertion",
                    "attrs": {
                        "id": rev.get("id"),
                        "author": rev.get("author"),
                        "date": rev.get("date"),
                    },
                }
            )
        elif rev.get("type") == "deletion":
            marks.append(
                {
                    "type": "deletion",
                    "attrs": {
                        "id": rev.get("id"),
                        "author": rev.get("author"),
                        "date": rev.get("date"),
                    },
                }
            )

    # Add comment marks
    if run.comment_ids:
        for comment_id in run.comment_ids:
            comment_attrs = {"commentId": comment_id}
            # Look up comment details if available
            if comment_id in _comments_lookup:
                comment = _comments_lookup[comment_id]
                if hasattr(comment, "author"):
                    comment_attrs["author"] = comment.author
                if hasattr(comment, "date"):
                    comment_attrs["date"] = comment.date
                if hasattr(comment, "text"):
                    comment_attrs["text"] = comment.text
            marks.append({"type": "comment", "attrs": comment_attrs})

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


def _cell_style_to_tiptap_attrs(style) -> dict:
    """Convert CellStyle to TipTap cell attributes."""
    attrs = {}
    if style is None:
        return attrs

    if style.width is not None:
        attrs["colwidth"] = [style.width]  # TipTap uses colwidth array
    if style.background_color:
        attrs["backgroundColor"] = f"#{style.background_color}"
    if style.vertical_align:
        attrs["verticalAlign"] = style.vertical_align
    if style.text_align:
        attrs["textAlign"] = style.text_align
    if style.borders:
        borders = {}
        if style.borders.top:
            borders["top"] = {
                "style": style.borders.top.style,
                "width": style.borders.top.width,
                "color": style.borders.top.color,
            }
        if style.borders.bottom:
            borders["bottom"] = {
                "style": style.borders.bottom.style,
                "width": style.borders.bottom.width,
                "color": style.borders.bottom.color,
            }
        if style.borders.left:
            borders["left"] = {
                "style": style.borders.left.style,
                "width": style.borders.left.width,
                "color": style.borders.left.color,
            }
        if style.borders.right:
            borders["right"] = {
                "style": style.borders.right.style,
                "width": style.borders.right.width,
                "color": style.borders.right.color,
            }
        if borders:
            attrs["borders"] = borders

    return attrs


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

            # Build cell with merge attributes
            cell_node = {"type": cell_type, "content": cell_content}

            # Add colspan/rowspan attrs if they differ from default (1)
            attrs = {}
            if cell.colspan > 1:
                attrs["colspan"] = cell.colspan
            if cell.rowspan > 1:
                attrs["rowspan"] = cell.rowspan

            # Add style attributes
            if cell.style:
                style_attrs = _cell_style_to_tiptap_attrs(cell.style)
                attrs.update(style_attrs)

            # Add raw XML for lossless round-tripping
            if cell.raw_xml:
                attrs["rawXml"] = cell.raw_xml

            if attrs:
                cell_node["attrs"] = attrs

            cells.append(cell_node)

        # Build row with optional raw XML
        row_node = {"type": "tableRow", "content": cells}
        if row.raw_xml:
            row_node["attrs"] = {"rawXml": row.raw_xml}
        rows.append(row_node)

    # Build table attributes
    table_attrs = {"id": table.id}
    if table.style:
        if table.style.column_widths:
            table_attrs["colwidths"] = table.style.column_widths
        if table.style.alignment:
            table_attrs["alignment"] = table.style.alignment
        if table.style.style_name:
            table_attrs["styleName"] = table.style.style_name

    # Add raw table XML for lossless round-tripping
    if table.raw_tblPr:
        table_attrs["rawTblPr"] = table.raw_tblPr
    if table.raw_tblGrid:
        table_attrs["rawTblGrid"] = table.raw_tblGrid

    return {"type": "table", "attrs": table_attrs, "content": rows}


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

                # Handle revision marks
                if run.get("revision"):
                    rev = run["revision"]
                    if rev.get("type") == "insertion":
                        marks.append(
                            {
                                "type": "insertion",
                                "attrs": {
                                    "id": rev.get("id"),
                                    "author": rev.get("author"),
                                    "date": rev.get("date"),
                                },
                            }
                        )
                    elif rev.get("type") == "deletion":
                        marks.append(
                            {
                                "type": "deletion",
                                "attrs": {
                                    "id": rev.get("id"),
                                    "author": rev.get("author"),
                                    "date": rev.get("date"),
                                },
                            }
                        )

                # Handle comment marks
                if run.get("commentIds"):
                    for comment_id in run["commentIds"]:
                        comment_attrs = {"commentId": comment_id}
                        # Look up comment details if available
                        if comment_id in _comments_lookup:
                            comment = _comments_lookup[comment_id]
                            if hasattr(comment, "author"):
                                comment_attrs["author"] = comment.author
                            if hasattr(comment, "date"):
                                comment_attrs["date"] = comment.date
                            if hasattr(comment, "text"):
                                comment_attrs["text"] = comment.text
                        marks.append(
                            {
                                "type": "comment",
                                "attrs": comment_attrs,
                            }
                        )

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

                # Build cell with merge attributes
                cell_node = {"type": cell_type, "content": cell_content}

                # Add colspan/rowspan attrs if present and > 1
                attrs = {}
                if cell.get("colspan", 1) > 1:
                    attrs["colspan"] = cell["colspan"]
                if cell.get("rowspan", 1) > 1:
                    attrs["rowspan"] = cell["rowspan"]

                # Add cell style attributes
                cell_style = cell.get("style")
                if cell_style:
                    if cell_style.get("width") is not None:
                        attrs["colwidth"] = [cell_style["width"]]
                    if cell_style.get("backgroundColor"):
                        attrs["backgroundColor"] = (
                            f"#{cell_style['backgroundColor']}"
                        )
                    if cell_style.get("verticalAlign"):
                        attrs["verticalAlign"] = cell_style["verticalAlign"]
                    if cell_style.get("textAlign"):
                        attrs["textAlign"] = cell_style["textAlign"]
                    if cell_style.get("borders"):
                        attrs["borders"] = cell_style["borders"]

                # Add raw XML for lossless round-tripping
                if cell.get("rawXml"):
                    attrs["rawXml"] = cell["rawXml"]

                if attrs:
                    cell_node["attrs"] = attrs

                cells.append(cell_node)

            # Build row with optional raw XML
            row_node = {"type": "tableRow", "content": cells}
            if row.get("rawXml"):
                row_node["attrs"] = {"rawXml": row["rawXml"]}
            rows.append(row_node)

        # Build table attributes
        table_attrs = {"id": elem.get("id", str(uuid.uuid4()))}
        table_style = elem.get("style")
        if table_style:
            if table_style.get("columnWidths"):
                table_attrs["colwidths"] = table_style["columnWidths"]
            if table_style.get("alignment"):
                table_attrs["alignment"] = table_style["alignment"]
            if table_style.get("styleName"):
                table_attrs["styleName"] = table_style["styleName"]

        # Add raw table XML for lossless round-tripping
        if elem.get("rawTblPr"):
            table_attrs["rawTblPr"] = elem["rawTblPr"]
        if elem.get("rawTblGrid"):
            table_attrs["rawTblGrid"] = elem["rawTblGrid"]

        return {
            "type": "table",
            "attrs": table_attrs,
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


def _extract_and_store_raw_styles(content: list) -> dict | None:
    """
    Extract raw OOXML styles from content into a key-value store.

    Removes rawTblPr, rawTblGrid, rawXml, and colwidth from nodes
    (TipTap strips unknown attrs, colwidth in twips breaks layout).

    Returns a dict to be stored in an invisible node, or None if empty.
    """
    styles = {}

    def process_node(node: dict):
        if node.get("type") == "table":
            attrs = node.get("attrs", {})
            table_id = attrs.get("id")
            if table_id:
                # Extract table-level raw XML
                if "rawTblPr" in attrs:
                    styles[f"table:{table_id}:tblPr"] = attrs.pop("rawTblPr")
                if "rawTblGrid" in attrs:
                    styles[f"table:{table_id}:tblGrid"] = attrs.pop(
                        "rawTblGrid"
                    )

                # Process rows and cells
                for row_idx, row in enumerate(node.get("content", [])):
                    row_attrs = row.get("attrs", {})
                    if "rawXml" in row_attrs:
                        styles[f"table:{table_id}:row:{row_idx}"] = (
                            row_attrs.pop("rawXml")
                        )

                    for cell_idx, cell in enumerate(row.get("content", [])):
                        cell_attrs = cell.get("attrs", {})
                        if "rawXml" in cell_attrs:
                            styles[
                                f"table:{table_id}:row:{row_idx}:cell:{cell_idx}"
                            ] = cell_attrs.pop("rawXml")
                        # Remove colwidth (twips interpreted as pixels)
                        cell_attrs.pop("colwidth", None)

        for child in node.get("content", []):
            if isinstance(child, dict):
                process_node(child)

    for node in content:
        process_node(node)

    return styles if styles else None


def to_tiptap(elements: list, comments: dict = None) -> dict:
    """
    Convert a list of parsed document elements to a Tiptap document.

    Args:
        elements: List of Paragraph, Table, Section objects or dicts
        comments: Optional dict mapping comment ID to Comment objects

    Returns:
        Tiptap document JSON structure
    """
    import json

    global _comments_lookup
    _comments_lookup = comments or {}

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

    # Extract raw styles and store in invisible node
    raw_styles = _extract_and_store_raw_styles(content)
    if raw_styles:
        content.append(
            {
                "type": "rawStylesStorage",
                "attrs": {"data": json.dumps(raw_styles)},
            }
        )

    return {"type": "doc", "content": content}
