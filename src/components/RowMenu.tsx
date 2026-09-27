import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MoreIcon } from "./icons";

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface RowMenuProps {
  items: RowMenuItem[];
  /** Accessible name / tooltip of the "…" trigger. */
  label: string;
  icon?: ReactNode;
  className?: string;
}

const MENU_WIDTH = 180;

/**
 * A small "…" dropdown for panel rows. The popup is `position: fixed` so it is never clipped by
 * a scrolling panel; it closes on outside click, Escape, scroll and resize.
 */
export function RowMenu({ items, label, icon, className }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - MENU_WIDTH - 8, rect.right - MENU_WIDTH));
    const menuHeight = menuRef.current?.offsetHeight ?? 0;
    const below = rect.bottom + 4;
    const top = below + menuHeight > window.innerHeight - 8 ? Math.max(8, rect.top - menuHeight - 4) : below;
    setPosition({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [open, position]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={["row-icon", open ? "on" : "", className ?? ""].filter(Boolean).join(" ")}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        draggable={false}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        {icon ?? <MoreIcon />}
      </button>
      {open ? (
        <div
          ref={menuRef}
          className="row-menu"
          role="menu"
          style={{
            left: position?.left ?? -9999,
            top: position?.top ?? -9999,
            width: MENU_WIDTH
          }}
          onClick={(event) => event.stopPropagation()}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? "row-menu-item danger" : "row-menu-item"}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
