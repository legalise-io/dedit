import { Editor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { ParagraphInfo, PendingTrackChange } from "./types";

/**
 * Extract "clean" text from a paragraph node, excluding deleted text.
 * This walks through the node's children and skips any text with deletion marks.
 * Inserted text is included as it represents the current state.
 */
export function getCleanTextFromNode(node: ProseMirrorNode): string {
  let text = "";

  node.descendants((child) => {
    if (child.isText && child.text) {
      // Check if this text has a deletion mark
      const hasDeletion = child.marks.some(
        (mark) => mark.type.name === "deletion",
      );
      if (!hasDeletion) {
        // Include text that is NOT deleted (including inserted text)
        text += child.text;
      }
    }
    return true;
  });

  return text;
}

/**
 * Build an indexed document string with paragraph IDs for AI context.
 * Format: [paragraphId] paragraph text
 * The ID is a UUID that uniquely identifies each paragraph.
 *
 * IMPORTANT: This function extracts "clean" text - text with deletion marks
 * is excluded since it represents content that has been removed.
 * Inserted text is included since it represents the current document state.
 */
export function buildIndexedDocument(editor: Editor): {
  document: string;
  paragraphs: Map<string, ParagraphInfo>;
} {
  const doc = editor.state.doc;
  const lines: string[] = [];
  const paragraphs = new Map<string, ParagraphInfo>();

  doc.descendants((node, pos) => {
    if (node.type.name === "paragraph") {
      const id = node.attrs.id;
      // Use clean text (excluding deletions) for the AI
      const text = getCleanTextFromNode(node);

      if (id) {
        lines.push(`[${id}] ${text}`);
        paragraphs.set(id, {
          id,
          text,
          from: pos + 1, // +1 to get inside the paragraph node
          to: pos + node.nodeSize - 1, // -1 to stay inside
        });
      }
    }
    return true;
  });

  return {
    document: lines.join("\n\n"),
    paragraphs,
  };
}

/**
 * Find a paragraph by its ID and return its current position and text.
 * Returns "clean" text (excluding deletions) to match what AI sees.
 */
export function findParagraphById(
  editor: Editor,
  paragraphId: string,
): ParagraphInfo | null {
  const doc = editor.state.doc;
  let result: ParagraphInfo | null = null;

  doc.descendants((node, pos) => {
    if (result) return false; // Already found
    if (node.type.name === "paragraph" && node.attrs.id === paragraphId) {
      result = {
        id: paragraphId,
        // Use clean text (excluding deletions) to match what AI sees
        text: getCleanTextFromNode(node),
        from: pos + 1,
        to: pos + node.nodeSize - 1,
      };
      return false;
    }
    return true;
  });

  return result;
}

/**
 * Get all pending track changes within a given range.
 */
export function getPendingTrackChangesInScope(
  editor: Editor,
  from: number,
  to: number,
): PendingTrackChange[] {
  const changes: PendingTrackChange[] = [];
  const doc = editor.state.doc;
  const seenIds = new Set<string>();

  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === "paragraph") {
      const paragraphId = node.attrs.id || "";

      node.descendants((child, childPos) => {
        if (child.isText && child.text) {
          for (const mark of child.marks) {
            if (
              mark.type.name === "insertion" ||
              mark.type.name === "deletion"
            ) {
              const markId = mark.attrs.id;
              if (markId && !seenIds.has(markId)) {
                seenIds.add(markId);

                const absolutePos = pos + 1 + childPos;

                changes.push({
                  id: markId,
                  type: mark.type.name as "insertion" | "deletion",
                  text: child.text,
                  author: mark.attrs.author || null,
                  date: mark.attrs.date || null,
                  paragraphId,
                  pos: absolutePos,
                  endPos: absolutePos + child.text.length,
                });
              }
            }
          }
        }
        return true;
      });
    }
    return true;
  });

  return changes;
}
