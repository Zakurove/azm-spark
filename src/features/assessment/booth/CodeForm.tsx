/**
 * The staff code (UX spec S55, S56; contract v3 I, O17, Q21 (5)): S55 turns booth mode on with it, S56
 * opens its staff part with it (PIN protected staff mode). The code is typed masked, with the numeric
 * keypad, digits normalised (0.2); it goes to POST /api/booth/verify and is dropped, never stored.
 */
import { useId, useRef, useState, type FormEvent } from "react";
import type { Lang } from "../../../app/i18n";
import { t } from "../../../i18n";
import type { CheckApi } from "../api";
import { useCheckUi } from "../shared/CheckUi";
import { normalizeCode, verifyOutcome, type VerifyOutcome } from "./passes";
import "./booth.css";

export type CodeError = Exclude<VerifyOutcome["kind"], "on">;

export function codeErrorText(lang: Lang, e: CodeError): string {
  switch (e) {
    case "wrong":
      return t(lang, "assessment.booth.wrong");
    case "offline":
      return t(lang, "assessment.state.offline.startBlocked");
    case "error":
      return t(lang, "assessment.state.error.body");
    // SPEC-GAP: booth-closed-copy. No key says the booth is closed or that there were too many tries
    // (asked of the copy owner); the general error title shows until one lands.
    case "closed":
    case "limited":
      return t(lang, "assessment.state.error.title");
  }
}

/**
 * The staff code form: S55 turns booth mode on with it, S56 opens its staff part with it (PIN
 * protected staff mode, Q21 (5)). The code goes to POST /api/booth/verify and is dropped.
 */
export function BoothCodeForm({
  api,
  onVerified,
  submitLabel,
}: {
  api: Pick<CheckApi, "boothVerify">;
  onVerified(session: string, expires: number): void;
  /** The primary's label: booth.turnOn on S55. */
  submitLabel?: string;
}) {
  const { lang } = useCheckUi();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CodeError | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    const value = normalizeCode(code);
    if (!value) {
      setError("wrong");
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const out = verifyOutcome(await api.boothVerify(value));
    setBusy(false);
    if (out.kind === "on") {
      // The code is never kept (O17): the field is emptied before booth mode turns on.
      setCode("");
      onVerified(out.session, out.expires);
      return;
    }
    setError(out.kind);
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const fieldError = error === "wrong";
  return (
    <form className="booth-form" onSubmit={submit} noValidate>
      <div className="booth-field">
        <label className="booth-field-label" htmlFor={inputId}>
          {t(lang, "assessment.booth.codeLabel")}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className="booth-input booth-code"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          dir="ltr"
          maxLength={64}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            if (error) setError(null);
          }}
          aria-invalid={fieldError || undefined}
          aria-describedby={error ? errorId : undefined}
        />
      </div>
      {error && (
        <p id={errorId} className="booth-alert" role="alert">
          {codeErrorText(lang, error)}
        </p>
      )}
      <button type="submit" className="cta" aria-busy={busy || undefined} data-primary="">
        {busy && <span className="booth-busy" aria-hidden="true" />}
        {submitLabel ?? t(lang, "assessment.booth.turnOn")}
      </button>
    </form>
  );
}
