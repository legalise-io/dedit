import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HocuspocusProvider } from "@hocuspocus/provider";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import * as Y from "yjs";
import type { Extension } from "@tiptap/core";
import { getAuthorPrimaryColor, AUTHOR_COLORS } from "../utils/authorColors";

/**
 * User presence information for collaboration cursors
 */
export interface CollaborationUser {
  name: string;
  color: string;
}

/**
 * Options for useCollaboration hook
 */
export interface UseCollaborationOptions {
  /** WebSocket URL for Hocuspocus server (e.g., "ws://localhost:1234") */
  serverUrl: string;
  /** Document name/ID to collaborate on */
  documentName: string;
  /** Current user info for cursor display */
  user: CollaborationUser;
  /** Called when connection status changes */
  onStatusChange?: (
    status: "connecting" | "connected" | "disconnected",
  ) => void;
  /** Called when other users join/leave */
  onAwarenessChange?: (users: CollaborationUser[]) => void;
  /** Authentication token (optional) */
  token?: string;
  /**
   * Initial content to seed the document with (TipTap JSON format).
   * Only applied if the Yjs document is empty when first synced.
   */
  initialContent?: Record<string, unknown>;
}

/**
 * Return type for useCollaboration hook
 */
export interface UseCollaborationReturn {
  /** Extensions to add to the editor */
  extensions: Extension[];
  /** Yjs document instance */
  ydoc: Y.Doc;
  /** Hocuspocus provider instance */
  provider: HocuspocusProvider | null;
  /** Current connection status */
  status: "connecting" | "connected" | "disconnected";
  /** List of connected users */
  connectedUsers: CollaborationUser[];
  /** Whether collaboration is ready */
  isReady: boolean;
  /** Whether the document needs to be seeded with initial content */
  needsSeeding: boolean;
  /** Call this after seeding the document */
  markSeeded: () => void;
}

/**
 * Generate a random color for user cursor.
 * Uses the shared author color palette for consistency with track changes.
 * @deprecated Prefer getUserColor(userName) for consistent author colors
 */
export function generateUserColor(): string {
  const colors = AUTHOR_COLORS.map((c) => c.primary);
  return colors[Math.floor(Math.random() * colors.length)];
}

/**
 * Get a consistent color for a user based on their name.
 * Uses the shared author color palette for consistency with track changes.
 *
 * @param userName - The user's name
 * @returns A hex color string
 */
export function getUserColor(userName: string): string {
  return getAuthorPrimaryColor(userName);
}

/**
 * Hook for adding real-time collaboration to a TipTap editor.
 *
 * @example
 * ```tsx
 * const { extensions, status, connectedUsers, isReady } = useCollaboration({
 *   serverUrl: "ws://localhost:1234",
 *   documentName: "my-document",
 *   user: { name: "John Doe", color: "#958DF1" },
 * });
 *
 * // Only render editor when collaboration is ready
 * if (!isReady) return <div>Connecting...</div>;
 *
 * return <DocumentEditor extensions={extensions} />;
 * ```
 */
