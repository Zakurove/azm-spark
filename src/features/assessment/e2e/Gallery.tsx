/**
 * Foundation gallery (VITE_E2E=1 builds only): every shared shell part and state of the check on its
 * own page, for the review screenshots and the Playwright smoke. /?e2eGallery=<name>[&lang=en]
 *
 *   question  the shell with counter, Back, caption, a real pre-check question and its answers
 *   multi     a multiple choice step with the exclusive "none" and select then Next
 *   loading, empty, error, offline, soundOff, booth
 *   camera-denied-<ios|android|samsung|other>, camera-none, camera-busy, camera-stopped
 *   leave-before, leave-during, leave-guest (S15), offer (S02 over a page)
 *   fixture   plays ?e2eFixture=<name> through createCheckPoseSource and counts the frames
 * App.tsx loads this module lazily inside an import.meta.env.VITE_E2E branch.
 */
import { useEffect, useRef, useState } from "react";
import type { Lang } from "../../../app/i18n";
import { t } from "../../../i18n";
import { precheckItem } from "../../../movements/assessments";
import { AfterIntakeOffer } from "../../progress";
import { createCheckPoseSource } from "../poseSourceFactory";
import { AnswerButtons, MultiAnswerList, useNextWithHint } from "../shared/answers";
import { LeaveDialog, type LeaveVariant } from "../shared/CheckDialog";
import { CheckRoot } from "../shared/CheckRoot";
import { CheckShell } from "../shared/CheckShell";
import type { Caption } from "../shared/CheckUi";
import { CameraProblemCard, EmptyState, ErrorState, LoadingState, type Platform } from "../shared/states";

export const GALLERY_PAGES = [
  "question",
  "multi",
  "loading",
  "empty",
  "error",
  "offline",
  "soundOff",
  "booth",
  "camera-denied-ios",
  "camera-denied-android",
  "camera-denied-samsung",
  "camera-denied-other",
  "camera-none",
  "camera-busy",
  "camera-stopped",
  "leave-before",
  "leave-during",
  "leave-guest",
  "offer",
  "fixture",
] as const;

const noop = () => undefined;

export default function Gallery({
  name,
  lang,
  onLanguage,
}: {
  name: string;
  lang: Lang;
  onLanguage(): void;
}) {
  const [sound, setSound] = useState(name !== "soundOff");
  const caption: Caption | null =
    name === "question"
      ? { text: precheckItem("pc_urgent").ask![lang], severity: "info", speaking: false }
      : null;
  return (
    <CheckRoot
      ui={{
        lang,
        onLanguage,
        booth: name === "booth",
        online: name !== "offline",
        savedLater: name === "offline",
        sound: { on: sound, toggle: () => setSound((v) => !v) },
        caption,
        requestLeave: noop,
        screenKey: name,
      }}
    >
      <Page name={name} lang={lang} />
    </CheckRoot>
  );
}

function Page({ name, lang }: { name: string; lang: Lang }) {
  if (name === "question" || name === "booth" || name === "soundOff" || name === "offline")
    return <QuestionPage lang={lang} />;
  if (name === "multi") return <MultiPage lang={lang} />;
  if (name === "fixture") return <FixturePage />;
  if (name === "offer") return <OfferPage lang={lang} />;
  if (name.startsWith("leave-"))
    return (
      <>
        <QuestionPage lang={lang} />
        <LeaveDialog variant={name.slice(6) as LeaveVariant} onStay={noop} onLeave={noop} />
      </>
    );
  if (name.startsWith("camera-")) {
    const [, kind, platform] = name.split("-") as [string, "denied" | "none" | "busy" | "stopped", Platform?];
    return (
      <CheckShell onBack={noop}>
        <CameraProblemCard
          kind={kind}
          platform={platform ?? "other"}
          onRetry={noop}
          onLater={noop}
          onDemo={noop}
        />
      </CheckShell>
    );
  }
  return (
    <CheckShell
      counter={{ text: t(lang, "assessment.common.testOf", { n: 2, total: 3 }), value: 2, max: 3 }}
      onBack={noop}
    >
      {name === "loading" && (
        <>
          <h1>{t(lang, "assessment.name")}</h1>
          <LoadingState text={t(lang, "assessment.state.loading.check")} />
        </>
      )}
      {name === "empty" && (
        <EmptyState
          level={1}
          icon="chart"
          title={t(lang, "progress.empty.title")}
          body={t(lang, "progress.empty.body")}
          action={{ label: t(lang, "progress.empty.cta"), onClick: noop }}
        />
      )}
      {name === "error" && (
        <ErrorState
          level={1}
          title={t(lang, "assessment.state.error.titleStart")}
          body={t(lang, "assessment.state.error.bodyStart")}
          onRetry={noop}
          secondary={{ label: t(lang, "assessment.camera.later"), onClick: noop }}
        />
      )}
    </CheckShell>
  );
}

