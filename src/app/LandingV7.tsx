import type { Lang } from "./i18n";
import ar from "../i18n/ar/landing.json?v7";
import en from "../i18n/en/landing.json?v7";
import { Illustration } from "../features/visuals/Illustration";
import "./landing-v7.css";

const sections = ["range", "walk", "coach"] as const;

export default function LandingV7({ lang }: { lang: Lang }) {
  const dictionary = lang === "ar" ? ar : en;
  return (
    <div className="ld-v7" lang={lang}>
      {sections.map((name) => {
        const copy = dictionary[name];
        return (
          <section className="ld-v7-section" key={name} aria-labelledby={`ld-v7-${name}`}>
            <div className="ld-v7-copy">
              <h2 id={`ld-v7-${name}`}>{copy.title}</h2>
              <p>{copy.body}</p>
              <ul>
                {Object.values(copy.points).map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
            <Illustration group="landing" name={`v7_landing_${name}`} alt={copy.alt} lang={lang} phone />
          </section>
        );
      })}
    </div>
  );
}
