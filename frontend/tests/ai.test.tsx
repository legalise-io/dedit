import React from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { createEditModeHandler, createReviewModeHandler, getAvailableModes } from "../src/lib/ai/modes";
import { AIEditorProvider, useAIEditor, useAIEditorOptional } from "../src/context/AIEditorContext";
import { useAIChat } from "../src/hooks/ai/useAIChat";
import { useContextItems } from "../src/hooks/ai/useContextItems";
import { useAIEdits } from "../src/hooks/ai/useAIEdits";
import { useAIRecommendations } from "../src/hooks/ai/useAIRecommendations";
import type { AIEdit, ChatMessage, ModeContext, TrackChangeRecommendation } from "../src/lib/ai/types";
import { doc, makeEditor, para, rev, txt } from "./helpers";

beforeEach(() => localStorage.clear());
export const wrapper = ({ children }: { children: React.ReactNode }) => <AIEditorProvider>{children}</AIEditorProvider>;
export const edit: AIEdit = { id: "e1", paragraphId: "p1", deletedText: "old", insertedText: "new", deletionId: "d1", insertionId: "i1", status: "applied" };
export const rec: TrackChangeRecommendation = { id: "rec1", deletionIds: ["d1"], insertionIds: ["i1"], deletedText: "old", insertedText: "new", recommendation: "accept", reason: "Better", status: "pending", author: "Alice" };

const context = (): ModeContext => ({ prompt: "Improve", selectedText: null, hasSelection: false, paragraphs: [{ id: "p1", text: "body" }], trackChanges: [], groupedChanges: [{ deletionIds: ["d1"], insertionIds: ["i1"], deletedText: "old", insertedText: "new", author: "Alice" }], contextItems: [], editor: makeEditor() });

test("custom AI edit/review handlers receive document and change context", async () => {
  const onAIRequest = vi.fn().mockResolvedValue({ message: "Edited", edits: [{ paragraphId: "p1", newText: "better" }] });
  const onAIReviewRequest = vi.fn().mockResolvedValue({ message: "Reviewed", recommendations: [{ index: 0, recommendation: "accept", reason: "Better" }] });
  const deps = { config: { onAIRequest, onAIReviewRequest }, apiKey: null };
  const ctx = context();
  ctx.hasSelection = true;
  ctx.selectedText = "body";
  ctx.contextItems = [{ id: "file", type: "text", label: "Reference", content: "proof" }];
  expect((await createEditModeHandler(deps)(ctx)).edits![0].newText).toBe("better");
  expect(onAIRequest.mock.calls[0][0]).toMatchObject({ selection: { text: "body", hasSelection: true }, contextItems: ctx.contextItems });
  expect((await createReviewModeHandler(deps)(ctx)).recommendations![0].recommendation).toBe("accept");
  expect(onAIReviewRequest.mock.calls[0][0].changes[0].deletedText).toBe("old");
});

test.each(["edit", "review"] as const)("direct %s API success, invalid JSON, and request errors", async mode => {
  const handler = (mode === "edit" ? createEditModeHandler : createReviewModeHandler)({ config: {}, apiKey: "test-key" });
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ message: "Done", edits: [], recommendations: [] }) } }] }) });
  vi.stubGlobal("fetch", fetch);
  expect((await handler(context())).message).toBe("Done");
  const request = JSON.parse(fetch.mock.calls[0][1].body);
  expect(request.model).toBe("gpt-5-mini");
  expect(request.temperature).toBe(1);
  expect(request.response_format.json_schema.strict).toBe(true);
  fetch.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "plain response" } }] }) });
  expect((await handler(context())).message).toBe("plain response");
  fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: { message: "Denied" } }) });
  await expect(handler(context())).rejects.toThrow("Denied");
  fetch.mockResolvedValue({ ok: false, status: 503, json: async () => { throw new Error("non-JSON"); } });
  await expect(handler(context())).rejects.toThrow("503");
});

test("custom modes override built-in names", () => {
  const custom = { name: "review", description: "Custom", icon: "custom", handler: async () => ({ message: "custom" }) };
  expect(getAvailableModes([custom], { config: {}, apiKey: null })).toEqual([custom]);
  expect(getAvailableModes([], { config: {}, apiKey: null })[0].name).toBe("review");
});

