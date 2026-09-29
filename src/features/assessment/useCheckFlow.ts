/**
 * useCheckFlow (UX spec 5.10): the only owner of the check's flow state.
 *
 * The state machine itself is the pure `flowReducer` of flowMachine.ts (re-exported here); this hook
 * is the thin React side of it:
 *   - it stamps every event with the time (the reducer never reads a clock);
 *   - signed in, it loads GET /api/assessments/context and starts the flow with CONTEXT_LOADED (or
 *     RESUME for an open check); guest, it starts the flow with START and never calls the network
 *     (contract v3 I: no API client call, no outbox);
 *   - it runs the effects the reducer lists: the awaited start and resume calls (a booth start first
 *     gets its one check booth token, O17), the form of the end question (GET /:id/end), and every
 *     other call through the ordered outbox (resultQueue.ts), which it retries with a back off, when
 *     the page is shown again and when the connection returns;
 *   - it remembers on the device the checks that had a safety screen or an alarm, which are never
 *     resumed (O6 (1));
 *   - it keeps a resumable snapshot for the camera permission reload (S32), without raw answers once
 *     the protocol is frozen, in sessionStorage only.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createCheckApi, toResumeResult, toSignedInContext, toStartResult, type CheckApi } from "./api";
import { boothStartToken, clearBoothPass } from "./boothMode";
import {
  flowReducer,
  initialModel,
  restoredModel,
  type DeviceInfo,
  type FlowConfig,
  type FlowEffect,
  type FlowEvent,
  type FlowModel,
  type ResumeCheck,
} from "./flowMachine";
import {
  indexedDbStore,
  memoryStore,
  ResultQueue,
  retryDelaySec,
  type QueueStatus,
  type QueuedCall,
  type NewCall,
} from "./resultQueue";
import { reportNetwork } from "./shared/useOnline";

export { flowReducer, initialModel } from "./flowMachine";
export type { FlowEvent, FlowModel, FlowState } from "./flowMachine";

export type Dispatch = (event: FlowEvent) => void;

export interface CheckFlowOptions {
  config: FlowConfig;
  device?: DeviceInfo;
  /**
   * The one check booth token of a signed in booth start (O17): the visitor's token, or a new one from
   * the staff session (boothMode.ts). Replaceable in tests.
   */
  boothToken?: () => Promise<string | null>;
  api?: CheckApi;
  queue?: ResultQueue;
  /** The signed in account (its user id): the outbox sends only its calls. */
  owner?: string;
  /** Online state from useOnline: the outbox is flushed when it turns true. */
  online?: boolean;
  /** An open check to continue (S01 resume): sent with the context instead of starting anew. */
  resume?: ResumeCheck | null;
}

const SNAPSHOT_KEY = "azm.check.snapshot";

/** What survives a reload: no effects, and no raw answers once the protocol is frozen. */
export function snapshotOf(m: FlowModel): FlowModel {
  const frozen = m.data.protocol.length > 0;
  return { ...m, effects: [], overlay: null, data: { ...m.data, answers: frozen ? {} : m.data.answers } };
}

export function saveSnapshot(m: FlowModel): void {
  try {
    sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshotOf(m)));
  } catch {
    /* no storage: the check starts again after the reload */
  }
}

/** Whether a reload snapshot of this mode waits (App reopens the signed in check after S32's reload). */
export function hasSnapshot(mode: FlowConfig["mode"]): boolean {
  try {
    const raw = sessionStorage.getItem(SNAPSHOT_KEY);
    return !!raw && (JSON.parse(raw) as FlowModel)?.data?.config?.mode === mode;
  } catch {
    return false;
  }
}

/**
 * Reads the snapshot without removing it; only a snapshot of the same mode and booth state is used.
 * Read only, because React (StrictMode in development) may run the reducer initializer twice and keep
 * the second result: both reads must see it. The hook removes it once mounted (clearSnapshot).
 */
export function takeSnapshot(config: FlowConfig): FlowModel | null {
  try {
    const raw = sessionStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as FlowModel;
    if (m?.data?.config?.mode !== config.mode || m.data.config.booth !== config.booth) return null;
    if (typeof m.state?.kind !== "string") return null;
    // Fields added after the snapshot was saved get their empty values.
    return restoredModel(m);
  } catch {
    return null;
  }
}

export function clearSnapshot(): void {
  try {
    sessionStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    /* nothing kept */
  }
}

/* ------------------------------------------------------------------ no resume (O6 (1)) */

const NO_RESUME_KEY = "azm.check.noResume";
const NO_RESUME_KEEP = 20;

function noResumeIds(): string[] | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(NO_RESUME_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return null;
  }
}

/**
 * Remembers on this device that a check had a safety screen (S36 to S40) or an alarm (S45): it is
 * never resumed (O6 (1)). The server keeps no such record for a person (Q25 (d)).
 */
export function markNoResume(checkId: string): void {
  try {
    const ids = noResumeIds() ?? [];
    if (ids.includes(checkId)) return;
    localStorage.setItem(NO_RESUME_KEY, JSON.stringify([...ids, checkId].slice(-NO_RESUME_KEEP)));
  } catch {
    /* no storage: resumeAllowed then refuses every resume */
  }
}

