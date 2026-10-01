from io import BytesIO
from zipfile import ZipFile

from docx2tiptap import parse_docx, to_tiptap
from lxml import etree

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def save(doc):
    buf = BytesIO()
    doc.save(buf)
    return buf.getvalue()


def imported(data):
    return to_tiptap(*parse_docx(data))


def xml(data, part="word/document.xml"):
    if hasattr(data, "getvalue"):
        data = data.getvalue()
    with ZipFile(BytesIO(data)) as z:
        return etree.fromstring(z.read(part))


def walk(node):
    yield node
    for child in node.get("content", []):
        yield from walk(child)


def text(value, *marks):
    return {"type": "text", "text": value, **({"marks": list(marks)} if marks else {})}


def paragraph(*nodes, **attrs):
    return {"type": "paragraph", "content": list(nodes), "attrs": attrs}


def document(*nodes):
    return {"type": "doc", "content": list(nodes)}


def revision(kind, author="Alice"):
    return {"type": kind, "attrs": {"id": "r1", "author": author, "date": "2025-01-01T00:00:00Z"}}
