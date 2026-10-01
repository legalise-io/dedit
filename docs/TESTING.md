# Testing dedit

## Run

Prerequisites: `uv`, Node 22 or newer, npm, and Make. `uv` installs Python 3.11 for the test environment.

```sh
make test-install
make test
make test-coverage
make check
make build
make check-package
```

`make test` runs Python, frontend, and collaboration suites. `make test-coverage` runs those suites with enforced coverage thresholds. `make check` checks both product TypeScript and test TypeScript. `make build` builds the demo and then the published library. `make check-package` loads both the ESM and CommonJS builds in separate Node processes and verifies the exported extension factory. Existing development and publish targets remain available.

For focused work:

```sh
.venv-test/bin/python -m pytest tests/test_regressions.py -q
npm --prefix frontend test -- tests/regressions.test.ts
npm --prefix frontend run test:watch
npm --prefix collab-server test
```

## Scope and assertions

- **DOCX converter:** Generated documents, text/Unicode/whitespace, bold/italic and explicit disabled formatting, headings, blank paragraphs, breaks and tabs, tracked insertions/deletions, comment anchors, tables and merges, nested tables, table styling, numbering and inherited styles, tracked paragraph formatting, raw XML, template headers/footers/layout, nested serialization, and input immutability. Assertions examine JSON, reopened DOCX files, and OOXML rather than byte snapshots.
- **HTTP API:** Isolated in-memory stores with FastAPI TestClient. Upload/list/retrieve, template lifecycle, original/custom exports, request validation, missing identifiers, invalid files, CORS, response types and filename handling.
- **Frontend:** Real TipTap editors and ProseMirror transactions. Revision attribution, own/other-author edits, accept/reject, undo/redo, multi-step replacements, multi-block paste, remote Yjs metadata, paragraph identity, numbering keyboard commands, persistent selections, comments, literal search/replace and navigation, AI text/position mapping and editing, exported React hooks and UI components. AI calls use deterministic response doubles; no API keys or network requests are needed.
- **Collaboration:** Hook tests mock the provider to exercise lifecycle and awareness callbacks. Separate integration tests start a real Hocuspocus server on an ephemeral port, synchronize two Yjs clients over WebSocket, restart the server, and verify exact persisted state. Persistence tests cover Unicode/punctuation isolation, safe legacy names, missing files, overwrites and failed writes.

All fixtures are generated. Tests do not require private Word documents, a running demo server, or external AI services. There are no expected failures, skipped bug tests, or coverage exclusions for defect locations.

## Coverage gates

Coverage includes unexecuted production modules; it does not count tests as production code.

| Component | Lines | Branches | Functions |
| --- | ---: | ---: | ---: |
| DOCX converter | ≥70% | ≥70% | not measured |
| HTTP backend | ≥70% | ≥70% | not measured |
| Frontend | ≥70% | ≥70% | ≥70% |
| Collaboration server | ≥70% | ≥70% | ≥70% |

Frontend statement coverage also has a 70% gate. Its denominator includes **all frontend runtime source**, including `App.tsx` and `main.tsx`. Exclusions are test files, type-only modules, barrel `index.ts` files and SVG toolbar icons. CSS and build tooling are outside runtime coverage. Python covers all `docx2tiptap` modules and `backend/main.py`; sample generators and packaging scripts are outside the denominator. Collaboration covers both production modules, including the CLI startup path.

Python JSON is written to `coverage.json`; `scripts/check_python_coverage.py` checks converter and backend separately. Frontend and collaboration HTML reports live under their respective `coverage/` directories. CI runs installation, types, coverage and both builds, and uploads reports.

## Limits

jsdom provides editor behavior and DOM assertions; geometry stubs do not validate layout, real browser selection, IME/composition, drag/drop, or visual output. The demo shell is included in coverage but has little direct interaction coverage. DOCX files are checked using python-docx and OOXML, not by automating Microsoft Word. Complex section layouts, Word comment replies and long-running concurrent editing remain candidates for dedicated compatibility tests. Coverage indicates executed code, not exhaustive correctness.

Tests intentionally exercise error paths, so application logs may print caught errors. Current tooling also emits a Starlette TestClient deprecation warning and a declaration-generator compiler-version warning; both test and build exit statuses pass.
