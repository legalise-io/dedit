import React, {
  forwardRef,
  useImperativeHandle,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useState,
} from "react";
import { EditorContent } from "@tiptap/react";

import { useDocumentEditor } from "./hooks/useDocumentEditor";
import { useTrackChanges } from "./hooks/useTrackChanges";
import { useComments } from "./hooks/useComments";
import { useChangeNavigation } from "./hooks/useChangeNavigation";
import { useContextMenu } from "./hooks/useContextMenu";
import { createExportPayload } from "./utils/createExportPayload";
import { FindReplaceBar } from "../components/FindReplaceBar";
import { EditorToolbar } from "./components/EditorToolbar";
import { EditorContextMenu } from "./components/EditorContextMenu";

import type {
  DocumentEditorProps,
  EditorHandle,
  TipTapDocument,
  TrackedChange,
  ExportOptions,
} from "./types";

/**
 * A flexible, unstyled document editor component with track changes and comments support.
 *
 * @example Basic usage
 * ```tsx
 * <DocumentEditor
 *   initialContent={content}
 *   onChange={(json) => setContent(json)}
 *   className="my-editor"
 * />
 * ```
 *
 * @example With track changes
 * ```tsx
 * const editorRef = useRef<EditorHandle>(null);
 *
 * <DocumentEditor
 *   editorRef={editorRef}
 *   content={content}
 *   onChange={setContent}
 *   trackChanges={{
 *     enabled: true,
 *     author: "John Doe",
 *   }}
 * />
 *
 * // Later: accept all changes
 * editorRef.current?.acceptAllChanges();
 * ```
 *
 * @example With comments
 * ```tsx
 * <DocumentEditor
 *   content={content}
 *   onChange={setContent}
 *   comments={{
 *     data: comments,
 *     onAdd: (range, text) => createComment(range, text),
 *     onResolve: (id) => resolveComment(id),
 *   }}
 * />
 * ```
 */
