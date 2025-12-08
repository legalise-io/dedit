import type { Transaction, EditorState } from "@tiptap/pm/state";
import type { Slice } from "@tiptap/pm/model";
import { ReplaceStep } from "@tiptap/pm/transform";
import type { PendingChange, DeletedFragment } from "./types";

/**
 * Collect all pending changes from a set of transactions.
 */
export function collectChangesFromTransactions(
  transactions: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
  author: string,
): PendingChange[] {
  const pendingChanges: PendingChange[] = [];

  for (const transaction of transactions) {
    if (!transaction.docChanged) continue;
    collectChangesFromTransaction(
      transaction,
      oldState,
      newState,
      author,
      pendingChanges,
    );
  }

  return pendingChanges;
}

/**
 * Process a single transaction and collect its changes.
 */
function collectChangesFromTransaction(
  transaction: Transaction,
  oldState: EditorState,
  newState: EditorState,
  author: string,
  pendingChanges: PendingChange[],
): void {
  let stepIndex = 0;

  for (const step of transaction.steps) {
    if (step instanceof ReplaceStep) {
      const replaceStep = step as ReplaceStep;
      const { from, to } = replaceStep;
      const slice = replaceStep.slice;

      // Map positions back through previous steps to get oldState positions
      const { oldFrom, oldTo } = mapPositionsToOldState(
        from,
        to,
        stepIndex,
        transaction,
      );

      // Collect deleted and already-deleted fragments
      const { deletedFragments, alreadyDeletedFragments } =
        collectDeletedFragments(oldState, oldFrom, oldTo, author);

      // Get inserted text from the slice
      const insertedText = extractInsertedText(slice);

      // Map 'from' position forward through subsequent steps to get newState position
      const mappedFrom = mapPositionToNewState(
        from,
        stepIndex,
        transaction,
      );

      // Add deletion change if there are fragments to delete
      addDeletionChange(deletedFragments, mappedFrom, pendingChanges);

      // Add restore-deleted changes for already-deleted text
      addRestoreDeletedChanges(
        alreadyDeletedFragments,
        mappedFrom,
        pendingChanges,
      );

      // Add insertion change if there's inserted text
      addInsertionChange(
        insertedText,
        mappedFrom,
        newState,
        pendingChanges,
      );
    }
    stepIndex++;
  }
}

/**
 * Map positions back through previous steps to get oldState positions.
 */
function mapPositionsToOldState(
  from: number,
  to: number,
  stepIndex: number,
  transaction: Transaction,
): { oldFrom: number; oldTo: number } {
  let oldFrom = from;
  let oldTo = to;

  for (let i = 0; i < stepIndex; i++) {
    const prevStep = transaction.steps[i];
    const map = prevStep.getMap();
    oldFrom = map.invert().map(oldFrom, -1);
    oldTo = map.invert().map(oldTo, 1);
  }

  return { oldFrom, oldTo };
}

/**
 * Map position forward through subsequent steps to get newState position.
 */
function mapPositionToNewState(
  from: number,
  stepIndex: number,
  transaction: Transaction,
): number {
  let mappedFrom = from;

  for (let i = stepIndex + 1; i < transaction.steps.length; i++) {
    const laterStep = transaction.steps[i];
    const map = laterStep.getMap();
    mappedFrom = map.map(mappedFrom);
  }

  return mappedFrom;
}

/**
 * Collect deleted text fragments from the old state, preserving marks.
 */
