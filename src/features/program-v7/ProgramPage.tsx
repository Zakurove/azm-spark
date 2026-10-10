/**
 * The program page of v7 (product v7 contract 2.10 and section 10 E3; plan «The Program page links each
 * exercise to the finding behind it»): the exercises the findings chose (POST /api/program/targets,
 * which builds the week from the latest completed focus check, or answers it as stored), each with its
 * one reason, its dose and its days, and a way to the result behind it. The rest of each session follows
 * the goal, as the Program tab's week shows.
 *
 * Simple and premium, Arabic first: one card per exercise, one line of why. The focus check's family
 * (focus.css: a warm light stage, glass cards, Cairo, gold for the one action, purple for the person's
 * marks, no hard borders) with the page's own parts in program.css. src/app/App.tsx opens it at
 * /?targets=1 for a signed in person, in a VITE_V7=1 build only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "../../app/i18n";
import ExerciseArt from "../../app/ExerciseArt";
import { bidiText } from "../../i18n/rich";
import { tV7 } from "../../i18n/v7";
import { t } from "../../i18n";
import { CheckRoot } from "../assessment/shared/CheckRoot";
import CheckIcon from "../assessment/shared/CheckIcon";
import { Actions, Body, Glass, Kicker, Loading, Page, Title, TopBar } from "../focus/parts";
import { createProgramApi, type ProgramApi, type ProgramTargets } from "./api";
import { DemoLink } from "./DemoLink";
import { programItems, type ProgramItemView } from "./program";
import "../focus/focus.css";
import "./program.css";

/**
 * Where the program page leaves to: the portal's Today or Program tab, the findings page, or the demo
 * exercises (D-037 item 6).
 */
export type ProgramExit = "today" | "program" | "findings" | "demos";

export interface ProgramPageProps {
  lang: Lang;
  onLanguage(): void;
  onExit(to: ProgramExit): void;
}

/** What the page shows: the week, or why there is none. */
export type ProgramLoad =
  | { kind: "loading" }
  | { kind: "ready"; data: ProgramTargets }
  | { kind: "none" }
  | { kind: "plan" }
  | { kind: "error" };

/** One load: the week built from the latest completed check (or as stored), or why there is none. */
export async function loadProgram(api: Pick<ProgramApi, "targets">): Promise<ProgramLoad> {
  const r = await api.targets();
  if (r.ok) return { kind: "ready", data: r.value };
  const e = r.error;
  if (e.kind === "http" && e.status === 404 && e.code === "NO_FINDINGS") return { kind: "none" };
  if (e.kind === "http" && e.status === 409) return { kind: "plan" };
  return { kind: "error" };
}

export default function ProgramPage({ lang, onLanguage, onExit }: ProgramPageProps) {
  const api = useMemo(() => createProgramApi(), []);
  const [load, setLoad] = useState<ProgramLoad>({ kind: "loading" });
  const asked = useRef(0);
  const fetchProgram = useCallback(async () => {
    const n = ++asked.current;
    setLoad({ kind: "loading" });
    const next = await loadProgram(api);
    if (n === asked.current) setLoad(next);
  }, [api]);
  useEffect(() => {
    void fetchProgram();
    return () => {
      asked.current++;
    };
  }, [fetchProgram]);
  return (
    <ProgramScreen
      lang={lang}
      load={load}
      onLanguage={onLanguage}
      onExit={onExit}
      onRetry={() => void fetchProgram()}
    />
  );
}

