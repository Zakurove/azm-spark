/**
 * Dialogs of the check (UX spec 5.1 Dialog changes, S15, S02): role dialog or alertdialog, aria-modal,
 * Escape handled here (onClose), Tab kept inside, focus on a chosen element on open and returned on
 * close (returnFocus, else the element focused before). The dialog renders through a portal into
 * document.body, inside its own .azm-check root (the check tokens, the language and direction), and
 * everything else on the page is made inert while it is open, the app root included, so neither a
 * screen reader's virtual cursor nor a TalkBack swipe reaches the page behind. Nodes marked
 * data-keep-live (the one hidden live region, the offline status) and their ancestors stay live, so
 * captions and the offline notice are still announced.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { t } from "../../../i18n";
import { useCheckUi } from "./CheckUi";

export interface CheckDialogProps {
  titleId: string;
  role?: "dialog" | "alertdialog";
  /** Escape; undefined means Escape does nothing (safety). */
  onClose?: () => void;
  /** CSS selector of the element that takes focus on open (default: the dialog itself). */
  initialFocus?: string;
  /** Where focus goes on close (5.1), for when the element focused before is gone (S02: the Program h1). */
  returnFocus?: () => HTMLElement | null;
  children: ReactNode;
}

const FOCUSABLE =
  "button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea,[tabindex='0']";

/**
 * Makes everything in the page inert except `open` (the dialog's portal root), the nodes marked
 * data-keep-live and the ancestors on their path. Returns the elements it changed, to undo.
 */
export function inertOutside(open: Element, doc: Document = document): Element[] {
  const keep = Array.from(doc.querySelectorAll("[data-keep-live]"));
  const changed: Element[] = [];
  const visit = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (child === open || keep.includes(child) || ["SCRIPT", "STYLE", "LINK"].includes(child.tagName))
        continue;
      if (keep.some((k) => child.contains(k)) || child.contains(open)) {
        visit(child);
        continue;
      }
      if (!child.hasAttribute("inert")) {
        child.setAttribute("inert", "");
        changed.push(child);
      }
    }
  };
  visit(doc.body);
  return changed;
}

export function CheckDialog({
  titleId,
  role = "dialog",
  onClose,
  initialFocus,
  returnFocus,
  children,
}: CheckDialogProps) {
  const { lang } = useCheckUi();
  const ref = useRef<HTMLDivElement>(null);
  const [host] = useState(() => (typeof document === "undefined" ? null : document.createElement("div")));
  const returnRef = useRef(returnFocus);
  returnRef.current = returnFocus;

  // The portal root: its own .azm-check root in the page's language and direction.
  useLayoutEffect(() => {
    if (!host) return;
    host.classList.add("azm-check", "check-dialog-host");
    host.lang = lang;
    host.dir = lang === "ar" ? "rtl" : "ltr";
    if (!host.isConnected) document.body.appendChild(host);
  }, [host, lang]);
  useEffect(() => () => host?.remove(), [host]);

  useEffect(() => {
    if (!host) return;
    const previous = document.activeElement as HTMLElement | null;
    const card = ref.current;
    const changed = inertOutside(host);
    const target = initialFocus ? card?.querySelector<HTMLElement>(initialFocus) : null;
    (target ?? card)?.focus();
    return () => {
      for (const el of changed) el.removeAttribute("inert");
      const back = returnRef.current?.() ?? (previous && document.contains(previous) ? previous : null);
      if (back) {
        if (!back.hasAttribute("tabindex") && back.tabIndex < 0) back.setAttribute("tabindex", "-1");
        back.focus();
      }
    };
  }, [initialFocus, host]);

  if (!host) return null;
  return createPortal(
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
    </div>,
    host,
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
