/**
 * Booth device mode on the phone (contract v2 G, v3 I; UX spec S55).
 *
 * Staff type the code on /?booth=1; POST /api/booth/verify answers { ok }. Only then the code is kept
 * in sessionStorage (it ends with the tab), with the time it was verified, and sent as `boothCode`
 * when a signed in booth check starts. The guest check at the booth (/?check=1) runs only while this
 * tab is in booth mode, and verifies the code again whenever it opens online (CheckApp), so a value
 * typed into the storage by hand never opens the unsupervised check.
 */
// SPEC-GAP: booth-session-token. The UX spec (S55) asks the server for a device session token so the
// raw code never stays on the phone; contract v3 I keeps the code in sessionStorage. This follows the
// contract, behind these three functions, so a token can replace the code without touching screens.
const KEY = "azm.booth";

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** What is kept after a successful POST /api/booth/verify: the code and when it was verified. */
interface BoothSession {
  code: string;
  verifiedAt: number;
}

/**
 * The E2E override: a plain string in sessionStorage turns booth mode on in VITE_E2E builds only
 * (the Playwright smoke has no staff code). Production reads only a verified session.
 */
const E2E_OVERRIDE = import.meta.env.VITE_E2E === "1";

function readSession(): { code: string; verified: boolean } | null {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    try {
      const s = JSON.parse(raw) as Partial<BoothSession>;
      if (
        s &&
        typeof s.code === "string" &&
        s.code.length > 0 &&
        s.code.length <= 64 &&
        typeof s.verifiedAt === "number"
      )
        return { code: s.code, verified: true };
    } catch {
      /* not a verified session */
    }
    return E2E_OVERRIDE && raw.length > 0 && raw.length <= 64 ? { code: raw, verified: false } : null;
  } catch {
    return null;
  }
}

/** The verified booth code of this tab, or null. */
export function readBoothCode(): string | null {
  return readSession()?.code ?? null;
}

/** Whether this tab's booth mode came from a verify (not the E2E override): it can be verified again. */
export function boothVerifiedSession(): boolean {
  return readSession()?.verified === true;
}

/** Keeps the code after a successful POST /api/booth/verify (never before). */
export function saveBoothCode(code: string, now = Date.now()): void {
  try {
    storage()?.setItem(KEY, JSON.stringify({ code, verifiedAt: now } satisfies BoothSession));
  } catch {
    /* private mode: booth mode lasts for this page only */
  }
}

export function clearBoothCode(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* nothing kept */
  }
}

/** This tab is in verified booth mode. */
export function isBoothMode(): boolean {
  return readBoothCode() !== null;
}
