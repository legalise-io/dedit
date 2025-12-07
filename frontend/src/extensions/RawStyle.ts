import { Mark } from "@tiptap/core";

/**
 * Invisible mark for preserving raw OOXML run properties (w:rPr).
 *
 * This mark carries base64-encoded w:rPr XML through TipTap editing
 * so that fonts, colors, and other formatting can be restored on export.
 * It does not render anything - it's purely for data preservation.
 */
export const RawStyle = Mark.create({
  name: "rawStyle",

  addAttributes() {
    return {
      rPr: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-raw-style]",
        getAttrs: (el) => {
          const element = el as HTMLElement;
          return { rPr: element.getAttribute("data-rpr") };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      {
        "data-raw-style": "",
        "data-rpr": HTMLAttributes.rPr,
        style: "display: contents;",
      },
      0,
    ];
  },
});

export default RawStyle;
