/**
 * E2E harness of the booth screens (VITE_E2E=1 builds only, contract v3 K): /?booth=1&e2eBooth=<page>.
 * It shows the booth parts that other screens host (S57 tools over a screen, S58, S55b states, the
 * staff count) on their own page, with the real flow reducer, for the Playwright specs and the review
 * screenshots. BoothStaffPage loads it lazily inside an import.meta.env.VITE_E2E branch, so a
 * production bundle never holds it.
 *
 *   layer-<results|question|camera|safety|vitals>   BoothLayer over a screen in that flow state
 *   token&phase=<redeeming|on|ended|offline|error>    S55b in that phase; token&t=<token> redeems
 *   tips, tips-wheelchair                             S58
 *   count                                             S34h with the staff count correction
 *   new-visitor                                       S50 with New visitor
 */
import { useCallback, useReducer, useState, type ReactNode } from "react";
import type { Lang } from "../../../../app/i18n";
import { t } from "../../../../i18n";
import { flowReducer, initialModel, type FlowEvent, type FlowModel, type FlowState } from "../../flowMachine";
import { CheckRoot } from "../../shared/CheckRoot";
import { CheckShell } from "../../shared/CheckShell";
import { useOnline } from "../../shared/useOnline";
import { BoothLayer, NewVisitorButton, startNextVisitor } from "../BoothLayer";
import { SetupTipsView } from "../SetupTips";
import { StaffCountCorrection } from "../StaffCountCorrection";
import { VisitorTokenPage, type TokenPhase } from "../VisitorTokenPage";

const LAYER_STATES: Record<string, FlowState> = {
  results: { kind: "results" },
  question: { kind: "guestSetup", step: 1 },
  camera: { kind: "cam.measure", i: 0, side: 0 },
  safety: {
    kind: "safety",
    safety: "emergency",
    screen: "scr_emergency",
    alsoShow: [],
    faintAnswered: false,
  },
  vitals: { kind: "question", id: "pc_booth_vitals" },
};

export default function BoothHarness({
  name,
  lang,
  onLanguage,
}: {
  name: string;
  lang: Lang;
  onLanguage(): void;
}) {
  const params = new URLSearchParams(location.search);
  if (name === "token") {
    const phase = params.get("phase") as TokenPhase | null;
    return (
      <VisitorTokenPage
        lang={lang}
        onLanguage={onLanguage}
        token={params.get("t") ?? "0".repeat(64)}
        initialPhase={phase ?? undefined}
        onContinue={(on) => document.body.setAttribute("data-continued", on ? "on" : "off")}
      />
    );
  }
  if (name.startsWith("layer-"))
    return <LayerPage state={name.slice(6)} lang={lang} onLanguage={onLanguage} />;
  return <PartPage name={name} lang={lang} onLanguage={onLanguage} />;
}

function Root({
  lang,
  onLanguage,
  children,
  screenKey,
}: {
  lang: Lang;
  onLanguage(): void;
  children: ReactNode;
  screenKey: string;
}) {
  const { online, backOnline } = useOnline();
  const [sound, setSound] = useState(true);
  return (
    <CheckRoot
      ui={{
        lang,
        onLanguage,
        booth: true,
        guest: true,
        online,
        backOnline,
        sound: { on: sound, toggle: () => setSound((v) => !v) },
        screenKey,
      }}
    >
      {children}
    </CheckRoot>
  );
}

/** A screen in a flow state with the booth layer over it; events and reloads are logged. */
function LayerPage({ state, lang, onLanguage }: { state: string; lang: Lang; onLanguage(): void }) {
  const [log, setLog] = useState<string[]>([]);
  const [model, raw] = useReducer(
    (m: FlowModel, e: FlowEvent) => flowReducer(m, e),
    undefined,
    () => {
      const m = initialModel({ mode: "guest", booth: true, homeOpen: false, desktop: false });
      return { ...m, state: LAYER_STATES[state] ?? { kind: "guestWelcome" } };
    },
  );
  const dispatch = useCallback((e: FlowEvent) => {
    setLog((l) => [...l, e.type]);
    raw({ now: Date.now(), ...e });
  }, []);
  const key = [model.state.kind, (model.state as { step?: number }).step].join(":");
  return (
    <Root lang={lang} onLanguage={onLanguage} screenKey={key}>
      <div className="check-base" data-state={model.state.kind} data-events={log.join(" ")}>
        <CheckShell exit={false}>
          <div className="booth-screen">
            <h1>{titleOf(lang, model.state)}</h1>
            {model.state.kind === "results" && (
              <NewVisitorButton
                onReset={() =>
                  startNextVisitor(dispatch, {
                    guest: true,
                    online: true,
                    reload: () => setLog((l) => [...l, "reload"]),
                  })
                }
              />
            )}
          </div>
        </CheckShell>
      </div>
      <BoothLayer model={model} dispatch={dispatch} reload={() => setLog((l) => [...l, "reload"])} />
    </Root>
  );
}

function titleOf(lang: Lang, s: FlowState): string {
  switch (s.kind) {
    case "results":
      return t(lang, "assessment.guest.resultsTitle");
    case "guestSetup":
      return t(lang, "assessment.guest.position.ask");
    case "guestWelcome":
      return t(lang, "assessment.guest.title");
    case "cam.measure":
      return t(lang, "assessment.hud.phase.raise");
    case "question":
      return t(lang, "assessment.vitals.title");
    default:
      return t(lang, "assessment.name");
  }
}

function PartPage({ name, lang, onLanguage }: { name: string; lang: Lang; onLanguage(): void }) {
  const [saved, setSaved] = useState<number | null>(null);
  const [back, setBack] = useState(0);
  if (name === "tips" || name === "tips-wheelchair")
    return (
      <Root lang={lang} onLanguage={onLanguage} screenKey={name}>
        <div data-back={back}>
          <SetupTipsView wheelchair={name === "tips-wheelchair"} onBack={() => setBack((n) => n + 1)} />
        </div>
      </Root>
    );
  if (name === "count")
    return (
      <Root lang={lang} onLanguage={onLanguage} screenKey={name}>
        <CheckShell exit={false}>
          <div className="booth-screen" data-saved={saved ?? ""}>
            <h1>{t(lang, "assessment.hud.phase.saved")}</h1>
            <p className="check-big">{saved ?? 12}</p>
            <StaffCountCorrection autoCount={12} onSave={setSaved} />
          </div>
        </CheckShell>
      </Root>
    );
  return (
    <Root lang={lang} onLanguage={onLanguage} screenKey={name}>
      <CheckShell exit={false}>
        <h1>{name}</h1>
      </CheckShell>
    </Root>
  );
}
