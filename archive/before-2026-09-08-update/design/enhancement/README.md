# Coaching and product enhancement — September 7, 2026

Delivered features:
- Three-step exercise walkthroughs with individually playable spoken guidance,
  exercise-specific camera positioning diagrams and larger instruction text.
- Personal coach settings: guidance plus counts, guidance only, captions only;
  three speech speeds; preview; persistent focus preference.
- Focus view with large coaching text, high contrast, repetitions and range.
  Stop remains fixed within the viewport, including narrow phones.
- Engine-driven phase and framing status. Counting still uses the original engine.
- Rep timeline with selectable range and duration, factual set review, local history
  totals, recent-session chart, saved-setup shortcut and actual CSV download.
- Rewritten Arabic and English cues with comfortable-range wording. No new scoring
  thresholds, exercises, medical claims, target counts or clinical rules.

## Voice delivery

70 MP3 clips, approximately 1.55 MB, are packaged in `public/cues`. These are neural
speech recordings generated from public interface text, not a speech model running
inside the browser. No session text, camera data or personal records were sent for
speech generation. Playback makes local asset requests only. No API key is needed
at runtime. Matching local system voices are fallback only; captions remain.

Arabic uses Microsoft ar-SA-HamedNeural; English uses en-GB-RyanNeural. Clips were
produced at -8% generation rate through the build-only edge-tts utility. Runtime
speed controls preserve playback pitch. The player protects safety/correction
speech from interruption by counting and cancels pending speech on stop or mute.

Provider references:
- https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support
- https://github.com/rany2/edge-tts

`src/app/voice-script.json` is the shipped text/voice source. The public manifest
records the script and provider voices. `scripts/voice-script.mjs` assembles the
script; `scripts/generate-voice.py` regenerates clips in a separate Python build
environment with edge-tts installed. Build scripts are not included in the browser.

## Checks and limits

35 tests pass, including the original 17 engine tests. TypeScript and production
build pass. Browser checks cover actual clip playback, preference persistence,
walkthrough, focus view, summary, demo/history separation, record export, camera
permission failure and camera stop. The local pose model was exercised with a
browser virtual camera, not a participant. Stop visibility and overflow checked
at 1440, 390 and 320px widths. All 70 audio files fully decode without errors.
Audio validation confirms delivery/decoding, not a native-speaker listening review.

History screenshots named `history-test-fixture-*` use synthetic records in a
disposable browser context. They are QA fixtures, not real participant outcomes,
and no sample sessions are added to the shipped app. Normal fresh history is empty.

Static character references remain; no rigged exercise animation is claimed.
The poster's exact wording, official template, fonts and size remain preserved;
only its two app screenshots are refreshed in this enhancement pass.

Maintained new source: `src/app/experience.ts`, `CoachSettings.tsx`,
`MovementGuide.tsx`, `RepReview.tsx`, `History.tsx`, `voice-script.json`, with
integration in App, Session, audio and styles. Prior source is in `originals/`.
