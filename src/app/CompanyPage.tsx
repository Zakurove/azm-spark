import { useEffect, useState } from "react";
import { COMPANY_EMAIL } from "./companyFlag";
import { AppsArt, ArArt, HeroArt, ICONS } from "./companyArt";
import "./company.css";

/**
 * D-041 (temporary): the website of Azm Spark Establishment, one page in Arabic (default) and English:
 * mobile application development and augmented reality development, how augmented reality works and
 * where it is used, how we work, the technologies, contact, and the national number. No client, number
 * or testimonial is claimed: only what the establishment does.
 */
const NATIONAL_NUMBER = "7055522556";
type Lang = "ar" | "en";
type IconName = keyof typeof ICONS;

const COPY = {
  ar: {
    title: "مؤسسة عزم سبارك | تطوير تطبيقات الجوال والواقع المعزز",
    description: "مؤسسة عزم سبارك: تطوير تطبيقات الجوال لأجهزة iPhone و Android، وتطوير تجارب الواقع المعزز.",
    nav: { services: "خدماتنا", ar: "الواقع المعزز", process: "كيف نعمل", contact: "تواصل معنا" },
    lang: "English",
    hero: {
      badge: "مؤسسة تقنية سعودية",
      title: "نطوّر تطبيقات الجوال وتجارب الواقع المعزز",
      body: "في مؤسسة عزم سبارك نحوّل فكرتك إلى تطبيق جوال سهل وسريع، وإلى تجربة واقع معزز تجعل المحتوى الرقمي جزءًا من العالم من حولك.",
      contact: "تواصل معنا",
      services: "استكشف خدماتنا",
      points: ["iPhone و Android", "واقع معزز على الهاتف والمتصفح", "واجهات عربية أولًا"],
    },
    services: {
      kicker: "خدماتنا",
      title: "خدمتان نتقنهما من الفكرة إلى الإطلاق",
      apps: {
        title: "تطوير تطبيقات الجوال",
        body: "نصمم ونبني تطبيقات أصلية ومتعددة المنصات، بواجهات واضحة وأداء سريع، ونرافقك حتى النشر في المتاجر وما بعده.",
        items: [
          "تطبيقات iPhone و Android",
          "تصميم الواجهات وتجربة المستخدم",
          "تطبيقات متعددة المنصات بقاعدة كود واحدة",
          "ربط التطبيق بالخوادم وواجهات البرمجة",
          "النشر في App Store و Google Play",
          "الصيانة والتحديثات بعد الإطلاق",
        ],
      },
      ar: {
        title: "تطوير الواقع المعزز",
        body: "نبني تجارب تضع المجسمات والمعلومات الرقمية في المكان الحقيقي عبر كاميرا الهاتف، ليراها المستخدم ويتفاعل معها.",
        items: [
          "واقع معزز على الهاتف باستخدام ARKit و ARCore",
          "واقع معزز عبر المتصفح دون تحميل تطبيق",
          "عرض المنتجات بأبعادها الحقيقية في مكانها",
          "تجارب تفاعلية للتسويق والفعاليات",
          "محاكاة للتعليم والتدريب",
          "تتبّع الجسم والحركة بالكاميرا والذكاء الاصطناعي",
        ],
      },
    },
    explain: {
      kicker: "الواقع المعزز",
      title: "ما هو الواقع المعزز؟",
      body: "الواقع المعزز يضيف محتوى رقميًا فوق ما تراه كاميرا الهاتف: مجسمًا ثلاثي الأبعاد، أو معلومة، أو حركة، في مكانها الصحيح من الغرفة. بخلاف الواقع الافتراضي، يبقى المستخدم في عالمه الحقيقي ويرى الإضافة جزءًا منه.",
      steps: [
        {
          icon: "scan",
          title: "الكاميرا تفهم المكان",
          body: "يتعرّف التطبيق على الأرضيات والجدران والمسافات من حولك.",
        },
        {
          icon: "cube",
          title: "نضع المحتوى في مكانه",
          body: "يظهر المجسم أو المعلومة ثابتًا في مكانه، بالحجم والزاوية الصحيحين.",
        },
        {
          icon: "hand",
          title: "تتفاعل معه مباشرة",
          body: "تقترب منه وتدور حوله وتلمسه لتغيّره، كأنه أمامك فعلًا.",
        },
      ],
      usesTitle: "أين يُستخدم الواقع المعزز؟",
      uses: [
        {
          icon: "bag",
          title: "التجارة والتجزئة",
          body: "جرّب المنتج في بيتك قبل الشراء: أثاث وأجهزة وديكور بحجمها الحقيقي.",
        },
        {
          icon: "cap",
          title: "التعليم والتدريب",
          body: "دروس ومحاكاة تفاعلية تشرح الأجهزة والمفاهيم خطوة بخطوة.",
        },
        {
          icon: "home",
          title: "العقار والتصميم الداخلي",
          body: "معاينة المخططات والتصاميم في الموقع قبل التنفيذ.",
        },
        {
          icon: "spark",
          title: "التسويق والفعاليات",
          body: "تجارب لافتة في المعارض والحملات يشاركها الجمهور.",
        },
        {
          icon: "pulse",
          title: "الصحة واللياقة",
          body: "تحليل الحركة بالكاميرا وتوجيه التمارين في الوقت الفعلي.",
        },
        {
          icon: "landmark",
          title: "السياحة والتراث",
          body: "إحياء المواقع والقطع التاريخية بمعلومات وقصص تظهر في مكانها.",
        },
      ],
    },
    process: {
      kicker: "كيف نعمل",
      title: "أربع خطوات واضحة من الفكرة إلى الإطلاق",
      steps: [
        {
          icon: "chat",
          title: "الاكتشاف والتخطيط",
          body: "نفهم هدفك وجمهورك، ونحدد نطاق العمل والمزايا والجدول الزمني.",
        },
        {
          icon: "pen",
          title: "التصميم والنموذج الأولي",
          body: "نصمم الواجهات والتجربة، ونبني نموذجًا تجربه قبل التطوير.",
        },
        {
          icon: "code",
          title: "التطوير والاختبار",
          body: "نطوّر على مراحل قصيرة، ونختبر على أجهزة حقيقية في كل مرحلة.",
        },
        {
          icon: "rocket",
          title: "الإطلاق والدعم",
          body: "ننشر التطبيق في المتاجر، ونتابع الأداء والتحديثات بعد الإطلاق.",
        },
      ],
    },
    why: {
      kicker: "لماذا عزم سبارك",
      title: "ما يميز عملنا",
      items: [
        {
          icon: "globe",
          title: "العربية أولًا",
          body: "واجهات تدعم العربية والكتابة من اليمين لليسار بإتقان، مع الإنجليزية بالجودة نفسها.",
        },
        {
          icon: "eye",
          title: "خبرة في الرؤية الحاسوبية",
          body: "طوّرنا تقنيات تحلل حركة الجسم بكاميرا الهاتف، ونوظفها في تجارب الواقع المعزز.",
        },
        {
          icon: "rocket",
          title: "من الفكرة إلى المتجر",
          body: "فريق واحد يرافقك في التخطيط والتصميم والتطوير والنشر.",
        },
        {
          icon: "shield",
          title: "خصوصية وأمان",
          body: "نبني تطبيقات تحمي بيانات المستخدمين وتلتزم بالأنظمة المحلية.",
        },
      ],
    },
    tech: { title: "تقنيات نعمل بها" },
    contact: {
      title: "لديك فكرة تطبيق أو تجربة واقع معزز؟",
      body: "أخبرنا عنها، ونعود إليك بتصور أولي للعمل.",
      button: "راسلنا على البريد",
    },
    footer: {
      line: "تطوير تطبيقات الجوال والواقع المعزز.",
      name: "مؤسسة عزم سبارك",
      number: "الرقم الوطني الموحد",
    },
  },
  en: {
    title: "Azm Spark Establishment | Mobile app and augmented reality development",
    description:
      "Azm Spark Establishment: mobile application development for iPhone and Android, and augmented reality development.",
    nav: { services: "Services", ar: "Augmented reality", process: "How we work", contact: "Contact us" },
    lang: "العربية",
    hero: {
      badge: "A Saudi technology establishment",
      title: "We build mobile apps and augmented reality experiences",
      body: "At Azm Spark Establishment we turn your idea into a fast, easy mobile app, and into augmented reality experiences that make digital content part of the world around you.",
      contact: "Contact us",
      services: "Explore our services",
      points: ["iPhone and Android", "Augmented reality on phone and web", "Arabic first interfaces"],
    },
    services: {
      kicker: "Our services",
      title: "Two services we master, from idea to launch",
      apps: {
        title: "Mobile application development",
        body: "We design and build native and cross platform apps with clear interfaces and fast performance, and stay with you through store release and beyond.",
        items: [
          "iPhone and Android apps",
          "User interface and experience design",
          "Cross platform apps from one code base",
          "Servers and API integration",
          "Release on the App Store and Google Play",
          "Maintenance and updates after launch",
        ],
      },
      ar: {
        title: "Augmented reality development",
        body: "We build experiences that place 3D objects and digital information in the real world through the phone camera, for people to see and interact with.",
        items: [
          "Mobile augmented reality with ARKit and ARCore",
          "Web augmented reality, with no app to install",
          "Products shown at their true size, in place",
          "Interactive experiences for marketing and events",
          "Simulations for education and training",
          "Body and motion tracking with the camera and AI",
        ],
      },
    },
    explain: {
      kicker: "Augmented reality",
      title: "What is augmented reality?",
      body: "Augmented reality adds digital content on top of what the phone camera sees: a 3D object, a piece of information or an animation, in its right place in the room. Unlike virtual reality, people stay in their real world and see the addition as part of it.",
      steps: [
        {
          icon: "scan",
          title: "The camera understands the space",
          body: "The app recognises the floors, walls and distances around you.",
        },
        {
          icon: "cube",
          title: "Content is placed where it belongs",
          body: "The object or information stays fixed in place, at the right size and angle.",
        },
        {
          icon: "hand",
          title: "You interact with it directly",
          body: "Walk up to it, move around it and touch it to change it, as if it were really there.",
        },
      ],
      usesTitle: "Where is augmented reality used?",
      uses: [
        {
          icon: "bag",
          title: "Retail and online stores",
          body: "Try products at home before buying: furniture, devices and decor at their true size.",
        },
        {
          icon: "cap",
          title: "Education and training",
          body: "Interactive lessons and simulations that explain equipment and ideas step by step.",
        },
        {
          icon: "home",
          title: "Real estate and interior design",
          body: "Preview plans and designs on site before they are built.",
        },
        {
          icon: "spark",
          title: "Marketing and events",
          body: "Striking experiences at exhibitions and campaigns that people share.",
        },
        {
          icon: "pulse",
          title: "Health and fitness",
          body: "Movement analysis with the camera and real time exercise guidance.",
        },
        {
          icon: "landmark",
          title: "Tourism and heritage",
          body: "Bring sites and artefacts to life with stories that appear in place.",
        },
      ],
    },
    process: {
      kicker: "How we work",
      title: "Four clear steps from idea to launch",
      steps: [
        {
          icon: "chat",
          title: "Discovery and planning",
          body: "We understand your goal and audience, and agree the scope, features and timeline.",
        },
        {
          icon: "pen",
          title: "Design and prototype",
          body: "We design the interfaces and experience, and build a prototype you can try before development.",
        },
        {
          icon: "code",
          title: "Development and testing",
          body: "We build in short stages and test on real devices at every stage.",
        },
        {
          icon: "rocket",
          title: "Launch and support",
          body: "We release the app in the stores and follow its performance and updates after launch.",
        },
      ],
    },
    why: {
      kicker: "Why Azm Spark",
      title: "What sets our work apart",
      items: [
        {
          icon: "globe",
          title: "Arabic first",
          body: "Interfaces that handle Arabic and right to left layouts properly, with English of the same quality.",
        },
        {
          icon: "eye",
          title: "Computer vision experience",
          body: "We have built technology that analyses body movement with the phone camera, and we bring it to augmented reality.",
        },
        {
          icon: "rocket",
          title: "From idea to store",
          body: "One team with you through planning, design, development and release.",
        },
        {
          icon: "shield",
          title: "Privacy and security",
          body: "We build apps that protect their users' data and follow local regulations.",
        },
      ],
    },
    tech: { title: "Technologies we work with" },
    contact: {
      title: "Have an idea for an app or an augmented reality experience?",
      body: "Tell us about it, and we will come back to you with a first plan.",
      button: "Email us",
    },
    footer: {
      line: "Mobile application and augmented reality development.",
      name: "Azm Spark Establishment",
      number: "National Number",
    },
  },
} as const;

