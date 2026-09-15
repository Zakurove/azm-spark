# AZM SPARK

**An AI fitness coach that adapts to your medical condition.**
Smart Personalized Assessment of Range & Kinematics.

Live build: **https://azm-spark.gymwise.ai** · Demo video: **https://azm-spark.gymwise.ai/demo**

AZM SPARK helps adults with a disability or a medical condition keep the benefits of sport after rehabilitation ends. The person shares a medical report or answers a short health history, receives a weekly plan built around their condition, then props up their phone and trains. The camera counts every repetition, corrects movement against that person's own calibrated range, and coaches by voice in Arabic or English.

Entry of Gymwise.ai (team 25) in the KSCDR AI Hackathon for People with Disabilities 2026, Health & Rehabilitation track.

## What it does

1. **Try it with just a phone.** From the home page, anyone can start a guided camera session with no account: choose seated, wheelchair or standing, prop the phone about two meters away, and train.
2. **Medical engine.** A pasted or photographed medical report is read once by a language model into the health profile (condition, affected side, mobility, medications). Safety questions such as warning symptoms and medical clearance are always answered by the person, never guessed from the report. The report itself is never stored.
3. **Plan built on the condition.** Clinical presets set a safe dose (movement, sets, reps, rest) and exclude anything unsafe, with the reason shown. A language model then arranges a weekly plan using only exercises the rules approved, from a library of 55 adaptive exercises.
4. **Live camera coaching.** On-device pose tracking, personal range calibration before every set, repetition counting, compensation detection (for example trunk lean), voice cues, an effort check after every set, and a session record.
5. **Safety that can say no.** A heart condition, warning symptoms, a recent change or missing clearance routes the person to a clinical review instead of a workout.

Arabic first with full right to left support, and English.

## Privacy

Camera frames and pose inference never leave the browser. Only derived results (counts, ranges, flags) are stored, with the person's consent, in their own account. The medical report is analysed once for prefilling and is not retained.

## Run locally

Node 22.18 or newer.

```sh
npm install
npm run dev        # http://localhost:5205
```

Production build and server (client and API from one origin):

```sh
npm run build
npm start
```

Environment variables:

| Variable | Purpose |
|---|---|
| `PORT`, `HOST` | Listener (defaults: 5205, loopback) |
| `AZM_DATABASE` | SQLite path (default `.data/azm.sqlite`) |
| `AZM_ORIGIN` | Comma separated list of allowed origins for state changing requests in production |
| `NODE_ENV=production` | Secure cookies |
| `OPENAI_API_KEY` | Medical report reading and weekly plan arrangement (`gpt-4o`). Without it the app still works: the report panel falls back to manual answers and the weekly plan uses the rules engine only |

Checks:

```sh
npm run check      # TypeScript
npm test           # 61 automated tests (engine, planner, weekly plan, API)
```

## Architecture

- `src/app` React 18 + TypeScript client: landing, no account camera trial, account, intake, program, weekly plan, camera session, history.
- `src/engine` Pose pipeline: MediaPipe Pose Landmarker (vendored in `public/models` and `public/wasm`), One Euro filtering, personal calibration, repetition state machine, form rules and cue orchestration.
- `src/medical` Condition presets, plan generation with review gates, deterministic safety filter for the weekly plan, exercise library (`src/exercises/library.json`).
- `server` Dependency free Node server: account sessions (scrypt, HttpOnly cookies, same origin checks, rate limits), health profiles, plans, records, medical report extraction and weekly plan arrangement with strict JSON schemas, SQLite storage.
- `public/cues` Bundled Arabic and English coaching voice (generated at build time with `scripts/generate-voice.mjs`; the browser never contacts a speech service).
- `tests` Vitest suites. `scripts` build, voice, screenshot and QA utilities.

## Medical scope

AZM SPARK is training guidance for fitness and physical activity adapted to a medical condition. It is not a diagnostic device and does not replace a clinician. Condition presets are adapted from published exercise protocols and were designed by a rehabilitation physician; clearance is self reported. Cardiac conditions and other unsupported profiles are routed to review rather than trained. Evaluation with users is the next step; see the [operations notes](docs/OPERATIONS.md) for the current evidence boundary.

## Team

- Dr. Nasser Alharbi, physical medicine and rehabilitation physician, CEO of Gymwise.ai
- Chaker Belhaj, fitness professor, COO of Gymwise.ai

Third party components are listed in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
