import { useState, useCallback } from "react";
import type {
  ChatMessage,
  AIEdit,
  TrackChangeRecommendation,
} from "../../lib/ai/types";

// Generate unique ID
const generateId = () =>
  `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

export interface UseAIChatOptions {
  onClearContextItems?: () => void;
}

export interface UseAIChatReturn {
  messages: ChatMessage[];
  addMessage: (message: Omit<ChatMessage, "id" | "timestamp">) => ChatMessage;
  clearMessages: () => void;
  updateEditStatus: (editId: string, status: AIEdit["status"]) => void;
  updateEditStatusByTrackChangeId: (
    trackChangeId: string,
    status: AIEdit["status"],
  ) => void;
  updateRecommendationStatus: (
    recId: string,
    status: TrackChangeRecommendation["status"],
  ) => void;
}

export function useAIChat(options: UseAIChatOptions = {}): UseAIChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const addMessage = useCallback(
    (message: Omit<ChatMessage, "id" | "timestamp">): ChatMessage => {
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
    options.onClearContextItems?.();
  }, [options]);

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

  return {
    messages,
    addMessage,
    clearMessages,
    updateEditStatus,
    updateEditStatusByTrackChangeId,
    updateRecommendationStatus,
  };
}
