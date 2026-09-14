# AZM SPARK product redesign — September 7, 2026

## Product direction

The experience now begins with the user's setup, then a supported exercise, then
camera preparation. Ordinary chair, wheelchair and sit-to-stand are distinct
choices. Optional side weakness is independent of wheelchair use. The existing
engine supports seated press/curl and sit-to-stand; this redesign does not invent
standing versions of the seated exercises.

Live sessions show the user's camera image with aligned joint feedback. Demo
sessions show a static, explicitly labeled exercise reference and a separate
small trace viewer. The trace viewer receives the same smoothed frame used by the
engine. Its uniform projection preserves limb lengths and angles; camera overlay
projection matches the contained video. The reference illustration is not an
animated mirror or a measured pose. No Blender rig or animation is delivered.

The approved adult 3D illustration style is retained in five local assets under
`../public/illustrations`. There is no unconditional wheelchair avatar. The old
procedural athlete renderer is unused. Its anatomical and projection failures
are documented in `explorations/APPRAISAL.md`.

## Critical assessment

The previous interface centered an unreliable visual surrogate and exposed too
many controls before the person had chosen a movement. Replacing its face or
colors would not solve that. The new hierarchy prioritizes setup, camera,
current coaching cue, repetitions, and a persistent stop control.

The new illustrations are more coherent and dignified, but remain static
references: they do not teach a complete movement cycle. Sit-to-stand uses a
standing reference plus the existing textual instructions. A future motion guide
should be professionally rigged and checked through the full cycle; these stills
must not be presented as validated animation. The small demo trace is deliberately
technical and secondary. Live mode is the intended primary experience.

## Maintained source and behavior

- `../src/app/App.tsx`: guided setup, exercise selection, readiness, local history.
- `../src/app/Session.tsx`: camera/demo session, cue, progress, effort and summary.
- `../src/app/product.ts`: setup mapping, assets, product copy and history filter.
- `../src/app/overlay.ts`: uniform trace and letterboxed camera projections.
- `../src/app/poseSource.ts`: camera cancellation and missing-pose handling.
- `../src/app/audio.ts`: stop/mute cancellation; local recordings or local voices.
- `../src/app/styles.css`: responsive Cairo layout, RTL, focus, reduced motion.

Engine, trace and exercise definitions are preserved. The subsequent enhancement
updates the app’s cue wording and packages neural speech recordings.
New journey and coaching copy is bilingual. Demo outcomes are never saved as personal progress.
Older records without an explicit camera-mode marker stay in storage but are not
shown as verified personal sessions. Camera processing and assets stay local.
When no matching local speech voice is installed, captions remain available.

## Verification and artifacts

`npm run check`, `npm test` (35 tests, including the original 17), and
`npm run build` pass. `node scripts/product-qa.mjs` exercises adaptive selection,
early stop, effort dialog focus, demo/history separation, restart, mobile layout,
permission denial, and camera-stream cleanup. Its camera check uses the actual
local MediaPipe model with a browser virtual camera; it is not participant testing.

`npm run shots` refreshes `screenshots/` at 3×. Additional responsive and flow
screenshots are in `product-rework/screenshots/`. The two final poster screenshots
provide approximately 712 DPI in both languages at their placed sizes.
Resolution does not make small interface text large at print size.

The official poster keeps its wording, font settings, template artwork and A0
size. The improved native architecture diagram from the earlier visual pass is
retained. This product pass replaces its two screenshots without distorting them.
Before-redesign app source is in `product-rework/originals/`; earlier art experiments
remain under `explorations/`. Asset provenance is in `product-rework/ASSETS.md`.

See `enhancement/README.md` for the latest coaching, voice, focus and history features.
