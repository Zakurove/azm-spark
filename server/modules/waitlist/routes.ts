/**
 * POST /api/waitlist { contact, platform?, lang? } (D-040): joins the launch waiting list from the
 * coming soon landing. Public, open whatever the flags (AZM_COMING_SOON keeps it open), rate limited.
 * The answer is the same whether the contact was new or already listed, so it says nothing about who
 * else signed up.
 *
 * → 200 { ok: true } · 400 { error: "WAITLIST_CONTACT" | "WAITLIST_INVALID", field } · 429 RATE_LIMIT
 */
import type { Route } from "../../http/types";
import { joinWaitlist, normaliseContact, WAITLIST_PLATFORMS, type WaitlistPlatform } from "./store";

const WINDOW_MS = 15 * 60 * 1000;
/** Sign ups one address may send in 15 minutes (a family on one network). */
export const WAITLIST_PER_IP = 10;
/** Sign ups every address together may send in 15 minutes. */
export const WAITLIST_ALL = 600;

export const waitlistRoutes: Route[] = [
  {
    method: "POST",
    path: /^\/api\/waitlist$/,
    auth: "public",
    handle({ db, body, ip, json, limited }) {
      for (const key of Object.keys(body))
        if (!["contact", "platform", "lang"].includes(key))
          return json(400, { error: "WAITLIST_INVALID", field: key });
      const platform = body.platform ?? null;
      if (platform !== null && !WAITLIST_PLATFORMS.includes(platform))
        return json(400, { error: "WAITLIST_INVALID", field: "platform" });
      const lang = body.lang === "en" ? "en" : body.lang === undefined || body.lang === "ar" ? "ar" : null;
      if (!lang) return json(400, { error: "WAITLIST_INVALID", field: "lang" });
      if (
        limited(`waitlist:${ip}`, WAITLIST_PER_IP, WINDOW_MS) ||
        limited("waitlist:all", WAITLIST_ALL, WINDOW_MS)
      )
        return json(429, { error: "RATE_LIMIT" });
      const contact = normaliseContact(body.contact);
      if (!contact) return json(400, { error: "WAITLIST_CONTACT", field: "contact" });
      joinWaitlist(db, { ...contact, platform: platform as WaitlistPlatform | null, lang }, Date.now());
      json(200, { ok: true });
    },
  },
];
