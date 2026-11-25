// js/submit.js — proposal transport (SPEC §5): WhatsApp text & links, GitHub issue-form URL fitting, e-mail, owner URLs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildSubmission, issueUrl, messageText, issueTitle, waUrl, approvalComment, CODE_LABEL, GITHUB_URL_MAX, WHATSAPP_MAX,
  relayUrl, relaySummary, relayPayload, sendToRelay,
} from '../js/submit.js';
import { newProposal, proposalHash, fingerprintOf, FP_LENGTH } from '../js/core/ops.js';
import { decodeProposal } from '../js/core/codec.js';
import { normalizeData } from '../js/core/schema.js';
import { buildGraph } from '../js/core/graph.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const data = normalizeData(JSON.parse(read('../data/family.json')));
const graph = buildGraph(data);
const anyMan = Object.values(data.people).find((p) => p.gender === 'm' && !p.removed).id;

const CONFIG = {
  repo: { owner: 'octo', name: 'tree', branch: 'main' },
  owner: { name: { ar: 'أبو خالد', en: 'Abu Khalid' }, whatsapp: '+966 50 123 4567', email: '' },
};

function proposal(n = 2, extra = {}) {
  const p = newProposal();
  p.submitter = { name: 'سارة', relation: 'حفيدة حسن', personId: '' };
  p.note = 'ملاحظة';
  for (let i = 0; i < n; i++) {
    p.ops.push({ op: 'add-person', ref: `new${i + 1}`, person: { name: { ar: `ولد${i}` }, gender: 'm' }, link: { as: 'child', of: anyMan, with: null } });
  }
  return Object.assign(p, extra);
}

describe('submit: WhatsApp message', () => {
  test('format: greeting, submitter, numbered lines, id, label line, code alone in fences', async () => {
    const p = proposal(3);
    const s = await buildSubmission(p, { graph, lang: 'ar', config: CONFIG });
    const lines = s.whatsapp.text.split('\n');
    assert.match(lines[0], /السلام عليكم/);
    assert.ok(lines.some((l) => l.includes('سارة — حفيدة حسن')));
    assert.ok(lines.includes(`1. ${s.lines[0]}`));
    assert.ok(lines.some((l) => l.includes(p.id)));
    const i = lines.indexOf(CODE_LABEL);
    assert.ok(i > 0);
    assert.deepEqual(lines.slice(i + 1), ['```', s.code, '```']);
    assert.equal(lines[i - 1], '');
    assert.ok(s.whatsapp.url.startsWith('https://wa.me/966501234567?text='));
    assert.equal(decodeURIComponent(s.whatsapp.url.split('?text=')[1]), s.whatsapp.text);
    assert.equal(s.whatsapp.tooLong, false);
    assert.equal(s.whatsapp.hasNumber, true);
    assert.deepEqual(await decodeProposal(s.whatsapp.text), p);
  });

  test('at most 10 lines then "and N more"; English text', async () => {
    const s = await buildSubmission(proposal(13), { graph, lang: 'en', config: CONFIG });
    assert.ok(s.whatsapp.text.includes('10. '));
    assert.ok(!s.whatsapp.text.includes('\n11. '));
    assert.ok(s.whatsapp.text.includes('…and 3 more'));
    assert.match(s.whatsapp.text, /^Assalamu alaikum/);
    const ar = messageText({ lang: 'ar', lines: Array.from({ length: 25 }, (_, i) => `l${i}`), id: 'x', code: 'GFT1:a.b' });
    assert.ok(ar.includes('…و15 تعديلاً آخر'));
  });

  test('no number → wa.me/?text=; long text → tooLong with a plain link', async () => {
    const cfg = { ...CONFIG, owner: { ...CONFIG.owner, whatsapp: '' } };
    const s = await buildSubmission(proposal(1), { graph, lang: 'ar', config: cfg });
    assert.ok(s.whatsapp.url.startsWith('https://wa.me/?text='));
    assert.equal(s.whatsapp.hasNumber, false);
    assert.equal(waUrl('', ''), 'https://wa.me/');
    const big = proposal(1);
    big.note = 'x'.repeat(10);
    big.submitter.relation = 'ق'.repeat(1500);
    const s2 = await buildSubmission(big, { graph, lang: 'ar', config: CONFIG, code: `GFT1:${'A'.repeat(WHATSAPP_MAX)}.zz` });
    assert.equal(s2.whatsapp.tooLong, true);
    assert.equal(s2.whatsapp.url, 'https://wa.me/966501234567');
  });
});

