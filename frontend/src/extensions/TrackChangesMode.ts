import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";

export interface TrackChangesModeOptions {
  enabled: boolean;
  author: string;
}

export interface TrackChangesModeStorage {
  enabled: boolean;
  author: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    trackChangesMode: {
      enableTrackChanges: () => ReturnType;
      disableTrackChanges: () => ReturnType;
      toggleTrackChanges: () => ReturnType;
      setTrackChangesAuthor: (author: string) => ReturnType;
    };
  }
}

export const trackChangesModePluginKey = new PluginKey("trackChangesMode");

/**
 * Generate a unique ID for a track change
 */
function generateChangeId(type: "ins" | "del"): string {
  return `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get current ISO date string
 */
function getCurrentDate(): string {
  return new Date().toISOString();
}

export const TrackChangesMode = Extension.create<
  TrackChangesModeOptions,
  TrackChangesModeStorage
>({
  name: "trackChangesMode",

  addOptions() {
    return {
      enabled: false,
      author: "Unknown Author",
    };
  },

  addStorage() {
    return {
      enabled: this.options.enabled,
      author: this.options.author,
    };
  },

  addCommands() {
    return {
      enableTrackChanges:
        () =>
        ({ editor }) => {
          this.storage.enabled = true;
          // Trigger a state update to notify React
          editor.view.dispatch(
            editor.state.tr.setMeta("trackChangesEnabled", true),
          );
          return true;
        },
      disableTrackChanges:
        () =>
        ({ editor }) => {
          this.storage.enabled = false;
          editor.view.dispatch(
            editor.state.tr.setMeta("trackChangesEnabled", false),
          );
          return true;
        },
      toggleTrackChanges:
        () =>
        ({ commands }) => {
          if (this.storage.enabled) {
            return commands.disableTrackChanges();
          } else {
            return commands.enableTrackChanges();
          }
        },
      setTrackChangesAuthor: (author: string) => () => {
        this.storage.author = author;
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const extension = this;

    return [
      new Plugin({
        key: trackChangesModePluginKey,

        appendTransaction(transactions, oldState, newState) {
          // Only process if track changes is enabled
          if (!extension.storage.enabled) {
            return null;
          }

          // Skip if no actual document changes
          const hasDocChanges = transactions.some((tr) => tr.docChanged);
          if (!hasDocChanges) {
            return null;
          }

          // Skip transactions that are from track changes itself (prevent infinite loop)
          if (transactions.some((tr) => tr.getMeta("trackChangesProcessed"))) {
            return null;
          }

          // Skip transactions from accept/reject operations
          if (transactions.some((tr) => tr.getMeta("acceptReject"))) {
            return null;
          }

          const author = extension.storage.author;
          const date = getCurrentDate();

          // Collect all changes first, then apply them
          // This avoids position corruption when processing multiple steps
          interface PendingChange {
            type: "deletion" | "insertion";
            // For deletions: position in newState where to insert the deleted text
            // For insertions: position range in newState to mark
            from: number;
            to: number;
            text: string;
          }

          const pendingChanges: PendingChange[] = [];

          // Process each transaction to collect changes
          for (const transaction of transactions) {
            if (!transaction.docChanged) continue;

            // We need to track position mapping through the steps
            // to correctly identify where in oldState each step's positions refer to
            let stepIndex = 0;
            for (const step of transaction.steps) {
              if (step instanceof ReplaceStep) {
                const { from, to } = step as ReplaceStep;
                const slice = (step as ReplaceStep).slice;

                // Map positions back through previous steps to get oldState positions
                // for reading deleted content
                let oldFrom = from;
                let oldTo = to;
                for (let i = 0; i < stepIndex; i++) {
                  const prevStep = transaction.steps[i];
                  const map = prevStep.getMap();
                  oldFrom = map.invert().map(oldFrom);
                  oldTo = map.invert().map(oldTo);
                }

                // Get the content that was deleted (from old state)
                let deletedContent = "";
                try {
                  deletedContent = oldState.doc.textBetween(
                    oldFrom,
                    oldTo,
                    "",
                    "",
                  );
                } catch {
                  // Position out of bounds, skip
                }

                // Get the content that was inserted
                let insertedText = "";
                slice.content.forEach((node) => {
                  if (node.isText) {
                    insertedText += node.text || "";
                  } else if (node.isBlock) {
                    node.content.forEach((child) => {
                      if (child.isText) {
                        insertedText += child.text || "";
                      }
                    });
                  }
                });

                // Map positions forward through steps AFTER the current one
                // to get the position in newState.
                // The step's `from` is relative to the doc state after previous steps,
                // so we only need to map through steps that come after this one.
                let mappedFrom = from;
                for (let i = stepIndex + 1; i < transaction.steps.length; i++) {
                  const laterStep = transaction.steps[i];
                  const map = laterStep.getMap();
                  mappedFrom = map.map(mappedFrom);
                }

                if (deletedContent && deletedContent.length > 0) {
                  pendingChanges.push({
                    type: "deletion",
                    from: mappedFrom,
                    to: mappedFrom,
                    text: deletedContent,
                  });
                }

                if (insertedText && insertedText.length > 0) {
                  // Check if this text already has an insertion mark
                  let hasInsertionMark = false;
                  try {
                    newState.doc.nodesBetween(
                      mappedFrom,
                      Math.min(
                        mappedFrom + insertedText.length,
                        newState.doc.content.size,
                      ),
                      (node) => {
                        if (
                          node.isText &&
                          node.marks.some((m) => m.type.name === "insertion")
                        ) {
                          hasInsertionMark = true;
                        }
                      },
                    );
                  } catch {
                    // Position issues, mark anyway
                  }

                  if (!hasInsertionMark) {
                    pendingChanges.push({
                      type: "insertion",
                      from: mappedFrom,
                      to: mappedFrom + insertedText.length,
                      text: insertedText,
                    });
                  }
                }
              }
              stepIndex++;
            }
          }

          if (pendingChanges.length === 0) {
            return null;
          }

          // Apply changes in reverse order (from end to start) to preserve positions
          pendingChanges.sort((a, b) => b.from - a.from);

          let tr = newState.tr;

          for (const change of pendingChanges) {
            if (change.type === "deletion") {
              const deletionMark = newState.schema.marks.deletion.create({
                id: generateChangeId("del"),
                author: author,
                date: date,
              });

              const textNode = newState.schema.text(change.text, [
                deletionMark,
              ]);

              const mappedPos = tr.mapping.map(change.from);
              tr = tr.insert(mappedPos, textNode);
            } else {
              const insertionMark = newState.schema.marks.insertion.create({
                id: generateChangeId("ins"),
                author: author,
                date: date,
              });

              const mappedFrom = tr.mapping.map(change.from);
              const mappedTo = tr.mapping.map(change.to);
              tr = tr.addMark(mappedFrom, mappedTo, insertionMark);
            }
          }

          tr.setMeta("trackChangesProcessed", true);
          return tr;
        },
      }),
    ];
  },
});

export default TrackChangesMode;
