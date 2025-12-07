import Heading from "@tiptap/extension-heading";

/**
 * Extended Heading extension that preserves style names for round-tripping.
 *
 * The styleName attribute allows custom Word heading styles (like "SH Title",
 * "SH2 LegalNB") to be preserved through TipTap editing and restored on export.
 */
export const HeadingWithStyle = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      styleName: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-style-name") || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.styleName) return {};
          return { "data-style-name": attributes.styleName };
        },
      },
    };
  },
});

export default HeadingWithStyle;
