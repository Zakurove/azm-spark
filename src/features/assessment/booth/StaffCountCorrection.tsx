/**
 * S57 Staff count correction (UX spec S57, O22): at the booth, on S34h after a timed test, a 48 px
 * outlined "Correct the count" opens the count our staff made. It is the only way a count changes at
 * the booth (the person's own count check, S48, never shows there); the camera screen saves it with
 * countSource 'staff'. Shown only in booth mode, so it never appears at home.
 *
 * The count uses the S48 stepper (CountStepper: one fewer, one more, or typed on the numeric keypad
 * with Arabic Indic and Persian digits normalised, 0.2) and shows back in the page's digits; a whole
 * count from 0 to 60, else the range line under the field.
 */
import { useId, useState } from "react";
import { fmtNum } from "../../../app/i18n";
import { t } from "../../../i18n";
import { CheckDialog } from "../shared/CheckDialog";
import { CountStepper } from "../shared/CountStepper";
import { useCheckUi } from "../shared/CheckUi";
import { COUNT_RANGE, parseStaffCount } from "./tools";
import "./booth.css";

export interface StaffCountCorrectionProps {
  /** The count the camera made. */
  autoCount: number;
  /** The staff count, saved by the camera screen with countSource 'staff'. */
  onSave(count: number): void;
  onCancel?: () => void;
}

export function StaffCountCorrection({ autoCount, onSave, onCancel }: StaffCountCorrectionProps) {
  const { lang, booth } = useCheckUi();
  const [open, setOpen] = useState(false);
  if (!booth) return null;
  return (
    <>
      <button type="button" className="ghost" onClick={() => setOpen(true)} data-staff-count="">
        {t(lang, "assessment.booth.correct")}
      </button>
      {open && (
        <StaffCountDialog
          autoCount={autoCount}
          onSave={(n) => {
            setOpen(false);
            onSave(n);
          }}
          onCancel={() => {
            setOpen(false);
            onCancel?.();
          }}
        />
      )}
    </>
  );
}

export function StaffCountDialog({ autoCount, onSave, onCancel }: Required<StaffCountCorrectionProps>) {
  const { lang } = useCheckUi();
  const titleId = useId();
  const inputId = useId();
  const [value, setValue] = useState(() => fmtNum(autoCount, lang));
  const [invalid, setInvalid] = useState(false);
  const save = () => {
    const n = parseStaffCount(value);
    if (n === null) {
      setInvalid(true);
      document.getElementById(inputId)?.focus();
      return;
    }
    onSave(n);
  };
  return (
    <CheckDialog titleId={titleId} onClose={onCancel} initialFocus="input">
      <h2 id={titleId}>{t(lang, "assessment.booth.staffCount")}</h2>
      <form
        className="booth-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <CountStepper
          label={t(lang, "assessment.booth.staffCount")}
          hideLabel
          inputId={inputId}
          text={value}
          onText={(v) => {
            setValue(v);
            setInvalid(false);
          }}
          min={COUNT_RANGE[0]}
          max={COUNT_RANGE[1]}
          invalid={invalid}
        />
        <div className="check-actions">
          <button type="submit" className="cta">
            {t(lang, "assessment.common.continue")}
          </button>
          <button type="button" className="ghost" onClick={onCancel}>
            {t(lang, "assessment.common.close")}
          </button>
        </div>
      </form>
    </CheckDialog>
  );
}
