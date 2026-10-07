# Azm v7 · landing copy (F2 draft)

4 October 2026 · stream F, step F2, the copy draft (no code, no commits, no Gemini or OpenAI call). For Nasser's review. F2 final (after E3) builds it into `src/app/Landing.tsx` and `src/i18n/{ar,en}/landing.json`, rendered only with `V7_UI` (contract 1.2 and the F2 row of section 10).

Read with: the contract's F2 row, section 9 (landing delta) and section 11; decisions D-016, D-017, D-019 and D-022 to D-025; the clinical copy (`rom-protocol.json` copy and results, `gait-rules.json` copy, `exercise-targets.json` whyLines, all frozen at 0.2.2); `research/v7/live-spike.md` section 7; the copy glossary and tone notes in `local-docs/ux/copy/README.md`.

Arabic first, then English. Every string below passed the repository's own checks (section 4.3).

---

## 1. The three sections

**Place on the page:** after «طريقة عمل عزم» (the four step loop) and before the closing text. The order is the product's own order: range, then walking, then the coach.

**Form of each section:** an `h2`, one paragraph, a list of three points and one visual. There is no button in any of them (C36: one gold action, at the top and the bottom only).

### 1.1 مدى الحركة · Range of motion

**Arabic**

- **العنوان:** نقيس مفاصلك المتأثرة فقط
- **النص:** تحدّد حالتك الطبية وخريطة جسمك المفاصل التي نقيسها، ثم نقارن مدى حركتها بالمعتاد لمن هم في مثل عمرك وجنسك.
- **النقاط:**
  1. تتحرك حتى أقصى ما تستطيع دون ألم، وتقرأ الكاميرا زاوية الحركة.
  2. تظهر نتيجة كل حركة بكلمات واضحة، وتتلوّن خريطة جسمك بحسب النتائج.
  3. مع كل قياس جديد ترى أين وصلت حركتك، بين نقطة بدايتك والمعتاد.

**English**

- **Headline:** We measure only your affected joints
- **Body:** Your medical condition and your body map decide which joints we measure, then we compare how far they move with what is typical for people of your age and sex.
- **Points:**
  1. You move as far as you can without pain, and the camera reads the angle of the movement.
  2. The result of each movement appears in plain words, and your body map is coloured by the results.
  3. With each new check you see where your movement stands, between your starting point and typical.

**Visual idea: the arc and the line.**

- **The card.** One light card on the page's light background: white, the soft shadow of `.ld-card`, a 1 px warm border (`#edeae2`), never a black line.
  - It is tagged «مثال» (`landing.example.tag`).
  - It is titled with the hero's own example, «رفع الذراع جانبًا، اليمنى» (`landing.example.test`), so one example runs from the hero card to this section.
- **The arc (top).** An SVG half dial:
  - a light grey track;
  - the typical band as a soft gold arc, labelled «المعتاد» (new key);
  - a purple needle that stops short of the band, with a gold hold ring at its tip. The ring is the product's end range hold.
- **The line (bottom).** One straight line from «البداية» to the gold band «المعتاد», with the «الآن» dot between them.
  - These are words the page already uses, plus «المعتاد».
  - The line runs right to left in Arabic and left to right in English.
- **The body outline (beside the card).** A small front outline in purple strokes. One shoulder is tinted in the findings map's colour for «أقل قليلًا من المعتاد» (B4's palette), and the rest stays uncoloured. This shows that only the affected joint is measured.
- **No numbers.** The hero card already shows this example's degrees (100 and 117).
  - A typical value on the dial would be a clinical number for a stated person.
  - If Nasser wants one, it comes from a constant with a parity test against `typicalValue()`, never typed from memory.
  - The landing never imports the norms module (8.8).
- **Motion.** The needle sweeps once to its stop and the ring fills once. With reduced motion, the dial is drawn at rest.

### 1.2 المشي · Walking

**Arabic**

- **العنوان:** نقرأ طريقة مشيك، خطوة بخطوة
- **النص:** إن كنت تمشي، ولو بأداة مساعدة، نقيس توقيت خطواتك على جهاز المشي أو على أرض مستوية، ونقارن جهتك اليمنى باليسرى. ثم نخبرك بما قد تشير إليه طريقة مشيك.
- **النقاط:**
  1. نربط ما نراه في مشيك بنتائج مدى حركتك وبحالتك الطبية، لنذكر الأسباب الممكنة.
  2. نخبرك بمدى تأكدنا من كل ملاحظة.
  3. نضيف إلى برنامجك إطالة لما قد يكون مشدودًا، وتقوية لما قد يكون ضعيفًا.

