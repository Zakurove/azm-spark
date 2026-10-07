# v7 animations

**Files:** `v7_rom_<movement>.mp4` (17 loops) and `v7_walk_pad_side.mp4` (1 loop) · 3:2 landscape, at least 1080 px wide · 24 or 30 fps · no sound

The movement loops play in the same picture box as the V7-02 stills; the app shows the still first and the loop when it is ready. Make each loop in OpenAI's video tool from a **start frame**, exactly as in v3.1.

## How to make each movement loop

1. **Make the start frame.** In the image conversation where V7-02 was approved, attach the approved picture and ask:
   «Make the start frame for its loop: the same person, place, phone and camera, in the start pose only, fully solid, no ghost, no arrow. Landscape 1536 by 1024, no text.»
   Approve it.
2. **Make the loop.** In the video tool, use that start frame and this prompt, putting in the movement's end pose from its V7-02 prompt:
   «A calm 4 second loop. The camera is locked: no zoom, no pan, no cuts. The person moves slowly and smoothly from the start pose to <END POSE FROM V7-02>, holds it for about 1 second, then returns slowly to the start pose, ending exactly as the first frame so it loops. Calm face, comfortable effort, no other movement in the scene, no text, no sound.»
3. **Check:**
   - the movement matches its V7-02 picture and stays within a comfortable range;
   - nothing else moves;
   - the last frame matches the first;
   - hands stay correct throughout;
   - no text appears.

## The pad walk loop (`v7_walk_pad_side.mp4`)

1. Make a start frame from the approved `v7_walk_pad_side.png`, with Fahd mid stride and no arrows.
2. Then use this prompt:
   «A calm 4 second loop. Camera locked. Fahd walks steadily on the moving walking pad at an easy pace, holding the front bar with his left hand; his helper stands still and attentive behind him. Two full steps, ending exactly as the first frame so it loops. No text, no sound.»

## What is built in code instead

- **The Live coach's glow.** Soft rings while it listens and speaks are drawn in the app, so they stay in sync with the voice.
- **The live angle dial and the hold ring** on the measuring screen.
- **The walk's stride counter.**

None of these needs a picture or a video.
