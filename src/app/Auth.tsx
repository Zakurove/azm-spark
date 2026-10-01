import { useState } from "react";
import { Lang } from "./i18n";
import { labels, errorText } from "./platform-copy";
import { api, AccountState } from "./api";
import Brand from "./Brand";
import Icon from "./Icon";
import { CHECK_DATA } from "../movements/assessments";
import { bidiText } from "../i18n/rich";
import { t } from "../i18n";
import { privacyHref } from "./privacyHref";

/**
 * The body of the register or sign in call. Registering needs the adult confirmation (Q2 (5), Q32
 * (6)): the row is sent as adultConfirmed true only when it was ticked.
 */
export function authBody(data: FormData, register: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = { email: data.get("email"), password: data.get("password") };
  if (!register) return out;
  return { ...out, name: data.get("name"), adultConfirmed: data.get("adultConfirmed") === "on" };
}
export default function Auth({
  lang,
  onLanguage,
  onSuccess,
  onDemo,
  onBack,
  initialRegister,
}: {
  lang: Lang;
  onLanguage: () => void;
  onSuccess: (s: AccountState) => void;
  onDemo: () => void;
  onBack: () => void;
  initialRegister?: boolean;
}) {
  const c = labels(lang),
    [register, setRegister] = useState(initialRegister ?? false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="auth-shell">
      <header className="portal-header">
        <button
          type="button"
          className="brand-link"
          onClick={onBack}
          aria-label={lang === "ar" ? "العودة إلى الصفحة الرئيسية" : "Back to the home page"}
        >
          <Brand />
        </button>
        <div className="landing-header-actions">
          <button className="text-button auth-back" onClick={onBack}>
            <Icon name="arrow" size={14} />
            {c.backHome}
          </button>
          <button className="language" onClick={onLanguage}>
            {lang === "ar" ? "English" : "العربية"}
          </button>
        </div>
      </header>
      <main className="auth-grid">
        <section className="auth-editorial">
          <h1>{c.authTitle}</h1>
          <p>{c.authBody}</p>
          <div className="auth-athlete">
            <img
              src="/illustrations/standing.png"
              alt={lang === "ar" ? "رسم توضيحي لرياضي" : "Athlete illustration"}
            />
            <span className="auth-orbit" />
            <div className="auth-index">
              <span>01 / 03</span>
              <b>
                {lang === "ar"
                  ? "اعرف نقطة البداية.\nوابنِ عليها."
                  : "Find your starting point.\nBuild from there."}
              </b>
            </div>
          </div>
        </section>
        <section className="auth-form-panel">
          <div className="auth-tabs">
            <button
              className={!register ? "active" : ""}
              onClick={() => {
                setRegister(false);
                setError("");
              }}
            >
              {c.login}
            </button>
            <button
              className={register ? "active" : ""}
              onClick={() => {
                setRegister(true);
                setError("");
              }}
            >
              {c.register}
            </button>
          </div>
          {/* C50: «إنشاء حساب» is said once, as the tab and the button; no heading repeats it. */}
          <p>{c.authFoot}</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              setBusy(true);
              setError("");
              try {
                onSuccess(await api(`/auth/${register ? "register" : "login"}`, authBody(data, register)));
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {register && (
              <label className="field">
                <span>{c.name}</span>
                <input name="name" autoComplete="name" required minLength={2} maxLength={80} />
              </label>
            )}
            <label className="field">
              <span>{c.email}</span>
              <input name="email" type="email" autoComplete="email" required dir="ltr" maxLength={254} />
            </label>
            <label className="field">
              <span>{c.password}</span>
              <input
                name="password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                minLength={10}
                maxLength={128}
                required
                dir="ltr"
              />
              <small>{c.passwordHint}</small>
            </label>
            {register && (
              // Accounts are for adults 18 or older only (Q2 (5), Q32 (6)): unticked, required.
              <label className="consent">
                <input name="adultConfirmed" type="checkbox" required />
                <span>{bidiText(lang, CHECK_DATA.boundary.adultConfirm[lang])}</span>
              </label>
            )}
            {error && (
              <p className="form-error" role="alert">
                {errorText(error, lang)}
              </p>
            )}
            <button className="cta" disabled={busy}>
              {busy ? c.busy : register ? c.register : c.login}
              <Icon name="arrow" size={18} />
            </button>
          </form>
          {register && (
            <a className="auth-privacy" href={privacyHref(lang)}>
              {t(lang, "privacy.link")}
            </a>
          )}
          <button className="auth-demo text-button" onClick={onDemo}>
            <Icon name="play" size={16} />
            {c.demo}
          </button>
        </section>
      </main>
    </div>
  );
}
