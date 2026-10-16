/**
 * The launch waiting list (D-040): an email or a phone number left on the coming soon landing, to be
 * told when the iPhone and Android apps are out. Nothing else about the person is kept.
 *
 * Its own table, made here with CREATE TABLE IF NOT EXISTS rather than a numbered migration, so the
 * schema version stays 7: a build before D-040 still starts on this database (it never reads the
 * table), and a rollback needs no restore.
 *
 *   waitlist.id         uuid
 *   waitlist.contact    the normalised email (lower case) or phone (+ and digits), unique
 *   waitlist.kind       "email" | "phone"
 *   waitlist.platform   "ios" | "android" | "both" | null (the person's choice, optional)
 *   waitlist.lang       "ar" | "en"
 *   waitlist.created    ms since epoch
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type WaitlistKind = "email" | "phone";
export type WaitlistPlatform = "ios" | "android" | "both";
export const WAITLIST_PLATFORMS: readonly WaitlistPlatform[] = ["ios", "android", "both"];

const ready = new WeakSet<DatabaseSync>();

export function ensureWaitlist(db: DatabaseSync): void {
  if (ready.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS waitlist (
    id TEXT PRIMARY KEY,
    contact TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('email','phone')),
    platform TEXT CHECK (platform IN ('ios','android','both')),
    lang TEXT NOT NULL CHECK (lang IN ('ar','en')),
    created INTEGER NOT NULL
  )`);
  ready.add(db);
}

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
const toAscii = (s: string) =>
  s.replace(ARABIC_DIGITS, (d) => {
    const c = d.charCodeAt(0);
    return String(c >= 0x06f0 ? c - 0x06f0 : c - 0x0660);
  });

/**
 * The contact as kept, or null when it is neither an email nor a phone number. A Saudi mobile in any
 * usual form (05x, 5x, 9665x, +9665x, 009665x) becomes +9665 and 8 digits; another country's number
 * needs its + or 00 and 8 to 15 digits.
 */
export function normaliseContact(raw: unknown): { contact: string; kind: WaitlistKind } | null {
  if (typeof raw !== "string") return null;
  const value = toAscii(raw.trim());
  if (!value || value.length > 254) return null;
  if (value.includes("@")) {
    const email = value.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { contact: email, kind: "email" } : null;
  }
  if (!/^[+\d\s().-]+$/.test(value)) return null;
  let digits = value.replace(/[\s().-]/g, "");
  const plus = digits.startsWith("+");
  digits = digits.replace(/^\+/, "");
  if (!/^\d+$/.test(digits)) return null;
  if (!plus && digits.startsWith("00")) digits = digits.slice(2);
  else if (!plus) {
    // A local Saudi mobile: 05xxxxxxxx or 5xxxxxxxx.
    if (/^05\d{8}$/.test(digits)) digits = `966${digits.slice(1)}`;
    else if (/^5\d{8}$/.test(digits)) digits = `966${digits}`;
    else if (!/^9665\d{8}$/.test(digits)) return null;
  }
  if (digits.startsWith("966") && !/^9665\d{8}$/.test(digits)) return null;
  if (!/^\d{8,15}$/.test(digits)) return null;
  return { contact: `+${digits}`, kind: "phone" };
}

/** Adds the contact once; a contact already on the list is left as it was. True when it was new. */
export function joinWaitlist(
  db: DatabaseSync,
  entry: { contact: string; kind: WaitlistKind; platform: WaitlistPlatform | null; lang: "ar" | "en" },
  now: number,
): boolean {
  ensureWaitlist(db);
  const r = db
    .prepare(
      "INSERT OR IGNORE INTO waitlist (id, contact, kind, platform, lang, created) VALUES (?,?,?,?,?,?)",
    )
    .run(randomUUID(), entry.contact, entry.kind, entry.platform, entry.lang, now);
  return Number(r.changes) > 0;
}
