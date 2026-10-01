import { act, renderHook, waitFor } from "@testing-library/react";
import * as Y from "yjs";
import { beforeEach, expect, test, vi } from "vitest";
import { useCollaboration, generateUserColor, getUserColor } from "../src/lib/hooks/useCollaboration";
import { AUTHOR_COLORS } from "../src/lib/utils/authorColors";

type ProviderConfig = {
  onStatus: (event: { status: string }) => void;
  onSynced: () => void;
  onAwarenessChange: (event: { states: { user?: { name: string; color: string } }[] }) => void;
};
type TestProvider = { config: ProviderConfig; destroy: ReturnType<typeof vi.fn>; setAwarenessField: ReturnType<typeof vi.fn> };
const providers = vi.hoisted(() => [] as TestProvider[]);
vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: class {
    config: ProviderConfig;
    awareness = { getStates: () => new Map() };
    setAwarenessField = vi.fn();
    destroy = vi.fn();
    constructor(config: ProviderConfig) { this.config = config; providers.push(this); }
  },
}));
beforeEach(() => providers.splice(0));

const user = { name: "Alice", color: "#123456" };
const initialContent = { type: "doc", content: [{ type: "paragraph" }] };

test("provider sync, status, presence, seeding, user updates and cleanup", () => {
  const onStatusChange = vi.fn(), onAwarenessChange = vi.fn();
  const { result, rerender, unmount } = renderHook(({ name }) => useCollaboration({ serverUrl: "ws://test", documentName: "doc", user: { ...user, name }, initialContent, onStatusChange, onAwarenessChange }), { initialProps: { name: "Alice" } });
  const provider = providers[0];
  expect(result.current.isReady).toBe(false);
  act(() => provider.config.onStatus({ status: "connected" }));
  act(() => provider.config.onSynced());
  expect(result.current.isReady).toBe(true);
  expect(result.current.needsSeeding).toBe(true);
  expect(result.current.extensions.map(e => e.name)).toEqual(["collaboration", "collaborationCursor"]);
  act(() => provider.config.onAwarenessChange({ states: [{ user }, {}] }));
  expect(result.current.connectedUsers).toEqual([user]);
  expect(onAwarenessChange).toHaveBeenCalledWith([user]);
  act(() => result.current.markSeeded());
  expect(result.current.needsSeeding).toBe(false);
  rerender({ name: "Bob" });
  expect(provider.setAwarenessField).toHaveBeenLastCalledWith("user", { ...user, name: "Bob" });
  act(() => provider.config.onStatus({ status: "disconnected" }));
  expect(onStatusChange).toHaveBeenCalledWith("disconnected");
  unmount();
  expect(provider.destroy).toHaveBeenCalledOnce();
});

test("existing Yjs content does not need seeding", () => {
  const { result } = renderHook(() => useCollaboration({ serverUrl: "ws://test", documentName: "existing", user, initialContent }));
  const fragment = result.current.ydoc.getXmlFragment("default");
  // A Yjs element is enough to represent a previously persisted document.
  fragment.insert(0, [new Y.XmlElement("paragraph")]);
  act(() => providers[0].config.onSynced());
  expect(result.current.needsSeeding).toBe(false);
});

test("new document can seed after the previous document was seeded", async () => {
  const { result, rerender } = renderHook(({ documentName }) => useCollaboration({ serverUrl: "ws://test", documentName, user, initialContent }), { initialProps: { documentName: "first" } });
  act(() => providers[0].config.onSynced());
  act(() => result.current.markSeeded());
  const oldDoc = result.current.ydoc;
  rerender({ documentName: "second" });
  expect(providers[0].destroy).toHaveBeenCalledOnce();
  act(() => providers[1].config.onSynced());
  expect(result.current.ydoc).not.toBe(oldDoc);
  expect(result.current.needsSeeding).toBe(true);
  await waitFor(() => expect(oldDoc.isDestroyed).toBe(true));
});

test("color helpers use the shared palette", () => {
  expect(AUTHOR_COLORS.map(c => c.primary)).toContain(generateUserColor());
  expect(getUserColor("Alice")).toBe(getUserColor("Alice"));
});
