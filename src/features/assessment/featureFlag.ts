/**
 * Whether this build shows the movement check entries that are still round 3 stubs: the Today slot
 * (S01), the My results page (S53), the example page (S54) and the example link of S05b. Development,
 * E2E and booth builds set it (VITE_CHECK_UI=1 for the booth build); a production build of azm6
 * without it shows none of them, so no stub reaches people before the progress stream lands.
 */
export const CHECK_UI: boolean =
  import.meta.env.DEV || import.meta.env.VITE_E2E === "1" || import.meta.env.VITE_CHECK_UI === "1";
