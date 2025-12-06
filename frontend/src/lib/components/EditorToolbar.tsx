import React from "react";
import type { Editor } from "@tiptap/react";
import type { ToolbarItem, BuiltInToolbarItem, TrackedChange } from "../types";
import {
  UndoIcon,
  RedoIcon,
  BoldIcon,
  ItalicIcon,
  TrackChangesIcon,
  PrevChangeIcon,
  NextChangeIcon,
  AcceptIcon,
  RejectIcon,
  AcceptAllIcon,
  RejectAllIcon,
  AddRowBeforeIcon,
  AddRowAfterIcon,
  DeleteRowIcon,
  SearchIcon,
} from "./toolbar-icons";

export interface EditorToolbarProps {
  editor: Editor;
  toolbar: ToolbarItem[];
  trackChangesEnabled: boolean;
  onTrackChangesToggle: () => void;
  changes: TrackedChange[];
  currentChangeIndex: number;
  onPrevChange: () => void;
  onNextChange: () => void;
  onAcceptChange: () => void;
  onRejectChange: () => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  showFindReplace: boolean;
  onToggleFindReplace: () => void;
}

/**
 * Editor toolbar component with built-in and custom items.
 */
export function EditorToolbar({
  editor,
  toolbar,
  trackChangesEnabled,
  onTrackChangesToggle,
  changes,
  currentChangeIndex,
  onPrevChange,
  onNextChange,
  onAcceptChange,
  onRejectChange,
  onAcceptAll,
  onRejectAll,
  showFindReplace,
  onToggleFindReplace,
}: EditorToolbarProps) {
  const renderToolbarItem = (item: ToolbarItem, index: number) => {
    // If it's not a string, it's a custom React element
    if (typeof item !== "string") {
      return <React.Fragment key={`custom-${index}`}>{item}</React.Fragment>;
    }

    // Handle built-in toolbar items
    const builtInItem = item as BuiltInToolbarItem;
    switch (builtInItem) {
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
            <UndoIcon />
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
            <RedoIcon />
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
            <BoldIcon />
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
            <ItalicIcon />
          </button>
        );

      case "trackChangesToggle":
        return (
          <button
            key="trackChangesToggle"
            type="button"
            onClick={onTrackChangesToggle}
            className={`toolbar-btn ${trackChangesEnabled ? "is-active" : ""}`}
            title={trackChangesEnabled ? "Track Changes ON" : "Track Changes OFF"}
          >
            <TrackChangesIcon />
          </button>
        );

      case "prevChange":
        return (
          <button
            key="prevChange"
            type="button"
            onClick={onPrevChange}
            className="toolbar-btn"
            title="Previous Change"
            disabled={changes.length === 0}
          >
            <PrevChangeIcon />
          </button>
        );

      case "nextChange":
        return (
          <button
            key="nextChange"
            type="button"
            onClick={onNextChange}
            className="toolbar-btn"
            title="Next Change"
            disabled={changes.length === 0}
          >
            <NextChangeIcon />
          </button>
        );

      case "acceptChange":
        return (
          <button
            key="acceptChange"
            type="button"
            onClick={onAcceptChange}
            className="toolbar-btn toolbar-btn-accept"
            title="Accept Change"
            disabled={currentChangeIndex < 0}
          >
            <AcceptIcon />
          </button>
        );

      case "rejectChange":
        return (
          <button
            key="rejectChange"
            type="button"
            onClick={onRejectChange}
            className="toolbar-btn toolbar-btn-reject"
            title="Reject Change"
            disabled={currentChangeIndex < 0}
          >
            <RejectIcon />
          </button>
        );

      case "acceptAll":
        return (
          <button
            key="acceptAll"
            type="button"
            onClick={onAcceptAll}
            className="toolbar-btn toolbar-btn-accept"
            title="Accept All Changes"
            disabled={changes.length === 0}
          >
            <AcceptAllIcon />
          </button>
        );

      case "rejectAll":
        return (
          <button
            key="rejectAll"
            type="button"
            onClick={onRejectAll}
            className="toolbar-btn toolbar-btn-reject"
            title="Reject All Changes"
            disabled={changes.length === 0}
          >
            <RejectAllIcon />
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
            <AddRowBeforeIcon />
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
            <AddRowAfterIcon />
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
            <DeleteRowIcon />
          </button>
        );

      case "findReplace":
        return (
          <button
            key="findReplace"
            type="button"
            onClick={onToggleFindReplace}
            className={`toolbar-btn ${showFindReplace ? "is-active" : ""}`}
            title="Find & Replace (Ctrl+F)"
          >
            <SearchIcon />
          </button>
        );

      default:
        return null;
    }
  };

  return (
    <div className="editor-toolbar">
      {toolbar.map((item, index) => renderToolbarItem(item, index))}
    </div>
  );
}