export const DocumentEditor = forwardRef<EditorHandle, DocumentEditorProps>(
  function DocumentEditor(props, ref) {
    const {
      initialContent,
      content: controlledContent,
      onChange,
      readOnly = false,
      placeholder,
      trackChanges,
      comments,
      className,
      classNames = {},
      style,
      extensions,
      replaceExtensions,
      extensionConfig,
      toolbar,
      enableContextMenu = false,
      onEditorReady,
    } = props;

    const editorContainerRef = useRef<HTMLDivElement>(null);
    const [showFindReplace, setShowFindReplace] = useState(false);

    // Determine if controlled or uncontrolled
    const isControlled = controlledContent !== undefined;
    const effectiveContent = isControlled ? controlledContent : initialContent;

    // Initialize the editor
    const { editor, setContent, focus, blur } = useDocumentEditor({
      initialContent: effectiveContent,
      onChange,
      readOnly,
      placeholder,
      extensions,
      replaceExtensions,
      extensionConfig,
      trackChangesEnabled: trackChanges?.enabled ?? false,
      trackChangesAuthor: trackChanges?.author ?? "Unknown Author",
    });

    // Track changes functionality
    const {
      setEnabled: setTrackChangesEnabled,
      setAuthor: setTrackChangesAuthor,
      changes,
      acceptChange,
      rejectChange,
      acceptAll: acceptAllChanges,
      rejectAll: rejectAllChanges,
    } = useTrackChanges(editor, {
      enabled: trackChanges?.enabled,
      author: trackChanges?.author,
      onEnabledChange: trackChanges?.onEnabledChange,
      onAuthorChange: trackChanges?.onAuthorChange,
      onAccept: trackChanges?.onAccept,
      onReject: trackChanges?.onReject,
    });

    // Comments functionality
    useComments(editor, {
      data: comments?.data,
      onAdd: comments?.onAdd,
      onReply: comments?.onReply,
      onResolve: comments?.onResolve,
      onDelete: comments?.onDelete,
    });

    // Change navigation
    const {
      currentChangeIndex,
      goToPrevChange,
      goToNextChange,
      acceptCurrentChange,
      rejectCurrentChange,
      getChangesInSelection,
      acceptChangesInSelection,
      rejectChangesInSelection,
    } = useChangeNavigation({
      editor,
      changes,
      containerRef: editorContainerRef,
      acceptChange,
      rejectChange,
    });

    // Context menu
    const { contextMenu, openContextMenu, closeContextMenu } =
      useContextMenu(enableContextMenu);

    // Notify when editor instance is ready or changes
    useEffect(() => {
      if (editor && onEditorReady) {
        onEditorReady(editor);
      }
    }, [editor, onEditorReady]);

    // Sync track changes props
    useEffect(() => {
      if (trackChanges?.enabled !== undefined) {
        setTrackChangesEnabled(trackChanges.enabled);
      }
    }, [trackChanges?.enabled, setTrackChangesEnabled]);

    useEffect(() => {
      if (trackChanges?.author !== undefined) {
        setTrackChangesAuthor(trackChanges.author);
      }
    }, [trackChanges?.author, setTrackChangesAuthor]);

    // Create the imperative handle
    const getContent = useCallback(():
      | TipTapDocument
      | Record<string, unknown> => {
      return editor?.getJSON() ?? { type: "doc", content: [] };
    }, [editor]);

    const getChanges = useCallback((): TrackedChange[] => {
      return changes;
    }, [changes]);

    const handleAcceptChange = useCallback(
      (changeId: string) => {
        acceptChange(changeId);
      },
      [acceptChange],
    );

    const handleRejectChange = useCallback(
      (changeId: string) => {
        rejectChange(changeId);
      },
      [rejectChange],
    );

    const handleCreateExportPayload = useCallback(
      (options?: ExportOptions) => {
        return createExportPayload(getContent(), comments?.data ?? [], options);
      },
      [getContent, comments?.data],
    );

    useImperativeHandle(
      ref,
      () => ({
        getContent,
        setContent,
        getChanges,
        acceptChange: handleAcceptChange,
        rejectChange: handleRejectChange,
        acceptAllChanges,
        rejectAllChanges,
        setTrackChangesEnabled,
        setTrackChangesAuthor,
        getEditor: () => editor,
        focus,
        blur,
        createExportPayload: handleCreateExportPayload,
      }),
      [
        getContent,
        setContent,
        getChanges,
        handleAcceptChange,
        handleRejectChange,
        acceptAllChanges,
        rejectAllChanges,
        setTrackChangesEnabled,
        setTrackChangesAuthor,
        editor,
        focus,
        blur,
        handleCreateExportPayload,
      ],
    );

    // Build class names
    const rootClassName = useMemo(() => {
      const classes: string[] = ["document-editor"];
      if (className) classes.push(className);
      if (classNames.root) classes.push(classNames.root);
      return classes.join(" ");
    }, [className, classNames.root]);

    const trackChangesEnabled = trackChanges?.enabled ?? false;

    const handleToggleTrackChanges = useCallback(() => {
      setTrackChangesEnabled(!trackChangesEnabled);
    }, [trackChangesEnabled, setTrackChangesEnabled]);

    const handleToggleFindReplace = useCallback(() => {
      setShowFindReplace((prev) => !prev);
    }, []);

    const handleContextMenu = useCallback(
      (e: React.MouseEvent) => {
        const changesInSel = getChangesInSelection();
        openContextMenu(e, changesInSel.length > 0);
      },
      [getChangesInSelection, openContextMenu],
    );

    const handleAcceptChangesInSelection = useCallback(() => {
      acceptChangesInSelection();
      closeContextMenu();
    }, [acceptChangesInSelection, closeContextMenu]);

    const handleRejectChangesInSelection = useCallback(() => {
      rejectChangesInSelection();
      closeContextMenu();
    }, [rejectChangesInSelection, closeContextMenu]);

    // Early return after all hooks have been called
    if (!editor) {
      return null;
    }

    return (
      <div className={rootClassName} style={style}>
        {toolbar && toolbar.length > 0 && (
          <EditorToolbar
            editor={editor}
            toolbar={toolbar}
            trackChangesEnabled={trackChangesEnabled}
            onTrackChangesToggle={handleToggleTrackChanges}
            changes={changes}
            currentChangeIndex={currentChangeIndex}
            onPrevChange={goToPrevChange}
            onNextChange={goToNextChange}
            onAcceptChange={acceptCurrentChange}
            onRejectChange={rejectCurrentChange}
            onAcceptAll={acceptAllChanges}
            onRejectAll={rejectAllChanges}
            showFindReplace={showFindReplace}
            onToggleFindReplace={handleToggleFindReplace}
          />
        )}
        {showFindReplace && (
          <FindReplaceBar
            editor={editor}
            onClose={() => setShowFindReplace(false)}
          />
        )}
        <div
          className="editor-scroll-container"
          ref={editorContainerRef}
          onContextMenu={handleContextMenu}
        >
          <EditorContent editor={editor} className={classNames.content} />
        </div>

        {contextMenu && (
          <EditorContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            hasChangesInSelection={contextMenu.hasChangesInSelection}
            onAcceptChanges={handleAcceptChangesInSelection}
            onRejectChanges={handleRejectChangesInSelection}
          />
        )}
      </div>
    );
  },
);

export default DocumentEditor;
