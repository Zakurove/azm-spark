/**
 * The gait card of the findings page (product v7 contract 2.8.4, stream C, step C4): the pattern
 * labels in plain words, and the possible reasons and targets once the findings are final (labels
 * only while provisional, C-13).
 *
 * Placeholder of step A5 (contract 1.3), replaced by C4: it renders nothing.
 */
import type { Lang } from "../../app/i18n";
import type { GaitStoredView } from "../../medical/gait-types";

export interface GaitFindingsCardProps {
  gait: GaitStoredView;
  lang: Lang;
}

export function GaitFindingsCard(_props: GaitFindingsCardProps): null {
  return null;
}
