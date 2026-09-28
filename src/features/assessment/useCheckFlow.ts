/**
 * useCheckFlow (UX spec 5.10): the only owner of the check's flow state.
 *
 * The state machine itself is the pure `flowReducer` of flowMachine.ts (re-exported here); this hook
 * is the thin React side of it:
 *   - it stamps every event with the time (the reducer never reads a clock);
 *   - signed in, it loads GET /api/assessments/context and starts the flow with CONTEXT_LOADED;
 *     guest, it starts the flow with START and never calls the network (contract v3 I);
 *   - it runs the effects the reducer lists: the awaited start call, the background safety posts
 *     (never queued), and the results and completion through the ResultQueue;
 *   - it keeps a resumable snapshot for the camera permission reload (S32), without raw answers once
 *     the protocol is frozen, in sessionStorage only.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { createCheckApi, toSignedInContext, toStartResult, type CheckApi } from "./api";
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
import { indexedDbStore, ResultQueue } from "./resultQueue";
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
  /** Online state from useOnline: the queue is flushed when it turns true. */
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

/** Reads and removes the snapshot; only a snapshot of the same mode and booth state is used. */
export function takeSnapshot(config: FlowConfig): FlowModel | null {
  try {
    const raw = sessionStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SNAPSHOT_KEY);
    const m = JSON.parse(raw) as FlowModel;
    if (m?.data?.config?.mode !== config.mode || m.data.config.booth !== config.booth) return null;
    if (typeof m.state?.kind !== "string") return null;
    return m;
  } catch {
    return null;
  }
}

export function useCheckFlow(opts: CheckFlowOptions) {
  const { config } = opts;
  const api = useMemo(
    () =>
      opts.api ??
      createCheckApi({ onNetworkError: () => reportNetwork(false), onReachable: () => reportNetwork(true) }),
    [opts.api],
  );
  const queue = useMemo(() => opts.queue ?? new ResultQueue(api, indexedDbStore()), [opts.queue, api]);
  const [model, rawDispatch] = useReducer(
    flowReducer,
    undefined,
    () => takeSnapshot(config) ?? initialModel(config, opts.device),
  );
  const dispatch = useCallback<Dispatch>((e) => rawDispatch({ now: Date.now(), ...e }), []);
  const started = useRef<Set<number>>(new Set());
  const modelRef = useRef(model);
  modelRef.current = model;

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
      case "startBackground": {
        // The phone already shows the safety or postpone screen. The server sets the lock and counts
        // the event; if it answers with a stricter screen, that one is shown (map 2.2).
        const r = await api.startCheck({
          answers: effect.answers,
          device,
          setting: effect.setting,
          boothCode: code,
        });
        const s = toStartResult(r);
        const shown = modelRef.current.state;
        if (!s.ok && s.code === "POSTPONE" && s.screen && (s.status === "emergency" || s.status === "ad")) {
          if (shown.kind !== "safety") dispatch({ type: "SAFETY", screen: s.screen, alsoShow: s.alsoShow });
        }
        return;
      }
      case "stop":
        await api.postStop(effect.checkId, effect.option);
        return;
      case "between":
        await api.postBetween(effect.checkId, effect.testId, effect.side, effect.answer);
        return;
      case "result":
        await queue.enqueue({ type: "result", checkId: effect.checkId, body: effect.body });
        await queue.flush();
        return;
      case "complete":
        await queue.enqueue({ type: "complete", checkId: effect.checkId });
        await queue.flush();
        return;
    }
  }

  // Back online: send what waits in the queue.
  useEffect(() => {
    if (opts.online) void queue.flush();
  }, [opts.online, queue]);

  /** S32 Try again: keep the flow, reload so iOS asks for the camera again (map 2.9). */
  const retryCamera = useCallback(() => {
    const next = flowReducer(modelRef.current, { type: "RETRY", now: Date.now() });
    saveSnapshot(next);
    location.reload();
  }, []);

  return { model, dispatch, api, queue, retryCamera };
}
