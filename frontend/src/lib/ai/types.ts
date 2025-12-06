import { ReactNode } from "react";
import { Editor } from "@tiptap/react";
import type { ContextItem, TrackChangeRecommendation } from "../types";

// Re-export for convenience
export type { TrackChangeRecommendation } from "../types";

// Types for AI edits - individual word-level changes
export interface AIEdit {
  id: string;
  // Paragraph ID where this edit occurs
  paragraphId: string;
  // The deleted text (empty string if pure insertion)
  deletedText: string;
  // The inserted text (empty string if pure deletion)
  insertedText: string;
  // Brief description of what changed
  reason?: string;
  // Track change ID for the deletion mark (if any)
  deletionId?: string;
  // Track change ID for the insertion mark (if any)
  insertionId?: string;
  status: "pending" | "applied" | "accepted" | "rejected";
}

export interface AIResponse {
  message: string;
  edits?: Array<{
    // Paragraph ID from the indexed document
    paragraphId: string;
    // The new full text for this paragraph
    newText: string;
    // What was changed
    reason?: string;
  }>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  metadata?: {
    selectionContext?: SelectionContext;
    // Edits associated with this message (edit mode)
    edits?: AIEdit[];
    // Recommendations associated with this message (review mode)
    recommendations?: TrackChangeRecommendation[];
    // Context items included with this message
    contextItems?: ContextItem[];
    // Whether this was a review mode request
    isReviewMode?: boolean;
  };
}

export interface SelectionContext {
  text: string;
  from: number;
  to: number;
  hasSelection: boolean;
}

// Request/Response types for custom AI handler (edit mode)
export interface AIEditRequest {
  prompt: string;
  paragraphs: Array<{ id: string; text: string }>;
  selection?: {
    text: string;
    hasSelection: boolean;
  };
  contextItems?: ContextItem[];
}

export interface AIEditResponse {
  message: string;
  edits: Array<{
    paragraphId: string;
    newText: string;
    reason?: string;
  }>;
}

// Request/Response types for custom AI handler (review mode)
export interface AIReviewRequest {
  prompt: string;
  changes: Array<{
    index: number;
    deletedText: string;
    insertedText: string;
    author: string | null;
  }>;
}

export interface AIReviewResponse {
  message: string;
  recommendations: Array<{
    index: number;
    recommendation: "accept" | "reject" | "leave_alone";
    reason: string;
  }>;
}

// ============================================================================
// Pluggable Mode System
// ============================================================================

/**
 * Context passed to mode handlers - contains all information about current state
 */
export interface ModeContext {
  /** The prompt text (without the /command prefix) */
  prompt: string;
  /** Selected text, if any */
  selectedText: string | null;
  /** Whether there's an active selection */
  hasSelection: boolean;
  /** Document paragraphs with IDs and text */
  paragraphs: Array<{ id: string; text: string }>;
  /** Track changes in the document (for review-type modes) */
  trackChanges: PendingTrackChange[];
  /** Grouped track changes (adjacent deletion+insertion pairs) */
  groupedChanges: GroupedTrackChange[];
  /** Context items (files, URLs, etc.) attached to the prompt */
  contextItems: ContextItem[];
  /** The TipTap editor instance (for advanced use) */
  editor: Editor;
}

/**
 * Edit to apply to a paragraph (for edit-type modes)
 */
export interface ModeEdit {
  paragraphId: string;
  newText: string;
  reason?: string;
}

/**
 * Recommendation for a track change (for review-type modes)
 */
export interface ModeRecommendation {
  /** Index into the groupedChanges array */
  index: number;
  recommendation: "accept" | "reject" | "leave_alone";
  reason: string;
}

/**
 * Result returned from a mode handler
 */
export interface ModeResult {
  /** Message to display in the chat */
  message: string;
  /** Edits to apply (triggers edit UI with accept/reject) */
  edits?: ModeEdit[];
  /** Recommendations for track changes (triggers review UI with apply/discard) */
  recommendations?: ModeRecommendation[];
}

/**
 * A pluggable AI mode (slash command)
 */
export interface AIMode {
  /** Command name (without slash), e.g. "review", "summarize" */
  name: string;
  /** Description shown in command palette */
  description: string;
  /** Icon shown in command palette and pill */
  icon: ReactNode;
  /** Handler function that processes the command */
  handler: (context: ModeContext) => Promise<ModeResult>;
}

/**
 * Configuration for the AI editor
 */
export interface AIEditorConfig {
  aiAuthorName?: string;

  // Custom AI modes (slash commands) - these are merged with built-in modes
  // If a custom mode has the same name as a built-in, the custom one takes precedence
  modes?: AIMode[];

  // Legacy: Custom AI request handler for edit mode
  // If provided, the built-in "edit" mode will use this handler
  // If not provided, falls back to direct OpenAI API (requires apiKey)
  onAIRequest?: (request: AIEditRequest) => Promise<AIEditResponse>;

  // Legacy: Custom AI request handler for review mode
  // If provided, the built-in "review" mode will use this handler
  // If not provided, falls back to direct OpenAI API (requires apiKey)
  onAIReviewRequest?: (request: AIReviewRequest) => Promise<AIReviewResponse>;

  // Only used if handlers are not provided (direct OpenAI mode)
  aiModel?: string;
  aiTemperature?: number;

  // Context item resolver for drag/drop - converts DataTransfer to ContextItems
  onResolveContextItems?: (
    dataTransfer: DataTransfer,
  ) => ContextItem[] | Promise<ContextItem[]>;
}

/**
 * Pending track change with context for AI review.
 */
export interface PendingTrackChange {
  id: string;
  type: "insertion" | "deletion";
  text: string;
  author: string | null;
  date: string | null;
  paragraphId: string;
  pos: number; // absolute position in document
  endPos: number;
}

/**
 * Grouped contiguous track changes into blocks.
 * All adjacent changes (no unchanged text between them) become one decision.
 */
export interface GroupedTrackChange {
  // All deletion IDs in this block
  deletionIds: string[];
  // All insertion IDs in this block
  insertionIds: string[];
  // Combined deleted text
  deletedText: string;
  // Combined inserted text
  insertedText: string;
  author: string | null;
}

/**
 * Paragraph info with position in document
 */
export interface ParagraphInfo {
  id: string;
  text: string;
  from: number; // Start of text content (inside paragraph node)
  to: number; // End of text content
}

/**
 * Track changes context for a selection - provides both original and accepted versions.
 */
export interface TrackChangesContext {
  hasTrackChanges: boolean;
  // Original text (what it was before changes - includes deletions, excludes insertions)
  originalText: string;
  // Accepted text (what it will be after changes - excludes deletions, includes insertions)
  acceptedText: string;
  // IDs of paragraphs that contain track changes
  affectedParagraphIds: string[];
}

/**
 * Diff change from computeDiff
 */
export interface DiffChange {
  type: "keep" | "delete" | "insert";
  text: string;
  oldStart: number;
  oldEnd: number;
}

/**
 * Word change for applying edits
 */
export interface WordChange {
  deletedText: string;
  insertedText: string;
  deletionId?: string;
  insertionId?: string;
}
