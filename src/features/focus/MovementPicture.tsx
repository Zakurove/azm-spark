import type { CSSProperties } from "react";
import type { Lang } from "../../app/i18n";
import { movementDef } from "../../movements/rom";
import type { RomMovementId, RomSide } from "../../movements/rom/types";
import { Illustration } from "../visuals/Illustration";

export interface MovementPictureProps {
  movementId: RomMovementId;
  side?: RomSide;
  lang: Lang;
  /** Preferred width in CSS pixels. Setup cards expand to the available space. */
  size?: number;
  wheelchair?: boolean;
}

/** The artwork shows the right side. Only the artwork mirrors, never the instructions. */
export function MovementPicture({
  movementId,
  side,
  lang,
  size = 120,
  wheelchair = false,
}: MovementPictureProps) {
  const variant = movementId === "trunk_lateral_flexion" && wheelchair ? "_wheelchair" : "";
  const name = movementDef(movementId).name[lang];
  const sideName =
    side === "left"
      ? lang === "ar"
        ? "الجهة اليسرى"
        : "left side"
      : side === "right"
        ? lang === "ar"
          ? "الجهة اليمنى"
          : "right side"
        : "";
  const seated =
    wheelchair && variant ? (lang === "ar" ? "باستخدام الكرسي المتحرك" : "using a wheelchair") : "";
  return (
    <span className="movement-picture" style={{ "--picture-size": `${size}px` } as CSSProperties}>
      <Illustration
        group="rom"
        name={`v7_rom_${movementId}${variant}`}
        alt={[name, sideName, seated].filter(Boolean).join(lang === "ar" ? "، " : ", ")}
        mirror={side === "left"}
        lang={lang}
      />
    </span>
  );
}

export default MovementPicture;
