/**
 * The .azm-check root: the scoped tokens (check.css), the language and direction, and the CheckUi
 * context. CheckApp renders it with the live flow state; pages outside the flow (S53, S54, S55, the
 * Today slot) render it with defaults. It never changes the document's own lang or dir.
 */
import type { ReactNode } from "react";
import "../tokens.css";
import "../check.css";
import { CheckUiContext, DEFAULT_UI, type CheckUi } from "./CheckUi";
import { HiddenAnnouncer } from "./CaptionBar";

export interface CheckRootProps {
  ui: Partial<CheckUi> & Pick<CheckUi, "lang">;
  /** Full page (min height 100dvh, column layout) or a block inside another page (Today, results). */
  page?: boolean;
  className?: string;
  children: ReactNode;
}

export function CheckRoot({ ui, page = true, className, children }: CheckRootProps) {
  const value: CheckUi = { ...DEFAULT_UI, ...ui };
  return (
    <CheckUiContext.Provider value={value}>
      <div
        className={`azm-check${page ? " check-page" : ""}${className ? ` ${className}` : ""}`}
        lang={value.lang}
        dir={value.lang === "ar" ? "rtl" : "ltr"}
      >
        {children}
        {page && <HiddenAnnouncer />}
      </div>
    </CheckUiContext.Provider>
  );
}