**English**

- **Headline:** We read the way you walk, step by step
- **Body:** If you walk, even with an aid, we measure the timing of your steps on a walking pad or on level ground, and compare your right side with your left. Then we tell you what your walk may suggest.
- **Points:**
  1. We link what we see in your walk to your range results and your medical condition, to name the possible reasons.
  2. We tell you how sure we are about each observation.
  3. We add stretches to your program for what may be tight, and strengthening for what may be weak.

**Visual idea: lines with no picture.**

- **The figure.** A skeleton line figure (purple strokes, gold joint dots, round caps) walks one step cycle on a short gold ground line, looping slowly.
  - It is the same kind of replay the results show: one cycle, lines with no picture.
  - With reduced motion, it is one still frame at mid stance.
- **The timing strip.** Under the figure, alternating segments show each step: gold for «اليمنى», purple for «اليسرى» (both words come from the rom copy).
  - The right segments are drawn a little shorter.
  - This makes "right against left" visible with no numbers.
- **The program card.** A small card tagged «مثال» holds:
  - a stretch icon, with no exercise name, because the new exercise names wait for the Arabic review (EX-Q15);
  - the data's own why line, «لأن ساقك اليمنى لا تمتد خلفك كثيرًا عندما تمشي، أضفنا هذه الإطالة.» (`whyLines.why_example_plan`).

  A thin gold line joins it to the figure's right leg. This shows the walk feeding the program.
- **No walking pad.** No walking pad is drawn. If F2 final draws one, a companion stands beside it, as the pad steps require («وسيوقف مرافقك الجهاز»).

### 1.3 المدرّب الصوتي · The live voice coach

**Arabic**

- **العنوان:** مدرّب يحاورك وأنت تتحرك
- **النص:** مدرّب صوتي بالذكاء الاصطناعي، يرافقك في القياس والتمرين ولا يتجاوز خطتك ولا قواعد السلامة. يبقى متوقفًا حتى تشغّله، ولكل سؤال يطرحه أزرار على الشاشة.
- **النقاط:**
  1. يسألك عند نهاية الحركة إن كان هذا أقصى ما تستطيع.
  2. يسمعك حين تقول «يؤلمني»، فيسجّل ألمك ولا يطلب منك المزيد.
  3. يسألك عن الألم حين تقول إن الحركة تؤلمك، ويعيد لك التعليمات متى طلبتها.

- **ملاحظة:** تصحيح الوضعية أثناء الحركة يأتي من عزم نفسه (سطر صوت المدرّب `rom_no_lean` وتعليق الشاشة)، لا من المدرّب المباشر، لذلك لا يُنسب إليه هنا (D-026 item 3: «المدرّب المباشر» غير «صوت المدرّب»). إن ذُكر في الصفحة فبصيغة «يصحّح عزم وضعيتك أثناء الحركة».

**English**

- **Headline:** A coach that talks with you as you move
- **Body:** An AI voice coach that joins your checks and workouts, and never overrides your plan or the safety rules. It stays off until you turn it on, and every question it asks has buttons on the screen.
- **Points:**
  1. At the end of a movement, it asks whether that is as far as you can go.
  2. It hears you when you say “it hurts”, so it notes your pain and asks no more of you.
  3. It asks about your pain when you say a movement hurts, and repeats the instructions whenever you ask.

**Visual idea: a question and its buttons.**

- **The phone.** A light phone frame shows the range screen at end range: the dial of 1.1, smaller, with its hold ring full.
- **The bubble.** A speech bubble from the coach, in the purple tint (`--purple-tint`), with no border.
  - It holds the product's question «هل هذا أقصى ما تستطيع؟» (rom copy `ask_max`).
  - Three small gold sound bars beside it show that the coach speaks.
  - There is no face or avatar: the coach is not a person.
