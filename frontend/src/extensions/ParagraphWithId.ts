import Paragraph from "@tiptap/extension-paragraph";
import { v4 as uuidv4 } from "uuid";

export interface ParagraphWithIdOptions {
  /**
   * Additional attributes to render to the DOM.
   * Each attribute will be rendered as `data-{kebab-case-name}`.
   *
   * @example
   * ```typescript
   * ParagraphWithId.configure({
   *   customAttributes: ["paragraphIndex", "sectionId"]
   * })
   * // Renders: <p data-paragraph-id="..." data-paragraph-index="5" data-section-id="abc">
   * ```
   */
  customAttributes?: string[];
}

/**
 * Converts camelCase to kebab-case
 * e.g., "paragraphIndex" -> "paragraph-index"
 */
function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * Extended Paragraph extension that adds unique IDs to each paragraph.
 * This allows AI edits to target specific paragraphs by ID rather than position.
 *
 * @example Basic usage (just IDs)
 * ```typescript
 * import { ParagraphWithId } from 'dedit-react-editor';
 *
 * const editor = useEditor({
 *   extensions: [
 *     ParagraphWithId,
 *     // ... other extensions
 *   ],
 * });
 * ```
 *
 * @example With custom attributes
 * ```typescript
 * import { ParagraphWithId } from 'dedit-react-editor';
 *
 * const editor = useEditor({
 *   extensions: [
 *     ParagraphWithId.configure({
 *       customAttributes: ["paragraphIndex", "sectionId"]
 *     }),
 *     // ... other extensions
 *   ],
 * });
 *
 * // Document JSON:
 * // { "type": "paragraph", "attrs": { "id": "abc", "paragraphIndex": 5, "sectionId": "sec-1" } }
 *
 * // Rendered HTML:
 * // <p data-paragraph-id="abc" data-paragraph-index="5" data-section-id="sec-1">...</p>
 * ```
 */
export const ParagraphWithId = Paragraph.extend<ParagraphWithIdOptions>({
  addOptions() {
    return {
      customAttributes: [],
    };
  },

  addAttributes() {
    const baseAttributes: Record<string, unknown> = {
      ...this.parent?.(),
      id: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          // Get existing ID or generate new one
          return element.getAttribute("data-paragraph-id") || uuidv4();
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          // Generate ID if not present
          const id = attributes.id || uuidv4();
          return { "data-paragraph-id": id };
        },
      },
      // className renders as `class` attribute, not `data-class-name`
      // Useful for dynamic styling from external components
      className: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("class") || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.className) return {};
          return { class: attributes.className };
        },
      },
      // styleName preserves the Word paragraph style for round-tripping
      styleName: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-style-name") || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.styleName) return {};
          return { "data-style-name": attributes.styleName };
        },
      },
    };

    // Add custom attributes if configured
    const customAttributes = this.options.customAttributes || [];
    for (const attrName of customAttributes) {
      const dataAttrName = `data-${toKebabCase(attrName)}`;

      baseAttributes[attrName] = {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const value = element.getAttribute(dataAttrName);
          // Try to parse as number if it looks like one
          if (value !== null && /^\d+$/.test(value)) {
            return parseInt(value, 10);
          }
          return value;
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          const value = attributes[attrName];
          if (value === null || value === undefined) {
            return {};
          }
          return { [dataAttrName]: String(value) };
        },
      };
    }

    return baseAttributes;
  },

  addStorage() {
    return {
      // Flag to prevent recursive updates
      isAssigningIds: false,
    };
  },

  // Hook to ensure all paragraphs get IDs when document is loaded
  onCreate() {
    console.log("[ParagraphWithId] onCreate called");
    this.storage.isAssigningIds = true;
    const { tr } = this.editor.state;
    let modified = false;
    let count = 0;

    this.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && !node.attrs.id) {
        tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          id: uuidv4(),
        });
        modified = true;
        count++;
      }
    });

    console.log(
      `[ParagraphWithId] onCreate assigned ${count} IDs, modified=${modified}`,
    );
    if (modified) {
      tr.setMeta("addToHistory", false);
      this.editor.view.dispatch(tr);
    }
    this.storage.isAssigningIds = false;
  },

  // Hook to assign IDs when content is set after editor creation (e.g., setContent)
  onUpdate() {
    // Prevent recursive/concurrent calls
    if (this.storage.isAssigningIds) {
      return;
    }

    // Check if any paragraphs are missing IDs
    let hasMissingIds = false;
    let totalParagraphs = 0;
    this.editor.state.doc.descendants((node) => {
      if (node.type.name === "paragraph") {
        totalParagraphs++;
        if (!node.attrs.id) {
          hasMissingIds = true;
        }
      }
    });

    console.log(
      `[ParagraphWithId] onUpdate: ${totalParagraphs} paragraphs, hasMissingIds=${hasMissingIds}`,
    );

    if (!hasMissingIds) {
      return;
    }

    // Defer to next tick to avoid dispatching during a dispatch
    this.storage.isAssigningIds = true;
    const editor = this.editor;
    const storage = this.storage;

    setTimeout(() => {
      const { tr } = editor.state;
      let modified = false;
      let count = 0;

      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "paragraph" && !node.attrs.id) {
          tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            id: uuidv4(),
          });
          modified = true;
          count++;
        }
      });

      console.log(
        `[ParagraphWithId] onUpdate setTimeout assigned ${count} IDs`,
      );
      if (modified) {
        tr.setMeta("addToHistory", false);
        editor.view.dispatch(tr);
      }
      storage.isAssigningIds = false;
    }, 0);
  },
});

export default ParagraphWithId;
