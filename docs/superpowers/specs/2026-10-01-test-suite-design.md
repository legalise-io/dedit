# Dedit review and test suite design

User intent: thoroughly review dedit as a fredit dependency, assess existing tests, and build a broader suite (explicitly confirmed on 2026-10-01).

Test public behavior using generated DOCX documents, real TipTap/ProseMirror transactions, React hook rendering, FastAPI TestClient, and isolated collaboration persistence. Test successful edits and conversions, failure handling, multi-author revision rules, accept/reject and undo, comments, search, styles, numbering, tables, and collaboration lifecycle. Network providers may be mocked for hook lifecycle tests; document conversion and editor transactions must run real code.

Preserve pre-existing dirty changes. Work in an isolated worktree with a snapshot of those changes; transfer only this task's changes after verification. Do not publish or commit existing work. Review findings should include reproductions, severity, file references, practical impact, and relevance to fredit. Confirm each defect with a failing regression test, then fix it. Enforce at least 70% production coverage per component. Test tooling should run from a clean checkout, have one root command and CI, and expose coverage gaps honestly. Existing private, ignored DOCX fixtures must be replaced by generated fixtures.

User subsequently expanded scope to include fixing every confirmed bug after demonstrating a failing test. A broader suite is a baseline, not proof of exhaustive browser/Word interoperability.
