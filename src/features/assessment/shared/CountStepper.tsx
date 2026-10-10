/**
 * A whole count between two 56 px icon buttons (the S30 stepper look, UX spec S48 and S57): the
 * person's own count check (S48, countSource 'self') and the staff count correction at the booth
 * (S57, countSource 'staff'). The buttons are named assessment.count.decrease and increase (SVG minus
 * and plus, never the characters). The field takes the numeric keypad; Arabic Indic and Persian
 * digits are read (parseNumberInput, 0.2) and the value shows back in Western digits (D-036 item 3).
 *
 * The parent owns the text, so a Continue or Save outside the stepper reads what was typed.
 */
import { useId } from "react";
import { localizeDigits, t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import CheckIcon from "./CheckIcon";
import { useCheckUi } from "./CheckUi";
import { parseNumberInput } from "./format";

/** A whole count in [min, max] from typed text, or null. */
export function parseCount(raw: string, min: number, max: number): number | null {
  const n = parseNumberInput(raw);
  return n !== null && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export interface CountStepperProps {
  /** The field's visible label (S48 count.howMany; S57 booth.staffCount, visually hidden). */
  label: string;
  hideLabel?: boolean;
  text: string;
  onText(text: string): void;
  min: number;
  max: number;
  /** Show the range line under the field (after a Continue with a value out of range). */
  invalid: boolean;
  /** The field's id, so a dialog can focus it first. */
  inputId?: string;
}

export function CountStepper({
  label,
  hideLabel,
  text,
  onText,
  min,
  max,
  invalid,
  inputId,
}: CountStepperProps) {
  const { lang } = useCheckUi();
  const ownId = useId();
  const fieldId = inputId ?? ownId;
  const errorId = useId();
  const local = (n: number) => localizeDigits(lang, String(n));
  const current = parseCount(text, min, max);
  const step = (by: number) => {
    const from = current ?? parseNumberInput(text) ?? min;
    onText(local(Math.min(max, Math.max(min, Math.round(from) + by))));
  };
  return (
    <div className="check-stepper">
      <label htmlFor={fieldId} className={hideLabel ? "check-visually-hidden" : "check-h2"}>
        {label}
      </label>
      <div className="check-stepper-row">
        <button
          type="button"
          className="check-stepper-button"
          aria-label={t(lang, "assessment.count.decrease")}
          aria-controls={fieldId}
          disabled={current !== null && current <= min}
          onClick={() => step(-1)}
        >
          <CheckIcon name="minus" />
        </button>
        <input
          id={fieldId}
          className="check-stepper-input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={3}
          value={text}
          onChange={(e) => onText(e.target.value.replace(/[^\d٠-٩۰-۹]/g, ""))}
          onBlur={() => current !== null && onText(local(current))}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          data-count-input=""
        />
        <button
          type="button"
          className="check-stepper-button"
          aria-label={t(lang, "assessment.count.increase")}
          aria-controls={fieldId}
          disabled={current !== null && current >= max}
          onClick={() => step(1)}
        >
          <CheckIcon name="plus" />
        </button>
      </div>
      {invalid && (
        <p id={errorId} className="check-field-error" role="alert">
          {bidiText(lang, t(lang, "assessment.count.range", { min, max }))}
        </p>
      )}
    </div>
  );
}
