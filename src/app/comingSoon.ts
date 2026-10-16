/**
 * D-040: the site is a coming soon landing (VITE_COMING_SOON=1 builds, with AZM_COMING_SOON=1 on the
 * server). Every address shows the landing with the waiting list; no sign up, sign in, demo, test page
 * or workout is reachable, and the server refuses them too. The privacy page stays open.
 */
export const COMING_SOON = import.meta.env.VITE_COMING_SOON === "1";
