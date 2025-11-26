// Main component
export { DocumentEditor } from "./DocumentEditor";

// Hooks
export { useDocumentEditor, useTrackChanges, useComments } from "./hooks";

export type {
  UseDocumentEditorReturn,
  UseTrackChangesOptions,
  UseTrackChangesReturn,
  UseCommentsOptions,
  UseCommentsReturn,
} from "./hooks";

// Utilities
export { createExportPayload, downloadBlob, exportToWord } from "./utils";

// Types
export type {
  // Core document types
  TipTapDocument,
  TipTapNode,
  TipTapMark,

  // Comment types
  CommentData,
  SelectionRange,

  // Track changes types
  TrackedChange,
  TrackChangesConfig,

  // Comments config
  CommentsConfig,

  // Styling types
  ClassNameConfig,

  // Extension types
  ExtensionConfig,

  // Toolbar types
  ToolbarItem,

  // Export types
  TemplateConfig,
  ExportOptions,
  ExportPayload,

  // Component types
  EditorHandle,
  DocumentEditorProps,
  UseDocumentEditorOptions,
} from "./types";

// Re-export extensions for custom editor setups
export { Insertion } from "../extensions/Insertion";
export { Deletion } from "../extensions/Deletion";
export { Comment } from "../extensions/Comment";
export { TrackChangesMode } from "../extensions/TrackChangesMode";
export { Section } from "../extensions/Section";
export { TableWithId } from "../extensions/TableWithId";
