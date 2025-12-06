import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useAIEditor } from "../../context/AIEditorContext";

interface PromptInputProps {
  className?: string;
  placeholder?: string;
  showSelectionIndicator?: boolean;
}

/** Available slash commands */
interface SlashCommand {
  name: string;
  description: string;
  icon: React.ReactNode;
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "review",
    description: "Review track changes and recommend accept/reject",
    icon: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
];

/**
 * Check if user is typing a slash command (starts with / but not yet complete)
 */
function getSlashCommandState(prompt: string): {
  isTypingCommand: boolean;
  partialCommand: string;
  matchingCommands: SlashCommand[];
} {
  const match = prompt.match(/^\/(\w*)$/);

  if (match) {
    const partial = match[1].toLowerCase();
    const matching = SLASH_COMMANDS.filter((cmd) =>
      cmd.name.toLowerCase().startsWith(partial),
    );
    return {
      isTypingCommand: true,
      partialCommand: partial,
      matchingCommands: matching,
    };
  }

  return {
    isTypingCommand: false,
    partialCommand: "",
    matchingCommands: [],
  };
}

/**
 * PromptInput - A separable component for entering AI prompts
 *
 * Supports slash commands like /review for special modes.
 * Type "/" to see available commands. Commands appear as pills that delete as a unit.
 */
