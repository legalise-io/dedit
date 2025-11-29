import type { Editor } from "@tiptap/react";
import type { Extension } from "@tiptap/core";

/**
 * TipTap document JSON structure
 */
export interface TipTapDocument {
  type: "doc";
  content: TipTapNode[];
}

export interface TipTapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  marks?: TipTapMark[];
  text?: string;
}

export interface TipTapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

/**
 * Comment data structure
 */
export interface CommentData {
  id: string;
  author: string;
  date: string;
  text: string;
  replies?: CommentData[];
}

/**
 * Tracked change data structure
 */
export interface TrackedChange {
  id: string;
  type: "insertion" | "deletion";
  author: string | null;
  date: string | null;
  text: string;
  from: number;
  to: number;
}

/**
 * Selection range for comments
 */
export interface SelectionRange {
  from: number;
  to: number;
}

/**
 * Track changes configuration
 */
export interface TrackChangesConfig {
  /** Enable track changes mode */
  enabled: boolean;
  /** Current author name for new changes */
  author: string;
  /** Called when enabled state changes (e.g., from toolbar toggle) */
  onEnabledChange?: (enabled: boolean) => void;
  /** Called when author should change (optional) */
  onAuthorChange?: (author: string) => void;
  /** Called when a change is accepted */
  onAccept?: (change: TrackedChange) => void;
  /** Called when a change is rejected */
  onReject?: (change: TrackedChange) => void;
}

/**
 * Comments configuration
 */
export interface CommentsConfig {
  /** Array of comments to display/associate */
  data: CommentData[];
  /** Called when user creates a comment */
  onAdd?: (range: SelectionRange, text: string) => void;
  /** Called when user replies to a comment */
  onReply?: (commentId: string, text: string) => void;
  /** Called when user resolves a comment */
  onResolve?: (commentId: string) => void;
  /** Called when user deletes a comment */
  onDelete?: (commentId: string) => void;
}

/**
 * Granular className configuration
 */
export interface ClassNameConfig {
  /** Root editor container */
  root?: string;
  /** The editable content area */
  content?: string;
  /** Insertion marks */
  insertion?: string;
  /** Deletion marks */
  deletion?: string;
  /** Comment highlights */
  comment?: string;
  /** Tables */
  table?: string;
}

/**
 * Extension configuration options
 */
export interface ExtensionConfig {
  heading?: { levels?: (1 | 2 | 3 | 4 | 5 | 6)[] };
  table?: { resizable?: boolean };
}

/**
 * Available toolbar items
 */
export type ToolbarItem =
  | "bold"
  | "italic"
  | "separator"
  | "undo"
  | "redo"
  | "trackChangesToggle"
  | "acceptChange"
  | "rejectChange"
  | "prevChange"
  | "nextChange"
  | "acceptAll"
  | "rejectAll"
  | "addRowBefore"
  | "addRowAfter"
  | "deleteRow"
  | "findReplace";

/**
 * Template configuration for export
 */
export interface TemplateConfig {
  type: "none" | "original" | "custom";
  /** Original document ID (if type is 'original') */
  documentId?: string;
  /** Template ID (if type is 'custom') */
  templateId?: string;
  /** Template bytes (if type is 'custom' and providing raw data) */
  templateBytes?: ArrayBuffer;
}

/**
 * Export options
 */
export interface ExportOptions {
  /** Include comments in export */
  includeComments?: boolean;
  /** Template configuration */
  template?: TemplateConfig;
  /** Output filename */
  filename?: string;
}

/**
 * Export payload structure (matches backend API)
 */
export interface ExportPayload {
  tiptap: TipTapDocument | Record<string, unknown>;
  comments: CommentData[];
  template: "none" | "original" | "custom";
  document_id?: string;
  template_id?: string;
  filename: string;
}

/**
 * Imperative handle for the DocumentEditor component
 */
export interface EditorHandle {
  /** Get current TipTap JSON */
  getContent(): TipTapDocument | Record<string, unknown>;
  /** Set content programmatically */
  setContent(content: TipTapDocument | Record<string, unknown>): void;
  /** Get all tracked changes */
  getChanges(): TrackedChange[];
  /** Accept a specific change */
  acceptChange(changeId: string): void;
  /** Reject a specific change */
  rejectChange(changeId: string): void;
  /** Accept all changes */
  acceptAllChanges(): void;
  /** Reject all changes */
  rejectAllChanges(): void;
  /** Enable/disable track changes */
  setTrackChangesEnabled(enabled: boolean): void;
  /** Set track changes author */
  setTrackChangesAuthor(author: string): void;
  /** Get underlying TipTap editor instance */
  getEditor(): Editor | null;
  /** Focus the editor */
  focus(): void;
  /** Blur the editor */
  blur(): void;
  /** Create export payload for backend */
  createExportPayload(options?: ExportOptions): ExportPayload;
}

/**
 * Main DocumentEditor component props
 */
export interface DocumentEditorProps {
  /** Initial TipTap JSON content (uncontrolled) */
  initialContent?: TipTapDocument | Record<string, unknown>;
  /** Controlled content */
  content?: TipTapDocument | Record<string, unknown>;
  /** Called on every content change */
  onChange?: (content: TipTapDocument | Record<string, unknown>) => void;
  /** Ref to access editor instance imperatively */
  editorRef?: React.RefObject<EditorHandle | null>;
  /** Make editor read-only */
  readOnly?: boolean;
  /** Placeholder text when empty */
  placeholder?: string;
  /** Track changes configuration */
  trackChanges?: TrackChangesConfig;
  /** Comments configuration */
  comments?: CommentsConfig;
  /** Single className for root */
  className?: string;
  /** Granular className overrides */
  classNames?: ClassNameConfig;
  /** Inline style for root (discouraged but available) */
  style?: React.CSSProperties;
  /** Additional TipTap extensions to include */
  extensions?: Extension[];
  /** Override default extensions entirely */
  replaceExtensions?: Extension[];
  /** Configure built-in extensions */
  extensionConfig?: ExtensionConfig;
  /** Toolbar items to display (e.g., ["bold", "italic"]) */
  toolbar?: ToolbarItem[];
}

/**
 * Hook options for useDocumentEditor
 */
export interface UseDocumentEditorOptions {
  /** Initial content */
  initialContent?: TipTapDocument | Record<string, unknown>;
  /** Called on content change */
  onChange?: (content: TipTapDocument | Record<string, unknown>) => void;
  /** Make editor read-only */
  readOnly?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Additional extensions */
  extensions?: Extension[];
  /** Replace default extensions */
  replaceExtensions?: Extension[];
  /** Extension configuration */
  extensionConfig?: ExtensionConfig;
  /** Track changes enabled by default */
  trackChangesEnabled?: boolean;
  /** Track changes author */
  trackChangesAuthor?: string;
}
