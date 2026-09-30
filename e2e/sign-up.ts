/**
 * Every account an e2e spec makes signs up from its own client address (X-Forwarded-For, which the
 * server reads from its one trusted hop). The server allows 30 sign ups per address per 15 minutes
 * (server/api.ts); without this, all the specs share 127.0.0.1 and a run with the screenshot specs
 * (AZM_SHOTS_DIR) used the limit up and got 429 RATE_LIMIT part way (acceptance F-7).
 *
 * The 198.21 range is apart from the context wide addresses of a11y (198.18), fixes (198.19) and
 * fixes-shots (198.20). The start is random, so a restarted worker does not reuse the same run of
 * addresses.
 */
let next = Math.floor(Math.random() * 62_500);

/** The header for one sign up request: a fresh address each call. */
export function signUpAddress(): { "x-forwarded-for": string } {
  next = (next + 1) % 62_500;
  return { "x-forwarded-for": `198.21.${next % 250}.${1 + Math.floor(next / 250)}` };
}
