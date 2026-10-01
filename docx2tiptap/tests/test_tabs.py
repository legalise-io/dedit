"""Tabs are carried as "\t" inside text nodes so their marks survive
collaborative sync (y-prosemirror only syncs marks on text)."""

import io
from zipfile import ZipFile

import pytest

from docx2tiptap import create_docx_from_tiptap, parse_docx, to_tiptap

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def import_docx(data: bytes) -> dict:
    elements, comments, numbering = parse_docx(data)
    return to_tiptap(elements, comments, numbering)


def walk(node):
    yield node
    for child in node.get("content", []) or []:
        yield from walk(child)


def mark_types(node) -> set[str]:
    return {m["type"] for m in node.get("marks", [])}


def document_xml(buffer: io.BytesIO) -> str:
    with ZipFile(buffer) as z:
        return z.read("word/document.xml").decode()


def para(*content) -> dict:
    return {"type": "doc", "content": [{"type": "paragraph", "content": list(content)}]}


def test_import_emits_no_tab_nodes(tracked_tabs_docx):
    doc = import_docx(tracked_tabs_docx)
    assert not [n for n in walk(doc) if n.get("type") == "tab"]


def test_import_keeps_deleted_tabs_as_marked_text(tracked_tabs_docx):
    doc = import_docx(tracked_tabs_docx)
    deleted_tabs = [
        n for n in walk(doc)
        if n.get("type") == "text" and "\t" in n["text"] and "deletion" in mark_types(n)
    ]
    assert deleted_tabs


def test_export_deleted_text_with_tab():
    deletion = {"type": "deletion", "attrs": {"id": "d1", "author": "A", "date": "2025-01-01T00:00:00Z"}}
    xml = document_xml(create_docx_from_tiptap(para({"type": "text", "text": "a\tb", "marks": [deletion]})))
    del_run = xml[xml.index("<w:del "): xml.index("</w:del>")]
    assert "<w:tab/>" in del_run
    assert ">a</w:delText>" in del_run and ">b</w:delText>" in del_run
    assert "\t" not in del_run


def test_export_inserted_text_with_tab():
    insertion = {"type": "insertion", "attrs": {"id": "i1", "author": "A", "date": "2025-01-01T00:00:00Z"}}
    xml = document_xml(create_docx_from_tiptap(para({"type": "text", "text": "a\tb", "marks": [insertion]})))
    ins_run = xml[xml.index("<w:ins "): xml.index("</w:ins>")]
    assert "<w:tab/>" in ins_run
    assert "\t" not in ins_run


def test_export_plain_text_with_tab():
    xml = document_xml(create_docx_from_tiptap(para({"type": "text", "text": "a\tb"})))
    assert "<w:tab/>" in xml
    assert "\t" not in xml


def test_legacy_tab_node_still_exports():
    xml = document_xml(create_docx_from_tiptap(para({"type": "text", "text": "a"}, {"type": "tab"})))
    assert "<w:tab/>" in xml


def count_deleted_tabs(doc: dict) -> int:
    return sum(
        n["text"].count("\t") for n in walk(doc)
        if n.get("type") == "text" and "deletion" in mark_types(n)
    )


def test_roundtrip_keeps_deleted_tabs(tracked_tabs_docx):
    original = tracked_tabs_docx
    first = import_docx(original)
    second = import_docx(create_docx_from_tiptap(first, [], original).getvalue())
    assert count_deleted_tabs(second) == count_deleted_tabs(first) > 0
