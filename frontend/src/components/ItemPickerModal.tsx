import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ItemPickerOption<T> = {
  id: string;
  label: string;
  description?: string;
  meta?: string;
  value: T;
  searchText?: string;
};

export interface ItemPickerModalProps<T> {
  isOpen: boolean;
  title?: string;
  options: Array<ItemPickerOption<T>>;
  onClose: () => void;
  onSelect: (option: ItemPickerOption<T>) => void;
  onClear?: () => void;
  disableClear?: boolean;
  initialQuery?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
}

export function ItemPickerModal<T>({
  isOpen,
  title = "Select item",
  options,
  onClose,
  onSelect,
  onClear,
  disableClear = false,
  initialQuery = "",
  searchPlaceholder = "Search",
  emptyMessage = "No results found",
}: ItemPickerModalProps<T>) {
  const [query, setQuery] = useState(initialQuery);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const hasInitialisedRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    setQuery(initialQuery);
    hasInitialisedRef.current = false;
  }, [initialQuery, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const input = searchRef.current;
    if (!input) return;
    if (!hasInitialisedRef.current) {
      hasInitialisedRef.current = true;
      input.focus();
      const length = input.value.length;
      input.setSelectionRange(length, length);
    }
  }, [isOpen, query]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return options;
    return options.filter((option) => {
      const haystack = option.searchText
        ? option.searchText.toLowerCase()
        : [option.label, option.description, option.meta]
            .filter((part) => part && part.length > 0)
            .join(" ")
            .toLowerCase();
      return haystack.includes(trimmed);
    });
  }, [options, query]);

  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10000,
    padding: "24px",
  };

  const modalStyle: React.CSSProperties = {
    background: "var(--admin-card-bg, #ffffff)",
    borderRadius: 16,
    boxShadow: "0 30px 60px rgba(15,23,42,0.35)",
    width: "min(640px, 100%)",
    maxHeight: "min(520px, 100%)",
    display: "flex",
    flexDirection: "column",
    border: "1px solid var(--admin-input-border, rgba(148,163,184,0.35))",
    overflow: "hidden",
  };

  const headerStyle: React.CSSProperties = {
    padding: "20px 24px 12px",
    borderBottom: "1px solid rgba(148,163,184,0.2)",
    fontSize: 18,
    fontWeight: 700,
    color: "var(--admin-table-text, #1e293b)",
  };

  const contentStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: "16px 24px 24px",
    flex: 1,
  };

  const searchStyle: React.CSSProperties = {
    border: "1px solid var(--admin-input-border, rgba(148,163,184,0.35))",
    background: "var(--admin-input-bg, #ffffff)",
    color: "var(--admin-input-text, #201f1e)",
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 14,
    outline: "none",
  };

  const listStyle: React.CSSProperties = {
    flex: 1,
    overflowY: "auto",
    borderRadius: 10,
    border: "1px solid var(--admin-input-border, rgba(148,163,184,0.25))",
    background: "var(--admin-input-bg, #ffffff)",
    padding: 4,
  };

  const optionButtonStyle: React.CSSProperties = {
    width: "100%",
    textAlign: "left",
    border: "none",
    background: "transparent",
    padding: "10px 12px",
    borderRadius: 8,
    color: "var(--admin-input-text, #201f1e)",
    cursor: "pointer",
    fontSize: 14,
  };

  const optionLabelStyle: React.CSSProperties = {
    fontWeight: 600,
    display: "block",
  };

  const optionMetaStyle: React.CSSProperties = {
    display: "block",
    marginTop: 4,
    fontSize: 12,
    color: "var(--admin-muted-text, #64748b)",
  };

  const emptyStateStyle: React.CSSProperties = {
    padding: "24px 12px",
    textAlign: "center",
    color: "var(--admin-muted-text, #64748b)",
    fontSize: 13,
  };

  const footerStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "flex-end",
    paddingTop: 16,
  };

  const clearButtonStyle: React.CSSProperties = {
    borderRadius: 999,
    border: "1px solid var(--admin-input-border, rgba(148,163,184,0.4))",
    background: "rgba(148,163,184,0.12)",
    padding: "8px 18px",
    fontWeight: 600,
    fontSize: 13,
    color: "var(--admin-table-text, #1e293b)",
    cursor: disableClear ? "not-allowed" : "pointer",
    opacity: disableClear ? 0.5 : 1,
  };

  const overlayMouseDown: React.MouseEventHandler<HTMLDivElement> = (event) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return createPortal(
    <div style={overlayStyle} onMouseDown={overlayMouseDown}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={modalStyle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={headerStyle}>{title}</div>
        <div style={contentStyle}>
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            style={searchStyle}
          />
          <div style={listStyle}>
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <button
                  type="button"
                  key={option.id}
                  onClick={() => onSelect(option)}
                  style={optionButtonStyle}
                >
                  <span style={optionLabelStyle}>{option.label || "—"}</span>
                  {(option.description || option.meta) && (
                    <span style={optionMetaStyle}>
                      {[option.description, option.meta]
                        .filter((value) => value && value.length > 0)
                        .join(" • ")}
                    </span>
                  )}
                </button>
              ))
            ) : (
              <div style={emptyStateStyle}>{emptyMessage}</div>
            )}
          </div>
          {onClear && (
            <div style={footerStyle}>
              <button
                type="button"
                onClick={() => {
                  if (disableClear) return;
                  onClear();
                }}
                style={clearButtonStyle}
                disabled={disableClear}
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default ItemPickerModal;