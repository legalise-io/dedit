import { Mark, mergeAttributes } from "@tiptap/core";

export interface CommentOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    comment: {
      setComment: (attributes: {
        commentId: string;
        author?: string;
        date?: string;
        text?: string;
      }) => ReturnType;
      unsetComment: () => ReturnType;
      removeComment: (commentId: string) => ReturnType;
    };
  }
}

export const Comment = Mark.create<CommentOptions>({
  name: "comment",

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-comment-id"),
        renderHTML: (attributes) => {
          if (!attributes.commentId) return {};
          return { "data-comment-id": attributes.commentId };
        },
      },
      author: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-comment-author"),
        renderHTML: (attributes) => {
          if (!attributes.author) return {};
          return { "data-comment-author": attributes.author };
        },
      },
      date: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-comment-date"),
        renderHTML: (attributes) => {
          if (!attributes.date) return {};
          return { "data-comment-date": attributes.date };
        },
      },
      text: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-comment-text"),
        renderHTML: (attributes) => {
          if (!attributes.text) return {};
          return { "data-comment-text": attributes.text };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-comment-id]",
      },
      {
        tag: "span.comment",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // Build tooltip text from author and comment text
    const tooltipParts: string[] = [];
    if (HTMLAttributes["data-comment-author"]) {
      tooltipParts.push(HTMLAttributes["data-comment-author"]);
    }
    if (HTMLAttributes["data-comment-text"]) {
      tooltipParts.push(HTMLAttributes["data-comment-text"]);
    }
    const tooltip =
      tooltipParts.length > 0 ? tooltipParts.join(": ") : "Comment";

    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: "comment-highlight",
        title: tooltip,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setComment:
        (attributes) =>
        ({ commands }) => {
          return commands.setMark(this.name, attributes);
        },
      unsetComment:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name);
        },
      removeComment:
        (commentId) =>
        ({ tr, state, dispatch }) => {
          // Remove a specific comment mark by ID
          const { doc } = state;
          let found = false;

          doc.descendants((node, pos) => {
            if (node.isText) {
              const marks = node.marks.filter(
                (mark) =>
                  mark.type.name === "comment" &&
                  mark.attrs.commentId === commentId,
              );
              if (marks.length > 0) {
                found = true;
                if (dispatch) {
                  marks.forEach((mark) => {
                    tr.removeMark(pos, pos + node.nodeSize, mark.type);
                  });
                }
              }
            }
          });

          return found;
        },
    };
  },
});

export default Comment;
