import type { Extensions } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import History from "@tiptap/extension-history";

import Section from "../../extensions/Section";
import TableWithId from "../../extensions/TableWithId";
import { ParagraphWithId } from "../../extensions/ParagraphWithId";
import { HeadingWithStyle } from "../../extensions/HeadingWithStyle";
import { HardBreakWithType } from "../../extensions/HardBreakWithType";
import { PersistentSelection } from "../../extensions/PersistentSelection";
import { Insertion } from "../../extensions/Insertion";
import { Deletion } from "../../extensions/Deletion";
import { Comment } from "../../extensions/Comment";
import { RawStyle } from "../../extensions/RawStyle";
import { TrackChangesMode } from "../../extensions/TrackChangesMode";
import { SearchAndReplace } from "../../extensions/SearchAndReplace";
import { RawStylesStorage } from "../../extensions/RawStylesStorage";
import { StyleNumbering } from "../../extensions/StyleNumbering";
import { Tab } from "../../extensions/Tab";

export interface DeditExtensionOptions {
  /** Omit History; Yjs owns undo when collaborating. */
  collaboration?: boolean;
  headingLevels?: Array<1 | 2 | 3 | 4 | 5 | 6>;
  tableResizable?: boolean;
  trackChangesEnabled?: boolean;
  trackChangesAuthor?: string;
}

/**
 * The editor's built-in extension list. Safe to call in Node (no DOM access),
 * so servers and headless clients can build the same schema as the editor.
 */
export function createDeditExtensions(
  options: DeditExtensionOptions = {},
): Extensions {
  const {
    collaboration = false,
    headingLevels = [1, 2, 3, 4, 5, 6],
    tableResizable = false,
    trackChangesEnabled = false,
    trackChangesAuthor = "Unknown Author",
  } = options;

  const extensions: Extensions = [
    Document,
    ParagraphWithId,
    Text,
    HeadingWithStyle.configure({ levels: headingLevels }),
    Bold,
    Italic,
    HardBreakWithType,
    Tab,
    Section,
    TableWithId.configure({ resizable: tableResizable }),
    TableRow,
    TableCell,
    TableHeader,
    Insertion,
    Deletion,
    Comment,
    RawStyle,
    TrackChangesMode.configure({
      enabled: trackChangesEnabled,
      author: trackChangesAuthor,
    }),
    SearchAndReplace.configure({ searchResultClass: "search-result" }),
    PersistentSelection,
    RawStylesStorage,
    StyleNumbering,
  ];

  if (!collaboration) {
    extensions.push(History.configure({ depth: 100 }));
  }

  return extensions;
}
