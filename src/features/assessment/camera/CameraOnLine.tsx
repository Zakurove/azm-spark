/**
 * «الكاميرا تعمل، والفيديو يبقى على هاتفك» · The camera is on, and the video stays on your phone
 * (assessment.hud.cameraOn): shown wherever the camera keeps running under a screen that is not the
 * camera stage (S29, S38, S38b), for as long as it runs (principle 13).
 */
import { t } from "../../../i18n";
import CheckIcon from "../shared/CheckIcon";
import { useCheckUi } from "../shared/CheckUi";

export function CameraOnLine({ on }: { on: boolean }) {
  const { lang } = useCheckUi();
  if (!on) return null;
  return (
    <p className="check-meta check-camera-on" data-camera-on="">
      <CheckIcon name="camera" size={20} />
      <span>{t(lang, "assessment.hud.cameraOn")}</span>
    </p>
  );
}
