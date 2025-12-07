import { Extension } from "@tiptap/core";
import { Editor } from "@tiptap/core";
import { getAuthorColor } from "../lib/utils/authorColors";

export interface StyleNumberingOptions {
  /**
   * CSS class applied to paragraphs/headings with style numbering
   */
  numberingClass?: string;
  /**
   * CSS class applied to paragraphs/headings with tracked format changes
   */
  formatChangeClass?: string;
}

/**
 * Tracked formatting change information (pPrChange)
 */
export interface FormatChange {
  id: string;
  author: string;
  date: string | null;
  oldStyle: string | null;
  oldNumIlvl: number | null;
}

/**
 * Represents a numbered paragraph in document order
 */
interface NumberedParagraph {
  pos: number;
  numId: string;
  numIlvl: number;
  currentNumber: string;
}

/**
 * Style-to-numbering mapping structure stored in rawStylesStorage
 * Note: JSON serialization converts numeric keys to strings, so num_to_style
 * inner keys are string representations of numbers (e.g., "0", "1", "2")
 */
interface StyleNumberingMap {
  style_to_num: Record<string, { numId: string; ilvl: number }>;
  num_to_style: Record<string, Record<string | number, string>>;
}

/**
 * Get the style-numbering map from rawStylesStorage node in the document.
 * This maps styles (SH1Legal, SH2Legal, etc.) to their numbering levels and vice versa.
 */
function getStyleNumberingMap(editor: Editor): StyleNumberingMap | null {
  const { doc } = editor.state;
  let styleMap: StyleNumberingMap | null = null;

  doc.descendants((node) => {
    if (node.type.name === "rawStylesStorage") {
      try {
        const data = JSON.parse(node.attrs.data || "{}");
        if (data.__style_numbering_map__) {
          styleMap = data.__style_numbering_map__;
          return false; // Stop iteration
        }
      } catch {
        // Ignore parse errors
      }
    }
    return true;
  });

  return styleMap;
}

/**
 * Get the correct style name for a given numId and numIlvl.
 * Word uses style-based numbering where different styles correspond to different levels.
 */
function getStyleForLevel(
  styleMap: StyleNumberingMap | null,
  numId: string,
  numIlvl: number
): string | null {
  if (!styleMap || !styleMap.num_to_style) return null;
  const numIdStyles = styleMap.num_to_style[numId];
  if (!numIdStyles) return null;
  // JSON keys are strings, so convert numIlvl to string for lookup
  return numIdStyles[numIlvl] || numIdStyles[String(numIlvl)] || null;
}

/**
 * Check if track changes mode is enabled and get the author.
 * Returns null if track changes is disabled.
 */
function getTrackChangesInfo(
  editor: Editor
): { enabled: boolean; author: string } | null {
  const storage = editor.storage.trackChangesMode;
  if (!storage || !storage.enabled) return null;
  return {
    enabled: storage.enabled,
    author: storage.author || "Unknown Author",
  };
}

/**
 * Create a format change object for tracking style/level changes.
 */
function createFormatChange(
  author: string,
  oldStyle: string | null,
  oldNumIlvl: number | null
): FormatChange {
  return {
    id: crypto.randomUUID(),
    author,
    date: new Date().toISOString(),
    oldStyle,
    oldNumIlvl,
  };
}

/**
 * Recalculate all numbering for a given numId group.
 * This walks through the document in order and assigns correct numbers
 * based on the numIlvl (indentation level) of each paragraph.
 */