/** S02 over a page: "Later" closes it and focus returns to the page's h1 (5.1 returnFocus). */
function OfferPage({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <QuestionPage lang={lang} />
      {open && (
        <AfterIntakeOffer
          lang={lang}
          minutes={[16, 21]}
          onStart={() => setOpen(false)}
          onLater={() => setOpen(false)}
          returnFocus={() => document.querySelector<HTMLElement>("main h1")}
        />
      )}
    </>
  );
}

function QuestionPage({ lang }: { lang: Lang }) {
  const q = precheckItem("pc_urgent");
  const [value, setValue] = useState<string | null>(null);
  return (
    <CheckShell counter={{ value: 1, max: 9 }} onBack={noop} sound>
      <h1 id="gallery-q" className="check-question">
        {q.ask![lang]}
      </h1>
      {q.list && (
        <ul className="check-card is-cream check-body check-list">
          {q.list[lang].map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <AnswerButtons
        labelledBy="gallery-q"
        options={(q.options ?? []).map((o) => ({ value: String(o.value), label: o.label[lang] }))}
        value={value}
        onSubmit={setValue}
      />
    </CheckShell>
  );
}

function MultiPage({ lang }: { lang: Lang }) {
  const areas = ["shoulder", "elbow", "wrist", "back", "hip", "knee", "none"] as const;
  const [value, setValue] = useState<string[]>([]);
  const next = useNextWithHint(value.length > 0, noop);
  return (
    <CheckShell
      counter={{ text: t(lang, "assessment.common.stepOf", { n: 5, total: 6 }), value: 5, max: 6 }}
      onBack={noop}
      footer={{ primary: next.primary }}
    >
      <h1 id="gallery-m" className="check-question">
        {t(lang, "assessment.guest.pain.ask")}
      </h1>
      <p className="check-hint">{t(lang, "assessment.guest.chooseAll")}</p>
      {next.hint}
      <MultiAnswerList
        labelledBy="gallery-m"
        options={areas.map((a) => ({ value: a, label: t(lang, `assessment.options.pain.${a}`) }))}
        value={value}
        exclusive="none"
        onChange={setValue}
        describedBy={next.describedBy}
        groupRef={next.groupRef}
      />
    </CheckShell>
  );
}

function FixturePage() {
  const video = useRef<HTMLVideoElement>(null);
  const [frames, setFrames] = useState(0);
  const [source, setSource] = useState("");
  useEffect(() => {
    let stop = noop as () => void;
    void createCheckPoseSource(video.current!).then((s) => {
      setSource((s as { sourceName?: string }).sourceName ?? s.kind);
      void s.start(() => setFrames((n) => n + 1));
      stop = () => s.stop();
    });
    return () => stop();
  }, []);
  return (
    <CheckShell>
      <h1 lang="en" dir="ltr">
        e2e fixture
      </h1>
      <video ref={video} hidden muted playsInline />
      <p className="check-meta" lang="en" dir="ltr" data-source={source} data-frames={frames}>
        {source} {frames}
      </p>
    </CheckShell>
  );
}
