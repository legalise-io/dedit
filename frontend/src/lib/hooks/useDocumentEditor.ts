import { useEditor } from "@tiptap/react";
import { useMemo, useCallback } from "react";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import History from "@tiptap/extension-history";

import Section from "../../extensions/Section";
import TableWithId from "../../extensions/TableWithId";
import { ParagraphWithId } from "../../extensions/ParagraphWithId";
import { HeadingWithStyle } from "../../extensions/HeadingWithStyle";
import { HardBreakWithType } from "../../extensions/HardBreakWithType";
import { PersistentSelection } from "../../extensions/PersistentSelection";
import { Insertion } from "../../extensions/Insertion";
import { Deletion } from "../../extensions/Deletion";
import { Comment } from "../../extensions/Comment";
import { RawStyle } from "../../extensions/RawStyle";
import { TrackChangesMode } from "../../extensions/TrackChangesMode";
import { SearchAndReplace } from "../../extensions/SearchAndReplace";
import { RawStylesStorage } from "../../extensions/RawStylesStorage";
import { StyleNumbering } from "../../extensions/StyleNumbering";
import { Tab } from "../../extensions/Tab";

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

    const headingLevels = extensionConfig.heading?.levels || [1, 2, 3, 4, 5, 6];
    const tableResizable = extensionConfig.table?.resizable ?? false;

    const baseExtensions = [
      Document,
      ParagraphWithId,
      Text,
      HeadingWithStyle.configure({
        levels: headingLevels,
      }),
      Bold,
      Italic,
      HardBreakWithType,
      Tab,
      Section,
      TableWithId.configure({
        resizable: tableResizable,
      }),
      TableRow,
      TableCell,
      TableHeader,
      Insertion,
      Deletion,
      Comment,
      RawStyle,
      TrackChangesMode.configure({
        enabled: trackChangesEnabled,
        author: trackChangesAuthor,
      }),
      SearchAndReplace.configure({
        searchResultClass: "search-result",
      }),
      PersistentSelection,
      RawStylesStorage,
      StyleNumbering,
    ];

    // Only include History if not using collaboration (Yjs has its own undo manager)
    if (!hasCollaboration) {
      baseExtensions.push(
        History.configure({
          depth: 100,
        }),
      );
    }

    return [...baseExtensions, ...additionalExtensions];
  }, [
    replaceExtensions,
    additionalExtensions,
    extensionConfig,
    trackChangesEnabled,
    trackChangesAuthor,
    hasCollaboration,
  ]);

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
    [initialContent, hasCollaboration],
  );

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
