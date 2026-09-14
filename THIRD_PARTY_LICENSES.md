# Third-party licenses

- **MediaPipe Tasks Vision** (`@mediapipe/tasks-vision`, WASM runtime vendored in `public/wasm/`) — Apache License 2.0, © Google LLC. https://github.com/google-ai-edge/mediapipe
- **Pose Landmarker models** (`public/models/pose_landmarker_{full,lite}.task`, BlazePose GHUM) — Apache License 2.0, © Google LLC. Model cards: https://developers.google.com/mediapipe/solutions/vision/pose_landmarker
- **React / React DOM** — MIT. **Vite** — MIT. **TypeScript** — Apache-2.0. **Vitest** — MIT. **Playwright** — Apache-2.0.
- One-Euro filter implemented from: Casiez, Roussel, Vogel. "1€ Filter" (CHI 2012).

## Packaged speech recordings

The MP3 cues in `public/cues` were generated using Microsoft neural voices
(ar-SA-HamedNeural and en-GB-RyanNeural) from the public AZM coaching script.
They are not recordings of participants. Provider and build provenance are in
`design/enhancement/README.md` and `public/cues/manifest.json`. The build-only
edge-tts utility is not distributed in the browser bundle.
