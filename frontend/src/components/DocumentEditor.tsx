import { useEditor, EditorContent, Editor } from "@tiptap/react";
import { useEffect, useMemo, useCallback, useRef, useState } from "react";
import Document from "@tiptap/extension-document";
import { useAIEditorOptional } from "../context/AIEditorContext";
import { ParagraphWithId } from "../extensions/ParagraphWithId";
import Text from "@tiptap/extension-text";
import Heading from "@tiptap/extension-heading";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";

import Section from "../extensions/Section";
import TableWithId from "../extensions/TableWithId";
import { Insertion } from "../extensions/Insertion";
import { Deletion } from "../extensions/Deletion";
import { Comment } from "../extensions/Comment";
import { TrackChangesMode } from "../extensions/TrackChangesMode";

type ToolbarItem =
  | "bold"
  | "italic"
  | "separator"
  | "trackChangesToggle"
  | "acceptChange"
  | "rejectChange"
  | "prevChange"
  | "nextChange"
  | "acceptAll"
  | "rejectAll";

interface TrackedChange {
  id: string;
  type: "insertion" | "deletion";
  author: string | null;
  date: string | null;
  text: string;
  from: number;
  to: number;
}

interface DocumentEditorProps {
  content: Record<string, unknown> | null;
  onUpdate?: (json: Record<string, unknown>) => void;
  onEditorReady?: (editor: Editor) => void;
  toolbar?: ToolbarItem[];
  trackChangesEnabled?: boolean;
  onTrackChangesToggle?: (enabled: boolean) => void;
}

