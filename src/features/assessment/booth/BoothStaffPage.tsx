/**
 * S55 Booth staff mode (/?booth=1, staff devices only; UX spec S55, contract v3 I, O17, O18, 7.2-11).
 *
 *   off   the staff code (masked, numeric keypad, never stored): POST /api/booth/verify. The code
 *         changes every day and works only on the booth days and hours (server BOOTH_DATES); the
 *         server answers a device session for the day, kept by boothMode.ts in sessionStorage for
 *         this tab only, and the code is dropped at once.
 *   on    "Booth mode is on for this phone", open the visitor check (/?check=1), the one check QR for
 *         a signed in visitor's own phone (POST /api/booth/token, 45 minutes at most, shown only as a
 *         QR, never as text), the offline preparation line (O18), the staff settings (D-016 item 4,
 *         council F-1: a switch per test, the plane check fallback, the staff readout; open while any
 *         of them differs from the defaults) and "Turn off booth mode".
 *
 * The session ends at closing time: the page turns back to the code form by itself. The badge shows
 * only while booth mode is on (S57). Not linked from any user screen. No Sound: nothing plays here.
 *
 * States: loading (the busy primary), error (wrong code, closed, too many tries, network), offline
 * (cannot verify: state.offline.startBlocked); empty and camera do not apply.
 */
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Lang } from "../../../app/i18n";
import { localizeDigits, t } from "../../../i18n";
import { createCheckApi, type CheckApi } from "../api";
import { clearBoothPass, readBoothPass, saveStaffSession, type BoothPass } from "../boothMode";
import { CheckRoot } from "../shared/CheckRoot";
import { CheckShell } from "../shared/CheckShell";
import CheckIcon from "../shared/CheckIcon";
import { useCheckUi } from "../shared/CheckUi";
import { reportNetwork, useOnline } from "../shared/useOnline";
import { BoothCodeForm } from "./CodeForm";
import { tokenOutcome, visitorLink, wasVisitorPhone } from "./passes";
import { offlineStatus, precacheBooth, type OfflineStatus, type PrecacheResult } from "./precache";
import { QrCode } from "../shared/QrCode";
import { TokenEndedCard } from "./VisitorTokenPage";
import {
  isDefault,
  PLANE_RATIOS,
  readBoothSettings,
  saveBoothSettings,
  SWITCHABLE_TESTS,
  type BoothSettings,
} from "./settings";
import { CheckSwitch } from "../shared/CheckSwitch";
import { testDef } from "../../../movements/assessments";
import type { TestId } from "../../../movements/types";
import "./booth.css";

export interface BoothStaffPageProps {
  lang: Lang;
  onLanguage(): void;
  /** Leaves this page for the landing (a visitor's phone whose token has ended, S55b). */
  onExit(): void;
  /** Opens the visitor check (/?check=1) once booth mode is on. */
  onOpenGuest(): void;
  /** Replaceable in tests. */
  api?: Pick<CheckApi, "boothVerify" | "boothToken">;
  /** The site the visitor QR opens (this page's origin by default). */
  origin?: string;
  /** Keeps the booth files for offline use (O18); replaceable in tests. */
  precache?: () => Promise<PrecacheResult>;
}

/**
 * The E2E harness of the booth screens (VITE_E2E builds only, contract v3 K): /?booth=1&e2eBooth=<page>.
 * VITE_E2E is replaced at build time, so a production bundle holds neither the import nor the harness.
 */
const BoothHarness = import.meta.env.VITE_E2E === "1" ? lazy(() => import("./e2e/BoothHarness")) : null;

export function BoothStaffPage(props: BoothStaffPageProps) {
  const harness =
    BoothHarness && typeof location !== "undefined"
      ? new URLSearchParams(location.search).get("e2eBooth")
      : null;
  if (BoothHarness && harness)
    return (
      <Suspense fallback={null}>
        <BoothHarness name={harness} lang={props.lang} onLanguage={props.onLanguage} />
      </Suspense>
    );
  return <BoothStaff {...props} />;
}

/** One preparation at a time for the page (React may run the effect twice). */
let preparing: Promise<PrecacheResult> | null = null;
function defaultPrecache(): Promise<PrecacheResult> {
  if (typeof caches === "undefined") return Promise.resolve({ cached: [], missing: ["caches"] });
  preparing ??= precacheBooth({ fetch: (...a) => fetch(...a), caches }).finally(() => {
    preparing = null;
  });
  return preparing;
}

