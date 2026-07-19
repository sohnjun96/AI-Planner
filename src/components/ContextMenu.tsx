import { useEffect, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

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

function getSafePosition(x: number, y: number, width = MENU_WIDTH, height = 0) {
  const maxX = Math.max(MENU_MARGIN, window.innerWidth - width - MENU_MARGIN);
  const maxY = Math.max(MENU_MARGIN, window.innerHeight - height - MENU_MARGIN);
  const preferredTop = height > 0 && y + height > window.innerHeight - MENU_MARGIN ? y - height : y;

  return {
    left: Math.min(Math.max(MENU_MARGIN, x), maxX),
    top: Math.min(Math.max(MENU_MARGIN, preferredTop), maxY),
  };
}

export function ContextMenu({ x, y, title, items, onClose }: ContextMenuProps) {
  const position = getSafePosition(x, y);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const menuElement = menuRef.current;
    if (!menuElement) {
      return;
    }

    const rect = menuElement.getBoundingClientRect();
    const measuredPosition = getSafePosition(x, y, rect.width, rect.height);
    menuElement.style.left = `${measuredPosition.left}px`;
    menuElement.style.top = `${measuredPosition.top}px`;
  }, [items.length, title, x, y]);

  function getEnabledMenuItems(): HTMLButtonElement[] {
    return Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const enabledItems = getEnabledMenuItems();
    const currentIndex = enabledItems.findIndex((item) => item === document.activeElement);

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key === "Tab") {
      onClose();
      return;
    }

    if (enabledItems.length === 0) {
      return;
    }

    let nextIndex: number | undefined;
    if (event.key === "ArrowDown") {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % enabledItems.length;
    } else if (event.key === "ArrowUp") {
      nextIndex = currentIndex < 0 ? enabledItems.length - 1 : (currentIndex - 1 + enabledItems.length) % enabledItems.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = enabledItems.length - 1;
    } else if ((event.key === "Enter" || event.key === " ") && currentIndex >= 0) {
      event.preventDefault();
      event.stopPropagation();
      enabledItems[currentIndex]?.click();
      return;
    }

    if (nextIndex !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      enabledItems[nextIndex]?.focus();
    }
  }

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menuElement = menuRef.current;
    const firstEnabledItem = menuElement?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    (firstEnabledItem ?? menuElement)?.focus();

    return () => {
      const activeElement = document.activeElement;
      const shouldRestore =
        previouslyFocused?.isConnected &&
        (activeElement === document.body || activeElement === menuElement || Boolean(menuElement?.contains(activeElement)));
      if (shouldRestore) {
        previouslyFocused.focus();
      }
    };
  }, []);

  useEffect(() => {
    const close = () => onClose();
    const closeOnOutsideScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) {
        return;
      }
      onClose();
    };

    // 메뉴를 연 바로 그 이벤트(실제 우클릭/클릭)는 아직 window까지 버블링되는 중이다.
    // 리스너를 즉시 등록하면 그 이벤트를 받아 메뉴가 열리자마자 닫히므로,
    // 등록을 다음 태스크로 미룬다.
    const timerId = window.setTimeout(() => {
      window.addEventListener("click", close);
      window.addEventListener("contextmenu", close);
      window.addEventListener("resize", close);
      window.addEventListener("scroll", closeOnOutsideScroll, true);
    }, 0);

    return () => {
      window.clearTimeout(timerId);
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", closeOnOutsideScroll, true);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label={title ? `${title} 작업 메뉴` : "작업 메뉴"}
      tabIndex={-1}
      style={{ left: position.left, top: position.top }}
      onKeyDown={handleMenuKeyDown}
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
            tabIndex={-1}
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
