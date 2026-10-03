/**
 * Steps 2 and 3 (contract C3 and C4).
 *
 *   EngineStep  createPlan runs on the phone: three groups animate in, included ✓ (the camera
 *               movements and the safe library count), adapted (the dose the condition changed),
 *               excluded ✗ with the reason. A plan held for review shows why, calmly.
 *   GoalStep    the goal chips; «العودة إلى الرياضة» · Back to sport opens the sport grid, the
 *               sports that suit the person's position first. Story mode has wheelchair basketball.
 */
import type { Lang } from "../../app/i18n";
import { optionNames, reasonText } from "../../app/platform-copy";
import SportIcon from "../../app/SportIcon";
import type { Intake, Plan } from "../../medical/plan";
import { goalOptions } from "../../medical/plan";
import { sportsFor, type SportId } from "../../medical/sports";
import BoothIcon from "./BoothIcon";
import { boothCopy } from "./copy";
import type { Goal } from "./intake";
import type { Door } from "./journey";
import { Actions, StepHead, stepKicker } from "./parts";
import { engineView, type EngineItem } from "./views";

export function EngineStep({
  lang,
  door,
  intake,
  plan,
  onBack,
  onNext,
}: {
  lang: Lang;
  door: Door;
  intake: Intake;
  plan: Plan;
  onBack(): void;
  onNext(): void;
}) {
  const k = boothCopy(lang);
  const v = engineView(intake, plan, lang, reasonText);
  const title = door === "story" ? k.engineTitleStory : k.engineTitleSelf;
  return (
    <div className="bx-engine" data-screen="engine" data-status={v.status}>
      <StepHead kicker={stepKicker(lang, 1)} title={title} body={k.engineBody} />
      {v.status === "review" ? (
        <section className="bx-review" role="status">
          <span className="bx-review-icon">
            <BoothIcon name="shield" size={30} />
          </span>
          <h2>{k.reviewTitle}</h2>
          <p>{k.reviewBody}</p>
          <ul>
            {v.review.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="bx-groups">
          <Group kind="in" title={k.included} icon="check" col={0}>
            {v.included.map((e, i) => (
              <Item key={e.id} item={e} i={i} mark="check" />
            ))}
            {v.library > 0 && (
              <li className="bx-item lib" style={{ ["--i" as string]: v.included.length }}>
                <BoothIcon name="spark" size={18} />
                <span>{k.library(v.library)}</span>
              </li>
            )}
          </Group>
          <Group kind="adapt" title={k.adapted} icon="adapt" col={1}>
            {v.adapted.map((e, i) => (
              <Item key={e.id} item={e} i={i} mark="adapt" />
            ))}
          </Group>
          <Group kind="out" title={k.excluded} icon="cross" col={2}>
            {v.excluded.length ? (
              v.excluded.map((e, i) => <Item key={e.id} item={e} i={i} mark="cross" />)
            ) : (
              <li className="bx-item quiet" style={{ ["--i" as string]: 0 }}>
                {k.noneExcluded}
              </li>
            )}
          </Group>
        </div>
      )}
      <Actions lang={lang} onBack={onBack} primary={{ label: k.next, onClick: onNext }} />
    </div>
  );
}

function Group({
  kind,
  title,
  icon,
  col,
  children,
}: {
  kind: "in" | "adapt" | "out";
  title: string;
  icon: string;
  col: number;
  children: React.ReactNode;
}) {
  return (
    <section className={`bx-group ${kind}`} style={{ ["--col" as string]: col }} data-group={kind}>
      <h2>
        <span className="bx-group-icon">
          <BoothIcon name={icon} size={20} />
        </span>
        {title}
      </h2>
      <ul>{children}</ul>
    </section>
  );
}

function Item({ item, i, mark }: { item: EngineItem; i: number; mark: string }) {
  return (
    <li className="bx-item" style={{ ["--i" as string]: i }} data-item={item.id}>
      <span className="bx-item-mark" aria-hidden="true">
        <BoothIcon name={mark} size={16} />
      </span>
      <span className="bx-item-text">
        <b>{item.title}</b>
        {item.note && <small>{item.note}</small>}
      </span>
      {item.value && (
        <span className="bx-item-value">
          <b>{item.value}</b>
          {item.base && <small>{item.base}</small>}
        </span>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ goal */

export function GoalStep({
  lang,
  door,
  position,
  goal,
  sport,
  onGoal,
  onSport,
  onBack,
  onNext,
}: {
  lang: Lang;
  door: Door;
  position: string;
  goal: Goal | null;
  sport: SportId | null;
  onGoal(g: Goal): void;
  onSport(s: SportId): void;
  onBack(): void;
  onNext(): void;
}) {
  const k = boothCopy(lang);
  const ready = goal !== null && (goal !== "sport" || sport !== null);
  return (
    <div className="bx-goal" data-screen="goal" data-goal={goal ?? ""}>
      <StepHead
        kicker={stepKicker(lang, 2)}
        title={door === "story" ? k.goalTitleStory : k.goalTitleSelf}
        body={k.goalBody}
      />
      <div
        className="bx-goals"
        role="radiogroup"
        aria-label={door === "story" ? k.goalTitleStory : k.goalTitleSelf}
      >
        {goalOptions.map((g) => (
          <button
            key={g}
            type="button"
            role="radio"
            aria-checked={goal === g}
            className={`bx-goal-pick${goal === g ? " on" : ""}${g === "sport" ? " sport" : ""}`}
            onClick={() => onGoal(g)}
            data-pick={g}
          >
            <span className="bx-goal-icon">
              <SportIcon icon={g} size={26} />
            </span>
            <b>{optionNames[g]?.[lang] ?? g}</b>
          </button>
        ))}
      </div>
      {goal === "sport" && (
        <section className="bx-sports" aria-label={k.sportTitle}>
          <h2 className="bx-h2">{k.sportTitle}</h2>
          <div className="bx-sport-grid" role="radiogroup" aria-label={k.sportTitle}>
            {sportsFor(position).map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={sport === s.id}
                className={`bx-sport${sport === s.id ? " on" : ""}`}
                style={{ ["--i" as string]: i }}
                onClick={() => onSport(s.id)}
                data-sport={s.id}
              >
                <span className="bx-sport-icon">
                  <SportIcon icon={s.icon} size={30} />
                </span>
                <span>{s.name[lang]}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <Actions lang={lang} onBack={onBack} primary={{ label: k.next, onClick: onNext, disabled: !ready }} />
    </div>
  );
}