function recalculateNumbering(editor: Editor, targetNumId: string): void {
  const { doc, tr } = editor.state;

  // Collect all paragraphs with this numId in document order
  const paragraphs: NumberedParagraph[] = [];

  doc.descendants((node, pos) => {
    const attrs = node.attrs;
    if (attrs.numId === targetNumId && attrs.styleNumbering !== undefined) {
      paragraphs.push({
        pos,
        numId: attrs.numId,
        numIlvl: attrs.numIlvl ?? 0,
        currentNumber: attrs.styleNumbering || "",
      });
    }
    return true;
  });

  if (paragraphs.length === 0) return;

  // Track counters at each level
  // counters[0] = counter for level 0, counters[1] = counter for level 1, etc.
  const counters: number[] = [];

  // Track the parent prefix at each level
  // parentPrefixes[1] = "1." means level 1 items start with "1.X"
  const parentPrefixes: string[] = [""];

  let lastLevel = -1;

  for (const para of paragraphs) {
    const level = para.numIlvl;

    if (level > lastLevel) {
      // Going deeper - initialize new level counter
      for (let i = lastLevel + 1; i <= level; i++) {
        counters[i] = 1;
        // The parent prefix for this level is the full number of the parent
        if (i > 0 && parentPrefixes[i - 1] !== undefined) {
          const parentNum = counters[i - 1] ?? 1;
          parentPrefixes[i] = parentPrefixes[i - 1] + parentNum + ".";
        } else {
          parentPrefixes[i] = "";
        }
      }
    } else if (level < lastLevel) {
      // Going shallower - increment the counter at this level
      counters[level] = (counters[level] ?? 0) + 1;
      // Reset deeper level counters
      for (let i = level + 1; i < counters.length; i++) {
        counters[i] = 0;
      }
    } else {
      // Same level - increment counter
      counters[level] = (counters[level] ?? 0) + 1;
    }

    // Build the new number
    const prefix = parentPrefixes[level] ?? "";
    const newNumber = prefix + counters[level] + ".";

    // Only update if changed
    if (newNumber !== para.currentNumber) {
      const node = doc.nodeAt(para.pos);
      if (node) {
        tr.setNodeMarkup(para.pos, undefined, {
          ...node.attrs,
          styleNumbering: newNumber,
        });
      }
    }

    lastLevel = level;
  }

  // Apply changes if any
  if (tr.docChanged) {
    tr.setMeta("addToHistory", true);
    tr.setMeta("styleNumberingRecalculation", true);
    editor.view.dispatch(tr);
  }
}

/**
 * StyleNumbering extension handles Word-style automatic numbering.
 *
 * This extension:
 * 1. Adds numbering attributes to paragraphs and headings
 * 2. Renders numbering via CSS ::before pseudo-element (non-editable)
 * 3. Handles Enter key to continue numbered sequences (and renumbers following items)
 * 4. Handles Tab/Shift+Tab to change numbering levels
 *
 * The numbering is stored in attributes:
 * - styleNumbering: The computed number string (e.g., "2.3.", "1.1.1.")
 * - numId: The Word numbering definition ID
 * - numIlvl: The indentation level (0-8)
 */
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    styleNumbering: {
      /**
       * Accept a format change - keeps the current formatting and removes the tracked change marker
       */
      acceptFormatChange: (changeId: string) => ReturnType;
      /**
       * Reject a format change - reverts to the old formatting and removes the tracked change marker
       */
      rejectFormatChange: (changeId: string) => ReturnType;
    };
  }
}

