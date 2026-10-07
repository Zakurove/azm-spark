/**
 * The program's build animation (D-032 item 3 and 4): a light, Arabic first visual of the medical
 * information and the camera's measurements turning into a training program, with a still version for
 * reduced motion. It plays after the check completes, and when the history builds the program (nothing
 * can be measured, or the person cannot use a camera); onDone opens the program.
 *
 * STUB: another engineer builds the real animation in this file, with these props. Until then it
 * renders nothing and calls onDone once on mount. Loaded lazily in VITE_V7=1 builds only (the focus
 * check imports it with the inline import.meta.env.VITE_V7 test).
 */
import { useEffect, useRef } from "react";
import type { Lang } from "../../app/i18n";

export default function ProgramBuild(props: {
  lang: Lang;
  onDone(): void;
  summary?: { joints: number; walk: boolean; exercises: number };
}): JSX.Element | null {
  const done = useRef(false);
  const onDone = useRef(props.onDone);
  onDone.current = props.onDone;
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    onDone.current();
  }, []);
  return null;
}