describe('submit: GitHub issue form', () => {
  test('fields, template, measured on the encoded URL', async () => {
    const p = proposal(2);
    const s = await buildSubmission(p, { graph, lang: 'en', config: CONFIG });
    const u = new URL(s.github.url);
    assert.equal(u.origin + u.pathname, 'https://github.com/octo/tree/issues/new');
    assert.equal(u.searchParams.get('template'), 'family-tree-proposal.yml');
    assert.equal(u.searchParams.get('code'), s.code);
    assert.equal(u.searchParams.get('submitter'), 'سارة — حفيدة حسن');
    assert.equal(u.searchParams.get('note'), 'ملاحظة');
    assert.ok(u.searchParams.get('title').startsWith('🌳 '));
    assert.equal(s.github.fits, true);
    assert.equal(s.hash, await proposalHash(p));
    assert.equal(s.fp, fingerprintOf(s.hash));
    assert.equal(s.fp.length, FP_LENGTH);
  });

  test('drops note, then submitter, then shortens the title, then gives up', () => {
    const title = '🌳 ' + 'ع'.repeat(110);
    const base = { title, submitter: 'س'.repeat(300), note: 'ن'.repeat(400), config: CONFIG };
    const enc = (s) => encodeURIComponent(s).length;
    const fixed = 'https://github.com/octo/tree/issues/new?template=family-tree-proposal.yml&title=&code='.length + enc(title);
    // Room for code + submitter but not the note.
    let code = 'A'.repeat(GITHUB_URL_MAX - fixed - enc(base.submitter) - '&submitter='.length - 10);
    let r = issueUrl({ ...base, code });
    assert.equal(r.fits, true);
    assert.equal(new URL(r.url).searchParams.get('note'), null);
    assert.ok(new URL(r.url).searchParams.get('submitter'));
    code = 'A'.repeat(GITHUB_URL_MAX - fixed - 5);
    r = issueUrl({ ...base, code });
    assert.equal(r.fits, true);
    assert.equal(new URL(r.url).searchParams.get('submitter'), null);
    code = 'A'.repeat(GITHUB_URL_MAX - fixed + 200);
    r = issueUrl({ ...base, code });
    assert.equal(r.fits, true);
    assert.equal([...new URL(r.url).searchParams.get('title')].length, 60);
    r = issueUrl({ ...base, code: 'A'.repeat(GITHUB_URL_MAX) });
    assert.equal(r.fits, false);
    assert.equal(new URL(r.url).searchParams.get('code'), null);
    assert.ok(r.url.length <= GITHUB_URL_MAX);
  });

  test('owner approve URL carries labels; destructive → approve-deletion and ⚠️ title', async () => {
    const s = await buildSubmission(proposal(1), { graph, lang: 'ar', config: CONFIG });
    assert.equal(new URL(s.approveIssueUrl).searchParams.get('labels'), 'family-tree,approve');
    const d = await buildSubmission(proposal(1), { graph, lang: 'ar', config: CONFIG, destructive: true });
    assert.equal(new URL(d.approveIssueUrl).searchParams.get('labels'), 'family-tree,approve-deletion');
    assert.ok(d.title.startsWith('⚠️ 🌳 '));
    assert.ok([...issueTitle('x'.repeat(300))].length <= 120);
    assert.equal(approvalComment('GFT1:abc.1'), '/approve\nGFT1:abc.1');
    assert.equal(approvalComment('GFT1:abc.1', { destructive: true, fp: 'a1b2c3' }), '/approve-deletion a1b2c3\nGFT1:abc.1');
    assert.equal(s.approvalComment, `/approve ${s.fp}\n${s.code}`);
    assert.equal(d.approvalComment, `/approve-deletion ${d.fp}\n${d.code}`);
    const rm = proposal(0);
    rm.ops = [{ op: 'remove-person', id: anyMan, reasonCode: 'duplicate' }];
    const r = await buildSubmission(rm, { graph, lang: 'en', config: CONFIG });
    assert.ok(r.approvalComment.startsWith(`/approve-deletion ${r.fp}\n`));
  });

  test('e-mail only when configured', async () => {
    assert.equal((await buildSubmission(proposal(1), { graph, config: CONFIG })).email, null);
    const s = await buildSubmission(proposal(1), { graph, config: { ...CONFIG, owner: { ...CONFIG.owner, email: 'a@b.org' } } });
    assert.ok(s.email.url.startsWith('mailto:a@b.org?subject='));
  });
});

