# Visual reassessment — September 7, 2026

Status: exploration only. No app or poster replacement in this pass.
Images were produced with the built-in image-generation tool. The exact initial
and revised prompts are recorded in prompts.json. These are static art-direction
references, not modeled, rigged, engine-synchronized or production-ready assets.

## Why the delivered renderer fails

- Coordinates use x * canvas.width and y * canvas.height, although the synthetic
  trace defines segment lengths in a shared normalized coordinate space. On a
  1440 × 722 stage, the noise-free press upper arm measures about 178 pixels at
  62 degrees and 104 pixels at 168 degrees. The apparent stretching is caused by
  rendering, despite a fixed trace segment length. Shared joint positions alone
  do not establish faithful visual geometry.
- Torso width uses horizontal pixels while head/limb thickness largely uses
  vertical trunk length. This creates a broad torso, small head and thin limbs.
- Primitive sleeves sit on top of a torso rather than deforming with shoulders.
  Hands are circles and the face/neck lack an integrated anatomical design.
- Chair geometry is partly recalculated from the moving trunk. Furniture should
  have stable dimensions and floor contact, and the athlete must visibly sit in
  it with supported thighs and feet.
- The beige backdrop and large yellow torso compete with coaching markers.
  The toast obscures the lower body and chair. Empty space does not produce a
  strong composition without a deliberate hierarchy.
- Engine tests, screenshot resolution and intact text validate engineering and
  document integrity, not design quality. The prior acceptance standard was too
  low. The poster inherited the same weak character; small screenshot text also
  remains small at print size regardless of DPI.

## Candidate directions

1. Stylized adult 3D: 01-stylized-3d.png. Preferred direction. White sportswear,
   slate trousers, gold trim, neutral stage. The refined concept is a useful
   reference but still needs less generic character styling, hand refinement,
   chair geometry verification and actual motion evaluation. Requires a modeled
   and rigged continuous character; do not approximate it with stacked capsules.
2. Clean editorial 2D: 02-editorial-2d.png. Strong alternative when clarity and
   restrained character presence matter most. Use authored layered artwork with
   anatomical joint pivots and separate front/profile views. Risks: cutout-like
   motion, difficult rotations, and a generic instruction-leaflet appearance.
3. Abstract motion sculpture: explored but not recommended as the primary
   experience. The faceless model is less welcoming and the first output added
   unrequested dumbbells. It cannot be accepted as an exercise reference.

Rejected first 3D image: too photoreal for the brief. Rejected first editorial
image: too much crosshatching and muscular emphasis for the product.

## Rendering approaches

- Authored 3D animation rendered to local frames: strongest controlled appearance
  for three predetermined demos. Export matching 33-landmark samples and use a
  shared frame index for visuals, scoring input and overlay. Render valid and
  compensation sequences. No independent video clock. Costs: storage, export
  process, limited camera/view flexibility. Need to evaluate decoding and memory.
- Real-time rigged 3D: use local mesh/material assets and one camera projection
  for both character and overlay. Offers continuous adjustments. Costs: careful
  rigging, depth decisions for 2D traces, device performance and compatibility.
- Authored 2D rig: use consistent proportions and one uniform fit transform for
  both art and dots. Separate side-view art. Costs: foreshortening and convincing
  shoulder/hip deformation. It must not repeat the current procedural puppet.

For any trace-driven demo, uniform scaling and translation preserve the trace's
2D angles. Camera footage has a separate coordinate mapping and should retain
its own path. Fixing the demo does not require modifying clinical/scoring rules.

## Recommended next production proof

Start with one complete shoulder-press cycle using the stylized 3D direction,
including a compensated rep. Test front-view anatomy at rest, mid-lift and top;
stationary chair and foot support; seamless looping; projection fidelity;
frame-accurate flags; and appearance in the actual Arabic interface at desktop
and phone sizes. A good still image is not evidence of good animation.

Reorganize the stage around the athlete and one clear coaching area outside the
body silhouette. Keep gold as an accent. Preserve all reviewed Arabic wording,
privacy statements and accessible controls. Only after the moving result works
should the remaining exercises and poster screenshots be rebuilt. The official
poster bands, logos, headings, fonts and A0 size remain protected.
