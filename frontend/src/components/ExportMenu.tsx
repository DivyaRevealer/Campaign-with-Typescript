import { useEffect, useId, useRef, useState } from "react";

import "./exportMenu.css";

interface ExportMenuProps {
  onSelectExcel: () => void;
  disabled?: boolean;
}

const DownloadIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 3v14" />
    <path d="M6 13l6 6 6-6" />
    <path d="M5 21h14" />
  </svg>
);

export function ExportMenu({ onSelectExcel, disabled = false }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerId = useId();
  const menuId = useId();
  const firstOptionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      firstOptionRef.current?.focus();
    }
  }, [open]);

  const toggleMenu = () => {
    if (disabled) return;
    setOpen((previous) => !previous);
  };

  const handleSelectExcel = () => {
    onSelectExcel();
    setOpen(false);
  };

  return (
    <div className="export-menu" ref={containerRef}>
      <button
        type="button"
        id={triggerId}
        className="export-menu__trigger"
        onClick={toggleMenu}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open && !disabled}
        aria-controls={open ? menuId : undefined}
      >
        <span className="export-menu__icon" aria-hidden="true">
          <DownloadIcon />
        </span>
        <span>Export</span>
      </button>
      {open && !disabled && (
        <div className="export-menu__dropdown" role="menu" aria-labelledby={triggerId} id={menuId}>
          <button
            type="button"
            ref={firstOptionRef}
            className="export-menu__option"
            onClick={handleSelectExcel}
            role="menuitem"
          >
            Excel
          </button>
        </div>
      )}
    </div>
  );
}

export default ExportMenu;