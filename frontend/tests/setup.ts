import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom has no layout; provide only the geometry ProseMirror needs to scroll.
if (typeof Range !== "undefined") {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  HTMLElement.prototype.scrollIntoView = () => {};
  HTMLElement.prototype.scrollTo = () => {};
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
