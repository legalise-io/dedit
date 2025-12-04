"""
Comments Parser - Extracts comments from Word documents.

Word stores comments in:
- word/comments.xml - Contains the actual comment text, author, date
- document.xml - Contains markers for comment ranges:
  - <w:commentRangeStart w:id="0"/> - Start of commented text
  - <w:commentRangeEnd w:id="0"/> - End of commented text
  - <w:commentReference w:id="0"/> - Reference point (usually at end)

Comments can have replies, which are stored as separate comments with
a w:paraId attribute linking them to the parent.
"""

import zipfile
from dataclasses import dataclass, field
from typing import Optional

from lxml import etree

WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
WORD_NS_PREFIX = "{" + WORD_NS + "}"


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


def extract_comments_from_docx(docx_bytes: bytes) -> dict[str, Comment]:
    """
    Extract all comments from a DOCX file.

    Args:
        docx_bytes: Raw bytes of the DOCX file

    Returns:
        Dict mapping comment ID to Comment object
    """
    from io import BytesIO

    comments = {}

    try:
        with zipfile.ZipFile(BytesIO(docx_bytes)) as zf:
            # Check if comments.xml exists
            if "word/comments.xml" not in zf.namelist():
                return comments

            comments_xml = zf.read("word/comments.xml")
            tree = etree.fromstring(comments_xml)

            # Find all comment elements
            for comment_elem in tree.findall(f".//{WORD_NS_PREFIX}comment"):
                comment_id = comment_elem.get(f"{WORD_NS_PREFIX}id")
                author = (
                    comment_elem.get(f"{WORD_NS_PREFIX}author") or "Unknown"
                )
                date = comment_elem.get(f"{WORD_NS_PREFIX}date")
                initials = comment_elem.get(f"{WORD_NS_PREFIX}initials")

                # Extract comment text (can span multiple paragraphs)
                text_parts = []
                for text_elem in comment_elem.iter(f"{WORD_NS_PREFIX}t"):
                    if text_elem.text:
                        text_parts.append(text_elem.text)

                text = "".join(text_parts)

                comments[comment_id] = Comment(
                    id=comment_id,
                    author=author,
                    date=date,
                    text=text,
                    initials=initials,
                )

            # Handle extended comments (replies) if commentsExtended.xml exists
            if "word/commentsExtended.xml" in zf.namelist():
                _process_comment_replies(zf, comments)

    except (zipfile.BadZipFile, KeyError, etree.XMLSyntaxError):
        # Return empty dict if we can't parse comments
        pass

    return comments


def _process_comment_replies(zf: zipfile.ZipFile, comments: dict[str, Comment]):
    """
    Process commentsExtended.xml to link reply comments to their parents.

    In Word, replies are stored as separate comments with a paraIdParent
    attribute linking them to the parent comment.
    """
    try:
        extended_xml = zf.read("word/commentsExtended.xml")
        tree = etree.fromstring(extended_xml)

        # Namespace for commentsExtended
        w15_ns = "http://schemas.microsoft.com/office/word/2012/wordml"

        # Build parent-child relationships
        for comment_ex in tree.findall(f".//{{{w15_ns}}}commentEx"):
            para_id = comment_ex.get(f"{{{w15_ns}}}paraId")
            parent_para_id = comment_ex.get(f"{{{w15_ns}}}paraIdParent")

            if parent_para_id:
                # This is a reply - find the comment and its parent
                # Note: This requires mapping paraId to comment ID
                # For now, we'll skip this complexity
                pass

    except (KeyError, etree.XMLSyntaxError):
        pass


def find_comment_ranges_in_paragraph(
    para_element, para_index: int
) -> dict[str, dict]:
    """
    Find comment range markers in a paragraph.

    Returns dict mapping comment ID to range info:
    {
        '0': {'start_offset': 5, 'end_offset': 20},
        '1': {'start_offset': 30, 'end_offset': 45}
    }
    """
    ranges = {}
    current_offset = 0
    active_comments = {}  # comment_id -> start_offset

    def process_element(element):
        nonlocal current_offset

        tag = element.tag

        # Comment range start
        if tag == f"{WORD_NS_PREFIX}commentRangeStart":
            comment_id = element.get(f"{WORD_NS_PREFIX}id")
            if comment_id:
                active_comments[comment_id] = current_offset

        # Comment range end
        elif tag == f"{WORD_NS_PREFIX}commentRangeEnd":
            comment_id = element.get(f"{WORD_NS_PREFIX}id")
            if comment_id and comment_id in active_comments:
                ranges[comment_id] = {
                    "para_index": para_index,
                    "start_offset": active_comments[comment_id],
                    "end_offset": current_offset,
                }

        # Text - track offset
        elif tag == f"{WORD_NS_PREFIX}t":
            text = element.text or ""
            current_offset += len(text)

        elif tag == f"{WORD_NS_PREFIX}delText":
            text = element.text or ""
            current_offset += len(text)

        # Recurse
        for child in element:
            process_element(child)

    for child in para_element:
        process_element(child)

    return ranges


def get_text_with_comments(para_element, para_index: int) -> list[dict]:
    """
    Extract text runs from a paragraph, tracking comment ranges.

    Returns a list of text segments with their comment status:
    [
        {'text': 'normal text', 'comments': []},
        {'text': 'commented text', 'comments': ['0', '1']},  # Can have multiple overlapping
    ]
    """
    segments = []
    active_comment_ids = set()

    def process_element(element):
        tag = element.tag

        # Comment range start
        if tag == f"{WORD_NS_PREFIX}commentRangeStart":
            comment_id = element.get(f"{WORD_NS_PREFIX}id")
            if comment_id:
                active_comment_ids.add(comment_id)
            return

        # Comment range end
        if tag == f"{WORD_NS_PREFIX}commentRangeEnd":
            comment_id = element.get(f"{WORD_NS_PREFIX}id")
            if comment_id:
                active_comment_ids.discard(comment_id)
            return

        # Text element
        if tag == f"{WORD_NS_PREFIX}t":
            text = element.text or ""
            if text:
                segments.append(
                    {
                        "text": text,
                        "comments": (
                            list(active_comment_ids)
                            if active_comment_ids
                            else []
                        ),
                    }
                )
            return

        # Deleted text
        if tag == f"{WORD_NS_PREFIX}delText":
            text = element.text or ""
            if text:
                segments.append(
                    {
                        "text": text,
                        "comments": (
                            list(active_comment_ids)
                            if active_comment_ids
                            else []
                        ),
                    }
                )
            return

        # Run element
        if tag == f"{WORD_NS_PREFIX}r":
            for child in element:
                process_element(child)
            return

        # Recurse into other elements
        for child in element:
            process_element(child)

    for child in para_element:
        process_element(child)

    return segments


def comments_to_dict(comments: dict[str, Comment]) -> list[dict]:
    """Convert Comment objects to JSON-serializable dictionaries."""
    return [
        {
            "id": c.id,
            "author": c.author,
            "date": c.date,
            "text": c.text,
            "initials": c.initials,
            "replies": [
                {"id": r.id, "author": r.author, "date": r.date, "text": r.text}
                for r in c.replies
            ],
        }
        for c in comments.values()
    ]
