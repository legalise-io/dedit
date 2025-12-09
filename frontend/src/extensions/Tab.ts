import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Tab extension for representing Word tab characters.
 *
 * In Word documents, tabs are represented as <w:tab/> elements.
 * They can carry styling (like dotted underlines for form fields)
 * which is preserved via the rawStyle mark.
 *
 * This is an inline node that renders as a tab character.
 */
export const Tab = Node.create({
  name: "tab",

  group: "inline",

  inline: true,

  selectable: false,

  atom: true,

  // Tabs can have marks (like rawStyle for underlines)
  marks: "_",

  parseHTML() {
    return [
      {
        tag: 'span[data-type="tab"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "tab",
        class: "word-tab",
        // Use a tab character for copy/paste and screen readers
        // The actual visual width comes from CSS
      }),
      "\t",
    ];
  },

  addKeyboardShortcuts() {
    return {
      // Allow inserting tabs with the Tab key (optional - can be removed if unwanted)
      // Tab: () => this.editor.commands.insertContent({ type: this.name }),
    };
  },
});

export default Tab;
