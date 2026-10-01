import { expect, test, vi } from "vitest";
import { doc, makeEditor, para, txt } from "./helpers";

const numbered = (value: string, level = 0) => ({ ...para(txt(value)), attrs: { styleNumbering: "1.", numId: "9", numIlvl: level, styleName: "Level0" } });
const storage = { type: "rawStylesStorage", attrs: { data: JSON.stringify({ __style_numbering_map__: { style_to_num: {}, num_to_style: { "9": { "0": "Level0", "1": "Level1" } } } }) } };

test("numbered Enter continues sequence and Backspace removes numbering", () => {
  vi.useFakeTimers();
  try {
    const e = makeEditor(doc(numbered("first"), numbered("next"), storage));
    e.commands.setTextSelection(6);
    expect(e.commands.keyboardShortcut("Enter")).toBe(true);
    vi.runOnlyPendingTimers();
    expect(e.getJSON().content!.slice(0, 3).map(n => n.attrs!.styleNumbering)).toEqual(["1.", "2.", "3."]);
    e.commands.setTextSelection(1);
    e.commands.keyboardShortcut("Backspace");
    vi.runOnlyPendingTimers();
    expect(e.state.doc.firstChild!.attrs.numId).toBeNull();
    expect(e.state.doc.child(1).attrs.styleNumbering).toBe("1.");
  } finally { vi.useRealTimers(); }
});

test("numbered indentation tracks old style and level and can reject or accept", () => {
  vi.useFakeTimers();
  try {
    const e = makeEditor(doc(numbered("first"), numbered("child"), storage), true);
    e.commands.setTextSelection(8);
    e.commands.keyboardShortcut("Tab");
    vi.runOnlyPendingTimers();
    const attrs = e.state.doc.child(1).attrs;
    expect(attrs).toMatchObject({ numIlvl: 1, styleName: "Level1", styleNumbering: "1.1." });
    expect(attrs.formatChange).toMatchObject({ author: "Alice", oldStyle: "Level0", oldNumIlvl: 0 });
    expect(e.commands.rejectFormatChange(attrs.formatChange.id)).toBe(true);
    vi.runOnlyPendingTimers();
    expect(e.state.doc.child(1).attrs).toMatchObject({ numIlvl: 0, styleName: "Level0", styleNumbering: "2.", formatChange: null });
    e.commands.keyboardShortcut("Tab");
    vi.runOnlyPendingTimers();
    const id = e.state.doc.child(1).attrs.formatChange.id;
    expect(e.commands.acceptFormatChange(id)).toBe(true);
    e.commands.keyboardShortcut("Shift-Tab");
    vi.runOnlyPendingTimers();
    expect(e.state.doc.child(1).attrs.numIlvl).toBe(0);
    expect(e.commands.acceptFormatChange("missing")).toBe(false);
  } finally { vi.useRealTimers(); }
});

test("numbering cannot exceed Word's maximum level eight", () => {
  const e = makeEditor(doc(numbered("deep", 8)));
  e.commands.setTextSelection(2);
  e.commands.keyboardShortcut("Tab");
  expect(e.state.doc.firstChild!.attrs.numIlvl).toBe(8);
});

test("scheduled renumbering is safe after editor destruction", () => {
  vi.useFakeTimers();
  try {
    const e = makeEditor(doc(numbered("first")));
    e.commands.setTextSelection(2);
    e.commands.keyboardShortcut("Tab");
    e.destroy();
    expect(() => vi.runOnlyPendingTimers()).not.toThrow();
  } finally { vi.useRealTimers(); }
});
