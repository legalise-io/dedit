import React from "react";
import { act, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useDocumentEditor } from "../src/lib/hooks/useDocumentEditor";
import { useComments } from "../src/lib/hooks/useComments";
import { useTrackChanges } from "../src/lib/hooks/useTrackChanges";
import { useChangeNavigation } from "../src/lib/hooks/useChangeNavigation";
import { useContextMenu } from "../src/lib/hooks/useContextMenu";
import { doc, makeEditor, para, rev, txt } from "./helpers";

test("document hook creates editor, changes content, toggles readOnly and destroys on unmount", async () => {
  const onChange = vi.fn();
  const initialContent = doc(para(txt("start")));
  const { result, rerender, unmount } = renderHook(({ readOnly }) => useDocumentEditor({ initialContent, onChange, readOnly }), { initialProps: { readOnly: false } });
  await waitFor(() => expect(result.current.isReady).toBe(true));
  act(() => result.current.setContent(doc(para(txt("changed")))));
  expect(result.current.editor!.getText()).toBe("changed");
  act(() => result.current.editor!.commands.insertContentAt(8, "!"));
  expect(onChange).toHaveBeenCalled();
  rerender({ readOnly: true });
  expect(result.current.editor!.isEditable).toBe(false);
  const editor = result.current.editor!;
  unmount();
  await waitFor(() => expect(editor.isDestroyed).toBe(true));
});

test("comments hook selection, callbacks, mark lookup, resolution and removal", () => {
  const e = makeEditor();
  const callbacks = { onAdd: vi.fn(), onReply: vi.fn(), onResolve: vi.fn(), onDelete: vi.fn() };
  const { result } = renderHook(() => useComments(e, { data: [{ id: "c1", author: "Alice", text: "Comment", date: "2025-01-01" }], ...callbacks }));
  expect(result.current.addComment("no selection")).toBeNull();
  act(() => e.commands.setTextSelection({ from: 1, to: 3 }));
  expect(result.current.getSelectedText()).toBe("he");
  let id: string | null = null;
  act(() => { id = result.current.addComment("New"); });
  expect(id).toBeTruthy();
  expect(callbacks.onAdd).toHaveBeenCalledWith({ from: 1, to: 3 }, "New");
  expect(result.current.hasCommentMark(id!)).toBe(true);
  expect(result.current.getCommentById("c1")!.text).toBe("Comment");
  act(() => e.commands.setTextSelection(2));
  expect(result.current.getCommentAtCursor()).toBe(id);
  act(() => result.current.resolveComment(id!));
  expect(result.current.hasCommentMark(id!)).toBe(false);
  result.current.replyToComment("c1", "Reply");
  result.current.deleteComment("c1");
  expect(callbacks.onReply).toHaveBeenCalledWith("c1", "Reply");
  expect(callbacks.onDelete).toHaveBeenCalledWith("c1");
});

test("hooks gracefully handle a missing editor", () => {
  const { result } = renderHook(() => ({ comments: useComments(null), changes: useTrackChanges(null) }));
  expect(result.current.comments.getSelection()).toBeNull();
  expect(result.current.comments.getSelectedText()).toBeNull();
  expect(result.current.comments.goToComment("x")).toBe(false);
  expect(result.current.comments.addCommentMark("x")).toBe(false);
  expect(result.current.comments.removeCommentMark("x")).toBe(false);
  expect(result.current.comments.hasCommentMark("x")).toBe(false);
  expect(result.current.comments.getCommentAtCursor()).toBeNull();
  expect(result.current.changes.changes).toEqual([]);
  result.current.changes.acceptAll();
  result.current.changes.rejectAll();
});

