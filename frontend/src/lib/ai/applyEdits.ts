import { Editor } from "@tiptap/react";
import type { AIEdit, WordChange } from "./types";
import { computeDiff } from "./diffUtils";
import { findParagraphById } from "./documentUtils";

// Generate unique ID for edits
const generateEditId = () =>
  `edit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

/**
 * Apply a single paragraph edit and return individual word changes as AIEdits
 */
export function applyParagraphEdit(
  ed: Editor,
  paragraphId: string,
  newText: string,
  authorName: string,
  reason?: string,
): AIEdit[] {
  // Find current paragraph position
  const para = findParagraphById(ed, paragraphId);
  if (!para) {
    console.warn(`[applyParagraphEdit] Paragraph ${paragraphId} not found`);
    return [];
  }

  console.log(`[applyParagraphEdit] Editing paragraph ${paragraphId}:`);
  console.log(`  Old: "${para.text.substring(0, 100)}..."`);
  console.log(`  New: "${newText.substring(0, 100)}..."`);

  // Compute diff between old and new text
  const diff = computeDiff(para.text, newText);

  // Group consecutive delete+insert pairs as single word changes
  const wordChanges: WordChange[] = [];
  let i = 0;
  while (i < diff.length) {
    const current = diff[i];
    if (current.type === "delete") {
      // Check if next is an insert at same position (replacement)
      const next = diff[i + 1];
      if (next && next.type === "insert" && next.oldStart === current.oldEnd) {
        wordChanges.push({
          deletedText: current.text,
          insertedText: next.text,
        });
        i += 2;
      } else {
        // Pure deletion
        wordChanges.push({
          deletedText: current.text,
          insertedText: "",
        });
        i++;
      }
    } else if (current.type === "insert") {
      // Pure insertion
      wordChanges.push({
        deletedText: "",
        insertedText: current.text,
      });
      i++;
    } else {
      // Keep - skip
      i++;
    }
  }

  console.log(`  Word changes:`, wordChanges.length);

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

  // Apply changes in reverse order (from end to start) to preserve positions
  const changesWithPositions = diff
    .filter((c) => c.type === "delete" || c.type === "insert")
    .reverse();

  for (const change of changesWithPositions) {
    const docPos = para.from + change.oldStart;

    if (change.type === "delete") {
      ed.chain()
        .focus()
        .setTextSelection({ from: docPos, to: para.from + change.oldEnd })
        .deleteSelection()
        .run();
    } else if (change.type === "insert") {
      ed.chain()
        .focus()
        .setTextSelection(docPos)
        .insertContent(change.text)
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
  // Both IDs and wordChanges are in document order (forward)
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
 * Apply paragraph edits from AI response and return word-level AIEdits
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

  // First, accept all existing track changes in affected paragraphs
  // This ensures clean positions for applying new edits
  for (const paraEdit of paragraphEdits) {
    acceptAllChangesInParagraph(ed, paraEdit.paragraphId);
  }

  // Enable track changes with AI author
  const wasEnabled = ed.storage.trackChangesMode?.enabled || false;
  const previousAuthor = ed.storage.trackChangesMode?.author || "User";

  ed.commands.enableTrackChanges();
  ed.commands.setTrackChangesAuthor(authorName);

  // Apply each paragraph edit and collect word-level edits
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
