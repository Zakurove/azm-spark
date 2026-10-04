# Third party licenses

- **MediaPipe Tasks Vision** (`@mediapipe/tasks-vision`, WASM runtime vendored in `public/wasm/`): Apache License 2.0, © Google LLC. https://github.com/google-ai-edge/mediapipe
- **Pose Landmarker models** (`public/models/pose_landmarker_{full,lite}.task`, BlazePose GHUM): Apache License 2.0, © Google LLC. Model cards: https://developers.google.com/mediapipe/solutions/vision/pose_landmarker
- **React / React DOM**: MIT. **Vite**: MIT. **TypeScript**: Apache 2.0. **Vitest**: MIT. **Playwright**: Apache 2.0.
- One Euro filter implemented from: Casiez, Roussel, Vogel. "1€ Filter" (CHI 2012).
- **Cairo** typeface (`public/fonts`): SIL Open Font License 1.1.

## Packaged speech recordings

The MP3 cues in `public/cues/packs` are synthetic speech generated at build time from the public AZM coaching script in `src/app/voice-script.json`. They are not recordings of participants or of any real person, and the browser never contacts a speech service at runtime. Each voice pack records its provenance, including the provider, model and voice of its cues, in `public/cues/packs/<pack>/manifest.json`; `public/cues/packs/index.json` lists the installed packs.

- **Pack `openai-ash`:** generated with the OpenAI speech API (`gpt-4o-mini-tts`, voice `ash`).
- **Generator from Azm 6.0 on:** `scripts/generate-voice.mjs` renders new packs with Google's Gemini API text to speech (`gemini-3.8-flash-tts`, prebuilt voices), subject to the Gemini API Additional Terms of Service (https://ai.google.dev/gemini-api/terms). Only the coaching script text is sent. The returned audio is trimmed, loudness normalized and encoded to MP3 locally with ffmpeg.

## Demo video

`public/demo` contains the hackathon demo video and subtitle tracks. The camera feed in that recording is an animated 3D athlete rendered from the project's own illustrations; tracking, counting and coaching were captured live from the app.

## Azm v7 (range of motion, gait, live coach)

### Code ported or vendored (each file keeps the upstream notice)
- **Pose2Sim** (`Pose2Sim/common.py` angle functions; `Pose2Sim/filtering.py` Hampel filter), BSD 3-Clause License, [copyright line from upstream LICENSE], commit [sha]. Ported to TypeScript in `src/engine/rom/angles.ts` and `src/engine/signal/hampel.ts`. https://github.com/perfanalytics/pose2sim
- **Sports2D** (`Sports2D/process.py` side handling and pixel to metre conversion), BSD 3-Clause License, [copyright line], commit [sha]. Ported in `src/engine/rom/angles.ts` and `src/engine/gait/scale.ts`. https://github.com/davidpagnon/Sports2D
- **SciPy** (`scipy/signal/_peak_finding.py`, `_peak_finding_utils.pyx`: peak distance and prominence), BSD 3-Clause License, [copyright line], version [x]. Ported in `src/engine/signal/peaks.ts`. https://github.com/scipy/scipy
- **digital-filter** 2.4.2 (Butterworth design, filter, filtfilt), MIT License, [copyright line]. Vendored in `src/engine/signal/vendor/digital-filter/` with its LICENSE, unmodified [or: module syntax only]; [any vendored helper package with its licence]. https://github.com/scijs/digital-filter
- **myogait** (Zeni event detection, cycle segmentation, quality diagnostics), MIT License, [copyright line], commit [sha]. Ported in `src/engine/gait/`. https://github.com/IDMDataHub/myogait
- **OpenCap processing** (`ActivityAnalyses/gait_analysis.py`), Apache License 2.0, [copyright from the upstream file header], commit [sha], NOTICE: [text or none]. Ported with modifications in `src/engine/gait/spatiotemporal.ts`. https://github.com/opencap-org/opencap-processing
- **Gemini Live API Web Console** (`src/lib/audio-streamer.ts`, `src/lib/audioworklet-registry.ts`, `src/lib/worklets/audio-processing.ts`), Apache License 2.0, [copyright from the upstream file headers], commit [sha], NOTICE: [text or none]. Vendored with modifications (reformatted, strict TypeScript, 20 ms frames) in `src/features/coach-agent/audio/`. https://github.com/google-gemini/live-api-web-console

### Runtime dependency
- **@google/genai** 2.27.0 (Google Gen AI SDK for TypeScript and JavaScript), Apache License 2.0, [copyright from the package's LICENSE or headers], NOTICE: [text or none]. Loaded only when the live coach is on. The coach uses the Gemini API under the Gemini API Additional Terms of Service (https://ai.google.dev/gemini-api/terms), on a paid project only.

### Methods implemented from publications (no code used)
- Stenum J, Rossi C, Roemmich RT. PLOS Comput Biol 2021;17(4):e1008935, and Stenum et al. PLOS Digit Health 2024 (video gait analysis, sagittal and frontal). The authors' GPL-3.0 code was not used.
- Zeni JA, Richards JG, Higginson JS. Gait Posture 2008;27(4):710 to 714 (kinematic gait event detection).

### Reference data
- Normal range of motion values in `src/movements/rom/rom-v7.json` are summary statistics transcribed with citation from the sources listed in its `citations` (including Gill et al. 2020, BMC Musculoskeletal Disorders, CC BY 4.0, and summaries derived from the CDC Normal Joint Range of Motion Study public use file, Soucie et al. 2011).
- Gait reference values in `src/movements/gait/gait-v7.json` are summary statistics transcribed with citation from the sources in its `citations`.

### Test data (tests only, never shipped)
- Van Criekinge T et al. Sci Data 2023;10:852, figshare collection 6503791 (files CC0; article CC BY 4.0).
- Fukuchi CA, Fukuchi RK, Duarte M. PeerJ 2018, figshare 10.6084/m9.figshare.5722711 (CC BY 4.0).
3D markers from these datasets are projected to 2D landmark streams in `tests/fixtures/gait/`.