function collectDeletedFragments(
  oldState: EditorState,
  oldFrom: number,
  oldTo: number,
  author: string,
): {
  deletedFragments: DeletedFragment[];
  alreadyDeletedFragments: DeletedFragment[];
} {
  const deletedFragments: DeletedFragment[] = [];
  const alreadyDeletedFragments: DeletedFragment[] = [];

  try {
    let isFirstBlock = true;

    oldState.doc.nodesBetween(oldFrom, oldTo, (node, pos) => {
      // Add newline between block nodes
      if (node.isBlock && node.isTextblock) {
        if (!isFirstBlock) {
          deletedFragments.push({ text: "\n", marks: [] });
        }
        isFirstBlock = false;
      }

      if (node.isText && node.text) {
        const fragment = processTextNode(
          node,
          pos,
          oldFrom,
          oldTo,
          author,
        );

        if (fragment) {
          if (fragment.type === "deleted") {
            deletedFragments.push(fragment.fragment);
          } else if (fragment.type === "already-deleted") {
            alreadyDeletedFragments.push(fragment.fragment);
          }
        }
      }
    });
  } catch {
    // Position out of bounds, skip
  }

  return { deletedFragments, alreadyDeletedFragments };
}

/**
 * Process a text node to determine if it should be collected as deleted.
 */
function processTextNode(
  node: import("@tiptap/pm/model").Node,
  pos: number,
  oldFrom: number,
  oldTo: number,
  author: string,
): { type: "deleted" | "already-deleted"; fragment: DeletedFragment } | null {
  const nodeStart = pos;
  const nodeEnd = pos + node.nodeSize;
  const overlapStart = Math.max(nodeStart, oldFrom);
  const overlapEnd = Math.min(nodeEnd, oldTo);

  if (overlapStart >= overlapEnd) return null;

  const textStart = overlapStart - nodeStart;
  const textEnd = overlapEnd - nodeStart;
  const text = node.text!.slice(textStart, textEnd);

  if (!text) return null;

  const insertionMark = node.marks.find((m) => m.type.name === "insertion");
  const hasDeletionMark = node.marks.some((m) => m.type.name === "deletion");

  if (insertionMark) {
    const insertionAuthor = insertionMark.attrs.author;
    if (insertionAuthor === author) {
      // My own insertion - just remove it (undo my work)
      return null;
    } else {
      // Another author's insertion - mark as deletion in my color
      const marksWithoutInsertion = node.marks.filter(
        (m) => m.type.name !== "insertion",
      );
      return {
        type: "deleted",
        fragment: { text, marks: marksWithoutInsertion },
      };
    }
  } else if (hasDeletionMark) {
    // Already deleted - collect to restore with original marks
    return {
      type: "already-deleted",
      fragment: { text, marks: node.marks },
    };
  } else {
    // Regular text - collect for deletion marking
    return {
      type: "deleted",
      fragment: { text, marks: node.marks },
    };
  }
}

/**
 * Extract inserted text from a slice.
 */
function extractInsertedText(slice: Slice): string {
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

  return insertedText;
}

/**
 * Add a deletion change if there are fragments to delete.
 */
function addDeletionChange(
  deletedFragments: DeletedFragment[],
  mappedFrom: number,
  pendingChanges: PendingChange[],
): void {
  if (deletedFragments.length === 0) return;

  const nonInsertedText = deletedFragments.map((f) => f.text).join("");
  if (nonInsertedText.length === 0) return;

  pendingChanges.push({
    type: "deletion",
    from: mappedFrom,
    to: mappedFrom,
    text: nonInsertedText,
    deletedFragments,
  });
}

/**
 * Add restore-deleted changes for already-deleted text.
 */
function addRestoreDeletedChanges(
  alreadyDeletedFragments: DeletedFragment[],
  mappedFrom: number,
  pendingChanges: PendingChange[],
): void {
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

/**
 * Add an insertion change for inserted text.
 * Always add an insertion change to ensure the correct author is attributed,
 * even if the text already has an insertion mark from another author.
 */
function addInsertionChange(
  insertedText: string,
  mappedFrom: number,
  _newState: EditorState,
  pendingChanges: PendingChange[],
): void {
  if (!insertedText || insertedText.length === 0) return;

  // Always add insertion change - applyInsertion will handle removing
  // any existing insertion marks and adding the new one with correct author
  pendingChanges.push({
    type: "insertion",
    from: mappedFrom,
    to: mappedFrom + insertedText.length,
    text: insertedText,
  });
}
