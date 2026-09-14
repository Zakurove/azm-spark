"""Build-time voice generation. Sends only the public coaching script, no user data.
Install edge-tts in a separate build environment. The browser never calls this service.
"""
import asyncio,json,pathlib,edge_tts
root=pathlib.Path(__file__).resolve().parent.parent
script=json.loads((root/'src/app/voice-script.json').read_text())
voices={'ar':'ar-SA-HamedNeural','en':'en-GB-RyanNeural'}
async def main():
 gate=asyncio.Semaphore(3)
 async def build(lang,key,text):
  path=root/'public/cues'/lang/f'{key}.mp3';path.parent.mkdir(parents=True,exist_ok=True)
  if path.exists() and path.stat().st_size>1000:return
  async with gate:
   for attempt in range(3):
    try:
     await edge_tts.Communicate(text,voices[lang],rate='-8%').save(str(path));print(lang,key,flush=True);return
    except Exception:
     if attempt==2:raise
     await asyncio.sleep(1+attempt)
 await asyncio.gather(*(build(lang,k,v[lang]) for lang in voices for k,v in script.items()))
 (root/'public/cues/manifest.json').write_text(json.dumps({'voices':voices,'generationRate':'-8%','delivery':'local bundled MP3','script':script},ensure_ascii=False,indent=2))
asyncio.run(main())
