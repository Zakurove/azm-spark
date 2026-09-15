# Third party licenses

- **MediaPipe Tasks Vision** (`@mediapipe/tasks-vision`, WASM runtime vendored in `public/wasm/`): Apache License 2.0, © Google LLC. https://github.com/google-ai-edge/mediapipe
- **Pose Landmarker models** (`public/models/pose_landmarker_{full,lite}.task`, BlazePose GHUM): Apache License 2.0, © Google LLC. Model cards: https://developers.google.com/mediapipe/solutions/vision/pose_landmarker
- **React / React DOM**: MIT. **Vite**: MIT. **TypeScript**: Apache 2.0. **Vitest**: MIT. **Playwright**: Apache 2.0.
- One Euro filter implemented from: Casiez, Roussel, Vogel. "1€ Filter" (CHI 2012).
- **Cairo** typeface (`public/fonts`): SIL Open Font License 1.1.

## Packaged speech recordings

The MP3 cues in `public/cues` were generated at build time with the OpenAI speech API (`gpt-4o-mini-tts`) from the public AZM coaching script in `src/app/voice-script.json`, using `scripts/generate-voice.mjs`. They are not recordings of participants, and the browser never contacts a speech service at runtime. Provenance is recorded in `public/cues/manifest.json`.

## Demo video

`public/demo` contains the hackathon demo video and subtitle tracks. The camera feed in that recording is an animated 3D athlete rendered from the project's own illustrations; tracking, counting and coaching were captured live from the app.
