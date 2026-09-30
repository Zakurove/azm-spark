/**
 * The pages App.tsx loads on demand (acceptance F-4: the landing's first script carries only what
 * the landing shows). While a page's code arrives, the loading screen; if it cannot arrive (the
 * connection dropped), a way to try again instead of an empty page.
 */
import { Component, Suspense, type ReactNode } from "react";
import Brand from "./Brand";
import type { Lang } from "./i18n";
import { errorText, labels } from "./platform-copy";

export function PageLoading({ lang }: { lang: Lang }) {
  return (
    <div className="portal-loading">
      <Brand />
      <p>{labels(lang).loading}</p>
    </div>
  );
}

interface BoundaryProps {
  lang: Lang;
  children: ReactNode;
}

/** Catches a page that failed to load or to render, and offers to load the app again. */
export class PageBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { lang } = this.props;
    return (
      <div className="portal-loading" role="alert">
        <Brand />
        <p>{errorText("PAGE_LOAD", lang)}</p>
        <button type="button" className="cta" onClick={() => location.reload()}>
          {labels(lang).retry}
        </button>
      </div>
    );
  }
}

/** A whole page loaded on demand. */
export function LazyPage({ lang, children }: BoundaryProps) {
  return (
    <PageBoundary lang={lang}>
      <Suspense fallback={<PageLoading lang={lang} />}>{children}</Suspense>
    </PageBoundary>
  );
}

/** A part of a page loaded on demand: nothing shows until it is there. */
export function LazyPart({ lang, children }: BoundaryProps) {
  return (
    <PageBoundary lang={lang}>
      <Suspense fallback={null}>{children}</Suspense>
    </PageBoundary>
  );
}
