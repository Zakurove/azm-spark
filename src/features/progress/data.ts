/**
 * Loading the check data of the Today slot (S01, S03) and My results (S53): the context
 * (GET /api/assessments/context), the progress (GET /api/progress) and the list of checks
 * (GET /api/assessments), in parallel. Each part keeps its own outcome, so the next check card still
 * renders from the context when the progress fails (S53 Er).
 *
 * Offline (UX spec 0.7): a page that has loaded keeps what it shows and says when it was loaded
 * (state.offline.lastLoaded). Across pages of the same session the last loaded copy is kept in memory
 * only, and only for the account that loaded it (`owner`, the user id): a copy is never shown to
 * another person signed in later on the same phone, and nothing is written to storage.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createCheckApi,
  type ApiResult,
  type CheckApi,
  type ContextResponse,
  type ProgressResponse,
  type StoredCheck,
} from "../assessment/api";
import { reportNetwork, useOnline } from "../assessment/shared/useOnline";

export type Part<T> =
  | { status: "loading" }
  | { status: "ok"; value: T }
  /** The server answered with an error (code is its { error: CODE }). */
  | { status: "error"; code: string }
  /** No connection: nothing was sent, or the request failed on the network. */
  | { status: "offline" };

export interface CheckData {
  context: Part<ContextResponse>;
  progress: Part<ProgressResponse>;
  checks: Part<StoredCheck[]>;
  /** When the values shown were loaded (epoch ms), or null before any loaded. */
  loadedAt: number | null;
  /** The values shown come from an earlier load (offline). */
  stale: boolean;
}

let sharedApi: CheckApi | null = null;
/** The check API of the progress pages, reporting network state to the offline banner (0.7). */
export function progressApi(): CheckApi {
  sharedApi ??= createCheckApi({
    onNetworkError: () => reportNetwork(false),
    onReachable: () => reportNetwork(true),
  });
  return sharedApi;
}

/** The last loaded copy per account, in memory for this session only. */
const CACHE = new Map<
  string,
  { context?: ContextResponse; progress?: ProgressResponse; checks?: StoredCheck[]; at: number }
>();

/** Forgets every kept copy (tests; a sign out keeps other accounts' copies unreachable anyway). */
export function clearProgressCache(): void {
  CACHE.clear();
}

export function partOf<T>(r: ApiResult<T>): Part<T> {
  if (r.ok) return { status: "ok", value: r.value };
  if (r.error.kind === "http") return { status: "error", code: r.error.code };
  return { status: "offline" };
}

const LOADING: CheckData = {
  context: { status: "loading" },
  progress: { status: "loading" },
  checks: { status: "loading" },
  loadedAt: null,
  stale: false,
};

/**
 * Merges a fresh load with the account's kept copy: a part that could not be loaded for lack of a
 * connection shows the kept value, marked stale.
 */
export function withCache(
  fresh: Pick<CheckData, "context" | "progress" | "checks">,
  kept:
    | { context?: ContextResponse; progress?: ProgressResponse; checks?: StoredCheck[]; at: number }
    | undefined,
  now: number,
): CheckData {
  let stale = false;
  const pick = <T>(p: Part<T>, value: T | undefined): Part<T> => {
    if (p.status === "offline" && value !== undefined) {
      stale = true;
      return { status: "ok", value };
    }
    return p;
  };
  const context = pick(fresh.context, kept?.context);
  const progress = pick(fresh.progress, kept?.progress);
  const checks = pick(fresh.checks, kept?.checks);
  const anyFresh = [fresh.context, fresh.progress, fresh.checks].some((p) => p.status === "ok");
  return {
    context,
    progress,
    checks,
    loadedAt: stale ? (kept?.at ?? null) : anyFresh ? now : null,
    stale,
  };
}

/**
 * The check data for a page. `parts` chooses what to load (Today needs all three, the offer after the
 * intake only the context). Loads again when the connection comes back after an offline load.
 */
export function useCheckData(owner?: string, api: CheckApi = progressApi()) {
  const [data, setData] = useState<CheckData>(LOADING);
  const { online } = useOnline();
  const active = useRef(true);
  const load = useCallback(async () => {
    setData((d) => (d.loadedAt === null ? LOADING : d));
    const [context, progress, checks] = await Promise.all([
      api.getContext().then(partOf),
      api.getProgress().then(partOf),
      api.listChecks().then((r) => partOf(r.ok ? { ok: true, value: r.value.assessments } : r)),
    ]);
    if (!active.current) return;
    const now = Date.now();
    const kept = owner ? CACHE.get(owner) : undefined;
    const next = withCache({ context, progress, checks }, kept, now);
    if (owner && !next.stale && next.loadedAt !== null) {
      CACHE.set(owner, {
        ...(context.status === "ok" ? { context: context.value } : {}),
        ...(progress.status === "ok" ? { progress: progress.value } : {}),
        ...(checks.status === "ok" ? { checks: checks.value } : {}),
        at: now,
      });
    }
    // A page that already shows loaded values keeps them when a reload finds no connection.
    setData((prev) => {
      if (
        prev.loadedAt !== null &&
        next.loadedAt === null &&
        [context, progress, checks].every((p) => p.status === "offline")
      )
        return { ...prev, stale: true };
      return next;
    });
  }, [api, owner]);

  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
    };
  }, [load]);

  // Back online after an offline load: load again (0.7).
  const offlineLoad =
    data.context.status === "offline" ||
    data.progress.status === "offline" ||
    data.checks.status === "offline" ||
    data.stale;
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current && offlineLoad) void load();
    wasOnline.current = online;
  }, [online, offlineLoad, load]);

  return { data, reload: load, online };
}
