// Main component
export { DocumentEditor } from "./DocumentEditor";

// Hooks
export {
  useDocumentEditor,
  useTrackChanges,
  useComments,
  useCollaboration,
  generateUserColor,
  getUserColor,
  getAuthorColor,
  getAuthorPrimaryColor,
  getAuthorColorStyles,
  AUTHOR_COLORS,
} from "./hooks";

export type {
  UseDocumentEditorReturn,
  UseTrackChangesOptions,
  UseTrackChangesReturn,
  UseCommentsOptions,
  UseCommentsReturn,
  UseCollaborationOptions,
  UseCollaborationReturn,
  CollaborationUser,
  AuthorColor,
} from "./hooks";

// Utilities
export { createExportPayload, downloadBlob, exportToWord } from "./utils";

// AI Components
export { APIKeyInput, AIChatPanel, PromptInput } from "../components/ai";

// AI Context and Hooks
export {
  AIEditorProvider,
  useAIEditor,
  useAIEditorOptional,
} from "../context/AIEditorContext";

// AI Types
export type {
  AIEditorState,
  AIEditorConfig,
  ChatMessage,
  SelectionContext,
  AIEdit,
  AIResponse,
  AIEditRequest,
  AIEditResponse,
} from "../context/AIEditorContext";

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
  TrackChangeRecommendation,
  TrackChangesConfig,

  // Comments config
  CommentsConfig,

  // Styling types
  ClassNameConfig,

  // Extension types
  ExtensionConfig,

  // Toolbar types
  ToolbarItem,
  BuiltInToolbarItem,

  // Export types
  TemplateConfig,
  ExportOptions,
  ExportPayload,

  // Component types
  EditorHandle,
  DocumentEditorProps,
  UseDocumentEditorOptions,

  // Context items types
  ContextItem,
  ContextItemResolver,
} from "./types";

// Re-export extensions for custom editor setups
export { Insertion } from "../extensions/Insertion";
export { Deletion } from "../extensions/Deletion";
export { Comment } from "../extensions/Comment";
export { TrackChangesMode } from "../extensions/TrackChangesMode";
export { Section } from "../extensions/Section";
export { TableWithId } from "../extensions/TableWithId";
export { ParagraphWithId } from "../extensions/ParagraphWithId";
export { PersistentSelection } from "../extensions/PersistentSelection";
export { SearchAndReplace } from "../extensions/SearchAndReplace";

// UI Components
export { FindReplaceBar } from "../components/FindReplaceBar";
