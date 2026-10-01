import { expect, test } from "vitest";
import { ySyncPluginKey } from "y-prosemirror";
import { doc, makeEditor, para, rev, texts, txt } from "./helpers";
import { applyEditsAsTrackChanges } from "../src/lib/ai/applyEdits";
import { getCleanTextFromNode } from "../src/lib/ai/documentUtils";

test("remote Yjs transactions retain remote attribution", () => {
  const e = makeEditor(undefined, true);
  const mark = e.schema.marks.insertion.create({ id: "remote", author: "Bob" });
  const tr = e.state.tr.insert(6, e.schema.text("!", [mark]));
  tr.setMeta(ySyncPluginKey, { isChangeOrigin: true });
  e.view.dispatch(tr);
  expect(texts(e)[1].marks[0].attrs!.author).toBe("Bob");
  expect(texts(e)[1].marks[0].attrs!.id).toBe("remote");
});

test("multiple inserted blocks all receive insertion marks", () => {
  const e = makeEditor(undefined, true);
  e.commands.insertContentAt(6, [para(txt("one")), { ...para(txt("two")), attrs: { id: "p2" } }]);
  const inserted = texts(e).filter(n => n.text !== "hello");
  expect(inserted.map(n => n.text).join("")).toBe("onetwo");
  expect(inserted.every(n => n.marks.some(m => m.type === "insertion" && m.attrs!.author === "Alice"))).toBe(true);
});

test("multiple deletion fragments retain original order", () => {
  const e = makeEditor(doc(para(txt("a", rev("deletion", "d1", "Bob")), txt("b", rev("deletion", "d2", "Carol")))), true);
  e.commands.deleteRange({ from: 1, to: 3 });
  expect(e.getText()).toBe("ab");
  expect(texts(e).map(n => n.marks[0].attrs!.author)).toEqual(["Bob", "Carol"]);
});

test("split paragraph assigns unique stable IDs", async () => {
  const e = makeEditor();
  e.commands.setTextSelection(3);
  e.commands.splitBlock();
  await new Promise(resolve => setTimeout(resolve, 10));
  const ids: string[] = [];
  e.state.doc.forEach(n => ids.push(n.attrs.id));
  expect(new Set(ids).size).toBe(ids.length);
});

test("AI plain text containing markup is inserted literally", () => {
  const e = makeEditor();
  applyEditsAsTrackChanges(e, [{ paragraphId: "p1", newText: "hello <b>literal</b>" }], "AI");
  expect(getCleanTextFromNode(e.state.doc.firstChild!)).toBe("hello <b>literal</b>");
});

test("AI edit associates each operation with its own revision IDs", () => {
  const e = makeEditor(doc(para(txt("one cat and two dogs"))));
  const edits = applyEditsAsTrackChanges(e, [{ paragraphId: "p1", newText: "one fox and two birds" }], "AI");
  expect(edits).toHaveLength(2);
  for (const edit of edits) {
    const deletion = texts(e).find(n => n.marks.some(m => m.type === "deletion" && m.attrs!.id === edit.deletionId));
    const insertion = texts(e).find(n => n.marks.some(m => m.type === "insertion" && m.attrs!.id === edit.insertionId));
    expect(deletion!.text).toBe(edit.deletedText);
    expect(insertion!.text).toBe(edit.insertedText);
  }
});

test("multi-step editing uses the document before each step", () => {
  const e = makeEditor(doc(para(txt("abcdef"))), true);
  const tr = e.state.tr.insertText("X", 2).insertText("Y", 3).delete(5, 6);
  e.view.dispatch(tr);
  expect(getCleanTextFromNode(e.state.doc.firstChild!)).toBe("aXYbdef");
  expect(texts(e).filter(n => n.marks.some(m => m.type === "deletion")).map(n => n.text).join("")).toBe("c");
});

test.each(([
  [[2, 2, "X"], [5, 5, "YZ"], [8, 9, ""]],
  [[2, 2, "X"], [2, 3, ""]],
  [[1, 3, ""], [2, 4, ""], [2, 2, "Q"]],
  [[2, 4, "XY"], [3, 4, "Z"]],
] as [number, number, string][][]).map(operations => ({ operations })))("chained replacements preserve original deletions and final clean text: $operations", ({ operations }) => {
  const e = makeEditor(doc(para(txt("abcdef"))), true);
  const tr = e.state.tr;
  for (const [from, to, value] of operations) tr.insertText(value, from, to);
  const intended = tr.doc.textContent;
  e.view.dispatch(tr);
  expect(getCleanTextFromNode(e.state.doc.firstChild!)).toBe(intended);
});
