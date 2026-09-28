/**
 * Dialogs of the check (UX spec 5.1 Dialog changes, S15): role dialog or alertdialog, aria-modal,
 * the page behind made inert, Escape handled here (onClose), Tab kept inside, focus on a chosen
 * element on open and returned on close. It renders inside the .azm-check root, so it uses the
 * check tokens and changes nothing global.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { t } from "../../../i18n";
import { useCheckUi } from "./CheckUi";

export interface CheckDialogProps {
  titleId: string;
  role?: "dialog" | "alertdialog";
  /** Escape; undefined means Escape does nothing (alarm, safety). */
  onClose?: () => void;
  /** CSS selector of the element that takes focus on open (default: the dialog itself). */
  initialFocus?: string;
  children: ReactNode;
}

const FOCUSABLE =
  "button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea,[tabindex='0']";

export function CheckDialog({ titleId, role = "dialog", onClose, initialFocus, children }: CheckDialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const card = ref.current;
    const backdrop = card?.parentElement;
    // Everything outside the dialog is inert while it is open.
    const siblings = backdrop?.parentElement
      ? Array.from(backdrop.parentElement.children).filter((el) => el !== backdrop)
      : [];
    for (const el of siblings) el.setAttribute("inert", "");
    const target = initialFocus ? card?.querySelector<HTMLElement>(initialFocus) : null;
    (target ?? card)?.focus();
    return () => {
      for (const el of siblings) el.removeAttribute("inert");
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [initialFocus]);
  return (
    <div className="check-dialog-backdrop">
      <div
        ref={ref}
        className="check-dialog"
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape" && onClose) {
            e.preventDefault();
            onClose();
            return;
          }
          if (e.key !== "Tab") return;
          const els = Array.from(ref.current!.querySelectorAll<HTMLElement>(FOCUSABLE));
          if (els.length === 0) return;
          const first = els[0];
          const last = els[els.length - 1];
          if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

export type LeaveVariant = "before" | "during" | "guest";

export interface LeaveDialogProps {
  variant: LeaveVariant;
  onStay(): void;
  onLeave(): void;
}

/**
 * S15 Leave the check. The safe choice is the gold primary and takes focus; Escape equals Stay.
 * The body says what is kept: nothing before the start, finished results during, nothing as a guest.
 */
export function LeaveDialog({ variant, onStay, onLeave }: LeaveDialogProps) {
  const { lang } = useCheckUi();
  const body =
    variant === "guest"
      ? t(lang, "assessment.exit.bodyGuest")
      : variant === "during"
        ? t(lang, "assessment.exit.bodyDuring")
        : t(lang, "assessment.exit.bodyBefore");
  return (
    <CheckDialog titleId="check-leave-title" onClose={onStay} initialFocus="[data-stay]">
      <h2 id="check-leave-title">{t(lang, "assessment.exit.title")}</h2>
      <p className="check-body">{body}</p>
      <div className="check-actions">
        <button type="button" className="cta" onClick={onStay} data-stay="">
          {t(lang, "assessment.exit.stay")}
        </button>
        <button type="button" className="ghost" onClick={onLeave}>
          {t(lang, "assessment.exit.leave")}
        </button>
      </div>
    </CheckDialog>
  );
}
