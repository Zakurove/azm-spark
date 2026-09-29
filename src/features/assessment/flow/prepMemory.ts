/**
 * What the arm curl preparation screens hand on within one check (S29 grip, S30 load, S29 practice
 * check), kept on this phone in memory only: the grip answer per arm (it limits the loads), the load
 * chosen per arm, and the arm of the last practice check (the step down names it).
 *
 * The flow machine has no field for these yet (foundationRequests: LOAD_CHOSEN, GRIP_ANSWER and a side
 * on the step down state). The camera screens read the chosen load with `chosenLoad` and send it in the
 * result detail (loadObject, loadKg, loadL) until the machine carries it.
 */
import type { Side } from "../../../movements/types";
import type { FlowModel } from "../flowMachine";
import { loadDetail, type Load } from "./copy";

interface PrepEntry {
  grip: Partial<Record<Side, boolean>>;
  load: Partial<Record<Side, Load>>;
  practiceSide: Side | null;
}

const store = new Map<string, PrepEntry>();

/** One entry per check: the check id, or the guest's visit. */
export function prepKey(m: Pick<FlowModel, "data">): string {
  return m.data.checkId ?? `local:${m.data.config.mode}`;
}

export function prepOf(m: Pick<FlowModel, "data">): PrepEntry {
  const key = prepKey(m);
  let e = store.get(key);
  if (!e) {
    e = { grip: {}, load: {}, practiceSide: null };
    store.set(key, e);
  }
  return e;
}

export function setGrip(m: Pick<FlowModel, "data">, side: Side, yes: boolean): void {
  prepOf(m).grip[side] = yes;
}

export function setLoad(m: Pick<FlowModel, "data">, side: Side, load: Load): void {
  prepOf(m).load[side] = load;
}

export function setPracticeSide(m: Pick<FlowModel, "data">, side: Side): void {
  prepOf(m).practiceSide = side;
}

/** The load chosen for an arm in this check, as result detail fields, or null (arm only, not asked). */
export function chosenLoad(m: Pick<FlowModel, "data">, side: Side): Record<string, string | number> | null {
  const load = store.get(prepKey(m))?.load[side];
  return load ? loadDetail(load) : null;
}

/** Clears everything (a new visitor, tests). */
export function clearPrep(): void {
  store.clear();
}
