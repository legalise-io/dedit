import { Extension } from "@tiptap/core";
import type {
  TrackChangesModeOptions,
  TrackChangesModeStorage,
} from "./track-changes/types";
import {
  createTrackChangesPlugin,
  trackChangesModePluginKey,
} from "./track-changes/trackChangesPlugin";
import { createTooltipPlugin } from "./track-changes/tooltipPlugin";

// Re-export types and plugin key for external use
export { trackChangesModePluginKey };
export type { TrackChangesModeOptions, TrackChangesModeStorage };

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    trackChangesMode: {
      enableTrackChanges: () => ReturnType;
      disableTrackChanges: () => ReturnType;
      toggleTrackChanges: () => ReturnType;
      setTrackChangesAuthor: (author: string) => ReturnType;
    };
  }
}

/**
 * TipTap extension for track changes mode.
 *
 * When enabled, all edits are tracked as insertions or deletions with author attribution.
 *
 * @example
 * ```ts
 * const editor = useEditor({
 *   extensions: [
 *     TrackChangesMode.configure({
 *       enabled: true,
 *       author: "John Doe",
 *     }),
 *   ],
 * });
 *
 * // Toggle track changes
 * editor.commands.toggleTrackChanges();
 *
 * // Change author
 * editor.commands.setTrackChangesAuthor("Jane Smith");
 * ```
 */
export const TrackChangesMode = Extension.create<
  TrackChangesModeOptions,
  TrackChangesModeStorage
>({
  name: "trackChangesMode",

  addOptions() {
    return {
      enabled: false,
      author: "Unknown Author",
    };
  },

  addStorage() {
    return {
      enabled: this.options.enabled,
      author: this.options.author,
    };
  },

  addCommands() {
    return {
      enableTrackChanges:
        () =>
        ({ editor }) => {
          this.storage.enabled = true;
          // Trigger a state update to notify React
          editor.view.dispatch(
            editor.state.tr.setMeta("trackChangesEnabled", true),
          );
          return true;
        },

      disableTrackChanges:
        () =>
        ({ editor }) => {
          this.storage.enabled = false;
          editor.view.dispatch(
            editor.state.tr.setMeta("trackChangesEnabled", false),
          );
          return true;
        },

      toggleTrackChanges:
        () =>
        ({ commands }) => {
          if (this.storage.enabled) {
            return commands.disableTrackChanges();
          } else {
            return commands.enableTrackChanges();
          }
        },

      setTrackChangesAuthor: (author: string) => () => {
        this.storage.author = author;
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      createTrackChangesPlugin(() => this.storage),
      createTooltipPlugin(),
    ];
  },
});

export default TrackChangesMode;