- **The buttons.** Below the bubble are the three answer buttons as the screen has them: «نعم» «ليس بعد» «أستطيع أكثر، لكنه يؤلمني» (`ans_yes`, `ans_not_yet`, `ans_hurts`). They are light and at least 48 px, so "it also works with buttons" can be seen.
- **The switch.** Under the phone is one settings row: a switch labelled «المدرّب المباشر» (new key), drawn on, as it looks after the person turns it on.
- **The question and its buttons (D-026 item 3).** The buttons keep «نعم» / «ليس بعد», since a tap is never ambiguous; only the spoken question names its two answers. So the bubble holds rom copy `ask_max` only, and the buttons are `ans_yes`, `ans_not_yet` and `ans_hurts`, as the screen has them. The coach's spoken question («هل هذا أقصى ما تستطيع؟ قل: هذا أقصى شي، أو: أقدر أكثر.») is never drawn on the landing (its colons and spoken «شي» fail 4.3).

---

## 2. Every claim and where the contract builds it

| Claim | Built by |
|---|---|
| Only the affected joints are measured | D-019 item 1; rom-protocol region table; `buildRomProtocol` (A4) |
| The medical condition and the body map decide the joints | 2.2 body map, `autoFillRegions` and `mergeRegions` (A2) |
| Compared with typical for age and sex | D-019; `normFor`, `typicalValue` and `gradeValue` (A4); results `value_flexion` |
| You move as far as you can without pain; the camera reads the angle | plan 1.5; rom copy `safety_always`; RomRunner (B1); live dial (B3) |
| The result in plain words; the body map coloured by the results | results `label_within`, `label_mild`, `label_marked` and `label_pain`; `bodyMapSummary`; findings page (B4) |
| Each new check shows where the movement stands, between start and typical | D-019 (progress from the limitation toward typical); `compareRom` and the profile's `typical` (2.7, B4) |
| If you walk, even with an aid, on a walking pad or on level ground | plan 2.1 and 2.2; gait `eligibility`: an aid is allowed with a helper, and the pad is not offered with one |
| Step timing, and the right side against the left | gait `capture` gives timing and symmetry in every view; gait.md 0.1 (timing is the strongest signal) |
| What your walk may suggest | gait copy `patterns.*` «قد تشير طريقة مشيك إلى» (C3) |
| Linked to the range results and the medical condition; possible reasons | `confidenceModel.contributorOrdering`; copy `contributorsLead` «ومن الأسباب الممكنة»; final findings at complete (C-13) |
| How sure we are | `confidenceModel`; copy `confidence.label` «مدى تأكدنا»; `GaitPatternResult.lines.confidence` (2.9) |
| Stretches for what may be tight, strengthening for what may be weak | D-019 item 2; exercise-targets mapping; why lines (E2, E3) |
| An AI voice coach in checks and workouts | D-019 item 3; C-6 segments for range blocks, gait and workouts (D5) |
| Never overrides the plan or the safety rules | section 11; plan 3.2; 5.3 rule 3; C-16 and C-17; the app checks every tool call |
| Off until you turn it on | section 11 (the coach is off by default); D5 settings; the `live_coach` consent (C-8) |
| Every question has buttons | C-5 |
| Asks whether this is as far as you can go | P1 at the hold (`P1_AT = "hold"`, D-022); rom copy `ask_max` |
| Hears "it hurts", notes the pain, asks no more | `ans_hurts`; `mark_pain`; keep reaching is refused after a hurts answer (plan 3.2); 5.3 rule 2; live-spike 7: «أقدر أكثر بس يوجعني» was understood 6 of 6 times |
| Corrects form as you move | compensations enter as P2 events within 1 s (2.6, section 9); voice line `rom_no_lean` |

---

## 3. What the page must not say

