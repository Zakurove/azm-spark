/**
 * The booth home (contract C1): two big doors, «قصة سعد» · Saad's story and «جرّبه بنفسك» · Try it
 * as yourself, on the landing's light stage with the 3D athlete renders. No time is named (D-017).
 */
import type { Lang } from "../../app/i18n";
import SportIcon from "../../app/SportIcon";
import BoothIcon from "./BoothIcon";
import { boothCopy } from "./copy";
import type { Door } from "./journey";
import { StepHead } from "./parts";
import { SAAD } from "./story";

export default function Home({ lang, onOpen }: { lang: Lang; onOpen(door: Door): void }) {
  const k = boothCopy(lang);
  return (
    <div className="bx-home" data-screen="home">
      <StepHead kicker={k.homeKicker} title={k.homeTitle} body={k.homeBody} center />
      <div className="bx-doors">
        <button type="button" className="bx-door story" onClick={() => onOpen("story")} data-door="story">
          <span className="bx-door-stage" aria-hidden="true">
            <span className="bx-door-disc" />
            <img src="/illustrations/landing/wheelchair-press.webp" alt="" />
            <span className="bx-door-badge">
              <SportIcon icon="wheelchair_basketball" size={26} />
            </span>
          </span>
          <span className="bx-door-text">
            <span className="bx-door-tag">{k.storyDoorTag}</span>
            <b>{k.storyDoor}</b>
            <span className="bx-door-line">{SAAD.teaser[lang]}</span>
          </span>
          <span className="bx-door-go" aria-hidden="true">
            <BoothIcon name="arrow" size={26} />
          </span>
        </button>
        <button type="button" className="bx-door self" onClick={() => onOpen("self")} data-door="self">
          <span className="bx-door-stage" aria-hidden="true">
            <span className="bx-door-disc" />
            <img src="/illustrations/landing/chair-press.webp" alt="" />
            <span className="bx-door-badge">
              <BoothIcon name="user" size={24} />
            </span>
          </span>
          <span className="bx-door-text">
            <span className="bx-door-tag">{k.selfDoorTag}</span>
            <b>{k.selfDoor}</b>
            <span className="bx-door-line">{k.selfDoorLine}</span>
          </span>
          <span className="bx-door-go" aria-hidden="true">
            <BoothIcon name="arrow" size={26} />
          </span>
        </button>
      </div>
    </div>
  );
}
