/**
 * Copy as React nodes with bidirectional isolation (UX spec 0.2, 5.1).
 *
 *   tx(lang, key, vars)     t() as nodes
 *   bidiText(lang, text)    any copy or check data text as nodes (Arabic digits applied first)
 *
 * In Arabic text every Latin run (Safari, Chrome, Samsung Internet, QR, T6) is wrapped in
 * <bdi lang="en">, so it never flips inside right to left text and an Arabic screen reader voice
 * reads it with English phonetics, and every number is wrapped in <bdi>, so a number next to Latin
 * text or punctuation keeps its place. A clock time (h:mm) is one left to right run, so «٣:١٥» never
 * shows as «١٥:٣» (Q30). English text needs none of this and is returned as it is.
 */
import type { ReactNode } from "react";
import { localizeDigits, t, type I18nKey, type Lang, type Vars } from "./index";

/**
 * A clock time (h:mm or hh:mm), a Latin run (letters, then letters, digits, spaces or dots, ending on
 * a letter or digit), or a number in Arabic Indic or ASCII digits with ٫ or . as the decimal mark.
 */
const RUNS =
  /([0-9\u0660-\u0669]{1,2}:[0-9\u0660-\u0669]{2}(?![0-9\u0660-\u0669]))|([A-Za-z][A-Za-z0-9 .]*[A-Za-z0-9]|[A-Za-z])|([0-9\u0660-\u0669]+(?:[.\u066B][0-9\u0660-\u0669]+)?)/g;

/** The segments of a text: plain strings and the runs to isolate. */
export type BidiSegment = string | { latin: string } | { number: string } | { time: string };

export function bidiSegments(lang: Lang, text: string): BidiSegment[] {
  if (lang !== "ar") return [text];
  const out: BidiSegment[] = [];
  let at = 0;
  for (const m of text.matchAll(RUNS)) {
    const start = m.index ?? 0;
    if (start > at) out.push(text.slice(at, start));
    out.push(m[1] !== undefined ? { time: m[1] } : m[2] !== undefined ? { latin: m[2] } : { number: m[3] });
    at = start + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** A copy or data text as nodes, with Arabic digits and isolated Latin runs and numbers. */
export function bidiText(lang: Lang, text: string): ReactNode {
  const segments = bidiSegments(lang, localizeDigits(lang, text));
  if (segments.length === 1 && typeof segments[0] === "string") return segments[0];
  return segments.map((s, i) =>
    typeof s === "string" ? (
      s
    ) : "latin" in s ? (
      <bdi key={i} lang="en">
        {s.latin}
      </bdi>
    ) : "time" in s ? (
      <bdi key={i} dir="ltr">
        {s.time}
      </bdi>
    ) : (
      <bdi key={i}>{s.number}</bdi>
    ),
  );
}

/** t() as React nodes (tx for "text"), with the bidirectional isolation of bidiText. */
export function tx(lang: Lang, key: I18nKey, vars?: Vars): ReactNode {
  return bidiText(lang, t(lang, key, vars));
}
