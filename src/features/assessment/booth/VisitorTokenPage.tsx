/**
 * S55b Booth mode on a visitor's phone (/?boothToken=<token>; UX spec S55b, O17, 7.2-11, Q19 (6)).
 *
 * The visitor scanned the staff QR (S55). The phone redeems the one check token (POST
 * /api/booth/redeem): the QR token is spent and the phone gets its own pass (boothMode.ts), so the link
 * turns booth mode on for this phone only. Then:
 *   on       booth.tokenOn, the booth badge, and Continue: a signed in visitor runs the check in booth
 *            mode (setting booth, the booth rules, results kept as booth); a visitor who is not signed
 *            in lands on S05 with the booth mode of the token (App decides where Continue goes)
 *   ended    booth.tokenEnded in place of any start: the token was used, spent, has ended, or the
 *            booth is closed. The same card shows later on this phone once the pass has ended (the
 *            results showed, 10 minutes hidden, 45 minutes), so a home check never runs under booth
 *            rules (TokenEndedCard, used by S55 on this phone and by the start actions).
 *   loading  while redeeming; offline: state.offline.startBlocked with Try again; error: Try again.
 * Empty and camera do not apply.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "../../../app/i18n";
import { t } from "../../../i18n";
import { createCheckApi, type CheckApi } from "../api";
import { saveVisitorToken } from "../boothMode";
import CheckIcon from "../shared/CheckIcon";
import { CheckRoot } from "../shared/CheckRoot";
import { CheckShell } from "../shared/CheckShell";
import { useCheckUi } from "../shared/CheckUi";
import { ErrorState, LoadingState } from "../shared/states";
import { reportNetwork, useOnline } from "../shared/useOnline";
import { markVisitorPhone, PASS_FORMAT, redeemOutcome } from "./passes";
import "./booth.css";

export type TokenPhase = "redeeming" | "on" | "ended" | "offline" | "error";

export interface VisitorTokenPageProps {
  lang: Lang;
  onLanguage(): void;
  /** The token of the QR link (/?boothToken=). */
  token: string;
  /** Continue: `on` tells whether booth mode is now on for this phone. */
  onContinue(on: boolean): void;
  /** Replaceable in tests. */
  api?: Pick<CheckApi, "boothRedeem">;
  /** Tests and screenshots: start in this phase without redeeming. */
  initialPhase?: TokenPhase;
}

/** Redeems a visitor token and keeps this phone's own pass: the phase that follows. */
export async function redeemToken(api: Pick<CheckApi, "boothRedeem">, token: string): Promise<TokenPhase> {
  if (!PASS_FORMAT.test(token)) return "ended";
  const out = redeemOutcome(await api.boothRedeem(token));
  if (out.kind !== "on") return out.kind;
  saveVisitorToken(out.token, out.expires);
  markVisitorPhone();
  return "on";
}

export function VisitorTokenPage({
  lang,
  onLanguage,
  token,
  onContinue,
  api: given,
  initialPhase,
}: VisitorTokenPageProps) {
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
  const [phase, setPhase] = useState<TokenPhase>(initialPhase ?? "redeeming");
  const [attempt, setAttempt] = useState(0);
  // One redeem per attempt, even when React runs the effect twice (StrictMode): a redeem spends the
  // token, so a second call would find it used.
  const calls = useRef(new Map<number, Promise<TokenPhase>>());

  useEffect(() => {
    if (initialPhase && attempt === 0) return;
    let alive = true;
    setPhase("redeeming");
    let call = calls.current.get(attempt);
    if (!call) {
      call = redeemToken(api, token);
      calls.current.set(attempt, call);
    }
    void call.then((p) => alive && setPhase(p));
    return () => {
      alive = false;
    };
  }, [attempt]);

  return (
    <CheckRoot
      ui={{ lang, onLanguage, booth: phase === "on", online, backOnline, screenKey: `S55b:${phase}` }}
    >
      <CheckShell exit={false} language>
        <div className="booth-screen" data-screen="S55b" data-phase={phase}>
          <TokenBody
            phase={phase}
            onContinue={() => onContinue(phase === "on")}
            onRetry={() => setAttempt((n) => n + 1)}
          />
        </div>
      </CheckShell>
    </CheckRoot>
  );
}

function TokenBody({
  phase,
  onContinue,
  onRetry,
}: {
  phase: TokenPhase;
  onContinue(): void;
  onRetry(): void;
}) {
  const { lang } = useCheckUi();
  const cont = { label: t(lang, "assessment.common.continue"), onClick: onContinue };
  switch (phase) {
    case "redeeming":
      return (
        <>
          <h1>{t(lang, "assessment.name")}</h1>
          <LoadingState text={t(lang, "assessment.state.loading.default")} />
        </>
      );
    case "on":
      return (
        <>
          <h1>{t(lang, "assessment.name")}</h1>
          <p className="booth-status" role="status">
            <CheckIcon name="badge" />
            <span>{t(lang, "assessment.booth.tokenOn")}</span>
          </p>
          <button type="button" className="cta" onClick={onContinue} data-primary="">
            {cont.label}
          </button>
        </>
      );
    case "ended":
      return (
        <>
          <h1>{t(lang, "assessment.name")}</h1>
          <TokenEndedCard onContinue={onContinue} />
        </>
      );
    case "offline":
    case "error":
      return (
        <ErrorState
          level={1}
          title={t(lang, "assessment.state.error.title")}
          body={t(
            lang,
            phase === "offline" ? "assessment.state.offline.startBlocked" : "assessment.state.error.body",
          )}
          onRetry={onRetry}
          secondary={cont}
        />
      );
  }
}

/**
 * booth.tokenEnded in place of a start action (S55b): on a visitor's phone once its one check token
 * has ended. Continue leaves without booth mode.
 */
export function TokenEndedCard({ onContinue }: { onContinue(): void }) {
  const { lang } = useCheckUi();
  return (
    <section className="check-card is-cream" data-token-ended="">
      <span className="check-card-icon">
        <CheckIcon name="info" />
      </span>
      <p className="check-body">{t(lang, "assessment.booth.tokenEnded")}</p>
      <button type="button" className="cta" onClick={onContinue} data-primary="">
        {t(lang, "assessment.common.continue")}
      </button>
    </section>
  );
}