/**
 * Whether an open check may be offered to continue (S01 resume, O6 (1)): never after a safety screen or
 * an alarm on this device. Without storage no resume is offered (the check closes after 30 minutes
 * and a new one starts), the safer side.
 */
// SPEC-GAP: resume-after-alarm-device. The record lives on the device that ran the check; another
// device of the same person cannot know of an alarm and may offer the resume within the 30 minutes.
export function resumeAllowed(checkId: string): boolean {
  const ids = noResumeIds();
  return ids !== null && !ids.includes(checkId);
}

/** An outbox that never sends (the guest flow stores and sends nothing, contract v3 I). */
function guestQueue(): ResultQueue {
  return new ResultQueue({}, memoryStore());
}

/**
 * The outbox of this device (IndexedDB), wired to the online state, for the signed in account
 * `owner` (its user id): it sends only that account's calls.
 */
export function deviceQueue(api: CheckApi = defaultApi(), owner?: string): ResultQueue {
  return new ResultQueue(api, indexedDbStore(), owner);
}

function defaultApi(): CheckApi {
  return createCheckApi({
    onNetworkError: () => reportNetwork(false),
    onReachable: () => reportNetwork(true),
  });
}

/**
 * Sends what a signed in check of this account (`owner`, the user id) left in the outbox: after the
 * person signs in again, when the app opens signed in, and before signing out. Another account's calls
 * stay unsent. Never called for guests.
 */
export async function flushPendingCheckCalls(owner: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await deviceQueue(defaultApi(), owner).flush();
}

/**
 * The next day answer (S03) given while the phone could not reach the server: it waits in this
 * account's outbox (it survives a reload) and is sent when the connection returns, when the app opens
 * signed in again, or before signing out.
 */
export async function queueNextDayAnswer(
  owner: string,
  answer: "usual" | "settled" | "lasting",
): Promise<void> {
  const queue = deviceQueue(defaultApi(), owner);
  await queue.enqueue({ type: "after", answer });
  if (typeof window === "undefined") return;
  const retry = () => {
    window.removeEventListener("online", retry);
    void queue.flush();
  };
  window.addEventListener("online", retry);
}

/**
 * The outbox call of a background effect, or null for an effect sent some other way. The adult
 * confirmation is never queued: it is sent at once with the session of the person who gave it (the
 * start needs it anyway, and a refused start asks again, 403 ADULT_REQUIRED), so it can never reach
 * another account signed in later on the same phone.
 */
export function queuedCallOf(effect: FlowEffect): NewCall | null {
  switch (effect.type) {
    case "resumeBackground":
      return { type: "resumeBackground", checkId: effect.checkId, answers: effect.answers };
    case "stop":
      return { type: "stop", checkId: effect.checkId, option: effect.option, ref: effect.ref };
    case "end":
      return { type: "end", checkId: effect.checkId, answer: effect.answer };
    case "faint":
      return { type: "faint", checkId: effect.checkId, body: effect.body };
    case "alarm":
      return { type: "alarm", checkId: effect.checkId, body: effect.body };
    case "between":
      return {
        type: "between",
        checkId: effect.checkId,
        testId: effect.testId,
        side: effect.side,
        answer: effect.answer,
      };
    case "result":
      return { type: "result", checkId: effect.checkId, body: effect.body };
    case "complete":
      return { type: "complete", checkId: effect.checkId };
    default:
      return null;
  }
}

