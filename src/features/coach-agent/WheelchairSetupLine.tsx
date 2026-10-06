/**
 * The wheelchair setup line of a session (exercise-targets sessionLines wheelchair_setup, review C11;
 * D-030 item 2, E3-3): «قبل أن تبدأ: اقفل فرامل كرسيك المتحرك...», shown once before the first seated
 * item of a session to a wheelchair user. Workout.tsx shows it on its setup card, the screen that
 * opens a session (a resumed session saw it at its start), lazily and in v7 builds only; every item of
 * a wheelchair user's session is seated. The person's mobility comes from their intake, and the
 * targets data is loaded only for a wheelchair user. The text is the data's, never rewritten.
 */
import { useEffect, useState } from "react";
import type { Lang } from "../../app/i18n";
import type { TargetsData } from "../../movements/targets/types";
import { bidiText } from "../../i18n/rich";
import { readIntake } from "../gait/api";

/** The data's line for this mobility (TARGETS_DATA.mapping.sessionLines), or null without a wheelchair. */
export function wheelchairSetupLine(
  mobility: string | undefined,
  data: { mapping: Pick<TargetsData["mapping"], "sessionLines"> },
  lang: Lang,
): string | null {
  if (mobility !== "wheelchair") return null;
  return data.mapping.sessionLines.find((l) => l.id === "wheelchair_setup")?.[lang] ?? null;
}

export default function WheelchairSetupLine({ lang }: { lang: Lang }) {
  const [line, setLine] = useState<{ ar: string; en: string } | null>(null);
  useEffect(() => {
    let live = true;
    void readIntake().then(async (intake) => {
      if (!live || intake?.mobility !== "wheelchair") return;
      const { TARGETS_DATA } = await import("../../movements/targets");
      const ar = wheelchairSetupLine(intake.mobility, TARGETS_DATA, "ar");
      const en = wheelchairSetupLine(intake.mobility, TARGETS_DATA, "en");
      if (live && ar && en) setLine({ ar, en });
    });
    return () => {
      live = false;
    };
  }, []);
  if (!line) return null;
  return (
    <p className="workout-attest workout-wheelchair" data-line="wheelchair_setup">
      {bidiText(lang, line[lang])}
    </p>
  );
}
