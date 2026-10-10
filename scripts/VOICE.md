# Voice packs: render, compare, choose

The coach voice comes from a **voice pack**: one voice per language, recorded ahead of time into
`public/cues/packs/<pack>/{ar,en}/<line>.mp3`. The installed packs are listed in
`public/cues/packs/index.json`. The app never calls a speech service; it only plays these files.
A line a pack does not have plays from the default pack, then with the phone's own voice.

Today one pack is installed: `openai-ash` (the default, OpenAI voice Ash). In the app a pack shows
by its place in `index.json` («الصوت 1» · "Voice 1", then «الصوت 2» · "Voice 2"), never by the
provider's voice id; edit its `name` in `index.json` to give it another name.

## 1. Before you render

- `GEMINI_API_KEY=...` in `.env.local` at the repo root (git ignored), and `ffmpeg` installed
  (`brew install ffmpeg`).
- Add `--dry-run` to any command below first: it prints every line and file it would make and sends
  nothing, so it costs nothing.
- A full pack is every line in `src/app/voice-script.json` (108 today) in Arabic and English, so 216
  renders. `--verify` (recommended) adds one transcription call per render and keeps a render only
  when the words heard match the script.

## 2. Render the three candidate voices

```sh
node scripts/generate-voice.mjs --pack gemini-achird  --voice-ar Achird  --voice-en Achird  --verify
node scripts/generate-voice.mjs --pack gemini-charon  --voice-ar Charon  --voice-en Charon  --verify
node scripts/generate-voice.mjs --pack gemini-schedar --voice-ar Schedar --voice-en Schedar --verify
```

To compare cheaply first, render a few lines per voice and fill the rest later with the same
command without `--only` (a later run on a pack keeps its voices):

```sh
node scripts/generate-voice.mjs --pack gemini-achird --voice-ar Achird --voice-en Achird \
  --only check_intro,check_go,check_are_you_ok,stop_rest,count_3 --verify
```

The welcome (`preview`) is always added, because it is the sample the settings play. If a run stops
(daily quota), run it again later with `--only` and the ids it reports as missing. Each run updates
the pack's `manifest.json` (provenance) and its line in `index.json` (line count, complete or not).

## 3. Compare in the app

1. `npm run dev`, open http://localhost:5205, sign in.
2. Open the coach settings (the gear at the top, «صوت يناسبك» · "A voice that fits you").
3. **Choose a voice** appears once two or more packs are installed, each by its name («الصوت 2»).
   Tap a voice to hear its welcome; **Hear your coach** plays it again. Then run a workout or a
   movement check to hear it in use. Note which name is which pack id in `index.json`.

The choice is kept on that phone only. With a partial pack, the lines it lacks are heard in the
default voice.

## 4. Keep the one you like

- Make it the voice for everyone: set `"default"` in `public/cues/packs/index.json` to its id.
- Remove a pack: delete its folder and its entry in `index.json`. With one pack left, the settings
  hide the voice choice.
- Commit the pack folder and `index.json`; the voice reaches the live app with the next deploy.
