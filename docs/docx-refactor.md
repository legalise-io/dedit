# docx2tiptap Library Refactoring Plan

> **Status:** COMPLETE
> **Created:** 2024-12-07
> **Last Updated:** 2024-12-07
> **Scope:** Moderate refactoring - fix issues, eliminate duplication, improve types, restructure files

---

## Table of Contents

1. [Overview](#overview)
2. [Design Decisions](#design-decisions)
3. [Current Architecture](#current-architecture)
4. [Target Architecture](#target-architecture)
5. [Implementation Phases](#implementation-phases)
6. [Detailed Task Breakdown](#detailed-task-breakdown)
7. [Known Limitations (Deferred)](#known-limitations-deferred)
8. [Removed Features](#removed-features)
9. [Progress Tracking](#progress-tracking)
10. [Rollback Plan](#rollback-plan)

---

## Overview

### Goals

1. **Correctness** - Fix global state issues that cause thread-safety problems
2. **Maintainability** - Eliminate code duplication, split large files
3. **Type Safety** - Add TypedDicts for main data shapes
4. **Clarity** - Remove dead code, make exception handling specific

### Constraints

- **Public API must be preserved exactly** - No changes to function signatures in `__init__.py`
- **No test suite** - Extra care required; manual verification needed
- **Logging unchanged** - Keep current minimal approach (single `print()` statement)

### Files in Scope

| File | Lines | Action |
|------|-------|--------|
| `docx_parser.py` | 916 | Split into multiple files |
| `tiptap_converter.py` | 520 | Refactor to class, eliminate duplication |
| `docx_exporter.py` | 847 | Refactor to class, extract helpers |
| `comments_parser.py` | 279 | Minor cleanup |
| `revisions_parser.py` | 266 | Remove dead code |
| `__init__.py` | 12 | Update imports (preserve exports) |

---

## Design Decisions

These decisions were made before implementation began:

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | Refactoring scope | Moderate | Balance between improvement and risk |
| 2 | Public API changes | Preserve exactly | Avoid breaking consumers |
| 3 | Global `_comments_lookup` | Convert to class | Thread-safe, testable |
| 4 | Global `_revision_id_counter` | Convert to class | Thread-safe, testable |
| 5 | Duplicate conversion logic | Eliminate dict-based path | Single source of truth via dataclasses |
| 6 | Dead/incomplete code | Remove and document | Clean codebase |
| 7 | File structure | Split large files | Reasonable file sizes (~300 lines target) |
| 8 | Exception handling | Make specific | Better debugging |
| 9 | Logging | Keep as-is | Defer for future |
| 10 | Type safety | Moderate (TypedDicts) | Improved IDE support |
| 11 | Testing | None currently | Manual verification |
| 12 | Comment mapping bug | Document as limitation | Defer fix |

---

## Current Architecture

### File Structure (Before)

```
docx2tiptap/src/docx2tiptap/
├── __init__.py              (12 lines)
├── docx_parser.py           (916 lines) <- TOO LARGE
├── tiptap_converter.py      (520 lines)
├── docx_exporter.py         (847 lines) <- TOO LARGE
├── comments_parser.py       (279 lines)
└── revisions_parser.py      (266 lines)
```

### Problems Identified

#### 1. Global State (Critical)

```python
# tiptap_converter.py:16 - Thread-unsafe
_comments_lookup: dict = {}

# docx_exporter.py:24-25 - Thread-unsafe
_revision_id_counter = 0
```

#### 2. Code Duplication (High)

| Location A | Location B | Duplicated Logic |
|------------|------------|------------------|
| `text_run_to_tiptap()` (19-73) | `convert_dict_element()` paragraph branch (234-311) | Mark building (bold, italic, revision, comment) |
| `table_to_tiptap()` (146-229) | `convert_dict_element()` table branch (313-388) | Table/row/cell construction |
| `_base64_to_element()` in docx_parser.py | `_base64_to_element()` in docx_exporter.py | Identical function |

#### 3. Dead Code

| Item | Location | Status |
|------|----------|--------|
| `Revision` dataclass | revisions_parser.py:23-33 | Defined but return value ignored |
| `find_comment_ranges_in_paragraph()` | comments_parser.py:130-183 | Never called |
| `_process_comment_replies()` | comments_parser.py:101-127 | Stub that does nothing |

#### 4. God Functions

| Function | Location | Lines | Issues |
|----------|----------|-------|--------|
| `process_table()` | docx_exporter.py:492-618 | 126 | Does 8+ distinct things |
| `NumberingTracker` | docx_parser.py:142-395 | 254 | Could be separate file |

#### 5. Broad Exception Catches

```python
# docx_exporter.py:613
except Exception:
    pass  # Too broad

# docx_exporter.py:845
except Exception as e:
    print(f"Warning: ...")  # Too broad
```

#### 6. Magic Numbers

```python
for _ in range(10):  # Max inheritance depth
self.counters[num_id] = [0] * 10  # Max list levels
```

---

## Target Architecture

### File Structure (After)

```
docx2tiptap/src/docx2tiptap/
├── __init__.py              (unchanged exports)
├── models.py                (NEW - ~150 lines) - All dataclasses
├── utils.py                 (NEW - ~50 lines) - Shared utilities
├── constants.py             (NEW - ~20 lines) - Magic numbers
├── numbering.py             (NEW - ~280 lines) - NumberingTracker class
├── docx_parser.py           (REDUCED - ~400 lines) - Parsing only
├── tiptap_converter.py      (REFACTORED - ~350 lines) - TipTapConverter class
├── docx_exporter.py         (REFACTORED - ~500 lines) - DocxExporter class
├── comments_parser.py       (CLEANED - ~200 lines) - Remove dead code
└── revisions_parser.py      (CLEANED - ~200 lines) - Remove dead code
```

### New Class Designs

#### TipTapConverter Class

```python
class TipTapConverter:
    """Converts parsed DOCX elements to TipTap JSON."""

    def __init__(self, comments: dict[str, Comment] | None = None):
        self._comments = comments or {}

    def convert(self, elements: list) -> dict:
        """Main entry point - returns TipTap document."""
        ...

    def _text_run_to_node(self, run: TextRun) -> dict:
        ...

    def _paragraph_to_node(self, para: Paragraph) -> dict:
        ...

    def _table_to_node(self, table: Table) -> dict:
        ...

    def _section_to_node(self, section: Section) -> dict:
        ...

    def _build_marks(self, run: TextRun) -> list[dict]:
        """Shared mark-building logic."""
        ...
```

#### DocxExporter Class

```python
class DocxExporter:
    """Exports TipTap JSON to DOCX format."""

    def __init__(self, comments: list[dict] | None = None,
                 template_bytes: bytes | None = None):
        self._comments = {c["id"]: c for c in (comments or [])}
        self._template_bytes = template_bytes
        self._revision_id = 0
        self._comment_runs_map: dict[str, list] = {}

    def export(self, tiptap_json: dict) -> BytesIO:
        """Main entry point - returns DOCX bytes."""
        ...

    def _next_revision_id(self) -> str:
        self._revision_id += 1
        return str(self._revision_id)
```

### Type Definitions (models.py)

```python
from typing import TypedDict, Literal

class RevisionInfo(TypedDict, total=False):
    type: Literal["insertion", "deletion"]
    id: str
    author: str
    date: str | None

class MarkDict(TypedDict, total=False):
    type: str
    attrs: dict

class TipTapTextNode(TypedDict, total=False):
    type: Literal["text"]
    text: str
    marks: list[MarkDict]

class TipTapNode(TypedDict, total=False):
    type: str
    attrs: dict
    content: list["TipTapNode"]
```

---

## Implementation Phases

### Phase 1: Setup & Utilities (Low Risk)
Create new files, move shared code. No behavior changes.

### Phase 2: Models Extraction (Low Risk)
Move dataclasses to models.py. Update imports.

### Phase 3: Dead Code Removal (Low Risk)
Remove unused code. Document what was removed.

### Phase 4: TipTapConverter Class (Medium Risk)
Convert module to class. Eliminate dict-based duplication.

### Phase 5: DocxExporter Class (Medium Risk)
Convert module to class. Extract helper functions.

### Phase 6: File Splits (Low Risk)
Split docx_parser.py. Move NumberingTracker.

### Phase 7: Type Improvements (Low Risk)
Add TypedDicts. Make exceptions specific.

### Phase 8: Final Cleanup (Low Risk)
Magic numbers to constants. Final review.

---

## Detailed Task Breakdown

### Phase 1: Setup & Utilities

- [ ] **1.1** Create `utils.py` with shared `_base64_to_element()` and `_element_to_base64()`
- [ ] **1.2** Create `constants.py` with `MAX_STYLE_INHERITANCE_DEPTH = 10` and `MAX_LIST_NESTING_LEVELS = 10`
- [ ] **1.3** Update imports in `docx_parser.py` to use utils
- [ ] **1.4** Update imports in `docx_exporter.py` to use utils
- [ ] **1.5** Verify no behavior change (manual test)

### Phase 2: Models Extraction

- [ ] **2.1** Create `models.py` with all dataclasses from `docx_parser.py`:
  - `TextRun`
  - `Paragraph`
  - `BorderStyle`
  - `CellBorders`
  - `CellStyle`
  - `TableStyle`
  - `TableCell`
  - `TableRow`
  - `Table`
  - `Section`
- [ ] **2.2** Add `Comment` dataclass from `comments_parser.py`
- [ ] **2.3** Add TypedDict definitions:
  - `RevisionInfo`
  - `MarkDict`
  - `TipTapTextNode`
  - `TipTapNode`
- [ ] **2.4** Update all imports across files
- [ ] **2.5** Verify no behavior change

### Phase 3: Dead Code Removal

- [ ] **3.1** Remove `Revision` dataclass from `revisions_parser.py` (unused)
- [ ] **3.2** Simplify `extract_revisions_from_paragraph()` to only return the map
- [ ] **3.3** Remove `find_comment_ranges_in_paragraph()` from `comments_parser.py`
- [ ] **3.4** Remove `_process_comment_replies()` stub from `comments_parser.py`
- [ ] **3.5** Remove call to `_process_comment_replies()` in `extract_comments_from_docx()`
- [ ] **3.6** Document removed features in this file (Section 9)
- [ ] **3.7** Verify no behavior change

### Phase 4: TipTapConverter Class

- [ ] **4.1** Create `TipTapConverter` class skeleton
- [ ] **4.2** Move `_comments_lookup` to instance variable `self._comments`
- [ ] **4.3** Convert `text_run_to_tiptap()` to `_text_run_to_node()` method
- [ ] **4.4** Convert `paragraph_to_tiptap()` to `_paragraph_to_node()` method
- [ ] **4.5** Convert `table_to_tiptap()` to `_table_to_node()` method
- [ ] **4.6** Create `_section_to_node()` method (direct conversion, not via dict)
- [ ] **4.7** Remove `convert_dict_element()` function entirely
- [ ] **4.8** Convert `_extract_and_store_raw_styles()` to method
- [ ] **4.9** Convert `_cell_style_to_tiptap_attrs()` to method
- [ ] **4.10** Update `to_tiptap()` to instantiate class and delegate
- [ ] **4.11** Move json import to top of file
- [ ] **4.12** Verify no behavior change

### Phase 5: DocxExporter Class

- [ ] **5.1** Create `DocxExporter` class skeleton
- [ ] **5.2** Move `_revision_id_counter` to instance variable
- [ ] **5.3** Convert `_next_revision_id()` to method
- [ ] **5.4** Move `comment_runs_map` to instance variable
- [ ] **5.5** Convert all `process_*` functions to methods
- [ ] **5.6** Extract `_calculate_table_dimensions()` from `process_table()`
- [ ] **5.7** Extract `_fill_table_cells()` from `process_table()`
- [ ] **5.8** Extract `_apply_table_merges()` from `process_table()`
- [ ] **5.9** Convert all helper functions to methods
- [ ] **5.10** Update `create_docx_from_tiptap()` to instantiate class and delegate
- [ ] **5.11** Make exception catches specific:
  - Line 613: `except Exception` → `except (ValueError, IndexError)`
  - Line 845: `except Exception` → `except (AttributeError, KeyError)`
- [ ] **5.12** Verify no behavior change

### Phase 6: File Splits

- [ ] **6.1** Create `numbering.py` with `NumberingTracker` class
- [ ] **6.2** Move `_border_style_to_dict()`, `_cell_borders_to_dict()`, `_cell_style_to_dict()`, `_table_style_to_dict()` to `serializers.py`
- [ ] **6.3** Move `elements_to_dict()` to `serializers.py`
- [ ] **6.4** Update imports in `docx_parser.py`
- [ ] **6.5** Update imports in `__init__.py` (preserve exports)
- [ ] **6.6** Verify no behavior change

### Phase 7: Type Improvements

- [ ] **7.1** Add return type hints to all public functions
- [ ] **7.2** Add parameter type hints where missing
- [ ] **7.3** Use `RevisionInfo` TypedDict in `TextRun.revision`
- [ ] **7.4** Add docstrings to new classes
- [ ] **7.5** Verify no behavior change

### Phase 8: Final Cleanup

- [ ] **8.1** Replace magic numbers with constants:
  - `docx_parser.py:197` → `MAX_STYLE_INHERITANCE_DEPTH`
  - `docx_parser.py:321` → `MAX_LIST_NESTING_LEVELS`
  - `docx_parser.py:331` → `MAX_LIST_NESTING_LEVELS`
- [ ] **8.2** Review all files for consistency
- [ ] **8.3** Update module docstrings
- [ ] **8.4** Final manual verification
- [ ] **8.5** Update this document with completion status

---

## Known Limitations (Deferred)

These issues were identified but deliberately not addressed in this refactoring:

### 1. Comment Mapping Uses Text Content as Key

**Location:** `docx_parser.py:411-415`

```python
comment_map = {}  # text -> [comment_ids]
for seg in comment_segments:
    if seg["comments"]:
        comment_map[seg["text"]] = seg["comments"]
```

**Problem:** If the same text (e.g., "the") appears multiple times with different comments, only the last mapping is preserved.

**Impact:** Comments may be incorrectly associated in documents with repeated text.

**Future Fix:** Use position-based mapping with character offsets instead of text content.

**Tracking:** Create issue when test infrastructure exists.

---

### 2. Nested Tables Flattened

**Location:** `tiptap_converter.py:158-171`

```python
elif isinstance(elem, Table):
    # Nested tables - Tiptap tables don't typically nest,
    # so we flatten to paragraphs with indication
    cell_content.append({
        "type": "paragraph",
        "content": [{"type": "text", "text": "[Nested table content]"}]
    })
```

**Problem:** Nested table content is lost and replaced with placeholder text.

**Impact:** Documents with nested tables lose data on round-trip.

**Future Fix:** Either support nested tables in TipTap or serialize nested table data for restoration.

---

### 3. Comment Replies Not Implemented

**Location:** Was `comments_parser.py:101-127` (now removed)

**Problem:** Word supports threaded comment replies; this library ignores them.

**Impact:** Reply comments appear as top-level comments without threading relationship.

**Future Fix:** Parse `commentsExtended.xml` and build parent-child relationships.

---

### 4. No Logging Infrastructure

**Location:** Single `print()` at `docx_exporter.py:847`

**Problem:** No structured logging for debugging or monitoring.

**Impact:** Hard to diagnose issues in production.

**Future Fix:** Add `logging.getLogger(__name__)` and replace print statements.

---

### 5. No Test Coverage

**Problem:** Library has no automated tests.

**Impact:** Refactoring carries risk of undetected regressions.

**Future Fix:** Add pytest test suite with fixtures for sample DOCX files.

---

### 6. Style Inheritance Limited to 10 Levels

**Location:** `docx_parser.py:197`

```python
for _ in range(10):  # Max 10 levels of inheritance
```

**Problem:** Deeply nested style inheritance (>10 levels) would not fully resolve.

**Impact:** Extremely rare in practice, but possible.

**Future Fix:** Use topological sort or recursive resolution with memoization.

---

## Removed Features

The following code was removed during this refactoring because it was unused or incomplete:

### 1. `Revision` Dataclass and `extract_revisions_from_paragraph()` Function

**Was at:** `revisions_parser.py:23-110`

```python
@dataclass
class Revision:
    """A tracked change (insertion or deletion)."""
    id: str
    revision_type: str  # 'insertion' or 'deletion'
    author: str
    date: Optional[str]
    paragraph_index: int = 0
    run_index: int = 0

def extract_revisions_from_paragraph(para_element, para_index) -> tuple[list[Revision], dict]:
    ...
```

**Reason for removal:** The `Revision` dataclass was created but the list of Revision objects was always discarded (note the `_` in `_, run_revision_map = extract_revisions_from_paragraph(...)`). Furthermore, `get_text_with_revisions()` doesn't actually use the map from `extract_revisions_from_paragraph` - it builds its own revision info directly by walking the XML tree.

**If you need this:** The revision information is extracted directly in `get_text_with_revisions()` which returns dicts with the same structure: `{'type': 'insertion'|'deletion', 'id': ..., 'author': ..., 'date': ...}`.

**Removed on:** 2024-12-07

---

### 2. `find_comment_ranges_in_paragraph()` Function

**Was at:** `comments_parser.py:113-166`

```python
def find_comment_ranges_in_paragraph(para_element, para_index: int) -> dict[str, dict]:
    """Find comment range markers in a paragraph."""
    ...
```

**Reason for removal:** Never called from anywhere in the codebase. The `get_text_with_comments()` function provides the same information in a more useful format.

**If you need this:** Use `get_text_with_comments()` instead, which returns segments with their associated comment IDs.

**Removed on:** 2024-12-07

---

### 3. `_process_comment_replies()` Function

**Was at:** `comments_parser.py:84-110`

```python
def _process_comment_replies(zf: zipfile.ZipFile, comments: dict[str, Comment]):
    """Process commentsExtended.xml to link reply comments to their parents."""
    try:
        extended_xml = zf.read("word/commentsExtended.xml")
        tree = etree.fromstring(extended_xml)
        w15_ns = "http://schemas.microsoft.com/office/word/2012/wordml"
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
```

**Reason for removal:** Was a stub that did nothing (just `pass` in the body). The call site in `extract_comments_from_docx()` has also been removed.

**If you need comment replies:** This feature needs full implementation. See "Known Limitations" section - it requires parsing `commentsExtended.xml` and building parent-child relationships via `paraId` mapping.

**Removed on:** 2024-12-07

---

## Progress Tracking

### Overall Status

| Phase | Status | Started | Completed |
|-------|--------|---------|-----------|
| Phase 1: Setup & Utilities | Complete | 2024-12-07 | 2024-12-07 |
| Phase 2: Models Extraction | Complete | 2024-12-07 | 2024-12-07 |
| Phase 3: Dead Code Removal | Complete | 2024-12-07 | 2024-12-07 |
| Phase 4: TipTapConverter Class | Complete | 2024-12-07 | 2024-12-07 |
| Phase 5: DocxExporter Class | Complete | 2024-12-07 | 2024-12-07 |
| Phase 6: File Splits | Complete | 2024-12-07 | 2024-12-07 |
| Phase 7: Type Improvements | Complete | 2024-12-07 | 2024-12-07 |
| Phase 8: Final Cleanup | Complete | 2024-12-07 | 2024-12-07 |

### Task Completion

```
Phase 1: [x] [x] [x] [x] [x]  (5/5) COMPLETE
Phase 2: [x] [x] [x] [x] [x]  (5/5) COMPLETE
Phase 3: [x] [x] [x] [x] [x] [x] [x]  (7/7) COMPLETE
Phase 4: [x] [x] [x] [x] [x] [x] [x] [x] [x] [x] [x] [x]  (12/12) COMPLETE
Phase 5: [x] [x] [x] [x] [x] [x] [x] [x] [x] [x] [x] [x]  (12/12) COMPLETE
Phase 6: [x] [x] [x] [x] [x] [x]  (6/6) COMPLETE
Phase 7: [x] [x] [x] [x] [x]  (5/5) COMPLETE
Phase 8: [x] [x] [x] [x] [x]  (5/5) COMPLETE

Total: 57/57 tasks complete - REFACTORING COMPLETE
```

### Verification Checkpoints

After each phase, verify:

- [ ] All existing imports still work
- [ ] `parse_docx()` returns same structure
- [ ] `to_tiptap()` returns same JSON
- [ ] `create_docx_from_tiptap()` produces valid DOCX
- [ ] No new Python warnings/errors

---

## Rollback Plan

If issues are discovered:

1. **Git history preserved** - Each phase should be a separate commit
2. **Commit message format:** `refactor(docx2tiptap): Phase N.X - description`
3. **Rollback command:** `git revert <commit-hash>` or `git reset --hard <commit-hash>`

### Commit Checkpoints

| Phase | Commit Message | Hash |
|-------|---------------|------|
| 1 | `refactor(docx2tiptap): Phase 1 - Setup utilities and constants` | TBD |
| 2 | `refactor(docx2tiptap): Phase 2 - Extract models to separate file` | TBD |
| 3 | `refactor(docx2tiptap): Phase 3 - Remove dead code` | TBD |
| 4 | `refactor(docx2tiptap): Phase 4 - Convert TipTapConverter to class` | TBD |
| 5 | `refactor(docx2tiptap): Phase 5 - Convert DocxExporter to class` | TBD |
| 6 | `refactor(docx2tiptap): Phase 6 - Split large files` | TBD |
| 7 | `refactor(docx2tiptap): Phase 7 - Add type improvements` | TBD |
| 8 | `refactor(docx2tiptap): Phase 8 - Final cleanup` | TBD |

---

## Refactoring Results Summary

### Files Created
- `models.py` (206 lines) - All dataclasses and TypedDicts in one place
- `utils.py` (42 lines) - Shared base64 utilities
- `constants.py` (15 lines) - Magic numbers replaced with named constants
- `numbering.py` (274 lines) - `NumberingTracker` class extracted from docx_parser
- `serializers.py` (161 lines) - Dict conversion functions extracted

### Files Refactored
- `tiptap_converter.py`: Converted to `TipTapConverter` class, eliminated global state and code duplication
- `docx_exporter.py`: Converted to `DocxExporter` class, eliminated global revision counter
- `docx_parser.py`: Split into focused modules, reduced from 916 to 399 lines
- `revisions_parser.py`: Removed dead code (`Revision` dataclass, unused function)
- `comments_parser.py`: Removed dead code (stub function, unused function)

### Metrics
| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Total Lines | 2840 | 2630 | -7.4% |
| Largest File | 916 lines | 785 lines | -14% |
| Number of Files | 6 | 11 | +5 |
| Global State Variables | 2 | 0 | Eliminated |
| Duplicate Functions | 3 | 0 | Eliminated |
| Dead Code Items | 3 | 0 | Removed |

### Public API
**Unchanged** - All public exports remain identical:
- `parse_docx()`
- `to_tiptap()`
- `create_docx_from_tiptap()`
- `elements_to_dict()`
- `comments_to_dict()`

---

## Appendix: Original File Metrics

For reference, the original file sizes:

| File | Lines | Functions | Classes |
|------|-------|-----------|---------|
| `docx_parser.py` | 916 | 15 | 1 |
| `docx_exporter.py` | 847 | 18 | 0 |
| `tiptap_converter.py` | 520 | 7 | 0 |
| `comments_parser.py` | 279 | 5 | 1 |
| `revisions_parser.py` | 266 | 5 | 1 |
| `__init__.py` | 12 | 0 | 0 |
| **Total** | **2840** | **50** | **3** |

Target after refactoring: ~2600 lines across 10 files (reduction from dead code removal, slight increase from new structure).
