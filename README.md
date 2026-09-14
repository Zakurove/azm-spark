# Azm — guided adaptive exercise

Updated 8 September 2026. [Documentation index](docs/README.md) · [Operations and verification](docs/OPERATIONS.md)

React/TypeScript application with a local account service, a structured health history, condition-based program planning, and camera-guided exercise. Camera frames and pose inference stay in the browser. Account profiles and derived exercise records are stored by the application server.

## Run

Use Node 22.18 or newer.

```sh
npm install
npm run dev
```

Open http://localhost:5205. Create an account, complete the four-step health history, and review the resulting program. The independent demonstration on the sign-in screen requires neither an account nor camera access; simulated results never enter personal history.

```sh
npm run check
npm test
npm run build
npm start
```

`npm start` serves the compiled application and account API together. Stop the development server first, or set `PORT` to another port. The default listener is local loopback. For an HTTPS deployment behind a reverse proxy, set `NODE_ENV=production` and `AZM_ORIGIN` to the exact HTTPS origin. Set `AZM_DATABASE` to the intended SQLite path. No external deployment has been performed.

## Product flow

1. Register or sign in using a server session.
2. Record age, conditions, movement setup, affected side, pain, restrictions, symptoms, clearance, equipment, goals and availability. Optional diagnosis and medication notes are recorded without automated interpretation.
3. Review exercise selection, sets, reps, recovery periods and weekly schedule. Unsupported conditions or conflicting restrictions lead to a review screen, without an active exercise program.
4. Work through preparation, camera framing, personal range calibration, prescribed sets, effort check-ins, timed rests, and cooldown. High reported effort ends the current workout. Unfinished workouts can resume.
5. Review and export your own recorded sets. Program demonstrations remain separate.

## Medical scope

The condition presets in `src/medical/legacy-config.ts` were ported from Azm 2.0. `src/medical/plan.ts` adapts those settings to the three movements that the current pose engine supports. This is a rules-based adaptation, not diagnosis, a medication-interaction system, a verified medical-clearance service, or a replacement for a clinician. No new clinical validation is claimed. Changes to the original exercise definitions require medical and fitness review.

Cardiac conditions, reported warning symptoms, unresolved recent health changes, instructions not to exercise, unlisted conditions, unsupported bed-based exercise, and ME/CFS require review. Required clearance is self-reported. Unsupported limb tracking and conflicting movement restrictions exclude affected exercises. Recovery spacing is checked across the weekly boundary.

## Accounts and data

`server/api.ts` owns authentication and authorization: salted scrypt passwords, hashed random session tokens, HttpOnly SameSite cookies, same-origin mutation checks, rate limiting, and ownership checks for profiles and records. The server recomputes plans and enforces their versions and set order. Data is in `.data/azm.sqlite` (owner-only permissions), excluded from source control. Medical profiles are not saved in browser localStorage. Voice/display preferences are local browser settings.

These accounts belong to this installation; existing hosted Azm 2.0 accounts have not been connected or migrated. Email verification, password recovery, clinician roles and verified clearance uploads are not implemented. SQLite is not encrypted at rest by the app; host access and deployment security remain operational requirements before use with real participant data.

## Assets and voice

The full Azm wordmark comes from the existing Azm 4.0 brand assets. Stylized reference illustrations adapt to the selected movement setup. They are illustrations, not a live avatar or patient footage. Demonstration landmark playback is separate and frame-synced to the scoring engine; camera mode overlays the real video.

Arabic and English neural voice clips are bundled locally in `public/cues`; runtime speech does not contact an external voice service. See `design/enhancement/README.md` for voice provenance and the build-only generation process. Fonts, pose model and WASM are vendored locally.

## Visual verification

With the development server running:

```sh
npm run shots
node scripts/medical-qa.mjs
```

Screenshots are captured at 3×. The medical QA uses synthetic test accounts and a virtual camera. It checks registration, intake, program generation, Arabic/mobile layouts, camera launch/exit, prescribed demonstration sets, enforced rest, high-effort completion, review gating and logout. Earlier pre-account QA scripts are historical and do not represent the current onboarding flow.

## Verified baseline

52 automated tests across 9 files passed on 8 September 2026, including the original 17 engine tests. Type checking, client/server build, built-server authentication smoke test and synthetic browser workflow checks passed. The dependency audit reported zero vulnerabilities at that verification. These are software checks, not participant or clinical validation.
