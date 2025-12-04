"""
Revisions Parser - Extracts track changes (insertions/deletions) from Word documents.

Word stores track changes as:
- <w:ins> elements for insertions (with w:author, w:date attributes)
- <w:del> elements for deletions (with w:author, w:date attributes)

These wrap the affected content (runs, text, etc.)
"""

import uuid
from dataclasses import dataclass, field
from typing import Optional

from docx.oxml.ns import qn


def generate_unique_id(prefix: str) -> str:
    """Generate a globally unique ID for a revision."""
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


@dataclass
class Revision:
    """A tracked change (insertion or deletion)."""

    id: str
    revision_type: str  # 'insertion' or 'deletion'
    author: str
    date: Optional[str]
    # Position info for mapping to text
    paragraph_index: int = 0
    run_index: int = 0


def extract_revisions_from_paragraph(
    para_element, para_index: int
) -> tuple[list[Revision], dict]:
    """
    Extract revision information from a paragraph element.

    Returns:
        tuple: (list of Revision objects, dict mapping run positions to revision info)
    """
    revisions = []
    run_revision_map = {}  # Maps (para_idx, run_idx) -> revision info

    revision_id = 0

    # Find all w:ins elements (insertions)
    for ins in para_element.iter(qn("w:ins")):
        author = ins.get(qn("w:author")) or "Unknown"
        date = ins.get(qn("w:date"))
        rev_id = f"ins-{para_index}-{revision_id}"
        revision_id += 1

        revision = Revision(
            id=rev_id,
            revision_type="insertion",
            author=author,
            date=date,
            paragraph_index=para_index,
        )
        revisions.append(revision)

        # Find all runs within this insertion
        for run in ins.iter(qn("w:r")):
            # Store mapping from run element to revision
            run_revision_map[id(run)] = {
                "type": "insertion",
                "id": rev_id,
                "author": author,
                "date": date,
            }

    # Find all w:del elements (deletions)
    for deletion in para_element.iter(qn("w:del")):
        author = deletion.get(qn("w:author")) or "Unknown"
        date = deletion.get(qn("w:date"))
        rev_id = f"del-{para_index}-{revision_id}"
        revision_id += 1

        revision = Revision(
            id=rev_id,
            revision_type="deletion",
            author=author,
            date=date,
            paragraph_index=para_index,
        )
        revisions.append(revision)

        # Find all runs within this deletion
        for run in deletion.iter(qn("w:r")):
            run_revision_map[id(run)] = {
                "type": "deletion",
                "id": rev_id,
                "author": author,
                "date": date,
            }

        # Also check for w:delText elements (deleted text without run wrapper)
        for del_text in deletion.iter(qn("w:delText")):
            run_revision_map[id(del_text)] = {
                "type": "deletion",
                "id": rev_id,
                "author": author,
                "date": date,
            }

    return revisions, run_revision_map


def get_text_with_revisions(para_element, para_index: int) -> list[dict]:
    """
    Extract text runs from a paragraph, preserving revision marks.

    Returns a list of text segments with their revision status:
    [
        {'text': 'normal text', 'revision': None},
        {'text': 'inserted text', 'revision': {'type': 'insertion', 'author': '...', ...}},
        {'text': 'deleted text', 'revision': {'type': 'deletion', 'author': '...', ...}},
    ]
    """
    segments = []
    _, run_revision_map = extract_revisions_from_paragraph(
        para_element, para_index
    )

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
            if rPr is not None:
                is_bold = rPr.find(qn("w:b")) is not None
                is_italic = rPr.find(qn("w:i")) is not None

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
    Merge adjacent text segments that have the same revision and formatting.
    """
    if not segments:
        return []

    merged = []
    current = segments[0].copy()

    for seg in segments[1:]:
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

        if same_revision and same_format:
            current["text"] += seg["text"]
        else:
            if current["text"]:
                merged.append(current)
            current = seg.copy()

    if current["text"]:
        merged.append(current)

    return merged
