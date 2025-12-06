import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * Create the tooltip plugin for showing author on hover over track changes.
 */
export function createTooltipPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey("trackChangesTooltip"),

    view() {
      let tooltip: HTMLDivElement | null = null;
      let hideTimeout: ReturnType<typeof setTimeout> | null = null;

      const showTooltip = (author: string, x: number, y: number) => {
        if (!tooltip) {
          tooltip = document.createElement("div");
          tooltip.className = "track-change-tooltip";
          document.body.appendChild(tooltip);
        }
        tooltip.textContent = author;
        tooltip.style.left = `${x + 15}px`;
        tooltip.style.top = `${y - 45}px`;
      };

      const hideTooltip = () => {
        if (tooltip) {
          tooltip.remove();
          tooltip = null;
        }
      };

      const handleMouseOver = (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        const trackChange = target.closest(
          ".insertion, .deletion",
        ) as HTMLElement;

        if (trackChange) {
          const author = trackChange.getAttribute("data-author");
          if (author) {
            if (hideTimeout) {
              clearTimeout(hideTimeout);
              hideTimeout = null;
            }
            showTooltip(author, event.clientX, event.clientY);
          }
        }
      };

      const handleMouseOut = (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        const trackChange = target.closest(".insertion, .deletion");

        if (trackChange) {
          hideTimeout = setTimeout(hideTooltip, 100);
        }
      };

      const handleMouseMove = (event: MouseEvent) => {
        if (tooltip) {
          tooltip.style.left = `${event.clientX + 15}px`;
          tooltip.style.top = `${event.clientY - 45}px`;
        }
      };

      document.addEventListener("mouseover", handleMouseOver);
      document.addEventListener("mouseout", handleMouseOut);
      document.addEventListener("mousemove", handleMouseMove);

      return {
        destroy() {
          document.removeEventListener("mouseover", handleMouseOver);
          document.removeEventListener("mouseout", handleMouseOut);
          document.removeEventListener("mousemove", handleMouseMove);
          hideTooltip();
          if (hideTimeout) {
            clearTimeout(hideTimeout);
          }
        },
      };
    },
  });
}
