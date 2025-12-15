import { useState, useRef, useEffect, useMemo } from "react";
import "./Autocomplete.css";

interface AutocompleteProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  allowAll?: boolean;
  allLabel?: string;
}

export default function Autocomplete({
  value,
  options,
  onChange,
  placeholder = "Type to search...",
  disabled = false,
  allowAll = true,
  allLabel = "All",
}: AutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [listPosition, setListPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Filter options based on search term
  const filteredOptions = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) {
      return options;
    }
    return options.filter((opt) => opt.toLowerCase().includes(term));
  }, [options, searchTerm]);

  // Get display value
  const displayValue = useMemo(() => {
    if (value === "All" || value === "") {
      return "";
    }
    return value;
  }, [value]);

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setSearchTerm(newValue);
    setIsOpen(true);
    setHighlightedIndex(-1);
    
    // If input is cleared, set to "All"
    if (!newValue.trim()) {
      onChange(allowAll ? "All" : "");
      return;
    }
    
    // Check if exact match exists
    const exactMatch = options.find(
      (opt) => opt.toLowerCase() === newValue.toLowerCase()
    );
    if (exactMatch) {
      onChange(exactMatch);
    }
  };

  // Handle option selection
  const handleSelect = (option: string) => {
    onChange(option);
    setSearchTerm("");
    setIsOpen(false);
    inputRef.current?.blur();
  };

  // Handle input focus
  const handleFocus = () => {
    setIsOpen(true);
    setSearchTerm(displayValue);
  };

  // Update list position when opened
  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setListPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    } else {
      setListPosition(null);
    }
  }, [isOpen]);

  // Handle input blur (with delay to allow click events)
  const handleBlur = () => {
    setTimeout(() => {
      if (!containerRef.current?.contains(document.activeElement)) {
        setIsOpen(false);
        // Reset search term to display value
        setSearchTerm(displayValue);
      }
    }, 200);
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen && (e.key === "ArrowDown" || e.key === "Enter")) {
      setIsOpen(true);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => {
        const maxIndex = (allowAll ? 1 : 0) + filteredOptions.length - 1;
        return prev < maxIndex ? prev + 1 : prev;
      });
      scrollToHighlighted();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > -1 ? prev - 1 : -1));
      scrollToHighlighted();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightedIndex === -1 && allowAll) {
        handleSelect("All");
      } else if (highlightedIndex >= 0) {
        const selectedOption = filteredOptions[highlightedIndex];
        if (selectedOption) {
          handleSelect(selectedOption);
        }
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  // Scroll to highlighted item
  const scrollToHighlighted = () => {
    if (listRef.current && highlightedIndex >= 0) {
      const items = listRef.current.querySelectorAll("li");
      const item = items[highlightedIndex + (allowAll ? 1 : 0)];
      if (item) {
        item.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setSearchTerm(displayValue);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [isOpen, displayValue]);

  return (
    <div className={`autocomplete-container ${isOpen ? "open" : ""}`} ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        className="autocomplete-input"
        value={isOpen ? searchTerm : displayValue}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
      />
      {isOpen && !disabled && listPosition && (
        <ul 
          className="autocomplete-list" 
          ref={listRef}
          style={{
            top: `${listPosition?.top ?? 0}px`,
            left: `${listPosition?.left ?? 0}px`,
            width: `${listPosition?.width ?? 0}px`,
          }}
        >
          {allowAll && (
            <li
              className={`autocomplete-option ${
                highlightedIndex === -1 ? "highlighted" : ""
              } ${value === "All" ? "selected" : ""}`}
              onClick={() => handleSelect("All")}
              onMouseEnter={() => setHighlightedIndex(-1)}
            >
              {allLabel}
            </li>
          )}
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option, index) => (
              <li
                key={option}
                className={`autocomplete-option ${
                  highlightedIndex === index ? "highlighted" : ""
                } ${value === option ? "selected" : ""}`}
                onClick={() => handleSelect(option)}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                {option}
              </li>
            ))
          ) : (
            <li className="autocomplete-option no-results">No results found</li>
          )}
        </ul>
      )}
    </div>
  );
}

