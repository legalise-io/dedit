import { useEditor } from "@tiptap/react";
import { useMemo, useCallback, useEffect } from "react";
import { createDeditExtensions } from "../extensions/createDeditExtensions";

import type { TipTapDocument, UseDocumentEditorOptions } from "../types";

const DEFAULT_CONTENT: TipTapDocument = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [],
    },
  ],
};

/**
 * Hook for creating and managing a TipTap editor instance with track changes support.
 *
 * @example
 * ```tsx
 * const { editor, content, setContent, isReady } = useDocumentEditor({
 *   initialContent: myDocument,
 *   onChange: (content) => console.log('Changed:', content),
 *   trackChangesEnabled: true,
 *   trackChangesAuthor: 'John Doe',
 * });
 * ```
 */
export function useDocumentEditor(options: UseDocumentEditorOptions = {}) {
  const {
    initialContent,
    onChange,
    readOnly = false,
    extensions: additionalExtensions = [],
    replaceExtensions,
    extensionConfig = {},
    trackChangesEnabled = false,
    trackChangesAuthor = "Unknown Author",
  } = options;

  // Check if collaboration extensions are included (they manage their own history)
  const hasCollaboration = useMemo(() => {
    return additionalExtensions.some(
      (ext) =>
        ext.name === "collaboration" || ext.name === "collaborationCursor",
    );
  }, [additionalExtensions]);

  // Build extensions list
  const extensions = useMemo(() => {
    if (replaceExtensions) {
      return replaceExtensions;
    }

    const baseExtensions = createDeditExtensions({
      collaboration: hasCollaboration,
      headingLevels: extensionConfig.heading?.levels,
      tableResizable: extensionConfig.table?.resizable,
      trackChangesEnabled,
      trackChangesAuthor,
    });

    return [...baseExtensions, ...additionalExtensions];
  }, [
    replaceExtensions,
    additionalExtensions,
    extensionConfig,
    trackChangesEnabled,
    trackChangesAuthor,
    hasCollaboration,
  ]);

  const contentKey = JSON.stringify(initialContent);
  const editor = useEditor(
    {
      extensions,
      // Don't set content when using collaboration - Yjs manages the document
      content: hasCollaboration ? undefined : initialContent || DEFAULT_CONTENT,
      editable: !readOnly,
      onUpdate: ({ editor }) => {
        if (onChange) {
          onChange(editor.getJSON() as TipTapDocument);
        }
      },
    },
    [contentKey, hasCollaboration],
  );

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  const isReady = editor !== null;

  const content = useMemo(() => {
    return editor?.getJSON() as TipTapDocument | null;
  }, [editor?.state.doc]);

  const setContent = useCallback(
    (newContent: TipTapDocument | Record<string, unknown>) => {
      if (editor) {
        editor.commands.setContent(newContent);
      }
    },
    [editor],
  );

  const focus = useCallback(() => {
    editor?.commands.focus();
  }, [editor]);

  const blur = useCallback(() => {
    editor?.commands.blur();
  }, [editor]);

  return {
    /** The TipTap editor instance */
    editor,
    /** Current document content as JSON */
    content,
    /** Set document content */
    setContent,
    /** Whether the editor is ready */
    isReady,
    /** Focus the editor */
    focus,
    /** Blur the editor */
    blur,
  };
}

export type UseDocumentEditorReturn = ReturnType<typeof useDocumentEditor>;
