import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { CHECK_DATA } from "../../../src/movements/assessments";

/**
 * Consent kinds and the version a person accepts today (spec 2.1 "Consent"). The movement check
 * consent text is boundary.consent of the check data, so its version is the check data version: a
 * new text ships with a new data version and needs a new acceptance.
 */
// SPEC-GAP: consent-version. The spec names a consent version without a scheme; it is the check data
// version, and a consent to an older version does not count.
export const CONSENT_VERSIONS = { movement_check: CHECK_DATA.version } as const;
export type ConsentKind = keyof typeof CONSENT_VERSIONS;

export function isConsentKind(kind: unknown): kind is ConsentKind {
  return typeof kind === "string" && Object.hasOwn(CONSENT_VERSIONS, kind);
}

export interface ConsentRecord {
  kind: ConsentKind;
  version: number;
  acceptedAt: number;
}

/** The person's consent of this kind to the current version, or null (never accepted or revoked). */
export function activeConsent(db: DatabaseSync, userId: string, kind: ConsentKind): ConsentRecord | null {
  const row = db
    .prepare(
      "SELECT version, accepted_at FROM consents WHERE user_id=? AND kind=? AND version=? AND revoked_at IS NULL ORDER BY accepted_at DESC LIMIT 1",
    )
    .get(userId, kind, CONSENT_VERSIONS[kind]) as { version: number; accepted_at: number } | undefined;
  return row ? { kind, version: Number(row.version), acceptedAt: Number(row.accepted_at) } : null;
}

/** Stores an acceptance with its time; an active acceptance of the same version is returned as is. */
export function acceptConsent(
  db: DatabaseSync,
  userId: string,
  kind: ConsentKind,
  now: number,
): ConsentRecord {
  const active = activeConsent(db, userId, kind);
  if (active) return active;
  const version = CONSENT_VERSIONS[kind];
  db.prepare(
    "INSERT INTO consents(id,user_id,kind,version,accepted_at,revoked_at) VALUES(?,?,?,?,?,NULL)",
  ).run(randomUUID(), userId, kind, version, now);
  return { kind, version, acceptedAt: now };
}

/** Marks every active acceptance of this kind revoked; returns how many were active. */
export function revokeConsent(db: DatabaseSync, userId: string, kind: ConsentKind, now: number): number {
  const out = db
    .prepare("UPDATE consents SET revoked_at=? WHERE user_id=? AND kind=? AND revoked_at IS NULL")
    .run(now, userId, kind);
  return Number(out.changes);
}