| Do not say | Why |
|---|---|
| تشخيص، يشخّص، علاج، تأهيل، وصفة، يصف، تعافٍ، شفاء، إثبات، تقدّم، مريض · diagnose, treat, treatment, rehabilitation program, prescribe, recovery, prove, proof, progress, patient, monitor | Banned public wording (`check-v1.json` `boundary.bannedPublicWording`, read by `tests/check-copy.test.ts` for every i18n namespace). With no disclaimers left, the wording is the protection (D-017). The Gemini terms also exclude clinical use (live.md 13). |
| طبيعي، تحسّن، أفضل، أسوأ، تراجع · normal, improve, better, worse, health | These are the progress stems (`progress.forbiddenInProgressText`), and the range section is progress copy. The product says المعتاد · typical and نقطة بدايتك · your starting point. "health" fails because it contains the stem "heal". |
| Any accuracy or validation claim: a number of degrees or a percent, دقيق، معتمد طبيًا، مثل أخصائي العلاج الطبيعي · accurate, clinically validated | Contract 11 forbids it. Some movements are not measured by camera (`default_line`; D-025 ROM-Q15 keeps them grey). Some comparisons are approximate (`label_approximate`). Phone bias stays 0 until the bench check (12 item 5). |
| كل مفاصلك، جسمك كله، كل حركة · all your joints, your whole body | Only the affected joints are measured (D-019). Some positions have no typical value (`value_no_grade`). A check measures at most 8 movements (C-13). |
| في بيتك، وحدك · at home, on your own (for range and walking) | Home focus checks stay closed until a recorded decision (C-14; 12 item 9; proposed D-021). Some walks need an adult beside the person, and the pad is never used alone (gait `eligibility`). Workouts at home stay as today. |
| Names of walking patterns as conditions (ترندلنبرغ، هبوط القدم، مشية باركنسون), «نكتشف حالتك» · fall risk, balance score | Results say «قد تشير طريقة مشيك» with a confidence (plan 2.4; gait copy). There is no fall watch (D-016 item 2). Step to step variability is not measured (gait.md 0.5). |
| سرعة مشيك وطول خطوتك, as if every walk gives them | The front view on level ground gives neither (`capture.overground.front.notGiven`). The page speaks only of step timing and the two sides. |
| مدرّب بشري، أخصائي، طبيب بالذكاء الاصطناعي، اسأله عن أي شيء · a therapist, a doctor, ask it anything | The coach gives exercise coaching only and turns medical questions to the care team (5.3 rules 2 and 6; live.md 13). The page says plainly that it is AI. |
| دون أن تلمس الشاشة، بصوتك فقط · hands free | Safety confirmations are tapped (C-16). The buttons stay because Arabic and dysarthric speech recognition is unproven (12 item 7; live-spike 7). |
| يتكلم لهجتك، يفهم كل اللهجات · speaks your dialect | The coach speaks Modern Standard Arabic that sounds natural to Saudis (5.3 rule 1). Real Saudi dialects were not tested (live-spike 7). |
| يعدّل خطتك، يزيد تكراراتك، يدفعك أكثر · adjusts your plan, pushes you further | The dose belongs to the app (5.3 rule 3), and the coach never uses push further phrasing (plan 3.2). |
| لا يغادر شيء هاتفك، صوتك يبقى على هاتفك · nothing leaves your phone | With the coach on, voice and short movement events go to Google outside the Kingdom (C-12; live.md 13; S0-5). Only the video never leaves the phone, and the loop already says so once. D-017 removed repeated video lines, and «يبقى الفيديو» and "The video stays" are on the disclaimer list (`tests/no-disclaimers.ts`). |
| Gemini، Google | The consent names the processor (C-8, C-12), and the provider can change (D-019 item 3: local hosting later). |
| ليس جهازًا طبيًا، لا يشخّص، استشر طبيبك قبل البدء · not a medical device | No disclaimers (D-017 item 2; `tests/no-disclaimers.ts`). |
| فحص · حالتك الصحية · سبارك | The check is قياس (Q29). The phrase is always حالتك الطبية. The product is عزم alone in Arabic (H2). |
| A time or an interval: في عشر دقائق، كل أربعة أسابيع | The booth path never mentions time (D-017 item 1). The four week line is the v1 check's interval, and v7 has none. |

---

## 4. Arabic review (as a strict Saudi editor)

### 4.1 First draft

| Line | First draft |
|---|---|
| Range, body | نختارها من حالتك الطبية وخريطة جسمك، ونقارن مدى حركتها بالمعتاد لمن هم في مثل عمرك وجنسك. |
| Range, point 1 | تتحرك حتى أقصى ما تستطيع دون ألم، وتقرأ الكاميرا زاوية مفصلك. |
| Range, point 2 | نتيجة كل حركة بكلمات واضحة، وبلونها على خريطة جسمك. |
| Range, point 3 | ومع كل قياس جديد ترى موقع حركتك بين نقطة بدايتك والمعتاد. |
| Walking, body | تمشي على جهاز المشي أو على أرض مستوية، فنقيس توقيت خطواتك ونقارن جهتك اليمنى باليسرى، ثم نخبرك بما قد تشير إليه طريقة مشيك. |
| Walking, point 1 | نقرأ مشيك مع نتائج مدى حركتك وحالتك الطبية، ونذكر لك الأسباب الممكنة. |
| Walking, point 3 | يضيف برنامجك إطالة لما قد يكون مشدودًا، وتقوية لما قد يكون ضعيفًا. |
| Coach, body | مدرّب صوتي مباشر يرافقك في القياس والتمرين، ويلتزم بخطتك وبقواعد السلامة. يبقى متوقفًا حتى تشغّله، ولكل سؤال يطرحه أزرار على الشاشة. |
| Coach, point 1 | يسألك عند نهاية الحركة عمّا إذا كان هذا أقصى ما تستطيع. |
| Coach, point 2 | إذا قلت «يؤلمني»، يسجّل الألم ولا يطلب منك المزيد. |
| Coach, point 3 | يصحّح لك وضعيتك أثناء الحركة، مثل «حاول ألا تميل بجسمك». |

