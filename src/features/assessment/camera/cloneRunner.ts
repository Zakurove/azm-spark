/**
 * A deep copy of a runner that keeps every prototype, shared reference and cycle, so the copy runs
 * on as the original would. The camera screen keeps a copy of a range or side lean runner at every
 * rest, and puts it back when an attempt in progress must be discarded (a redo after the check in,
 * the camera stopping): the same attempt number then starts again from the rest (UX spec 2.12, S44,
 * S34 errors). Pure.
 *
 * The range and side lean runners hold only data and class instances (no closures), which is what
 * makes the copy exact; the timed runners keep closures in their timers, so they are started again
 * instead (see controller.ts).
 */
export function cloneDeep<T>(value: T, memo: Map<unknown, unknown> = new Map()): T {
  if (value === null || typeof value !== "object") return value;
  if (memo.has(value)) return memo.get(value) as T;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    memo.set(value, out);
    for (const x of value) out.push(cloneDeep(x, memo));
    return out as T;
  }
  if (value instanceof Map) {
    const out = new Map();
    memo.set(value, out);
    for (const [k, v] of value) out.set(cloneDeep(k, memo), cloneDeep(v, memo));
    return out as T;
  }
  if (value instanceof Set) {
    const out = new Set();
    memo.set(value, out);
    for (const v of value) out.add(cloneDeep(v, memo));
    return out as T;
  }
  if (ArrayBuffer.isView(value)) return (value as unknown as { slice(): T }).slice();
  const out = Object.create(Object.getPrototypeOf(value)) as T;
  memo.set(value, out);
  for (const key of Reflect.ownKeys(value as object)) {
    const d = Object.getOwnPropertyDescriptor(value, key)!;
    if ("value" in d) d.value = cloneDeep(d.value, memo);
    Object.defineProperty(out, key, d);
  }
  return out;
}
