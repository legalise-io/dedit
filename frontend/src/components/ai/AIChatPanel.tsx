import { useRef, useEffect, useCallback } from "react";
import {
  useAIEditor,
  ChatMessage,
  AIEdit,
} from "../../context/AIEditorContext";

interface AIChatPanelProps {
  className?: string;
  showHeader?: boolean;
  headerTitle?: string;
  maxHeight?: string;
}

/**
 * AIChatPanel - A separable component for displaying AI chat messages
 *
 * This component displays the conversation history and shows clickable links
 * for each AI-suggested edit. Clicking a link scrolls the editor to that
 * edit and selects it for review.
 *
 * Usage:
 * ```tsx
 * <AIEditorProvider>
 *   <div className="sidebar">
 *     <AIChatPanel showHeader headerTitle="AI Assistant" />
 *   </div>
 *   <div className="main">
 *     <DocumentEditor ... />
 *   </div>
 * </AIEditorProvider>
 * ```
 */
export function AIChatPanel({
  className = "",
  showHeader = true,
  headerTitle = "AI Chat",
  maxHeight = "400px",
}: AIChatPanelProps) {
  const {
    messages,
    isLoading,
    error,
    clearMessages,
    goToEditAndSelect,
    acceptEdit,
    rejectEdit,
    getNextEdit,
  } = useAIEditor();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleEditClick = useCallback(
    (edit: AIEdit) => {
      goToEditAndSelect(edit);
    },
    [goToEditAndSelect],
  );

  // Scroll the chat panel to show the next edit at the top
  const scrollChatToNextEdit = useCallback(
    (currentEdit: AIEdit) => {
      const nextEdit = getNextEdit(currentEdit);
      if (nextEdit && chatMessagesRef.current) {
        // Find the next edit's element in the chat panel
        const nextEditElement = chatMessagesRef.current.querySelector(
          `[data-edit-id="${nextEdit.id}"]`,
        );
        if (nextEditElement) {
          // Scroll so the next edit is at the top of the chat container
          const container = chatMessagesRef.current;
          const elementTop =
            nextEditElement.getBoundingClientRect().top -
            container.getBoundingClientRect().top +
            container.scrollTop;
          container.scrollTo({
            top: elementTop - 8, // Small padding from top
            behavior: "smooth",
          });
        }
      }
    },
    [getNextEdit],
  );

  const handleAccept = useCallback(
    (e: React.MouseEvent, edit: AIEdit) => {
      e.stopPropagation();
      acceptEdit(edit);
      // Scroll chat to show next edit at top after a brief delay
      setTimeout(() => scrollChatToNextEdit(edit), 50);
    },
    [acceptEdit, scrollChatToNextEdit],
  );

  const handleReject = useCallback(
    (e: React.MouseEvent, edit: AIEdit) => {
      e.stopPropagation();
      rejectEdit(edit);
      // Scroll chat to show next edit at top after a brief delay
      setTimeout(() => scrollChatToNextEdit(edit), 50);
    },
    [rejectEdit, scrollChatToNextEdit],
  );

  const renderEditLink = (edit: AIEdit, index: number) => {
    // Format: "deleted → inserted" or just one side if pure add/delete
    let displayText: string;
    if (edit.deletedText && edit.insertedText) {
      // Replacement: show both
      const del =
        edit.deletedText.length > 15
          ? edit.deletedText.slice(0, 15) + "..."
          : edit.deletedText;
      const ins =
        edit.insertedText.length > 15
          ? edit.insertedText.slice(0, 15) + "..."
          : edit.insertedText;
      displayText = `${del} → ${ins}`;
    } else if (edit.deletedText) {
      // Pure deletion
      const del =
        edit.deletedText.length > 30
          ? edit.deletedText.slice(0, 30) + "..."
          : edit.deletedText;
      displayText = `−${del}`;
    } else if (edit.insertedText) {
      // Pure insertion
      const ins =
        edit.insertedText.length > 30
          ? edit.insertedText.slice(0, 30) + "..."
          : edit.insertedText;
      displayText = `+${ins}`;
    } else {
      displayText = edit.reason || "Edit";
    }

    const tooltipLines: string[] = [];
    if (edit.deletedText) tooltipLines.push(`Deleted: "${edit.deletedText}"`);
    if (edit.insertedText)
      tooltipLines.push(`Inserted: "${edit.insertedText}"`);
    if (edit.reason) tooltipLines.push(`Reason: ${edit.reason}`);

    const isResolved = edit.status === "accepted" || edit.status === "rejected";

    return (
      <div
        key={edit.id || index}
        data-edit-id={edit.id}
        className={`edit-row edit-row--${edit.status}`}
      >
        <button
          type="button"
          className={`edit-link edit-link--${edit.status}`}
          onClick={() => handleEditClick(edit)}
          title={tooltipLines.join("\n")}
        >
          <span className="edit-link-icon">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </span>
          <span className="edit-link-text">{displayText}</span>
        </button>
        {!isResolved && (
          <div className="edit-actions">
            <button
              type="button"
              className="edit-accept-btn"
              onClick={(e) => handleAccept(e, edit)}
              title="Accept this change"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
            <button
              type="button"
              className="edit-reject-btn"
              onClick={(e) => handleReject(e, edit)}
              title="Reject this change"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}
        {edit.status === "accepted" && (
          <span className="edit-status-badge edit-status-accepted">
            Accepted
          </span>
        )}
        {edit.status === "rejected" && (
          <span className="edit-status-badge edit-status-rejected">
            Rejected
          </span>
        )}
      </div>
    );
  };

  const renderMessage = (message: ChatMessage) => {
    const edits = message.metadata?.edits;
    const hasEdits = edits && edits.length > 0;

    return (
      <div
        key={message.id}
        className={`chat-message chat-message--${message.role}`}
      >
        <div className="chat-message-header">
          <span className="chat-message-role">
            {message.role === "user"
              ? "You"
              : message.role === "assistant"
                ? "AI"
                : "System"}
          </span>
          <span className="chat-message-time">
            {message.timestamp.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>

        <div className="chat-message-content">{message.content}</div>

        {message.metadata?.selectionContext?.hasSelection && (
          <div className="chat-message-context">
            <span className="context-label">Selected:</span>
            <span className="context-text">
              "{message.metadata.selectionContext.text.slice(0, 50)}
              {message.metadata.selectionContext.text.length > 50 ? "..." : ""}"
            </span>
          </div>
        )}

        {hasEdits && (
          <div className="chat-message-edits">
            <div className="edits-header">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              {edits.length} edit{edits.length !== 1 ? "s" : ""} suggested
              <span className="edits-hint">
                (click to review, then Accept/Reject)
              </span>
            </div>
            <div className="edits-list">
              {edits.map((edit, index) => renderEditLink(edit, index))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`ai-chat-panel ${className}`}>
      {showHeader && (
        <div className="ai-chat-header">
          <h3 className="ai-chat-title">{headerTitle}</h3>
          {messages.length > 0 && (
            <button
              type="button"
              className="ai-chat-clear-btn"
              onClick={clearMessages}
              title="Clear chat history"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          )}
        </div>
      )}

      <div
        ref={chatMessagesRef}
        className="ai-chat-messages"
        style={{ maxHeight }}
      >
        {messages.length === 0 ? (
          <div className="ai-chat-empty">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p>No messages yet</p>
            <p className="ai-chat-empty-hint">
              Select text for targeted edits, or just ask for document-wide
              changes
            </p>
          </div>
        ) : (
          <>
            {messages.map(renderMessage)}

            {isLoading && (
              <div className="chat-message chat-message--assistant chat-message--loading">
                <div className="chat-loading-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            )}
          </>
        )}

        {error && (
          <div className="ai-chat-error">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

export default AIChatPanel;
