import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { TrackChangesModeStorage } from "./types";
import { collectChangesFromTransactions } from "./collectChanges";
import { applyChangesToTransaction } from "./applyChanges";

export const trackChangesModePluginKey = new PluginKey("trackChangesMode");

/**
 * Create the main track changes ProseMirror plugin.
 */
export function createTrackChangesPlugin(
  getStorage: () => TrackChangesModeStorage,
): Plugin {
  return new Plugin({
    key: trackChangesModePluginKey,

    appendTransaction(transactions, oldState, newState) {
      // Guard: Only process if track changes is enabled
      if (!getStorage().enabled) {
        return null;
      }

      // Guard: Skip if no actual document changes
      if (!transactions.some((tr) => tr.docChanged)) {
        return null;
      }

      // Guard: Skip transactions from track changes itself (prevent infinite loop)
      if (transactions.some((tr) => tr.getMeta("trackChangesProcessed"))) {
        return null;
      }

      // Guard: Skip transactions from accept/reject operations
      if (transactions.some((tr) => tr.getMeta("acceptReject"))) {
        return null;
      }

      // Guard: Skip undo/redo transactions
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

      const author = getStorage().author;

      // Collect all pending changes from transactions
      const pendingChanges = collectChangesFromTransactions(
        transactions,
        oldState,
        newState,
        author,
      );

      if (pendingChanges.length === 0) {
        return null;
      }

      // Apply changes to a new transaction
      let tr = newState.tr;
      const cursorPos = newState.selection.from;

      tr = applyChangesToTransaction(tr, pendingChanges, newState, author);

      // Restore cursor to where it was before we inserted deleted text
      // Use assoc=-1 to keep cursor to the left of any inserted content
      const mappedCursor = tr.mapping.map(cursorPos, -1);
      const $pos = tr.doc.resolve(mappedCursor);
      tr = tr.setSelection(TextSelection.create(tr.doc, $pos.pos));

      tr.setMeta("trackChangesProcessed", true);
      return tr;
    },
  });
}
