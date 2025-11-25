import { Mark, mergeAttributes } from "@tiptap/core";

export interface InsertionOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    insertion: {
      setInsertion: (attributes: {
        id: string;
        author: string;
        date?: string;
      }) => ReturnType;
      unsetInsertion: () => ReturnType;
      acceptInsertion: (id: string) => ReturnType;
      rejectInsertion: (id: string) => ReturnType;
    };
  }
}

export const Insertion = Mark.create<InsertionOptions>({
  name: "insertion",

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-insertion-id"),
        renderHTML: (attributes) => {
          if (!attributes.id) return {};
          return { "data-insertion-id": attributes.id };
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
        tag: "ins[data-insertion-id]",
      },
      {
        tag: "span.insertion",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "ins",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: "insertion",
        title: HTMLAttributes["data-author"]
          ? `Inserted by ${HTMLAttributes["data-author"]}`
          : "Insertion",
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setInsertion:
        (attributes) =>
        ({ commands }) => {
          return commands.setMark(this.name, attributes);
        },
      unsetInsertion:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name);
        },
      acceptInsertion:
        (id) =>
        ({ tr, state, dispatch }) => {
          // Accept insertion: remove the mark but keep the text
          const { doc } = state;
          let found = false;

          // Mark this transaction so TrackChangesMode doesn't intercept it
          tr.setMeta("acceptReject", true);

          doc.descendants((node, pos) => {
            if (node.isText) {
              const marks = node.marks.filter(
                (mark) =>
                  mark.type.name === "insertion" && mark.attrs.id === id,
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
      rejectInsertion:
        (id) =>
        ({ tr, state, dispatch }) => {
          // Reject insertion: remove the text entirely
          const { doc } = state;
          const ranges: { from: number; to: number }[] = [];

          // Mark this transaction so TrackChangesMode doesn't intercept it
          tr.setMeta("acceptReject", true);

          doc.descendants((node, pos) => {
            if (node.isText) {
              const marks = node.marks.filter(
                (mark) =>
                  mark.type.name === "insertion" && mark.attrs.id === id,
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
    };
  },
});

export default Insertion;
