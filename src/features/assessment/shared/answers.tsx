/**
 * Large answer controls (UX spec principle 2, S17, 5.4):
 *   AnswerButtons      one answer; full width rows of 64 px, 12 px apart, in data order, none
 *                      preselected. mode "submit": a tap submits (Q18 (2)); mode "select": a tap
 *                      selects and the footer's Next submits (pain scales, S03, guest multi steps).
 *   MultiAnswerList    several answers with an exclusive "none" that clears the others.
 *   useNextWithHint    the select then Next rule: Next is never disabled; without an answer it shows
 *                      "Choose an answer to continue." under the question and moves focus to the first
 *                      answer row.
 * The group is labelled by the question (aria-labelledby); each row is a button with aria-pressed.
 */
import { useEffect, useId, useRef, useState, type RefObject } from "react";
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
  /** The hint of useNextWithHint (its id), read when focus enters the group. */
  describedBy?: string;
  groupRef?: RefObject<HTMLDivElement>;
}

export function AnswerButtons<T extends string>({
  labelledBy,
  options,
  value,
  mode = "submit",
  onSubmit,
  describedBy,
  groupRef,
}: AnswerButtonsProps<T>) {
  return (
    <div
      className="check-answers"
      role="group"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      ref={groupRef}
    >
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

/**
 * The rows in the order they show: the data order (principle 2), except where the spec puts the
 * exclusive "none" first (S08 conditions, Q19): exclusiveFirst.
 */
export function orderedOptions<T extends string>(
  options: readonly AnswerOption<T>[],
  exclusive?: T,
  exclusiveFirst = false,
): AnswerOption<T>[] {
  if (!exclusive || !exclusiveFirst) return [...options];
  return [...options.filter((o) => o.value === exclusive), ...options.filter((o) => o.value !== exclusive)];
}

export interface MultiAnswerListProps<T extends string> {
  labelledBy: string;
  options: AnswerOption<T>[];
  value: T[];
  exclusive?: T;
  /** The exclusive option first (S08 only, Q19); otherwise the data order. */
  exclusiveFirst?: boolean;
  onChange(v: T[]): void;
  describedBy?: string;
  groupRef?: RefObject<HTMLDivElement>;
}

export function MultiAnswerList<T extends string>({
  labelledBy,
  options,
  value,
  exclusive,
  exclusiveFirst = false,
  onChange,
  describedBy,
  groupRef,
}: MultiAnswerListProps<T>) {
  const { lang } = useCheckUi();
  const clearsId = useId();
  return (
    <div
      className="check-answers"
      role="group"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      ref={groupRef}
    >
      {exclusive && (
        <span id={clearsId} className="check-visually-hidden">
          {t(lang, "assessment.common.noneClears")}
        </span>
      )}
      {orderedOptions(options, exclusive, exclusiveFirst).map((o) => (
        <button
          key={o.value}
          type="button"
          className="check-answer is-multiple"
          aria-pressed={value.includes(o.value)}
          aria-describedby={o.value === exclusive ? clearsId : undefined}
          onClick={() => onChange(toggleMulti(value, o.value, exclusive))}
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
 * Select then Next: the footer primary stays enabled; pressed without an answer it shows the hint
 * under the question (render `hint` right after the question, pass `describedBy` and `groupRef` to
 * the answer group) and moves focus to the first answer row. The one announcement is that focus move
 * into the group, which reads the hint as its description; the hint itself is not a live region.
 */
export function useNextWithHint(hasAnswer: boolean, onNext: () => void) {
  const { lang } = useCheckUi();
  const [tried, setTried] = useState(0);
  const hintId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const show = tried > 0 && !hasAnswer;
  // After the render that shows the hint, so the group is described by it when focus arrives.
  useEffect(() => {
    if (tried > 0) groupRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [tried]);
  return {
    primary: {
      label: t(lang, "assessment.common.next"),
      onClick: () => (hasAnswer ? onNext() : setTried((n) => n + 1)),
    },
    hint: show ? (
      <p id={hintId} className="check-field-error check-choose-hint">
        {t(lang, "assessment.common.chooseToContinue")}
      </p>
    ) : null,
    describedBy: show ? hintId : undefined,
    groupRef,
  };
}
