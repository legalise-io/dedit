import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach } from "vitest";
import { createDeditExtensions } from "../src/lib/extensions/createDeditExtensions";

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

export function makeEditor(content: JSONContent = doc(para(txt("hello"))), tracked = false) {
  const editor = new Editor({
    extensions: createDeditExtensions({ trackChangesEnabled: tracked, trackChangesAuthor: "Alice" }),
    content,
  });
  editors.push(editor);
  return editor;
}

export const txt = (text: string, ...marks: NonNullable<JSONContent["marks"]>): JSONContent => ({ type: "text", text, marks });
export const para = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", attrs: { id: "p1" }, content });
export const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });
export const rev = (type: "insertion" | "deletion", id = "r1", author = "Alice") => ({ type, attrs: { id, author, date: "2025-01-01T00:00:00Z" } });

export function texts(editor: Editor) {
  const result: { text: string; marks: { type: string; attrs?: Record<string, unknown> }[] }[] = [];
  editor.state.doc.descendants(node => {
    if (node.isText) result.push({ text: node.text!, marks: node.marks.map(mark => mark.toJSON()) });
  });
  return result;
}