The three headlines and walking point 2 were already in their final form.

### 4.2 The editor's notes and the revisions

| Line | Note | Revision |
|---|---|---|
| Range, body | «نختارها» points back to the headline. The paragraph must stand alone, because a skimming eye or a screen reader can land on it first. «نختار» also sounds like our own free choice. A middle draft, «نحدّد المفاصل من حالتك الطبية», hung «من» on a verb that does not take it. Making the person's own information the subject is natural, and it is what the product does. | تحدّد حالتك الطبية وخريطة جسمك المفاصل التي نقيسها، ثم نقارن مدى حركتها بالمعتاد لمن هم في مثل عمرك وجنسك. |
| Range, point 1 | «مفصل» is not the everyday word for bending the trunk or tilting the head. | …وتقرأ الكاميرا زاوية الحركة. |
| Range, point 2 | This is a fragment with no verb, so it reads as a caption. «بلونها» also says each movement has its own colour, but the map is coloured by region. | تظهر نتيجة كل حركة بكلمات واضحة، وتتلوّن خريطة جسمك بحسب النتائج. |
| Range, point 3 | A list item that opens with «و» hangs on the one before it, and «موقع حركتك» is abstract. «أين وصلت» is how people here ask about a place on a path, and it promises no direction. | مع كل قياس جديد ترى أين وصلت حركتك، بين نقطة بدايتك والمعتاد. |
| Walking, body | One 24 word chain of three verbs. It also spoke to every reader as someone who walks, on a page whose hero shows a wheelchair user. | إن كنت تمشي، ولو بأداة مساعدة، نقيس توقيت خطواتك على جهاز المشي أو على أرض مستوية، ونقارن جهتك اليمنى باليسرى. ثم نخبرك بما قد تشير إليه طريقة مشيك. |
| Walking, point 1 | «نقرأ … مع» is a copy of "read together with", and it repeats the headline's verb. «ونذكر لك» states a second act where the sense is purpose. | نربط ما نراه في مشيك بنتائج مدى حركتك وبحالتك الطبية، لنذكر الأسباب الممكنة. |
| Walking, point 3 | The program cannot add to itself. Azm's own lines say أضفنا إلى برنامجك. | نضيف إلى برنامجك إطالة لما قد يكون مشدودًا، وتقوية لما قد يكون ضعيفًا. |
| Coach, body | Alone, «مباشر» can read as blunt, and it hides that the coach is AI; nobody should expect a person on the line. «ويلتزم» promises how a language model will speak. What the app enforces is that the coach cannot override the plan or the rules, which the booth already says with the same verb («ولا يتجاوزها الذكاء الاصطناعي»). | مدرّب صوتي بالذكاء الاصطناعي، يرافقك في القياس والتمرين ولا يتجاوز خطتك ولا قواعد السلامة. … |
| Coach, point 1 | «عمّا إذا كان» is a translated "whether". A direct quote would need a colon, and this copy never uses one. | يسألك عند نهاية الحركة إن كان هذا أقصى ما تستطيع. |
| Coach, point 2 | A bare present verb answering «إذا» with no «فـ» reads loosely. Built instead on what the coach does. | يسمعك حين تقول «يؤلمني»، فيسجّل ألمك ولا يطلب منك المزيد. |
| Coach, point 3 | «لك» is redundant when the object is already yours. «مثل» before a quoted sentence is weak, and «كأن يقول لك» is the Arabic way to give an example. | يصحّح وضعيتك أثناء الحركة، كأن يقول لك «حاول ألا تميل بجسمك». |

**Kept on purpose:**

