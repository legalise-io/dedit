"""
Shared utility functions for docx2tiptap.

Contains common helpers used across multiple modules.
"""

import base64
from typing import Optional

from lxml import etree


def element_to_base64(element) -> Optional[str]:
    """
    Serialize an lxml element to base64-encoded XML string.

    Args:
        element: An lxml element to serialize

    Returns:
        Base64-encoded string of the XML, or None if element is None
    """
    if element is None:
        return None
    xml_bytes = etree.tostring(element, encoding="unicode")
    return base64.b64encode(xml_bytes.encode("utf-8")).decode("ascii")


def base64_to_element(b64_string: str):
    """
    Deserialize a base64-encoded XML string to an lxml element.

    Args:
        b64_string: Base64-encoded XML string

    Returns:
        Parsed lxml element, or None if input is empty/None
    """
    if not b64_string:
        return None
    xml_bytes = base64.b64decode(b64_string.encode("ascii"))
    return etree.fromstring(xml_bytes)
