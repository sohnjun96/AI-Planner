import { useEffect } from "react";

export interface ContextMenuItem {
  id: string;
  label: string;
  description?: string;
  tone?: "default" | "primary" | "danger";
  disabled?: boolean;
  onSelect: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  title?: string;
  items: ContextMenuItem[];
  onClose: () => void;
}

const MENU_WIDTH = 220;
const MENU_MARGIN = 12;

function getSafePosition(x: number, y: number) {
  const maxX = Math.max(MENU_MARGIN, window.innerWidth - MENU_WIDTH - MENU_MARGIN);
  const maxY = Math.max(MENU_MARGIN, window.innerHeight - MENU_MARGIN);

  return {
    left: Math.min(Math.max(MENU_MARGIN, x), maxX),
    top: Math.min(Math.max(MENU_MARGIN, y), maxY),
  };
}

export function ContextMenu({ x, y, title, items, onClose }: ContextMenuProps) {
  const position = getSafePosition(x, y);

  useEffect(() => {
    const close = () => onClose();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="context-menu"
      role="menu"
      style={{ left: position.left, top: position.top }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {title ? <p className="context-menu-title">{title}</p> : null}
      <div className="context-menu-list">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`context-menu-item ${item.tone ?? "default"}`}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            <span>{item.label}</span>
            {item.description ? <small>{item.description}</small> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
