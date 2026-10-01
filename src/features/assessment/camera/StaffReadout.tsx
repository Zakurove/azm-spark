/**
 * The staff readout over the arm raise (booth staff settings, council F-1): for the team's real phone
 * sessions, so the team can see why a lift fails. It shows the live upper arm ratio against the plane
 * check rule, whether the frame passes the plane check, the seconds passing against those needed, the
 * quality gate issues and the frame rate of the lift, the last lift's outcome with its reasons, and
 * the setup checks that fail (the person sees only the first, C28), no_tilt without a tilt reading.
 * Booth mode with the staff toggle only, in the row above the picture; nothing is stored or sent.
 * Engine ids (outcomes, reasons, issues) are shown as they are, in their own left to right runs.
 */
import type { ReactNode } from "react";
import type { Lang } from "../../../app/i18n";
import { formatNumber, t, type I18nKey } from "../../../i18n";
import type { StaffReadout } from "./controller";

const PLANE_KEY: Record<"pass" | "fail" | "outside", I18nKey> = {
  pass: "assessment.booth.readout.pass",
  fail: "assessment.booth.readout.fail",
  outside: "assessment.booth.readout.outside",
};

export function StaffReadoutPanel({ readout, lang }: { readout: StaffReadout; lang: Lang }) {
  const { live, last, setup } = readout;
  const num = (n: number) => formatNumber(lang, n);
  const ids = (xs: readonly string[]) =>
    xs.length ? <bdi dir="ltr">{xs.join(", ")}</bdi> : t(lang, "assessment.booth.readout.none");
  const notYet = t(lang, "assessment.booth.readout.notYet");
  const plane = live?.plane ?? "outside";
  // Two short readings a line, the plane check, issues and the last lift on lines of their own.
  const rows: { key: I18nKey; value: ReactNode; wide?: boolean; plane?: string }[] = [
    { key: "assessment.booth.readout.ratio", value: live?.ratio == null ? notYet : num(live.ratio) },
    { key: "assessment.booth.readout.rule", value: live ? num(live.min) : notYet },
    { key: "assessment.booth.readout.plane", value: t(lang, PLANE_KEY[plane]), plane },
    {
      key: "assessment.booth.readout.seconds",
      value: live ? t(lang, "assessment.booth.readout.of", { a: live.okSec, b: live.needSec }) : notYet,
    },
    { key: "assessment.booth.readout.fps", value: live ? num(Math.round(live.fps)) : notYet },
    { key: "assessment.booth.readout.setup", value: ids(setup), wide: true },
    { key: "assessment.booth.readout.issues", value: live ? ids(live.issues) : notYet, wide: true },
    {
      key: "assessment.booth.readout.last",
      value: last ? (
        <bdi dir="ltr">
          {[last.outcome, last.value ?? "", last.reasons.join(", ")].filter((x) => x !== "").join(" ")}
        </bdi>
      ) : (
        notYet
      ),
      wide: true,
    },
  ];
  return (
    <aside
      className="s34-staff-readout"
      data-staff-readout=""
      aria-label={t(lang, "assessment.booth.readout.title")}
    >
      <p className="s34-staff-readout-title">{t(lang, "assessment.booth.readout.title")}</p>
      <dl>
        {rows.map((r) => (
          <div key={r.key} data-plane={r.plane} data-wide={r.wide ? "" : undefined}>
            <dt>{t(lang, r.key)}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
