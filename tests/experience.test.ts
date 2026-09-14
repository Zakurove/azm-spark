import { afterEach,expect,it,vi } from 'vitest';
import { readPreferences,insight } from '../src/app/experience';
import { sessionCsv } from '../src/app/History';
import { SavedSession } from '../src/app/product';
afterEach(()=>vi.unstubAllGlobals());
it('recovers from malformed or unavailable stored preferences',()=>{
 vi.stubGlobal('localStorage',{getItem:()=>'{broken'});expect(readPreferences()).toEqual({voice:'full',pace:1,focus:false});
 vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify({voice:'remote',pace:8,focus:'yes'})});expect(readPreferences()).toEqual({voice:'full',pace:1,focus:false});
});
it('exports partial attempts separately and preserves unknown effort',()=>{
 const s={endedAt:1000,exerciseId:'sit_to_stand',reps:{valid:2,compensated:1,partial:4}} as SavedSession;
 expect(sessionCsv([s]).split('\r\n')[1]).toBe('1970-01-01T00:00:01.000Z,sit_to_stand,3,2,1,4,,');
});
it('does not congratulate an empty session',()=>{
 expect(insight({valid:0,compensated:0,partial:0},'en')).toMatch(/No repetitions/);
 expect(insight({valid:2,compensated:1,partial:0},'en')).toMatch(/flags/);
});