describe('submit: e-mail relay (config.relayUrl)', () => {
  const RELAY = 'https://script.google.com/macros/s/AKfy-test/exec';

  test('offered only for an https relayUrl', async () => {
    assert.equal((await buildSubmission(proposal(1), { graph, config: CONFIG })).relay, null);
    assert.equal(relayUrl({ relayUrl: 'http://script.google.com/x' }), '');
    assert.equal(relayUrl({ relayUrl: 'javascript:alert(1)' }), '');
    assert.equal(relayUrl({ relayUrl: ` ${RELAY} ` }), RELAY);
    const s = await buildSubmission(proposal(2), { graph, lang: 'en', config: { ...CONFIG, relayUrl: RELAY } });
    assert.equal(s.relay.url, RELAY);
    const p = s.relay.payload;
    assert.deepEqual(Object.keys(p).sort(), ['code', 'destructive', 'lang', 'note', 'proposalId', 'submitter', 'summary', 'title', 'website']);
    assert.equal(p.code, s.code);
    assert.equal(p.title, s.title);
    assert.equal(p.submitter, 'سارة — حفيدة حسن');
    assert.equal(p.note, 'ملاحظة');
    assert.equal(p.lang, 'en');
    assert.equal(p.website, '');
    assert.equal(p.destructive, false);
    assert.match(p.proposalId, /^[a-z0-9]{10}$/);
    // Arabic lines first, then English, each numbered from 1.
    assert.equal(p.summary.length, 4);
    assert.match(p.summary[0], /^1\. إضافة/);
    assert.match(p.summary[1], /^2\. إضافة/);
    assert.match(p.summary[2], /^1\. Add/);
    assert.match(p.summary[3], /^2\. Add/);
    const d = await buildSubmission(proposal(1), { graph, config: { ...CONFIG, relayUrl: RELAY }, destructive: true });
    assert.equal(d.relay.payload.destructive, true);
  });

  test('limits: ≤15 lines per language, 300 characters per line, submitter 200, note 2000', () => {
    const many = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const out = relaySummary(many, many);
    assert.equal(out.length, 30);
    assert.equal(out[13], '14. line 13');
    assert.equal(out[14], '…و6 تعديلات أخرى');
    assert.equal(out[29], '…and 6 more');
    assert.deepEqual(relaySummary(['a'], ['b']), ['1. a', '1. b']);
    assert.equal([...relaySummary(['ع'.repeat(500)], [])[0]].length, 300);
    const p = relayPayload({ code: 'GFT1:x.y', title: 't'.repeat(200), proposal: { id: 'abcd1234ef', submitter: { name: 'n'.repeat(150), relation: 'r'.repeat(300) }, note: 'x'.repeat(2500) } });
    assert.equal([...p.title].length, 120);
    assert.equal([...p.submitter].length, 200);
    assert.equal([...p.note].length, 2000);
  });

  test('sendToRelay: plain POST (no custom headers → no CORS preflight), follows the redirect, reads the answer', async () => {
    const calls = [];
    const fake = (answer, status = 200) => async (url, init) => {
      calls.push({ url, init });
      return { ok: status < 400, status, json: async () => { if (answer instanceof Error) throw answer; return answer; } };
    };
    const payload = { code: 'GFT1:x.y', website: '' };
    let r = await sendToRelay(RELAY, payload, { fetchImpl: fake({ ok: true, issue: 7, url: 'https://github.com/o/r/issues/7' }) });
    assert.deepEqual(r, { ok: true, issue: 7, url: 'https://github.com/o/r/issues/7', duplicate: false });
    const { url, init } = calls[0];
    assert.equal(url, RELAY);
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'follow');
    assert.equal(init.headers, undefined);
    assert.equal(typeof init.body, 'string');
    assert.deepEqual(JSON.parse(init.body), payload);
    r = await sendToRelay(RELAY, payload, { fetchImpl: fake({ ok: true, issue: 8, url: 'javascript:alert(1)', duplicate: true }) });
    assert.deepEqual(r, { ok: true, issue: 8, url: '', duplicate: true });
    assert.deepEqual(await sendToRelay(RELAY, payload, { fetchImpl: fake({ ok: false, error: 'rate_limited' }) }), { ok: false, error: 'rate_limited' });
    assert.deepEqual(await sendToRelay(RELAY, payload, { fetchImpl: fake({ ok: false, error: '<b>x</b>' }) }), { ok: false, error: 'bad_response' });
    assert.deepEqual(await sendToRelay(RELAY, payload, { fetchImpl: fake({ ok: true, issue: 'x' }) }), { ok: false, error: 'bad_response' });
    assert.deepEqual(await sendToRelay(RELAY, payload, { fetchImpl: fake(new Error('html'), 500) }), { ok: false, error: 'http_500' });
    assert.deepEqual(await sendToRelay(RELAY, payload, { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }), { ok: false, error: 'network' });
    const hang = (u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    assert.deepEqual(await sendToRelay(RELAY, payload, { fetchImpl: hang, timeoutMs: 10 }), { ok: false, error: 'timeout' });
  });
});
