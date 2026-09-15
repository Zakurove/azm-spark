import { it, expect } from 'vitest';
import { createPlan, Intake } from '../src/medical/plan';
import { cleanText, defaultSelection, eligibleExercises, engineWeekly, libraryById, sanitizeSelection } from '../src/medical/weekly';

const base: Intake = { age: 45, conditions: ['none'], diagnosisNotes: '', medications: '', mobility: 'seated', support: 'none', pain: [], restrictions: [], symptoms: 'no', recentChange: 'no', clearance: 'no', equipment: ['chair'], goal: 'mobility', days: [0, 2, 4], time: '09:00', sessionMinutes: 30, consent: true };
const DASH = /[—–]|\s-\s/;

it('keeps wheelchair users on wheelchair friendly, non floor exercises only', () => {
 const h: Intake = { ...base, mobility: 'wheelchair' };
 const pool = eligibleExercises(h, createPlan(h));
 expect(pool.length).toBeGreaterThan(8);
 for (const e of pool) {
  expect(e.tags.includes('wheelchair_friendly') || (e.tags.includes('seated') && !e.tags.includes('standing'))).toBe(true);
  expect(e.tags.includes('floor_exercise') || e.tags.includes('lying_down')).toBe(false);
 }
});

it('removes exercises contraindicated by reported pain, equipment, and restrictions', () => {
 const shoulder = eligibleExercises({ ...base, pain: ['shoulder'] }, createPlan({ ...base, pain: ['shoulder'] }));
 expect(shoulder.some(e => e.contraindications.includes('shoulder_injury'))).toBe(false);
 expect(eligibleExercises(base, createPlan(base)).some(e => e.equipment.length)).toBe(false);
 const weighted = { ...base, equipment: ['chair', 'weights'], restrictions: ['no_resistance'] };
 expect(eligibleExercises(weighted, createPlan(weighted)).some(e => e.equipment.length)).toBe(false);
 const overhead = { ...base, restrictions: ['no_overhead'] };
 expect(eligibleExercises(overhead, createPlan(overhead)).some(e => /overhead/i.test(`${e.name.en} ${e.description.en} ${e.steps.en.join(' ')}`))).toBe(false);
});

it('never builds a weekly plan for a plan that needs review', () => {
 const h: Intake = { ...base, conditions: ['cardiac'] };
 const plan = createPlan(h);
 expect(plan.status).toBe('review');
 expect(eligibleExercises(h, plan)).toEqual([]);
 expect(engineWeekly(h, plan)).toBeNull();
});

it('composes one day per training day from the safe pool, with clean copy', () => {
 const plan = createPlan(base);
 const weekly = engineWeekly(base, plan)!;
 const pool = new Set(eligibleExercises(base, plan).map(e => e.id));
 expect(weekly.days.map(d => d.day)).toEqual(plan.days);
 for (const d of weekly.days) {
  const ids = [...d.warmup, ...d.extra, ...d.cooldown].map(i => i.id);
  expect(new Set(ids).size).toBe(ids.length);
  ids.forEach(id => { expect(pool.has(id)).toBe(true); expect(libraryById(id)).toBeTruthy(); });
  expect(d.warmup.length).toBeGreaterThan(0);
  expect(d.extra.length).toBeGreaterThan(0);
 }
 const text = JSON.stringify([weekly.summary, weekly.why, weekly.tips]);
 expect(DASH.test(text)).toBe(false);
 expect(weekly.summary.ar).toContain('حالتك الطبية');
});

it('discards model ids outside the safe pool and cleans its wording', () => {
 const plan = createPlan(base);
 const pool = eligibleExercises(base, plan);
 const fallback = defaultSelection(base, plan, pool);
 const s = sanitizeSelection({
  summary: { ar: 'خطة تناسب حالتك الصحية — كل يوم', en: 'A plan — for you' },
  days: [{ warmup: ['not_real', pool[0].id], extra: ['barbell_squat'], cooldown: [], notes: [{ id: 'nope', ar: 'x', en: 'x' }] }],
 }, plan, pool, fallback);
 expect(s.days[0].warmup).toEqual([pool[0].id]);
 expect(s.days[0].extra).toEqual(fallback.days[0].extra.filter(id => id !== pool[0].id).slice(0, 3));
 expect(s.days[0].notes).toEqual([]);
 expect(s.summary!.ar).toBe('خطة تناسب حالتك الطبية، كل يوم');
 expect(DASH.test(s.summary!.en)).toBe(false);
 expect(cleanText('a - b', 'en', 50)).toBe('a, b');
});
