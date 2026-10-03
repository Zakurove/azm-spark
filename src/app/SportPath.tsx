import type { Plan } from "../medical/plan";
import { DEMANDS, sportById, type Sport, type SportId } from "../medical/sports";
import { libraryById, sportPath, type WeeklyPlan } from "../medical/weekly";
import { EXERCISES } from "../exercises/defs";
import type { Lang } from "./i18n";
import Icon from "./Icon";
import SportIcon from "./SportIcon";

const copy = {
  ar: {
    title: (sport: string) => `طريقك إلى ${sport}`,
    body: "ما تحتاجه هذه الرياضة من جسمك، والتمارين التي تبنيه في أسبوعك.",
    later: "يأتي في مرحلة لاحقة من طريقك.",
    next: "الأندية واختبارات الجاهزية تأتي لاحقًا في طريقك.",
  },
  en: {
    title: (sport: string) => `Your path to ${sport.toLowerCase()}`,
    body: "What this sport asks of your body, and the exercises in your week that build it.",
    later: "Comes in a later stage of your path.",
    next: "Clubs and readiness checks come later on your path.",
  },
};

/**
 * "Your path to <sport>" (booth v2, B5), on the Program page and at the booth: each demand of the
 * sport with the exercises of this week that build it, the camera movements first. While the weekly
 * plan is being written, the demands it will fill wait with a soft shimmer.
 */
export default function SportPath({
  lang,
  sport,
  plan,
  weekly,
}: {
  lang: Lang;
  /** The sport, or its id (the Program page knows only the intake's id). */
  sport: Sport | SportId;
  plan: Plan;
  weekly: WeeklyPlan | null | undefined;
}) {
  const k = copy[lang];
  const known = typeof sport === "string" ? sportById(sport) : sport;
  if (!known) return null;
  const steps = sportPath(known, plan, weekly);
  const name = (id: string, camera: boolean) =>
    camera ? EXERCISES.find((e) => e.id === id)?.name[lang] : libraryById(id)?.name[lang];
  return (
    <section className="sport-path" aria-labelledby="sport-path-title">
      <span className="sport-path-glow" aria-hidden />
      <div className="sport-path-head">
        <span className="sport-path-disc">
          <SportIcon icon={known.icon} size={30} />
        </span>
        <div>
          <h2 id="sport-path-title">{k.title(known.name[lang])}</h2>
          <p>{k.body}</p>
        </div>
      </div>
      <ol className="sport-path-steps">
        {steps.map((step) => (
          <li key={step.demand}>
            <span className="sport-path-node" aria-hidden />
            <div>
              <h3>{DEMANDS[step.demand][lang]}</h3>
              {step.exercises.length > 0 && (
                <div className="sport-path-chips">
                  {step.exercises.slice(0, 3).map((e) => (
                    <span key={e.id} className={e.camera ? "camera" : undefined}>
                      {e.camera && <Icon name="camera" size={13} />}
                      {name(e.id, e.camera)}
                    </span>
                  ))}
                </div>
              )}
              {!weekly && <span className="sport-path-wait" aria-hidden />}
              {weekly && step.exercises.length === 0 && <p className="sport-path-later">{k.later}</p>}
            </div>
          </li>
        ))}
      </ol>
      <p className="sport-path-next">
        <Icon name="spark" size={15} />
        {k.next}
      </p>
    </section>
  );
}
