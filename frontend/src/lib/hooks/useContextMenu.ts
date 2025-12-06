import { useState, useEffect, useCallback } from "react";

export interface ContextMenuState {
  x: number;
  y: number;
  hasChangesInSelection: boolean;
}

export interface UseContextMenuReturn {
  contextMenu: ContextMenuState | null;
  openContextMenu: (e: React.MouseEvent, hasChangesInSelection: boolean) => void;
  closeContextMenu: () => void;
}

/**
 * Hook to manage context menu state with auto-close on click/scroll.
 */
export function useContextMenu(enabled: boolean): UseContextMenuReturn {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Close context menu when clicking elsewhere or scrolling
  useEffect(() => {
    if (!contextMenu) return;

    const handleClick = () => setContextMenu(null);
    const handleScroll = () => setContextMenu(null);

    document.addEventListener("click", handleClick);
    document.addEventListener("scroll", handleScroll, true);

    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [contextMenu]);

  const openContextMenu = useCallback(
    (e: React.MouseEvent, hasChangesInSelection: boolean) => {
      if (!enabled) return;
      e.preventDefault();
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        hasChangesInSelection,
      });
    },
    [enabled],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return {
    contextMenu,
    openContextMenu,
    closeContextMenu,
  };
}
