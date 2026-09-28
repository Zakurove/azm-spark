/**
 * useCheckFlow (UX spec 5.10): the only owner of the check's flow state.
 *
 * The state machine itself is the pure `flowReducer` of flowMachine.ts (re-exported here); this hook
 * is the thin React side of it:
 *   - it stamps every event with the time (the reducer never reads a clock);
 *   - signed in, it loads GET /api/assessments/context and starts the flow with CONTEXT_LOADED (or
 *     RESUME for an open check); guest, it starts the flow with START and never calls the network
 *     (contract v3 I: no API client call, no outbox);
 *   - it runs the effects the reducer lists: the awaited start call, and every other call through the
 *     ordered outbox (resultQueue.ts), which it retries with a back off, when the page is shown again
 *     and when the connection returns;
 *   - it keeps a resumable snapshot for the camera permission reload (S32), without raw answers once
 *     the protocol is frozen, in sessionStorage only.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createCheckApi, toSignedInContext, toStartResult, type CheckApi } from "./api";
import { clearBoothCode } from "./boothMode";
import {
  flowReducer,
  initialModel,
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
} from "./resultQueue";
import { reportNetwork } from "./shared/useOnline";

export { flowReducer, initialModel } from "./flowMachine";
export type { FlowEvent, FlowModel, FlowState } from "./flowMachine";

export type Dispatch = (event: FlowEvent) => void;

export interface CheckFlowOptions {
  config: FlowConfig;
  device?: DeviceInfo;
  /** The verified booth code of this tab, sent with a signed in booth start (contract G). */
  boothCode?: string | null;
  api?: CheckApi;
  queue?: ResultQueue;
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
    return m;
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

/** An outbox that never sends (the guest flow stores and sends nothing, contract v3 I). */
function guestQueue(): ResultQueue {
  return new ResultQueue({}, memoryStore());
}

/** The outbox of this device (IndexedDB), wired to the online state. */
export function deviceQueue(api: CheckApi = defaultApi()): ResultQueue {
  return new ResultQueue(api, indexedDbStore());
}

function defaultApi(): CheckApi {
  return createCheckApi({
    onNetworkError: () => reportNetwork(false),
    onReachable: () => reportNetwork(true),
  });
}

/**
 * Sends what a signed in check left in the outbox (after the person signs in again, or when the app
 * opens signed in). Never called for guests.
 */
export async function flushPendingCheckCalls(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await deviceQueue().flush();
}

export function useCheckFlow(opts: CheckFlowOptions) {
  const { config } = opts;
  const signedIn = config.mode === "signedIn";
  const api = useMemo(() => opts.api ?? defaultApi(), [opts.api]);
  const queue = useMemo(
    () => opts.queue ?? (signedIn ? deviceQueue(api) : guestQueue()),
    [opts.queue, api, signedIn],
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
      if (opts.resume) dispatch({ type: "RESUME", context, check: opts.resume });
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

  // Effects: each runs once, then leaves the list.
  useEffect(() => {
    for (const effect of model.effects) {
      if (started.current.has(effect.id)) continue;
      started.current.add(effect.id);
      void runEffect(effect).finally(() => dispatch({ type: "EFFECT_DONE", id: effect.id }));
    }
  }, [model.effects]);

  async function runEffect(effect: FlowEffect): Promise<void> {
    const setting = modelRef.current.data.setting;
    const device = modelRef.current.data.device;
    const code = setting === "booth" ? (opts.boothCode ?? undefined) : undefined;
    switch (effect.type) {
      case "start": {
        const r = await api.startCheck({
          answers: effect.answers,
          device,
          setting: effect.setting,
          boothCode: code,
        });
        dispatch({ type: "START_RESULT", result: toStartResult(r) });
        return;
      }
      case "startBackground":
        await queue.enqueue({
          type: "startBackground",
          answers: effect.answers,
          device,
          setting: effect.setting,
          ...(code ? { boothCode: code } : {}),
        });
        break;
      case "stop":
        await queue.enqueue({ type: "stop", checkId: effect.checkId, option: effect.option });
        break;
      case "between":
        await queue.enqueue({
          type: "between",
          checkId: effect.checkId,
          testId: effect.testId,
          side: effect.side,
          answer: effect.answer,
        });
        break;
      case "result":
        await queue.enqueue({ type: "result", checkId: effect.checkId, body: effect.body });
        break;
      case "complete":
        await queue.enqueue({ type: "complete", checkId: effect.checkId });
        break;
      case "clearBoothCode":
        clearBoothCode();
        return;
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

  return { model, dispatch, api, queue, status, retryCamera };
}
