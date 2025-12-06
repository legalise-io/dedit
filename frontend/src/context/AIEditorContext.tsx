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
import type {
  ContextItem,
  ContextItemResolver,
  TrackChangeRecommendation,
} from "../lib/types";

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
  sendPrompt: (
    prompt: string,
    options?: { forceReviewMode?: boolean },
  ) => Promise<void>;
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
 * Parse the /review command from a prompt.
 * Returns the prompt text without the command prefix.
 */
function parseReviewCommand(prompt: string): {
  isReviewCommand: boolean;
  promptText: string;
} {
  const trimmed = prompt.trim();
  const reviewMatch = trimmed.match(/^\/review\s*(.*)/i);

  if (reviewMatch) {
    return {
      isReviewCommand: true,
      promptText: reviewMatch[1] || "",
    };
  }

  return {
    isReviewCommand: false,
    promptText: trimmed,
  };
}

/**
 * Pending track change with context for AI review.
 */
interface PendingTrackChange {
  id: string;
  type: "insertion" | "deletion";
  text: string;
  author: string | null;
  date: string | null;
  paragraphId: string;
  pos: number; // absolute position in document
  endPos: number; // end position
}

/**
 * Get all pending track changes within a given range.
 */
function getPendingTrackChangesInScope(
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

/**
 * Group contiguous track changes into blocks.
 * All adjacent changes (no unchanged text between them) become one decision.
 */
interface GroupedTrackChange {
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

function groupTrackChanges(
  changes: PendingTrackChange[],
): GroupedTrackChange[] {
  if (changes.length === 0) return [];

  // Sort by position
  const sorted = [...changes].sort((a, b) => a.pos - b.pos);

  const grouped: GroupedTrackChange[] = [];

  let currentBlock: GroupedTrackChange = {
    deletionIds: [],
    insertionIds: [],
    deletedText: "",
    insertedText: "",
    author: null,
  };
  let blockEndPos = -1;

  for (const change of sorted) {
    // If there's a gap, start a new block
    if (blockEndPos !== -1 && change.pos > blockEndPos) {
      grouped.push(currentBlock);
      currentBlock = {
        deletionIds: [],
        insertionIds: [],
        deletedText: "",
        insertedText: "",
        author: null,
      };
    }

    // Add to current block
    if (change.type === "deletion") {
      currentBlock.deletionIds.push(change.id);
      currentBlock.deletedText += change.text;
    } else {
      currentBlock.insertionIds.push(change.id);
      currentBlock.insertedText += change.text;
    }
    if (!currentBlock.author) {
      currentBlock.author = change.author;
    }

    // Track furthest end position
    blockEndPos = Math.max(blockEndPos, change.endPos);
  }

  // Push final block
  if (
    currentBlock.deletionIds.length > 0 ||
    currentBlock.insertionIds.length > 0
  ) {
    grouped.push(currentBlock);
  }

  return grouped;
}

/**
 * Build the system prompt for review mode.
 */
function buildReviewSystemPrompt(
  groupedChanges: GroupedTrackChange[],
  userCriteria: string,
): string {
  // Plain text format - one line per change
  const changesText = groupedChanges
    .map((gc, idx) => {
      if (gc.deletedText && gc.insertedText) {
        return `[${idx}] "${gc.deletedText}" → "${gc.insertedText}"`;
      } else if (gc.deletedText) {
        return `[${idx}] deleted "${gc.deletedText}"`;
      } else {
        return `[${idx}] inserted "${gc.insertedText}"`;
      }
    })
    .join("\n");

  return `Review these track changes. For each, recommend: accept, reject, or leave_alone.

User criteria: ${userCriteria}

Changes:
${changesText}
`;
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

  // Update recommendation status
  const updateRecommendationStatus = useCallback(
    (recId: string, status: TrackChangeRecommendation["status"]) => {
      setMessages((prevMessages) =>
        prevMessages.map((message) => {
          if (!message.metadata?.recommendations) return message;
          const updatedRecs = message.metadata.recommendations.map((rec) =>
            rec.id === recId ? { ...rec, status } : rec,
          );
          return {
            ...message,
            metadata: { ...message.metadata, recommendations: updatedRecs },
          };
        }),
      );
    },
    [],
  );

  // Get all pending recommendations from messages
  const getPendingRecommendations =
    useCallback((): TrackChangeRecommendation[] => {
      const allRecs: TrackChangeRecommendation[] = [];
      for (const message of messages) {
        if (message.metadata?.recommendations) {
          for (const rec of message.metadata.recommendations) {
            if (rec.status === "pending") {
              allRecs.push(rec);
            }
          }
        }
      }
      return allRecs;
    }, [messages]);

  // Get the next recommendation after the current one
  const getNextRecommendation = useCallback(
    (
      currentRec: TrackChangeRecommendation,
    ): TrackChangeRecommendation | null => {
      const allRecs = getPendingRecommendations();
      const currentIndex = allRecs.findIndex((r) => r.id === currentRec.id);
      if (currentIndex >= 0 && currentIndex < allRecs.length - 1) {
        return allRecs[currentIndex + 1];
      }
      // If current was the last pending, find next pending from all recs
      for (const message of messages) {
        if (message.metadata?.recommendations) {
          for (const rec of message.metadata.recommendations) {
            if (rec.status === "pending" && rec.id !== currentRec.id) {
              return rec;
            }
          }
        }
      }
      return null;
    },
    [getPendingRecommendations, messages],
  );

  // Navigate to a recommendation in the editor
  const goToRecommendation = useCallback((rec: TrackChangeRecommendation) => {
    const ed = editorRef.current;
    if (!ed) return;

    // Find the first track change element in this block
    const firstId = rec.deletionIds[0] || rec.insertionIds[0];
    if (!firstId) return;

    const editorDom = ed.view.dom;
    const element = editorDom.querySelector(
      `[data-insertion-id="${firstId}"], [data-deletion-id="${firstId}"]`,
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
        if (id === firstId) {
          targetIndex = idx;
        }
      });

      if (targetIndex >= 0) {
        window.dispatchEvent(
          new CustomEvent("ai-select-change", {
            detail: { index: targetIndex, changeId: firstId },
          }),
        );
      }
    }
  }, []);

  // Apply a recommendation (execute the AI's suggested action)
  const applyRecommendation = useCallback(
    (rec: TrackChangeRecommendation) => {
      const ed = editorRef.current;
      if (!ed) return;

      console.log("[applyRecommendation] Applying:", rec);

      if (rec.recommendation === "accept") {
        // Accept all track changes in this block
        for (const id of rec.deletionIds) {
          ed.commands.acceptDeletion(id);
        }
        for (const id of rec.insertionIds) {
          ed.commands.acceptInsertion(id);
        }
      } else if (rec.recommendation === "reject") {
        // Reject all track changes in this block
        for (const id of rec.deletionIds) {
          ed.commands.rejectDeletion(id);
        }
        for (const id of rec.insertionIds) {
          ed.commands.rejectInsertion(id);
        }
      }
      // "leave_alone" does nothing to the document

      updateRecommendationStatus(rec.id, "applied");

      // Auto-advance to next
      const nextRec = getNextRecommendation(rec);
      if (nextRec) {
        setTimeout(() => goToRecommendation(nextRec), 100);
      }
    },
    [updateRecommendationStatus, getNextRecommendation, goToRecommendation],
  );

  // Discard a recommendation (skip without action)
  const discardRecommendation = useCallback(
    (rec: TrackChangeRecommendation) => {
      console.log("[discardRecommendation] Discarding:", rec);

      updateRecommendationStatus(rec.id, "discarded");

      // Auto-advance to next
      const nextRec = getNextRecommendation(rec);
      if (nextRec) {
        setTimeout(() => goToRecommendation(nextRec), 100);
      }
    },
    [updateRecommendationStatus, getNextRecommendation, goToRecommendation],
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
    async (prompt: string, options?: { forceReviewMode?: boolean }) => {
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

      // Parse /review command from prompt
      const { isReviewCommand, promptText } = parseReviewCommand(prompt);
      const reviewRequested = isReviewCommand || options?.forceReviewMode;

      // If /review was requested but no track changes in scope, return early with message
      if (reviewRequested && !hasTrackChanges) {
        const message = hasSelection
          ? "No track changes found in the selected text. Select text containing track changes, or clear your selection to review all changes in the document."
          : "No track changes found in the document. There's nothing to review.";

        addMessage({
          role: "user",
          content: prompt,
          metadata: { isReviewMode: true },
        });
        addMessage({
          role: "assistant",
          content: message,
        });
        setIsLoading(false);
        return;
      }

      // Review mode is ONLY enabled by explicit /review command (and requires pending changes)
      const isReviewMode = reviewRequested && hasTrackChanges;

      // Use the cleaned prompt text (without /review prefix) for AI
      const effectivePrompt = isReviewCommand ? promptText : prompt;

      console.log("[sendPrompt] Mode:", isReviewMode ? "REVIEW" : "EDIT");
      console.log("[sendPrompt] Review command detected:", isReviewCommand);
      console.log(
        "[sendPrompt] Pending track changes:",
        pendingTrackChanges.length,
      );

      // Check for track changes in selection (for edit mode context)
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

      // Build indexed document for AI (used in edit mode)
      const { document: indexedDocument, paragraphs } =
        buildIndexedDocument(ed);
      paragraphMapRef.current = paragraphs;

      // Add user message with context items
      // Show the original prompt (with /review) so user sees what they typed
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
          contextItems: contextItems.length > 0 ? [...contextItems] : undefined,
          isReviewMode,
        },
      });

      try {
        if (isReviewMode) {
          // ========== REVIEW MODE ==========
          console.log("[sendPrompt] Entering review mode");

          // Group track changes (pair adjacent deletion+insertion)
          const groupedChanges = groupTrackChanges(pendingTrackChanges);
          console.log("[sendPrompt] Grouped changes:", groupedChanges.length);

          // Build review system prompt (use effectivePrompt without /review prefix)
          const reviewPrompt = buildReviewSystemPrompt(
            groupedChanges,
            effectivePrompt,
          );
          console.log(
            "[sendPrompt] Review prompt:\n",
            reviewPrompt.substring(0, 500) + "...",
          );

          // Define JSON schema for review response
          const reviewSchema = {
            type: "json_schema",
            json_schema: {
              name: "ai_review_response",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  message: {
                    type: "string",
                    description: "Summary of the review",
                  },
                  recommendations: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        index: {
                          type: "number",
                          description: "Index of the change being evaluated",
                        },
                        recommendation: {
                          type: "string",
                          enum: ["accept", "reject", "leave_alone"],
                          description: "The recommended action",
                        },
                        reason: {
                          type: "string",
                          description:
                            "Brief explanation for this recommendation",
                        },
                      },
                      required: ["index", "recommendation", "reason"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["message", "recommendations"],
                additionalProperties: false,
              },
            },
          };

          console.log("[sendPrompt] Review mode - sending API request...");
          console.log("[sendPrompt] Model:", config.aiModel || "gpt-5-mini");
          console.log("[sendPrompt] User prompt:", effectivePrompt);

          const requestBody = {
            model: config.aiModel || "gpt-5-mini",
            messages: [
              { role: "system", content: reviewPrompt },
              { role: "user", content: effectivePrompt },
            ],
            temperature: config.aiTemperature ?? 1.0,
            max_completion_tokens: 65536,
            response_format: reviewSchema,
          };
          console.log(
            "[sendPrompt] Request body:",
            JSON.stringify(requestBody, null, 2).substring(0, 1000) + "...",
          );

          const response = await fetch(
            "https://api.openai.com/v1/chat/completions",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify(requestBody),
            },
          );

          console.log("[sendPrompt] Response status:", response.status);

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error("[sendPrompt] API error:", errorData);
            throw new Error(
              errorData.error?.message ||
                `API request failed: ${response.status}`,
            );
          }

          const data = await response.json();
          console.log("[sendPrompt] Response data received");
          console.log(
            "[sendPrompt] Full API response:",
            JSON.stringify(data, null, 2),
          );
          const assistantContent = data.choices?.[0]?.message?.content || "{}";
          console.log("[sendPrompt] Assistant content:", assistantContent);

          // Parse review response
          let reviewResponse: {
            message: string;
            recommendations: Array<{
              index: number;
              recommendation: "accept" | "reject" | "leave_alone";
              reason: string;
            }>;
          };

          try {
            reviewResponse = JSON.parse(assistantContent);
          } catch (parseErr) {
            console.error("[sendPrompt] Review JSON parse failed:", parseErr);
            reviewResponse = { message: assistantContent, recommendations: [] };
          }

          // Convert AI recommendations to TrackChangeRecommendation objects
          const recommendations: TrackChangeRecommendation[] = [];
          for (const rec of reviewResponse.recommendations) {
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

          // Add assistant message with recommendations
          addMessage({
            role: "assistant",
            content: reviewResponse.message || "Review complete.",
            metadata: {
              recommendations:
                recommendations.length > 0 ? recommendations : undefined,
              isReviewMode: true,
            },
          });

          // Navigate to first recommendation
          if (recommendations.length > 0) {
            setTimeout(() => goToRecommendation(recommendations[0]), 200);
          }
        } else {
          // ========== EDIT MODE (existing behavior) ==========
          let aiResponse: AIResponse;

          if (config.onAIRequest) {
            // Use custom handler (backend proxy mode)
            console.log("[sendPrompt] Using custom onAIRequest handler");

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

            const systemPrompt = buildSystemPrompt(
              indexedDocument,
              hasSelection,
              selectedText,
              contextItems,
              trackChangesContext,
            );

            console.log("[sendPrompt] Full system prompt:\n", systemPrompt);

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
                            description:
                              "Brief explanation of what was changed",
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
                  model: config.aiModel || "gpt-5-mini",
                  messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: prompt },
                  ],
                  temperature: config.aiTemperature ?? 1.0,
                  max_completion_tokens: 65536,
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
            const assistantContent =
              data.choices?.[0]?.message?.content || "{}";
            console.log(
              "[sendPrompt] Raw response:",
              assistantContent.substring(0, 500) + "...",
            );

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
        }
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
    [
      apiKey,
      addMessage,
      applyEditsAsTrackChanges,
      config,
      contextItems,
      goToRecommendation,
    ],
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
    applyRecommendation,
    discardRecommendation,
    getPendingRecommendations,
    getNextRecommendation,
    goToRecommendation,
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
