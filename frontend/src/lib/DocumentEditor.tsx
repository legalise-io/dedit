import {
  forwardRef,
  useImperativeHandle,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import { EditorContent } from "@tiptap/react";

import { useDocumentEditor } from "./hooks/useDocumentEditor";
import { useTrackChanges } from "./hooks/useTrackChanges";
import { useComments } from "./hooks/useComments";
import { createExportPayload } from "./utils/createExportPayload";

import type {
  DocumentEditorProps,
  EditorHandle,
  TipTapDocument,
  TrackedChange,
  ExportOptions,
  ToolbarItem,
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
    } = props;

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
      onAuthorChange: trackChanges?.onAuthorChange,
      onAccept: trackChanges?.onAccept,
      onReject: trackChanges?.onReject,
    });

    // Comments functionality - initialize hook for side effects
    useComments(editor, {
      data: comments?.data,
      onAdd: comments?.onAdd,
      onReply: comments?.onReply,
      onResolve: comments?.onResolve,
      onDelete: comments?.onDelete,
    });

    // Sync controlled content
    useEffect(() => {
      if (isControlled && editor && controlledContent) {
        const currentContent = JSON.stringify(editor.getJSON());
        const newContent = JSON.stringify(controlledContent);
        if (currentContent !== newContent) {
          setContent(controlledContent);
        }
      }
    }, [isControlled, editor, controlledContent, setContent]);

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
      const classes: string[] = [];
      if (className) classes.push(className);
      if (classNames.root) classes.push(classNames.root);
      return classes.join(" ") || undefined;
    }, [className, classNames.root]);

    if (!editor) {
      return null;
    }

    const renderToolbarItem = (item: ToolbarItem) => {
      switch (item) {
        case "bold":
          return (
            <button
              key="bold"
              type="button"
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`toolbar-btn ${editor.isActive("bold") ? "is-active" : ""}`}
              title="Bold (Ctrl+B)"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"></path>
                <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"></path>
              </svg>
            </button>
          );
        case "italic":
          return (
            <button
              key="italic"
              type="button"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={`toolbar-btn ${editor.isActive("italic") ? "is-active" : ""}`}
              title="Italic (Ctrl+I)"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="19" y1="4" x2="10" y2="4"></line>
                <line x1="14" y1="20" x2="5" y2="20"></line>
                <line x1="15" y1="4" x2="9" y2="20"></line>
              </svg>
            </button>
          );
        default:
          return null;
      }
    };

    return (
      <div className={rootClassName} style={style}>
        {toolbar && toolbar.length > 0 && (
          <div className="editor-toolbar">{toolbar.map(renderToolbarItem)}</div>
        )}
        <EditorContent editor={editor} className={classNames.content} />
      </div>
    );
  },
);

export default DocumentEditor;
