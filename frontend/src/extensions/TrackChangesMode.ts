import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
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

          // Skip undo/redo transactions - these should restore original state, not create new changes
          if (
            transactions.some(
              (tr) =>
                tr.getMeta("history$") ||
                tr.getMeta("undo") ||
                tr.getMeta("redo"),
            )
          ) {
            return null;
          }

          const author = extension.storage.author;
          const date = getCurrentDate();

          // Collect all changes first, then apply them
          // This avoids position corruption when processing multiple steps
          interface DeletedFragment {
            text: string;
            marks: readonly import("@tiptap/pm/model").Mark[];
          }

          interface PendingChange {
            type: "deletion" | "insertion" | "restore-deleted";
            // For deletions: position in newState where to insert the deleted text
            // For insertions: position range in newState to mark
            // For restore-deleted: position where to re-insert already-deleted text
            from: number;
            to: number;
            text: string;
            // For deletions: the original text fragments with their marks
            deletedFragments?: DeletedFragment[];
            // For restore-deleted: the original marks to preserve (including deletion mark)
            originalMarks?: readonly import("@tiptap/pm/model").Mark[];
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
                // Use assoc=-1 for 'from' and assoc=1 for 'to' to handle boundary cases correctly
                let oldFrom = from;
                let oldTo = to;
                for (let i = 0; i < stepIndex; i++) {
                  const prevStep = transaction.steps[i];
                  const map = prevStep.getMap();
                  oldFrom = map.invert().map(oldFrom, -1);
                  oldTo = map.invert().map(oldTo, 1);
                }

                // Get the content that was deleted (from old state), preserving marks
                const deletedFragments: DeletedFragment[] = [];
                // Track already-deleted text that needs to be restored
                const alreadyDeletedFragments: DeletedFragment[] = [];
                try {
                  // Collect text nodes with their marks, including paragraph breaks
                  let isFirstBlock = true;
                  oldState.doc.nodesBetween(oldFrom, oldTo, (node, pos) => {
                    // Add a newline fragment between block nodes (paragraphs, headings, etc.)
                    if (node.isBlock && node.isTextblock) {
                      if (!isFirstBlock) {
                        // Add newline before this block (except the first one)
                        deletedFragments.push({
                          text: "\n",
                          marks: [],
                        });
                      }
                      isFirstBlock = false;
                    }

                    if (node.isText && node.text) {
                      // Calculate the portion of this text node that's within our range
                      const nodeStart = pos;
                      const nodeEnd = pos + node.nodeSize;
                      const overlapStart = Math.max(nodeStart, oldFrom);
                      const overlapEnd = Math.min(nodeEnd, oldTo);

                      if (overlapStart < overlapEnd) {
                        const textStart = overlapStart - nodeStart;
                        const textEnd = overlapEnd - nodeStart;
                        const text = node.text.slice(textStart, textEnd);
                        if (text) {
                          // Check if this text has an insertion mark
                          const insertionMark = node.marks.find(
                            (m) => m.type.name === "insertion",
                          );
                          // Check if this text already has a deletion mark
                          const hasDeletionMark = node.marks.some(
                            (m) => m.type.name === "deletion",
                          );

                          if (insertionMark) {
                            // Text was inserted by someone
                            const insertionAuthor = insertionMark.attrs.author;
                            if (insertionAuthor === author) {
                              // My own insertion - just remove it (undo my work)
                              // Skip - don't collect for deletion
                            } else {
                              // Another author's insertion - mark as deletion in my color
                              // Remove the insertion mark, collect for deletion marking
                              const marksWithoutInsertion = node.marks.filter(
                                (m) => m.type.name !== "insertion",
                              );
                              deletedFragments.push({
                                text,
                                marks: marksWithoutInsertion,
                              });
                            }
                          } else if (hasDeletionMark) {
                            // Already deleted - collect to restore with original marks
                            alreadyDeletedFragments.push({
                              text,
                              marks: node.marks,
                            });
                          } else {
                            // Regular text - collect for deletion marking
                            deletedFragments.push({
                              text,
                              marks: node.marks,
                            });
                          }
                        }
                      }
                    }
                  });
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

                // Map 'from' position forward through steps AFTER the current one
                // to get the position in newState.
                let mappedFrom = from;
                for (let i = stepIndex + 1; i < transaction.steps.length; i++) {
                  const laterStep = transaction.steps[i];
                  const map = laterStep.getMap();
                  mappedFrom = map.map(mappedFrom);
                }

                // Only create a deletion if there are non-insertion fragments to delete
                // (text that was inserted and then deleted should just disappear)
                if (deletedFragments.length > 0) {
                  const nonInsertedText = deletedFragments
                    .map((f) => f.text)
                    .join("");
                  if (nonInsertedText.length > 0) {
                    // For deletions, insert the deleted text at the position where deletion started
                    // This is 'from' mapped through subsequent steps (not including current step,
                    // since the deletion step doesn't change the 'from' position)
                    pendingChanges.push({
                      type: "deletion",
                      from: mappedFrom,
                      to: mappedFrom,
                      text: nonInsertedText,
                      deletedFragments: deletedFragments,
                    });
                  }
                }

                // Handle already-deleted text - restore it (put it back with original marks)
                if (alreadyDeletedFragments.length > 0) {
                  for (const fragment of alreadyDeletedFragments) {
                    pendingChanges.push({
                      type: "restore-deleted",
                      from: mappedFrom,
                      to: mappedFrom,
                      text: fragment.text,
                      originalMarks: fragment.marks,
                    });
                  }
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

          // Track the cursor position - we need to restore it after inserting deleted text
          const originalSelection = newState.selection;
          let cursorPos = originalSelection.from;

          for (const change of pendingChanges) {
            if (change.type === "deletion") {
              const deletionMark = newState.schema.marks.deletion.create({
                id: generateChangeId("del"),
                author: author,
                date: date,
              });

              const mappedPos = tr.mapping.map(change.from);

              // If we have fragments with original marks, preserve them
              if (
                change.deletedFragments &&
                change.deletedFragments.length > 0
              ) {
                // Insert each fragment with its original marks plus the deletion mark
                // Insert in reverse order since we're inserting at the same position
                const fragments = [...change.deletedFragments].reverse();
                for (const fragment of fragments) {
                  // Combine original marks with deletion mark
                  const marks = [...fragment.marks, deletionMark];
                  const textNode = newState.schema.text(fragment.text, marks);
                  tr = tr.insert(mappedPos, textNode);
                }
              } else {
                // Fallback: just insert with deletion mark only
                const textNode = newState.schema.text(change.text, [
                  deletionMark,
                ]);
                tr = tr.insert(mappedPos, textNode);
              }

              // Don't let cursor move - it should stay to the LEFT of inserted deleted text
              // The insert pushes everything right, so we need to keep cursor at mappedPos
            } else if (change.type === "restore-deleted") {
              // Re-insert already-deleted text with its original marks (including deletion mark)
              const mappedPos = tr.mapping.map(change.from);
              const marks = change.originalMarks
                ? [...change.originalMarks]
                : [];
              const textNode = newState.schema.text(change.text, marks);
              tr = tr.insert(mappedPos, textNode);
              // Cursor will be positioned left of this via the mapping with assoc=-1 below
            } else {
              const insertionMark = newState.schema.marks.insertion.create({
                id: generateChangeId("ins"),
                author: author,
                date: date,
              });

              const mappedFrom = tr.mapping.map(change.from);
              const mappedTo = tr.mapping.map(change.to);

              // First, remove any deletion mark from this range
              // This handles the case where user types inside deleted text
              const deletionMarkType = newState.schema.marks.deletion;
              if (deletionMarkType) {
                tr = tr.removeMark(mappedFrom, mappedTo, deletionMarkType);
              }

              // Then add the insertion mark
              tr = tr.addMark(mappedFrom, mappedTo, insertionMark);
            }
          }

          // Restore cursor to where it was before we inserted deleted text
          // Use assoc=-1 to keep cursor to the left of any inserted content
          const mappedCursor = tr.mapping.map(cursorPos, -1);
          const $pos = tr.doc.resolve(mappedCursor);
          tr = tr.setSelection(TextSelection.create(tr.doc, $pos.pos));

          tr.setMeta("trackChangesProcessed", true);
          return tr;
        },
      }),
      // Tooltip plugin for showing author on hover
      new Plugin({
        key: new PluginKey("trackChangesTooltip"),
        view() {
          let tooltip: HTMLDivElement | null = null;
          let hideTimeout: ReturnType<typeof setTimeout> | null = null;

          const showTooltip = (author: string, x: number, y: number) => {
            if (!tooltip) {
              tooltip = document.createElement("div");
              tooltip.className = "track-change-tooltip";
              document.body.appendChild(tooltip);
            }
            tooltip.textContent = author;
            tooltip.style.left = `${x + 15}px`;
            tooltip.style.top = `${y - 45}px`;
          };

          const hideTooltip = () => {
            if (tooltip) {
              tooltip.remove();
              tooltip = null;
            }
          };

          const handleMouseOver = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            const trackChange = target.closest(
              ".insertion, .deletion",
            ) as HTMLElement;

            if (trackChange) {
              const author = trackChange.getAttribute("data-author");
              if (author) {
                if (hideTimeout) {
                  clearTimeout(hideTimeout);
                  hideTimeout = null;
                }
                showTooltip(author, event.clientX, event.clientY);
              }
            }
          };

          const handleMouseOut = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            const trackChange = target.closest(".insertion, .deletion");

            if (trackChange) {
              hideTimeout = setTimeout(hideTooltip, 100);
            }
          };

          const handleMouseMove = (event: MouseEvent) => {
            if (tooltip) {
              tooltip.style.left = `${event.clientX + 15}px`;
              tooltip.style.top = `${event.clientY - 45}px`;
            }
          };

          document.addEventListener("mouseover", handleMouseOver);
          document.addEventListener("mouseout", handleMouseOut);
          document.addEventListener("mousemove", handleMouseMove);

          return {
            destroy() {
              document.removeEventListener("mouseover", handleMouseOver);
              document.removeEventListener("mouseout", handleMouseOut);
              document.removeEventListener("mousemove", handleMouseMove);
              hideTooltip();
              if (hideTimeout) {
                clearTimeout(hideTimeout);
              }
            },
          };
        },
      }),
    ];
  },
});

export default TrackChangesMode;
