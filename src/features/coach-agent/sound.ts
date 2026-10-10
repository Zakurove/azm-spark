/**
 * The one voice control of the v7 checks (D-034 item 3, D-036 item 1): the speaker button turns the
 * Live coach on or off. Sound on means the Live coach runs when the server allows it (GET
 * /api/agent/status); only the coach speaks, so without it, or with the sound off, the check is silent
 * and its screens carry every instruction. On by default in a v7 build; the person's choice is kept
 * per device (localStorage azm.sound), apart from the v1 voice preference.
 */

export const SOUND_KEY = "azm.sound";

type Store = Pick<Storage, "getItem" | "setItem">;
const browserStore = (): Store | null => (typeof localStorage === "undefined" ? null : localStorage);

/** The sound switch: the stored choice, else on in a v7 build (off before v7). Never throws. */
export function readSound(
  v7: boolean = import.meta.env.VITE_V7 === "1",
  store: Store | null = browserStore(),
): boolean {
  try {
    const kept = store?.getItem(SOUND_KEY);
    if (kept === "on") return true;
    if (kept === "off") return false;
  } catch {
    /* storage blocked: the default */
  }
  return v7;
}

/** Keeps the person's choice on this device. Never throws. */
export function saveSound(on: boolean, store: Store | null = browserStore()): void {
  try {
    store?.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    /* the choice still holds for this visit */
  }
}
