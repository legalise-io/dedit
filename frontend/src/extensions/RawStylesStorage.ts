import { Node } from '@tiptap/core'

/**
 * Invisible storage node for raw OOXML styling data.
 *
 * Stores serialized key-value pairs of raw XML for lossless DOCX round-tripping.
 * Not rendered in the editor.
 */
export const RawStylesStorage = Node.create({
  name: 'rawStylesStorage',

  group: 'block',

  atom: true,

  addAttributes() {
    return {
      data: {
        default: '{}',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-raw-styles') || '{}',
        renderHTML: (attributes: Record<string, unknown>) => {
          return { 'data-raw-styles': attributes.data }
        },
      },
    }
  },

  parseHTML() {
    return [{
      tag: 'div[data-raw-styles-storage]',
    }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', {
      'data-raw-styles-storage': '',
      style: 'display: none;',
      ...HTMLAttributes
    }]
  },
})

export default RawStylesStorage
