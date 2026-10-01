# Dedit review and test suite implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a thorough review and reproducible behavior tests across dedit's components.

**Architecture:** Generated DOCX fixtures and real editor transactions exercise production conversion/editing logic. Provider mocks isolate React lifecycle; persistence tests use disposable directories. Regression tests demonstrate each confirmed defect before its fix.

**Tech Stack:** pytest, pytest-cov, FastAPI TestClient, Vitest 2, jsdom, React Testing Library, Node test runner.

**Spec:** ../specs/2026-10-01-test-suite-design.md

## Global Constraints

- Preserve all existing uncommitted work; no publish or commit.
- Node >=18; Python >=3.11 for combined backend/converter tests.
- Tests must not require ignored private DOCX files or running external services.
- User steering: confirm each bug with a failing test, fix it, and enforce >=70% coverage for each production component.

## Review Focus

- Multi-step replacements must not lose or misattribute tracked text.
- Remote CRDT changes must not be tracked a second time by receiving clients.
- Structural paragraph edits must preserve paragraph properties with the correct paragraph.
- Switching collaboration documents must reset seeding state and dispose the old document.
- Invalid files and missing template IDs must fail without corrupting stored documents.

### Task 1: Python conversion and API suite

**Files:** tests/conftest.py, tests/test_conversion.py, tests/test_api.py, tests/test_regressions.py, docx2tiptap/tests/test_tabs.py, requirements-test.txt, pytest.ini.
**Interfaces:** Public parse_docx(bytes), to_tiptap(elements, comments, numbering), create_docx_from_tiptap(json, comments, template).
- [x] Add generated fixtures and assertions for text, formatting, headings, breaks, revisions, comments, tables, numbering, styles, template preservation and input immutability.
- [x] Add API upload/list/retrieve/export/template/CORS/validation tests using isolated storage.
- [x] Reproduce review defects with failing regression tests and fix confirmed defects; replace private tab fixture with a generated document.
- [x] Run `.venv-test/bin/python -m pytest --cov=docx2tiptap --cov=backend` and inspect results.

### Task 2: Editor and React suite

**Files:** frontend/tests/{editor,trackChanges,search,utilities,hooks,collaboration,regressions}.test.ts[x], frontend/vitest.config.ts, frontend/package.json.
**Interfaces:** createDeditExtensions, Editor commands, exported hooks and utilities.
- [x] Configure jsdom, coverage, test scripts and setup.
- [x] Test revision commands, author rules, undo/redo, comments, search/replace, raw attributes, AI mapping/diffs and exports using real editors.
- [x] Test hooks and collaboration lifecycle; confirm bugs with failing tests and fix them.
- [x] Run `npm test`, `npm run test:coverage`, `npm run typecheck`, `npm run build:lib`.

### Task 3: Collaboration persistence, automation and review

**Files:** collab-server/persistence.js, collab-server/persistence.test.js, collab-server/server.js, collab-server/package.json, Makefile, .github/workflows/tests.yml, docs/TESTING.md, docs/reviews/2026-10-01-dedit.md.
**Interfaces:** createPersistence(dataDir) exposes fetch/store callbacks, used by production server and tests.
- [x] Isolate persistence callbacks without changing existing behavior; test save/load/isolation/path handling.
- [x] Add root test/coverage commands and CI; document suite scope and coverage gates.
- [x] Write review with verified findings, original quality assessment, measured coverage and remaining limits.
- [x] Run all suites and package build; review final diff; transfer only task changes into ~/Code/dedit and remove clean temporary worktree.

## Completion

All implementation steps completed. Final measurements and limitations are recorded in ../../reviews/2026-10-01-dedit.md. The user expanded scope to regression-driven bug fixes and 70% coverage; no expected failures remain.
