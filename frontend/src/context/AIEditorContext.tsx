import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  ReactNode,
  useMemo,
} from "react";
import { Editor } from "@tiptap/react";

// Import types from the new location
import type {
  AIEdit,
  AIEditorConfig,
  AIMode,
  ChatMessage,
  ModeContext,
  ModeResult,
  ParagraphInfo,
  SelectionContext,
  TrackChangeRecommendation,
} from "../lib/ai/types";
import type { ContextItem } from "../lib/types";

// Import utilities
import {
  buildIndexedDocument,
  getPendingTrackChangesInScope,
  getCleanTextInRange,
} from "../lib/ai/documentUtils";
import { groupTrackChanges } from "../lib/ai/diffUtils";
import { applyEditsAsTrackChanges } from "../lib/ai/applyEdits";
import {
  createEditModeHandler,
  getAvailableModes,
  type HandlerDependencies,
} from "../lib/ai/modes.js";

// Import hooks
import { useAIChat } from "../hooks/ai/useAIChat";
import { useContextItems } from "../hooks/ai/useContextItems";
import { useAIEdits } from "../hooks/ai/useAIEdits";
import { useAIRecommendations } from "../hooks/ai/useAIRecommendations";

// Re-export types for backwards compatibility
export type {
  AIEdit,
  AIResponse,
  ChatMessage,
  SelectionContext,
  AIEditRequest,
  AIEditResponse,
  AIReviewRequest,
  AIReviewResponse,
  ModeContext,
  ModeEdit,
  ModeRecommendation,
  ModeResult,
  AIMode,
  AIEditorConfig,
  TrackChangeRecommendation,
} from "../lib/ai/types";

// ============================================================================
// AI Editor State Interface
// ============================================================================

export interface AIEditorState {
  // Config
  config: AIEditorConfig;
  setConfig: (config: Partial<AIEditorConfig>) => void;

  // Available modes (built-in + custom)
  availableModes: AIMode[];

  // API Key
  apiKey: string | null;
  setApiKey: (key: string | null) => void;

  // Editor reference
  editor: Editor | null;
  setEditor: (editor: Editor | null) => void;

  // Selection context
  selectionContext: SelectionContext;

  // Chat messages
  messages: ChatMessage[];
  addMessage: (message: Omit<ChatMessage, "id" | "timestamp">) => void;
  clearMessages: () => void;

  // Loading state
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;

  // Error state
  error: string | null;
  setError: (error: string | null) => void;

  // Actions
  sendPrompt: (prompt: string, options?: { mode?: AIMode }) => Promise<void>;
  scrollToEdit: (edit: AIEdit) => void;
  goToEditAndSelect: (edit: AIEdit) => void;

  // Accept/Reject paired changes
  acceptEdit: (edit: AIEdit) => void;
  rejectEdit: (edit: AIEdit) => void;

  // Get all pending edits from messages
  getPendingEdits: () => AIEdit[];

  // Get next edit after the given one
  getNextEdit: (currentEdit: AIEdit) => AIEdit | null;

  // Update edit status by track change ID (for external sync)
  updateEditStatusByTrackChangeId: (
    trackChangeId: string,
    status: AIEdit["status"],
  ) => void;

  // Review mode: apply/discard recommendations
  applyRecommendation: (rec: TrackChangeRecommendation) => void;
  discardRecommendation: (rec: TrackChangeRecommendation) => void;
  getPendingRecommendations: () => TrackChangeRecommendation[];
  getNextRecommendation: (
    currentRec: TrackChangeRecommendation,
  ) => TrackChangeRecommendation | null;
  goToRecommendation: (rec: TrackChangeRecommendation) => void;

  // Context items for additional content in prompts
  contextItems: ContextItem[];
  addContextItem: (item: ContextItem) => void;
  addContextItems: (items: ContextItem[]) => void;
  removeContextItem: (id: string) => void;
  clearContextItems: () => void;

