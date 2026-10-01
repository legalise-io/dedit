import { expect, test } from "vitest";
import { doc, makeEditor, para, texts, txt } from "./helpers";

test("comments can be added, roundtripped through HTML, and removed", () => {
  const e = makeEditor();
  e.commands.setTextSelection({ from: 1, to: 3 });
  expect(e.commands.setComment({ commentId: "c1", author: "Alice", text: "Check", date: "2025-01-01" })).toBe(true);
  expect(e.getHTML()).toContain('data-comment-id="c1"');
  const copied = makeEditor();
  copied.commands.setContent(e.getHTML());
  expect(texts(copied)[0].marks[0].attrs!.commentId).toBe("c1");
  expect(e.commands.removeComment("c1")).toBe(true);
  expect(e.commands.removeComment("c1")).toBe(false);
  expect(texts(e).flatMap(n => n.marks)).toEqual([]);
});

test("storage and paragraph style survive HTML serialization", () => {
  const p = para(txt("body"));
  p.attrs = { id: "p1", styleName: "Custom", numId: "4", numIlvl: 1, styleNumbering: "1.1." };
  const storage = { type: "rawStylesStorage", attrs: { data: '{"key":"xml"}' } };
  const e = makeEditor(doc(p, storage));
  const copied = makeEditor();
  copied.commands.setContent(e.getHTML());
  expect(copied.state.doc.firstChild!.attrs).toMatchObject(p.attrs);
  expect(copied.state.doc.lastChild!.attrs.data).toBe(storage.attrs.data);
});

test("headings, hard breaks, legacy tabs, and tables can serialize", () => {
  const e = makeEditor(doc(
    { type: "heading", attrs: { id: "h1", level: 2, styleName: "Heading 2" }, content: [txt("Title")] },
    para(txt("a"), { type: "hardBreak", attrs: { breakType: "page" } }, { type: "tab" }),
    { type: "table", attrs: { id: "t1" }, content: [{ type: "tableRow", content: [{ type: "tableCell", content: [para(txt("Cell"))] }] }] },
  ));
  const html = e.getHTML();
  expect(html).toContain("<h2");
  expect(html).toContain("<table");
  const copied = makeEditor();
  copied.commands.setContent(html);
  expect(copied.state.doc.firstChild!.attrs.level).toBe(2);
  expect(copied.getText()).toContain("Cell");
});

test("persistent selection highlights text on blur and clears on focus", async () => {
  const e = makeEditor();
  await new Promise(resolve => setTimeout(resolve, 5));
  e.commands.setTextSelection({ from: 1, to: 4 });
  e.emit("blur", { editor: e, event: new FocusEvent("blur"), transaction: e.state.tr });
  expect(e.storage.persistentSelection.savedSelection).toEqual({ from: 1, to: 4 });
  expect(e.view.dom.querySelector(".persistent-selection")!.textContent).toBe("hel");
  e.emit("focus", { editor: e, event: new FocusEvent("focus"), transaction: e.state.tr });
  expect(e.view.dom.querySelector(".persistent-selection")).toBeNull();
  e.storage.persistentSelection.savedSelection = { from: 1, to: 1000 };
  e.view.dispatch(e.state.tr);
  expect(e.view.dom.querySelector(".persistent-selection")).toBeNull();
});
