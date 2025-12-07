"""
Tiptap Converter - Transforms parsed DOCX elements into Tiptap JSON schema.

The Tiptap schema follows ProseMirror conventions:
- Documents contain an array of nodes
- Each node has a type, optional attrs, and optional content
- Text nodes have marks for formatting (bold, italic, etc.)
"""

import json
import uuid
from typing import Optional

from .models import Comment, Paragraph, Section, Table, TextRun


class TipTapConverter:
    """
    Converts parsed DOCX elements to TipTap JSON format.

    This class encapsulates the conversion logic and maintains state
    (like comments lookup) as instance variables for thread safety.
    """

    def __init__(
        self,
        comments: Optional[dict[str, Comment]] = None,
        style_numbering_map: Optional[dict] = None,
    ):
        """
        Initialize the converter.

        Args:
            comments: Optional dict mapping comment ID to Comment objects
            style_numbering_map: Optional dict with style-to-numbering mappings
        """
        self._comments = comments or {}
        self._style_numbering_map = style_numbering_map or {}

    def convert(self, elements: list) -> dict:
        """
        Convert a list of parsed document elements to a TipTap document.

        Args:
            elements: List of Paragraph, Table, or Section objects

        Returns:
            TipTap document JSON structure
        """
        content = []

        for elem in elements:
            if isinstance(elem, Paragraph):
                content.append(self._paragraph_to_node(elem))
            elif isinstance(elem, Table):
                content.append(self._table_to_node(elem))
            elif isinstance(elem, Section):
                content.append(self._section_to_node(elem))

        # Ensure document has content
        if not content:
            content = [{"type": "paragraph"}]

        # Extract raw styles and store in invisible node
        raw_styles = self._extract_and_store_raw_styles(content)

        # Also store the style-numbering map for export
        if self._style_numbering_map:
            raw_styles["__style_numbering_map__"] = self._style_numbering_map

        if raw_styles:
            content.append(
                {
                    "type": "rawStylesStorage",
                    "attrs": {"data": json.dumps(raw_styles)},
                }
            )

        return {"type": "doc", "content": content}

    def _text_run_to_node(self, run: TextRun) -> dict | None:
        """Convert a TextRun to a TipTap text node with marks, or a hardBreak node."""
        # Handle break runs
        if run.is_break:
            if run.break_type == "page":
                return {"type": "hardBreak", "attrs": {"breakType": "page"}}
            elif run.break_type == "column":
                return {"type": "hardBreak", "attrs": {"breakType": "column"}}
            else:
                # Regular line break or text wrapping
                return {"type": "hardBreak"}

        # Skip empty text runs
        if not run.text:
            return None

        node = {"type": "text", "text": run.text}

        marks = self._build_marks(run)
        if marks:
            node["marks"] = marks

        return node

    def _build_marks(self, run: TextRun) -> list[dict]:
        """
        Build TipTap marks array from a TextRun's formatting and annotations.

        This is the single source of truth for mark building, eliminating
        the duplication that existed between text_run_to_tiptap and
        convert_dict_element.
        """
        marks = []

        # Basic formatting marks (visible in editor)
        if run.bold:
            marks.append({"type": "bold"})
        if run.italic:
            marks.append({"type": "italic"})

        # Raw style mark (invisible - preserves full w:rPr for round-tripping)
        # This carries fonts, colors, and other formatting that TipTap won't display
        if run.raw_rPr:
            marks.append({"type": "rawStyle", "attrs": {"rPr": run.raw_rPr}})

        # Revision marks (track changes)
        if run.revision:
            rev = run.revision
            rev_type = rev.get("type")
            if rev_type in ("insertion", "deletion"):
                marks.append(
                    {
                        "type": rev_type,
                        "attrs": {
                            "id": rev.get("id"),
                            "author": rev.get("author"),
                            "date": rev.get("date"),
                        },
                    }
                )

        # Comment marks
        for comment_id in run.comment_ids:
            comment_attrs = {"commentId": comment_id}
            # Look up comment details if available
            if comment_id in self._comments:
                comment = self._comments[comment_id]
                if hasattr(comment, "author"):
                    comment_attrs["author"] = comment.author
                if hasattr(comment, "date"):
                    comment_attrs["date"] = comment.date
                if hasattr(comment, "text"):
                    comment_attrs["text"] = comment.text
            marks.append({"type": "comment", "attrs": comment_attrs})

        return marks

    def _paragraph_to_node(self, para: Paragraph) -> dict:
        """Convert a Paragraph to a TipTap paragraph or heading node."""
        content = [
            node for run in para.runs
            for node in [self._text_run_to_node(run)]
            if node is not None
        ]

        # Build base attributes
        attrs = {}
        if para.style:
            attrs["styleName"] = para.style
        if para.raw_pPr:
            attrs["rawPPr"] = para.raw_pPr

        # Handle numbered items - store numbering info in attrs (not as text)
        # TipTap will display via CSS ::before, Word regenerates from style
        if para.numbering:
            attrs["styleNumbering"] = para.numbering  # e.g., "2.3" or "1.1.1(a)"
            attrs["numId"] = para.num_id  # Word numId reference
            attrs["numIlvl"] = para.num_ilvl  # Indentation level (0-8)

        # Determine if this is a heading
        if para.level > 0:
            attrs["level"] = min(para.level, 6)  # TipTap supports h1-h6
            return {
                "type": "heading",
                "attrs": attrs,
                "content": content,
            }

        # Regular paragraph
        node = {"type": "paragraph", "content": content}
        if attrs:
            node["attrs"] = attrs
        return node

    def _table_to_node(self, table: Table) -> dict:
        """Convert a Table to TipTap table nodes."""
        rows = []

        for row_idx, row in enumerate(table.rows):
            cells = []
            for cell in row.cells:
                cell_content = self._convert_cell_content(cell.content)

                # Ensure cell has content
                if not cell_content:
                    cell_content = [{"type": "paragraph"}]

                # First row uses tableHeader, rest use tableCell
                cell_type = "tableHeader" if row_idx == 0 else "tableCell"
                cell_node = {"type": cell_type, "content": cell_content}

                # Build cell attributes
                attrs = {}
                if cell.colspan > 1:
                    attrs["colspan"] = cell.colspan
                if cell.rowspan > 1:
                    attrs["rowspan"] = cell.rowspan

                # Add style attributes
                if cell.style:
                    style_attrs = self._cell_style_to_attrs(cell.style)
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

    def _convert_cell_content(self, content: list) -> list[dict]:
        """Convert cell content (list of Paragraph/Table) to TipTap nodes."""
        result = []
        for elem in content:
            if isinstance(elem, Paragraph):
                result.append(self._paragraph_to_node(elem))
            elif isinstance(elem, Table):
                # Nested tables - TipTap tables don't typically nest,
                # so we flatten to paragraphs with indication
                result.append(
                    {
                        "type": "paragraph",
                        "content": [
                            {"type": "text", "text": "[Nested table content]"}
                        ],
                    }
                )
        return result

    def _section_to_node(self, section: Section) -> dict:
        """
        Convert a Section to a TipTap section node.

        This converts directly from the Section dataclass without
        going through dict conversion first.
        """
        content = []

        # Add section heading if there's a title
        if section.title:
            content.append(
                {
                    "type": "heading",
                    "attrs": {"level": section.level},
                    "content": [{"type": "text", "text": section.title}],
                }
            )

        # Add section content
        for elem in section.content:
            if isinstance(elem, Paragraph):
                content.append(self._paragraph_to_node(elem))
            elif isinstance(elem, Table):
                content.append(self._table_to_node(elem))

        # Add children (nested sections)
        for child in section.children:
            content.append(self._section_to_node(child))

        return {
            "type": "section",
            "attrs": {
                "id": section.id,
                "originalRef": section.original_ref,
                "level": section.level,
            },
            "content": content if content else [{"type": "paragraph"}],
        }

    def _cell_style_to_attrs(self, style) -> dict:
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
            for side in ("top", "bottom", "left", "right"):
                border = getattr(style.borders, side, None)
                if border:
                    borders[side] = {
                        "style": border.style,
                        "width": border.width,
                        "color": border.color,
                    }
            if borders:
                attrs["borders"] = borders

        return attrs

    def _extract_and_store_raw_styles(self, content: list) -> dict | None:
        """
        Extract raw OOXML styles from content into a key-value store.

        Removes rawTblPr, rawTblGrid, rawXml, rawPPr, and colwidth from nodes
        (TipTap strips unknown attrs, colwidth in twips breaks layout).

        Returns a dict to be stored in an invisible node, or None if empty.
        """
        styles = {}
        para_counter = [0]  # Use list for mutable counter in nested function

        def process_node(node: dict):
            node_type = node.get("type")

            # Handle paragraph/heading rawPPr (numbering overrides, etc.)
            if node_type in ("paragraph", "heading"):
                attrs = node.get("attrs", {})
                if "rawPPr" in attrs:
                    styles[f"para:{para_counter[0]}:pPr"] = attrs.pop("rawPPr")
                para_counter[0] += 1

            if node_type == "table":
                attrs = node.get("attrs", {})
                table_id = attrs.get("id")
                if table_id:
                    # Extract table-level raw XML
                    if "rawTblPr" in attrs:
                        styles[f"table:{table_id}:tblPr"] = attrs.pop("rawTblPr")
                    if "rawTblGrid" in attrs:
                        styles[f"table:{table_id}:tblGrid"] = attrs.pop("rawTblGrid")

                    # Process rows and cells
                    for row_idx, row in enumerate(node.get("content", [])):
                        row_attrs = row.get("attrs", {})
                        if "rawXml" in row_attrs:
                            styles[f"table:{table_id}:row:{row_idx}"] = row_attrs.pop(
                                "rawXml"
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


def to_tiptap(
    elements: list, comments: dict = None, style_numbering_map: dict = None
) -> dict:
    """
    Convert a list of parsed document elements to a TipTap document.

    This is the public API function that maintains backward compatibility.
    It delegates to TipTapConverter internally.

    Args:
        elements: List of Paragraph, Table, Section objects
        comments: Optional dict mapping comment ID to Comment objects
        style_numbering_map: Optional dict with style-to-numbering mappings

    Returns:
        TipTap document JSON structure
    """
    converter = TipTapConverter(
        comments=comments, style_numbering_map=style_numbering_map
    )
    return converter.convert(elements)
