import { useState, useCallback } from "react";
import type { ContextItem } from "../../lib/types";

export interface UseContextItemsOptions {
  onResolveContextItems?: (
    dataTransfer: DataTransfer,
  ) => ContextItem[] | Promise<ContextItem[]>;
}

export interface UseContextItemsReturn {
  contextItems: ContextItem[];
  addContextItem: (item: ContextItem) => void;
  addContextItems: (items: ContextItem[]) => void;
  removeContextItem: (id: string) => void;
  clearContextItems: () => void;
  resolveContextItems: (dataTransfer: DataTransfer) => Promise<ContextItem[]>;
}

export function useContextItems(
  options: UseContextItemsOptions = {},
): UseContextItemsReturn {
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);

  const addContextItem = useCallback((item: ContextItem) => {
    setContextItems((prev) => {
      // Avoid duplicates by ID
      if (prev.some((i) => i.id === item.id)) {
        return prev;
      }
      return [...prev, item];
    });
  }, []);

  const addContextItems = useCallback((items: ContextItem[]) => {
    setContextItems((prev) => {
      const existingIds = new Set(prev.map((i) => i.id));
      const newItems = items.filter((item) => !existingIds.has(item.id));
      return [...prev, ...newItems];
    });
  }, []);

  const removeContextItem = useCallback((id: string) => {
    setContextItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearContextItems = useCallback(() => {
    setContextItems([]);
  }, []);

  // Resolve context items from DataTransfer using config resolver
  const resolveContextItems = useCallback(
    async (dataTransfer: DataTransfer): Promise<ContextItem[]> => {
      if (!options.onResolveContextItems) {
        return [];
      }
      try {
        const items = await options.onResolveContextItems(dataTransfer);
        return items;
      } catch (err) {
        console.error("[resolveContextItems] Error:", err);
        return [];
      }
    },
    [options],
  );

  return {
    contextItems,
    addContextItem,
    addContextItems,
    removeContextItem,
    clearContextItems,
    resolveContextItems,
  };
}