- The headlines are four or five words, each with one verb or one noun phrase.
- «خطوة بخطوة» is a native idiom.
- «إطالة لما قد يكون مشدودًا، وتقوية لما قد يكون ضعيفًا» stays: the two halves run in parallel, and «قد» twice keeps both as possibilities.
- «يبقى متوقفًا حتى تشغّله» uses the app's own on and off words («الصوت متوقف. اضغط لتشغيله»).
- In the coach body, «مدرّب» repeats the headline's noun on purpose, because the body defines what kind of coach it is.

**Whole text:**

- No «قم بـ», «يتم», «من خلال», «سوف» or «عمّا إذا».
- Masculine singular address (Q24), with the first person plural for what Azm does.
- جهة for a side of the body (glossary).
- No colon, no exclamation mark, no digits. Quoted words go in «».

**English:**

- The English is a twin of the Arabic, not a paraphrase.
- It says "typical", never "normal", and "check" for قياس.
- British spelling, as the existing copy uses (coloured).

### 4.3 Checks run on the final text

Run in a scratch script over all 24 strings of section 6.2, Arabic and English, and over the proposed loop line of 6.3. **All pass.**

| Check | Source |
|---|---|
| No dash character, no hyphen between letters, no spaced hyphen, never حالتك الصحية | `scripts/wording-rules.mjs` |
| No فحص or حجر | `checkWordProblems` |
| No banned public word (English at a word start, Arabic anywhere) | `boundary.bannedPublicWording` |
| No progress stem | `progress.forbiddenInProgressText` |
| No verb before عزم (rule 12) | `tests/check-copy.test.ts` regex |
| None of the landing test's page words: سبارك، جوالك، تقدم، يصف، نصمم، نُثبت | `tests/landing.test.ts` |
| No disclaimer phrase | `tests/no-disclaimers.ts` |
| No colon, exclamation mark or digit | tone notes |
| No "home", "health", "accura", "validat", "therap", "treat", "clinic", "rehab", "diagnos", "patient", "Gemini" or "Google" | this draft's own list |
| The Arabic and English key sets are equal | `tests/i18n.test.ts` rule |

The quoted lines equal the data: `ask_max`, `ans_yes`, `ans_not_yet`, `ans_hurts`, `side_right` and `side_left` in `rom-v7.json` copy; `why_example_plan` in `targets-v7.json` whyLines; `rom_no_lean` in `voice-script.json`.

---

## 5. Terms kept from the existing strings

| Term | Where it already is |
|---|---|
| حالتك الطبية · your medical condition | wording rule, every namespace |
| مدى حركة مفاصلك · how far your joints move | `rom.json` consent.body; `privacy.json` purposes.focus |
| بالمعتاد لمن هم في مثل عمرك وجنسك · typical for people of your age and sex | rom copy `intro`; results `value_flexion` |
| خريطة جسمك · your body map | `intake7.json` map.label |
| المتأثرة · affected | `intake7.json` review.regions «الأجزاء المتأثرة» |
| نقطة بدايتك · your starting point | glossary; check copy |
| القياس · the check (never فحص) | glossary, Q29 |
| جهاز المشي · walking pad; أرض مستوية · level ground | gait copy `pad_start`, `pc_walk_10m` |
| أداة مساعدة · an aid | `intake7.json` walking.with_aid |
| جهتك اليمنى … اليسرى · your right side … left | glossary (جهة for a side of the body) |
| قد تشير طريقة مشيك إلى · your walk may suggest | gait copy `patterns.*` |
| الأسباب الممكنة · possible reasons | gait copy `contributorsLead` |
| مدى تأكدنا · how sure we are | gait copy `confidence.label` |
| أضفنا إلى برنامجك · we added to your program | gait copy `targetsLead`; glossary برنامجك |
| إطالة · تقوية · stretches · strengthening | gait copy `targets.*` |
| هل هذا أقصى ما تستطيع؟ and its three answers | rom copy `ask_max`, `ans_*` |
| يسألك عن الألم · asks about your pain | coach tool `mark_pain` and the P1 `ask_pain` (2.11); the instruction asks the pain question after «يؤلمني» |
| يعيد لك التعليمات · repeats the instructions | coach tool `repeat_instructions` (2.11) |
| متوقف · تشغيل · off · turn on | `session-copy.ts` «الصوت متوقف. اضغط لتشغيله» |
| ولا يتجاوز · never overrides | booth copy `reviewBody` |
| المدرّب, with its shadda | `experience.ts` «صوت المدرّب» |

---

## 6. For F2 final (not copy)

### 6.1 Size (gap F2-1 in the contract change log)

