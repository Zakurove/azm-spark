import { useEffect } from "react";
import { COMPANY_EMAIL } from "./companyFlag";
import "./company.css";

/** D-041: Azm Spark Establishment, one page in Arabic and English (no header, no other page). */
const NATIONAL_NUMBER = "7055522556";

const SERVICES = [
  {
    key: "mobile",
    ar: {
      title: "تطوير تطبيقات الجوال",
      body: "تطبيقات iPhone و Android، من الفكرة والتصميم إلى النشر في المتجر.",
    },
    en: {
      title: "Mobile application development",
      body: "iPhone and Android apps, from idea and design to release in the stores.",
    },
    icon: (
      <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden>
        <rect
          x="6.5"
          y="2.5"
          width="11"
          height="19"
          rx="2.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <path d="M10.5 18.5h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: "ar",
    ar: {
      title: "تطوير الواقع المعزز",
      body: "تجارب واقع معزز تفاعلية على الهاتف والويب، تضع المحتوى الرقمي في العالم الحقيقي.",
    },
    en: {
      title: "Augmented reality development",
      body: "Interactive augmented reality experiences on phone and web that place digital content in the real world.",
    },
    icon: (
      <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden>
        <path
          d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4L12 2.8Zm0 0v9.2m0 0 8-4.6m-8 4.6-8-4.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
] as const;

export default function CompanyPage() {
  useEffect(() => {
    document.documentElement.lang = "ar";
    document.documentElement.dir = "rtl";
    document.title = "مؤسسة عزم سبارك | Azm Spark Establishment";
    // Any old link lands on the home address: this is the only page for now.
    if (location.pathname !== "/" || location.search) history.replaceState({}, "", "/");
  }, []);
  const mail = COMPANY_EMAIL ? `mailto:${COMPANY_EMAIL}` : undefined;
  return (
    <div className="co-shell" data-company-page>
      <main className="co-main">
        <p className="co-year" dir="ltr">
          2026
        </p>
        <section className="co-hero">
          <span className="co-glow co-glow-gold" aria-hidden />
          <span className="co-glow co-glow-violet" aria-hidden />
          <h1>
            <span className="co-name-ar">مؤسسة عزم سبارك</span>
            <span className="co-name-en" lang="en" dir="ltr">
              Azm Spark Establishment
            </span>
          </h1>
          <p className="co-lead">نطوّر تطبيقات الجوال وتجارب الواقع المعزز.</p>
          <p className="co-lead-en" lang="en" dir="ltr">
            Mobile application development and augmented reality development.
          </p>
          {mail && (
            <a className="co-cta" href={mail} data-action="contact">
              تواصل معنا <span lang="en">· Contact us</span>
            </a>
          )}
        </section>

        <section className="co-services" aria-labelledby="co-services-title">
          <h2 id="co-services-title">
            خدماتنا{" "}
            <span lang="en" dir="ltr">
              Our services
            </span>
          </h2>
          <div className="co-grid">
            {SERVICES.map((s) => (
              <article className="co-card" key={s.key}>
                <span className="co-icon">{s.icon}</span>
                <h3>{s.ar.title}</h3>
                <p>{s.ar.body}</p>
                <div className="co-card-en" lang="en" dir="ltr">
                  <h3>{s.en.title}</h3>
                  <p>{s.en.body}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="co-contact" aria-labelledby="co-contact-title">
          <h2 id="co-contact-title">
            تواصل معنا{" "}
            <span lang="en" dir="ltr">
              Contact us
            </span>
          </h2>
          <p>لطلب خدماتنا أو لأي استفسار، راسلنا على البريد الإلكتروني.</p>
          <p lang="en" dir="ltr">
            To request our services or for any question, email us.
          </p>
          {mail && (
            <a className="co-cta" href={mail} data-action="contact_email" dir="ltr">
              {COMPANY_EMAIL}
            </a>
          )}
        </section>
      </main>
      <footer className="co-footer">
        <p>
          مؤسسة عزم سبارك · الرقم الوطني الموحد: <span dir="ltr">{NATIONAL_NUMBER}</span>
        </p>
        <p lang="en" dir="ltr">
          Azm Spark Establishment · National Number: {NATIONAL_NUMBER}
        </p>
        <p className="co-copy" dir="ltr">
          © 2026 Azm Spark Establishment
        </p>
      </footer>
    </div>
  );
}
