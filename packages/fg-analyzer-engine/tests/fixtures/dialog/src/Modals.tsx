// Fixture: two hand-rolled dialogs, one that meets its keyboard obligations and one that
// does not. `a11y.pattern.focus` reads the evidence at the declaration, not the element:
// `Escape` normally arrives through an effect and focus is moved through a ref, neither of
// which is visible on the JSX.
import { useEffect, useRef, type RefObject } from "react";

interface BrokenDialogProps {
  readonly title: string;
  readonly onClose: () => void;
}

/** a11y.pattern.focus / noEscape: no Escape handling and no focus management anywhere. */
export function BrokenDialog({ title, onClose }: BrokenDialogProps) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title}>
      <h2>{title}</h2>
      <button type="button" onClick={onClose}>
        Закрыть
      </button>
    </div>
  );
}

interface GoodDialogProps {
  readonly title: string;
  readonly onClose: () => void;
  /** Where focus goes when the dialog opens — the prop name is the evidence. */
  readonly initialFocusRef: RefObject<HTMLElement | null>;
}

/** Closes on Escape and names a focus target — must NOT be reported. */
export function GoodDialog({ title, onClose, initialFocusRef }: GoodDialogProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (initialFocusRef.current ?? panel.current)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [initialFocusRef, onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={title} ref={panel} tabIndex={-1}>
      <h2>{title}</h2>
      <button type="button" onClick={onClose}>
        Закрыть
      </button>
    </div>
  );
}