const TECH = [
  "Swift",
  "Kotlin",
  "React Native",
  "Expo",
  "ARKit",
  "ARCore",
  "WebXR",
  "Three.js",
  "MediaPipe",
  "Node.js",
];

function setHead(lang: Lang) {
  const c = COPY[lang];
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  document.title = c.title;
  const meta = (name: string) => {
    let m = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    if (!m) {
      m = document.createElement("meta");
      m.name = name;
      document.head.appendChild(m);
    }
    return m;
  };
  meta("description").content = c.description;
  for (const [rel, href] of [
    ["icon", "/brand/azm-spark-favicon.png"],
    ["apple-touch-icon", "/brand/azm-spark-touch.png"],
  ] as const) {
    document.querySelectorAll(`link[rel="${rel}"]`).forEach((l) => l.remove());
    const link = document.createElement("link");
    link.rel = rel;
    link.href = href;
    document.head.appendChild(link);
  }
}

export default function CompanyPage() {
  const [lang, setLang] = useState<Lang>(() =>
    typeof location !== "undefined" && new URLSearchParams(location.search).get("lang") === "en"
      ? "en"
      : "ar",
  );
  const c = COPY[lang];
  useEffect(() => {
    setHead(lang);
    // The only page for now: any other address lands here (the language kept).
    const home = lang === "en" ? "/?lang=en" : "/";
    if (location.pathname + location.search !== home) history.replaceState({}, "", home + location.hash);
  }, [lang]);
  const mail = COMPANY_EMAIL ? `mailto:${COMPANY_EMAIL}` : undefined;
  const brand = (
    <span className="co-brand">
      <img src="/brand/azm-spark-mark.png" alt="" width="40" height="42" />
      <img
        src={lang === "ar" ? "/brand/azm-spark-wordmark-ar.png" : "/brand/azm-spark-wordmark-en.png"}
        alt={c.footer.name}
        className={lang === "ar" ? "co-wordmark co-wordmark-ar" : "co-wordmark co-wordmark-en"}
      />
    </span>
  );
  return (
    <div className="co-shell" data-company-page lang={lang}>
      <header className="co-header">
        <div className="co-header-inner">
          <a className="co-home" href={lang === "en" ? "/?lang=en" : "/"} aria-label={c.footer.name}>
            {brand}
          </a>
          <nav className="co-nav" aria-label={c.nav.services}>
            <a href="#services">{c.nav.services}</a>
            <a href="#ar">{c.nav.ar}</a>
            <a href="#process">{c.nav.process}</a>
          </nav>
          <div className="co-header-actions">
            <button
              className="co-lang"
              type="button"
              lang={lang === "ar" ? "en" : "ar"}
              onClick={() => setLang(lang === "ar" ? "en" : "ar")}
            >
              {c.lang}
            </button>
            <a className="co-btn co-btn-small" href="#contact">
              {c.nav.contact}
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="co-hero">
          <div className="co-wrap co-hero-grid">
            <div className="co-hero-copy">
              <p className="co-badges">
                <span className="co-year" dir="ltr">
                  2026
                </span>
                <span className="co-badge">{c.hero.badge}</span>
              </p>
              <h1>{c.hero.title}</h1>
              <p className="co-lead">{c.hero.body}</p>
              <div className="co-actions">
                {mail && (
                  <a className="co-btn" href={mail} data-action="contact">
                    {ICONS.mail}
                    {c.hero.contact}
                  </a>
                )}
                <a className="co-btn co-btn-ghost" href="#services">
                  {c.hero.services}
                </a>
              </div>
              <ul className="co-points">
                {c.hero.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
            <HeroArt />
          </div>
        </section>

        <section className="co-section" id="services" aria-labelledby="co-services">
          <div className="co-wrap">
            <p className="co-kicker">{c.services.kicker}</p>
            <h2 id="co-services">{c.services.title}</h2>
            <div className="co-services">
              {(
                [
                  [c.services.apps, <AppsArt key="a" />],
                  [c.services.ar, <ArArt key="r" />],
                ] as const
              ).map(([s, art]) => (
                <article className="co-service" key={s.title}>
                  <div className="co-service-art">{art}</div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                  <ul className="co-checks">
                    {s.items.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="co-section co-section-tint" id="ar" aria-labelledby="co-ar">
          <div className="co-wrap">
            <p className="co-kicker">{c.explain.kicker}</p>
            <h2 id="co-ar">{c.explain.title}</h2>
            <p className="co-intro">{c.explain.body}</p>
            <ol className="co-steps">
              {c.explain.steps.map((s, i) => (
                <li className="co-step" key={s.title}>
                  <span className="co-step-num" dir="ltr">
                    0{i + 1}
                  </span>
                  <span className="co-icon">{ICONS[s.icon as IconName]}</span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ol>
            <h3 className="co-subtitle">{c.explain.usesTitle}</h3>
            <div className="co-uses">
              {c.explain.uses.map((u) => (
                <article className="co-use" key={u.title}>
                  <span className="co-icon co-icon-gold">{ICONS[u.icon as IconName]}</span>
                  <h4>{u.title}</h4>
                  <p>{u.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="co-section" id="process" aria-labelledby="co-process">
          <div className="co-wrap">
            <p className="co-kicker">{c.process.kicker}</p>
            <h2 id="co-process">{c.process.title}</h2>
            <ol className="co-process">
              {c.process.steps.map((s, i) => (
                <li key={s.title}>
                  <span className="co-process-num" dir="ltr">
                    0{i + 1}
                  </span>
                  <span className="co-icon">{ICONS[s.icon as IconName]}</span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="co-section co-section-tint" aria-labelledby="co-why">
          <div className="co-wrap">
            <p className="co-kicker">{c.why.kicker}</p>
            <h2 id="co-why">{c.why.title}</h2>
            <div className="co-why">
              {c.why.items.map((w) => (
                <article key={w.title}>
                  <span className="co-icon">{ICONS[w.icon as IconName]}</span>
                  <div>
                    <h3>{w.title}</h3>
                    <p>{w.body}</p>
                  </div>
                </article>
              ))}
            </div>
            <h3 className="co-subtitle">{c.tech.title}</h3>
            <ul className="co-tech" dir="ltr">
              {TECH.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="co-contact" id="contact" aria-labelledby="co-contact">
          <div className="co-wrap co-contact-inner">
            <img className="co-contact-mark" src="/brand/azm-spark-mark.png" alt="" width="64" height="67" />
            <h2 id="co-contact">{c.contact.title}</h2>
            <p>{c.contact.body}</p>
            {mail && (
              <a className="co-btn" href={mail} data-action="contact_email">
                {ICONS.mail}
                {c.contact.button}
              </a>
            )}
            {COMPANY_EMAIL && (
              <p className="co-email" dir="ltr">
                {COMPANY_EMAIL}
              </p>
            )}
          </div>
        </section>
      </main>

      <footer className="co-footer">
        <div className="co-wrap co-footer-grid">
          <div className="co-footer-brand">
            <img src="/brand/azm-spark-logo.png" alt={c.footer.name} width="150" height="93" />
            <p>{c.footer.line}</p>
          </div>
          <div className="co-footer-facts">
            <p>
              <b>{c.footer.name}</b>
            </p>
            <p>
              {c.footer.number}: <span dir="ltr">{NATIONAL_NUMBER}</span>
            </p>
            {COMPANY_EMAIL && (
              <p>
                <a href={mail} dir="ltr">
                  {COMPANY_EMAIL}
                </a>
              </p>
            )}
          </div>
        </div>
        <p className="co-copy" dir="ltr">
          © 2026 Azm Spark Establishment · مؤسسة عزم سبارك
        </p>
      </footer>
    </div>
  );
}
