/**
 * Placeholder screen of the round 3 foundation. The parallel streams replace each stub in their
 * folder's index.ts with the real screen; until then the stub shows the screen id and its title from
 * the copy (or the check data), inside the real shell, with Back where the flow allows it.
 */
import type { Lang } from "../../../app/i18n";
import { backTarget, type FlowModel } from "../flowMachine";
import type { ScreenComponent, ScreenProps } from "../screenTypes";
import { CheckShell } from "./CheckShell";
import { useCheckUi } from "./CheckUi";

export interface StubOptions {
  /** The full wordmark in the content header (S05, S12, S14, S50 to S54). */
  brand?: boolean;
  /** Hide Exit (safety screens). */
  noExit?: boolean;
}

export function ScreenStubView({
  id,
  title,
  brand,
  exit = true,
  onBack,
}: {
  id: string;
  title: string;
  brand?: boolean;
  exit?: boolean;
  onBack?: () => void;
}) {
  return (
    <CheckShell brand={brand} exit={exit} onBack={onBack}>
      <div className="check-stub" data-screen={id}>
        <h1>{title}</h1>
        <span className="check-chip check-stub-id" lang="en" dir="ltr">
          {id}
        </span>
      </div>
    </CheckShell>
  );
}

/** A stub screen whose title comes from the copy or the check data for the current state. */
export function stub(
  id: string,
  titleOf: (lang: Lang, model: FlowModel) => string,
  opts: StubOptions = {},
): ScreenComponent {
  function Stub({ model, dispatch }: ScreenProps) {
    const { lang } = useCheckUi();
    const back = backTarget(model) ? () => dispatch({ type: "BACK" }) : undefined;
    return (
      <ScreenStubView
        id={id}
        title={titleOf(lang, model)}
        brand={opts.brand}
        exit={!opts.noExit}
        onBack={back}
      />
    );
  }
  Stub.displayName = `Stub${id}`;
  return Stub;
}
