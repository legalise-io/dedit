import { diffWords } from "diff";
import type { DiffChange, GroupedTrackChange, PendingTrackChange } from "./types";

/**
 * Compute word-level diff between two strings using the diff library.
 * Returns array of changes with positions relative to the old string.
 */
export function computeDiff(oldStr: string, newStr: string): DiffChange[] {
  const wordDiff = diffWords(oldStr, newStr);
  const changes: DiffChange[] = [];

  let oldPos = 0;

  for (const part of wordDiff) {
    if (part.added) {
      // Inserted text - position is where we are in old string
      changes.push({
        type: "insert",
        text: part.value,
        oldStart: oldPos,
        oldEnd: oldPos,
      });
    } else if (part.removed) {
      // Deleted text - advances old position
      changes.push({
        type: "delete",
        text: part.value,
        oldStart: oldPos,
        oldEnd: oldPos + part.value.length,
      });
      oldPos += part.value.length;
    } else {
      // Unchanged text - advances old position
      changes.push({
        type: "keep",
        text: part.value,
        oldStart: oldPos,
        oldEnd: oldPos + part.value.length,
      });
      oldPos += part.value.length;
    }
  }

  return changes;
}

/**
 * Group contiguous track changes into blocks.
 * All adjacent changes (no unchanged text between them) become one decision.
 */
export function groupTrackChanges(
  changes: PendingTrackChange[],
): GroupedTrackChange[] {
  if (changes.length === 0) return [];

  // Sort by position
  const sorted = [...changes].sort((a, b) => a.pos - b.pos);

  const grouped: GroupedTrackChange[] = [];

  let currentBlock: GroupedTrackChange = {
    deletionIds: [],
    insertionIds: [],
    deletedText: "",
    insertedText: "",
    author: null,
  };
  let blockEndPos = -1;

  for (const change of sorted) {
    // If there's a gap, start a new block
    if (blockEndPos !== -1 && change.pos > blockEndPos) {
      grouped.push(currentBlock);
      currentBlock = {
        deletionIds: [],
        insertionIds: [],
        deletedText: "",
        insertedText: "",
        author: null,
      };
    }

    // Add to current block
    if (change.type === "deletion") {
      currentBlock.deletionIds.push(change.id);
      currentBlock.deletedText += change.text;
    } else {
      currentBlock.insertionIds.push(change.id);
      currentBlock.insertedText += change.text;
    }
    if (!currentBlock.author) {
      currentBlock.author = change.author;
    }

    // Track furthest end position
    blockEndPos = Math.max(blockEndPos, change.endPos);
  }

  // Push final block
  if (
    currentBlock.deletionIds.length > 0 ||
    currentBlock.insertionIds.length > 0
  ) {
    grouped.push(currentBlock);
  }

  return grouped;
}