/** The page for one state of its load: pure, so it renders the same from a test. */
export function ProgramScreen({
  lang,
  load,
  onLanguage,
  onExit,
  onRetry,
}: {
  lang: Lang;
  load: ProgramLoad;
  onLanguage(): void;
  onExit(to: ProgramExit): void;
  onRetry(): void;
}) {
  const top = (
    <TopBar
      lang={lang}
      onLanguage={onLanguage}
      onLeave={() => onExit("program")}
      leaveLabel={tV7(lang, "targets.program.close")}
    />
  );
  const back = {
    label: tV7(lang, "targets.program.back"),
    onClick: () => onExit("program"),
    name: "program",
  };
  const results = {
    label: tV7(lang, "targets.program.results"),
    onClick: () => onExit("findings"),
    kind: "secondary" as const,
    name: "findings",
  };
  let screen: string;
  let content;
  switch (load.kind) {
    case "loading":
      screen = "program_loading";
      content = <Loading text={tV7(lang, "targets.program.loading")} />;
      break;
    case "none":
      screen = "program_none";
      content = (
        <Message
          lang={lang}
          title={tV7(lang, "targets.program.noneTitle")}
          body={tV7(lang, "targets.program.noneBody")}
          actions={[
            { ...back, kind: "secondary" },
            {
              label: t(lang, "assessment.common.backToToday"),
              onClick: () => onExit("today"),
              name: "today",
            },
          ]}
        />
      );
      break;
    case "plan":
      screen = "program_plan";
      content = (
        <Message
          lang={lang}
          title={tV7(lang, "targets.program.planTitle")}
          body={tV7(lang, "targets.program.planBody")}
          actions={[back]}
        />
      );
      break;
    case "error":
      screen = "program_error";
      content = (
        <Message
          lang={lang}
          title={t(lang, "assessment.state.error.title")}
          body={tV7(lang, "targets.program.loadError")}
          actions={[
            { ...back, kind: "secondary" },
            { label: t(lang, "assessment.common.retry"), onClick: onRetry, name: "retry", icon: "refresh" },
          ]}
        />
      );
      break;
    case "ready":
      screen = "program";
      content = <ProgramBody lang={lang} data={load.data} onExit={onExit} actions={[results, back]} />;
      break;
  }
  return (
    <CheckRoot ui={{ lang }} page={false} className="fx">
      <Page lang={lang} top={top} screen={screen}>
        {content}
      </Page>
    </CheckRoot>
  );
}

function Message({
  lang,
  title,
  body,
  actions,
}: {
  lang: Lang;
  title: string;
  body: string;
  actions: Parameters<typeof Actions>[0]["items"];
}) {
  return (
    <div className="pv7-message">
      <Glass className="fx-card fx-hero">
        <span className="fx-badge is-violet" aria-hidden="true">
          <CheckIcon name="spark" size={28} />
        </span>
        <Title>{title}</Title>
        <Body lang={lang} text={body} />
      </Glass>
      <Actions items={actions} />
    </div>
  );
}

/** The exercises the findings chose, each with its reason, dose, days and the way to its result. */
export function ProgramBody({
  lang,
  data,
  onExit,
  actions,
}: {
  lang: Lang;
  data: ProgramTargets;
  onExit(to: ProgramExit): void;
  actions: Parameters<typeof Actions>[0]["items"];
}) {
  const items = useMemo(() => programItems(data.weekly, lang), [data.weekly, lang]);
  return (
    <div className="pv7-program">
      <Glass className="fx-card pv7-hero">
        <Kicker>{tV7(lang, "targets.program.kicker")}</Kicker>
        <Title>
          {items.length ? tV7(lang, "targets.program.title") : tV7(lang, "targets.program.emptyTitle")}
        </Title>
        <Body
          lang={lang}
          text={items.length ? tV7(lang, "targets.program.intro") : tV7(lang, "targets.program.emptyBody")}
          muted
        />
      </Glass>
      {/* D-037 item 6: the exercises the camera follows now, to try or to show (first, so the booth finds it). */}
      <DemoLink lang={lang} onOpen={() => onExit("demos")} />
      {items.length > 0 && (
        <ol className="pv7-items">
          {items.map((item) => (
            <ProgramItem key={item.id} lang={lang} item={item} onResult={() => onExit("findings")} />
          ))}
        </ol>
      )}
      <Actions items={actions} />
    </div>
  );
}

/** One exercise: its picture, name and dose, its days, its one why line and the way to its result. */
function ProgramItem({ lang, item, onResult }: { lang: Lang; item: ProgramItemView; onResult(): void }) {
  return (
    <li className="pv7-item" data-exercise={item.id}>
      <Glass className="pv7-card">
        <div className="pv7-card-head">
          <ExerciseArt category={item.category} size="row" />
          <div className="pv7-card-title">
            <h2 className="pv7-name">{item.name}</h2>
            <p className="pv7-dose">{bidiText(lang, item.dose)}</p>
          </div>
        </div>
        <ul className="pv7-days" aria-label={tV7(lang, "targets.program.days")}>
          {item.days.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <p className="pv7-why" data-why>
          <CheckIcon name="spark" size={20} />
          <span>{bidiText(lang, item.why)}</span>
        </p>
        {item.result && (
          <button type="button" className="pv7-result" onClick={onResult} data-action="result">
            <span>{tV7(lang, "targets.program.seeResult")}</span>
            <CheckIcon name="arrow-forward" size={18} />
          </button>
        )}
      </Glass>
    </li>
  );
}
