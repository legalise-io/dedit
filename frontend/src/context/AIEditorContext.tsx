import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { Editor } from "@tiptap/react";
import { diffWords } from "diff";
import type { ContextItem, ContextItemResolver } from "../lib/types";

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
    // Edits associated with this message
    edits?: AIEdit[];
    // Context items included with this message
    contextItems?: ContextItem[];
  };
}

export interface SelectionContext {
  text: string;
  from: number;
  to: number;
  hasSelection: boolean;
}

// Request/Response types for custom AI handler
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

export interface AIEditorConfig {
  aiAuthorName?: string;

  // Custom AI request handler - if provided, all AI calls go through this
  // If not provided, falls back to direct OpenAI API (requires apiKey)
  onAIRequest?: (request: AIEditRequest) => Promise<AIEditResponse>;

  // Only used if onAIRequest is not provided (direct OpenAI mode)
  aiModel?: string;
  aiTemperature?: number;

  // Context item resolver for drag/drop - converts DataTransfer to ContextItems
  onResolveContextItems?: ContextItemResolver;
}

export interface AIEditorState {
  // Config
  config: AIEditorConfig;
  setConfig: (config: Partial<AIEditorConfig>) => void;

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
  sendPrompt: (prompt: string) => Promise<void>;
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

  // Context items for additional content in prompts
  contextItems: ContextItem[];
  addContextItem: (item: ContextItem) => void;
  addContextItems: (items: ContextItem[]) => void;
  removeContextItem: (id: string) => void;
  clearContextItems: () => void;

  // Resolve context items from a DataTransfer (drag/drop)
  resolveContextItems: (dataTransfer: DataTransfer) => Promise<ContextItem[]>;
}

const AIEditorContext = createContext<AIEditorState | null>(null);

const STORAGE_KEY = "dedit-openai-api-key";

// Generate unique ID
const generateId = () =>
  `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const generateEditId = () =>
  `edit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

interface AIEditorProviderProps {
  children: ReactNode;
  aiAuthorName?: string;
}

interface ParagraphInfo {
  id: string;
  text: string;
  from: number; // Start of text content (inside paragraph node)
  to: number; // End of text content
}

/**
 * Extract "clean" text from a paragraph node, excluding deleted text.
 * This walks through the node's children and skips any text with deletion marks.
 * Inserted text is included as it represents the current state.
 */
