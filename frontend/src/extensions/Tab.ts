import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Legacy node for Word tab characters.
 *
 * docx2tiptap writes Word tabs (<w:tab/>) as "\t" inside text nodes, so their
 * marks (rawStyle, insertion, deletion) survive collaborative sync, which only
 * syncs marks on text. This node stays in the schema so documents saved with
 * tab nodes still load and export.
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
