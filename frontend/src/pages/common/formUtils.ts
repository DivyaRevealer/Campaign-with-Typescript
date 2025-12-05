import type { KeyboardEvent as ReactKeyboardEvent } from "react";

type FormKeyboardEvent = ReactKeyboardEvent<HTMLFormElement>;

type FocusableElement =
  | HTMLInputElement
  | HTMLSelectElement
  | HTMLTextAreaElement;

function isFocusableElement(element: EventTarget | null): element is FocusableElement {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  );
}

export function focusNextFieldOnEnter(event: FormKeyboardEvent) {
  if (event.key !== "Enter") return;

  const target = event.target;
  if (!isFocusableElement(target)) return;
  if (target.type === "submit" || target.type === "button") return;

  const form = event.currentTarget;
  const selector =
    "input:not([type='hidden']):not([disabled]):not([readonly]), select:not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly])";
  const focusableElements = Array.from(form.querySelectorAll<FocusableElement>(selector)).filter(
    (el) => el.tabIndex !== -1
  );

  const currentIndex = focusableElements.indexOf(target);
  if (currentIndex === -1) return;

  const nextIndex = currentIndex + (event.shiftKey ? -1 : 1);
  const nextElement = focusableElements[nextIndex];
  if (!nextElement) return;

  event.preventDefault();
  nextElement.focus();
  if (nextElement instanceof HTMLInputElement || nextElement instanceof HTMLTextAreaElement) {
    nextElement.select?.();
  }
}