  // Resolve context items from a DataTransfer (drag/drop)
  resolveContextItems: (dataTransfer: DataTransfer) => Promise<ContextItem[]>;
}

// ============================================================================
// Context and Constants
// ============================================================================

const AIEditorContext = createContext<AIEditorState | null>(null);

const STORAGE_KEY = "dedit-openai-api-key";

// ============================================================================
// Provider Props
// ============================================================================

interface AIEditorProviderProps {
  children: ReactNode;
  aiAuthorName?: string;
}

// ============================================================================
// Provider Component
// ============================================================================

export function AIEditorProvider({
  children,
  aiAuthorName = "AI",
}: AIEditorProviderProps) {
  // ========== Config State ==========
  const [config, setConfigState] = useState<AIEditorConfig>({
    aiAuthorName,
  });

  const setConfig = useCallback((newConfig: Partial<AIEditorConfig>) => {
    setConfigState((prev) => ({ ...prev, ...newConfig }));
  }, []);

  // ========== API Key State ==========
  const [apiKey, setApiKeyState] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(STORAGE_KEY);
    }
    return null;
  });

  const setApiKey = useCallback((key: string | null) => {
    setApiKeyState(key);
    if (typeof window !== "undefined") {
      if (key) {
        localStorage.setItem(STORAGE_KEY, key);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  // ========== Editor State ==========
  const [editor, setEditorState] = useState<Editor | null>(null);
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  const paragraphMapRef = useRef<Map<string, ParagraphInfo>>(new Map());

  // ========== Selection Context ==========
  const [selectionContext, setSelectionContext] = useState<SelectionContext>({
    text: "",
    from: 0,
    to: 0,
    hasSelection: false,
  });

  const updateSelectionContext = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) {
      setSelectionContext({ text: "", from: 0, to: 0, hasSelection: false });
      return;
    }

    const { from, to } = ed.state.selection;
    const text = ed.state.doc.textBetween(from, to, " ");
    setSelectionContext({
      text,
      from,
      to,
      hasSelection: from !== to && text.length > 0,
    });
  }, []);

  const setEditor = useCallback(
    (newEditor: Editor | null) => {
      setEditorState(newEditor);
      if (newEditor) {
        updateSelectionContext();
        newEditor.on("selectionUpdate", updateSelectionContext);
        newEditor.on("transaction", updateSelectionContext);
      }
    },
    [updateSelectionContext],
  );

  // ========== Context Items Hook ==========
  const contextItemsHook = useContextItems({
    onResolveContextItems: config.onResolveContextItems,
  });

  // ========== Chat Hook ==========
  const chatHook = useAIChat({
    onClearContextItems: contextItemsHook.clearContextItems,
  });

  // ========== Edits Hook ==========
  const editsHook = useAIEdits({
    editorRef,
    messages: chatHook.messages,
    updateEditStatus: chatHook.updateEditStatus,
  });

  // ========== Recommendations Hook ==========
  const recommendationsHook = useAIRecommendations({
    editorRef,
    messages: chatHook.messages,
    updateRecommendationStatus: chatHook.updateRecommendationStatus,
  });

  // ========== Loading & Error State ==========
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ========== Available Modes ==========
  const handlerDeps: HandlerDependencies = useMemo(
    () => ({
      config,
      apiKey,
    }),
    [config, apiKey],
  );

  const availableModes = useMemo(
    () => getAvailableModes(config.modes, handlerDeps),
    [config.modes, handlerDeps],
  );

  // ========== Send Prompt ==========
  const sendPrompt = useCallback(
    async (prompt: string, options?: { mode?: AIMode }) => {
      const ed = editorRef.current;
      if (!ed) {
        setError("Editor not connected");
        return;
      }

      const mode = options?.mode;
      const isReviewMode = mode?.name === "review";

      // Check if we have a way to make AI requests
      const hasCustomHandler = isReviewMode
        ? !!config.onAIReviewRequest
        : !!config.onAIRequest;
      const hasModeHandler = mode?.handler != null;

      if (!hasCustomHandler && !hasModeHandler && !apiKey) {
        setError("Please enter your OpenAI API key");
        return;
      }

      setIsLoading(true);
      setError(null);

      // Get current selection context
      const { from, to } = ed.state.selection;
      // Use clean text (excluding deletions) so AI doesn't see deleted content
      const selectedText = getCleanTextInRange(ed, from, to);
      const hasSelection = from !== to && selectedText.length > 0;

      // Determine scope for track changes
      const scopeFrom = hasSelection ? from : 0;
      const scopeTo = hasSelection ? to : ed.state.doc.content.size;

      // Get pending track changes in scope
      const pendingTrackChanges = getPendingTrackChangesInScope(
        ed,
        scopeFrom,
        scopeTo,
      );
      const hasTrackChanges = pendingTrackChanges.length > 0;

      // If review mode requested but no track changes, return early
      if (isReviewMode && !hasTrackChanges) {
        const message = hasSelection
          ? "No track changes found in the selected text. Select text containing track changes, or clear your selection to review all changes in the document."
          : "No track changes found in the document. There's nothing to review.";

        chatHook.addMessage({
          role: "user",
          content: mode ? `/${mode.name} ${prompt}` : prompt,
          metadata: { isReviewMode: true },
        });
        chatHook.addMessage({
          role: "assistant",
          content: message,
        });
        setIsLoading(false);
        return;
      }

      console.log("[sendPrompt] Mode:", mode?.name || "edit (default)");
      console.log(
        "[sendPrompt] Pending track changes:",
        pendingTrackChanges.length,
      );

      // Build indexed document
      const { paragraphs } = buildIndexedDocument(ed);
      paragraphMapRef.current = paragraphs;

      // Group track changes
      const groupedChanges = groupTrackChanges(pendingTrackChanges);

      // Build the mode context
      const modeContext: ModeContext = {
        prompt,
        selectedText: hasSelection ? selectedText : null,
        hasSelection,
        paragraphs: Array.from(paragraphs.values()).map((p) => ({
          id: p.id,
          text: p.text,
        })),
        trackChanges: pendingTrackChanges,
        groupedChanges,
        contextItems: contextItemsHook.contextItems,
        editor: ed,
      };

      // Add user message
      chatHook.addMessage({
        role: "user",
        content: mode ? `/${mode.name} ${prompt}` : prompt,
        metadata: {
          selectionContext: {
            text: selectedText,
            from,
            to,
            hasSelection,
          },
          contextItems:
            contextItemsHook.contextItems.length > 0
              ? [...contextItemsHook.contextItems]
              : undefined,
          isReviewMode,
        },
      });

      try {
        let result: ModeResult;

        if (mode) {
          // Dispatch to mode handler
          console.log(`[sendPrompt] Dispatching to mode handler: ${mode.name}`);
          result = await mode.handler(modeContext);
        } else {
          // Default edit mode - use legacy path with createEditModeHandler
          console.log("[sendPrompt] Using default edit mode");
          const editHandler = createEditModeHandler({
            config,
            apiKey,
          });
          result = await editHandler(modeContext);
        }

        // Process the result based on what was returned
        if (result.recommendations && result.recommendations.length > 0) {
          // ========== REVIEW-TYPE RESULT ==========
          const recommendations: TrackChangeRecommendation[] = [];
          for (const rec of result.recommendations) {
            const grouped = groupedChanges[rec.index];
            if (!grouped) {
              console.warn(
                `[sendPrompt] Invalid recommendation index: ${rec.index}`,
              );
              continue;
            }

            recommendations.push({
              id: `rec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              deletionIds: grouped.deletionIds,
              insertionIds: grouped.insertionIds,
              deletedText: grouped.deletedText,
              insertedText: grouped.insertedText,
              recommendation: rec.recommendation,
              reason: rec.reason,
              status: "pending",
              author: grouped.author,
            });
          }

          console.log(
            `[sendPrompt] Created ${recommendations.length} recommendations`,
          );

          chatHook.addMessage({
            role: "assistant",
            content: result.message || "Review complete.",
            metadata: {
              recommendations:
                recommendations.length > 0 ? recommendations : undefined,
              isReviewMode: true,
            },
          });

          // Navigate to first recommendation
          if (recommendations.length > 0) {
            setTimeout(
              () => recommendationsHook.goToRecommendation(recommendations[0]),
              200,
            );
          }
        } else if (result.edits && result.edits.length > 0) {
          // ========== EDIT-TYPE RESULT ==========
          let processedEdits: AIEdit[] = [];
          try {
            processedEdits = applyEditsAsTrackChanges(
              ed,
              result.edits,
              config.aiAuthorName || "AI",
            );
            console.log(
              `[sendPrompt] Applied ${result.edits.length} paragraph edits, got ${processedEdits.length} word-level edits`,
            );
          } catch (applyErr) {
            console.error("[sendPrompt] Error applying edits:", applyErr);
          }

          chatHook.addMessage({
            role: "assistant",
            content: result.message || "No message provided",
            metadata: {
              edits: processedEdits.length > 0 ? processedEdits : undefined,
            },
          });
        } else {
          // ========== MESSAGE-ONLY RESULT ==========
          chatHook.addMessage({
            role: "assistant",
            content: result.message || "No message provided",
          });
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "An error occurred";
        setError(errorMessage);
        chatHook.addMessage({
          role: "system",
          content: `Error: ${errorMessage}`,
        });
      } finally {
        setIsLoading(false);
      }
    },
    [
      apiKey,
      chatHook,
      config,
      contextItemsHook.contextItems,
      recommendationsHook,
    ],
  );

  // ========== Build Context Value ==========
  const value: AIEditorState = {
    // Config
    config,
    setConfig,
    availableModes,

    // API Key
    apiKey,
    setApiKey,

    // Editor
    editor,
    setEditor,
    selectionContext,

    // Chat (from hook)
    messages: chatHook.messages,
    addMessage: chatHook.addMessage,
    clearMessages: chatHook.clearMessages,

    // Loading/Error
    isLoading,
    setIsLoading,
    error,
    setError,

    // Actions
    sendPrompt,

    // Edits (from hook)
    scrollToEdit: editsHook.scrollToEdit,
    goToEditAndSelect: editsHook.goToEditAndSelect,
    acceptEdit: editsHook.acceptEdit,
    rejectEdit: editsHook.rejectEdit,
    getPendingEdits: editsHook.getPendingEdits,
    getNextEdit: editsHook.getNextEdit,
    updateEditStatusByTrackChangeId: chatHook.updateEditStatusByTrackChangeId,

    // Recommendations (from hook)
    applyRecommendation: recommendationsHook.applyRecommendation,
    discardRecommendation: recommendationsHook.discardRecommendation,
    getPendingRecommendations: recommendationsHook.getPendingRecommendations,
    getNextRecommendation: recommendationsHook.getNextRecommendation,
    goToRecommendation: recommendationsHook.goToRecommendation,

    // Context items (from hook)
    contextItems: contextItemsHook.contextItems,
    addContextItem: contextItemsHook.addContextItem,
    addContextItems: contextItemsHook.addContextItems,
    removeContextItem: contextItemsHook.removeContextItem,
    clearContextItems: contextItemsHook.clearContextItems,
    resolveContextItems: contextItemsHook.resolveContextItems,
  };

  return (
    <AIEditorContext.Provider value={value}>
      {children}
    </AIEditorContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

export function useAIEditor(): AIEditorState {
  const context = useContext(AIEditorContext);
  if (!context) {
    throw new Error("useAIEditor must be used within an AIEditorProvider");
  }
  return context;
}

export function useAIEditorOptional(): AIEditorState | null {
  return useContext(AIEditorContext);
}
