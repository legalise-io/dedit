import { useCallback, useMemo, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import type { TrackedChange } from "../types";

export interface UseTrackChangesOptions {
  /** Initial enabled state */
  enabled?: boolean;
  /** Initial author */
  author?: string;
  /** Called when enabled state changes */
  onEnabledChange?: (enabled: boolean) => void;
  /** Called when author changes */
  onAuthorChange?: (author: string) => void;
  /** Called when a change is accepted */
  onAccept?: (change: TrackedChange) => void;
  /** Called when a change is rejected */
  onReject?: (change: TrackedChange) => void;
}

/**
 * Hook for managing track changes functionality.
 *
 * @example
 * ```tsx
 * const {
 *   enabled,
 *   setEnabled,
 *   author,
 *   setAuthor,
 *   changes,
 *   acceptChange,
 *   rejectChange,
 *   acceptAll,
 *   rejectAll,
 * } = useTrackChanges(editor, {
 *   enabled: true,
 *   author: 'John Doe',
 * });
 * ```
 */
export function useTrackChanges(
  editor: Editor | null,
  options: UseTrackChangesOptions = {},
) {
  const {
    enabled: initialEnabled = false,
    author: initialAuthor = "Unknown Author",
    onEnabledChange,
    onAuthorChange,
    onAccept,
    onReject,
  } = options;

  // Sync enabled state with editor
  useEffect(() => {
    if (!editor) return;

    if (initialEnabled) {
      editor.commands.enableTrackChanges();
    } else {
      editor.commands.disableTrackChanges();
    }
  }, [editor, initialEnabled]);

  // Sync author with editor
  useEffect(() => {
    if (!editor) return;
    editor.commands.setTrackChangesAuthor(initialAuthor);
  }, [editor, initialAuthor]);

  // Get current enabled state from editor storage
  const enabled = useMemo(() => {
    if (!editor) return initialEnabled;
    const storage = editor.storage.trackChangesMode;
    return storage?.enabled ?? initialEnabled;
  }, [editor, editor?.storage.trackChangesMode?.enabled, initialEnabled]);

  // Get current author from editor storage
  const author = useMemo(() => {
    if (!editor) return initialAuthor;
    const storage = editor.storage.trackChangesMode;
    return storage?.author ?? initialAuthor;
  }, [editor, editor?.storage.trackChangesMode?.author, initialAuthor]);

  const setEnabled = useCallback(
    (newEnabled: boolean) => {
      if (!editor) return;

      if (newEnabled) {
        editor.commands.enableTrackChanges();
      } else {
        editor.commands.disableTrackChanges();
      }

      onEnabledChange?.(newEnabled);
    },
    [editor, onEnabledChange],
  );

  const setAuthor = useCallback(
    (newAuthor: string) => {
      if (!editor) return;
      editor.commands.setTrackChangesAuthor(newAuthor);
      onAuthorChange?.(newAuthor);
    },
    [editor, onAuthorChange],
  );

  const toggle = useCallback(() => {
    setEnabled(!enabled);
  }, [enabled, setEnabled]);

  // Extract all tracked changes from the document
  const changes = useMemo((): TrackedChange[] => {
    if (!editor) return [];

    const changeMap = new Map<string, TrackedChange>();
    const doc = editor.state.doc;

    doc.descendants((node, pos) => {
      if (node.isText) {
        node.marks.forEach((mark) => {
          if (mark.type.name === "insertion" || mark.type.name === "deletion") {
            const id = mark.attrs.id;
            const existing = changeMap.get(id);
            if (existing) {
              // Extend the range to include this text node
              existing.from = Math.min(existing.from, pos);
              existing.to = Math.max(existing.to, pos + node.nodeSize);
              existing.text += node.text || "";
            } else {
              changeMap.set(id, {
                id,
                type: mark.type.name as "insertion" | "deletion",
                author: mark.attrs.author,
                date: mark.attrs.date,
                text: node.text || "",
                from: pos,
                to: pos + node.nodeSize,
              });
            }
          }
        });
      }
    });

    // Convert to array and sort by position in document
    return Array.from(changeMap.values()).sort((a, b) => a.from - b.from);
  }, [editor?.state.doc]);

  const findChangeById = useCallback(
    (id: string): TrackedChange | undefined => {
      return changes.find((c) => c.id === id);
    },
    [changes],
  );

  const acceptChange = useCallback(
    (changeId: string) => {
      if (!editor) return;

      const change = findChangeById(changeId);
      if (!change) return;

      if (change.type === "insertion") {
        editor.commands.acceptInsertion(changeId);
      } else {
        editor.commands.acceptDeletion(changeId);
      }

      onAccept?.(change);
    },
    [editor, findChangeById, onAccept],
  );

  const rejectChange = useCallback(
    (changeId: string) => {
      if (!editor) return;

      const change = findChangeById(changeId);
      if (!change) return;

      if (change.type === "insertion") {
        editor.commands.rejectInsertion(changeId);
      } else {
        editor.commands.rejectDeletion(changeId);
      }

      onReject?.(change);
    },
    [editor, findChangeById, onReject],
  );

  const acceptAll = useCallback(() => {
    if (!editor) return;

    // Process in reverse order to maintain positions
    const sortedChanges = [...changes].sort((a, b) => b.from - a.from);

    sortedChanges.forEach((change) => {
      if (change.type === "insertion") {
        editor.commands.acceptInsertion(change.id);
      } else {
        editor.commands.acceptDeletion(change.id);
      }
      onAccept?.(change);
    });
  }, [editor, changes, onAccept]);

  const rejectAll = useCallback(() => {
    if (!editor) return;

    // Process in reverse order to maintain positions
    const sortedChanges = [...changes].sort((a, b) => b.from - a.from);

    sortedChanges.forEach((change) => {
      if (change.type === "insertion") {
        editor.commands.rejectInsertion(change.id);
      } else {
        editor.commands.rejectDeletion(change.id);
      }
      onReject?.(change);
    });
  }, [editor, changes, onReject]);

  return {
    /** Whether track changes is enabled */
    enabled,
    /** Set enabled state */
    setEnabled,
    /** Toggle enabled state */
    toggle,
    /** Current author name */
    author,
    /** Set author name */
    setAuthor,
    /** List of all tracked changes */
    changes,
    /** Accept a specific change by ID */
    acceptChange,
    /** Reject a specific change by ID */
    rejectChange,
    /** Accept all changes */
    acceptAll,
    /** Reject all changes */
    rejectAll,
    /** Find a change by ID */
    findChangeById,
  };
}

export type UseTrackChangesReturn = ReturnType<typeof useTrackChanges>;