function BoothStaff({
  lang,
  onLanguage,
  onOpenGuest,
  onExit,
  api: given,
  origin,
  precache,
}: BoothStaffPageProps) {
  const api = useMemo(
    () =>
      given ??
      createCheckApi({
        onNetworkError: () => reportNetwork(false),
        onReachable: () => reportNetwork(true),
      }),
    [given],
  );
  const { online, backOnline } = useOnline();
  const [pass, setPass] = useState<BoothPass | null>(() => readBoothPass());
  // A visitor's own phone whose one check token has ended lands here when its start is refused
  // (flow BOOTH_CODE): it shows booth.tokenEnded (S55b), never the staff code, which is typed only
  // on staff devices (S55, 7.2-11).
  const [visitorPhone] = useState(() => wasVisitorPhone());

  // The staff session ends at closing time: the page turns back to the code form (S55).
  useEffect(() => {
    if (!pass || pass.kind === "e2e") return;
    const timer = setTimeout(() => setPass(readBoothPass()), Math.max(0, pass.expires - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [pass]);

  const turnOff = () => {
    clearBoothPass();
    setPass(null);
  };

  return (
    <CheckRoot
      ui={{ lang, onLanguage, booth: pass !== null, online, backOnline, screenKey: pass ? "S55:on" : "S55" }}
    >
      <CheckShell exit={false} language>
        <div className="booth-screen" data-screen="S55" data-booth={pass ? "on" : "off"}>
          <h1>{t(lang, visitorPhone && !pass ? "assessment.name" : "assessment.booth.title")}</h1>
          {visitorPhone && !pass ? (
            <TokenEndedCard onContinue={onExit} />
          ) : pass ? (
            <BoothOn
              pass={pass}
              api={api}
              origin={origin}
              precache={precache ?? defaultPrecache}
              onOpenGuest={onOpenGuest}
              onTurnOff={turnOff}
            />
          ) : (
            <BoothCodeForm
              api={api}
              onVerified={(session, expires) => {
                saveStaffSession(session, expires);
                setPass(readBoothPass());
              }}
            />
          )}
        </div>
      </CheckShell>
    </CheckRoot>
  );
}

/* ------------------------------------------------------------------ on */

function BoothOn({
  pass,
  api,
  origin,
  precache,
  onOpenGuest,
  onTurnOff,
}: {
  pass: BoothPass;
  api: Pick<CheckApi, "boothToken">;
  origin?: string;
  precache: () => Promise<PrecacheResult>;
  onOpenGuest(): void;
  onTurnOff(): void;
}) {
  const lang = useLang();
  const offline = useOfflinePreparation(pass.kind === "staff", precache);
  // Staff settings are typed on staff devices only; a visitor's phone takes them from the QR (S55b).
  const staff = pass.kind !== "visitor";
  return (
    <>
      <p className="booth-status" role="status">
        <CheckIcon name="badge" />
        <span>{t(lang, "assessment.booth.on")}</span>
      </p>
      <div className="booth-actions">
        <button type="button" className="cta" onClick={onOpenGuest} data-primary="">
          {t(lang, "assessment.booth.openGuest")}
        </button>
        {pass.kind === "staff" && (
          <VisitorQr session={pass.session} api={api} origin={origin} onSessionEnded={onTurnOff} />
        )}
      </div>
      {offline !== "notReady" && (
        <p className="booth-offline-line" role="status" data-offline={offline}>
          {offline === "preparing" ? (
            <span className="check-spinner" aria-hidden="true" />
          ) : (
            <CheckIcon name="check" />
          )}
          <span>
            {t(
              lang,
              offline === "preparing" ? "assessment.booth.offlinePreparing" : "assessment.booth.offlineReady",
            )}
          </span>
        </p>
      )}
      {staff && <StaffSettings />}
      <button type="button" className="check-text-button" onClick={onTurnOff}>
        {t(lang, "assessment.booth.turnOff")}
      </button>
    </>
  );
}

/* ------------------------------------------------------------------ staff settings (D-016 item 4) */

/**
 * The booth staff settings of this device (settings.ts): a switch per test (on by default; a test
 * that is off never appears in the visitor's tests, and its switch says so, for staff only), the arm
 * raise plane check fallback of F-1 and the staff readout for the team's phone sessions. Folded away
 * at the defaults, so the page stays short; open whenever something differs.
 */
function StaffSettings() {
  const lang = useLang();
  const [settings, setSettings] = useState<BoothSettings>(() => readBoothSettings());
  const [open] = useState(() => !isDefault(settings));
  const update = (next: BoothSettings) => {
    saveBoothSettings(next);
    setSettings(readBoothSettings());
  };
  const setTest = (id: TestId, on: boolean) =>
    update({
      ...settings,
      testsOff: on ? settings.testsOff.filter((x) => x !== id) : [...settings.testsOff, id],
    });
  return (
    <details className="booth-settings" open={open} data-booth-settings="">
      <summary className="booth-settings-summary">
        <h2 className="check-h2">{t(lang, "assessment.booth.settings.title")}</h2>
      </summary>
      <div className="booth-settings-body">
        <p className="check-meta">{t(lang, "assessment.booth.settings.note")}</p>
        <h3 className="booth-settings-h3">{t(lang, "assessment.booth.settings.tests")}</h3>
        <p className="check-meta">{t(lang, "assessment.booth.settings.testsNote")}</p>
        {SWITCHABLE_TESTS.map((id) => {
          const on = !settings.testsOff.includes(id);
          return (
            <CheckSwitch
              key={id}
              on={on}
              onChange={(v) => setTest(id, v)}
              setting={`test:${id}`}
              title={localizeDigits(lang, testDef(id).name[lang])}
              note={t(lang, on ? "assessment.booth.settings.testOn" : "assessment.booth.settings.testOff")}
            />
          );
        })}
        <h3 className="booth-settings-h3">
          {localizeDigits(lang, testDef("shoulder_abduction").name[lang])}
        </h3>
        <CheckSwitch
          on={settings.planeFallback}
          onChange={(v) => update({ ...settings, planeFallback: v })}
          setting="planeFallback"
          title={t(lang, "assessment.booth.settings.plane")}
          note={t(lang, "assessment.booth.settings.planeNote", {
            fallback: PLANE_RATIOS.fallback,
            standard: PLANE_RATIOS.standard,
          })}
        />
        <CheckSwitch
          on={settings.readout}
          onChange={(v) => update({ ...settings, readout: v })}
          setting="readout"
          title={t(lang, "assessment.booth.settings.readout")}
          note={t(lang, "assessment.booth.settings.readoutNote")}
        />
      </div>
    </details>
  );
}

/** O18: keeps the booth files for offline use once, while a staff session holds. */
function useOfflinePreparation(active: boolean, precache: () => Promise<PrecacheResult>): OfflineStatus {
  const [result, setResult] = useState<PrecacheResult | null>(null);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void precache()
      .catch(() => ({ cached: [], missing: ["error"] }))
      .then((r) => alive && setResult(r));
    return () => {
      alive = false;
    };
  }, [active]);
  if (!active) return "notReady";
  const controlled = typeof navigator !== "undefined" && !!navigator.serviceWorker?.controller;
  return offlineStatus(result, controlled);
}

/* ------------------------------------------------------------------ the visitor QR (S55, S55b) */

type QrState =
  | { kind: "closed" }
  | { kind: "busy" }
  | { kind: "qr"; token: string; expires: number }
  | { kind: "offline" }
  | { kind: "error" };

function VisitorQr({
  session,
  api,
  origin,
  onSessionEnded,
}: {
  session: string;
  api: Pick<CheckApi, "boothToken">;
  origin?: string;
  onSessionEnded(): void;
}) {
  const lang = useLang();
  const [state, setState] = useState<QrState>({ kind: "closed" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const showRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const show = async () => {
    if (state.kind === "busy") return;
    setState({ kind: "busy" });
    const out = tokenOutcome(await api.boothToken(session));
    if (out.kind === "sessionEnded") return onSessionEnded();
    setState(out);
  };

  // A token lasts 45 minutes at most (O17): its QR goes away when it ends.
  useEffect(() => {
    if (state.kind !== "qr") return;
    headingRef.current?.focus();
    const timer = setTimeout(() => setState({ kind: "closed" }), Math.max(0, state.expires - Date.now()));
    return () => clearTimeout(timer);
  }, [state]);

  if (state.kind === "qr") {
    const link = visitorLink(
      origin ?? (typeof location !== "undefined" ? location.origin : ""),
      state.token,
      readBoothSettings(),
    );
    return (
      <section className="check-card booth-qr-panel" aria-labelledby={titleId} data-visitor-qr="">
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="check-h2">
          {t(lang, "assessment.booth.visitorQrTitle")}
        </h2>
        <p className="check-body">{t(lang, "assessment.booth.visitorQrBody")}</p>
        <div className="booth-qr">
          <QrCode text={link} label={t(lang, "assessment.booth.visitorQrTitle")} size={224} />
        </div>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            setState({ kind: "closed" });
            requestAnimationFrame(() => showRef.current?.focus());
          }}
        >
          {t(lang, "assessment.common.close")}
        </button>
      </section>
    );
  }
  return (
    <>
      <button
        ref={showRef}
        type="button"
        className="ghost"
        onClick={() => void show()}
        aria-busy={state.kind === "busy" || undefined}
      >
        {state.kind === "busy" && <span className="booth-busy" aria-hidden="true" />}
        <CheckIcon name="qr" />
        {t(lang, "assessment.booth.showVisitorQr")}
      </button>
      {(state.kind === "offline" || state.kind === "error") && (
        <p className="booth-alert" role="alert">
          {t(
            lang,
            state.kind === "offline"
              ? "assessment.state.offline.startBlocked"
              : "assessment.state.error.body",
          )}
        </p>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ helpers */

function useLang(): Lang {
  return useCheckUi().lang;
}
