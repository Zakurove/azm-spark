/**
 * S58 Setup tips (UX spec S58): reached from the Setup tips link (S34c after 60 s, S34i when no retry
 * is left, and a result skipped for quality). Static: light, sleeves, background, the phone's height,
 * the distance, a helper in the picture, and the wheelchair tip, which comes first for a wheelchair
 * user. Each tip has a small picture that says nothing the text does not (alt ""), so the icons here
 * are decorative until the tip illustrations of Appendix B land. Works offline; no other state applies.
 */
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import { testDef } from "../../../movements/assessments";
import { backTarget } from "../flowMachine";
import type { ScreenProps } from "../screenTypes";
import CheckIcon from "../shared/CheckIcon";
import { CheckShell } from "../shared/CheckShell";
import { useCheckUi } from "../shared/CheckUi";
import "./booth.css";

export type TipId = "light" | "sleeves" | "background" | "height" | "distance" | "people" | "wheelchair";

const TIP_ICON: Record<TipId, string> = {
  light: "sun",
  sleeves: "sleeve",
  background: "camera",
  height: "phone-level",
  distance: "arrow-forward",
  people: "people",
  wheelchair: "phone-rotate",
};

/** The person's distance from the phone for the tip (clinical 4.0, principle 7: 2 to 3 m). */
export const TIP_METERS = { metersFrom: 2, metersTo: 3 } as const;

/** The tips in order: the wheelchair tip first for a wheelchair user, last for everyone else. */
export function tipOrder(wheelchair: boolean): TipId[] {
  const rest: TipId[] = ["light", "sleeves", "background", "height", "distance", "people"];
  return wheelchair ? ["wheelchair", ...rest] : [...rest, "wheelchair"];
}

/**
 * The seven tips in their order (the list of S58). The camera screen (S34c, S34i) shows the same list
 * in its sheet over the stage, with the test's own distance from the phone.
 */
export function SetupTipsList({
  wheelchair,
  meters = TIP_METERS,
}: {
  wheelchair: boolean;
  meters?: { metersFrom: number; metersTo: number };
}) {
  const { lang } = useCheckUi();
  return (
    <ul className="booth-tips">
      {tipOrder(wheelchair).map((id) => (
        <li key={id} className="booth-tip" data-tip={id}>
          <span className="booth-tip-icon">
            <CheckIcon name={TIP_ICON[id]} />
          </span>
          <span>
            {bidiText(
              lang,
              id === "distance"
                ? t(lang, "assessment.tips.distance", meters)
                : t(lang, `assessment.tips.${id}`),
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * At the booth our team sets up the chair and the support in front before each chair stand, so the
 * visitor's card leaves them out (R3C-33, C12): the data's boothSetup lines are here.
 */
export function BoothStandSetup() {
  const { lang } = useCheckUi();
  const def = testDef("chair_stand_30s");
  const setup = def.boothSetup[lang];
  return (
    <section className="booth-stand-setup" aria-labelledby="booth-stand-setup">
      <h2 id="booth-stand-setup" className="check-h2">
        {t(lang, "assessment.tips.boothStand")}
      </h2>
      <ul className="booth-tips">
        {setup.map((line, k) => (
          <li key={k} className="booth-tip">
            <span className="booth-tip-icon">
              <CheckIcon name="badge" />
            </span>
            <span>{bidiText(lang, line)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SetupTipsView({ wheelchair, onBack }: { wheelchair: boolean; onBack(): void }) {
  const { lang, booth } = useCheckUi();
  return (
    <CheckShell
      onBack={onBack}
      exit={false}
      footer={{ primary: { label: t(lang, "assessment.tips.back"), onClick: onBack } }}
    >
      <div className="booth-screen" data-screen="S58">
        <h1>{t(lang, "assessment.tips.title")}</h1>
        <SetupTipsList wheelchair={wheelchair} />
        {booth && <BoothStandSetup />}
      </div>
    </CheckShell>
  );
}

/** Whether the person of this check uses a wheelchair (guest step or intake). */
export function usesWheelchair(model: ScreenProps["model"]): boolean {
  const d = model.data;
  return d.guest.position === "wheelchair" || d.signedIn?.ctx?.position === "wheelchair";
}

/** S58 in the screen registry: Back returns where the flow allows it. */
export function SetupTipsScreen({ model, dispatch }: ScreenProps) {
  return (
    <SetupTipsView
      wheelchair={usesWheelchair(model)}
      onBack={() => {
        if (backTarget(model)) dispatch({ type: "BACK" });
      }}
    />
  );
}
