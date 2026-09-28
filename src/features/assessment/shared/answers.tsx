/**
 * Large answer controls (UX spec principle 2, S17, 5.4):
 *   AnswerButtons      one answer; full width rows of 64 px, 12 px apart, in data order, none
 *                      preselected. mode "submit": a tap submits (Q18 (2)); mode "select": a tap
 *                      selects and the footer's Next submits (pain scales, S03, guest multi steps).
 *   MultiAnswerList    several answers with an exclusive "none" that clears the others.
 *   nextWithHint       the select then Next rule: Next is never disabled; without an answer it
 *                      shows "Choose an answer to continue." instead of moving on.
 * The group is labelled by the question (aria-labelledby); each row is a button with aria-pressed.
 */
import { useState } from "react";
import { t } from "../../../i18n";
import CheckIcon from "./CheckIcon";
import { useCheckUi } from "./CheckUi";

export interface AnswerOption<T extends string> {
  value: T;
  label: string;
}

export interface AnswerButtonsProps<T extends string> {
  labelledBy: string;
  options: AnswerOption<T>[];
  value: T | null;
  mode?: "submit" | "select";
  onSubmit(v: T): void;
}

export function AnswerButtons<T extends string>({
  labelledBy,
  options,
  value,
  mode = "submit",
  onSubmit,
}: AnswerButtonsProps<T>) {
  return (
    <div className="check-answers" role="group" aria-labelledby={labelledBy}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="check-answer"
          aria-pressed={value === o.value}
          onClick={() => onSubmit(o.value)}
          data-mode={mode}
        >
          <span className="check-answer-mark" aria-hidden="true">
            <CheckIcon name="check" size={18} />
          </span>
          <span className="check-answer-text">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The next value of a multiple choice list after a tap on `option`. The exclusive option clears the
 * others; any other option clears the exclusive one (S08, S10, S11: "Clears the other choices").
 */
export function toggleMulti<T extends string>(value: readonly T[], option: T, exclusive?: T): T[] {
  if (value.includes(option)) return value.filter((v) => v !== option);
  if (exclusive !== undefined && option === exclusive) return [option];
  return [...value.filter((v) => v !== exclusive), option];
}

export interface MultiAnswerListProps<T extends string> {
  labelledBy: string;
  options: AnswerOption<T>[];
  value: T[];
  exclusive?: T;
  onChange(v: T[]): void;
}

export function MultiAnswerList<T extends string>({
  labelledBy,
  options,
  value,
  exclusive,
  onChange,
}: MultiAnswerListProps<T>) {
  const { lang } = useCheckUi();
  // The exclusive option is rendered first (S08, Q19).
  const ordered = exclusive
    ? [...options.filter((o) => o.value === exclusive), ...options.filter((o) => o.value !== exclusive)]
    : options;
  return (
    <div className="check-answers" role="group" aria-labelledby={labelledBy}>
      {ordered.map((o) => (
        <button
          key={o.value}
          type="button"
          className="check-answer is-multiple"
          aria-pressed={value.includes(o.value)}
          onClick={() => onChange(toggleMulti(value, o.value, exclusive))}
        >
          <span className="check-answer-mark" aria-hidden="true">
            <CheckIcon name="check" size={18} />
          </span>
          <span className="check-answer-text">
            {o.label}
            {o.value === exclusive && (
              <span className="check-visually-hidden">{`, ${t(lang, "assessment.common.noneClears")}`}</span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Select then Next: the footer primary stays enabled; pressed without an answer it shows the hint
 * (role alert) and does nothing else. Returns the footer ButtonSpec and the hint to render.
 */
export function useNextWithHint(hasAnswer: boolean, onNext: () => void) {
  const { lang } = useCheckUi();
  const [tried, setTried] = useState(false);
  const why = tried && !hasAnswer ? t(lang, "assessment.common.chooseToContinue") : undefined;
  return {
    primary: {
      label: t(lang, "assessment.common.next"),
      onClick: () => (hasAnswer ? onNext() : setTried(true)),
      why,
    },
  };
}
