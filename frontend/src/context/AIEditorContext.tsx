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
  };
}

export interface SelectionContext {
  text: string;
  from: number;
  to: number;
  hasSelection: boolean;
}

export interface AIEditorConfig {
  aiAuthorName?: string;
  aiModel?: string;
  aiTemperature?: number;
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
 * Build an indexed document string with paragraph IDs for AI context.
 * Format: [paragraphId] paragraph text
 * The ID is a UUID that uniquely identifies each paragraph.
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
      const text = node.textContent;

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
        text: node.textContent,
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
): string {
  let prompt = `You are an AI writing assistant helping to edit documents. You can answer questions about the document or suggest edits.

## Document Format
The document is provided with each paragraph identified by a unique ID in square brackets.
Format: [paragraph-id] paragraph text

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

  if (hasSelection) {
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
  }, []);

  // Loading and error states
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      // IDs appear in document order, word changes were applied in reverse
      // So we reverse the ID arrays to match
      newDeletionIds.reverse();
      newInsertionIds.reverse();

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
    [applyParagraphEdit],
  );

  // Send prompt to OpenAI
  const sendPrompt = useCallback(
    async (prompt: string) => {
      if (!apiKey) {
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

      // Build indexed document for AI
      const { document: indexedDocument, paragraphs } =
        buildIndexedDocument(ed);
      paragraphMapRef.current = paragraphs;

      console.log(
        "[sendPrompt] Indexed document:",
        indexedDocument.substring(0, 500) + "...",
      );

      // Add user message
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
        },
      });

      // Build system prompt
      const systemPrompt = buildSystemPrompt(
        indexedDocument,
        hasSelection,
        selectedText,
      );

      try {
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
                        description: "The complete new text for the paragraph",
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
              model: config.aiModel || "gpt-5-mini",
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
        let aiResponse: AIResponse;
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
          aiResponse = { message: assistantContent };
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
    [apiKey, addMessage, applyEditsAsTrackChanges, config],
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
