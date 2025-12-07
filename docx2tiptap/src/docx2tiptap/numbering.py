"""
Numbering Tracker - Manages list numbering state for Word documents.

This module handles the complex task of computing actual list numbers
from Word's numbering definitions, which involve:
- Abstract numbering definitions with format templates
- Numbering instances that reference abstract definitions
- Style inheritance for numbering
- Start value overrides
- Multi-level list support
"""

from typing import Optional

from docx import Document
from docx.oxml.ns import qn

from .constants import MAX_LIST_NESTING_LEVELS, MAX_STYLE_INHERITANCE_DEPTH


class NumberingTracker:
    """Tracks list numbering state to compute actual numbers."""

    def __init__(self, document: Document):
        self.document = document
        self.counters: dict[str, list[int]] = (
            {}
        )  # numId -> [level0_count, level1_count, ...]
        self._numbering_formats = self._extract_numbering_formats()
        self._style_numbering = self._extract_style_numbering()

    def _extract_style_numbering(self) -> dict:
        """Extract numbering info from paragraph styles (numId and ilvl)."""
        style_num_info = {}  # styleId -> {'numId': ..., 'ilvl': ...}

        try:
            styles_part = self.document.part.styles
            if styles_part is None:
                return style_num_info
            styles_xml = styles_part._element
        except (KeyError, AttributeError):
            return style_num_info

        # First pass: collect direct numPr from styles
        for style in styles_xml.findall(qn("w:style")):
            style_id = style.get(qn("w:styleId"))
            if not style_id:
                continue

            pPr = style.find(qn("w:pPr"))
            if pPr is not None:
                numPr = pPr.find(qn("w:numPr"))
                if numPr is not None:
                    ilvl_elem = numPr.find(qn("w:ilvl"))
                    numId_elem = numPr.find(qn("w:numId"))

                    ilvl = (
                        int(ilvl_elem.get(qn("w:val")))
                        if ilvl_elem is not None
                        else 0
                    )
                    numId = (
                        numId_elem.get(qn("w:val"))
                        if numId_elem is not None
                        else None
                    )

                    if numId and numId != "0":
                        style_num_info[style_id] = {
                            "numId": numId,
                            "ilvl": ilvl,
                        }

        # Second pass: resolve basedOn inheritance for styles without direct numPr
        # We need multiple passes to handle deep inheritance chains
        for _ in range(MAX_STYLE_INHERITANCE_DEPTH):
            made_changes = False
            for style in styles_xml.findall(qn("w:style")):
                style_id = style.get(qn("w:styleId"))
                if not style_id or style_id in style_num_info:
                    continue

                basedOn = style.find(qn("w:basedOn"))
                if basedOn is not None:
                    base_style_id = basedOn.get(qn("w:val"))
                    if base_style_id and base_style_id in style_num_info:
                        style_num_info[style_id] = style_num_info[
                            base_style_id
                        ].copy()
                        made_changes = True

            if not made_changes:
                break

        return style_num_info

    def get_numbering_from_style(
        self, style_name: str
    ) -> tuple[str, int] | None:
        """Get numId and ilvl from a style name, resolving inheritance."""
        # Style names may differ from style IDs - try to find a match
        # First try exact match on style ID
        if style_name in self._style_numbering:
            info = self._style_numbering[style_name]
            return info["numId"], info["ilvl"]

        # Try matching by normalizing (remove spaces)
        normalized = style_name.replace(" ", "")
        for style_id, info in self._style_numbering.items():
            if style_id.replace(" ", "") == normalized:
                return info["numId"], info["ilvl"]

        return None

    def _extract_numbering_formats(self) -> dict:
        """Extract numbering format definitions from document."""
        formats = {}
        try:
            numbering_part = self.document.part.numbering_part
        except (KeyError, NotImplementedError):
            # Document has no numbering definitions
            return formats
        if numbering_part is None:
            return formats

        # Parse the numbering definitions
        numbering_xml = numbering_part._element

        # First pass: build a map of style names to their defining abstractNum IDs
        # Some abstractNums use numStyleLink to reference styles defined elsewhere
        style_to_abstract_id = {}
        for abstract_num in numbering_xml.findall(qn("w:abstractNum")):
            abstract_id = abstract_num.get(qn("w:abstractNumId"))
            style_link = abstract_num.find(qn("w:styleLink"))
            if style_link is not None:
                style_name = style_link.get(qn("w:val"))
                style_to_abstract_id[style_name] = abstract_id

        # Second pass: extract level definitions from each abstractNum
        for abstract_num in numbering_xml.findall(qn("w:abstractNum")):
            abstract_id = abstract_num.get(qn("w:abstractNumId"))
            levels = {}
            for lvl in abstract_num.findall(qn("w:lvl")):
                ilvl = int(lvl.get(qn("w:ilvl")))
                num_fmt_elem = lvl.find(qn("w:numFmt"))
                lvl_text_elem = lvl.find(qn("w:lvlText"))

                num_fmt = (
                    num_fmt_elem.get(qn("w:val"))
                    if num_fmt_elem is not None
                    else "decimal"
                )
                lvl_text = (
                    lvl_text_elem.get(qn("w:val"))
                    if lvl_text_elem is not None
                    else "%1."
                )

                levels[ilvl] = {"format": num_fmt, "text": lvl_text}
            formats[abstract_id] = levels

        # Third pass: resolve numStyleLink references
        # If an abstractNum uses numStyleLink, copy levels from the defining abstractNum
        for abstract_num in numbering_xml.findall(qn("w:abstractNum")):
            abstract_id = abstract_num.get(qn("w:abstractNumId"))
            num_style_link = abstract_num.find(qn("w:numStyleLink"))
            if num_style_link is not None:
                style_name = num_style_link.get(qn("w:val"))
                # Find the abstractNum that defines this style
                if style_name in style_to_abstract_id:
                    defining_abstract_id = style_to_abstract_id[style_name]
                    if defining_abstract_id in formats:
                        formats[abstract_id] = formats[defining_abstract_id]

        # Map numId to abstractNumId and extract startOverride values
        self._num_to_abstract = {}
        self._start_overrides = {}  # numId -> {ilvl: start_value}
        for num in numbering_xml.findall(qn("w:num")):
            num_id = num.get(qn("w:numId"))
            abstract_ref = num.find(qn("w:abstractNumId"))
            if abstract_ref is not None:
                self._num_to_abstract[num_id] = abstract_ref.get(qn("w:val"))

            # Check for lvlOverride with startOverride
            for lvl_override in num.findall(qn("w:lvlOverride")):
                ilvl = int(lvl_override.get(qn("w:ilvl")))
                start_override = lvl_override.find(qn("w:startOverride"))
                if start_override is not None:
                    start_val = int(start_override.get(qn("w:val")))
                    if num_id not in self._start_overrides:
                        self._start_overrides[num_id] = {}
                    # Store start-1 because get_number increments before returning
                    self._start_overrides[num_id][ilvl] = start_val - 1

        return formats

    def get_number(self, num_id: str, ilvl: int) -> str:
        """Get the computed number for a list item."""
        if num_id not in self.counters:
            self.counters[num_id] = [0] * MAX_LIST_NESTING_LEVELS
            # Apply startOverride values if present
            if num_id in self._start_overrides:
                for override_ilvl, start_val in self._start_overrides[
                    num_id
                ].items():
                    self.counters[num_id][override_ilvl] = start_val

        # Increment current level, reset deeper levels
        self.counters[num_id][ilvl] += 1
        for i in range(ilvl + 1, MAX_LIST_NESTING_LEVELS):
            self.counters[num_id][i] = 0

        # Get format info
        abstract_id = self._num_to_abstract.get(num_id)
        if abstract_id and abstract_id in self._numbering_formats:
            level_info = self._numbering_formats[abstract_id].get(ilvl, {})
            num_fmt = level_info.get("format", "decimal")
            lvl_text = level_info.get("text", "%1.")
        else:
            num_fmt = "decimal"
            lvl_text = "%1."

        # Build the number string
        result = lvl_text
        for i in range(ilvl + 1):
            count = self.counters[num_id][i]
            formatted = self._format_number(
                count, num_fmt if i == ilvl else "decimal"
            )
            result = result.replace(f"%{i+1}", formatted)

        return result

    def _format_number(self, n: int, fmt: str) -> str:
        """Format a number according to the numbering format."""
        if fmt == "decimal":
            return str(n)
        elif fmt == "lowerLetter":
            return chr(ord("a") + n - 1) if 1 <= n <= 26 else str(n)
        elif fmt == "upperLetter":
            return chr(ord("A") + n - 1) if 1 <= n <= 26 else str(n)
        elif fmt == "lowerRoman":
            return self._to_roman(n).lower()
        elif fmt == "upperRoman":
            return self._to_roman(n)
        elif fmt == "bullet":
            return "•"
        else:
            return str(n)

    def _to_roman(self, n: int) -> str:
        """Convert integer to Roman numerals."""
        if n <= 0:
            return str(n)
        result = ""
        for value, numeral in [
            (1000, "M"),
            (900, "CM"),
            (500, "D"),
            (400, "CD"),
            (100, "C"),
            (90, "XC"),
            (50, "L"),
            (40, "XL"),
            (10, "X"),
            (9, "IX"),
            (5, "V"),
            (4, "IV"),
            (1, "I"),
        ]:
            while n >= value:
                result += numeral
                n -= value
        return result
