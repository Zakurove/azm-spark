/**
 * The home build gate of the movement check (selection.homeGates, Q31 (6)). Shared by the server and
 * the client, so a server flag alone can never open what the client has not released.
 *
 * Home checks stay closed in every build until the home gates of the data are recorded as met and
 * this is set: until then AZM_CHECK_HOME cannot open home checks (server/modules/booth/config.ts).
 * D-016 took the answer zones, the fine zone and the fall watch out of these gates.
 */
export const HOME_CHECKS_READY = false;
