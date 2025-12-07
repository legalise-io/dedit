import { useState, useEffect, useCallback, RefObject } from "react";
import type { Editor } from "@tiptap/react";
import type { TrackedChange } from "../types";

export interface UseChangeNavigationOptions {
  editor: Editor | null;
  changes: TrackedChange[];
  containerRef: RefObject<HTMLDivElement>;
  acceptChange: (id: string) => void;
  rejectChange: (id: string) => void;
}

export interface UseChangeNavigationReturn {
  currentChangeIndex: number;
  goToChange: (index: number) => void;
  goToPrevChange: () => void;
  goToNextChange: () => void;
  acceptCurrentChange: () => void;
  rejectCurrentChange: () => void;
  getChangesInSelection: () => TrackedChange[];
  acceptChangesInSelection: () => void;
  rejectChangesInSelection: () => void;
}

/**
 * Hook to manage track change navigation and selection-based operations.
 */
export function useChangeNavigation({
  editor,
  changes,
  containerRef,
  acceptChange,
  rejectChange,
}: UseChangeNavigationOptions): UseChangeNavigationReturn {
  const [currentChangeIndex, setCurrentChangeIndex] = useState(-1);

  // Reset index when changes array changes significantly
  useEffect(() => {
    if (changes.length === 0) {
      setCurrentChangeIndex(-1);
    } else if (currentChangeIndex >= changes.length) {
      setCurrentChangeIndex(changes.length - 1);
    }
  }, [changes.length, currentChangeIndex]);

  // Add/remove selected-change class to highlight current change
  useEffect(() => {
    if (!editor) return;

    const editorDom = containerRef.current;
    if (!editorDom) return;

    // Remove previous selected-change highlights
    editorDom.querySelectorAll(".selected-change").forEach((el) => {
      el.classList.remove("selected-change");
    });

    // Add highlight to current change
    if (currentChangeIndex >= 0 && currentChangeIndex < changes.length) {
      const change = changes[currentChangeIndex];

      // Find the element by its data attribute
      let selector: string;
      if (change.type === "insertion") {
        selector = `ins[data-insertion-id="${change.id}"]`;
      } else if (change.type === "deletion") {
        selector = `del[data-deletion-id="${change.id}"]`;
      } else if (change.type === "formatChange") {
        // Format changes are on paragraph/heading elements with data-format-change attribute
        selector = `.has-format-change`;
      } else {
        return;
      }

      // For format changes, we need to find the one with matching ID
      if (change.type === "formatChange") {
        const elements = editorDom.querySelectorAll(selector);
        elements.forEach((el) => {
          try {
            const fcData = el.getAttribute("data-format-change");
            if (fcData) {
              const fc = JSON.parse(fcData);
              if (fc.id === change.id) {
                el.classList.add("selected-change");
              }
            }
          } catch {
            // Ignore parse errors
          }
        });
      } else {
        const element = editorDom.querySelector(selector);
        if (element) {
          element.classList.add("selected-change");
        }
      }
    }
  }, [editor, currentChangeIndex, changes, containerRef]);

  const goToChange = useCallback(
    (index: number) => {
      if (!editor || changes.length === 0) return;
      const change = changes[index];
      if (change) {
        setCurrentChangeIndex(index);
        editor.commands.setTextSelection(change.from);

        // Scroll the change into view within the container
        setTimeout(() => {
          const container = containerRef.current;
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
    [editor, changes, containerRef],
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

  // Get changes within the current text selection (for context menu)
  const getChangesInSelection = useCallback((): TrackedChange[] => {
    if (!editor) return [];

    const { from, to } = editor.state.selection;
    if (from === to) return []; // No selection

    const changesInSelection: TrackedChange[] = [];
    const doc = editor.state.doc;

    doc.nodesBetween(from, to, (node, pos) => {
      // Check for format changes on paragraph/heading nodes
      const fc = node.attrs.formatChange;
      if (fc && fc.id) {
        const nodeFrom = pos;
        const nodeTo = pos + node.nodeSize;
        // Check if this node overlaps with selection
        if (nodeFrom < to && nodeTo > from) {
          const existing = changesInSelection.find((c) => c.id === fc.id);
          if (!existing) {
            // Get text preview from the node
            let text = "";
            node.descendants((child) => {
              if (child.isText && text.length < 50) {
                text += child.text || "";
              }
            });
            if (text.length > 50) text = text.slice(0, 47) + "...";

            changesInSelection.push({
              id: fc.id,
              type: "formatChange",
              author: fc.author,
              date: fc.date,
              text: text || "[paragraph]",
              from: nodeFrom,
              to: nodeTo,
              oldStyle: fc.oldStyle,
              oldNumIlvl: fc.oldNumIlvl,
              newStyle: node.attrs.styleName,
              newNumIlvl: node.attrs.numIlvl,
            });
          }
        }
      }

      // Check for insertion/deletion marks on text nodes
      if (node.isText && node.marks) {
        node.marks.forEach((mark) => {
          if (
            mark.type.name === "insertion" ||
            mark.type.name === "deletion"
          ) {
            const markFrom = pos;
            const markTo = pos + node.nodeSize;
            if (markFrom < to && markTo > from) {
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
    [...changesInSel]
      .sort((a, b) => b.from - a.from)
      .forEach((change) => {
        acceptChange(change.id);
      });
  }, [getChangesInSelection, acceptChange]);

  // Reject all changes in the current selection
  const rejectChangesInSelection = useCallback(() => {
    const changesInSel = getChangesInSelection();
    // Process from end to start to preserve positions
    [...changesInSel]
      .sort((a, b) => b.from - a.from)
      .forEach((change) => {
        rejectChange(change.id);
      });
  }, [getChangesInSelection, rejectChange]);

  return {
    currentChangeIndex,
    goToChange,
    goToPrevChange,
    goToNextChange,
    acceptCurrentChange,
    rejectCurrentChange,
    getChangesInSelection,
    acceptChangesInSelection,
    rejectChangesInSelection,
  };
}
