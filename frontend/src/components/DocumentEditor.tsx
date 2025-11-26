import { useEditor, EditorContent, Editor } from "@tiptap/react";
import { useEffect } from "react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
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

type ToolbarItem = "bold" | "italic";

interface DocumentEditorProps {
  content: Record<string, unknown> | null;
  onUpdate?: (json: Record<string, unknown>) => void;
  onEditorReady?: (editor: Editor) => void;
  toolbar?: ToolbarItem[];
}

export function DocumentEditor({
  content,
  onUpdate,
  onEditorReady,
  toolbar,
}: DocumentEditorProps) {
  const editor = useEditor(
    {
      extensions: [
        Document,
        Paragraph,
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

  if (!editor) {
    return <div className="loading">Loading editor...</div>;
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
    <div className="document-editor">
      {toolbar && toolbar.length > 0 && (
        <div className="editor-toolbar">{toolbar.map(renderToolbarItem)}</div>
      )}
      <EditorContent editor={editor} className="tiptap" />
    </div>
  );
}

export default DocumentEditor;