- **The copy's size.** The copy is 1.51 KB gzip for both languages, or 1.74 KB with the visual labels. This was measured by inserting it beside the landing strings of the built first script; the section code comes on top.
- **The budget is already used.** The default first script is already 3.65 KB over the script before v7 (wave 2 base merge, item 1), and section 9 gives 3 KB.
- **Recommended path.** Decide A6b-1 first. Its measured fix leaves the default first script 6.05 KB under the script before A6b, so this copy then fits in `landing.json` as the contract plans.
- **If A6b-1 is not taken.** The three sections become a lazy part, `src/app/LandingV7.tsx` with `src/i18n/{ar,en}/landing7.json`.
  - The part is loaded with `V7_UI ? lazy(...) : null` below the loop, and is never in `DICTS` or `v7.ts`.
  - The default build then gains nothing.
  - Both files need rows under F in table 1.2.

### 6.2 Key sketch for `landing.json` (both languages, identical keys)

- **`v7.range`:**
  - `title`, `body`;
  - `points.move`, `points.result`, `points.again`;
  - `typical`.
- **`v7.walk`:**
  - `title`, `body`;
  - `points.reasons`, `points.sure`, `points.program`;
  - `right`, `left`, `why`.
- **`v7.coach`:**
  - `title`, `body`;
  - `points.max`, `points.hurts`, `points.form`;
  - `switch`, `ask`, `yes`, `notYet`, `hurtsAnswer`.

That is 24 strings per language. The visuals reuse `landing.example.tag`, `landing.example.test`, `landing.example.start` and `landing.example.now`.

### 6.3 A loop line contradicts D-019 under `V7_UI` (gap F2-2, for Nasser)

**The conflict.** `landing.loop.steps.prove.body` says «كل أربعة أسابيع نقيس مجددًا لترى التغير، مقارنة بنفسك فقط.» / "… compared only with yourself."

- The new range section compares with typical (D-019 replaces "own baseline only" for range).
- v7 has no four week interval.

**Proposal.** Add a `bodyV7` key, shown only with `V7_UI`: «نقيس مجددًا لترى التغير عن نقطة بدايتك.» / "We measure again so you can see the change from your starting point."

- This line passes every check of 4.3.
- The production line and its test (`tests/landing.test.ts`, "measures for the person's own tracking") stay as they are.

**Optional, also Nasser's call.** The loop's coach step says «ومعك صوت عربي هادئ», while the voice is off by default (section 11). It is approved copy, so it is left as it is.

### 6.4 The coach's name (gap F2-3, for D and F)

The landing calls the switch «المدرّب المباشر» / "Live coach". This keeps it apart from the voice pack's «صوت المدرّب» / "Coach voice".

- D's settings and the `live_coach` consent should use the same name.
- If D names it otherwise, F2 final takes D's name.

### 6.5 Tests F2 final adds (failing first, `tests/v7/f-*`)

- With `V7_UI`, the three sections render in the order range, walking, coach, with these keys. With it off, none of them render.
- None of the sections holds a `cta`.
- The three sections' text holds no banned word and no progress stem, as the loop test already checks for the loop.
- The quoted lines equal the runtime data: `ask_max`, `ans_*`, `side_*`, `why_example_plan` and `rom_no_lean`. A test may read the runtime JSON; the landing may not import it.
- No disclaimer, and Arabic and English key parity (the existing landing test).
- The reduced motion stills.
- axe on the landing in both languages.

### 6.6 Bundle test (G)

The landing repeats a few data lines: the question, the answers and the why line. These lines come from the runtime data, not from the six v7 namespaces.

- G's check that the first script "holds none of the six v7 namespaces' strings" should compare against the namespace files only.
- Otherwise F2 final drops these lines from the visuals.

### 6.7 Page length (C36)

- The three sections add about 175 Arabic words (210 with the visual labels) to a page that renders about 170 today. C36 cut the page from 311.
- If Nasser wants the C36 lightness, cut the points first. The headline and the body alone are about 75 words for all three sections.

### 6.8 Visual build

- Inline SVG and CSS inside the landing chunk, with no new image files. F3's movement pictures live in a v7 module the landing cannot import.
- Use the tokens of `styles.css` (`--gold`, `--purple`, `--purple-tint`) and Cairo, with no black borders.
- Use logical properties so the visuals mirror in RTL.
- Visuals are `aria-hidden`, because their words are already in the copy.