test("track changes hook aggregates split marks and accepts/rejects all", () => {
  const e = makeEditor(doc(para(txt("A", rev("insertion")), txt("B", rev("insertion"), { type: "bold" }), txt("C", rev("deletion", "d1")))));
  const onAccept = vi.fn();
  const { result, rerender } = renderHook(() => useTrackChanges(e, { onAccept }));
  expect(result.current.changes.map(c => c.text)).toEqual(["AB", "C"]);
  act(() => result.current.acceptAll());
  rerender();
  expect(e.getText()).toBe("AB");
  expect(onAccept).toHaveBeenCalledTimes(2);
  expect(result.current.changes).toEqual([]);
  act(() => result.current.setEnabled(true));
  rerender();
  expect(result.current.enabled).toBe(true);
  act(() => result.current.setAuthor("Bob"));
  rerender();
  expect(result.current.author).toBe("Bob");
  act(() => result.current.toggle());
  rerender();
  expect(result.current.enabled).toBe(false);
});

test("change navigation wraps, highlights and processes selection from end to start", () => {
  const e = makeEditor(doc(para(txt("A", rev("insertion")), txt("B", rev("deletion", "d1")))));
  const container = document.createElement("div");
  container.appendChild(e.view.dom);
  const changes = [
    { id: "r1", type: "insertion" as const, text: "A", from: 1, to: 2, author: "Alice", date: null },
    { id: "d1", type: "deletion" as const, text: "B", from: 2, to: 3, author: "Alice", date: null },
  ];
  const accept = vi.fn(), reject = vi.fn();
  const { result } = renderHook(() => useChangeNavigation({ editor: e, changes, containerRef: { current: container }, acceptChange: accept, rejectChange: reject }));
  act(() => result.current.goToNextChange());
  expect(result.current.currentChangeIndex).toBe(0);
  expect(container.querySelector("ins")!.classList.contains("selected-change")).toBe(true);
  act(() => result.current.goToPrevChange());
  expect(result.current.currentChangeIndex).toBe(1);
  act(() => result.current.acceptCurrentChange());
  expect(accept).toHaveBeenLastCalledWith("d1");
  act(() => result.current.rejectCurrentChange());
  expect(reject).toHaveBeenLastCalledWith("d1");
  act(() => e.commands.setTextSelection({ from: 1, to: 3 }));
  expect(result.current.getChangesInSelection()).toHaveLength(2);
  act(() => result.current.acceptChangesInSelection());
  expect(accept.mock.calls.slice(-2)).toEqual([["d1"], ["r1"]]);
  act(() => result.current.rejectChangesInSelection());
  expect(reject.mock.calls.slice(-2)).toEqual([["d1"], ["r1"]]);
});

test("context menu opens at pointer and closes on click and scroll", () => {
  const { result, rerender } = renderHook(({ enabled }) => useContextMenu(enabled), { initialProps: { enabled: true } });
  const event = { preventDefault: vi.fn(), clientX: 20, clientY: 30 } as unknown as React.MouseEvent;
  act(() => result.current.openContextMenu(event, true));
  expect(result.current.contextMenu).toEqual({ x: 20, y: 30, hasChangesInSelection: true });
  act(() => fireEvent.click(document));
  expect(result.current.contextMenu).toBeNull();
  act(() => result.current.openContextMenu(event, false));
  act(() => fireEvent.scroll(document));
  expect(result.current.contextMenu).toBeNull();
  rerender({ enabled: false });
  act(() => result.current.openContextMenu(event, false));
  expect(result.current.contextMenu).toBeNull();
});

test("equivalent inline initial content does not recreate the editor on rerender", async () => {
  const { result, rerender } = renderHook(() => useDocumentEditor({ initialContent: doc(para(txt("inline"))) }));
  await waitFor(() => expect(result.current.isReady).toBe(true));
  const editor = result.current.editor;
  rerender();
  expect(result.current.editor).toBe(editor);
});

test("delayed change navigation does not access a destroyed editor", () => {
  vi.useFakeTimers();
  try {
    const e = makeEditor(doc(para(txt("A", rev("insertion")))));
    const container = document.createElement("div");
    const changes = [{ id: "r1", type: "insertion" as const, text: "A", from: 1, to: 2, author: "Alice", date: null }];
    const { result } = renderHook(() => useChangeNavigation({ editor: e, changes, containerRef: { current: container }, acceptChange: vi.fn(), rejectChange: vi.fn() }));
    act(() => result.current.goToChange(0));
    e.destroy();
    expect(() => vi.runOnlyPendingTimers()).not.toThrow();
  } finally { vi.useRealTimers(); }
});
