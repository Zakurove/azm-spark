import { it, expect } from 'vitest';
import { sanitizeExtraction, validReportBody } from '../server/report';

it('sanitizes model output against the app enums and never trusts free values', () => {
 const r = sanitizeExtraction({
  document: 'medical_report',
  age: 62,
  conditions: ['stroke', 'made_up', 'none', 'stroke', 'cardiac'],
  diagnosisNotes: 'x'.repeat(2000),
  medications: 'Aspirin 81mg',
  mobility: 'hoverboard',
  support: 'right',
  pain: ['shoulder', 'soul'],
  restrictions: ['no_overhead', 'no_fun'],
  symptoms: 'no',
  recentChange: 'yes',
  missing: ['mobility', 'clearance', 'symptoms'],
  questions: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'],
  summary: 's'.repeat(500),
  confidence: 'certain',
 });
 expect(r.extracted.conditions).toEqual(['stroke', 'cardiac']);
 expect(r.extracted.diagnosisNotes.length).toBe(1200);
 expect(r.extracted.mobility).toBe('unknown');
 expect(r.extracted.support).toBe('right');
 expect(r.extracted.pain).toEqual(['shoulder']);
 expect(r.extracted.restrictions).toEqual(['no_overhead']);
 expect(r.extracted.symptoms).toBe('unknown');
 expect(r.extracted.recentChange).toBe('yes');
 expect(r.missing).toEqual(['mobility', 'symptoms']);
 expect(r.questions.length).toBe(5);
 expect(r.summary.length).toBe(300);
 expect(r.confidence).toBe('low');
});

it('never emits clearance and treats junk as unreadable', () => {
 const r = sanitizeExtraction({ clearance: 'yes' });
 expect((r.extracted as Record<string, unknown>).clearance).toBeUndefined();
 expect(r.document).toBe('unreadable');
 expect(r.extracted.age).toBeNull();
 expect(r.extracted.conditions).toEqual([]);
});

it('validates report request bodies strictly', () => {
 expect(validReportBody({ kind: 'text', text: 'تقرير طبي' })).toBe(true);
 expect(validReportBody({ kind: 'text', text: '' })).toBe(false);
 expect(validReportBody({ kind: 'text', text: 'x'.repeat(20001) })).toBe(false);
 expect(validReportBody({ kind: 'image', image: 'data:image/jpeg;base64,aGVsbG8=' })).toBe(true);
 expect(validReportBody({ kind: 'image', image: 'data:text/html;base64,aGVsbG8=' })).toBe(false);
 expect(validReportBody({ kind: 'image', image: 'https://example.com/x.jpg' })).toBe(false);
 expect(validReportBody({ kind: 'text', text: 'ok', lang: 'fr' })).toBe(false);
 expect(validReportBody(null)).toBe(false);
});

import { createServer } from 'node:http';
import { createApi } from '../server/api';

it('rejects unauthenticated report posts before buffering large bodies, and keeps the small cap elsewhere', async () => {
 const service = createApi(':memory:');
 const server = createServer((req, res) => void service.handle(req, res));
 await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
 const origin = `http://127.0.0.1:${(server.address() as any).port}`;
 const headers = { origin, 'Content-Type': 'application/json', 'X-Azm-Request': '1' };
 // Unauthenticated: 401 immediately, even with a multi-megabyte body on the wire.
 const big = JSON.stringify({ kind: 'text', text: 'x'.repeat(2_000_000) });
 const r1 = await fetch(`${origin}/api/medical-report`, { method: 'POST', headers, body: big });
 expect(r1.status).toBe(401);
 // Authenticated caller on a NON-report route still hits the 64KB cap.
 const reg = await fetch(`${origin}/api/auth/register`, { method: 'POST', headers, body: JSON.stringify({ name: 'Cap Test', email: 'cap@example.test', password: 'test-password-9281' }) });
 const cookie = reg.headers.get('set-cookie')!.split(';')[0];
 const r2 = await fetch(`${origin}/api/intake`, { method: 'PUT', headers: { ...headers, cookie }, body: JSON.stringify({ pad: 'x'.repeat(100_000) }) });
 expect(r2.status).toBe(413);
 // Authenticated report post without a key configured degrades to 503, not a crash.
 const prev = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
 const r3 = await fetch(`${origin}/api/medical-report`, { method: 'POST', headers: { ...headers, cookie }, body: JSON.stringify({ kind: 'text', text: 'تقرير' }) });
 expect(r3.status).toBe(503);
 if (prev) process.env.OPENAI_API_KEY = prev;
 await new Promise<void>(r => server.close(() => r()));
 service.close();
});