test("chat state tracks edit/recommendation statuses and clears context", () => {
  const onClear = vi.fn();
  const { result } = renderHook(() => useAIChat({ onClearContextItems: onClear }));
  act(() => {
    result.current.addMessage({ role: "user", content: "hello" });
    result.current.addMessage({ role: "assistant", content: "Done", metadata: { edits: [edit], recommendations: [rec] } });
  });
  expect(result.current.messages[0].timestamp).toBeInstanceOf(Date);
  act(() => result.current.updateEditStatus("e1", "accepted"));
  expect(result.current.messages[1].metadata!.edits![0].status).toBe("accepted");
  act(() => result.current.updateEditStatusByTrackChangeId("i1", "rejected"));
  expect(result.current.messages[1].metadata!.edits![0].status).toBe("rejected");
  act(() => result.current.updateRecommendationStatus("rec1", "applied"));
  expect(result.current.messages[1].metadata!.recommendations![0].status).toBe("applied");
  act(() => result.current.clearMessages());
  expect(result.current.messages).toEqual([]);
  expect(onClear).toHaveBeenCalledOnce();
});

test("context items deduplicate, remove, resolve and recover from resolver errors", async () => {
  const item = { id: "ref", type: "text", label: "Reference", content: "body" };
  const resolver = vi.fn().mockResolvedValue([item]);
  const { result } = renderHook(() => useContextItems({ onResolveContextItems: resolver }));
  act(() => { result.current.addContextItem(item); result.current.addContextItem(item); });
  expect(result.current.contextItems).toEqual([item]);
  act(() => result.current.addContextItems([item, { ...item, id: "next" }]));
  expect(result.current.contextItems).toHaveLength(2);
  expect(await result.current.resolveContextItems({} as DataTransfer)).toEqual([item]);
  resolver.mockRejectedValue(new Error("Failed"));
  expect(await result.current.resolveContextItems({} as DataTransfer)).toEqual([]);
  act(() => result.current.removeContextItem("ref"));
  expect(result.current.contextItems[0].id).toBe("next");
  act(() => result.current.clearContextItems());
  expect(result.current.contextItems).toEqual([]);
});

test.each(["acceptEdit", "rejectEdit"] as const)("paired %s updates actual document and chat status", operation => {
  const e = makeEditor(doc(para(txt("old", rev("deletion", "d1")), txt("new", rev("insertion", "i1")))));
  const messages: ChatMessage[] = [{ id: "m", role: "assistant", content: "Done", timestamp: new Date(), metadata: { edits: [edit] } }];
  const update = vi.fn();
  const { result } = renderHook(() => useAIEdits({ editorRef: { current: e }, messages, updateEditStatus: update }));
  expect(result.current.getPendingEdits()).toEqual([edit]);
  expect(result.current.getNextEdit(edit)).toBeNull();
  result.current.scrollToEdit(edit);
  result.current.goToEditAndSelect(edit);
  result.current.scrollToEdit({ ...edit, insertionId: undefined, deletionId: undefined });
  act(() => result.current[operation](edit));
  expect(e.getText()).toBe(operation === "acceptEdit" ? "new" : "old");
  expect(update).toHaveBeenCalledWith("e1", operation === "acceptEdit" ? "accepted" : "rejected");
});

test.each(["accept", "reject", "leave_alone"] as const)("recommendation %s applies expected document decision", recommendation => {
  const e = makeEditor(doc(para(txt("old", rev("deletion", "d1")), txt("new", rev("insertion", "i1")))));
  const current = { ...rec, recommendation };
  const update = vi.fn();
  const messages: ChatMessage[] = [{ id: "m", role: "assistant", content: "Done", timestamp: new Date(), metadata: { recommendations: [current] } }];
  const { result } = renderHook(() => useAIRecommendations({ editorRef: { current: e }, messages, updateRecommendationStatus: update }));
  expect(result.current.getPendingRecommendations()).toEqual([current]);
  expect(result.current.getNextRecommendation(current)).toBeNull();
  result.current.goToRecommendation(current);
  act(() => result.current.applyRecommendation(current));
  expect(e.getText()).toBe(recommendation === "accept" ? "new" : recommendation === "reject" ? "old" : "oldnew");
  result.current.discardRecommendation(current);
  expect(update).toHaveBeenLastCalledWith("rec1", "discarded");
});

