# Text Formatting Pipeline Analysis - dedit docx2tiptap Library

   ## Overview

   The docx2tiptap library implements a complete text formatting round-tripping system that converts between Word
   (.docx) documents and TipTap JSON, preserving formatting through multiple transformations.

   **Key principle**: The system extracts formatting at parsing time, passes it through intermediate dataclasses,
   converts to TipTap marks, and reconstructs it on export.

   ---

   ## 1. TextRun Dataclass Structure (models.py)

   The `TextRun` dataclass is the core intermediate representation for text with formatting:

   ```python
   @dataclass
   class TextRun:
       """A run of text with formatting and revision/comment info."""
       text: str
       bold: bool = False
       italic: bool = False
       revision: Optional[RevisionInfo] = None
       comment_ids: list[str] = field(default_factory=list)
   ```

   **Current capabilities**:
   - `text`: The actual string content
   - `bold`: Boolean flag for bold formatting
   - `italic`: Boolean flag for italic formatting
   - `revision`: Optional RevisionInfo dict (for track changes)
   - `comment_ids`: List of comment IDs attached to this run

   **Extensibility**: The TextRun structure is designed to be extended. Additional formatting properties (font,
   color, size, etc.) can be added as new boolean or optional fields.

   ---

   ## 2. DOCX → TextRun: Parsing from Word (docx_parser.py & revisions_parser.py)

   ### Flow Chart
   ```
   Word document (.docx)
       ↓
   parse_docx() [docx_parser.py:360]
       ↓
   parse_paragraph() [docx_parser.py:40]
       ↓
   get_text_with_revisions() [revisions_parser.py:25]
       ↓
   Segment extraction with bold/italic detection
       ↓
   merge_adjacent_segments() [revisions_parser.py:147]
       ↓
   TextRun objects created [docx_parser.py:66-73]
   ```

   ### Detailed Extraction Process

   #### Bold/Italic Extraction (revisions_parser.py:101-134)

   The `get_text_with_revisions()` function recursively processes paragraph elements:

   ```python
   # Run element - check for formatting
   if tag == qn("w:r"):
       # Check for bold/italic in run properties
       rPr = element.find(qn("w:rPr"))
       is_bold = False
       is_italic = False
       if rPr is not None:
           is_bold = rPr.find(qn("w:b")) is not None
           is_italic = rPr.find(qn("w:i")) is not None
   ```

   **How it works**:
   1. When processing a `<w:r>` (run) element, extract `<w:rPr>` (run properties)
   2. Check if `<w:b>` (bold) element exists → set `is_bold = True`
   3. Check if `<w:i>` (italic) element exists → set `is_italic = True`
   4. These flags are added to the extracted text segment

   **Limitation**: Currently only detects bold/italic by presence/absence. No support for:
   - Font family/name
   - Font size
   - Font color
   - Underline, strikethrough, etc.
   - These are present in the Word XML but not extracted

   #### Segment Merging (revisions_parser.py:147-186)

   Adjacent segments with the same formatting and revision status are merged:

   ```python
   def merge_adjacent_segments(segments: list[dict]) -> list[dict]:
       """Merge adjacent text segments that have the same revision and formatting."""
       # Checks: same_revision AND same_format (bold + italic match)
       if same_revision and same_format:
           current["text"] += seg["text"]
   ```

   This reduces the number of TextRun objects created while preserving all formatting information.

   #### TextRun Creation (docx_parser.py:66-73)

   ```python
   runs.append(
       TextRun(
           text=seg["text"],
           bold=seg.get("bold", False),
           italic=seg.get("italic", False),
           revision=seg.get("revision"),
           comment_ids=comment_ids,
       )
   )
   ```

   The segment dict (with formatting) is converted directly to a TextRun object.

   ---

   ## 3. TextRun → TipTap JSON: Conversion (tiptap_converter.py)

   ### Flow Chart
   ```
   TextRun objects
       ↓
   _text_run_to_node() [line 70]
       ↓
   _build_marks() [line 80]
       ↓
   TipTap text node with marks array
   ```

   ### The _build_marks() Method (tiptap_converter.py:80-126)

   This is the **single source of truth** for converting TextRun to TipTap marks:

   ```python
   def _build_marks(self, run: TextRun) -> list[dict]:
       """Build TipTap marks array from a TextRun's formatting and annotations."""
       marks = []

       # Basic formatting marks
       if run.bold:
           marks.append({"type": "bold"})
       if run.italic:
           marks.append({"type": "italic"})

       # Revision marks (track changes)
       if run.revision:
           rev = run.revision
           rev_type = rev.get("type")
           if rev_type in ("insertion", "deletion"):
               marks.append({
                   "type": rev_type,
                   "attrs": {
                       "id": rev.get("id"),
                       "author": rev.get("author"),
                       "date": rev.get("date"),
                   },
               })

       # Comment marks
       for comment_id in run.comment_ids:
           comment_attrs = {"commentId": comment_id}
           # ... look up comment details ...
           marks.append({"type": "comment", "attrs": comment_attrs})

       return marks
   ```

   ### TipTap Node Structure

   Text nodes are created with this structure:

   ```python
   def _text_run_to_node(self, run: TextRun) -> dict:
       """Convert a TextRun to a TipTap text node with marks."""
       node = {"type": "text", "text": run.text}

       marks = self._build_marks(run)
       if marks:
           node["marks"] = marks

       return node
   ```

   **Example output**:
   ```json
   {
     "type": "text",
     "text": "bold text",
     "marks": [
       {"type": "bold"},
       {"type": "insertion", "attrs": {"id": "ins-123", "author": "John", "date": "2024-01-01"}}
     ]
   }
   ```

   ### Mark Order

   Marks are added in this order:
   1. Basic formatting (bold, italic)
   2. Revision marks (insertion/deletion)
   3. Comment marks

   This order is important for TipTap's mark interaction logic.

   ---

   ## 4. TipTap JSON → DOCX: Export (docx_exporter.py)

   ### Flow Chart
   ```
   TipTap JSON document
       ↓
   export() [line 56]
       ↓
   _restore_raw_styles() [line 121]
       ↓
   _process_node() for each content node [line 87]
       ↓
   _add_text_with_marks() [line 385]
       ↓
   OOXML generation (w:r, w:b, w:i, w:ins, w:del, w:t elements)
       ↓
   Word document (.docx)
   ```

   ### Text with Marks Processing (docx_exporter.py:385-432)

   ```python
   def _add_text_with_marks(self, para, text_node: dict) -> None:
       """Add text to a paragraph, handling track changes and comments."""
       text = text_node.get("text", "")
       marks = text_node.get("marks", [])

       # Separate marks by category
       insertion_mark = None
       deletion_mark = None
       comment_ids = []
       basic_marks = []

       for mark in marks:
           mark_type = mark.get("type")
           if mark_type == "insertion":
               insertion_mark = mark.get("attrs", {})
           elif mark_type == "deletion":
               deletion_mark = mark.get("attrs", {})
           elif mark_type == "comment":
               comment_id = mark.get("attrs", {}).get("commentId")
               if comment_id:
                   comment_ids.append(comment_id)
           elif mark_type in ("bold", "italic"):
               basic_marks.append(mark)

       # Handle track changes
       if insertion_mark:
           self._add_insertion(para, text, insertion_mark, basic_marks)
       elif deletion_mark:
           self._add_deletion(para, text, deletion_mark, basic_marks)
       else:
           # Regular text with basic marks
           run = para.add_run(text)
           self._apply_basic_marks(run, basic_marks)
   ```

   ### Basic Marks Application (docx_exporter.py:509-516)

   ```python
   def _apply_basic_marks(self, run, marks: list) -> None:
       """Apply basic formatting marks (bold, italic) to a run."""
       for mark in marks:
           mark_type = mark.get("type")
           if mark_type == "bold":
               run.bold = True
           elif mark_type == "italic":
               run.italic = True
   ```

   This sets the python-docx `run.bold` and `run.italic` properties, which are converted to OOXML `<w:b>` and `<w:i>`
    elements automatically.

   ### Insertion/Deletion Handling (docx_exporter.py:434-507)

   For track changes, raw OOXML is created:

   ```python
   def _add_insertion(self, para, text: str, attrs: dict, basic_marks: list) -> None:
       """Add text as an insertion (tracked change)."""
       p_elem = para._p

       # Create w:ins element
       ins = OxmlElement("w:ins")
       ins.set(qn("w:id"), self._next_revision_id())
       ins.set(qn("w:author"), attrs.get("author", "Unknown"))
       if attrs.get("date"):
           ins.set(qn("w:date"), attrs["date"])

       # Create run inside insertion
       r = OxmlElement("w:r")

       # Add run properties for formatting (bold/italic)
       if basic_marks:
           rPr = OxmlElement("w:rPr")
           for mark in basic_marks:
               if mark.get("type") == "bold":
                   rPr.append(OxmlElement("w:b"))
               elif mark.get("type") == "italic":
                   rPr.append(OxmlElement("w:i"))
           r.append(rPr)

       # Add text element
       t = OxmlElement("w:t")
       t.text = text
       t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
       r.append(t)

       ins.append(r)
       p_elem.append(ins)
   ```

   **Result**: Creates OOXML structure:
   ```xml
   <w:ins w:id="1" w:author="John" w:date="2024-01-01">
     <w:r>
       <w:rPr>
         <w:b/>
         <w:i/>
       </w:rPr>
       <w:t>inserted text</w:t>
     </w:r>
   </w:ins>
   ```

   ---

   ## 5. Raw Styles Storage: Lossless Round-Tripping

   The system preserves OOXML that TipTap can't represent using an invisible storage node.

   ### Extraction (tiptap_converter.py:297-343)

   During conversion to TipTap, raw OOXML attributes are extracted from table nodes:

   ```python
   def _extract_and_store_raw_styles(self, content: list) -> dict | None:
       """Extract raw OOXML styles from content into a key-value store."""
       styles = {}

       def process_node(node: dict):
           if node.get("type") == "table":
               attrs = node.get("attrs", {})
               table_id = attrs.get("id")
               if table_id:
                   # Extract table-level raw XML
                   if "rawTblPr" in attrs:
                       styles[f"table:{table_id}:tblPr"] = attrs.pop("rawTblPr")
                   if "rawTblGrid" in attrs:
                       styles[f"table:{table_id}:tblGrid"] = attrs.pop("rawTblGrid")

                   # Process rows and cells
                   for row_idx, row in enumerate(node.get("content", [])):
                       row_attrs = row.get("attrs", {})
                       if "rawXml" in row_attrs:
                           styles[f"table:{table_id}:row:{row_idx}"] = row_attrs.pop("rawXml")

                       for cell_idx, cell in enumerate(row.get("content", [])):
                           cell_attrs = cell.get("attrs", {})
                           if "rawXml" in cell_attrs:
                               styles[f"table:{table_id}:row:{row_idx}:cell:{cell_idx}"] = cell_attrs.pop("rawXml")
                           cell_attrs.pop("colwidth", None)
   ```

   Extracted styles are stored in an invisible `rawStylesStorage` node:
   ```json
   {
     "type": "rawStylesStorage",
     "attrs": {
       "data": "{\"table:id123:tblPr\": \"base64...\", ...}"
     }
   }
   ```

   ### Restoration (docx_exporter.py:121-180)

   On export, the storage node is found and styles are restored to their original locations before processing.

   ---

   ## 6. Complete Data Flow Diagram

   ```
   DOCX File
       │
       ├─→ docx_parser.parse_docx()
       │       │
       │       ├─→ parse_paragraph()
       │       │       │
       │       │       └─→ revisions_parser.get_text_with_revisions()
       │       │           ├─ Extract w:r elements
       │       │           ├─ Check w:rPr for w:b and w:i
       │       │           ├─ Detect w:ins and w:del
       │       │           └─ Return segments with {text, bold, italic, revision}
       │       │
       │       └─→ TextRun objects created
       │           {text, bold, italic, revision, comment_ids}
       │
       ├─→ tiptap_converter.to_tiptap()
       │       │
       │       └─→ _build_marks()
       │           ├─ bold: boolean → {"type": "bold"}
       │           ├─ italic: boolean → {"type": "italic"}
       │           ├─ revision: dict → {"type": "insertion"|"deletion", "attrs": {...}}
       │           └─ comments: list → {"type": "comment", "attrs": {...}}
       │
       ├─→ TipTap JSON with marks
       │   {
       │     "type": "text",
       │     "text": "content",
       │     "marks": [
       │       {"type": "bold"},
       │       {"type": "italic"},
       │       {"type": "insertion", "attrs": {...}}
       │     ]
       │   }
       │
       ├─→ docx_exporter.create_docx_from_tiptap()
       │       │
       │       └─→ _add_text_with_marks()
       │           ├─ Separate marks by type
       │           ├─ Apply basic marks: run.bold = True, run.italic = True
       │           └─ Create OOXML structure for track changes
       │
       └─→ DOCX File (round-tripped)
           ├─ <w:b/> and <w:i/> in rPr
           └─ <w:ins> and <w:del> wrapping runs
   ```

   ---

   ## 7. Current Limitations & Extension Points

   ### Not Currently Extracted

   These formatting properties exist in Word but are NOT extracted by the current system:

   | Property | Word XML | Location | Status |
   |----------|----------|----------|--------|
   | Font Family | `w:rFonts` | `w:rPr` | Not extracted |
   | Font Size | `w:sz` | `w:rPr` | Not extracted |
   | Font Color | `w:color` | `w:rPr` | Not extracted |
   | Background Color | `w:shd` | `w:rPr` | Not extracted |
   | Underline | `w:u` | `w:rPr` | Not extracted |
   | Strikethrough | `w:strike` | `w:rPr` | Not extracted |
   | Double Strikethrough | `w:dstrike` | `w:rPr` | Not extracted |
   | Superscript/Subscript | `w:vertAlign` | `w:rPr` | Not extracted |
   | Text Outline | `w:outline` | `w:rPr` | Not extracted |
   | Text Shadow | `w:shadow` | `w:rPr` | Not extracted |

   ### How to Extend

   To add support for new formatting properties like **font color**, follow this pattern:

   1. **Add to TextRun dataclass** (models.py):
      ```python
      @dataclass
      class TextRun:
          text: str
          bold: bool = False
          italic: bool = False
          color: Optional[str] = None  # NEW
          # ...
      ```

   2. **Extract in revisions_parser** (revisions_parser.py):
      ```python
      if tag == qn("w:r"):
          rPr = element.find(qn("w:rPr"))
          color = None
          if rPr is not None:
              color_elem = rPr.find(qn("w:color"))
              if color_elem is not None:
                  color = color_elem.get(qn("w:val"))
          # ...
          segments.append({
              "text": text,
              "bold": is_bold,
              "italic": is_italic,
              "color": color,  # NEW
              "revision": current_revision,
          })
      ```

   3. **Convert to marks in tiptap_converter** (tiptap_converter.py):
      ```python
      def _build_marks(self, run: TextRun) -> list[dict]:
          marks = []
          # ... existing marks ...
          if run.color:
              marks.append({"type": "color", "attrs": {"value": run.color}})
          return marks
      ```

   4. **Export in docx_exporter** (docx_exporter.py):
      ```python
      def _apply_basic_marks(self, run, marks: list) -> None:
          for mark in marks:
              # ... existing code ...
              elif mark.get("type") == "color":
                  color = mark.get("attrs", {}).get("value")
                  if color:
                      rPr = run._element.get_or_add_rPr()
                      color_elem = OxmlElement("w:color")
                      color_elem.set(qn("w:val"), color)
                      rPr.append(color_elem)
      ```

   ---

   ## 8. Key Infrastructure Already in Place

   ### 1. Segment Processing in revisions_parser.py
   - **Recursive element processing** that handles nested structures
   - **Merging logic** that combines adjacent segments with same formatting
   - **Easy to extend** with new XML element detection

   ### 2. Mark Building Pattern in tiptap_converter.py
   - **Single source of truth** in `_build_marks()`
   - **Type-safe marks** with attrs dictionaries
   - **No duplication** between different conversion paths

   ### 3. Raw Styles Storage
   - **Infrastructure** for preserving OOXML that doesn't fit TipTap's data model
   - **Key-value indexing** by element path: `table:id:row:idx:cell:idx`
   - **Can be extended** to store any complex formatting

   ### 4. Lossless Round-Tripping
   - **Extract during DOCX→TipTap** conversion
   - **Restore during TipTap→DOCX** export
   - **Works seamlessly** without disrupting TipTap's JSON schema

   ---

   ## 9. Summary: The Complete Pipeline

   | Stage | Location | Input | Process | Output |
   |-------|----------|-------|---------|--------|
   | **Parse** | docx_parser.py | DOCX file | Extract w:rPr properties (w:b, w:i) | TextRun objects |
   | **Segment** | revisions_parser.py | Paragraph elements | Recursively process, detect bold/italic | Segments with
    formatting |
   | **Merge** | revisions_parser.py | Segments | Combine adjacent with same formatting | Merged segments |
   | **Build Runs** | docx_parser.py | Segments | Create TextRun objects | List of TextRun |
   | **Convert** | tiptap_converter.py | TextRun objects | Apply _build_marks() | TipTap nodes with marks |
   | **Export** | docx_exporter.py | TipTap JSON | Process marks, create OOXML | DOCX file |

   ---

   ## Key Takeaways for Implementation

   1. **TextRun is extensible**: Add any new formatting property as a field
   2. **The extraction is recursive**: Handles nested structures automatically
   3. **Merging is based on formatting equality**: New properties need to be included in merge comparison
   4. **Marks are type-safe**: TipTap marks have `type` and optional `attrs`
   5. **Round-tripping is validated**: Raw OOXML preserved where JSON can't capture it
   6. **Infrastructure is production-ready**: Pattern works for any new formatting type
