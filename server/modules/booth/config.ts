/**
 * Server flags of contract v3 I and the booth window of O17 (UX spec S55), read from the environment
 * at every request so a Railway change needs no code change:
 *
 *   AZM_CHECK_HOME   "1" opens home checks; anything else (or nothing) keeps them closed (Q31 (6)).
 *   AZM_BOOTH_CODE   the staff code: one code, or a daily code per booth day as
 *                    "2026-10-11=code,2026-10-12=code" (the code changes every day, S55).
 *   AZM_BOOTH_DATES  the booth days in Asia/Riyadh, "YYYY-MM-DD,..."; default BOOTH_DATES.
 *   AZM_BOOTH_HOURS  the booth hours in Asia/Riyadh, "HH:MM-HH:MM"; default the whole day.
 *
 * Nothing here logs, and a code never leaves this module.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { HOME_GATE2_READY } from "../../../src/medical/gates";
import { riyadhDate } from "../../../src/medical/precheck";

/** The booth days of the UX spec (S55): 11 to 13 October 2026. */
// SPEC-GAP: booth-dates-default. Contract v3 I names only the code; O17 and S55 limit booth mode to
// the booth days and hours. Without AZM_BOOTH_DATES the booth days are these, so a code left in the
// environment after the booth never runs booth rules at home (the safe side).
export const BOOTH_DATES: readonly string[] = ["2026-10-11", "2026-10-12", "2026-10-13"];

const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MINUTES = 24 * 60;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Contract v3 I: home checks open only with AZM_CHECK_HOME=1, and only once home gate 2 is built
 * (HOME_GATE2_READY: the answer zones, the fine zone and the fall watch, Q31 (5) (6)). The unit tests
 * of the home contract (vitest) run it with the flag alone; no deployed server does.
 */
export function homeChecksOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.AZM_CHECK_HOME !== "1") return false;
  return HOME_GATE2_READY || (env.VITEST === "true" && env.NODE_ENV === "test");
}

function boothDates(): readonly string[] {
  const raw = process.env.AZM_BOOTH_DATES;
  if (raw === undefined || raw.trim() === "") return BOOTH_DATES;
  return raw
    .split(",")
    .map((d) => d.trim())
    .filter((d) => DATE.test(d));
}

/**
 * The booth hours as minutes of the day in Riyadh, [open, close). An unreadable value keeps the
 * booth closed (the safe side).
 */
// SPEC-GAP: booth-hours. The UX spec names booth hours without the times; without AZM_BOOTH_HOURS a
// booth day is open from 00:00 to 24:00 in Riyadh.
function boothHours(): [number, number] | null {
  const raw = process.env.AZM_BOOTH_HOURS;
  if (raw === undefined || raw.trim() === "") return [0, DAY_MINUTES];
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const open = Number(m[1]) * 60 + Number(m[2]);
  const close = Number(m[3]) * 60 + Number(m[4]);
  if (Number(m[2]) > 59 || Number(m[4]) > 59 || open >= close || close > DAY_MINUTES) return null;
  return [open, close];
}

/** Whether the booth is open now, and when it closes today (epoch ms). */
export function boothWindow(now: number): { open: boolean; closes: number } {
  const local = now + RIYADH_OFFSET_MS;
  const dayStart = Math.floor(local / (DAY_MINUTES * MINUTE_MS)) * DAY_MINUTES * MINUTE_MS - RIYADH_OFFSET_MS;
  const hours = boothHours();
  if (!hours || !boothDates().includes(riyadhDate(now))) return { open: false, closes: now };
  const minute = Math.floor((now - dayStart) / MINUTE_MS);
  const closes = dayStart + hours[1] * MINUTE_MS;
  return { open: minute >= hours[0] && now < closes, closes };
}

/** Today's staff code, or null: a daily list gives the code of today's date in Riyadh. */
function boothCodeFor(now: number): string | null {
  const raw = process.env.AZM_BOOTH_CODE?.trim();
  if (!raw) return null;
  if (!raw.includes("=")) return raw;
  const today = riyadhDate(now);
  for (const entry of raw.split(",")) {
    const at = entry.indexOf("=");
    if (at < 0) continue;
    if (entry.slice(0, at).trim() === today) return entry.slice(at + 1).trim() || null;
  }
  return null;
}

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/**
 * Whether `given` is today's staff code (contract G, v3 I). The comparison is constant time on
 * digests of equal length, and runs even when there is no code today, so a wrong code, a code of
 * another length and a missing env all take the same path.
 */
export function boothCodeMatches(given: string | undefined, now: number): boolean {
  const expected = boothCodeFor(now);
  const same = timingSafeEqual(digest(given ?? ""), digest(expected ?? "\u0000"));
  return expected !== null && typeof given === "string" && given.length > 0 && same;
}
