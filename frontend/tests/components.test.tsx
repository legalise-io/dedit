import React, { createRef } from "react";
import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { DocumentEditor } from "../src/lib/DocumentEditor";
import { FindReplaceBar } from "../src/components/FindReplaceBar";
import { AIEditorProvider, useAIEditor } from "../src/context/AIEditorContext";
import { APIKeyInput } from "../src/components/ai/APIKeyInput";
import { AIChatPanel } from "../src/components/ai/AIChatPanel";
import { PromptInput } from "../src/components/ai/PromptInput";
import type { EditorHandle, ToolbarItem } from "../src/lib/types";
import { doc, makeEditor, para, rev, txt } from "./helpers";

beforeEach(() => localStorage.clear());
const wrapper = ({ children }: { children: React.ReactNode }) => <AIEditorProvider>{children}</AIEditorProvider>;

test("DocumentEditor imperative interface and toolbar decisions change real document", async () => {
  const ref = createRef<EditorHandle>();
  const onReady = vi.fn(), onChange = vi.fn();
  const toolbar: ToolbarItem[] = ["undo", "redo", "bold", "italic", "separator", "trackChangesToggle", "prevChange", "nextChange", "acceptChange", "rejectChange", "acceptAll", "rejectAll", "addRowBefore", "addRowAfter", "deleteRow", "findReplace", <span key="custom">Custom</span>];
  const initialContent = doc(para(txt("old", rev("deletion", "d1")), txt("new", rev("insertion", "i1"))));
  const view = render(<DocumentEditor ref={ref} initialContent={initialContent} onEditorReady={onReady} onChange={onChange} toolbar={toolbar} enableContextMenu className="host-editor" trackChanges={{ enabled: false, author: "Alice" }} />);
  await waitFor(() => expect(ref.current!.getEditor()).toBeTruthy());
  expect(onReady).toHaveBeenCalled();
  expect(ref.current!.getChanges()).toHaveLength(2);
  expect(view.container.firstChild).toHaveProperty("className", "document-editor host-editor");
  fireEvent.click(view.getByTitle("Next Change"));
  fireEvent.click(view.getByTitle("Accept Change"));
  expect(ref.current!.getEditor()!.getText()).toBe("new");
  act(() => ref.current!.rejectAllChanges());
  expect(ref.current!.getEditor()!.getText()).toBe("");
  act(() => ref.current!.setContent(doc(para(txt("body")))));
  expect(ref.current!.getContent().type).toBe("doc");
  expect(ref.current!.createExportPayload({ filename: "draft.docx" }).filename).toBe("draft.docx");
  fireEvent.click(view.getByTitle("Find & Replace (Ctrl+F)"));
  expect(view.getByPlaceholderText("Find")).toBeTruthy();
  act(() => ref.current!.setTrackChangesEnabled(true));
  act(() => ref.current!.setTrackChangesAuthor("Bob"));
  expect(ref.current!.getEditor()!.storage.trackChangesMode.author).toBe("Bob");
  fireEvent.contextMenu(view.container.querySelector(".document-editor-content") || view.container.querySelector(".tiptap")!, { clientX: 10, clientY: 20 });
  act(() => ref.current!.blur());
});

test("DocumentEditor controlled content and read-only updates", async () => {
  const ref = createRef<EditorHandle>();
  const view = render(<DocumentEditor ref={ref} content={doc(para(txt("first")))} readOnly />);
  await waitFor(() => expect(ref.current!.getEditor()).toBeTruthy());
  expect(ref.current!.getEditor()!.isEditable).toBe(false);
  view.rerender(<DocumentEditor ref={ref} content={doc(para(txt("second")))} readOnly={false} />);
  await waitFor(() => expect(ref.current!.getEditor()!.getText()).toBe("second"));
  expect(ref.current!.getEditor()!.isEditable).toBe(true);
});

test("find/replace bar edits content and supports navigation and closing", async () => {
  const e = makeEditor(doc(para(txt("cat cat"))));
  const onClose = vi.fn();
  const view = render(<FindReplaceBar editor={e} onClose={onClose} />);
  fireEvent.change(view.getByPlaceholderText("Find"), { target: { value: "cat" } });
  await waitFor(() => expect(e.storage.searchAndReplace.results).toHaveLength(2));
  fireEvent.click(view.getByTitle("Next (Enter)"));
  fireEvent.click(view.getByTitle("Previous (Shift+Enter)"));
  fireEvent.change(view.getByPlaceholderText("Replace"), { target: { value: "dog" } });
  fireEvent.click(view.getByText("Replace All"));
  expect(e.getText()).toBe("dog dog");
  fireEvent.keyDown(view.getByPlaceholderText("Find"), { key: "Escape" });
  expect(onClose).toHaveBeenCalled();
  view.unmount();
  expect(e.storage.searchAndReplace.searchTerm).toBe("");
});

