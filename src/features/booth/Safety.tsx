/**
 * The one safety question before the camera (contract C5), «هل تشعر الآن بألم في الصدر أو دوخة أو
 * توعك؟». No opens the camera; yes opens a calm stop screen with the emergency line (997 is named on
 * this emergency screen only, D-016 item 1).
 */
import type { Lang } from "../../app/i18n";
import BoothIcon from "./BoothIcon";
import { boothCopy } from "./copy";
import { Actions, StepHead } from "./parts";

export function SafetyStep({
  lang,
  onAnswer,
  onBack,
}: {
  lang: Lang;
  onAnswer(unwell: boolean): void;
  onBack(): void;
}) {
  const k = boothCopy(lang);
  return (
    <div className="bx-safety" data-screen="safety">
      <div className="bx-ask">
        <span className="bx-ask-icon" aria-hidden="true">
          <BoothIcon name="heart" size={34} />
        </span>
        <StepHead
          kicker={
            <>
              <span className="bx-kicker-n">{k.stepOf(4)}</span>
              <span className="bx-kicker-dot" aria-hidden="true" />
              <span>{k.safetyKicker}</span>
            </>
          }
          title={k.safetyAsk}
          center
        />
        <div className="bx-answers">
          <button type="button" className="bx-go wide" onClick={() => onAnswer(false)} data-answer="no">
            <BoothIcon name="check" size={22} />
            {k.safetyNo}
          </button>
          <button type="button" className="bx-answer" onClick={() => onAnswer(true)} data-answer="yes">
            {k.safetyYes}
          </button>
        </div>
      </div>
      <Actions lang={lang} onBack={onBack} />
    </div>
  );
}

export function StopStep({ lang, onReset }: { lang: Lang; onReset(): void }) {
  const k = boothCopy(lang);
  return (
    <div className="bx-safety" data-screen="stop">
      <div className="bx-ask stop" role="alert">
        <span className="bx-ask-icon calm" aria-hidden="true">
          <BoothIcon name="heart" size={34} />
        </span>
        <StepHead title={k.stopTitle} body={k.stopBody} center />
        <p className="bx-call-line">{k.stopCall}</p>
        <a className="bx-call" href="tel:997" data-call="997">
          <BoothIcon name="phone" size={24} />
          {k.stopCallButton}
        </a>
        <button type="button" className="bx-quiet" onClick={onReset} data-action="start-again">
          <BoothIcon name="reset" />
          {k.startAgain}
        </button>
      </div>
    </div>
  );
}
