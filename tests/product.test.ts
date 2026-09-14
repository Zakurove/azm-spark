import { describe, expect, it } from 'vitest';
import { availableFor, illustration, sessionProfile } from '../src/app/product';
import { projection } from '../src/app/overlay';

describe('adaptive product setup',()=>{
 it('keeps unsupported standing versions out of the exercise list',()=>{
  expect(availableFor({position:'rise',support:'none'}).map(e=>e.id)).toEqual(['sit_to_stand']);
  for(const position of ['chair','wheelchair'] as const)expect(availableFor({position,support:'none'}).map(e=>e.id)).toEqual(['seated_shoulder_press','seated_biceps_curl']);
 });
 it('preserves upper-body masking together with side-specific support',()=>{
  const p=sessionProfile({position:'wheelchair',support:'left'});
  expect(p.seated).toBe(true);expect(p.unscoredRegions).toContain('lower_limbs');expect(p.expectedAsymmetry).toBe('left');
 });
 it('does not imply wheelchair use for ordinary chair exercises',()=>{
  const setup={position:'chair',support:'right'} as const;
  expect(illustration(setup,'seated_biceps_curl')).toBe('/illustrations/chair-curl.png');
  expect(sessionProfile(setup).id).toBe('hemiparesis_right');
 });
 it('shows a standing reference for sit-to-stand',()=>expect(illustration({position:'rise',support:'none'},'sit_to_stand')).toBe('/illustrations/standing.png'));
});
describe('movement projection',()=>{
 it('preserves demo limb length and angles across canvas aspect ratios',()=>{
  for(const[w,h]of [[1440,722],[390,500],[200,100]]){
   const p=projection(w,h,{demo:true,mirrored:false});const a=p(.5,.5),b=p(.6,.5),c=p(.5,.6);
   expect(Math.hypot(b.x-a.x,b.y-a.y)).toBeCloseTo(Math.hypot(c.x-a.x,c.y-a.y));
  }
 });
 it('maps camera landmarks to letterboxed portrait video and mirrors consistently',()=>{
  const p=projection(800,600,{demo:false,sourceWidth:600,sourceHeight:800,mirrored:true});
  expect(p(0,0)).toEqual({x:625,y:0});expect(p(1,1)).toEqual({x:175,y:600});expect(p(.5,.5)).toEqual({x:400,y:300});
 });
});
