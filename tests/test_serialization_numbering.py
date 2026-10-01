import json

import pytest
from docx import Document
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls
from docx.enum.style import WD_STYLE_TYPE
from docx2tiptap import elements_to_dict
from docx2tiptap.comments_parser import get_text_with_comments
from docx2tiptap.models import (BorderStyle, CellBorders, CellStyle, Paragraph,
    Section, Table, TableCell, TableRow, TableStyle, TextRun)
from docx2tiptap.numbering import NumberingTracker


def test_serializes_nested_sections_tables_and_formatting():
    border = BorderStyle('double', 8, 'abcdef')
    cell = TableCell([Paragraph([TextRun('anchor', revision={'type': 'insertion'}, comment_ids=['7'])])],
        colspan=2, rowspan=3, style=CellStyle(1440, 'ffffff', 'center', CellBorders(border, border, border, border), 'right'), raw_xml='cell')
    table = Table(id='table', rows=[TableRow([cell, TableCell(style=CellStyle(borders=CellBorders()))], 'row')],
        style=TableStyle('Grid', 'center', [1440, 1440]), raw_tblPr='properties', raw_tblGrid='grid')
    section = Section(id='section', original_ref='ref', title='Title', content=[table], children=[Section(id='child')])
    result = elements_to_dict([section])[0]
    json.dumps(result)
    assert result['children'][0]['id'] == 'child'
    actual = result['content'][0]
    assert actual['rawTblPr'] == 'properties' and actual['rawTblGrid'] == 'grid'
    assert actual['style'] == {'styleName': 'Grid', 'alignment': 'center', 'columnWidths': [1440, 1440]}
    assert actual['rows'][0]['rawXml'] == 'row'
    c = actual['rows'][0]['cells'][0]
    assert c['colspan'] == 2 and c['rowspan'] == 3 and c['rawXml'] == 'cell'
    assert c['style']['borders']['right'] == {'style': 'double', 'width': 8, 'color': 'abcdef'}
    assert c['content'][0]['runs'][0]['commentIds'] == ['7']
    assert actual['rows'][0]['cells'][1]['style'] is None
    assert 'style' not in elements_to_dict([Table(style=TableStyle())])[0]


def test_comment_ranges_follow_nested_revision_text_and_overlap():
    p = parse_xml(f'''<w:p {nsdecls('w')}><w:r><w:t>outside</w:t></w:r>
    <w:commentRangeStart w:id="1"/><w:ins><w:r><w:t>added</w:t></w:r></w:ins>
    <w:commentRangeStart w:id="2"/><w:del><w:r><w:delText>removed</w:delText></w:r></w:del>
    <w:commentRangeEnd w:id="1"/><w:r><w:t>second</w:t></w:r>
    <w:commentRangeEnd w:id="2"/><w:r><w:t>after</w:t><w:t/></w:r></w:p>''')
    result = get_text_with_comments(p, 0)
    assert [s['text'] for s in result] == ['outside', 'added', 'removed', 'second', 'after']
    assert [set(s['comments']) for s in result] == [set(), {'1'}, {'1', '2'}, {'2'}, set()]


@pytest.mark.parametrize('fmt,start,expected', [
    ('decimal', 3, '3.'), ('lowerLetter', 2, 'b.'), ('upperLetter', 3, 'C.'),
    ('lowerRoman', 9, 'ix.'), ('upperRoman', 49, 'XLIX.'), ('bullet', 1, '•.'),
    ('unknown', 2, '2.'), ('upperLetter', 27, '27.')])
def test_numbering_formats_and_start_overrides(fmt, start, expected):
    doc = Document()
    numbering = doc.part.numbering_part.element
    numbering.append(parse_xml(f'''<w:abstractNum {nsdecls('w')} w:abstractNumId="99">
        <w:lvl w:ilvl="0"><w:numFmt w:val="{fmt}"/><w:lvlText w:val="%1."/></w:lvl>
        <w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1.%2"/></w:lvl>
        </w:abstractNum>'''))
    numbering.append(parse_xml(f'''<w:num {nsdecls('w')} w:numId="99"><w:abstractNumId w:val="99"/>
        <w:lvlOverride w:ilvl="0"><w:startOverride w:val="{start}"/></w:lvlOverride></w:num>'''))
    tracker = NumberingTracker(doc)
    assert tracker.get_number('99', 0) == expected
    assert tracker.get_number('99', 1) == f'{start}.a'
    assert tracker.get_number('99', 1) == f'{start}.b'
    tracker.get_number('99', 0)
    assert tracker.get_number('99', 1) == f'{start + 1}.a'
    assert tracker.get_number('missing', 0) == '1.'


def test_numbering_style_inheritance():
    doc = Document()
    style = doc.styles.add_style('ChildList', WD_STYLE_TYPE.PARAGRAPH)
    style.base_style = doc.styles['List Number']
    tracker = NumberingTracker(doc)
    assert tracker.get_numbering_from_style('ChildList') == tracker.get_numbering_from_style('List Number')
    assert tracker.get_numbering_from_style('missing') is None
