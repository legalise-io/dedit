import {
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
import { createExportPayload } from "./utils/createExportPayload";
import { FindReplaceBar } from "../components/FindReplaceBar";

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

    const editorContainerRef = useRef<HTMLDivElement>(null);

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

    // Track current change index for next/prev navigation
    // NOTE: All hooks must be called before any early returns to comply with React's Rules of Hooks
    const [currentChangeIndex, setCurrentChangeIndex] = useState(-1);
    const [showFindReplace, setShowFindReplace] = useState(false);

    // Reset index when changes array changes significantly
    useEffect(() => {
      if (changes.length === 0) {
        setCurrentChangeIndex(-1);
      } else if (currentChangeIndex >= changes.length) {
        setCurrentChangeIndex(changes.length - 1);
      }
    }, [changes.length, currentChangeIndex]);

    const goToChange = useCallback(
      (index: number) => {
        if (!editor || changes.length === 0) return;
        const change = changes[index];
        if (change) {
          setCurrentChangeIndex(index);
          editor.commands.setTextSelection(change.from);

          // Scroll the change into view within the container
          setTimeout(() => {
            const container = editorContainerRef.current;
            if (!container) return;

            // Find the DOM element for this change
            const view = editor.view;
            const coords = view.coordsAtPos(change.from);
            const containerRect = container.getBoundingClientRect();

            // Calculate scroll position to center the change in view
            const relativeTop =
              coords.top - containerRect.top + container.scrollTop;
            const targetScroll = relativeTop - container.clientHeight / 2;

            container.scrollTo({
              top: Math.max(0, targetScroll),
              behavior: "smooth",
            });
          }, 0);
        }
      },
      [editor, changes],
    );

    const goToPrevChange = useCallback(() => {
      if (changes.length === 0) return;
      const newIndex =
        currentChangeIndex <= 0 ? changes.length - 1 : currentChangeIndex - 1;
      goToChange(newIndex);
    }, [currentChangeIndex, changes.length, goToChange]);

    const goToNextChange = useCallback(() => {
      if (changes.length === 0) return;
      const newIndex =
        currentChangeIndex < 0
          ? 0
          : currentChangeIndex >= changes.length - 1
            ? 0
            : currentChangeIndex + 1;
      goToChange(newIndex);
    }, [currentChangeIndex, changes.length, goToChange]);

    const acceptCurrentChange = useCallback(() => {
      if (currentChangeIndex >= 0 && currentChangeIndex < changes.length) {
        const change = changes[currentChangeIndex];
        acceptChange(change.id);
      }
    }, [currentChangeIndex, changes, acceptChange]);

    const rejectCurrentChange = useCallback(() => {
      if (currentChangeIndex >= 0 && currentChangeIndex < changes.length) {
        const change = changes[currentChangeIndex];
        rejectChange(change.id);
      }
    }, [currentChangeIndex, changes, rejectChange]);

    const trackChangesEnabled = trackChanges?.enabled ?? false;

    // Add/remove selected-change class to highlight current change
    useEffect(() => {
      if (!editor) return;

      const editorDom = editorContainerRef.current;
      if (!editorDom) return;

      // Remove previous selected-change highlights
      editorDom.querySelectorAll(".selected-change").forEach((el) => {
        el.classList.remove("selected-change");
      });

      // Add highlight to current change
      if (currentChangeIndex >= 0 && currentChangeIndex < changes.length) {
        const change = changes[currentChangeIndex];

        // Find the element by its data attribute
        const selector =
          change.type === "insertion"
            ? `ins[data-insertion-id="${change.id}"]`
            : `del[data-deletion-id="${change.id}"]`;

        const element = editorDom.querySelector(selector);
        if (element) {
          element.classList.add("selected-change");
        }
      }
    }, [editor, currentChangeIndex, changes]);

    // Early return after all hooks have been called
    if (!editor) {
      return null;
    }

    const renderToolbarItem = (item: ToolbarItem, index: number) => {
      switch (item) {
        case "separator":
          return <div key={`sep-${index}`} className="toolbar-separator" />;
        case "undo":
          return (
            <button
              key="undo"
              type="button"
              onClick={() => editor.chain().focus().undo().run()}
              className="toolbar-btn"
              title="Undo (Ctrl+Z)"
              disabled={!editor.can().undo()}
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
                <path d="M3 7v6h6"></path>
                <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path>
              </svg>
            </button>
          );
        case "redo":
          return (
            <button
              key="redo"
              type="button"
              onClick={() => editor.chain().focus().redo().run()}
              className="toolbar-btn"
              title="Redo (Ctrl+Y)"
              disabled={!editor.can().redo()}
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
                <path d="M21 7v6h-6"></path>
                <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"></path>
              </svg>
            </button>
          );
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
        case "trackChangesToggle":
          return (
            <button
              key="trackChangesToggle"
              type="button"
              onClick={() => setTrackChangesEnabled(!trackChangesEnabled)}
              className={`toolbar-btn ${trackChangesEnabled ? "is-active" : ""}`}
              title={
                trackChangesEnabled ? "Track Changes ON" : "Track Changes OFF"
              }
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
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
            </button>
          );
        case "prevChange":
          return (
            <button
              key="prevChange"
              type="button"
              onClick={goToPrevChange}
              className="toolbar-btn"
              title="Previous Change"
              disabled={changes.length === 0}
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
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
          );
        case "nextChange":
          return (
            <button
              key="nextChange"
              type="button"
              onClick={goToNextChange}
              className="toolbar-btn"
              title="Next Change"
              disabled={changes.length === 0}
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
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          );
        case "acceptChange":
          return (
            <button
              key="acceptChange"
              type="button"
              onClick={acceptCurrentChange}
              className="toolbar-btn toolbar-btn-accept"
              title="Accept Change"
              disabled={currentChangeIndex < 0}
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
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </button>
          );
        case "rejectChange":
          return (
            <button
              key="rejectChange"
              type="button"
              onClick={rejectCurrentChange}
              className="toolbar-btn toolbar-btn-reject"
              title="Reject Change"
              disabled={currentChangeIndex < 0}
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
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          );
        case "acceptAll":
          return (
            <button
              key="acceptAll"
              type="button"
              onClick={acceptAllChanges}
              className="toolbar-btn toolbar-btn-accept"
              title="Accept All Changes"
              disabled={changes.length === 0}
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
                <polyline points="18 6 9 17 4 12"></polyline>
                <polyline points="22 10 13 21 8 16"></polyline>
              </svg>
            </button>
          );
        case "rejectAll":
          return (
            <button
              key="rejectAll"
              type="button"
              onClick={rejectAllChanges}
              className="toolbar-btn toolbar-btn-reject"
              title="Reject All Changes"
              disabled={changes.length === 0}
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
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
                <circle cx="12" cy="12" r="10"></circle>
              </svg>
            </button>
          );
        case "addRowBefore":
          return (
            <button
              key="addRowBefore"
              type="button"
              onClick={() => editor.chain().focus().addRowBefore().run()}
              className="toolbar-btn"
              title="Add Row Above"
              disabled={!editor.can().addRowBefore()}
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
                <path d="M3 6h18"></path>
                <path d="M3 12h18"></path>
                <path d="M3 18h18"></path>
                <path d="M12 3v6"></path>
                <path d="M9 6l3-3 3 3"></path>
              </svg>
            </button>
          );
        case "addRowAfter":
          return (
            <button
              key="addRowAfter"
              type="button"
              onClick={() => editor.chain().focus().addRowAfter().run()}
              className="toolbar-btn"
              title="Add Row Below"
              disabled={!editor.can().addRowAfter()}
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
                <path d="M3 6h18"></path>
                <path d="M3 12h18"></path>
                <path d="M3 18h18"></path>
                <path d="M12 15v6"></path>
                <path d="M9 18l3 3 3-3"></path>
              </svg>
            </button>
          );
        case "deleteRow":
          return (
            <button
              key="deleteRow"
              type="button"
              onClick={() => editor.chain().focus().deleteRow().run()}
              className="toolbar-btn toolbar-btn-reject"
              title="Delete Row"
              disabled={!editor.can().deleteRow()}
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
                <path d="M3 6h18"></path>
                <path d="M3 12h18"></path>
                <path d="M3 18h18"></path>
                <path d="M8 12h8"></path>
              </svg>
            </button>
          );
        case "findReplace":
          return (
            <button
              key="findReplace"
              type="button"
              onClick={() => setShowFindReplace((prev) => !prev)}
              className={`toolbar-btn ${showFindReplace ? "is-active" : ""}`}
              title="Find & Replace (Ctrl+F)"
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
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
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
          <div className="editor-toolbar">
            {toolbar.map((item, index) => renderToolbarItem(item, index))}
          </div>
        )}
        {showFindReplace && (
          <FindReplaceBar
            editor={editor}
            onClose={() => setShowFindReplace(false)}
          />
        )}
        <div className="editor-scroll-container" ref={editorContainerRef}>
          <EditorContent editor={editor} className={classNames.content} />
        </div>
      </div>
    );
  },
);

export default DocumentEditor;