export function useCheckFlow(opts: CheckFlowOptions) {
  const { config } = opts;
  const signedIn = config.mode === "signedIn";
  const api = useMemo(() => opts.api ?? defaultApi(), [opts.api]);
  const queue = useMemo(
    () => opts.queue ?? (signedIn ? deviceQueue(api, opts.owner) : guestQueue()),
    [opts.queue, api, signedIn, opts.owner],
  );
  const [model, rawDispatch] = useReducer(
    flowReducer,
    undefined,
    () => takeSnapshot(config) ?? initialModel(config, opts.device),
  );
  const dispatch = useCallback<Dispatch>((e) => rawDispatch({ now: Date.now(), ...e }), []);
  const started = useRef<Set<number>>(new Set());
  const modelRef = useRef(model);
  modelRef.current = model;
  const [status, setStatus] = useState<QueueStatus>({ waiting: 0, auth: false });

  // The reload snapshot is used once: removed after the first mount has read it.
  useEffect(() => clearSnapshot(), []);

  // Entry: signed in loads the context, guest starts at once (a restored snapshot needs neither).
  const entryError = model.state.kind === "entry" ? model.state.error : undefined;
  useEffect(() => {
    if (model.state.kind !== "entry" || entryError) return;
    if (config.mode === "guest") {
      dispatch({ type: "START" });
      return;
    }
    let active = true;
    void api.getContext(config.booth ? "booth" : "home").then((r) => {
      if (!active) return;
      if (!r.ok) return dispatch({ type: "CONTEXT_FAILED" });
      const context = toSignedInContext(r.value);
      // O6 (1): only the check the server still names as open, and never one that had a safety
      // screen or an alarm; otherwise a new check starts (its start closes the old one).
      const check = opts.resume;
      if (check && context.openCheck?.id === check.id && resumeAllowed(check.id))
        dispatch({ type: "RESUME", context, check });
      else dispatch({ type: "CONTEXT_LOADED", context });
    });
    return () => {
      active = false;
    };
  }, [model.state.kind, entryError]);

  // The outbox: its status for the screens, and the background start's answer (a stricter screen).
  useEffect(() => queue.onChange(setStatus), [queue]);
  useEffect(
    () =>
      queue.onSent((call: QueuedCall, r) => {
        if (call.type !== "startBackground") return;
        // The phone already shows the safety or postpone screen. If the server answers with a stricter
        // one, that one is shown (map 2.2).
        const s = toStartResult(r as Parameters<typeof toStartResult>[0]);
        if (!s.ok && s.code === "POSTPONE" && s.screen && (s.status === "emergency" || s.status === "ad")) {
          if (modelRef.current.state.kind !== "safety")
            dispatch({ type: "SAFETY", screen: s.screen, alsoShow: s.alsoShow });
        }
      }),
    [queue],
  );

  // Retries while calls wait: a back off timer (5, 15, 30, then every 60 s), and whenever the page is
  // shown again. A flush that sends anything resets the back off.
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = useCallback(async () => {
    if (!signedIn) return;
    clearTimeout(timer.current);
    const report = await queue.flush();
    if (report.sent > 0 || report.waiting === 0) attempt.current = 0;
    if (report.waiting > 0 && !report.auth) {
      timer.current = setTimeout(() => void flush(), retryDelaySec(attempt.current) * 1000);
      attempt.current += 1;
    }
  }, [queue, signedIn]);
  useEffect(() => {
    if (!signedIn) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void flush();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(timer.current);
    };
  }, [flush, signedIn]);

  // A check with a safety screen or an alarm is never resumed (O6 (1)).
  const checkId = model.data.checkId;
  const safetyShown = model.state.kind === "safety" || model.overlay?.kind === "alarm";
  useEffect(() => {
    if (signedIn && checkId && safetyShown) markNoResume(checkId);
  }, [signedIn, checkId, safetyShown]);

  // Effects: each runs once, then leaves the list.
  useEffect(() => {
    for (const effect of model.effects) {
      if (started.current.has(effect.id)) continue;
      started.current.add(effect.id);
      void runEffect(effect).finally(() => dispatch({ type: "EFFECT_DONE", id: effect.id }));
    }
  }, [model.effects]);

  /** The one check booth token of a booth start (O17), or nothing at home. */
  async function tokenFor(setting: string): Promise<{ boothToken?: string }> {
    if (setting !== "booth") return {};
    const token = await (opts.boothToken ?? (() => boothStartToken(api)))();
    return token ? { boothToken: token } : {};
  }

  async function runEffect(effect: FlowEffect): Promise<void> {
    const device = modelRef.current.data.device;
    switch (effect.type) {
      case "start": {
        const r = await api.startCheck({
          answers: effect.answers,
          device,
          setting: effect.setting,
          ...(await tokenFor(effect.setting)),
          ...(effect.session ? { session: effect.session } : {}),
        });
        dispatch({ type: "START_RESULT", result: toStartResult(r) });
        return;
      }
      case "resume": {
        const r = await api.resume(effect.checkId, effect.answers);
        dispatch({ type: "RESUME_RESULT", result: toResumeResult(r) });
        return;
      }
      case "endForm": {
        // The general form stays when the server cannot be asked (offline): the question is asked.
        const r = await api.getEnd(effect.checkId);
        if (r.ok && modelRef.current.state.kind === "endQuestion")
          dispatch({ type: "END_FORM", side: r.value.side, chronicNote: r.value.chronicNote });
        return;
      }
      case "startBackground":
        await queue.enqueue({
          type: "startBackground",
          answers: effect.answers,
          device,
          setting: effect.setting,
          ...(await tokenFor(effect.setting)),
          ...(effect.session ? { session: effect.session } : {}),
        });
        break;
      case "adult":
        // Sent at once, never queued (queuedCallOf).
        await api.confirmAdult();
        return;
      case "clearBoothPass":
        clearBoothPass();
        return;
      default: {
        if (effect.type === "alarm") markNoResume(effect.checkId);
        const call = queuedCallOf(effect);
        if (call) await queue.enqueue(call);
      }
    }
    await flush();
  }

  // Back online, and on mount: send what waits in the outbox.
  useEffect(() => {
    if (opts.online) void flush();
  }, [opts.online, flush]);

  /** S32 Try again: keep the flow, reload so iOS asks for the camera again (map 2.9). */
  const retryCamera = useCallback(() => {
    const next = flowReducer(modelRef.current, { type: "RETRY", now: Date.now() });
    saveSnapshot(next);
    location.reload();
  }, []);

  /** The save error's Try again (S50 to S52): send what waits in the outbox now. */
  const retrySave = useCallback(() => void flush(), [flush]);

  return { model, dispatch, api, queue, status, retryCamera, retrySave };
}
