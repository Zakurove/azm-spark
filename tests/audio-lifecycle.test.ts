import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CuePlayer } from '../src/app/audio';
let pending: {onerror:()=>void;oncanplaythrough:()=>void;pause:ReturnType<typeof vi.fn>;play:ReturnType<typeof vi.fn>}[];
let speak:ReturnType<typeof vi.fn>;
beforeEach(()=>{
 pending=[];speak=vi.fn();
 vi.stubGlobal('Audio',class {onerror=()=>{};oncanplaythrough=()=>{};pause=vi.fn();play=vi.fn().mockResolvedValue(undefined);load(){pending.push(this);}});
 vi.stubGlobal('SpeechSynthesisUtterance',class {constructor(public text:string){}});
 vi.stubGlobal('speechSynthesis',{cancel:vi.fn(),speak,getVoices:()=>[{lang:'ar-SA',localService:true}]});
});
afterEach(()=>vi.unstubAllGlobals());
it('does not speak a pending cue after stopping or muting',async()=>{
 const player=new CuePlayer('ar');const first=player.count(1);player.stop();pending[0].onerror();await first;expect(speak).not.toHaveBeenCalled();
 const next=player.count(2);player.muted=true;pending[1].oncanplaythrough();await next;expect(pending[1].play).not.toHaveBeenCalled();
});
it('pauses an active recording on stop',async()=>{
 const player=new CuePlayer('ar'),run=player.count(1);pending[0].oncanplaythrough();await run;expect(pending[0].play).toHaveBeenCalledOnce();player.stop();expect(pending[0].pause).toHaveBeenCalledOnce();
});
it('only falls back to a local voice',async()=>{
 vi.stubGlobal('speechSynthesis',{cancel:vi.fn(),speak,getVoices:()=>[{lang:'ar-SA',localService:false}]});
 const player=new CuePlayer('ar'),run=player.count(1);pending[0].onerror();await run;expect(speak).not.toHaveBeenCalled();
});
it('never lets a count cut off an active safety instruction',async()=>{
 const player=new CuePlayer('ar'),warning=player.cue('stop_rest','safety');pending[0].oncanplaythrough();await warning;
 expect(await player.count(1)).toBe(false);expect(pending).toHaveLength(1);expect(pending[0].pause).not.toHaveBeenCalled();
});
it('interrupts a count immediately for safety',async()=>{
 const player=new CuePlayer('ar'),count=player.count(1);pending[0].oncanplaythrough();await count;
 const warning=player.cue('stop_rest','safety');expect(pending[0].pause).toHaveBeenCalledOnce();pending[1].oncanplaythrough();await warning;expect(pending[1].play).toHaveBeenCalledOnce();
});
it('omits counts in guidance-only mode while retaining correction cues',async()=>{
 const player=new CuePlayer('ar');player.guidanceOnly=true;expect(await player.count(1)).toBe(false);expect(pending).toHaveLength(0);
 const warning=player.cue('sit_tall');pending[0].oncanplaythrough();await warning;expect(pending[0].play).toHaveBeenCalledOnce();
});
