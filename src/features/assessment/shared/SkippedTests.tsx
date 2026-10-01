/**
 * The tests that do not run today (C32), on S27 and the results screens: one muted line that names
 * them («لن يُجرى اليوم: {tests}.»), then each distinct reason once, in the check data's words (P6).
 */
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import { useCheckUi } from "./CheckUi";

export function SkippedTests({ names, reasons }: { names: readonly string[]; reasons: readonly string[] }) {
  const { lang } = useCheckUi();
  if (names.length === 0) return null;
  const tests = names.join(lang === "ar" ? "، " : ", ");
  return (
    <div className="check-skipped" data-skipped="">
      <p className="check-meta">{bidiText(lang, t(lang, "assessment.plan.notToday", { tests }))}</p>
      {[...new Set(reasons.filter((r) => r !== ""))].map((r) => (
        <p key={r} className="check-meta">
          {bidiText(lang, r)}
        </p>
      ))}
    </div>
  );
}
