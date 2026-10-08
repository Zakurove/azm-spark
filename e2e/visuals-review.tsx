import React from "react";
import { createRoot } from "react-dom/client";
import { CheckRoot } from "../src/features/assessment/shared/CheckRoot";
import { SetupCard } from "../src/features/focus/RangeScreens";
import { Page, TopBar } from "../src/features/focus/parts";
import { GaitController } from "../src/features/gait/controller";
import { GaitScreen } from "../src/features/gait/GaitCapture";
import { ROM_DATA } from "../src/movements/rom";
import type { RomProtocolItem } from "../src/medical/rom-protocol";
import type { GaitPlan } from "../src/medical/gait-eligibility";
import "../src/app/styles.css";
import "../src/app/platform.css";
import "../src/features/focus/focus.css";
import "../src/features/gait/gait.css";
import "../src/features/assessment/safety/safety.css";

const query = new URLSearchParams(location.search);
const lang = query.get("lang") === "en" ? "en" : "ar";
const side = query.get("side") === "left" ? "left" : "right";
document.documentElement.lang = lang;
document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
const nothing = () => {};
const plan: GaitPlan = {
  offered: true,
  modes: ["overground", "walking_pad"],
  defaultMode: "overground",
  padAllowed: true,
  helperRequired: true,
  antalgicOnly: false,
  staticStance: true,
  views: {
    overground: ["front", "back", "side"],
    walking_pad: [
      { view: "pad_side", nearSide: "right" },
      { view: "pad_side", nearSide: "left" },
      { view: "pad_front" },
    ],
  },
};

function Review() {
  let content: React.ReactNode;
  if (query.has("walk")) {
    const name = query.get("walk")!;
    const pad = name.startsWith("pad");
    const ctl = new GaitController({ plan, poseModel: () => "full" });
    if (name === "overground_side") {
      const viewsOf = ctl.viewsOf.bind(ctl);
      ctl.viewsOf = (rec) => viewsOf(rec).map((view) => ({ ...view, nearSide: side }));
    }
    ctl.start(0);
    ctl.confirm(0);
    ctl.chooseMode(pad ? "walking_pad" : "overground", 0);
    const rec = name === "pad_side" ? (side === "left" ? "pad_side_b" : "pad_side_a") : name;
    const index = ctl.plannedSteps.findIndex((s) =>
      name === "pad_safety" ? s.id === "pad_floor" : s.id === "place" && s.rec === rec,
    );
    if (index < 0) throw new Error(`Unknown review step ${name}`);
    (ctl as unknown as { go(index: number, now: number): void }).go(index, 0);
    content = (
      <GaitScreen lang={lang} ctl={ctl} now={0} clock={() => 0} stage={() => null} onStop={nothing} />
    );
  } else {
    const name = query.get("movement") ?? "shoulder_flexion";
    const wheelchair = name.endsWith("_wheelchair");
    const id = name.replace(/_wheelchair$/, "");
    const def = ROM_DATA.movements.find((m) => m.id === id)!;
    const position = wheelchair
      ? "seated_armrests"
      : id === "shoulder_extension"
        ? "standing_supported"
        : def.positions[0].id;
    const item: RomProtocolItem = {
      movementId: def.id,
      side,
      region: def.region,
      position,
      block: position === "lying_back" ? "lying" : position.startsWith("standing") ? "standing" : "seated",
      order: 1,
      priority: "core",
      verdict: "measure",
      normId: null,
      graded: true,
      askCanMove: false,
      helperRequired: false,
      approximate: false,
    };
    content = (
      <SetupCard
        lang={lang}
        item={item}
        n={1}
        total={7}
        wheelchair={wheelchair}
        turnSide={false}
        onReady={nothing}
      />
    );
  }
  return (
    <CheckRoot ui={{ lang, booth: true }} page={false} className="fx">
      <Page
        lang={lang}
        screen="visual_review"
        top={
          <TopBar
            lang={lang}
            progress={{ done: 2, total: 3 }}
            onLeave={nothing}
            sound={{ on: false, toggle: nothing }}
          />
        }
      >
        {content}
      </Page>
    </CheckRoot>
  );
}

createRoot(document.getElementById("root")!).render(<Review />);
