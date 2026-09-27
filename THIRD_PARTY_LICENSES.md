# Third party licenses

- **MediaPipe Tasks Vision** (`@mediapipe/tasks-vision`, WASM runtime vendored in `public/wasm/`): Apache License 2.0, © Google LLC. https://github.com/google-ai-edge/mediapipe
- **Pose Landmarker models** (`public/models/pose_landmarker_{full,lite}.task`, BlazePose GHUM): Apache License 2.0, © Google LLC. Model cards: https://developers.google.com/mediapipe/solutions/vision/pose_landmarker
- **React / React DOM**: MIT. **Vite**: MIT. **TypeScript**: Apache 2.0. **Vitest**: MIT. **Playwright**: Apache 2.0.
- One Euro filter implemented from: Casiez, Roussel, Vogel. "1€ Filter" (CHI 2012).
- **Cairo** typeface (`public/fonts`): SIL Open Font License 1.1.

## Packaged speech recordings

The MP3 cues in `public/cues` are synthetic speech generated at build time from the public AZM coaching script in `src/app/voice-script.json`. They are not recordings of participants or of any real person, and the browser never contacts a speech service at runtime. Provenance, including the provider, model and voice of every cue, is recorded in `public/cues/manifest.json`.

- **Current cues:** generated with the OpenAI speech API (`gpt-4o-mini-tts`, voice `ash`).
- **Generator from Azm 6.0 on:** `scripts/generate-voice.mjs` now uses Google's Gemini API text to speech (`gemini-3.8-flash-tts`, prebuilt voices), subject to the Gemini API Additional Terms of Service (https://ai.google.dev/gemini-api/terms). Only the coaching script text is sent. The returned audio is trimmed, loudness normalized and encoded to MP3 locally with ffmpeg. This applies to each cue once it is regenerated; until then the cue keeps its OpenAI provenance, and the manifest records which provider produced each file.

## Demo video

`public/demo` contains the hackathon demo video and subtitle tracks. The camera feed in that recording is an animated 3D athlete rendered from the project's own illustrations; tracking, counting and coaching were captured live from the app.
