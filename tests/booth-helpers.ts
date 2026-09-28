/**
 * Helpers of the booth stream's tests: the guest booth flow driven with the real reducer to a
 * pre-check question, with plain answers that neither postpone nor route to a safety screen, and a
 * sessionStorage for the node test environment.
 */
import {
  flowReducer,
  initialModel,
  questionOf,
  type FlowEvent,
  type FlowModel,
} from "../src/features/assessment/flowMachine";
import type { AnswerValue } from "../src/medical/precheck";

/** A booth day in the morning (booth dates 11 to 13 October 2026). */
export const NOW = Date.UTC(2026, 9, 11, 7);

export function step(m: FlowModel, e: FlowEvent): FlowModel {
  return flowReducer(m, { now: NOW, ...e });
}

export interface GuestPersona {
  position?: "chair" | "wheelchair" | "standing" | "bed";
  support?: "none" | "left" | "right";
  conditions?: string[];
  clearance?: "yes" | "no" | "unsure";
  pain?: string[];
  restrictions?: string[];
  path?: "quick" | "full";
}

/** The guest flow through S05 to S11 (booth mode, a phone): the state after the guest steps. */
export function guestAfterSteps(p: GuestPersona = {}): FlowModel {
  let m = initialModel({ mode: "guest", booth: true, homeOpen: false, desktop: false });
  const go = (e: FlowEvent) => (m = step(m, e));
  go({ type: "START" });
  go({ type: "GUEST_PATH", path: p.path ?? "full" });
  go({ type: "ADULT_YES" });
  go({ type: "GUEST_ANSWER", step: 1, value: p.position ?? "standing" });
  go({ type: "GUEST_ANSWER", step: 2, value: p.support ?? "none" });
  go({ type: "GUEST_ANSWER", step: 3, value: p.conditions?.length ? p.conditions : ["none"] });
  go({ type: "GUEST_NEXT" });
  go({ type: "GUEST_ANSWER", step: 4, value: p.clearance ?? "unsure" });
  go({ type: "GUEST_ANSWER", step: 5, value: p.pain?.length ? p.pain : ["none"] });
  go({ type: "GUEST_NEXT" });
  go({ type: "GUEST_ANSWER", step: 6, value: p.restrictions?.length ? p.restrictions : ["none"] });
  go({ type: "GUEST_NEXT" });
  return m;
}

/** A plain answer that goes ahead: no to the red flags, 0 pain, the first option. */
export function plainAnswer(id: string): AnswerValue {
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

/**
 * From the guest steps through the intro, the sound check and the notice, answering every question
 * plainly until `stop` holds for the question now asked (or the pre-check ends). Returns the model and
 * the question ids seen.
 */
export function precheckUntil(
  m0: FlowModel,
  stop: (id: string) => boolean = () => false,
): { model: FlowModel; seen: string[] } {
  let m = m0;
  if (m.state.kind === "intro") m = step(m, { type: "CONTINUE" });
  if (m.state.kind === "soundCheck") m = step(m, { type: "SOUND_RESULT", mode: "voice" });
  if (m.state.kind === "precheckNotice") m = step(m, { type: "PRECHECK_START" });
  const seen: string[] = [];
  for (let k = 0; k < 80 && m.state.kind === "question"; k++) {
    const id = m.state.id;
    seen.push(id);
    if (stop(id)) break;
    m = step(m, { type: "ANSWER", id, value: plainAnswer(id) });
  }
  return { model: m, seen };
}

/** A sessionStorage for node tests. */
export function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}
