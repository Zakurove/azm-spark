/**
 * The outbox of a started signed in check (UX spec 0.7 and 5.10 `resultQueue`): every call the flow
 * sends in the background waits here, in the order it happened, until the server has it.
 *
 *   result            a test side's result or skip (derived numbers only)
 *   stop              a stop list answer with the test side it stopped (the server writes that
 *                     side's skip row, sets the lock, ends the check, counts it)
 *   between           the pain question between tests (bt_pain_after)
 *   end               the end of check question (ec_symptoms, Q23 (7)); a yes closes the check
 *   faint             the faint follow up after a faint or fall stop (sf_faint_loc, Q33 (3))
 *   adult             the adult confirmation of the account (S05a, Q32 (6))
 *   after             the next day question on Today (S03, ac_next_day), answered offline
 *   complete          the end of the check
 *   startBackground   the start call of a pre-check the phone already postponed or routed to a
 *                     safety screen (the server confirms it and sets the lock)
 *   resumeBackground  the resume call (O6) of a re-ask the phone already postponed or routed to a
 *                     safety screen (the server closes the check as ended early and sets the lock)
 *
 * The screen never waits for any of them: the phone has already decided and shown it with the same
 * pure rules (stopRoute, betweenTests, evaluatePrecheck). Calls go out one at a time, oldest first:
 * a result that happened before a stop reaches the server before the stop that ends the check, which
 * refuses later results. A call leaves the outbox when the server accepts it, or refuses it for good
 * (so one bad entry never blocks the rest). A network error, a slow or busy server, or an ended
 * session (401) keeps it, and the hook retries on a back off timer, when the page is shown again, when
 * the connection returns and after the person signs in again.
 *
 * Storage: never video. Results, stops, pain answers, the end and faint answers, the adult
 * confirmation and completions are kept in IndexedDB so they survive a reload (`indexedDbStore`); the
 * background start and resume carry raw pre-check answers, which are never written to storage, so
 * they wait in memory only for the life of the page (spec 5.10).
 *
 * Owner: every call carries the account that made it (`owner`, the user id), and a queue sends only
 * its own account's calls, so a call left by one person is never sent with the session of another
 * person signed in on the same phone (signed in visitors share the staff phone at the booth, O17). A
 * call waits for its own account to sign in again, for two days at most (MAX_AGE_MS): the server
 * takes no answer for a check closed longer ago.
 * Memory in tests and wherever IndexedDB is missing (`memoryStore`).
 */
import type { Answers, TestSide } from "../../medical/precheck";
import type { Setting, StopOptionId, TestId } from "../../movements/types";
import type { ApiResult, CheckApi, FaintBody, TestRef } from "./api";
import type { BetweenAnswer, CheckSession, DeviceInfo, ResultPayload } from "./flowMachine";

export type QueuedCall =
  | { seq: number; type: "result"; checkId: string; body: ResultPayload }
  | { seq: number; type: "complete"; checkId: string }
  | { seq: number; type: "stop"; checkId: string; option: StopOptionId; ref?: TestRef | null }
  | { seq: number; type: "between"; checkId: string; testId: TestId; side: TestSide; answer: BetweenAnswer }
  | { seq: number; type: "end"; checkId: string; answer: "yes" | "no" }
  | { seq: number; type: "faint"; checkId: string; body: FaintBody }
  | { seq: number; type: "adult" }
  | { seq: number; type: "after"; answer: "usual" | "settled" | "lasting" }
  | {
      seq: number;
      type: "startBackground";
      answers: Answers;
      device: DeviceInfo;
      setting: Setting;
      boothToken?: string;
      session?: CheckSession;
      testsOff?: TestId[];
    }
  | { seq: number; type: "resumeBackground"; checkId: string; answers: Answers };

/** The account and the time of a stored call (added by the queue). */
interface Stamp {
  /** The user id of the account that made the call; none in a queue that knows no account. */
  owner?: string;
  /** When it was queued (epoch ms). */
  at?: number;
}

export type NewCall = QueuedCall extends infer C ? (C extends QueuedCall ? Omit<C, "seq"> : never) : never;

/** Calls older than this are dropped unsent: the server no longer takes them (SAFETY_LATE_MS). */
export const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

/** Calls that may be written to storage; the background start and resume (raw answers) never are. */
const DURABLE: readonly QueuedCall["type"][] = [
  "result",
  "complete",
  "stop",
  "between",
  "end",
  "faint",
  "adult",
  "after",
];

export interface QueueStore {
  all(): Promise<QueuedCall[]>;
  put(call: QueuedCall): Promise<void>;
  remove(seq: number): Promise<void>;
}

