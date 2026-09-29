/**
 * S12 Consent (signed in, before the first stored check) and S13 Is this still right?
 *
 * S12: explicit consent for this purpose (spec 2.1, PDPL), with where the data is stored (H5). The
 * whole row toggles a native checkbox; Continue is never disabled: without the tick it says why and
 * moves focus to the box. Continue posts POST /api/consents; offline or a failed call keeps the tick
 * and says what happened, with Continue still there to try again.
 *
 * S13: the intake values the rules use, one look and one tap. Conditions are never listed.
 */
import { useId, useRef, useState } from "react";
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import { CHECK_DATA } from "../../../movements/assessments";
import { backTarget } from "../flowMachine";
import type { ScreenProps } from "../screenTypes";
import { CheckShell } from "../shared/CheckShell";
import CheckIcon from "../shared/CheckIcon";
import { useCheckUi } from "../shared/CheckUi";
import { contextRows } from "./copy";

type ConsentError = null | "required" | "offline" | "failed";

export function Consent({ model, dispatch, api }: ScreenProps) {
  const { lang } = useCheckUi();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ConsentError>(null);
  const boxRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  void model;

  const submit = async () => {
    if (busy) return;
    if (!checked) {
      setError("required");
      boxRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    let version = CHECK_DATA.version;
    let r = await api.acceptConsent(version);
    // The server names the current version when ours is older: accept that one.
    if (!r.ok && r.error.kind === "http" && r.error.code === "CONSENT_VERSION") {
      const v = Number(r.error.body.version);
      if (Number.isFinite(v)) {
        version = v;
        r = await api.acceptConsent(version);
      }
    }
    setBusy(false);
    if (r.ok) return dispatch({ type: "CONSENT_ACCEPTED" });
    setError(r.error.kind === "offline" ? "offline" : "failed");
  };

  const lang2 = lang === "en" ? "&lang=en" : "";
  return (
    <CheckShell
      brand
      language
      footer={{
        primary: { label: t(lang, "assessment.consent.continue"), onClick: () => void submit(), busy },
        secondary: {
          label: t(lang, "assessment.consent.notNow"),
          onClick: () => dispatch({ type: "NOT_NOW" }),
        },
      }}
    >
      <div className="flow-stack" data-screen="S12">
        <h1>{t(lang, "assessment.consent.title")}</h1>
        <p className="check-body">{t(lang, "assessment.consent.body")}</p>
        <ul className="flow-points">
          <li>{t(lang, "assessment.consent.pointVideo")}</li>
          <li>{bidiText(lang, CHECK_DATA.boundary.storageNotice[lang])}</li>
          <li>{t(lang, "assessment.consent.pointWithdraw")}</li>
        </ul>
        <label className={`flow-consent-row${checked ? " is-checked" : ""}`}>
          <input
            ref={boxRef}
            type="checkbox"
            checked={checked}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error === "required" || undefined}
            onChange={(e) => {
              setChecked(e.target.checked);
              if (e.target.checked && error === "required") setError(null);
            }}
          />
          <span>{bidiText(lang, CHECK_DATA.boundary.consent[lang])}</span>
        </label>
        {error && (
          <div id={errorId} className="flow-inline-error" role={error === "required" ? undefined : "alert"}>
            {error === "required" && (
              <p className="check-field-error">{t(lang, "assessment.consent.required")}</p>
            )}
            {error === "offline" && (
              <p className="check-body">{t(lang, "assessment.state.offline.startBlocked")}</p>
            )}
            {error === "failed" && (
              <>
                <p className="check-h2">{t(lang, "assessment.state.error.title")}</p>
                <p className="check-body">{t(lang, "assessment.state.error.body")}</p>
              </>
            )}
          </div>
        )}
        <a
          className="check-text-button flow-link"
          href={`/?privacy=1${lang2}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t(lang, "assessment.consent.privacyLink")}
        </a>
      </div>
    </CheckShell>
  );
}

export function ContextCheck({ model, dispatch }: ScreenProps) {
  const { lang } = useCheckUi();
  const ctx = model.data.signedIn?.ctx ?? model.data.env?.ctx ?? null;
  const back = backTarget(model) ? () => dispatch({ type: "BACK" }) : undefined;
  return (
    <CheckShell
      onBack={back}
      footer={{
        primary: {
          label: t(lang, "assessment.context.confirm"),
          onClick: () => dispatch({ type: "CONTEXT_CONFIRM" }),
        },
        secondary: {
          label: t(lang, "assessment.context.edit"),
          onClick: () => dispatch({ type: "CONTEXT_EDIT" }),
        },
      }}
    >
      <div className="flow-stack" data-screen="S13">
        <h1>{t(lang, "assessment.context.title")}</h1>
        <p className="check-body">{t(lang, "assessment.context.body")}</p>
        {ctx ? (
          <dl className="check-card flow-summary">
            {contextRows(lang, ctx).map((row) => (
              <div key={row.label} className="flow-summary-row">
                <dt className="check-meta">{row.label}</dt>
                <dd>{bidiText(lang, row.value)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="flow-note">
            <CheckIcon name="info" size={20} />
            <span>{t(lang, "assessment.state.loading.default")}</span>
          </p>
        )}
      </div>
    </CheckShell>
  );
}
