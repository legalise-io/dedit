import { Mark, mergeAttributes } from "@tiptap/core";

export interface DeletionOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    deletion: {
      setDeletion: (attributes: {
        id: string;
        author: string;
        date?: string;
      }) => ReturnType;
      unsetDeletion: () => ReturnType;
      acceptDeletion: (id: string) => ReturnType;
      rejectDeletion: (id: string) => ReturnType;
    };
  }
}

export const Deletion = Mark.create<DeletionOptions>({
  name: "deletion",

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-deletion-id"),
        renderHTML: (attributes) => {
          if (!attributes.id) return {};
          return { "data-deletion-id": attributes.id };
        },
      },
      author: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-author"),
        renderHTML: (attributes) => {
          if (!attributes.author) return {};
          return { "data-author": attributes.author };
        },
      },
      date: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-date"),
        renderHTML: (attributes) => {
          if (!attributes.date) return {};
          return { "data-date": attributes.date };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "del[data-deletion-id]",
      },
      {
        tag: "span.deletion",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "del",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: "deletion",
        title: HTMLAttributes["data-author"]
          ? `Deleted by ${HTMLAttributes["data-author"]}`
          : "Deletion",
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setDeletion:
        (attributes) =>
        ({ commands }) => {
          return commands.setMark(this.name, attributes);
        },
      unsetDeletion:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name);
        },
      acceptDeletion:
        (id) =>
        ({ tr, state, dispatch }) => {
          // Accept deletion: remove the text entirely
          const { doc } = state;
          const ranges: { from: number; to: number }[] = [];

          // Mark this transaction so TrackChangesMode doesn't intercept it
          tr.setMeta("acceptReject", true);

          doc.descendants((node, pos) => {
            if (node.isText) {
              const marks = node.marks.filter(
                (mark) => mark.type.name === "deletion" && mark.attrs.id === id,
              );
              if (marks.length > 0) {
                ranges.push({ from: pos, to: pos + node.nodeSize });
              }
            }
          });

          if (ranges.length > 0 && dispatch) {
            // Delete in reverse order to preserve positions
            ranges.reverse().forEach(({ from, to }) => {
              tr.delete(from, to);
            });
            return true;
          }

          return false;
        },
      rejectDeletion:
        (id) =>
        ({ tr, state, dispatch }) => {
          // Reject deletion: remove the mark but keep the text
          const { doc } = state;
          let found = false;

          // Mark this transaction so TrackChangesMode doesn't intercept it
          tr.setMeta("acceptReject", true);

          doc.descendants((node, pos) => {
            if (node.isText) {
              const marks = node.marks.filter(
                (mark) => mark.type.name === "deletion" && mark.attrs.id === id,
              );
              if (marks.length > 0) {
                found = true;
                if (dispatch) {
                  tr.removeMark(pos, pos + node.nodeSize, this.type);
                }
              }
            }
          });

          return found;
        },
    };
  },
});

export default Deletion;
