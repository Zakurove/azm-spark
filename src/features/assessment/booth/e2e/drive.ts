/**
 * E2E only (VITE_E2E builds, contract v3 K): drives the real flow reducer through the guest booth
 * check to the staff vitals question (S56), the way a visitor answers it: standing, no support, no
 * condition, not sure of clearance, no pain, no restriction, then plain answers to every pre-check
 * question (no red flag, pain 0). The Playwright specs open the real check there with the reload
 * snapshot (useCheckFlow), so S56 is tested inside CheckApp and the flow decides what follows.
 */
import { flowReducer, initialModel, questionOf, type FlowEvent, type FlowModel } from "../../flowMachine";
import type { AnswerValue } from "../../../../medical/precheck";

/** A plain answer that goes ahead: no to the red flags, 0 pain, the first option. */
function plainAnswer(id: string): AnswerValue {
  const q = questionOf(id);
  if (!q) return "no";
  if (q.item.id === "pc_stand_no_hands") return "yes";
  if (q.part === "areas") return [];
  switch (q.item.type) {
    case "scale_0_10":
      return 0;
    case "area_scale_0_10":
      return {};
    case "list_confirm":
      return "done";
    case "single":
      return String(q.item.options?.[0]?.value ?? "no");
    default:
      return "no";
  }
}

/** The guest booth model at pc_booth_vitals, or null when the flow never asks it (a data change). */
export function guestAtVitals(now = Date.now()): FlowModel | null {
  let m = initialModel({ mode: "guest", booth: true, homeOpen: false, desktop: false });
  const go = (e: FlowEvent) => (m = flowReducer(m, { now, ...e }));
  go({ type: "START" });
  go({ type: "GUEST_PATH", path: "full" });
  go({ type: "ADULT_YES" });
  go({ type: "GUEST_ANSWER", step: 1, value: "standing" });
  go({ type: "GUEST_ANSWER", step: 2, value: "none" });
  go({ type: "GUEST_ANSWER", step: 3, value: ["none"] });
  go({ type: "GUEST_NEXT" });
  go({ type: "GUEST_ANSWER", step: 4, value: "unsure" });
  go({ type: "GUEST_ANSWER", step: 5, value: ["none"] });
  go({ type: "GUEST_NEXT" });
  go({ type: "GUEST_ANSWER", step: 6, value: ["none"] });
  go({ type: "GUEST_NEXT" });
  if (m.state.kind === "intro") go({ type: "CONTINUE" });
  if (m.state.kind === "soundCheck") go({ type: "SOUND_RESULT", mode: "voice" });
  if (m.state.kind === "precheckNotice") go({ type: "PRECHECK_START" });
  for (let k = 0; k < 80 && m.state.kind === "question"; k++) {
    const id = m.state.id;
    if (id === "pc_booth_vitals") return m;
    go({ type: "ANSWER", id, value: plainAnswer(id) });
  }
  return null;
}
