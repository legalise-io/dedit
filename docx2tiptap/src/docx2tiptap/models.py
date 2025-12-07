"""
Data models for docx2tiptap.

Contains all dataclasses used to represent document structure
during parsing and conversion.
"""

import uuid
from dataclasses import dataclass, field
from typing import Literal, Optional, TypedDict


# =============================================================================
# TypedDicts for TipTap JSON structures
# =============================================================================


class RevisionInfo(TypedDict, total=False):
    """Revision (track change) information for a text run."""

    type: Literal["insertion", "deletion"]
    id: str
    author: str
    date: Optional[str]


class MarkAttrs(TypedDict, total=False):
    """Attributes for a TipTap mark."""

    id: str
    author: str
    date: Optional[str]
    commentId: str
    text: str


class MarkDict(TypedDict, total=False):
    """A TipTap mark (formatting or annotation)."""

    type: str
    attrs: MarkAttrs


class TipTapTextNode(TypedDict, total=False):
    """A TipTap text node."""

    type: Literal["text"]
    text: str
    marks: list[MarkDict]


class TipTapNodeAttrs(TypedDict, total=False):
    """Common attributes for TipTap nodes."""

    id: str
    level: int
    colspan: int
    rowspan: int
    colwidth: list[int]
    backgroundColor: str
    verticalAlign: str
    textAlign: str
    alignment: str
    styleName: str
    rawTblPr: str
    rawTblGrid: str
    rawXml: str


class TipTapNode(TypedDict, total=False):
    """A generic TipTap node."""

    type: str
    attrs: TipTapNodeAttrs
    content: list["TipTapNode"]
    text: str
    marks: list[MarkDict]


# =============================================================================
# Dataclasses for parsed DOCX structure
# =============================================================================


@dataclass
class TextRun:
    """A run of text with formatting and revision/comment info."""

    text: str
    bold: bool = False
    italic: bool = False
    revision: Optional[RevisionInfo] = None
    comment_ids: list[str] = field(default_factory=list)


@dataclass
class Paragraph:
    """A paragraph containing text runs."""

    runs: list[TextRun] = field(default_factory=list)
    style: Optional[str] = None
    numbering: Optional[str] = None  # Computed numbering like "2a"
    level: int = 0  # Heading level (0 = not a heading)


@dataclass
class BorderStyle:
    """Border styling for a single edge."""

    style: Optional[str] = None  # single, double, dashed, dotted, nil, etc.
    width: Optional[int] = None  # Width in eighths of a point
    color: Optional[str] = None  # Hex color (e.g., "000000")


@dataclass
class CellBorders:
    """Border styles for all edges of a cell."""

    top: Optional[BorderStyle] = None
    bottom: Optional[BorderStyle] = None
    left: Optional[BorderStyle] = None
    right: Optional[BorderStyle] = None


@dataclass
class CellStyle:
    """Styling properties for a table cell."""

    width: Optional[int] = None  # Width in twips (1/1440 inch)
    background_color: Optional[str] = None  # Hex color (e.g., "f0f0f0")
    vertical_align: Optional[str] = None  # top, center, bottom
    borders: Optional[CellBorders] = None
    text_align: Optional[str] = None  # left, center, right, both (justify)


@dataclass
class TableStyle:
    """Styling properties for a table."""

    style_name: Optional[str] = None  # Named style (e.g., "Table Grid")
    alignment: Optional[str] = None  # left, center, right
    column_widths: list[int] = field(default_factory=list)  # Widths in twips


@dataclass
class TableCell:
    """A table cell containing block content."""

    content: list = field(
        default_factory=list
    )  # List of Paragraph or nested Table
    colspan: int = 1  # Number of columns this cell spans
    rowspan: int = 1  # Number of rows this cell spans
    style: Optional[CellStyle] = None
    # Raw OOXML for cell properties (tcPr) - preserves all styling
    raw_xml: Optional[str] = None


@dataclass
class TableRow:
    """A table row containing cells."""

    cells: list[TableCell] = field(default_factory=list)
    # Raw OOXML for row properties (trPr) - preserves row height, header row, etc.
    raw_xml: Optional[str] = None


@dataclass
class Table:
    """A table with rows and cells."""

    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    rows: list[TableRow] = field(default_factory=list)
    style: Optional[TableStyle] = None
    # Raw OOXML for table properties (tblPr) and grid (tblGrid)
    raw_tblPr: Optional[str] = None
    raw_tblGrid: Optional[str] = None


@dataclass
class Section:
    """A document section with content and optional children."""

    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    original_ref: Optional[str] = None
    level: int = 1
    title: str = ""
    content: list = field(default_factory=list)  # Paragraph, Table
    children: list["Section"] = field(default_factory=list)


@dataclass
class Comment:
    """A document comment."""

    id: str
    author: str
    date: Optional[str]
    text: str
    initials: Optional[str] = None
    replies: list["Comment"] = field(default_factory=list)
    # Range information (to be filled in when processing document)
    range_start_para: Optional[int] = None
    range_start_offset: Optional[int] = None
    range_end_para: Optional[int] = None
    range_end_offset: Optional[int] = None
