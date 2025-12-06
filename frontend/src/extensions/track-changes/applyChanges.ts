import type { Transaction, EditorState } from "@tiptap/pm/state";
import type { PendingChange } from "./types";
import { generateChangeId, getCurrentDate } from "./utils";

/**
 * Apply pending changes to a transaction.
 * Changes are applied in reverse order (from end to start) to preserve positions.
 */
export function applyChangesToTransaction(
  tr: Transaction,
  pendingChanges: PendingChange[],
  newState: EditorState,
  author: string,
): Transaction {
  const date = getCurrentDate();

  // Sort changes from end to start to preserve positions
  const sortedChanges = [...pendingChanges].sort((a, b) => b.from - a.from);

  for (const change of sortedChanges) {
    tr = applyChange(tr, change, newState, author, date);
  }

  return tr;
}

/**
 * Apply a single change to the transaction.
 */
function applyChange(
  tr: Transaction,
  change: PendingChange,
  newState: EditorState,
  author: string,
  date: string,
): Transaction {
  switch (change.type) {
    case "deletion":
      return applyDeletion(tr, change, newState, author, date);
    case "restore-deleted":
      return applyRestoreDeleted(tr, change, newState);
    case "insertion":
      return applyInsertion(tr, change, newState, author, date);
    default:
      return tr;
  }
}

/**
 * Apply a deletion change - insert deleted text with deletion mark.
 */
function applyDeletion(
  tr: Transaction,
  change: PendingChange,
  newState: EditorState,
  author: string,
  date: string,
): Transaction {
  const deletionMark = newState.schema.marks.deletion.create({
    id: generateChangeId("del"),
    author,
    date,
  });

  const mappedPos = tr.mapping.map(change.from);

  if (change.deletedFragments && change.deletedFragments.length > 0) {
    // Insert each fragment with its original marks plus the deletion mark
    // Insert in reverse order since we're inserting at the same position
    const fragments = [...change.deletedFragments].reverse();

    for (const fragment of fragments) {
      const marks = [...fragment.marks, deletionMark];
      const textNode = newState.schema.text(fragment.text, marks);
      tr = tr.insert(mappedPos, textNode);
    }
  } else {
    // Fallback: just insert with deletion mark only
    const textNode = newState.schema.text(change.text, [deletionMark]);
    tr = tr.insert(mappedPos, textNode);
  }

  return tr;
}

/**
 * Apply a restore-deleted change - re-insert already-deleted text with original marks.
 */
function applyRestoreDeleted(
  tr: Transaction,
  change: PendingChange,
  newState: EditorState,
): Transaction {
  const mappedPos = tr.mapping.map(change.from);
  const marks = change.originalMarks ? [...change.originalMarks] : [];
  const textNode = newState.schema.text(change.text, marks);

  return tr.insert(mappedPos, textNode);
}

/**
 * Apply an insertion change - add insertion mark to inserted text.
 */
function applyInsertion(
  tr: Transaction,
  change: PendingChange,
  newState: EditorState,
  author: string,
  date: string,
): Transaction {
  const insertionMark = newState.schema.marks.insertion.create({
    id: generateChangeId("ins"),
    author,
    date,
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
  return tr.addMark(mappedFrom, mappedTo, insertionMark);
}
