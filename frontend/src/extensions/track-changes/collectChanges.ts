import type { Transaction, EditorState } from "@tiptap/pm/state";
import { ReplaceStep, Mapping } from "@tiptap/pm/transform";
import type { PendingChange, DeletedFragment } from "./types";

/**
 * Collect all pending changes from a set of transactions.
 */
export function collectChangesFromTransactions(
  transactions: readonly Transaction[],
  _oldState: EditorState,
  _newState: EditorState,
  author: string,
): PendingChange[] {
  const pendingChanges: PendingChange[] = [];

  for (const transaction of transactions) {
    if (!transaction.docChanged) continue;
    collectChangesFromTransaction(
      transaction,
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
  author: string,
  pendingChanges: PendingChange[],
): void {
  let stepIndex = 0;

  for (const step of transaction.steps) {
    if (step instanceof ReplaceStep) {
      const replaceStep = step as ReplaceStep;
      const { from, to } = replaceStep;
      const slice = replaceStep.slice;

      // Inspect the document before this step, not the transaction's initial doc.
      // The inverse mapping distinguishes original characters from text inserted
      // earlier in the same transaction (which should disappear when deleted).
      const originMapping = new Mapping(transaction.mapping.maps.slice(0, stepIndex)).invert();
      const { deletedFragments, alreadyDeletedFragments } =
        collectDeletedFragments({ doc: transaction.docs[stepIndex] }, from, to, author, originMapping);

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

      // Slice positions include block boundaries; text length alone loses them.
      slice.content.descendants((node, offset) => {
        if (!node.isText || !node.text) return;
        const from = replaceStep.from + offset - slice.openStart;
        const later = transaction.mapping.slice(stepIndex + 1);
        const mappedStart = later.map(from, 1);
        const mappedEnd = later.map(from + node.nodeSize, -1);
        if (mappedEnd > mappedStart) {
          pendingChanges.push({ type: "insertion", from: mappedStart, to: mappedEnd, text: node.text });
        }
      });
    }
    stepIndex++;
  }
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
  oldState: Pick<EditorState, "doc">,
  oldFrom: number,
  oldTo: number,
  author: string,
  originMapping: Mapping,
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
        const start = Math.max(pos, oldFrom);
        const end = Math.min(pos + node.nodeSize, oldTo);
        let originalStart: number | null = null;
        const flush = (until: number) => {
          if (originalStart === null) return;
          const fragment = processTextNode(node, pos, originalStart, until, author);
          if (fragment?.type === "deleted") deletedFragments.push(fragment.fragment);
          if (fragment?.type === "already-deleted") alreadyDeletedFragments.push(fragment.fragment);
          originalStart = null;
        };
        for (let offset = start; offset < end; offset++) {
          const originalFrom = originMapping.map(offset, 1);
          const originalTo = originMapping.map(offset + 1, -1);
          if (originalTo > originalFrom) {
            originalStart ??= offset;
          } else {
            flush(offset);
          }
        }
        flush(end);
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