export function memoryStore(): QueueStore {
  const items = new Map<number, QueuedCall>();
  return {
    all: async () => [...items.values()].sort((a, b) => a.seq - b.seq),
    put: async (c) => void items.set(c.seq, c),
    remove: async (seq) => void items.delete(seq),
  };
}

const DB_NAME = "azm-check";
const STORE = "queue";

/** IndexedDB store; falls back to memory when IndexedDB cannot open (private windows, tests). */
export function indexedDbStore(): QueueStore {
  if (typeof indexedDB === "undefined") return memoryStore();
  let fallback: QueueStore | null = null;
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "seq" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  // Function declarations, not generic arrows: the copy scan parses every file as TSX.
  async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }
  async function guard<T>(fn: () => Promise<T>, alt: (s: QueueStore) => Promise<T>): Promise<T> {
    if (fallback) return alt(fallback);
    try {
      return await fn();
    } catch {
      fallback = memoryStore();
      return alt(fallback);
    }
  }
  return {
    all: () =>
      guard(
        async () =>
          ((await run("readonly", (s) => s.getAll())) as QueuedCall[]).sort((a, b) => a.seq - b.seq),
        (s) => s.all(),
      ),
    put: (c) =>
      guard(
        async () => void (await run("readwrite", (s) => s.put(c))),
        (s) => s.put(c),
      ),
    remove: (seq) =>
      guard(
        async () => void (await run("readwrite", (s) => s.delete(seq))),
        (s) => s.remove(seq),
      ),
  };
}

export interface FlushReport {
  sent: number;
  dropped: number;
  waiting: number;
  /** The session ended (401): the calls wait for the person to sign in again. */
  auth: boolean;
}

/** What the outbox shows: calls waiting ("Not saved yet") and whether sign in is needed. */
export interface QueueStatus {
  waiting: number;
  auth: boolean;
}

export type CallOutcome = "sent" | "drop" | "wait" | "auth";

/**
 * Whether a call is done (sent), refused for good (drop), may pass later (wait) or waits for sign in
 * (auth). Refused for good: 400 (an invalid body), 404, and 409 for a check that is no longer open,
 * a skipped side or a check without results, and any other 4xx a retry cannot change. Waiting: a
 * network error, 408, 429, 5xx. The background start's and resume's 409 POSTPONE and LOCKED are
 * their expected answers (the server confirmed and set the lock); so is the resume's 409 NOT_OPEN
 * (the check had already closed).
 */
export function callOutcome(call: Pick<QueuedCall, "type">, r: ApiResult<unknown>): CallOutcome {
  if (r.ok) return "sent";
  const e = r.error;
  if (e.kind !== "http") return "wait";
  if (e.status === 401 || (e.status === 403 && e.code.startsWith("AUTH"))) return "auth";
  if (call.type === "startBackground" && e.status === 409 && ["POSTPONE", "LOCKED"].includes(e.code))
    return "sent";
  if (
    call.type === "resumeBackground" &&
    e.status === 409 &&
    ["POSTPONE", "LOCKED", "NOT_OPEN"].includes(e.code)
  )
    return "sent";
  if (e.status === 408 || e.status === 429 || e.status >= 500) return "wait";
  return e.status >= 400 ? "drop" : "wait";
}

type OutboxApi = Pick<
  CheckApi,
  | "postResult"
  | "complete"
  | "postStop"
  | "postBetween"
  | "postEnd"
  | "postFaint"
  | "confirmAdult"
  | "postAfter"
  | "startCheck"
  | "resume"
>;

export class ResultQueue {
  private seq = Date.now();
  private tail: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(status: QueueStatus) => void>();
  private sentListeners = new Set<(call: QueuedCall, result: ApiResult<unknown>) => void>();
  /** Calls that never touch storage (the background start with its raw answers). */
  private volatile = new Map<number, QueuedCall>();
  private auth = false;

  constructor(
    private api: Partial<OutboxApi>,
    private store: QueueStore = memoryStore(),
    /** The signed in account (user id): only its calls are sent. */
    private owner?: string,
  ) {}

  /** This account's calls, oldest first; calls too old for the server are removed on the way. */
  private async all(): Promise<QueuedCall[]> {
    const now = Date.now();
    const out: QueuedCall[] = [];
    for (const call of [...(await this.store.all()), ...this.volatile.values()]) {
      const stamp = call as QueuedCall & Stamp;
      if (now - (stamp.at ?? stamp.seq) > MAX_AGE_MS) {
        await this.remove(call);
        continue;
      }
      if (stamp.owner === this.owner) out.push(call);
    }
    return out.sort((a, b) => a.seq - b.seq);
  }

