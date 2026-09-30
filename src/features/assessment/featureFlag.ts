/**
 * Whether this build shows the movement check entries outside the check itself: the Today slot (S01),
 * the My results page (S53), the example page (S54, D-008, the phase 1 F2 deliverable for the booth)
 * and the example link of S05b. They are finished screens since the round 3 progress stream, so every
 * build has them, `npm run build` included (acceptance F-3). VITE_CHECK_UI=0 builds without them, a
 * switch to hide them again if ever needed; the booth build never sets it.
 */
export const CHECK_UI: boolean = import.meta.env.VITE_CHECK_UI !== "0";
