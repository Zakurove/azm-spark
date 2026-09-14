import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({files:vi.fn(),create:vi.fn()}));
vi.mock('@mediapipe/tasks-vision',()=>({FilesetResolver:{forVisionTasks:mocks.files},PoseLandmarker:{createFromOptions:mocks.create}}));
import {CameraPoseSource} from '../src/app/poseSource';
function deferred<T>() { let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve}; }
const video=()=>({srcObject:null,play:vi.fn().mockResolvedValue(undefined),currentTime:1,videoWidth:1280}) as unknown as HTMLVideoElement;
beforeEach(()=>{vi.clearAllMocks();mocks.files.mockResolvedValue({});vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());});
afterEach(()=>vi.unstubAllGlobals());
describe('camera privacy lifecycle',()=>{
 it('does not ask for camera access after leaving during model loading',async()=>{
  const model=deferred<any>();mocks.create.mockReturnValue(model.promise);const getUserMedia=vi.fn();vi.stubGlobal('navigator',{mediaDevices:{getUserMedia}});
  const src=new CameraPoseSource(video());const run=src.start(vi.fn());await Promise.resolve();src.stop();const close=vi.fn();model.resolve({close});await run;
  expect(close).toHaveBeenCalledOnce();expect(getUserMedia).not.toHaveBeenCalled();
 });
 it('closes a camera stream that arrives after the session was stopped',async()=>{
  const stream=deferred<any>(),close=vi.fn(),stop=vi.fn();mocks.create.mockResolvedValue({close});const getUserMedia=vi.fn(()=>stream.promise);vi.stubGlobal('navigator',{mediaDevices:{getUserMedia}});
  const v=video(),src=new CameraPoseSource(v),run=src.start(vi.fn());await vi.waitFor(()=>expect(getUserMedia).toHaveBeenCalled());src.stop();stream.resolve({getTracks:()=>[{stop}]});await run;
  expect(stop).toHaveBeenCalledOnce();expect(v.srcObject).toBe(null);
 });
 it('reports missing poses so the framing guard does not retain stale tracking',async()=>{
  let loop:FrameRequestCallback|undefined;vi.stubGlobal('requestAnimationFrame',vi.fn((cb:FrameRequestCallback)=>{loop=cb;return 1;}));
  const stop=vi.fn(),close=vi.fn();mocks.create.mockResolvedValue({close,detectForVideo:()=>({landmarks:[]})});vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop}]})}});
  const v=video(),src=new CameraPoseSource(v),onFrame=vi.fn();await src.start(onFrame);loop!(1);expect(onFrame.mock.calls[0][0].lm.every((p:any)=>p.visibility===0)).toBe(true);src.stop();expect(stop).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();
 });
});