  /** Number of calls waiting, for the "Not saved yet" chip and `offline.savedLater`. */
  async waiting(): Promise<number> {
    return (await this.all()).length;
  }

  /** Waiting count and sign in state, after every change. */
  onChange(fn: (status: QueueStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Every server answer to a call that left the outbox (the flow reads the background start's). */
  onSent(fn: (call: QueuedCall, result: ApiResult<unknown>) => void): () => void {
    this.sentListeners.add(fn);
    return () => this.sentListeners.delete(fn);
  }

  async enqueue(call: NewCall): Promise<void> {
    this.seq += 1;
    const stamp: Stamp = { at: Date.now(), ...(this.owner !== undefined ? { owner: this.owner } : {}) };
    const full = { ...call, ...stamp, seq: this.seq } as QueuedCall;
    if (DURABLE.includes(full.type)) await this.store.put(full);
    else this.volatile.set(full.seq, full);
    this.emit();
  }

  /**
   * Sends the waiting calls in order; stops at the first one that may pass later. Flushes run one
   * after another and each reads the outbox again, so a call enqueued while another flush runs is
   * always sent by the flush that follows it.
   */
  flush(): Promise<FlushReport> {
    const run = this.tail.then(() => this.doFlush());
    this.tail = run.catch(() => undefined);
    return run;
  }

  private send(call: QueuedCall): Promise<ApiResult<unknown>> {
    const missing = Promise.resolve<ApiResult<unknown>>({ ok: false, error: { kind: "network" } });
    switch (call.type) {
      case "result":
        return this.api.postResult?.(call.checkId, call.body) ?? missing;
      case "complete":
        return this.api.complete?.(call.checkId) ?? missing;
      case "stop":
        return this.api.postStop?.(call.checkId, call.option, call.ref ?? null) ?? missing;
      case "between":
        return this.api.postBetween?.(call.checkId, call.testId, call.side, call.answer) ?? missing;
      case "end":
        return this.api.postEnd?.(call.checkId, call.answer) ?? missing;
      case "faint":
        return this.api.postFaint?.(call.checkId, call.body) ?? missing;
      case "adult":
        return this.api.confirmAdult?.() ?? missing;
      case "after":
        return this.api.postAfter?.(call.answer) ?? missing;
      case "startBackground":
        return (
          this.api.startCheck?.({
            answers: call.answers,
            device: call.device,
            setting: call.setting,
            ...(call.boothToken ? { boothToken: call.boothToken } : {}),
            ...(call.session && call.session !== "full" ? { session: call.session } : {}),
            ...(call.testsOff?.length ? { testsOff: call.testsOff } : {}),
          }) ?? missing
        );
      case "resumeBackground":
        return this.api.resume?.(call.checkId, call.answers) ?? missing;
      default:
        // A call of a kind this build no longer sends (an alarm stored before D-016): dropped.
        return Promise.resolve({ ok: false, error: { kind: "http", status: 410, code: "GONE", body: {} } });
    }
  }

  private async remove(call: QueuedCall): Promise<void> {
    if (this.volatile.delete(call.seq)) return;
    await this.store.remove(call.seq);
  }

  private async doFlush(): Promise<FlushReport> {
    let sent = 0;
    let dropped = 0;
    let auth = false;
    for (;;) {
      const [call] = await this.all();
      if (!call) break;
      const r = await this.send(call);
      const outcome = callOutcome(call, r);
      if (outcome === "sent" || outcome === "drop") {
        await this.remove(call);
        if (outcome === "sent") sent += 1;
        else dropped += 1;
        for (const fn of this.sentListeners) fn(call, r);
        continue;
      }
      auth = outcome === "auth";
      break;
    }
    this.auth = auth;
    const waiting = (await this.all()).length;
    this.emit(waiting);
    return { sent, dropped, waiting, auth };
  }

  private emit(waiting?: number) {
    void (waiting === undefined ? this.waiting() : Promise.resolve(waiting)).then((n) => {
      for (const fn of this.listeners) fn({ waiting: n, auth: this.auth });
    });
  }
}

/** Back off of the outbox retries while calls wait (seconds): 5, 15, 30, then every 60. */
export const RETRY_BACKOFF_SEC: readonly number[] = [5, 15, 30, 60];
export function retryDelaySec(attempt: number): number {
  return RETRY_BACKOFF_SEC[Math.min(attempt, RETRY_BACKOFF_SEC.length - 1)];
}