test.each([false, true])("API key input saves, changes and masks a key; compact=%s", compact => {
  const view = render(<APIKeyInput compact={compact} />, { wrapper });
  fireEvent.change(view.getByPlaceholderText("sk-..."), { target: { value: "  sk-test-secret  " } });
  fireEvent.keyDown(view.getByPlaceholderText("sk-..."), { key: "Enter" });
  expect(localStorage.getItem("dedit-openai-api-key")).toBe("sk-test-secret");
  if (!compact) {
    fireEvent.click(view.getByTitle("Show key"));
    expect(view.getByText("sk-test-secret")).toBeTruthy();
    fireEvent.click(view.getByTitle("Hide key"));
    fireEvent.click(view.getByText("Clear"));
    expect(localStorage.getItem("dedit-openai-api-key")).toBeNull();
  } else {
    fireEvent.click(view.getByText("Change"));
    expect(view.getByPlaceholderText("sk-...")).toBeTruthy();
  }
});

test("AI chat displays editable decisions, reviews, loading, errors and clear action", async () => {
  const { result } = renderHook(useAIEditor, { wrapper });
  // Render the panel in the same provider using a small capture component.
  let state: ReturnType<typeof useAIEditor> | undefined;
  function Harness() { state = useAIEditor(); return <AIChatPanel />; }
  const view = render(<Harness />, { wrapper });
  const e = makeEditor(doc(para(txt("old", rev("deletion", "d1")), txt("new", rev("insertion", "i1")))));
  act(() => state!.setEditor(e));
  act(() => state!.addMessage({ role: "assistant", content: "Suggestions", metadata: {
    edits: [{ id: "e1", paragraphId: "p1", deletionId: "d1", insertionId: "i1", deletedText: "old", insertedText: "new", status: "applied" }, { id: "e2", paragraphId: "p1", deletedText: "", insertedText: "additional", status: "accepted" }],
    recommendations: [{ id: "r1", deletionIds: [], insertionIds: [], deletedText: "", insertedText: "new", recommendation: "leave_alone", reason: "Already good", status: "pending", author: "Alice" }],
  } }));
  expect(view.getByText("Suggestions")).toBeTruthy();
  fireEvent.click(view.getByTitle("Accept this change"));
  expect(e.getText()).toBe("new");
  act(() => { state!.setIsLoading(true); state!.setError("Offline"); });
  expect(view.getByText("Offline")).toBeTruthy();
  fireEvent.click(view.getByTitle("Clear chat history"));
  expect(state!.messages).toEqual([]);
  expect(result.current.messages).toEqual([]);
});

test("prompt input submits custom requests, completes slash commands and accepts dropped context", async () => {
  let state: ReturnType<typeof useAIEditor> | undefined;
  function Harness() { state = useAIEditor(); return <PromptInput />; }
  const view = render(<Harness />, { wrapper });
  const request = vi.fn().mockResolvedValue({ message: "Done", edits: [] });
  const item = { id: "ref", type: "text", label: "Reference", content: "proof" };
  act(() => { state!.setEditor(makeEditor()); state!.setConfig({ onAIRequest: request, onResolveContextItems: async () => [item] }); });
  const input = view.container.querySelector('[contenteditable="true"]')!;
  input.textContent = "Improve";
  fireEvent.input(input);
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  expect(input.textContent).toBe("");
  input.textContent = "/rev";
  fireEvent.input(input);
  expect(view.getByText("/review")).toBeTruthy();
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "ArrowUp" });
  fireEvent.keyDown(input, { key: "Tab" });
  expect(view.container.querySelector(".command-pill")).toBeTruthy();
  fireEvent.keyDown(input, { key: "Backspace" });
  expect(view.container.querySelector(".command-pill")).toBeNull();
  const drop = view.container.querySelector(".prompt-input")!;
  fireEvent.dragEnter(drop, { dataTransfer: {} });
  fireEvent.dragOver(drop, { dataTransfer: {} });
  fireEvent.drop(drop, { dataTransfer: {} });
  await waitFor(() => expect(state!.contextItems).toEqual([item]));
  fireEvent.click(view.getByTitle("Remove"));
  expect(state!.contextItems).toEqual([]);
});

test("tooltips render author safely and disappear on mouseout", async () => {
  vi.useFakeTimers();
  const e = makeEditor(doc(para(txt("new", rev("insertion", "i1", "<Alice>")))));
  document.body.appendChild(e.view.dom);
  const element = e.view.dom.querySelector("ins")!;
  fireEvent.mouseOver(element, { clientX: 10, clientY: 50 });
  expect(document.querySelector(".track-change-tooltip")!.textContent).toBe("<Alice>");
  fireEvent.mouseMove(element, { clientX: 20, clientY: 60 });
  fireEvent.mouseOut(element);
  vi.advanceTimersByTime(101);
  expect(document.querySelector(".track-change-tooltip")).toBeNull();
  vi.useRealTimers();
});