function getCleanTextFromNode(node: import("@tiptap/pm/model").Node): string {
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
 * Track changes context for a selection - provides both original and accepted versions.
 */
interface TrackChangesContext {
  hasTrackChanges: boolean;
  // Original text (what it was before changes - includes deletions, excludes insertions)
  originalText: string;
  // Accepted text (what it would be if all changes accepted - excludes deletions, includes insertions)
  acceptedText: string;
  // Paragraph IDs that contain track changes within the selection
  affectedParagraphIds: string[];
}

/**
 * Extract track changes context from a selection range.
 * Returns both "original" (deletions included, insertions excluded) and
 * "accepted" (deletions excluded, insertions included) versions of the selected text.
 */
function getTrackChangesContext(
  editor: Editor,
  from: number,
  to: number,
): TrackChangesContext {
  const doc = editor.state.doc;
  let originalText = "";
  let acceptedText = "";
  let hasTrackChanges = false;
  const affectedParagraphIds: string[] = [];

  // Walk through the selection range
  doc.nodesBetween(from, to, (node, _pos) => {
    if (node.type.name === "paragraph") {
      const paragraphId = node.attrs.id;
      let paragraphHasChanges = false;

      // Check each text node in the paragraph
      node.descendants((child) => {
        if (child.isText && child.text) {
          const hasDeletion = child.marks.some(
            (mark) => mark.type.name === "deletion",
          );
          const hasInsertion = child.marks.some(
            (mark) => mark.type.name === "insertion",
          );

          if (hasDeletion || hasInsertion) {
            hasTrackChanges = true;
            paragraphHasChanges = true;
          }

          // Original text: include deletions, exclude insertions
          if (!hasInsertion) {
            originalText += child.text;
          }

          // Accepted text: exclude deletions, include insertions
          if (!hasDeletion) {
            acceptedText += child.text;
          }
        }
        return true;
      });

      if (paragraphHasChanges && paragraphId) {
        affectedParagraphIds.push(paragraphId);
      }
    }
    return true;
  });

  return {
    hasTrackChanges,
    originalText,
    acceptedText,
    affectedParagraphIds,
  };
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
function buildIndexedDocument(editor: Editor): {
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
function findParagraphById(
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
 * Compute word-level diff between two strings using the diff library.
 * Returns array of changes with positions relative to the old string.
 */
function computeDiff(
  oldStr: string,
  newStr: string,
): Array<{
  type: "keep" | "delete" | "insert";
  text: string;
  oldStart: number;
  oldEnd: number;
}> {
  const wordDiff = diffWords(oldStr, newStr);
  const changes: Array<{
    type: "keep" | "delete" | "insert";
    text: string;
    oldStart: number;
    oldEnd: number;
  }> = [];

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
 * Build the system prompt for OpenAI with paragraph-based editing instructions.
 */
function buildSystemPrompt(
  indexedDocument: string,
  hasSelection: boolean,
  selectedText: string,
  contextItems: ContextItem[] = [],
  trackChangesContext?: TrackChangesContext,
): string {
  let prompt = `You are an AI writing assistant helping to edit documents. You can answer questions about the document or suggest edits.

## Document Format
The document is provided with each paragraph identified by a unique ID in square brackets.
Format: [paragraph-id] paragraph text

IMPORTANT: The document shown below represents the CURRENT state of the text. Any pending deletions have already been excluded from this view - you are seeing only the text that is currently visible to the user. Work with this text as-is.

## Your Response Format
You MUST respond with valid JSON matching this exact schema:
{
  "message": "Your response text explaining what you did or answering the question",
  "edits": [
    {
      "paragraphId": "the-uuid-from-the-document",
      "newText": "the complete new text for this paragraph",
      "reason": "brief explanation of what changed"
    }
  ]
}

## CRITICAL Rules
1. The "message" field is REQUIRED - always explain what you did or answer the question
2. The "edits" array is OPTIONAL - only include it if you're suggesting changes
3. The "paragraphId" MUST be copied exactly from the document - it's the UUID in brackets before each paragraph
4. The "newText" should be the COMPLETE new text for the paragraph (not just the changed part)
5. If you need to change multiple things in one paragraph, provide ONE edit with all changes in newText
6. If you need to change multiple paragraphs, provide multiple edit objects
7. If no edits are needed (e.g., answering a question), omit the "edits" field entirely
8. Do NOT include any HTML tags, XML tags, or markup in your newText - provide plain text only

## Example
If the document contains:
[abc-123] The colour of the sky is blue.
[def-456] Birds fly in the sky.

And the user asks to change British spellings to American, respond:
{
  "message": "I've changed 'colour' to 'color' in the first paragraph.",
  "edits": [
    {
      "paragraphId": "abc-123",
      "newText": "The color of the sky is blue.",
      "reason": "Changed British spelling 'colour' to American 'color'"
    }
  ]
}

## Current Document
${indexedDocument}
`;

  if (hasSelection && trackChangesContext?.hasTrackChanges) {
    // Selection contains track changes - show both versions
    prompt += `
## User Selection (Contains Pending Edits)
The user has selected a section that contains pending track changes. Someone has edited this text - some content was deleted (shown in ORIGINAL) and some content was added (shown in CURRENT).

**ORIGINAL VERSION** (text BEFORE edits - includes deleted content that is currently crossed out):
"${trackChangesContext.originalText}"

**CURRENT VERSION** (text AFTER edits - the new/replacement text):
"${trackChangesContext.acceptedText}"

**Affected Paragraph IDs:** ${trackChangesContext.affectedParagraphIds.join(", ")}

CRITICAL INSTRUCTIONS:
1. You can use content from EITHER version or BOTH versions to construct your response
2. If the user asks to "restore", "re-include", "bring back", or "keep" something, look for it in the ORIGINAL VERSION - that content was deleted and needs to be put back
3. Your newText completely REPLACES the paragraph - include ALL text you want to keep
4. Combine elements from both versions as needed to fulfill the user's request
5. The user is asking you to resolve these pending edits by producing the final desired text
`;
  } else if (hasSelection) {
    prompt += `
## User Selection
The user has selected text: "${selectedText}"

If the user asks to edit or change something without specifying where, apply changes to paragraphs containing this selection.
`;
  } else {
    prompt += `
## No Selection
The user has not selected any text. If they ask for edits, apply changes globally across all relevant paragraphs.
`;
  }

  // Add context items if provided
  if (contextItems.length > 0) {
    prompt += `
## Additional Context
The user has provided the following additional context items. Use this information to inform your response:

`;
    for (const item of contextItems) {
      prompt += `### ${item.label} (${item.type}${item.mimeType ? `, ${item.mimeType}` : ""})
\`\`\`
${item.content}
\`\`\`

`;
    }
  }

  return prompt;
}

export function AIEditorProvider({
  children,
  aiAuthorName = "AI",
}: AIEditorProviderProps) {
  // Config
  const [config, setConfigState] = useState<AIEditorConfig>({
    aiAuthorName,
  });

  const setConfig = useCallback((newConfig: Partial<AIEditorConfig>) => {
    setConfigState((prev) => ({ ...prev, ...newConfig }));
  }, []);

  // API Key - persisted in localStorage
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

  // Editor reference
  const [editor, setEditor] = useState<Editor | null>(null);
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  // Store paragraph info for lookups
  const paragraphMapRef = useRef<Map<string, ParagraphInfo>>(new Map());

  // Selection context - tracked from editor
  const [selectionContext, setSelectionContext] = useState<SelectionContext>({
    text: "",
    from: 0,
    to: 0,
    hasSelection: false,
  });

  // Update selection context when editor changes
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

  // Set up editor with selection tracking
  const setEditorWithTracking = useCallback(
    (newEditor: Editor | null) => {
      setEditor(newEditor);
      if (newEditor) {
        // Initial selection update
        updateSelectionContext();

        // Listen for selection changes
        newEditor.on("selectionUpdate", updateSelectionContext);
        newEditor.on("transaction", updateSelectionContext);
      }
    },
    [updateSelectionContext],
  );

  // Chat messages
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const addMessage = useCallback(
    (message: Omit<ChatMessage, "id" | "timestamp">) => {
      const newMessage: ChatMessage = {
        ...message,
        id: generateId(),
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, newMessage]);
      return newMessage;
    },
    [],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    // Also clear context items when clearing chat history
    setContextItems([]);
  }, []);

  // Loading and error states
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Context items state
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);

  const addContextItem = useCallback((item: ContextItem) => {
    setContextItems((prev) => {
      // Avoid duplicates by ID
      if (prev.some((i) => i.id === item.id)) {
        return prev;
      }
      return [...prev, item];
    });
  }, []);

  const addContextItems = useCallback((items: ContextItem[]) => {
    setContextItems((prev) => {
      const existingIds = new Set(prev.map((i) => i.id));
      const newItems = items.filter((item) => !existingIds.has(item.id));
      return [...prev, ...newItems];
    });
  }, []);

  const removeContextItem = useCallback((id: string) => {
    setContextItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearContextItems = useCallback(() => {
    setContextItems([]);
  }, []);

  // Resolve context items from DataTransfer using config resolver
  const resolveContextItems = useCallback(
    async (dataTransfer: DataTransfer): Promise<ContextItem[]> => {
      if (!config.onResolveContextItems) {
        return [];
      }
      try {
        const items = await config.onResolveContextItems(dataTransfer);
        return items;
      } catch (err) {
        console.error("[resolveContextItems] Error:", err);
        return [];
      }
    },
    [config],
  );

  // Scroll to an edit in the editor
  const scrollToEdit = useCallback((edit: AIEdit) => {
    const ed = editorRef.current;
    if (!ed) return;

    // Try to find by track change ID first (prefer deletion, fallback to insertion)
    const trackChangeId = edit.deletionId || edit.insertionId;
    if (trackChangeId) {
      const editorDom = ed.view.dom;
      const element = editorDom.querySelector(
        `[data-insertion-id="${trackChangeId}"], [data-deletion-id="${trackChangeId}"]`,
      );
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }

    // Fallback: find the paragraph by ID
    const para = findParagraphById(ed, edit.paragraphId);
    if (para) {
      ed.commands.focus();
      ed.commands.setTextSelection(para.from);
      const domAtPos = ed.view.domAtPos(para.from);
      if (domAtPos.node) {
        const element =
          domAtPos.node instanceof Element
            ? domAtPos.node
            : domAtPos.node.parentElement;
        element?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, []);

  // Go to edit and select the track change
  const goToEditAndSelect = useCallback(
    (edit: AIEdit) => {
      const ed = editorRef.current;
      if (!ed) return;

      console.log("[goToEditAndSelect] Called with edit:", edit);

      // Try to find and select by track change ID (prefer deletion, fallback to insertion)
      const trackChangeId = edit.deletionId || edit.insertionId;
      if (trackChangeId) {
        const editorDom = ed.view.dom;

        // Find the element
        const element = editorDom.querySelector(
          `[data-insertion-id="${trackChangeId}"], [data-deletion-id="${trackChangeId}"]`,
        );

        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });

          // Find its index among all track changes for the event
          const allChanges = editorDom.querySelectorAll(
            "ins[data-insertion-id], del[data-deletion-id]",
          );
          let targetIndex = -1;
          allChanges.forEach((el, idx) => {
            const id =
              el.getAttribute("data-insertion-id") ||
              el.getAttribute("data-deletion-id");
            if (id === trackChangeId) {
              targetIndex = idx;
            }
          });

          if (targetIndex >= 0) {
            window.dispatchEvent(
              new CustomEvent("ai-select-change", {
                detail: { index: targetIndex, changeId: trackChangeId },
              }),
            );
          }
          return;
        }
      }

      // Fallback: scroll to paragraph
      scrollToEdit(edit);
    },
    [scrollToEdit],
  );

  // Get all pending/applied edits from messages
  const getPendingEdits = useCallback((): AIEdit[] => {
    const allEdits: AIEdit[] = [];
    for (const message of messages) {
      if (message.metadata?.edits) {
        for (const edit of message.metadata.edits) {
          if (edit.status === "pending" || edit.status === "applied") {
            allEdits.push(edit);
          }
        }
      }
    }
    return allEdits;
  }, [messages]);

  // Get the next edit after the current one
  const getNextEdit = useCallback(
    (currentEdit: AIEdit): AIEdit | null => {
      const allEdits = getPendingEdits();
      const currentIndex = allEdits.findIndex((e) => e.id === currentEdit.id);
      if (currentIndex >= 0 && currentIndex < allEdits.length - 1) {
        return allEdits[currentIndex + 1];
      }
      return null;
    },
    [getPendingEdits],
  );

  // Update edit status in messages
  const updateEditStatus = useCallback(
    (editId: string, status: AIEdit["status"]) => {
      setMessages((prevMessages) =>
        prevMessages.map((message) => {
          if (!message.metadata?.edits) return message;
          const updatedEdits = message.metadata.edits.map((edit) =>
            edit.id === editId ? { ...edit, status } : edit,
          );
          return {
            ...message,
            metadata: { ...message.metadata, edits: updatedEdits },
          };
        }),
      );
    },
    [],
  );

  // Update edit status by track change ID (deletion or insertion ID)
  // This is used when changes are accepted/rejected via context menu or toolbar
  const updateEditStatusByTrackChangeId = useCallback(
    (trackChangeId: string, status: AIEdit["status"]) => {
      setMessages((prevMessages) =>
        prevMessages.map((message) => {
          if (!message.metadata?.edits) return message;
          const updatedEdits = message.metadata.edits.map((edit) => {
            // Match by either deletionId or insertionId
            if (
              edit.deletionId === trackChangeId ||
              edit.insertionId === trackChangeId
            ) {
              return { ...edit, status };
            }
            return edit;
          });
          return {
            ...message,
            metadata: { ...message.metadata, edits: updatedEdits },
          };
        }),
      );
    },
    [],
  );

  // Accept a paired edit (both deletion and insertion)
  const acceptEdit = useCallback(
    (edit: AIEdit) => {
      const ed = editorRef.current;
      if (!ed) return;

      console.log("[acceptEdit] Accepting edit:", edit);

      // Accept both deletion and insertion if they exist
      if (edit.deletionId) {
        ed.commands.acceptDeletion(edit.deletionId);
      }
      if (edit.insertionId) {
        ed.commands.acceptInsertion(edit.insertionId);
      }

      // Update edit status
      updateEditStatus(edit.id, "accepted");

      // Auto-advance to next edit
      const nextEdit = getNextEdit(edit);
      if (nextEdit) {
        // Small delay to let the DOM update after accepting
        setTimeout(() => {
          goToEditAndSelect(nextEdit);
        }, 100);
      }
    },
    [updateEditStatus, getNextEdit, goToEditAndSelect],
  );

  // Reject a paired edit (both deletion and insertion)
  const rejectEdit = useCallback(
    (edit: AIEdit) => {
      const ed = editorRef.current;
      if (!ed) return;

      console.log("[rejectEdit] Rejecting edit:", edit);

      // Reject both deletion and insertion if they exist
      if (edit.deletionId) {
        ed.commands.rejectDeletion(edit.deletionId);
      }
      if (edit.insertionId) {
        ed.commands.rejectInsertion(edit.insertionId);
      }

      // Update edit status
      updateEditStatus(edit.id, "rejected");

      // Auto-advance to next edit
      const nextEdit = getNextEdit(edit);
      if (nextEdit) {
        // Small delay to let the DOM update after rejecting
        setTimeout(() => {
          goToEditAndSelect(nextEdit);
        }, 100);
      }
    },
    [updateEditStatus, getNextEdit, goToEditAndSelect],
  );

  // Represents a paired word change (deletion + insertion)
  interface WordChange {
    deletedText: string;
    insertedText: string;
    deletionId?: string;
    insertionId?: string;
  }

  // Apply a single paragraph edit and return individual word changes
  const applyParagraphEdit = useCallback(
    (
      ed: Editor,
      paragraphId: string,
      newText: string,
      authorName: string,
      reason?: string,
    ): AIEdit[] => {
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
          if (
            next &&
            next.type === "insert" &&
            next.oldStart === current.oldEnd
          ) {
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
    },
    [],
  );

  // Accept all track changes within a specific paragraph
  const acceptAllChangesInParagraph = useCallback(
    (ed: Editor, paragraphId: string) => {
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
    },
    [],
  );

  // Apply paragraph edits from AI response and return word-level AIEdits
  const applyEditsAsTrackChanges = useCallback(
    (
      paragraphEdits: Array<{
        paragraphId: string;
        newText: string;
        reason?: string;
      }>,
      authorName: string,
    ): AIEdit[] => {
      const ed = editorRef.current;
      if (!ed || paragraphEdits.length === 0) return [];

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
    },
    [applyParagraphEdit, acceptAllChangesInParagraph],
  );

  // Send prompt to AI (either via custom handler or direct OpenAI)
  const sendPrompt = useCallback(
    async (prompt: string) => {
      // Check if we have a way to make AI requests
      const hasCustomHandler = !!config.onAIRequest;
      if (!hasCustomHandler && !apiKey) {
        setError("Please enter your OpenAI API key");
        return;
      }

      const ed = editorRef.current;
      if (!ed) {
        setError("Editor not connected");
        return;
      }

      setIsLoading(true);
      setError(null);

      // Get current selection context
      const { from, to } = ed.state.selection;
      const selectedText = ed.state.doc.textBetween(from, to, " ");
      const hasSelection = from !== to && selectedText.length > 0;

      // Check for track changes in selection
      const trackChangesContext = hasSelection
        ? getTrackChangesContext(ed, from, to)
        : undefined;

      if (trackChangesContext?.hasTrackChanges) {
        console.log("[sendPrompt] Selection contains track changes:");
        console.log("  Original:", trackChangesContext.originalText);
        console.log("  Accepted:", trackChangesContext.acceptedText);
        console.log(
          "  Affected paragraphs:",
          trackChangesContext.affectedParagraphIds,
        );
      }

      // Build indexed document for AI
      const { document: indexedDocument, paragraphs } =
        buildIndexedDocument(ed);
      paragraphMapRef.current = paragraphs;

      console.log(
        "[sendPrompt] Indexed document:",
        indexedDocument.substring(0, 500) + "...",
      );

      // Add user message with context items
      addMessage({
        role: "user",
        content: prompt,
        metadata: {
          selectionContext: {
            text: selectedText,
            from,
            to,
            hasSelection,
          },
          // Store context items in the message for chat history
          contextItems: contextItems.length > 0 ? [...contextItems] : undefined,
        },
      });

      try {
        let aiResponse: AIResponse;

        if (config.onAIRequest) {
          // Use custom handler (backend proxy mode)
          console.log("[sendPrompt] Using custom onAIRequest handler");

          // Build request for custom handler
          const paragraphArray = Array.from(paragraphs.values()).map((p) => ({
            id: p.id,
            text: p.text,
          }));

          const request: AIEditRequest = {
            prompt,
            paragraphs: paragraphArray,
            selection: hasSelection
              ? { text: selectedText, hasSelection: true }
              : undefined,
            contextItems: contextItems.length > 0 ? contextItems : undefined,
          };

          const response = await config.onAIRequest(request);
          aiResponse = {
            message: response.message,
            edits: response.edits.map((e) => ({
              paragraphId: e.paragraphId,
              newText: e.newText,
              reason: e.reason,
            })),
          };

          console.log(
            "[sendPrompt] Custom handler response - message:",
            aiResponse.message?.substring(0, 100),
          );
          console.log(
            "[sendPrompt] Custom handler response - edits:",
            aiResponse.edits?.length || 0,
          );
        } else {
          // Direct OpenAI API mode
          console.log("[sendPrompt] Using direct OpenAI API");

          // Build system prompt
          const systemPrompt = buildSystemPrompt(
            indexedDocument,
            hasSelection,
            selectedText,
            contextItems,
            trackChangesContext,
          );

          console.log("[sendPrompt] Full system prompt:\n", systemPrompt);

          // Define JSON schema for structured output
          const responseSchema = {
            type: "json_schema",
            json_schema: {
              name: "ai_edit_response",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  message: {
                    type: "string",
                    description: "Response message explaining what was done",
                  },
                  edits: {
                    type: "array",
                    description:
                      "Array of paragraph edits (empty if no changes needed)",
                    items: {
                      type: "object",
                      properties: {
                        paragraphId: {
                          type: "string",
                          description: "The UUID of the paragraph to edit",
                        },
                        newText: {
                          type: "string",
                          description:
                            "The complete new text for the paragraph",
                        },
                        reason: {
                          type: "string",
                          description: "Brief explanation of what was changed",
                        },
                      },
                      required: ["paragraphId", "newText", "reason"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["message", "edits"],
                additionalProperties: false,
              },
            },
          };

          const response = await fetch(
            "https://api.openai.com/v1/chat/completions",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model: config.aiModel || "gpt-4.1-mini",
                messages: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: prompt },
                ],
                temperature: config.aiTemperature ?? 1.0,
                max_completion_tokens: 16384,
                response_format: responseSchema,
              }),
            },
          );

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(
              errorData.error?.message ||
                `API request failed: ${response.status}`,
            );
          }

          const data = await response.json();
          const assistantContent = data.choices?.[0]?.message?.content || "{}";
          console.log(
            "[sendPrompt] Raw response:",
            assistantContent.substring(0, 500) + "...",
          );

          // Parse the JSON response
          try {
            aiResponse = JSON.parse(assistantContent);
            console.log(
              "[sendPrompt] Parsed - message:",
              aiResponse.message?.substring(0, 100),
            );
            console.log(
              "[sendPrompt] Parsed - edits:",
              aiResponse.edits?.length || 0,
            );
          } catch (parseErr) {
            console.error("[sendPrompt] JSON parse failed:", parseErr);
            aiResponse = { message: assistantContent, edits: [] };
          }
        }

        // Apply edits as track changes and get word-level AIEdit objects
        let processedEdits: AIEdit[] = [];
        if (aiResponse.edits && aiResponse.edits.length > 0) {
          try {
            // Pass paragraph edits directly to applyEditsAsTrackChanges
            // It will compute diffs and return word-level AIEdit objects
            processedEdits = applyEditsAsTrackChanges(
              aiResponse.edits,
              config.aiAuthorName || "AI",
            );
            console.log(
              `[sendPrompt] Applied ${aiResponse.edits.length} paragraph edits, got ${processedEdits.length} word-level edits`,
            );
          } catch (applyErr) {
            console.error("[sendPrompt] Error applying edits:", applyErr);
          }
        }

        // Add assistant message
        console.log(
          "[sendPrompt] Adding message:",
          aiResponse.message?.substring(0, 100),
        );
        addMessage({
          role: "assistant",
          content: aiResponse.message || "No message provided",
          metadata: {
            edits: processedEdits.length > 0 ? processedEdits : undefined,
          },
        });
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "An error occurred";
        setError(errorMessage);
        addMessage({
          role: "system",
          content: `Error: ${errorMessage}`,
        });
      } finally {
        setIsLoading(false);
      }
    },
    [apiKey, addMessage, applyEditsAsTrackChanges, config, contextItems],
  );

  const value: AIEditorState = {
    config,
    setConfig,
    apiKey,
    setApiKey,
    editor,
    setEditor: setEditorWithTracking,
    selectionContext,
    messages,
    addMessage,
    clearMessages,
    isLoading,
    setIsLoading,
    error,
    setError,
    sendPrompt,
    scrollToEdit,
    goToEditAndSelect,
    acceptEdit,
    rejectEdit,
    getPendingEdits,
    getNextEdit,
    updateEditStatusByTrackChangeId,
    contextItems,
    addContextItem,
    addContextItems,
    removeContextItem,
    clearContextItems,
    resolveContextItems,
  };

  return (
    <AIEditorContext.Provider value={value}>
      {children}
    </AIEditorContext.Provider>
  );
}

// Hook to use the AI Editor context
export function useAIEditor(): AIEditorState {
  const context = useContext(AIEditorContext);
  if (!context) {
    throw new Error("useAIEditor must be used within an AIEditorProvider");
  }
  return context;
}

// Optional hook for components that may be outside the provider
export function useAIEditorOptional(): AIEditorState | null {
  return useContext(AIEditorContext);
}