export const StyleNumbering = Extension.create<StyleNumberingOptions>({
  name: "styleNumbering",

  addOptions() {
    return {
      numberingClass: "has-style-numbering",
      formatChangeClass: "has-format-change",
    };
  },

  addCommands() {
    return {
      acceptFormatChange:
        (changeId: string) =>
        ({ tr, state, dispatch }) => {
          const { doc } = state;
          let found = false;

          doc.descendants((node, pos) => {
            if (found) return false;
            const fc = node.attrs.formatChange as FormatChange | null;
            if (fc && fc.id === changeId) {
              // Accept = keep current formatting, just remove the formatChange marker
              if (dispatch) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  formatChange: null,
                });
              }
              found = true;
              return false;
            }
            return true;
          });

          return found;
        },

      rejectFormatChange:
        (changeId: string) =>
        ({ tr, state, dispatch, editor }) => {
          const { doc } = state;
          let found = false;

          doc.descendants((node, pos) => {
            if (found) return false;
            const fc = node.attrs.formatChange as FormatChange | null;
            if (fc && fc.id === changeId) {
              // Reject = revert to old formatting
              const newAttrs: Record<string, unknown> = {
                ...node.attrs,
                formatChange: null,
              };

              // Restore old numIlvl if it was tracked
              if (fc.oldNumIlvl !== null && fc.oldNumIlvl !== undefined) {
                newAttrs.numIlvl = fc.oldNumIlvl;
              }

              // Restore old style name if it was tracked
              if (fc.oldStyle) {
                newAttrs.styleName = fc.oldStyle;
              }

              if (dispatch) {
                tr.setNodeMarkup(pos, undefined, newAttrs);

                // Recalculate numbering after the transaction is applied
                const numId = node.attrs.numId;
                if (numId) {
                  setTimeout(() => {
                    recalculateNumbering(editor, numId);
                  }, 0);
                }
              }
              found = true;
              return false;
            }
            return true;
          });

          return found;
        },
    };
  },

  addGlobalAttributes() {
    return [
      {
        // Apply to both paragraphs and headings
        types: ["paragraph", "heading"],
        attributes: {
          styleNumbering: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute("data-style-numbering") || null,
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.styleNumbering) return {};
              return {
                "data-style-numbering": attributes.styleNumbering,
                class: this.options.numberingClass,
              };
            },
          },
          numId: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute("data-num-id") || null,
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.numId) return {};
              return { "data-num-id": attributes.numId };
            },
          },
          numIlvl: {
            default: 0,
            parseHTML: (element: HTMLElement) => {
              const val = element.getAttribute("data-num-ilvl");
              return val ? parseInt(val, 10) : 0;
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              if (
                attributes.numIlvl === null ||
                attributes.numIlvl === undefined
              )
                return {};
              return { "data-num-ilvl": String(attributes.numIlvl) };
            },
          },
          formatChange: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const data = element.getAttribute("data-format-change");
              if (!data) return null;
              try {
                return JSON.parse(data);
              } catch {
                return null;
              }
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              const fc = attributes.formatChange as FormatChange | null;
              if (!fc) return {};
              // Get author color for consistent styling with track changes
              const authorColor = getAuthorColor(fc.author || "");
              return {
                "data-format-change": JSON.stringify(fc),
                "data-format-change-author": fc.author,
                "data-format-change-old-style": fc.oldStyle,
                class: this.options.formatChangeClass,
                style: `--author-color: ${authorColor.primary}; --author-color-light: ${authorColor.light};`,
              };
            },
          },
        },
      },
    ];
  },

  addKeyboardShortcuts() {
    return {
      // Enter key: continue numbering and renumber following paragraphs
      Enter: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        const { $from } = selection;

        const node = $from.parent;
        const nodeAttrs = node.attrs;

        // Only handle if this is a numbered paragraph
        if (!nodeAttrs.styleNumbering || !nodeAttrs.numId) {
          return false;
        }

        const numId = nodeAttrs.numId;
        const numIlvl = nodeAttrs.numIlvl;

        // First, split the block to create a new paragraph
        editor.chain().splitBlock().run();

        // Set the new paragraph's attributes (numId and numIlvl)
        // The actual number will be calculated by recalculateNumbering
        editor
          .chain()
          .updateAttributes(node.type.name, {
            styleNumbering: "...", // Temporary placeholder
            numId: numId,
            numIlvl: numIlvl,
            styleName: nodeAttrs.styleName,
          })
          .run();

        // Recalculate all numbering for this numId group
        setTimeout(() => {
          recalculateNumbering(editor, numId);
        }, 0);

        return true;
      },

      // Tab: increase numbering level (1.2. -> 1.2.1.)
      Tab: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        const { $from } = selection;
        const node = $from.parent;
        const nodeAttrs = node.attrs;

        if (!nodeAttrs.styleNumbering || !nodeAttrs.numId) {
          return false;
        }

        const currentLevel = nodeAttrs.numIlvl || 0;
        const currentStyle = nodeAttrs.styleName || null;
        const numId = nodeAttrs.numId;
        const newLevel = currentLevel + 1;

        // Look up the correct style for the new level
        // Word uses style-based numbering: SH1Legal->ilvl=0, SH2Legal->ilvl=1, etc.
        const styleMap = getStyleNumberingMap(editor);
        const newStyleName = getStyleForLevel(styleMap, numId, newLevel);

        // Update the level and optionally the style name
        const updateAttrs: Record<string, unknown> = { numIlvl: newLevel };
        if (newStyleName) {
          updateAttrs.styleName = newStyleName;
        }

        // If track changes is enabled, create a format change to track this
        const trackInfo = getTrackChangesInfo(editor);
        if (trackInfo) {
          updateAttrs.formatChange = createFormatChange(
            trackInfo.author,
            currentStyle,
            currentLevel
          );
        }

        editor.chain().updateAttributes(node.type.name, updateAttrs).run();

        // Recalculate all numbering for this numId group
        // Use setTimeout to ensure the attribute update is applied first
        setTimeout(() => {
          recalculateNumbering(editor, numId);
        }, 0);

        return true;
      },

      // Shift+Tab: decrease numbering level (1.2.1. -> 1.2.)
      "Shift-Tab": ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        const { $from } = selection;
        const node = $from.parent;
        const nodeAttrs = node.attrs;

        if (!nodeAttrs.styleNumbering || !nodeAttrs.numId) {
          return false;
        }

        const currentLevel = nodeAttrs.numIlvl || 0;
        const currentStyle = nodeAttrs.styleName || null;
        const numId = nodeAttrs.numId;

        // Can't decrease below level 0
        if (currentLevel <= 0) {
          return false;
        }

        const newLevel = currentLevel - 1;

        // Look up the correct style for the new level
        // Word uses style-based numbering: SH1Legal->ilvl=0, SH2Legal->ilvl=1, etc.
        const styleMap = getStyleNumberingMap(editor);
        const newStyleName = getStyleForLevel(styleMap, numId, newLevel);

        // Update the level and optionally the style name
        const updateAttrs: Record<string, unknown> = { numIlvl: newLevel };
        if (newStyleName) {
          updateAttrs.styleName = newStyleName;
        }

        // If track changes is enabled, create a format change to track this
        const trackInfo = getTrackChangesInfo(editor);
        if (trackInfo) {
          updateAttrs.formatChange = createFormatChange(
            trackInfo.author,
            currentStyle,
            currentLevel
          );
        }

        editor.chain().updateAttributes(node.type.name, updateAttrs).run();

        // Recalculate all numbering for this numId group
        setTimeout(() => {
          recalculateNumbering(editor, numId);
        }, 0);

        return true;
      },

      // Backspace at start of numbered paragraph: remove numbering
      Backspace: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        const { $from, empty } = selection;

        // Only handle if cursor is at the very start
        if (!empty || $from.parentOffset !== 0) {
          return false;
        }

        const node = $from.parent;
        const nodeAttrs = node.attrs;

        // If this is a numbered paragraph, remove numbering
        if (nodeAttrs.styleNumbering && nodeAttrs.numId) {
          const numId = nodeAttrs.numId;

          editor
            .chain()
            .updateAttributes(node.type.name, {
              styleNumbering: null,
              numId: null,
              numIlvl: 0,
            })
            .run();

          // Recalculate remaining numbering
          setTimeout(() => {
            recalculateNumbering(editor, numId);
          }, 0);

          return true;
        }

        return false;
      },
    };
  },
});

export default StyleNumbering;
