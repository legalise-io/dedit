import { Editor } from "@tiptap/react";
import type { AIEdit, WordChange } from "./types";
import { computeDiff } from "./diffUtils";
import { findParagraphWithPositionMap, cleanPosToDocPos } from "./documentUtils";

// Generate unique ID for edits
const generateEditId = () =>
  `edit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

/**
 * Apply a single paragraph edit and return individual word changes as AIEdits.
 *
 * This function handles paragraphs with existing track changes by:
 * 1. Building a position map between "clean text" and actual document positions
 * 2. Computing the diff against clean text (what AI sees)
 * 3. Mapping diff positions to actual document positions
 * 4. Applying changes at the correct document positions
 *
 * Existing track changes are preserved - not accepted or modified.
 */
export function applyParagraphEdit(
  ed: Editor,
  paragraphId: string,
  newText: string,
  authorName: string,
  reason?: string,
): AIEdit[] {
  // Find paragraph with position map for track-changes-aware editing
  const para = findParagraphWithPositionMap(ed, paragraphId);
  if (!para) {
    console.warn(`[applyParagraphEdit] Paragraph ${paragraphId} not found`);
    return [];
  }

  console.log(`[applyParagraphEdit] Editing paragraph ${paragraphId}:`);
  console.log(`  Clean text: "${para.text.substring(0, 100)}..."`);
  console.log(`  New text: "${newText.substring(0, 100)}..."`);
  console.log(
    `  Segments: ${para.positionMap.segments.length} (${para.positionMap.segments.filter((s) => s.isDeleted).length} deleted)`,
  );
  // Debug: show each segment
  for (const seg of para.positionMap.segments) {
    console.log(
      `    Segment: "${seg.text.substring(0, 30)}" deleted=${seg.isDeleted} inserted=${seg.isInserted} offset=${seg.nodeOffset}`,
    );
  }

  // Compute diff between clean text (what AI sees) and new text
  console.log(`  Clean text length: ${para.text.length}`);
  console.log(`  Clean text ends with: "${para.text.slice(-20)}"`);
  console.log(`  New text length: ${newText.length}`);
  console.log(`  New text ends with: "${newText.slice(-20)}"`);
  const diff = computeDiff(para.text, newText);
  console.log(`  Diff results:`, diff.filter((d) => d.type !== "keep"));

  // Don't pre-map all positions - we'll map each one before applying
  // because the document changes with each operation
  const diffChanges = diff.filter(d => d.type === "delete" || d.type === "insert");

  console.log(`  Diff changes (non-keep): ${diffChanges.length}`);

  // Group consecutive delete+insert pairs as single word changes
  const wordChanges: WordChange[] = [];
  let i = 0;
  while (i < diff.length) {
    const current = diff[i];
    if (current.type === "delete") {
      const next = diff[i + 1];
      if (next && next.type === "insert" && next.oldStart === current.oldEnd) {
        wordChanges.push({
          deletedText: current.text,
          insertedText: next.text,
        });
        i += 2;
      } else {
        wordChanges.push({
          deletedText: current.text,
          insertedText: "",
        });
        i++;
      }
    } else if (current.type === "insert") {
      wordChanges.push({
        deletedText: "",
        insertedText: current.text,
      });
      i++;
    } else {
      i++;
    }
  }

  console.log(`  Word changes: ${wordChanges.length}`);

  // Get existing track change IDs before applying
  const existingIds = new Set<string>();
  const editorDom = ed.view.dom;
  editorDom
    .querySelectorAll("ins[data-insertion-id], del[data-deletion-id]")
    .forEach((el) => {
      const id =
        el.getAttribute("data-insertion-id") ||
        el.getAttribute("data-deletion-id");
      if (id) existingIds.add(id);
    });

  // Combine adjacent delete+insert pairs from the diff
  interface CombinedDiffChange {
    cleanStart: number;
    cleanEnd: number;
    deleteText: string;
    insertText: string;
  }

  // Sort diff changes by cleanStart to find adjacent pairs
  const sortedDiffChanges = [...diffChanges].sort(
    (a, b) => a.oldStart - b.oldStart,
  );

  const combined: CombinedDiffChange[] = [];
  const used = new Set<number>();

  for (let i = 0; i < sortedDiffChanges.length; i++) {
    if (used.has(i)) continue;

    const current = sortedDiffChanges[i];
    const next = sortedDiffChanges[i + 1];

    if (
      current.type === "delete" &&
      next &&
      next.type === "insert" &&
      next.oldStart === current.oldEnd
    ) {
      // This is a delete+insert pair (replacement)
      combined.push({
        cleanStart: current.oldStart,
        cleanEnd: current.oldEnd,
        deleteText: current.text,
        insertText: next.text,
      });
      used.add(i);
      used.add(i + 1);
    } else if (current.type === "delete") {
      combined.push({
        cleanStart: current.oldStart,
        cleanEnd: current.oldEnd,
        deleteText: current.text,
        insertText: "",
      });
      used.add(i);
    } else if (current.type === "insert") {
      combined.push({
        cleanStart: current.oldStart,
        cleanEnd: current.oldStart,
        deleteText: "",
        insertText: current.text,
      });
      used.add(i);
    }
  }

  console.log(`  Combined into ${combined.length} operations`);

  // Apply changes from END to START
  // This way, earlier positions aren't affected by later changes
  // We use the original position map for all calculations
  combined.sort((a, b) => b.cleanStart - a.cleanStart);

  console.log(`  Applying ${combined.length} operations from end to start`);

  // Use the original position map for all operations
  // Since we're going end to start, positions before our current operation
  // haven't been affected yet
  const originalPositionMap = para.positionMap;

  for (const change of combined) {
    // Map clean positions to document positions using ORIGINAL position map
    const docStart = cleanPosToDocPos(change.cleanStart, originalPositionMap);
    const docEnd = cleanPosToDocPos(change.cleanEnd, originalPositionMap);

    console.log(
      `  Applying: clean[${change.cleanStart}-${change.cleanEnd}] -> doc[${docStart}-${docEnd}] delete="${change.deleteText.substring(0, 20)}..." insert="${change.insertText.substring(0, 20)}..."`,
    );

    if (change.deleteText && change.insertText) {
      // Replacement: select range and replace with new text
      ed.chain()
        .focus()
        .setTextSelection({ from: docStart, to: docEnd })
        .insertContent(change.insertText)
        .run();
    } else if (change.deleteText) {
      // Pure deletion: select and delete
      ed.chain()
        .focus()
        .setTextSelection({ from: docStart, to: docEnd })
        .deleteSelection()
        .run();
    } else if (change.insertText) {
      // Pure insertion: position cursor and insert
      ed.chain()
        .focus()
        .setTextSelection(docStart)
        .insertContent(change.insertText)
        .run();
    }
  }

  // Find new track change IDs that were created
  const newDeletionIds: string[] = [];
  const newInsertionIds: string[] = [];
  editorDom.querySelectorAll("del[data-deletion-id]").forEach((el) => {
    const id = el.getAttribute("data-deletion-id");
    const author = el.getAttribute("data-author");
    if (id && !existingIds.has(id) && author === authorName) {
      newDeletionIds.push(id);
    }
  });
  editorDom.querySelectorAll("ins[data-insertion-id]").forEach((el) => {
    const id = el.getAttribute("data-insertion-id");
    const author = el.getAttribute("data-author");
    if (id && !existingIds.has(id) && author === authorName) {
      newInsertionIds.push(id);
    }
  });

  console.log(`  New deletion IDs:`, newDeletionIds);
  console.log(`  New insertion IDs:`, newInsertionIds);

  // Match track change IDs to word changes
  let delIdx = 0;
  let insIdx = 0;
  const edits: AIEdit[] = wordChanges.map((wc) => {
    const edit: AIEdit = {
      id: generateEditId(),
      paragraphId,
      deletedText: wc.deletedText,
      insertedText: wc.insertedText,
      reason,
      status: "applied",
    };

    if (wc.deletedText) {
      edit.deletionId = newDeletionIds[delIdx++];
    }
    if (wc.insertedText) {
      edit.insertionId = newInsertionIds[insIdx++];
    }

    return edit;
  });

  console.log(`  Created ${edits.length} AIEdit objects`);
  return edits;
}

/**
 * Accept all track changes within a specific paragraph
 */
export function acceptAllChangesInParagraph(
  ed: Editor,
  paragraphId: string,
): void {
  const editorDom = ed.view.dom;

  // Find all track changes in this paragraph and accept them
  // We need to find the paragraph element first
  const paragraphEl = editorDom.querySelector(`[data-id="${paragraphId}"]`);
  if (!paragraphEl) return;

  // Accept all deletions in this paragraph
  const deletions = paragraphEl.querySelectorAll("del[data-deletion-id]");
  deletions.forEach((del) => {
    const id = del.getAttribute("data-deletion-id");
    if (id) {
      ed.commands.acceptDeletion(id);
    }
  });

  // Accept all insertions in this paragraph
  const insertions = paragraphEl.querySelectorAll("ins[data-insertion-id]");
  insertions.forEach((ins) => {
    const id = ins.getAttribute("data-insertion-id");
    if (id) {
      ed.commands.acceptInsertion(id);
    }
  });
}

/**
 * Apply paragraph edits from AI response and return word-level AIEdits.
 *
 * This function preserves existing track changes in paragraphs being edited.
 * The AI sees "clean" text (deletions removed), and we use position mapping
 * to correctly apply the AI's edits at the right document positions.
 */
export function applyEditsAsTrackChanges(
  ed: Editor,
  paragraphEdits: Array<{
    paragraphId: string;
    newText: string;
    reason?: string;
  }>,
  authorName: string,
): AIEdit[] {
  if (paragraphEdits.length === 0) return [];

  // Enable track changes with AI author
  const wasEnabled = ed.storage.trackChangesMode?.enabled || false;
  const previousAuthor = ed.storage.trackChangesMode?.author || "User";

  ed.commands.enableTrackChanges();
  ed.commands.setTrackChangesAuthor(authorName);

  // Apply each paragraph edit and collect word-level edits
  // Note: applyParagraphEdit now uses position mapping to handle existing track changes
  const allEdits: AIEdit[] = [];
  for (const paraEdit of paragraphEdits) {
    const wordEdits = applyParagraphEdit(
      ed,
      paraEdit.paragraphId,
      paraEdit.newText,
      authorName,
      paraEdit.reason,
    );
    allEdits.push(...wordEdits);
  }

  // Restore previous track changes state
  if (!wasEnabled) {
    ed.commands.disableTrackChanges();
  }
  ed.commands.setTrackChangesAuthor(previousAuthor);

  return allEdits;
}
