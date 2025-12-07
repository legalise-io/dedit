"""
Comments Parser - Extracts comments from Word documents.

Word stores comments in:
- word/comments.xml - Contains the actual comment text, author, date
- document.xml - Contains markers for comment ranges:
  - <w:commentRangeStart w:id="0"/> - Start of commented text
  - <w:commentRangeEnd w:id="0"/> - End of commented text
  - <w:commentReference w:id="0"/> - Reference point (usually at end)

Note: Comment replies (via commentsExtended.xml) are not currently supported.
The _process_comment_replies function was removed in the 2024-12-07 refactoring
as it was a non-functional stub. Reply comments appear as top-level comments.

Note: find_comment_ranges_in_paragraph was removed in the 2024-12-07 refactoring
as it was never called. Use get_text_with_comments for comment range information.
"""

import zipfile
from io import BytesIO

from lxml import etree

from .models import Comment

WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
WORD_NS_PREFIX = "{" + WORD_NS + "}"


def extract_comments_from_docx(docx_bytes: bytes) -> dict[str, Comment]:
    """
    Extract all comments from a DOCX file.

    Args:
        docx_bytes: Raw bytes of the DOCX file

    Returns:
        Dict mapping comment ID to Comment object
    """
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

    except (zipfile.BadZipFile, KeyError, etree.XMLSyntaxError):
        # Return empty dict if we can't parse comments
        pass

    return comments


def get_text_with_comments(para_element, para_index: int) -> list[dict]:
    """
    Extract text runs from a paragraph, tracking comment ranges.

    Args:
        para_element: The lxml paragraph element to process
        para_index: Index of the paragraph in the document

    Returns:
        A list of text segments with their comment status:
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
    """
    Convert Comment objects to JSON-serializable dictionaries.

    Args:
        comments: Dict mapping comment ID to Comment object

    Returns:
        List of comment dictionaries suitable for JSON serialization
    """
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
