import { AcceptIcon, RejectIcon } from "./toolbar-icons";

export interface EditorContextMenuProps {
  x: number;
  y: number;
  hasChangesInSelection: boolean;
  onAcceptChanges: () => void;
  onRejectChanges: () => void;
}

/**
 * Context menu for accepting/rejecting track changes in selection.
 */
export function EditorContextMenu({
  x,
  y,
  hasChangesInSelection,
  onAcceptChanges,
  onRejectChanges,
}: EditorContextMenuProps) {
  return (
    <div
      className="editor-context-menu"
      style={{
        position: "fixed",
        left: x,
        top: y,
      }}
    >
      {hasChangesInSelection ? (
        <>
          <button
            type="button"
            className="context-menu-item context-menu-item--accept"
            onClick={onAcceptChanges}
          >
            <AcceptIcon />
            Accept Changes in Selection
          </button>
          <button
            type="button"
            className="context-menu-item context-menu-item--reject"
            onClick={onRejectChanges}
          >
            <RejectIcon />
            Reject Changes in Selection
          </button>
        </>
      ) : (
        <div className="context-menu-item context-menu-item--disabled">
          No changes in selection
        </div>
      )}
    </div>
  );
}