export function DocumentEditor({
  content,
  onUpdate,
  onEditorReady,
  toolbar,
  trackChangesEnabled = false,
  onTrackChangesToggle,
}: DocumentEditorProps) {
  const editorContainerRef = useRef<HTMLDivElement>(null);

  // Get AI editor context if available (for syncing edit status)
  const aiEditorContext = useAIEditorOptional();

  const editor = useEditor(
    {
      extensions: [
        Document,
        ParagraphWithId,
        Text,
        Heading.configure({
          levels: [1, 2, 3, 4, 5, 6],
        }),
        Bold,
        Italic,
        Section,
        TableWithId.configure({
          resizable: false,
        }),
        TableRow,
        TableCell,
        TableHeader,
        Insertion,
        Deletion,
        Comment,
        TrackChangesMode.configure({
          enabled: false,
          author: "Current User",
        }),
      ],
      content: content || {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Upload a Word document to begin editing.",
              },
            ],
          },
        ],
      },
      onUpdate: ({ editor }) => {
        if (onUpdate) {
          onUpdate(editor.getJSON());
        }
      },
    },
    [content],
  );

  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  // Sync track changes state with editor
  useEffect(() => {
    if (!editor) return;
    if (trackChangesEnabled) {
      editor.commands.enableTrackChanges();
    } else {
      editor.commands.disableTrackChanges();
    }
  }, [editor, trackChangesEnabled]);

  // Extract tracked changes from DOM elements (more reliable ordering)
  const changes = useMemo((): TrackedChange[] => {
    if (!editor) return [];

    const editorDom = editor.view.dom;
    const foundChanges: TrackedChange[] = [];

    // Get all ins and del elements in DOM order using TreeWalker
    const walker = document.createTreeWalker(
      editorDom,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          const el = node as Element;
          if (
            (el.tagName === "INS" && el.classList.contains("insertion")) ||
            (el.tagName === "DEL" && el.classList.contains("deletion"))
          ) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        },
      },
    );

    let index = 0;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const el = node as Element;
      const isInsertion = el.tagName === "INS";
      foundChanges.push({
        id:
          el.getAttribute(
            isInsertion ? "data-insertion-id" : "data-deletion-id",
          ) || `dom-${index}`,
        type: isInsertion ? "insertion" : "deletion",
        author: el.getAttribute("data-author") || null,
        date: el.getAttribute("data-date") || null,
        text: el.textContent || "",
        from: index,
        to: index + 1,
      });
      index++;
    }

    return foundChanges;
  }, [editor?.state.doc]);

  // Track current change index for next/prev navigation
  const [currentChangeIndex, setCurrentChangeIndex] = useState(-1);

  // Reset index when changes array changes significantly
  useEffect(() => {
    if (changes.length === 0) {
      setCurrentChangeIndex(-1);
    } else if (currentChangeIndex >= changes.length) {
      setCurrentChangeIndex(changes.length - 1);
    }
  }, [changes.length, currentChangeIndex]);

  // Track selected change ID for CSS-based highlighting
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    hasChangesInSelection: boolean;
  } | null>(null);

  // Function to select a change by its ID (used by AI chat panel)
  const selectChangeById = useCallback(
    (changeId: string) => {
      if (!editor) return;

      const editorDom = editor.view.dom;

      // Find the element with the matching change ID
      const walker = document.createTreeWalker(
        editorDom,
        NodeFilter.SHOW_ELEMENT,
        {
          acceptNode: (node) => {
            const el = node as Element;
            if (
              (el.tagName === "INS" && el.classList.contains("insertion")) ||
              (el.tagName === "DEL" && el.classList.contains("deletion"))
            ) {
              return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_SKIP;
          },
        },
      );

      let index = 0;
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const el = node as Element;
        const isInsertion = el.tagName === "INS";
        const id = el.getAttribute(
          isInsertion ? "data-insertion-id" : "data-deletion-id",
        );

        if (id === changeId) {
          setCurrentChangeIndex(index);
          setSelectedChangeId(changeId);
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
        index++;
      }
    },
    [editor],
  );

  // Listen for AI-triggered change selection events
  useEffect(() => {
    const handleAISelectChange = (event: Event) => {
      const customEvent = event as CustomEvent<{
        index: number;
        changeId: string;
      }>;
      const { changeId } = customEvent.detail;
      selectChangeById(changeId);
    };

    window.addEventListener("ai-select-change", handleAISelectChange);
    return () => {
      window.removeEventListener("ai-select-change", handleAISelectChange);
    };
  }, [selectChangeById]);

  const goToChange = useCallback(
    (index: number) => {
      if (!editor || changes.length === 0) return;
      const change = changes[index];
      if (change) {
        setCurrentChangeIndex(index);
        setSelectedChangeId(change.id);

        const editorDom = editor.view.dom;

        // Find the element fresh from DOM and scroll to it
        const walker = document.createTreeWalker(
          editorDom,
          NodeFilter.SHOW_ELEMENT,
          {
            acceptNode: (node) => {
              const el = node as Element;
              if (
                (el.tagName === "INS" && el.classList.contains("insertion")) ||
                (el.tagName === "DEL" && el.classList.contains("deletion"))
              ) {
                return NodeFilter.FILTER_ACCEPT;
              }
              return NodeFilter.FILTER_SKIP;
            },
          },
        );

        let i = 0;
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (i === index) {
            const el = node as Element;
            el.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
            break;
          }
          i++;
        }
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

  const acceptChange = useCallback(
    (change: TrackedChange) => {
      if (!editor) return;
      if (change.type === "insertion") {
        editor.commands.acceptInsertion(change.id);
      } else {
        editor.commands.acceptDeletion(change.id);
      }
      // Sync with AI editor context if available
      aiEditorContext?.updateEditStatusByTrackChangeId(change.id, "accepted");
    },
    [editor, aiEditorContext],
  );

  const rejectChange = useCallback(
    (change: TrackedChange) => {
      if (!editor) return;
      if (change.type === "insertion") {
        editor.commands.rejectInsertion(change.id);
      } else {
        editor.commands.rejectDeletion(change.id);
      }
      // Sync with AI editor context if available
      aiEditorContext?.updateEditStatusByTrackChangeId(change.id, "rejected");
    },
    [editor, aiEditorContext],
  );

  // Helper to select change at index by querying fresh DOM
  const selectChangeAtIndex = useCallback(
    (index: number) => {
      if (!editor) return;
      const editorDom = editor.view.dom;

      // Query fresh DOM for current changes
      const walker = document.createTreeWalker(
        editorDom,
        NodeFilter.SHOW_ELEMENT,
        {
          acceptNode: (node) => {
            const el = node as Element;
            if (
              (el.tagName === "INS" && el.classList.contains("insertion")) ||
              (el.tagName === "DEL" && el.classList.contains("deletion"))
            ) {
              return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_SKIP;
          },
        },
      );

      const elements: Element[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) {
        elements.push(node as Element);
      }

      if (elements.length === 0) {
        setCurrentChangeIndex(-1);
        setSelectedChangeId(null);
        return;
      }

      // Clamp index to valid range
      const newIndex = Math.min(index, elements.length - 1);
      const el = elements[newIndex];
      const isInsertion = el.tagName === "INS";
      const changeId = el.getAttribute(
        isInsertion ? "data-insertion-id" : "data-deletion-id",
      );

      setCurrentChangeIndex(newIndex);
      setSelectedChangeId(changeId);
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [editor],
  );

  const acceptCurrentChange = useCallback(() => {
    if (currentChangeIndex >= 0 && currentChangeIndex < changes.length) {
      const indexToSelect = currentChangeIndex;
      acceptChange(changes[currentChangeIndex]);
      // Schedule navigation after DOM updates - use fresh DOM query
      setTimeout(() => {
        selectChangeAtIndex(indexToSelect);
      }, 100);
    }
  }, [currentChangeIndex, changes, acceptChange, selectChangeAtIndex]);

  const rejectCurrentChange = useCallback(() => {
    if (currentChangeIndex >= 0 && currentChangeIndex < changes.length) {
      const indexToSelect = currentChangeIndex;
      rejectChange(changes[currentChangeIndex]);
      // Schedule navigation after DOM updates - use fresh DOM query
      setTimeout(() => {
        selectChangeAtIndex(indexToSelect);
      }, 100);
    }
  }, [currentChangeIndex, changes, rejectChange, selectChangeAtIndex]);

  const acceptAllChanges = useCallback(() => {
    [...changes].sort((a, b) => b.from - a.from).forEach(acceptChange);
  }, [changes, acceptChange]);

  const rejectAllChanges = useCallback(() => {
    [...changes].sort((a, b) => b.from - a.from).forEach(rejectChange);
  }, [changes, rejectChange]);

  // Get changes within the current text selection
  const getChangesInSelection = useCallback((): TrackedChange[] => {
    if (!editor) return [];

    const { from, to } = editor.state.selection;
    if (from === to) return []; // No selection

    const changesInSelection: TrackedChange[] = [];
    const doc = editor.state.doc;

    doc.nodesBetween(from, to, (node, pos) => {
      if (node.isText && node.marks) {
        node.marks.forEach((mark) => {
          if (mark.type.name === "insertion" || mark.type.name === "deletion") {
            // Check if this change overlaps with selection
            const markFrom = pos;
            const markTo = pos + node.nodeSize;
            if (markFrom < to && markTo > from) {
              // Check if we already have this change (by id)
              const existing = changesInSelection.find(
                (c) => c.id === mark.attrs.id,
              );
              if (!existing) {
                changesInSelection.push({
                  id: mark.attrs.id,
                  type: mark.type.name as "insertion" | "deletion",
                  author: mark.attrs.author,
                  date: mark.attrs.date,
                  text: node.text || "",
                  from: markFrom,
                  to: markTo,
                });
              }
            }
          }
        });
      }
    });

    return changesInSelection;
  }, [editor]);

  // Accept all changes in the current selection
  const acceptChangesInSelection = useCallback(() => {
    const changesInSel = getChangesInSelection();
    // Process from end to start to preserve positions
    [...changesInSel].sort((a, b) => b.from - a.from).forEach(acceptChange);
    setContextMenu(null);
  }, [getChangesInSelection, acceptChange]);

  // Reject all changes in the current selection
  const rejectChangesInSelection = useCallback(() => {
    const changesInSel = getChangesInSelection();
    // Process from end to start to preserve positions
    [...changesInSel].sort((a, b) => b.from - a.from).forEach(rejectChange);
    setContextMenu(null);
  }, [getChangesInSelection, rejectChange]);

  // Handle context menu (right-click)
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const changesInSel = getChangesInSelection();
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        hasChangesInSelection: changesInSel.length > 0,
      });
    },
    [getChangesInSelection],
  );

  // Close context menu when clicking elsewhere
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    const handleScroll = () => setContextMenu(null);

    if (contextMenu) {
      document.addEventListener("click", handleClick);
      document.addEventListener("scroll", handleScroll, true);
      return () => {
        document.removeEventListener("click", handleClick);
        document.removeEventListener("scroll", handleScroll, true);
      };
    }
  }, [contextMenu]);

  if (!editor) {
    return <div className="loading">Loading editor...</div>;
  }

  const renderToolbarItem = (item: ToolbarItem, index: number) => {
    switch (item) {
      case "separator":
        return <div key={`sep-${index}`} className="toolbar-separator" />;
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
            onClick={() => onTrackChangesToggle?.(!trackChangesEnabled)}
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
      default:
        return null;
    }
  };

  // Generate dynamic CSS for highlighting the selected change by its data attribute
  const highlightStyle = selectedChangeId
    ? `
      ins[data-insertion-id="${selectedChangeId}"],
      del[data-deletion-id="${selectedChangeId}"] {
        outline: 2px solid #0066cc !important;
        outline-offset: 1px;
        border-radius: 2px;
      }
    `
    : "";

  return (
    <div className="document-editor">
      {highlightStyle && <style>{highlightStyle}</style>}
      {toolbar && toolbar.length > 0 && (
        <div className="editor-toolbar">
          {toolbar.map((item, index) => renderToolbarItem(item, index))}
        </div>
      )}
      <div
        className="editor-scroll-container"
        ref={editorContainerRef}
        onContextMenu={handleContextMenu}
      >
        <EditorContent editor={editor} className="tiptap" />
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="editor-context-menu"
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
          }}
        >
          {contextMenu.hasChangesInSelection ? (
            <>
              <button
                type="button"
                className="context-menu-item context-menu-item--accept"
                onClick={acceptChangesInSelection}
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
                Accept Changes in Selection
              </button>
              <button
                type="button"
                className="context-menu-item context-menu-item--reject"
                onClick={rejectChangesInSelection}
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
                Reject Changes in Selection
              </button>
            </>
          ) : (
            <div className="context-menu-item context-menu-item--disabled">
              No changes in selection
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DocumentEditor;
