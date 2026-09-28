/**
 * Booth device mode on the phone (contract v2 G, v3 I; UX spec S55).
 *
 * Staff type the code on /?booth=1; POST /api/booth/verify answers { ok }. The code is then kept in
 * sessionStorage only (it ends with the tab) and sent as `boothCode` when a signed in booth check
 * starts. The guest check at the booth (/?check=1) runs only while this tab is in booth mode.
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

/** The verified booth code of this tab, or null. */
export function readBoothCode(): string | null {
  try {
    const v = storage()?.getItem(KEY);
    return v && v.length > 0 && v.length <= 64 ? v : null;
  } catch {
    return null;
  }
}

export function saveBoothCode(code: string): void {
  try {
    storage()?.setItem(KEY, code);
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
