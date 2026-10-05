/**
 * The names of the focus check's regions and movements (product v7 contract B3 and B4), read from the
 * range data only, so a page that names joints (the findings page, the range screens) never loads the
 * v1 check data with them. Pure, no DOM.
 */
import type { Lang } from "../../app/i18n";
import type { RegionId } from "../../medical/body-map";
import { defaultDef, movementDef, ROM_DATA } from "../../movements/rom";
import { ROM_MOVEMENT_IDS } from "../../movements/rom/types";
import type { DefaultOnlyId, JointMovementId, RomMovementId, RomSide } from "../../movements/rom/types";

/** A region's name; lower case in English inside a sentence («الركبة» · "knee"). */
export function regionName(region: RegionId, lang: Lang, inSentence = false): string {
  const r = ROM_DATA.regions.find((x) => x.id === region);
  const name = r ? r[lang] : region;
  return lang === "en" && inSentence ? name.toLowerCase() : name;
}

/** Arabic regions whose side word is feminine: الركبة, الرقبة, and الكاحل والقدم (the word follows القدم, as the intake's «القدم اليمنى»); the others take the masculine one. */
const FEMININE_REGIONS = new Set<RegionId>(["knee", "neck", "ankle_foot"]);

/** «الركبة اليمنى» · "Right knee": the region and the side, as the person sees them. */
export function sideRegion(i: { region: RegionId; side: RomSide }, lang: Lang): string {
  const region = regionName(i.region, lang);
  if (i.side === "none") return region;
  const w = ROM_DATA.sideWords;
  if (lang === "en")
    return `${w.side[i.side][0].toUpperCase()}${w.side[i.side].slice(1)} ${regionName(i.region, lang, true)}`;
  // The region's own gender decides the side word («الركبة اليمنى», «الكتف الأيمن»).
  const feminine = FEMININE_REGIONS.has(i.region);
  return `${region} ${feminine ? w.sideF[i.side] : w.sideM[i.side]}`;
}

const CAMERA_IDS: ReadonlySet<string> = new Set(ROM_MOVEMENT_IDS);

/** The name of any joint movement: a camera movement's, or a default only movement's («تدوير الكتف إلى الداخل»). */
export function jointName(id: JointMovementId, lang: Lang): string {
  return CAMERA_IDS.has(id)
    ? movementDef(id as RomMovementId).name[lang]
    : defaultDef(id as DefaultOnlyId)[lang];
}
