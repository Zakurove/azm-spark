/**
 * The queue of derived results of a started signed in check (UX spec 0.7 and 5.10 `resultQueue`).
 *
 * Only two kinds of call wait here: a test side's result and the completion of the check. They are
 * sent in order when the phone is online and removed as soon as the server accepts them (or refuses
 * them for good, so one bad entry never blocks the rest). Never video, never raw answers, and never a
 * safety answer: the start call, the stop list and the pain question between tests are sent directly
 * (api.ts), because the phone has already routed them.
 *
 * Storage is pluggable: IndexedDB in the browser (`indexedDbStore`), memory in tests and wherever
 * IndexedDB is missing (`memoryStore`).
 */
import type { ApiResult, CheckApi } from "./api";
import type { ResultPayload } from "./flowMachine";

export type QueuedCall =
  | { seq: number; type: "result"; checkId: string; body: ResultPayload }
  | { seq: number; type: "complete"; checkId: string };

export type NewCall = QueuedCall extends infer C ? (C extends QueuedCall ? Omit<C, "seq"> : never) : never;

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
}

/** A 4xx other than 408 and 429 will never succeed: drop the entry so the rest can go. */
function permanent<T>(r: ApiResult<T>): boolean {
  return (
    !r.ok &&
    r.error.kind === "http" &&
    r.error.status >= 400 &&
    r.error.status < 500 &&
    ![408, 429].includes(r.error.status)
  );
}

export class ResultQueue {
  private seq = Date.now();
  private flushing: Promise<FlushReport> | null = null;
  private listeners = new Set<(waiting: number) => void>();

  constructor(
    private api: Pick<CheckApi, "postResult" | "complete">,
    private store: QueueStore = memoryStore(),
  ) {}

  /** Number of calls waiting, for the "Not saved yet" chip and `offline.savedLater`. */
  async waiting(): Promise<number> {
    return (await this.store.all()).length;
  }

  onChange(fn: (waiting: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async enqueue(call: NewCall): Promise<void> {
    this.seq += 1;
    await this.store.put({ ...call, seq: this.seq } as QueuedCall);
    this.emit();
  }

  /** Sends the waiting calls in order; stops at the first one that fails for a reason that may pass. */
  flush(): Promise<FlushReport> {
    this.flushing ??= this.doFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush(): Promise<FlushReport> {
    let sent = 0;
    let dropped = 0;
    for (const call of await this.store.all()) {
      const r =
        call.type === "result"
          ? await this.api.postResult(call.checkId, call.body)
          : await this.api.complete(call.checkId);
      if (r.ok) {
        sent += 1;
        await this.store.remove(call.seq);
      } else if (permanent(r)) {
        dropped += 1;
        await this.store.remove(call.seq);
      } else {
        break;
      }
    }
    const waiting = (await this.store.all()).length;
    this.emit(waiting);
    return { sent, dropped, waiting };
  }

  private emit(waiting?: number) {
    void (waiting === undefined ? this.waiting() : Promise.resolve(waiting)).then((n) => {
      for (const fn of this.listeners) fn(n);
    });
  }
}
