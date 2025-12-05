import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type ReasonCellProps = {
  text?: string | null;
};

export default function ReasonCell({ text }: ReasonCellProps) {
  const [open, setOpen] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const closeTimeoutRef = useRef<number | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      return;
    }
    const timeout = window.setTimeout(() => setShouldRender(false), 180);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const popover = popoverRef.current;
      if (popover && popover.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  if (!text) {
    return <span className="reason-empty">—</span>;
  }

  const clearCloseTimeout = () => {
    if (closeTimeoutRef.current) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  const scheduleClose = () => {
    clearCloseTimeout();
    closeTimeoutRef.current = window.setTimeout(() => setOpen(false), 400);
  };

  const toggle = () => {
    setOpen(prev => {
      const next = !prev;
      if (next) {
        clearCloseTimeout();
      }
      return next;
    });
  };
  const close = () => {
    clearCloseTimeout();
    setOpen(false);
  };
  const openPopover = () => {
    clearCloseTimeout();
    setOpen(true);
  };

  return (
    <span
      className="reason-cell"
      onMouseEnter={openPopover}
      onMouseLeave={scheduleClose}
    >
      <span
        className="reason-inline"
        tabIndex={0}
        onFocus={openPopover}
        onBlur={close}
        onClick={toggle}
        onKeyDown={event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle();
          }
        }}
      >
        {text}
      </span>
      {shouldRender
        ? createPortal(
            <div
              ref={popoverRef}
              className={`reason-popover ${open ? "reason-popover--visible" : "reason-popover--hidden"}`}
              role="dialog"
              aria-modal="true"
              aria-label="Reason"
              onMouseEnter={clearCloseTimeout}
              onMouseLeave={scheduleClose}
            >
              <button
                type="button"
                className="reason-popover__close"
                onClick={close}
                aria-label="Close reason"
              >
                ×
              </button>
              <div className="reason-popover__content">{text}</div>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}