import { useCallback, RefObject } from "react";
import { Editor } from "@tiptap/react";
import type { ChatMessage, TrackChangeRecommendation } from "../../lib/ai/types";

export interface UseAIRecommendationsOptions {
  editorRef: RefObject<Editor | null>;
  messages: ChatMessage[];
  updateRecommendationStatus: (recId: string, status: TrackChangeRecommendation["status"]) => void;
}

export interface UseAIRecommendationsReturn {
  applyRecommendation: (rec: TrackChangeRecommendation) => void;
  discardRecommendation: (rec: TrackChangeRecommendation) => void;
  getPendingRecommendations: () => TrackChangeRecommendation[];
  getNextRecommendation: (currentRec: TrackChangeRecommendation) => TrackChangeRecommendation | null;
  goToRecommendation: (rec: TrackChangeRecommendation) => void;
}

export function useAIRecommendations(
  options: UseAIRecommendationsOptions,
): UseAIRecommendationsReturn {
  const { editorRef, messages, updateRecommendationStatus } = options;

  // Get all pending recommendations from messages
  const getPendingRecommendations = useCallback((): TrackChangeRecommendation[] => {
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
    (currentRec: TrackChangeRecommendation): TrackChangeRecommendation | null => {
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
  }, [editorRef]);

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
    [editorRef, updateRecommendationStatus, getNextRecommendation, goToRecommendation],
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

  return {
    applyRecommendation,
    discardRecommendation,
    getPendingRecommendations,
    getNextRecommendation,
    goToRecommendation,
  };
}