export function useCollaboration(
  options: UseCollaborationOptions,
): UseCollaborationReturn {
  const {
    serverUrl,
    documentName,
    user,
    onStatusChange,
    onAwarenessChange,
    token,
    initialContent,
  } = options;

  const [status, setStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [connectedUsers, setConnectedUsers] = useState<CollaborationUser[]>([]);
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [isSynced, setIsSynced] = useState(false);
  const [seededDocument, setSeededDocument] = useState<Y.Doc | null>(null);
  const destroyTimers = useRef(new Map<Y.Doc, ReturnType<typeof setTimeout>>());

  // Store initial content in a ref so we can access it in the onSynced callback
  const initialContentRef = useRef(initialContent);
  initialContentRef.current = initialContent;

  // Store user in ref for callbacks
  const userRef = useRef(user);
  userRef.current = user;

  // Create Yjs document - stable across renders, but recreate when documentName changes
  const ydoc = useMemo(() => new Y.Doc(), [documentName]);

  // Create provider in useEffect to handle cleanup properly (especially in StrictMode)
  useEffect(() => {
    // StrictMode immediately replays effects. Cancel disposal when reusing this doc.
    const pendingDestroy = destroyTimers.current.get(ydoc);
    if (pendingDestroy) {
      clearTimeout(pendingDestroy);
      destroyTimers.current.delete(ydoc);
    }
    const newProvider = new HocuspocusProvider({
      url: serverUrl,
      name: documentName,
      document: ydoc,
      token,
      onStatus: ({ status: newStatus }) => {
        const mappedStatus =
          newStatus === "connected"
            ? "connected"
            : newStatus === "connecting"
              ? "connecting"
              : "disconnected";
        setStatus(mappedStatus);
        onStatusChange?.(mappedStatus);
      },
      onAwarenessChange: ({ states }) => {
        const users: CollaborationUser[] = [];
        states.forEach((state) => {
          if (state.user) {
            users.push(state.user as CollaborationUser);
          }
        });
        setConnectedUsers(users);
        onAwarenessChange?.(users);
      },
      onSynced: () => {
        setIsSynced(true);
      },
    });

    newProvider.setAwarenessField("user", userRef.current);
    setProvider(newProvider);

    return () => {
      newProvider.destroy();
      setProvider(null);
      setIsSynced(false);
      const timer = setTimeout(() => {
        ydoc.destroy();
        destroyTimers.current.delete(ydoc);
      }, 0);
      destroyTimers.current.set(ydoc, timer);
    };
  }, [serverUrl, documentName, ydoc, token]);

  // Track if we've already seeded the document
  const hasSeeded = seededDocument === ydoc;

  // Determine if document needs seeding (empty after sync and we have initial content)
  const needsSeeding = useMemo(() => {
    if (!isSynced || hasSeeded || !initialContentRef.current) {
      console.log("[useCollaboration] needsSeeding check:", {
        isSynced,
        hasSeeded,
        hasInitialContent: !!initialContentRef.current,
        result: false,
      });
      return false;
    }

    // Get the Yjs XML fragment that TipTap uses
    const fragment = ydoc.getXmlFragment("default");
    const isEmpty = fragment.length === 0;

    console.log("[useCollaboration] needsSeeding check:", {
      isSynced,
      hasSeeded,
      hasInitialContent: !!initialContentRef.current,
      fragmentLength: fragment.length,
      result: isEmpty,
    });

    // Document needs seeding if it's empty
    return isEmpty;
  }, [isSynced, hasSeeded, ydoc]);

  const markSeeded = useCallback(() => {
    setSeededDocument(ydoc);
  }, [ydoc]);

  // Update user awareness when user changes
  useEffect(() => {
    if (provider) {
      provider.setAwarenessField("user", user);
    }
  }, [provider, user.name, user.color]);

  // Create extensions - only when provider exists
  const extensions = useMemo(() => {
    if (!provider) return [];

    return [
      Collaboration.configure({
        document: ydoc,
      }),
      CollaborationCursor.configure({
        provider,
        user,
        render: (cursorUser) => {
          const cursor = document.createElement("span");
          cursor.classList.add("collaboration-cursor__caret");
          cursor.style.borderColor = cursorUser.color;

          const label = document.createElement("span");
          label.classList.add("collaboration-cursor__label");
          label.style.backgroundColor = cursorUser.color;
          label.textContent = cursorUser.name;

          cursor.appendChild(label);
          return cursor;
        },
      }),
    ];
  }, [ydoc, user, provider]);

  // Only ready when provider exists, extensions are created, AND we've synced with server
  const isReady = provider !== null && extensions.length > 0 && isSynced;

  return {
    extensions,
    ydoc,
    provider,
    status,
    connectedUsers,
    isReady,
    needsSeeding,
    markSeeded,
  };
}

export type { HocuspocusProvider };
