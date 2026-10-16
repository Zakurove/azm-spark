import { useState, type FormEvent } from "react";
import type { Lang } from "./i18n";
import { privacyHref } from "./privacyHref";
import "./waitlist.css";

/** D-040: the launch waiting list on the coming soon landing (POST /api/waitlist). */
const COPY = {
  ar: {
    soon: "قريبًا على iPhone و Android",
    store: "قريبًا",
    title: "انضم إلى قائمة الانتظار",
    body: "اترك بريدك الإلكتروني أو رقم جوالك، ونخبرك أول ما يصبح التطبيق متاحًا.",
    label: "بريدك الإلكتروني أو رقم جوالك",
    placeholder: "مثال: 0551234567",
    device: "جهازك (اختياري)",
    both: "الاثنان",
    submit: "أبلغني عند الإطلاق",
    sending: "جارٍ الإرسال…",
    done: "تم. سنخبرك فور إطلاق التطبيق.",
    invalid: "اكتب بريدًا إلكترونيًا أو رقم جوال صحيحًا.",
    busy: "محاولات كثيرة، حاول بعد قليل.",
    failed: "تعذّر الإرسال، حاول مجددًا.",
    note: "نستخدم بريدك أو رقمك فقط لإبلاغك بالإطلاق.",
    privacy: "الخصوصية",
  },
  en: {
    soon: "Coming soon to iPhone and Android",
    store: "Coming soon",
    title: "Join the waiting list",
    body: "Leave your email or mobile number and we will tell you as soon as the app is out.",
    label: "Your email or mobile number",
    placeholder: "e.g. name@example.com",
    device: "Your phone (optional)",
    both: "Both",
    submit: "Tell me at launch",
    sending: "Sending…",
    done: "Done. We will tell you as soon as the app is out.",
    invalid: "Enter a valid email or mobile number.",
    busy: "Too many tries. Please try again in a little while.",
    failed: "We could not send it. Please try again.",
    note: "We use your email or number only to tell you about the launch.",
    privacy: "Privacy",
  },
} as const;

type Platform = "ios" | "android" | "both";
type Status = "idle" | "sending" | "done" | "invalid" | "busy" | "failed";

/** The two stores, with no store logo (the apps are not in them yet). */
export function StoreBadges({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  return (
    <div className="wl-stores" data-coming-soon>
      <p className="wl-soon">{c.soon}</p>
      <div className="wl-store-row">
        {(["App Store", "Google Play"] as const).map((name) => (
          <span className="wl-store" key={name} dir="ltr">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
              <rect
                x="6.5"
                y="2.5"
                width="11"
                height="19"
                rx="2.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path d="M10.5 18.5h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            <span className="wl-store-text">
              <small>{c.store}</small>
              <b>{name}</b>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Waitlist({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const [contact, setContact] = useState("");
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [status, setStatus] = useState<Status>("idle");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (status === "sending") return;
    const value = contact.trim();
    if (!value) return setStatus("invalid");
    setStatus("sending");
    try {
      const r = await fetch("/api/waitlist", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Azm-Request": "1" },
        body: JSON.stringify({ contact: value, lang, ...(platform ? { platform } : {}) }),
      });
      if (r.ok) {
        setStatus("done");
        setContact("");
      } else setStatus(r.status === 400 ? "invalid" : r.status === 429 ? "busy" : "failed");
    } catch {
      setStatus("failed");
    }
  }

  const message = status === "idle" || status === "sending" ? null : c[status];
  return (
    <form className="wl" id="waitlist" onSubmit={submit} noValidate data-waitlist={status}>
      <h2 className="wl-title">{c.title}</h2>
      <p className="wl-body">{c.body}</p>
      <label className="wl-label" htmlFor="wl-contact">
        {c.label}
      </label>
      <div className="wl-row">
        <input
          id="wl-contact"
          className="wl-input"
          type="text"
          inputMode="email"
          autoComplete="email"
          dir="auto"
          maxLength={254}
          placeholder={c.placeholder}
          value={contact}
          aria-invalid={status === "invalid"}
          onChange={(e) => {
            setContact(e.target.value);
            if (status !== "sending") setStatus("idle");
          }}
        />
        <button className="cta wl-submit" type="submit" disabled={status === "sending"}>
          {status === "sending" ? c.sending : c.submit}
        </button>
      </div>
      <fieldset className="wl-device">
        <legend>{c.device}</legend>
        {(
          [
            ["ios", "iPhone"],
            ["android", "Android"],
            ["both", c.both],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            className="wl-chip"
            aria-pressed={platform === value}
            onClick={() => setPlatform(platform === value ? null : value)}
          >
            {label}
          </button>
        ))}
      </fieldset>
      <p className={`wl-status${status === "done" ? " is-done" : ""}`} role="status" aria-live="polite">
        {message}
      </p>
      <p className="wl-note">
        {c.note} <a href={privacyHref(lang)}>{c.privacy}</a>
      </p>
    </form>
  );
}