test("AI provider rejects missing editor and missing credentials", async () => {
  const { result } = renderHook(useAIEditor, { wrapper });
  await act(async () => result.current.sendPrompt("Edit"));
  expect(result.current.error).toBe("Editor not connected");
  act(() => result.current.setEditor(makeEditor()));
  await act(async () => result.current.sendPrompt("Edit"));
  expect(result.current.error).toContain("API key");
  act(() => result.current.setApiKey("test-key"));
  expect(localStorage.getItem("dedit-openai-api-key")).toBe("test-key");
  act(() => result.current.setApiKey(null));
  expect(localStorage.getItem("dedit-openai-api-key")).toBeNull();
});

test("AI provider applies custom edits and handles requests that fail", async () => {
  const e = makeEditor();
  const handler = vi.fn().mockResolvedValue({ message: "Changed", edits: [{ paragraphId: "p1", newText: "better" }] });
  const { result } = renderHook(useAIEditor, { wrapper });
  act(() => { result.current.setEditor(e); result.current.setConfig({ onAIRequest: handler }); });
  await act(async () => result.current.sendPrompt("Improve"));
  expect(result.current.isLoading).toBe(false);
  expect(result.current.messages).toHaveLength(2);
  expect(result.current.getPendingEdits()).toHaveLength(1);
  act(() => result.current.acceptEdit(result.current.getPendingEdits()[0]));
  expect(e.getText()).toBe("better");
  handler.mockRejectedValue(new Error("Offline"));
  await act(async () => result.current.sendPrompt("Again"));
  expect(result.current.error).toBe("Offline");
  expect(result.current.messages.at(-1)!.role).toBe("system");
});

test("AI review produces scoped recommendations and handles empty review", async () => {
  const e = makeEditor(doc(para(txt("new", rev("insertion", "i1")))));
  const { result } = renderHook(useAIEditor, { wrapper });
  act(() => { result.current.setEditor(e); result.current.setConfig({ onAIReviewRequest: async () => ({ message: "Reviewed", recommendations: [{ index: 0, recommendation: "accept", reason: "Good" }] }) }); });
  await act(async () => result.current.sendPrompt("Review", { mode: result.current.availableModes[0] }));
  expect(result.current.getPendingRecommendations()).toHaveLength(1);
  act(() => result.current.applyRecommendation(result.current.getPendingRecommendations()[0]));
  expect(e.getText()).toBe("new");
  await act(async () => result.current.sendPrompt("Review", { mode: result.current.availableModes[0] }));
  expect(result.current.messages.at(-1)!.content).toContain("No track changes");
});

test("optional AI context is null outside provider", () => {
  const { result } = renderHook(useAIEditorOptional);
  expect(result.current).toBeNull();
});

test("switching AI editors detaches subscriptions and immediately reads current selection", () => {
  const first = makeEditor(), second = makeEditor();
  second.commands.setTextSelection({ from: 1, to: 3 });
  const { result, unmount } = renderHook(useAIEditor, { wrapper });
  act(() => result.current.setEditor(first));
  const off = vi.spyOn(first, "off");
  act(() => result.current.setEditor(second));
  expect(result.current.selectionContext.text).toBe("he");
  expect(off).toHaveBeenCalledWith("selectionUpdate", expect.any(Function));
  const secondOff = vi.spyOn(second, "off");
  unmount();
  expect(secondOff).toHaveBeenCalledWith("transaction", expect.any(Function));
});

test("a context-item batch deduplicates repeated IDs within the batch", () => {
  const item = { id: "ref", type: "text", label: "Reference", content: "body" };
  const { result } = renderHook(() => useContextItems());
  act(() => result.current.addContextItems([item, item]));
  expect(result.current.contextItems).toEqual([item]);
});
