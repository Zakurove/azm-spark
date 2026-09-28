/**
 * Stubs of the flow screens (S04 to S33, S35) until the flow stream builds them. Titles come from
 * the copy (src/i18n) or the check data; nothing here is final wording.
 */
import type { Lang } from "../../../app/i18n";
import { t } from "../../../i18n";
import { CHECK_DATA, testDef } from "../../../movements/assessments";
import { questionOf, type FlowModel } from "../flowMachine";
import { stub } from "../shared/ScreenStub";

/** The question of a pre-check state (question, confirm in place, or the start call on the last one). */
export function questionTitle(lang: Lang, m: FlowModel): string {
  const s = m.state;
  const id =
    s.kind === "question" || s.kind === "confirmPostpone"
      ? s.id
      : s.kind === "starting"
        ? s.lastQuestion
        : null;
  const q = id ? questionOf(id) : null;
  if (q?.item.id === "pc_steadi") return t(lang, "assessment.precheck.steadi.heading");
  return q?.item.ask?.[lang] ?? t(lang, "assessment.precheck.title");
}

/** The name of the test a state is about. */
export function testTitle(lang: Lang, m: FlowModel): string {
  const i = (m.state as { i?: number }).i ?? 0;
  const run = m.data.tests[i];
  return run ? testDef(run.testId).name[lang] : t(lang, "assessment.plan.title");
}

export const S04 = stub("S04", (l) => t(l, "assessment.desktop.title"));
export const S05 = stub("S05", (l) => t(l, "assessment.guest.title"), { brand: true });
export const S05a = stub("S05a", (l) => t(l, "assessment.adult.title"));
export const S06 = stub("S06", (l) => t(l, "assessment.guest.position.ask"));
export const S07 = stub("S07", (l) => t(l, "assessment.guest.support.ask"));
// S08 and S08b are worded in the check data (revision 1.1 selection.guestBooth, Q19).
export const S08 = stub("S08", (l) => CHECK_DATA.selection.guestBooth.conditionsStep.title[l]);
export const S08b = stub("S08b", (l) => CHECK_DATA.selection.guestBooth.clearance.ask[l]);
export const S09 = stub("S09", (l) => t(l, "assessment.guest.staff.titleBooth"));
export const S10 = stub("S10", (l) => t(l, "assessment.guest.pain.ask"));
export const S11 = stub("S11", (l) => t(l, "assessment.guest.restrictions.ask"));
export const S12 = stub("S12", (l) => t(l, "assessment.consent.title"), { brand: true });
export const S13 = stub("S13", (l) => t(l, "assessment.context.title"));
export const S14 = stub("S14", (l) => t(l, "assessment.name"), { brand: true });
export const S14b = stub("S14b", (l) => t(l, "assessment.soundCheck.title"));
export const S16 = stub("S16", (l) => t(l, "assessment.precheck.title"));
export const S17 = stub("S17", questionTitle);
export const S18 = stub("S18", questionTitle);
export const S19 = stub("S19", questionTitle);
export const S20 = stub("S20", questionTitle);
export const S21 = stub("S21", questionTitle);
export const S22 = stub("S22", questionTitle);
export const S23 = stub("S23", questionTitle);
export const S24 = stub("S24", questionTitle);
export const S25 = stub("S25", (l) => t(l, "assessment.warnings.title"));
export const S26 = stub("S26", (l) => t(l, "assessment.helper.askToRead"));
export const S27 = stub("S27", (l) => t(l, "assessment.plan.title"));
export const S28 = stub("S28", testTitle);
export const S29 = stub("S29", testTitle);
export const S30 = stub("S30", (l) => t(l, "assessment.load.kg"));
export const S31 = stub("S31", (l) => t(l, "assessment.primer.title"));
export const S33 = stub("S33", (l) => t(l, "assessment.postpone.title"));
export const S35 = stub("S35", (l) => t(l, "assessment.entry.locked.title"));
