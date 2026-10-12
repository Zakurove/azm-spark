/**
 * The booth demo's walk (/demo): the focus check's own walk screens (GaitStep in its demo mode), part
 * 1 across the picture side on, then part 2 toward the phone and back (D-038 item 4), from its first
 * card. No focus check is open, so nothing is posted: the result card reads the walk on the phone with
 * the gait rules and the demo person's health form. The Live coach's token needs an open check, so the
 * walk runs silent with its captions, as the walk lab does. The X, a stop and the end come back to the
 * demo home.
 */
import { useState } from "react";
import type { Lang } from "../../app/i18n";
import type { GaitPlan } from "../../medical/gait-eligibility";
import { CheckRoot } from "../assessment/shared/CheckRoot";
import { Page, TopBar } from "../focus/parts";
import { GaitSlot } from "../focus/Screens";
import { GaitStep } from "../gait/GaitStep";
import { demoCopy } from "./copy";

/** The walk at home as the demo person's plan gives it: overground, the side view, then front and back. */
export const DEMO_WALK_PLAN: GaitPlan = {
  offered: true,
  modes: ["overground"],
  defaultMode: "overground",
  padAllowed: false,
  helperRequired: false,
  antalgicOnly: false,
  staticStance: false,
  views: { overground: ["side", "front", "back"], walking_pad: [] },
};

export interface DemoWalkProps {
  lang: Lang;
  onLanguage(): void;
  onClose(): void;
}

export default function DemoWalk({ lang, onLanguage, onClose }: DemoWalkProps) {
  const [chrome, setChrome] = useState({ hero: true, skip: false });
  const c = demoCopy(lang);
  return (
    <CheckRoot ui={{ lang }} page={false} className="fx">
      <Page
        lang={lang}
        top={<TopBar lang={lang} onLanguage={onLanguage} onLeave={onClose} leaveLabel={c.back} />}
        screen="demo_walk"
      >
        <GaitSlot lang={lang} hero={chrome.hero} skip={false} onSkip={onClose}>
          <GaitStep
            plan={DEMO_WALK_PLAN}
            checkId=""
            lang={lang}
            coach={() => undefined}
            demo
            onDone={onClose}
            onStop={onClose}
            onSkip={onClose}
            onChrome={setChrome}
          />
        </GaitSlot>
      </Page>
    </CheckRoot>
  );
}
