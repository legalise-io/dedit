"""
Serializers - Convert dataclasses to JSON-serializable dictionaries.

This module contains functions to convert parsed document elements
(Paragraph, Table, Section) to dictionaries for JSON serialization.
"""

from typing import Optional

from .models import (
    BorderStyle,
    CellBorders,
    CellStyle,
    Paragraph,
    Section,
    Table,
    TableStyle,
)


def _border_style_to_dict(border: Optional[BorderStyle]) -> Optional[dict]:
    """Convert BorderStyle to dict."""
    if border is None:
        return None
    return {
        "style": border.style,
        "width": border.width,
        "color": border.color,
    }


def _cell_borders_to_dict(borders: Optional[CellBorders]) -> Optional[dict]:
    """Convert CellBorders to dict."""
    if borders is None:
        return None
    result = {}
    if borders.top:
        result["top"] = _border_style_to_dict(borders.top)
    if borders.bottom:
        result["bottom"] = _border_style_to_dict(borders.bottom)
    if borders.left:
        result["left"] = _border_style_to_dict(borders.left)
    if borders.right:
        result["right"] = _border_style_to_dict(borders.right)
    return result if result else None


def _cell_style_to_dict(style: Optional[CellStyle]) -> Optional[dict]:
    """Convert CellStyle to dict."""
    if style is None:
        return None
    result = {}
    if style.width is not None:
        result["width"] = style.width
    if style.background_color:
        result["backgroundColor"] = style.background_color
    if style.vertical_align:
        result["verticalAlign"] = style.vertical_align
    if style.borders:
        borders = _cell_borders_to_dict(style.borders)
        if borders:
            result["borders"] = borders
    if style.text_align:
        result["textAlign"] = style.text_align
    return result if result else None


def _table_style_to_dict(style: Optional[TableStyle]) -> Optional[dict]:
    """Convert TableStyle to dict."""
    if style is None:
        return None
    result = {}
    if style.style_name:
        result["styleName"] = style.style_name
    if style.alignment:
        result["alignment"] = style.alignment
    if style.column_widths:
        result["columnWidths"] = style.column_widths
    return result if result else None


def elements_to_dict(elements: list) -> list[dict]:
    """Convert parsed elements to JSON-serializable dictionaries."""
    result = []

    for elem in elements:
        if isinstance(elem, Paragraph):
            runs_data = []
            for r in elem.runs:
                run_dict = {"text": r.text, "bold": r.bold, "italic": r.italic}
                if r.revision:
                    run_dict["revision"] = r.revision
                if r.comment_ids:
                    run_dict["commentIds"] = r.comment_ids
                runs_data.append(run_dict)

            result.append(
                {
                    "type": "paragraph",
                    "runs": runs_data,
                    "style": elem.style,
                    "numbering": elem.numbering,
                    "level": elem.level,
                }
            )
        elif isinstance(elem, Table):
            # Build rows with raw XML preservation
            rows_data = []
            for row in elem.rows:
                row_dict = {
                    "cells": [
                        {
                            "content": elements_to_dict(cell.content),
                            "colspan": cell.colspan,
                            "rowspan": cell.rowspan,
                            **(
                                {"style": _cell_style_to_dict(cell.style)}
                                if cell.style
                                else {}
                            ),
                            **(
                                {"rawXml": cell.raw_xml} if cell.raw_xml else {}
                            ),
                        }
                        for cell in row.cells
                    ]
                }
                # Add raw row XML if present
                if row.raw_xml:
                    row_dict["rawXml"] = row.raw_xml
                rows_data.append(row_dict)

            table_dict = {
                "type": "table",
                "id": elem.id,
                "rows": rows_data,
            }
            if elem.style:
                style_dict = _table_style_to_dict(elem.style)
                if style_dict:
                    table_dict["style"] = style_dict
            # Add raw table XML if present
            if elem.raw_tblPr:
                table_dict["rawTblPr"] = elem.raw_tblPr
            if elem.raw_tblGrid:
                table_dict["rawTblGrid"] = elem.raw_tblGrid
            result.append(table_dict)
        elif isinstance(elem, Section):
            result.append(
                {
                    "type": "section",
                    "id": elem.id,
                    "originalRef": elem.original_ref,
                    "level": elem.level,
                    "title": elem.title,
                    "content": elements_to_dict(elem.content),
                    "children": elements_to_dict(elem.children),
                }
            )

    return result
