import { useCallback, RefObject } from "react";
import { Editor } from "@tiptap/react";
import type { AIEdit, ChatMessage } from "../../lib/ai/types";

export interface UseAIEditsOptions {
  editorRef: RefObject<Editor | null>;
  messages: ChatMessage[];
  updateEditStatus: (editId: string, status: AIEdit["status"]) => void;
}

export interface UseAIEditsReturn {
  scrollToEdit: (edit: AIEdit) => void;
  goToEditAndSelect: (edit: AIEdit) => void;
  acceptEdit: (edit: AIEdit) => void;
  rejectEdit: (edit: AIEdit) => void;
  getPendingEdits: () => AIEdit[];
  getNextEdit: (currentEdit: AIEdit) => AIEdit | null;
}

export function useAIEdits(options: UseAIEditsOptions): UseAIEditsReturn {
  const { editorRef, messages, updateEditStatus } = options;

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
    const para = findParagraphByIdSimple(ed, edit.paragraphId);
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
  }, [editorRef]);

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
    [editorRef, scrollToEdit],
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
    [editorRef, updateEditStatus, getNextEdit, goToEditAndSelect],
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
    [editorRef, updateEditStatus, getNextEdit, goToEditAndSelect],
  );

  return {
    scrollToEdit,
    goToEditAndSelect,
    acceptEdit,
    rejectEdit,
    getPendingEdits,
    getNextEdit,
  };
}

// Simple helper to find paragraph - inlined to avoid circular deps
function findParagraphByIdSimple(
  editor: Editor,
  paragraphId: string,
): { from: number } | null {
  const doc = editor.state.doc;
  let result: { from: number } | null = null;

  doc.descendants((node, pos) => {
    if (result) return false;
    if (node.type.name === "paragraph" && node.attrs.id === paragraphId) {
      result = { from: pos + 1 };
      return false;
    }
    return true;
  });

  return result;
}
