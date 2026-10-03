import type { Plan } from "./plan";

type L = { ar: string; en: string };

/**
 * "Why this program?" on the Program page, in two short lines (booth v2, B7): what decided it, then
 * how the dose fits the person. The weekly plan keeps its own reasons and tips.
 */
export function programWhy(plan: Plan): [L, L] {
  const first: L = {
    ar: "اخترنا ما يناسب حالتك الطبية ووضعيتك، وتركنا ما لا يناسبك.",
    en: "Chosen for your medical condition and position, leaving out what does not suit you.",
  };
  if (plan.notes.includes("fatigue"))
    return [
      first,
      {
        ar: "مجموعات أخف وراحة أطول، بما يناسب حالتك.",
        en: "Lighter sets and longer rests, to suit your condition.",
      },
    ];
  if (plan.notes.includes("temperature"))
    return [
      first,
      {
        ar: "راعينا حساسية الحرارة، فتمرّن في مكان معتدل.",
        en: "We allowed for heat sensitivity, so train somewhere cool.",
      },
    ];
  return [
    first,
    {
      ar: "المجموعات والراحة محسوبة بقواعد حالتك الطبية.",
      en: "Sets and rests follow the rules for your medical condition.",
    },
  ];
}
