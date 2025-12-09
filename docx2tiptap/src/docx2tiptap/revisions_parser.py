"""
Revisions Parser - Extracts track changes (insertions/deletions) from Word documents.

Word stores track changes as:
- <w:ins> elements for insertions (with w:author, w:date attributes)
- <w:del> elements for deletions (with w:author, w:date attributes)

These wrap the affected content (runs, text, etc.)

Note: The Revision dataclass and extract_revisions_from_paragraph function
were removed in the 2024-12-07 refactoring as they were unused. The revision
information is now extracted directly in get_text_with_revisions.
"""

import uuid

from docx.oxml.ns import qn

from .utils import element_to_base64


def generate_unique_id(prefix: str) -> str:
    """Generate a globally unique ID for a revision."""
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def get_text_with_revisions(para_element, para_index: int) -> list[dict]:
    """
    Extract text runs from a paragraph, preserving revision marks.

    Args:
        para_element: The lxml paragraph element to process
        para_index: Index of the paragraph in the document (for ID generation)

    Returns:
        A list of text segments with their revision status:
        [
            {'text': 'normal text', 'revision': None, 'bold': False, 'italic': False},
            {'text': 'inserted text', 'revision': {'type': 'insertion', 'author': '...', 'id': '...', 'date': '...'}, ...},
            {'text': 'deleted text', 'revision': {'type': 'deletion', 'author': '...', 'id': '...', 'date': '...'}, ...},
        ]
    """
    segments = []

    def process_element(element, current_revision=None):
        tag = element.tag

        # Check if this element starts a revision
        if tag == qn("w:ins"):
            author = element.get(qn("w:author")) or "Unknown"
            date = element.get(qn("w:date"))
            current_revision = {
                "type": "insertion",
                "id": generate_unique_id("ins"),
                "author": author,
                "date": date,
            }
            for child in element:
                process_element(child, current_revision)
            return

        if tag == qn("w:del"):
            author = element.get(qn("w:author")) or "Unknown"
            date = element.get(qn("w:date"))
            current_revision = {
                "type": "deletion",
                "id": generate_unique_id("del"),
                "author": author,
                "date": date,
            }
            for child in element:
                process_element(child, current_revision)
            return

        # Text element
        if tag == qn("w:t"):
            text = element.text or ""
            if text:
                segments.append(
                    {
                        "text": text,
                        "revision": current_revision,
                        "bold": False,
                        "italic": False,
                    }
                )
            return

        # Deleted text element
        if tag == qn("w:delText"):
            text = element.text or ""
            if text:
                segments.append(
                    {
                        "text": text,
                        "revision": current_revision,
                        "bold": False,
                        "italic": False,
                    }
                )
            return

        # Run element - check for formatting
        if tag == qn("w:r"):
            # Check for bold/italic in run properties
            rPr = element.find(qn("w:rPr"))
            is_bold = False
            is_italic = False
            raw_rPr = None
            if rPr is not None:
                is_bold = rPr.find(qn("w:b")) is not None
                is_italic = rPr.find(qn("w:i")) is not None
                # Store full rPr as base64 for round-trip preservation
                raw_rPr = element_to_base64(rPr)

            for child in element:
                if child.tag == qn("w:t"):
                    text = child.text or ""
                    if text:
                        segments.append(
                            {
                                "text": text,
                                "revision": current_revision,
                                "bold": is_bold,
                                "italic": is_italic,
                                "raw_rPr": raw_rPr,
                            }
                        )
                elif child.tag == qn("w:delText"):
                    text = child.text or ""
                    if text:
                        segments.append(
                            {
                                "text": text,
                                "revision": current_revision,
                                "bold": is_bold,
                                "italic": is_italic,
                                "raw_rPr": raw_rPr,
                            }
                        )
                elif child.tag == qn("w:br"):
                    # Handle break elements (page breaks, line breaks, etc.)
                    br_type = child.get(qn("w:type"))
                    segments.append(
                        {
                            "break": True,
                            "break_type": br_type,  # "page", "column", "textWrapping", or None (line break)
                            "revision": current_revision,
                        }
                    )
                elif child.tag == qn("w:tab"):
                    # Handle tab characters (used for form fields with underlines)
                    # Preserve the raw_rPr so styling (like dotted underlines) is maintained
                    segments.append(
                        {
                            "tab": True,
                            "revision": current_revision,
                            "bold": is_bold,
                            "italic": is_italic,
                            "raw_rPr": raw_rPr,
                        }
                    )
            return

        # Recurse into other elements
        for child in element:
            process_element(child, current_revision)

    # Process the paragraph element
    for child in para_element:
        process_element(child)

    return segments


def merge_adjacent_segments(segments: list[dict]) -> list[dict]:
    """
    Merge adjacent text segments that have the same revision, formatting, and raw styles.

    Args:
        segments: List of text segments from get_text_with_revisions

    Returns:
        Merged list with fewer, larger segments where possible
    """
    if not segments:
        return []

    merged = []
    current = segments[0].copy()

    for seg in segments[1:]:
        # Break and tab segments should never be merged
        if seg.get("break") or current.get("break") or seg.get("tab") or current.get("tab"):
            if current.get("text") or current.get("break") or current.get("tab"):
                merged.append(current)
            current = seg.copy()
            continue

        # Check if can merge
        same_revision = (
            current["revision"] is None and seg["revision"] is None
        ) or (
            current["revision"] is not None
            and seg["revision"] is not None
            and current["revision"].get("id") == seg["revision"].get("id")
        )
        same_format = current.get("bold") == seg.get("bold") and current.get(
            "italic"
        ) == seg.get("italic")
        # Also check raw_rPr - segments with different raw styles should not merge
        same_raw_style = current.get("raw_rPr") == seg.get("raw_rPr")

        if same_revision and same_format and same_raw_style:
            current["text"] += seg["text"]
        else:
            if current.get("text"):
                merged.append(current)
            current = seg.copy()

    if current.get("text") or current.get("break") or current.get("tab"):
        merged.append(current)

    return merged
