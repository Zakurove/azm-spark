/**
 * Build gates of the movement check (Q31 (5) (6), UX spec 4.7; council O33 (4), O34-1, O42). Shared by
 * the server and the client, so a server flag alone can never open what the client has not built.
 *
 * Home gate 2 needs, before any home check: the answer zones over the mirrored video, the chest
 * height fine zone and its rehearsal (O34-1), and the fall watch after a fall stop (O42). Until they
 * ship, AZM_CHECK_HOME cannot open home checks (server/modules/booth/config.ts), and the check in at
 * home names only the signals that work: a raised hand, where it may be asked for, and the button.
 */
export const HOME_GATE2_READY = false;

/** The answer zones and the fine zone over the video (phase 2): they ship with home gate 2. */
export const ANSWER_ZONES = HOME_GATE2_READY;
