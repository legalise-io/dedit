import { Node, mergeAttributes } from '@tiptap/core'

export interface SectionOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    section: {
      setSection: (attributes?: { id?: string; originalRef?: string; level?: number }) => ReturnType
    }
  }
}

export const Section = Node.create<SectionOptions>({
  name: 'section',

  group: 'block',

  content: 'block+',

  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: element => element.getAttribute('data-id'),
        renderHTML: attributes => {
          if (!attributes.id) return {}
          return { 'data-id': attributes.id }
        },
      },
      originalRef: {
        default: null,
        parseHTML: element => element.getAttribute('data-original-ref'),
        renderHTML: attributes => {
          if (!attributes.originalRef) return {}
          return { 'data-original-ref': attributes.originalRef }
        },
      },
      level: {
        default: 1,
        parseHTML: element => parseInt(element.getAttribute('data-level') || '1', 10),
        renderHTML: attributes => {
          return { 'data-level': attributes.level }
        },
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'section' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['section', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },

  addCommands() {
    return {
      setSection:
        (attributes) =>
        ({ commands }) => {
          return commands.wrapIn(this.name, attributes)
        },
    }
  },
})

export default Section
