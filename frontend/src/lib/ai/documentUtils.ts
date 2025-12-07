import { Editor } from "@tiptap/react";
import type { Node as ProseMirrorNode, Mark } from "@tiptap/pm/model";
import type { ParagraphInfo, PendingTrackChange } from "./types";

/**
 * Represents a text segment with its marks and positions.
 * Used for building position maps and understanding document structure.
 */
export interface TextSegment {
  text: string;
  marks: readonly Mark[];
  /** Offset within the paragraph node (relative to node start) */
  nodeOffset: number;
  /** Whether this text has a deletion mark */
  isDeleted: boolean;
  /** Whether this text has an insertion mark */
  isInserted: boolean;
}

/**
 * Position mapping for a paragraph that has track changes.
 * Maps positions in "clean" text (what AI sees) to actual document positions.
 */
export interface ParagraphPositionMap {
  /** The clean text (deletions removed) */
  cleanText: string;
  /** All text segments in order */
  segments: TextSegment[];
  /** Start position of text content within document */
  paragraphStart: number;
}

/**
 * Get detailed text segments from a paragraph node.
 * Each segment includes its marks and position information.
 */
export function getTextSegments(node: ProseMirrorNode): TextSegment[] {
  const segments: TextSegment[] = [];

  // node.forEach provides childOffset as the offset from start of node content
  node.forEach((child, childOffset) => {
    if (child.isText && child.text) {
      const hasDeletion = child.marks.some(
        (mark) => mark.type.name === "deletion",
      );
      const hasInsertion = child.marks.some(
        (mark) => mark.type.name === "insertion",
      );

      segments.push({
        text: child.text,
        marks: child.marks,
        nodeOffset: childOffset,
        isDeleted: hasDeletion,
        isInserted: hasInsertion,
      });
    }
  });

  return segments;
}

/**
 * Build a position map for a paragraph that allows translating
 * "clean text" positions to actual document positions.
 *
 * Clean text = text with deletions removed (what AI sees)
 * Actual positions = positions in the real document including deleted spans
 */
export function buildParagraphPositionMap(
  node: ProseMirrorNode,
  paragraphStart: number,
): ParagraphPositionMap {
  const segments = getTextSegments(node);
  let cleanText = "";

  for (const segment of segments) {
    if (!segment.isDeleted) {
      cleanText += segment.text;
    }
  }

  return {
    cleanText,
    segments,
    paragraphStart,
  };
}

/**
 * Convert a position in "clean text" to the actual document position.
 *
 * This uses the actual nodeOffset values from ProseMirror rather than
 * manually computing offsets, which ensures accuracy with the real document.
 *
 * @param cleanPos - Position in the clean text (0-indexed within paragraph)
 * @param map - The position map for this paragraph
 * @returns The absolute document position
 */
export function cleanPosToDocPos(
  cleanPos: number,
  map: ParagraphPositionMap,
): number {
  let cleanOffset = 0;

  console.log(
    `  cleanPosToDocPos(${cleanPos}): paragraphStart=${map.paragraphStart}`,
  );

  for (const segment of map.segments) {
    if (segment.isDeleted) {
      // Deleted text exists in document but not in clean text - skip it
      console.log(
        `    DELETED seg "${segment.text.substring(0, 20)}" len=${segment.text.length} at nodeOffset=${segment.nodeOffset}`,
      );
    } else {
      // Non-deleted text exists in both
      const segmentLen = segment.text.length;

      console.log(
        `    VISIBLE seg "${segment.text.substring(0, 20)}" len=${segmentLen}: cleanOffset=${cleanOffset}, nodeOffset=${segment.nodeOffset}`,
      );

      if (cleanPos < cleanOffset + segmentLen) {
        // Position is strictly within this segment
        const posInSegment = cleanPos - cleanOffset;
        const result = map.paragraphStart + segment.nodeOffset + posInSegment;
        console.log(
          `    -> MATCH! posInSegment=${posInSegment}, result=${result}`,
        );
        return result;
      }

      cleanOffset += segmentLen;
    }
  }

  // Position is at or past the end - find the last segment and position after it
  const lastSegment = map.segments[map.segments.length - 1];
  if (lastSegment) {
    const result =
      map.paragraphStart + lastSegment.nodeOffset + lastSegment.text.length;
    console.log(
      `    -> END: after last segment at nodeOffset=${lastSegment.nodeOffset}, result=${result}`,
    );
    return result;
  }

  // Empty paragraph
  const result = map.paragraphStart;
  console.log(`    -> EMPTY: result=${result}`);
  return result;
}

/**
 * Get information about what exists at a clean text position.
 * Returns the document position and whether we're at a deletion boundary.
 */
export function getPositionInfo(
  cleanPos: number,
  map: ParagraphPositionMap,
): {
  docPos: number;
  /** True if there's deleted text immediately before this position */
  hasDeletedBefore: boolean;
  /** True if there's deleted text immediately after this position */
  hasDeletedAfter: boolean;
} {
  let cleanOffset = 0;
  let docOffset = 0;
  let prevWasDeleted = false;

  for (let i = 0; i < map.segments.length; i++) {
    const segment = map.segments[i];
    const nextSegment = map.segments[i + 1];

    if (segment.isDeleted) {
      docOffset += segment.text.length;
      prevWasDeleted = true;
    } else {
      const segmentLen = segment.text.length;

      if (cleanPos < cleanOffset + segmentLen) {
        // Position is within this segment
        const posInSegment = cleanPos - cleanOffset;
        return {
          docPos: map.paragraphStart + docOffset + posInSegment,
          hasDeletedBefore: posInSegment === 0 && prevWasDeleted,
          hasDeletedAfter: false,
        };
      }

      if (cleanPos === cleanOffset + segmentLen) {
        // Position is at the end of this segment
        const hasDeletedAfter = nextSegment?.isDeleted ?? false;
        return {
          docPos: map.paragraphStart + docOffset + segmentLen,
          hasDeletedBefore: false,
          hasDeletedAfter,
        };
      }

      cleanOffset += segmentLen;
      docOffset += segmentLen;
      prevWasDeleted = false;
    }
  }

  return {
    docPos: map.paragraphStart + docOffset,
    hasDeletedBefore: prevWasDeleted,
    hasDeletedAfter: false,
  };
}

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
 * Extended paragraph info with position mapping for track-changes-aware editing.
 */
export interface ParagraphWithPositionMap extends ParagraphInfo {
  positionMap: ParagraphPositionMap;
}

/**
 * Find a paragraph by its ID and return both paragraph info AND position map.
 * This is needed for applying edits when the paragraph has existing track changes.
 */
export function findParagraphWithPositionMap(
  editor: Editor,
  paragraphId: string,
): ParagraphWithPositionMap | null {
  const doc = editor.state.doc;
  let result: ParagraphWithPositionMap | null = null;

  doc.descendants((node, pos) => {
    if (result) return false;
    if (node.type.name === "paragraph" && node.attrs.id === paragraphId) {
      const paragraphStart = pos + 1;
      const positionMap = buildParagraphPositionMap(node, paragraphStart);

      result = {
        id: paragraphId,
        text: positionMap.cleanText,
        from: paragraphStart,
        to: pos + node.nodeSize - 1,
        positionMap,
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