export function PromptInput({
  className = "",
  placeholder,
  showSelectionIndicator = true,
}: PromptInputProps) {
  const {
    sendPrompt,
    isLoading,
    apiKey,
    selectionContext,
    config,
    contextItems,
    addContextItems,
    removeContextItem,
    resolveContextItems,
  } = useAIEditor();

  // Active command (as a pill) - null means no command selected
  const [activeCommand, setActiveCommand] = useState<SlashCommand | null>(null);
  // Text input (separate from command)
  const [inputText, setInputText] = useState("");
  // For autocomplete menu
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Check if user is typing a slash command
  const { isTypingCommand, matchingCommands } = useMemo(
    () => getSlashCommandState(inputText),
    [inputText],
  );

  // Reset selection when commands change
  useEffect(() => {
    setSelectedCommandIndex(0);
  }, [matchingCommands.length]);

  // Check if drag/drop is enabled
  const isDragDropEnabled = !!config.onResolveContextItems;

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, [inputText]);

  // Check if we can send prompts
  const canSendPrompts = apiKey || config.onAIRequest;

  // Complete the selected command - sets it as active pill
  const completeCommand = useCallback((command: SlashCommand) => {
    setActiveCommand(command);
    setInputText("");
    setSelectedCommandIndex(0);
    textareaRef.current?.focus();
  }, []);

  // Remove the active command pill
  const removeCommand = useCallback(() => {
    setActiveCommand(null);
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!inputText.trim() && !activeCommand) return;
      if (isLoading || !canSendPrompts) return;

      // Build the full prompt
      const fullPrompt = activeCommand
        ? `/${activeCommand.name} ${inputText.trim()}`
        : inputText.trim();

      const isReviewMode = activeCommand?.name === "review";

      await sendPrompt(fullPrompt, { forceReviewMode: isReviewMode });
      setInputText("");
      setActiveCommand(null);
    },
    [inputText, activeCommand, isLoading, canSendPrompts, sendPrompt],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Handle backspace on empty input to remove command pill
      if (e.key === "Backspace" && inputText === "" && activeCommand) {
        e.preventDefault();
        removeCommand();
        return;
      }

      // Handle command menu navigation
      if (isTypingCommand && matchingCommands.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedCommandIndex((prev) =>
            prev < matchingCommands.length - 1 ? prev + 1 : 0,
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedCommandIndex((prev) =>
            prev > 0 ? prev - 1 : matchingCommands.length - 1,
          );
          return;
        }
        if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          completeCommand(matchingCommands[selectedCommandIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setInputText("");
          return;
        }
      }

      // Normal submit
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [
      inputText,
      activeCommand,
      isTypingCommand,
      matchingCommands,
      selectedCommandIndex,
      completeCommand,
      removeCommand,
      handleSubmit,
    ],
  );

  // Drag/drop handlers
  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isDragDropEnabled) {
        setIsDragOver(true);
      }
    },
    [isDragDropEnabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = dropZoneRef.current?.getBoundingClientRect();
    if (rect) {
      const { clientX, clientY } = e;
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        setIsDragOver(false);
      }
    }
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isDragDropEnabled) {
        e.dataTransfer.dropEffect = "copy";
      }
    },
    [isDragDropEnabled],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      if (!isDragDropEnabled) return;

      const items = await resolveContextItems(e.dataTransfer);
      if (items.length > 0) {
        addContextItems(items);
      }
    },
    [isDragDropEnabled, resolveContextItems, addContextItems],
  );

  const getPlaceholder = (): string => {
    if (placeholder) return placeholder;

    if (!canSendPrompts) {
      return "Enter your OpenAI API key first...";
    }

    if (activeCommand) {
      return activeCommand.name === "review"
        ? "Enter criteria (e.g., accept grammar fixes, reject style changes)..."
        : "Enter instructions...";
    }

    if (selectionContext.hasSelection) {
      const truncatedText = selectionContext.text.slice(0, 30);
      const ellipsis = selectionContext.text.length > 30 ? "..." : "";
      return `Edit "${truncatedText}${ellipsis}" or ask about it...`;
    }

    return "Type / for commands, or ask a question...";
  };

  return (
    <div
      ref={dropZoneRef}
      className={`prompt-input ${className} ${isDragOver ? "drag-over" : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {showSelectionIndicator && (
        <div className="prompt-selection-indicator">
          {selectionContext.hasSelection ? (
            <span className="selection-active">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {selectionContext.text.length} characters selected — edits will
              target this text
            </span>
          ) : (
            <span className="selection-hint">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              No selection — edits will apply globally
            </span>
          )}
        </div>
      )}

      {/* Context items pills */}
      {contextItems.length > 0 && (
        <div className="prompt-context-items">
          {contextItems.map((item) => (
            <div key={item.id} className="context-item-pill" title={item.label}>
              <span className="context-item-type">{item.type}</span>
              <span className="context-item-label">{item.label}</span>
              <button
                type="button"
                className="context-item-remove"
                onClick={() => removeContextItem(item.id)}
                title="Remove"
              >
                <svg
                  width="12"
                  height="12"
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
          ))}
        </div>
      )}

      {/* Drag overlay */}
      {isDragOver && isDragDropEnabled && (
        <div className="prompt-drop-overlay">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>Drop to add context</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="prompt-form">
        <div className="prompt-input-wrapper">
          {/* Slash command autocomplete menu */}
          {isTypingCommand && matchingCommands.length > 0 && (
            <div className="slash-command-menu">
              {matchingCommands.map((cmd, index) => (
                <button
                  key={cmd.name}
                  type="button"
                  className={`slash-command-item ${index === selectedCommandIndex ? "slash-command-item--selected" : ""}`}
                  onClick={() => completeCommand(cmd)}
                  onMouseEnter={() => setSelectedCommandIndex(index)}
                >
                  <span className="slash-command-icon">{cmd.icon}</span>
                  <span className="slash-command-name">/{cmd.name}</span>
                  <span className="slash-command-desc">{cmd.description}</span>
                </button>
              ))}
              <div className="slash-command-hint">
                <kbd>Tab</kbd> or <kbd>Enter</kbd> to select
              </div>
            </div>
          )}

          {/* Active command pill */}
          {activeCommand && (
            <button
              type="button"
              className="command-pill"
              onClick={removeCommand}
              title="Click or backspace to remove"
            >
              <span className="command-pill-icon">{activeCommand.icon}</span>
              <span className="command-pill-name">/{activeCommand.name}</span>
            </button>
          )}

          <textarea
            ref={textareaRef}
            className="prompt-textarea"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={getPlaceholder()}
            disabled={isLoading || !canSendPrompts}
            rows={1}
          />
          <button
            type="submit"
            className="prompt-submit-btn"
            disabled={
              (!inputText.trim() && !activeCommand) ||
              isLoading ||
              !canSendPrompts
            }
            title="Send prompt"
          >
            {isLoading ? (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="prompt-loading-icon"
              >
                <line x1="12" y1="2" x2="12" y2="6" />
                <line x1="12" y1="18" x2="12" y2="22" />
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                <line x1="2" y1="12" x2="6" y2="12" />
                <line x1="18" y1="12" x2="22" y2="12" />
                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
                <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
              </svg>
            ) : (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>
        <div className="prompt-hint">
          Press Enter to send, Shift+Enter for new line
          {isDragDropEnabled && " • Drop files to add context"}
        </div>
      </form>
    </div>
  );
}

export default PromptInput;
