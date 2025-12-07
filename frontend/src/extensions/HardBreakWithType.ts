import HardBreak from "@tiptap/extension-hard-break";

/**
 * Extended HardBreak extension that supports page breaks and column breaks.
 *
 * In Word documents, breaks are represented as:
 * - Line break: <w:br/> (no type attribute)
 * - Page break: <w:br w:type="page"/>
 * - Column break: <w:br w:type="column"/>
 *
 * This extension preserves the break type for round-tripping.
 */
export const HardBreakWithType = HardBreak.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      breakType: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-break-type") || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.breakType) return {};
          return { "data-break-type": attributes.breakType };
        },
      },
    };
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    const breakType = HTMLAttributes["data-break-type"];

    // Render page breaks with a visible indicator
    if (breakType === "page") {
      return [
        "span",
        {
          ...HTMLAttributes,
          class: "page-break",
          contenteditable: "false",
        },
        ["br"],
      ];
    }

    // Regular line breaks
    return ["br", HTMLAttributes];
  },
});

export default HardBreakWithType;
