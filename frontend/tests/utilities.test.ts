import { expect, test, vi } from "vitest";
import { createExportPayload, downloadBlob, exportToWord } from "../src/lib/utils/createExportPayload";
import { AUTHOR_COLORS, getAuthorColor, getAuthorColorStyles, getAuthorPrimaryColor } from "../src/lib/utils/authorColors";
import { computeDiff, groupTrackChanges } from "../src/lib/ai/diffUtils";
import { buildIndexedDocument, buildParagraphPositionMap, cleanPosToDocPos, findParagraphById, findParagraphWithPositionMap, getCleanTextFromNode, getCleanTextInRange, getPendingTrackChangesInScope, getPositionInfo } from "../src/lib/ai/documentUtils";
import { acceptAllChangesInParagraph, applyEditsAsTrackChanges } from "../src/lib/ai/applyEdits";
import { doc, makeEditor, para, rev, txt } from "./helpers";

test("payload supports comments, filenames and all template modes", () => {
  const content = doc(para(txt("body")));
  const comments = [{ id: "c1", author: "A", text: "Comment", date: "2025-01-01" }];
  expect(createExportPayload(content, comments)).toEqual({ tiptap: content, comments, template: "none", filename: "document.docx" });
  expect(createExportPayload(content, comments, { includeComments: false, template: { type: "original", documentId: "d1" }, filename: "name.docx" })).toMatchObject({ comments: [], document_id: "d1", filename: "name.docx" });
  expect(createExportPayload(content, [], { template: { type: "custom", templateId: "t1" } }).template_id).toBe("t1");
});

test("author colors are deterministic for empty, unicode and long names", () => {
  for (const author of ["", "Alice", "中文", "X".repeat(1000)]) {
    expect(AUTHOR_COLORS).toContain(getAuthorColor(author));
    expect(getAuthorColor(author)).toEqual(getAuthorColor(author));
    expect(getAuthorPrimaryColor(author)).toBe(getAuthorColor(author).primary);
    expect(getAuthorColorStyles(author)["--author-color-light"]).toBe(getAuthorColor(author).light);
  }
});

test("download creates and cleans up a temporary link and URL", () => {
  const revoke = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: revoke });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  downloadBlob(new Blob(["docx"]), "name.docx");
  expect(click).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledWith("blob:test");
  expect(document.querySelector("a[download]")).toBeNull();
});

test("export posts payload and downloads successful response", async () => {
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["docx"]) });
  vi.stubGlobal("fetch", fetch);
  await exportToWord("/export", doc(para(txt("body"))), []);
  expect(JSON.parse(fetch.mock.calls[0][1].body).filename).toBe("document.docx");
});

test.each([true, false])("export propagates JSON and non-JSON errors: %s", async jsonError => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => { if (jsonError) return { detail: "Broken" }; throw new Error("not JSON"); } }));
  await expect(exportToWord("/export", {}, [])).rejects.toThrow(jsonError ? "Broken" : "Export failed");
});

test.each([["", "new"], ["old", ""], ["same", "same"], ["one cat", "one dog"]])("diff reconstructs %j -> %j", (oldText, newText) => {
  const diff = computeDiff(oldText, newText);
  expect(diff.filter(d => d.type !== "insert").map(d => d.text).join("")).toBe(oldText);
  expect(diff.filter(d => d.type !== "delete").map(d => d.text).join("")).toBe(newText);
});

test("adjacent revisions are grouped without mutating input", () => {
  const changes = [
    { id: "d", type: "deletion" as const, text: "old", pos: 1, endPos: 4, author: "A", date: null, paragraphId: "p" },
    { id: "i", type: "insertion" as const, text: "new", pos: 4, endPos: 7, author: "A", date: null, paragraphId: "p" },
    { id: "i2", type: "insertion" as const, text: "later", pos: 10, endPos: 15, author: "B", date: null, paragraphId: "p" },
  ];
  expect(groupTrackChanges(changes)).toEqual([
    { deletionIds: ["d"], insertionIds: ["i"], deletedText: "old", insertedText: "new", author: "A" },
    { deletionIds: [], insertionIds: ["i2"], deletedText: "", insertedText: "later", author: "B" },
  ]);
  expect(groupTrackChanges([])).toEqual([]);
});

test("AI extraction excludes deletions and maps clean offsets", () => {
  const e = makeEditor(doc(para(txt("ab"), txt("OLD", rev("deletion")), txt("cd", rev("insertion", "i1")))));
  const node = e.state.doc.firstChild!;
  const map = buildParagraphPositionMap(node, 1);
  expect(map.cleanText).toBe("abcd");
  expect(cleanPosToDocPos(3, map)).toBe(7);
  expect(cleanPosToDocPos(4, map)).toBe(8);
  expect(getPositionInfo(1, map).docPos).toBe(2);
  expect(getPositionInfo(2, map).hasDeletedAfter).toBe(true);
  expect(getCleanTextFromNode(node)).toBe("abcd");
  expect(getCleanTextInRange(e, 2, 7)).toBe("bc");
  expect(buildIndexedDocument(e).document).toBe("[p1] abcd");
  expect(findParagraphById(e, "p1")!.text).toBe("abcd");
  expect(findParagraphWithPositionMap(e, "p1")!.positionMap.cleanText).toBe("abcd");
  expect(findParagraphById(e, "missing")).toBeNull();
  expect(getPendingTrackChangesInScope(e, 1, 8).map(c => c.type)).toEqual(["deletion", "insertion"]);
  const empty = buildParagraphPositionMap(e.schema.nodes.paragraph.create(), 5);
  expect(cleanPosToDocPos(0, empty)).toBe(5);
});

test.each(["hello world", "hello", "", "hello new world!"])("AI edits produce intended clean text %j and restore tracking settings", newText => {
  const e = makeEditor(doc(para(txt("hello world"))));
  const edits = applyEditsAsTrackChanges(e, [{ paragraphId: "p1", newText, reason: "test" }], "AI");
  expect(getCleanTextFromNode(e.state.doc.firstChild!)).toBe(newText);
  expect(e.storage.trackChangesMode.enabled).toBe(false);
  expect(e.storage.trackChangesMode.author).toBe("Alice");
  expect(edits.every(edit => edit.paragraphId === "p1")).toBe(true);
  acceptAllChangesInParagraph(e, "p1");
  expect(e.getText()).toBe(newText);
});

test("AI unknown paragraph and empty request are no-ops", () => {
  const e = makeEditor();
  expect(applyEditsAsTrackChanges(e, [], "AI")).toEqual([]);
  expect(applyEditsAsTrackChanges(e, [{ paragraphId: "missing", newText: "x" }], "AI")).toEqual([]);
  expect(e.getText()).toBe("hello");
});
