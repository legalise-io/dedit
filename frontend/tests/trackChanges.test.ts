import { describe, expect, test } from "vitest";
import { TextSelection } from "@tiptap/pm/state";
import { doc, makeEditor, para, rev, texts, txt } from "./helpers";

describe("tracked editing", () => {
  test("plain editing is unmarked when tracking is off", () => {
    const e = makeEditor();
    e.commands.insertContentAt(6, "!");
    expect(e.getText()).toBe("hello!");
    expect(texts(e).every(n => n.marks.length === 0)).toBe(true);
  });
  test("typing creates author and date attributed insertion", () => {
    const e = makeEditor(undefined, true);
    e.commands.insertContentAt(6, "!");
    const insertion = texts(e).find(n => n.text === "!")!.marks[0];
    expect(insertion.type).toBe("insertion");
    expect(insertion.attrs!.author).toBe("Alice");
    expect(Number.isNaN(Date.parse(String(insertion.attrs!.date)))).toBe(false);
    expect(insertion.attrs!.id).toBeTruthy();
  });
  test("deletion retains original text and formatting", () => {
    const e = makeEditor(doc(para(txt("hello", { type: "bold" }))), true);
    e.commands.deleteRange({ from: 1, to: 3 });
    expect(e.getText()).toBe("hello");
    expect(texts(e)[0].text).toBe("he");
    expect(texts(e)[0].marks.map(m => m.type)).toEqual(expect.arrayContaining(["bold", "deletion"]));
  });
  test("deleting own insertion removes it", () => {
    const e = makeEditor(doc(para(txt("new", rev("insertion")))), true);
    e.commands.deleteRange({ from: 1, to: 4 });
    expect(e.getText()).toBe("");
  });
  test("deleting another author's insertion attributes deletion to current author", () => {
    const e = makeEditor(doc(para(txt("new", rev("insertion", "i1", "Bob")))), true);
    e.commands.deleteRange({ from: 1, to: 4 });
    expect(e.getText()).toBe("new");
    expect(texts(e)[0].marks).toEqual([expect.objectContaining({ type: "deletion", attrs: expect.objectContaining({ author: "Alice" }) })]);
  });
  test("deleting deleted text keeps original deletion", () => {
    const e = makeEditor(doc(para(txt("old", rev("deletion", "d1", "Bob")))), true);
    e.commands.deleteRange({ from: 1, to: 4 });
    expect(texts(e)).toEqual([{ text: "old", marks: [rev("deletion", "d1", "Bob")] }]);
  });
  test("replacement marks new and old text separately", () => {
    const e = makeEditor(undefined, true);
    e.commands.insertContentAt({ from: 1, to: 6 }, "new");
    expect(texts(e).find(n => n.marks.some(m => m.type === "deletion"))?.text).toBe("hello");
    expect(texts(e).find(n => n.marks.some(m => m.type === "insertion"))?.text).toBe("new");
  });
  test("selection-only transactions do not create changes", () => {
    const e = makeEditor(undefined, true);
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2)));
    expect(texts(e)[0].marks).toEqual([]);
  });
  test("undo and redo restore tracked edits without adding extra revisions", () => {
    const e = makeEditor(undefined, true);
    e.commands.insertContentAt(6, "!");
    const edited = e.getJSON();
    expect(e.commands.undo()).toBe(true);
    expect(e.getText()).toBe("hello");
    expect(texts(e)[0].marks).toEqual([]);
    expect(e.commands.redo()).toBe(true);
    expect(e.getJSON()).toEqual(edited);
  });
  test("toggle and author commands affect subsequent edits", () => {
    const e = makeEditor();
    e.commands.toggleTrackChanges();
    e.commands.setTrackChangesAuthor("Bob");
    e.commands.insertContentAt(6, "!");
    expect(texts(e)[1].marks[0].attrs!.author).toBe("Bob");
    e.commands.disableTrackChanges();
    expect(e.storage.trackChangesMode.enabled).toBe(false);
  });
});

describe("accept/reject commands", () => {
  test.each([
    ["insertion", "acceptInsertion", "oldnew"],
    ["insertion", "rejectInsertion", "old"],
    ["deletion", "acceptDeletion", "old"],
    ["deletion", "rejectDeletion", "oldnew"],
  ] as const)("%s via %s", (kind, command, expected) => {
    const e = makeEditor(doc(para(txt("old"), txt("new", rev(kind)))), true);
    expect(e.commands[command]("r1")).toBe(true);
    expect(e.getText()).toBe(expected);
    expect(texts(e).flatMap(n => n.marks)).toEqual([]);
    expect(e.commands[command]("missing")).toBe(false);
  });
  test("split revision fragments are removed from end to start", () => {
    const e = makeEditor(doc(para(txt("A", rev("insertion")), txt("B"), txt("C", rev("insertion")))), true);
    e.commands.rejectInsertion("r1");
    expect(e.getText()).toBe("B");
  });
  test.each(["acceptFormatChange", "rejectFormatChange"] as const)("%s handles paragraph changes", command => {
    const p = para(txt("item"));
    p.attrs = { id: "p1", styleName: "New", numIlvl: 2, formatChange: { id: "f1", oldStyle: "Old", oldNumIlvl: 1 } };
    const e = makeEditor(doc(p));
    expect(e.commands[command]("f1")).toBe(true);
    expect(e.state.doc.firstChild!.attrs.formatChange).toBeNull();
    expect(e.state.doc.firstChild!.attrs.styleName).toBe(command === "acceptFormatChange" ? "New" : "Old");
    expect(e.commands[command]("absent")).toBe(false);
  });
});
