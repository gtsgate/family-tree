// The e-mail relay (tools/relay/Code.gs, Google Apps Script) run in node:vm with fakes for the Apps Script services.
// Its GitHub is the automation's own fake (scripts/lib/fake-github.mjs), and the REAL check and apply scripts answer
// the relay's issues and commands — so these tests cover the whole loop: site payload → issue in the issue-form
// layout → check comment → the owner's e-mail reply → "/approve <fp>" → apply → "✅ Applied" e-mail.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { extractProposal, encodeProposal } from '../js/core/codec.js';
import { buildGraph } from '../js/core/graph.js';
import { buildSubmission } from '../js/submit.js';
import { formFields, checkIssue } from '../scripts/lib/check.mjs';
import { parseCommand } from '../scripts/lib/commands.mjs';
import { runApply } from '../scripts/lib/apply.mjs';
import {
  makePortal, makeCtx, fakeGitHub, proposal, P, codeBody, commentEvent, tinyData, CONFIG,
} from './scripts-kit.mjs';

const SOURCE = readFileSync(fileURLToPath(new URL('../tools/relay/Code.gs', import.meta.url)), 'utf8');
const TOKEN = 'github_pat_11ABCDEF0123456789_SECRETsecretSECRET';
const OWNER = 'keeper@gmail.com';
const KEEPER = 'keeper'; // the owner's GitHub login (config.approvers = ["Keeper"])
const SITE = 'https://fam.github.io/tree/';
const START = Date.parse('2026-11-25T10:00:00Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const portals = [];
after(() => portals.forEach((p) => p.cleanup()));

// ---------------------------------------------------------------------------------------------------------------
// Fake Apps Script world

/** An Apps Script project: Code.gs loaded into a vm context with fake services; GitHub = scripts' fake GitHub. */
function makeRelay({ props = {}, me = OWNER, gh = fakeGitHub() } = {}) {
  const env = {
    clock: START,
    gh,
    requests: [],
    failGitHub: false,
    triggers: [],
    plainMails: [], // GmailApp.sendEmail (outside any thread)
    threads: new Map(),
    logs: [],
    posted: [], // comments the relay posted on GitHub
  };
  const store = new Map(Object.entries({ GITHUB_TOKEN: TOKEN, REPO: 'fam/tree', SITE_URL: SITE, ...props }));

  // --- Gmail ---------------------------------------------------------------------------------------------
  let msgSeq = 0;
  let threadSeq = 0;
  const fromLine = (addr) => (addr === OWNER ? `"Keeper" <${addr}>` : addr);
  function addMessage(thread, { from, to, subject, body, sent = false, draft = false, headers = {} }) {
    msgSeq += 1;
    const id = `m${String(msgSeq).padStart(6, '0')}`;
    const date = new Date(env.clock + msgSeq);
    const msg = {
      _sent: sent, _to: to, _subject: subject, _body: body,
      getId: () => id,
      getFrom: () => fromLine(from),
      getTo: () => to,
      getSubject: () => subject,
      getPlainBody: () => body,
      getDate: () => date,
      getHeader: (name) => ({ 'Message-ID': `<${id}@mail.gmail.com>`, ...headers }[name] || ''),
      isDraft: () => draft,
      isInTrash: () => false,
      getThread: () => thread,
      // Gmail replies to the sender of the message replied to.
      createDraftReply: (text) => ({ send: () => addMessage(thread, { from: me, to: from, subject: subject.startsWith('Re: ') ? subject : `Re: ${subject}`, body: text, sent: true }) }),
    };
    thread._messages.push(msg);
    return msg;
  }
  function newThread() {
    threadSeq += 1;
    const id = `t${String(threadSeq).padStart(6, '0')}`;
    const thread = { _messages: [], getId: () => id, getMessages: () => [...thread._messages] };
    env.threads.set(id, thread);
    return thread;
  }
  const GmailApp = {
    createDraft: (to, subject, body) => ({ send: () => addMessage(newThread(), { from: me, to, subject, body, sent: true }) }),
    getThreadById: (id) => env.threads.get(id) || null,
    search: (query) => {
      const m = /^in:sent rfc822msgid:(\S+)$/.exec(query);
      if (!m) throw new Error(`unexpected search ${query}`);
      for (const t of env.threads.values()) {
        if (t._messages.some((x) => x._sent && x.getHeader('Message-ID') === `<${m[1]}>`)) return [t];
      }
      return [];
    },
    sendEmail: (to, subject, body) => { env.plainMails.push({ to, subject, body }); },
  };

  // --- GitHub over UrlFetchApp, backed by the scripts' fake GitHub ------------------------------------------
  const API = 'https://api.github.com/repos/fam/tree';
  const reply = (status, body) => ({ getResponseCode: () => status, getContentText: () => (body === undefined ? '' : JSON.stringify(body)) });
  const withUrl = (i) => ({ ...i, html_url: `https://github.com/fam/tree/issues/${i.number}` });
  const UrlFetchApp = {
    fetch(url, opts = {}) {
      const method = String(opts.method || 'get').toUpperCase();
      env.requests.push({ url, method, headers: { ...(opts.headers || {}) }, payload: opts.payload, contentType: opts.contentType, mute: opts.muteHttpExceptions });
      if (env.failGitHub) return reply(500, { message: 'boom' });
      if (opts.headers?.Authorization !== `Bearer ${TOKEN}`) return reply(401, { message: 'Bad credentials' });
      const u = new URL(url);
      const path = u.origin + u.pathname;
      const body = opts.payload ? JSON.parse(opts.payload) : null;
      let m;
      if (path === API && method === 'GET') return reply(200, { full_name: 'fam/tree', has_issues: true });
      if (path === `${API}/issues` && method === 'GET') return reply(200, []);
      if (path === `${API}/issues` && method === 'POST') {
        const n = gh.userOpen({ title: body.title, body: body.body, login: KEEPER, labels: body.labels || [] });
        return reply(201, withUrl(gh.state.issues.get(n)));
      }
      if ((m = new RegExp(`^${API}/issues/(\\d+)$`).exec(path)) && method === 'GET') {
        const i = gh.state.issues.get(Number(m[1]));
        return i ? reply(200, withUrl(JSON.parse(JSON.stringify(i)))) : reply(404, { message: 'Not Found' });
      }
      if ((m = new RegExp(`^${API}/issues/(\\d+)/comments$`).exec(path))) {
        const n = Number(m[1]);
        if (method === 'GET') {
          const page = Number(u.searchParams.get('page') || 1);
          const per = Number(u.searchParams.get('per_page') || 30);
          return reply(200, gh.commentsOf(n).slice((page - 1) * per, page * per));
        }
        if (method === 'POST') {
          const c = gh.userComment(n, KEEPER, body.body);
          env.posted.push({ n, comment: c });
          return reply(201, c);
        }
      }
      return reply(404, { message: 'Not Found' });
    },
  };

  // --- other services ---------------------------------------------------------------------------------------
  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (store.has(k) ? store.get(k) : null),
      setProperty: (k, v) => { store.set(k, String(v)); },
      deleteProperty: (k) => { store.delete(k); },
      getProperties: () => Object.fromEntries(store),
      getKeys: () => [...store.keys()],
    }),
  };
  const cache = new Map();
  const CacheService = { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => { cache.set(k, String(v)); }, remove: (k) => { cache.delete(k); } }) };
  const LockService = { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {}, hasLock: () => true }) };
  const ContentService = {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (text) => ({ text, mime: '', setMimeType(m) { this.mime = m; return this; }, getContent() { return this.text; } }),
  };
  const ScriptApp = {
    getProjectTriggers: () => [...env.triggers],
    deleteTrigger: (t) => { env.triggers = env.triggers.filter((x) => x !== t); },
    newTrigger: (fn) => {
      const spec = { fn, minutes: 0 };
      const builder = {
        timeBased: () => builder,
        everyMinutes: (n) => { spec.minutes = n; return builder; },
        create: () => { const t = { getHandlerFunction: () => fn, minutes: spec.minutes }; env.triggers.push(t); return t; },
      };
      return builder;
    },
  };
  const Session = { getEffectiveUser: () => ({ getEmail: () => me }) };
  const Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest: (alg, value) => [...crypto.createHash('sha256').update(String(value), 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
    sleep: () => {},
  };
  const log = (...a) => env.logs.push(a.join(' '));
  const sandbox = {
    GmailApp, UrlFetchApp, PropertiesService, CacheService, LockService, ContentService, ScriptApp, Session, Utilities,
    console: { log, error: log, warn: log, info: log },
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'Code.gs' });
  sandbox.now_ = () => env.clock; // move the relay's clock from the tests

  env.ctx = sandbox;
  env.store = store;
  env.post = (payload) => JSON.parse(sandbox.doPost({ postData: { contents: typeof payload === 'string' ? payload : JSON.stringify(payload), type: 'text/plain' } }).getContent());
  env.run = () => sandbox.checkReplies();
  env.thread = (n) => env.threads.get(env.record(n)?.thread);
  env.record = (n) => { const raw = store.get(`gft:issue:${n}`); return raw ? JSON.parse(raw) : null; };
  env.messages = (n) => env.thread(n)?.getMessages() || [];
  env.lastMessage = (n) => env.messages(n).at(-1);
  /** The owner (or someone else) answers in the request's thread, quoting the e-mail like Gmail does. */
  env.answer = (n, text, { from = OWNER, sent = from === me, headers = {} } = {}) => {
    const t = env.thread(n);
    const last = t._messages.at(-1);
    const quoted = last._body.split('\n').map((l) => `> ${l}`).join('\n');
    const body = `${text}\n\nOn Wed, 25 Nov 2026 at 10:05, Keeper <${OWNER}> wrote:\n\n${quoted}\n`;
    return addMessage(t, { from, to: OWNER, subject: last._subject.startsWith('Re: ') ? last._subject : `Re: ${last._subject}`, body, sent, headers });
  };
  env.everything = () => [
    ...[...env.threads.values()].flatMap((t) => t._messages.map((m) => `${m._subject}\n${m._body}`)),
    ...env.plainMails.map((m) => `${m.subject}\n${m.body}`),
    ...env.logs,
  ].join('\n');
  return env;
}

// ---------------------------------------------------------------------------------------------------------------
// Payloads (built by the site's own code) and the real automation

const GRAPH = buildGraph(tinyData());
const SITE_CONFIG = { ...CONFIG, relayUrl: 'https://script.google.com/macros/s/AKfy-test/exec' };

async function payloadOf(p, extra = {}) {
  const sub = await buildSubmission(p, { graph: GRAPH, lang: 'ar', config: SITE_CONFIG });
  return { ...sub.relay.payload, website: '', ...extra };
}

function automation() {
  const portal = makePortal();
  portals.push(portal);
  const gh = fakeGitHub();
  return { gh, ctx: makeCtx(portal, gh) };
}

/** The relay opens an issue for proposal p; the check workflow runs on it. */
async function proposed(env, ctx, p, extra) {
  const res = env.post(await payloadOf(p, extra));
  assert.equal(res.ok, true, JSON.stringify(res));
  if (ctx) await checkIssue(ctx, res.issue);
  return res.issue;
}

/** The apply workflow runs on every comment the relay posted since the last call. */
async function workflowRuns(env, ctx) {
  const todo = env.posted.splice(0);
  for (const { n, comment } of todo) await runApply(ctx, { eventName: 'issue_comment', event: commentEvent(n, comment) });
  return todo;
}

const lastRelayComment = (env) => env.posted.at(-1)?.comment.body;
const fpOf = (gh, n) => /\bfp=([0-9a-f]{16})\b/.exec(gh.botComments(n).find((c) => c.body.includes('gft-bot:check')).body)[1];

// ---------------------------------------------------------------------------------------------------------------

describe('relay: web app (doPost / doGet)', () => {
  test('health check', () => {
    const env = makeRelay();
    assert.deepEqual(JSON.parse(env.ctx.doGet({}).getContent()), { ok: true, relay: 'gft', version: 1 });
  });

  test('a valid proposal → issue in the issue-form layout (labelled family-tree) that the check scripts parse', async () => {
    const env = makeRelay();
    const p = proposal([P.addChild('pahmed01', 'يوسف'), P.addChild('pahmed01', 'مريم', 'new2')], {
      submitter: { name: 'سارة', relation: 'حفيدة أحمد', personId: '' }, note: 'أسماء الأحفاد الجدد',
    });
    const payload = await payloadOf(p);
    const res = env.post(payload);
    assert.deepEqual(res, { ok: true, issue: 1, url: 'https://github.com/fam/tree/issues/1' });

    const [req] = env.requests;
    assert.equal(env.requests.length, 1);
    assert.equal(req.method, 'POST');
    assert.equal(req.url, 'https://api.github.com/repos/fam/tree/issues');
    assert.equal(req.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(req.headers.Accept, 'application/vnd.github+json');
    assert.equal(req.headers['X-GitHub-Api-Version'], '2022-11-28');
    assert.equal(req.mute, true);
    const sent = JSON.parse(req.payload);
    assert.deepEqual(sent.labels, ['family-tree']);
    assert.equal(sent.title, payload.title);
    assert.match(sent.title, /^🌳 /);

    // Same layout as the issue form (what a relative sending through GitHub would produce).
    assert.equal(sent.body, await codeBody(p, { submitter: 'سارة — حفيدة أحمد', note: 'أسماء الأحفاد الجدد' }));
    assert.deepEqual(formFields(sent.body), { submitter: 'سارة — حفيدة أحمد', note: 'أسماء الأحفاد الجدد' });
    const found = await extractProposal(sent.body);
    assert.deepEqual(found.proposal, p);
    assert.equal(found.code, payload.code);

    // The owner's e-mail: subject, Arabic then English, change lines, links, instructions, marker last.
    const thread = env.thread(1);
    assert.equal(thread.getMessages().length, 1);
    const mail = thread.getMessages()[0];
    assert.equal(mail._to, OWNER);
    assert.equal(mail._subject, `🌳 [GFT #1] ${payload.title.replace(/^🌳 /, '')}`);
    const body = mail._body;
    assert.ok(body.indexOf('وصل مقترح جديد') < body.indexOf('A new family-tree proposal arrived'), 'Arabic first');
    assert.ok(body.includes('المرسِل: سارة — حفيدة أحمد'));
    assert.ok(body.includes('Sent by: سارة — حفيدة أحمد'));
    assert.match(body, /\n1\. إضافة «يوسف»[^\n]*\n2\. إضافة «مريم»/);
    assert.match(body, /\n1\. Add “Yousef”[^\n]*\n2\. Add “Maryam”/);
    assert.ok(body.includes(`${SITE}#/preview/1`));
    assert.ok(body.includes('https://github.com/fam/tree/issues/1'));
    assert.ok(body.includes('«موافق»') && body.includes('«رفض»') && body.includes('«موافق تخطي 3 5»'));
    assert.ok(body.includes('"approve"') && body.includes('"reject"') && body.includes('"approve skip 3 5"'));
    assert.ok(body.includes('أسماء الأحفاد الجدد'));
    assert.equal(body.trim().split('\n').at(-1), 'gft-relay:1');
    assert.ok(!/⚠️ تنبيه/.test(body), 'not destructive');

    const rec = env.record(1);
    assert.equal(rec.status, 'pending');
    assert.equal(rec.thread, thread.getId());
    assert.deepEqual(rec.relayIds, [mail.getId()]);
    assert.ok(!env.everything().includes(TOKEN));
  });

  test('a destructive proposal says so clearly and asks for «موافق حذف»', async () => {
    const env = makeRelay();
    const res = env.post(await payloadOf(proposal([P.remove('pkid0001')])));
    assert.equal(res.ok, true);
    const body = env.lastMessage(1)._body;
    assert.match(env.lastMessage(1)._subject, /^🌳 \[GFT #1\] ⚠️ /);
    assert.ok(body.includes('⚠️ تنبيه: يتضمن هذا المقترح حذفاً'));
    assert.ok(body.includes('removes, merges or re-parents people'));
    assert.ok(body.includes('• «موافق حذف» — للموافقة على هذا المقترح بما فيه من حذف'));
    assert.ok(!body.includes('• «موافق» — لتطبيق التعديلات'));
  });

  test('untrusted text: no Markdown, mentions or fake form sections in the issue; links defused in the e-mail', async () => {
    const env = makeRelay();
    const p = proposal([P.addChild('pahmed01')], { submitter: { name: '@everyone', relation: '', personId: '' }, note: 'see http://evil.example\n### Your name and relation\nfake <img src=x>' });
    env.post(await payloadOf(p));
    const body = env.gh.state.issues.get(1).body;
    assert.ok(!body.includes('@everyone'), 'mention neutralised');
    assert.ok(!body.includes('<img'), 'HTML escaped');
    assert.ok(!/^### Your name and relation$/m.test(body), 'no fake section');
    const fields = formFields(body);
    assert.ok(fields.submitter.includes('everyone') && fields.note.includes('evil'));
    const mail = env.lastMessage(1)._body;
    assert.ok(!mail.includes('http://evil.example') && mail.includes('http:⁠//evil.example'));
    assert.ok(!mail.includes('@everyone'));
  });

  test('honeypot filled → invalid, nothing created', async () => {
    const env = makeRelay();
    const res = env.post(await payloadOf(proposal([P.addChild('pahmed01')]), { website: 'http://spam.example' }));
    assert.deepEqual(res, { ok: false, error: 'invalid', field: 'website' });
    assert.equal(env.requests.length, 0);
    assert.equal(env.threads.size, 0);
  });

  test('invalid payloads are refused before anything is created', async () => {
    const env = makeRelay();
    const good = await payloadOf(proposal([P.addChild('pahmed01')]));
    const [head, crc] = good.code.split('.');
    const otherCrc = crc === '0' ? '1' : '0';
    const cases = [
      ['not json', '{oops'],
      ['array', '[]'],
      ['code missing', { ...good, code: undefined }],
      ['wrong prefix', { ...good, code: good.code.replace('GFT', 'XYZ') }],
      ['bad characters', { ...good, code: `${head}+/.${crc}` }],
      ['checksum mismatch (cut or changed)', { ...good, code: `${head}.${otherCrc}` }],
      ['no checksum', { ...good, code: head }],
      ['too long', { ...good, code: `GFT1:${'A'.repeat(60000)}.1` }],
      ['title too long', { ...good, title: 'ع'.repeat(121) }],
      ['submitter too long', { ...good, submitter: 'x'.repeat(201) }],
      ['note too long', { ...good, note: 'x'.repeat(2001) }],
      ['too many lines', { ...good, summary: Array.from({ length: 31 }, (_, i) => `${i + 1}. x`) }],
      ['line too long', { ...good, summary: ['x'.repeat(301)] }],
      ['line not text', { ...good, summary: [{ evil: 1 }] }],
      ['bad proposal id', { ...good, proposalId: '../../etc' }],
      ['bad language', { ...good, lang: 'fr' }],
      ['destructive not boolean', { ...good, destructive: 'yes' }],
    ];
    for (const [name, payload] of cases) {
      const res = env.post(payload);
      assert.equal(res.ok, false, name);
      assert.equal(res.error, 'invalid', name);
    }
    assert.equal(env.requests.length, 0);
    // Whitespace inside the code (a wrapped copy) is fine; 120 characters with emoji are fine.
    const wrapped = { ...good, code: `${good.code.slice(0, 20)}\n  ${good.code.slice(20)}`, title: `⚠️ 🌳 ${'ع'.repeat(115)}` };
    assert.equal(env.post(wrapped).ok, true);
  });

  test('rate limits: 10 new issues per hour, 40 per day', async () => {
    const env = makeRelay();
    const fresh = async () => payloadOf(proposal([P.addChild('pahmed01', `ولد${Math.random()}`)]));
    for (let i = 0; i < 10; i++) assert.equal(env.post(await fresh()).ok, true, `#${i + 1}`);
    assert.deepEqual(env.post(await fresh()), { ok: false, error: 'rate_limited' });
    env.clock += HOUR + MIN;
    for (let i = 0; i < 10; i++) assert.equal(env.post(await fresh()).ok, true);
    env.clock += HOUR + MIN;
    for (let i = 0; i < 10; i++) assert.equal(env.post(await fresh()).ok, true);
    env.clock += HOUR + MIN;
    for (let i = 0; i < 10; i++) assert.equal(env.post(await fresh()).ok, true);
    env.clock += HOUR + MIN; // the hour is clear again, but 40 were opened today
    assert.deepEqual(env.post(await fresh()), { ok: false, error: 'rate_limited' });
    assert.equal(env.gh.state.issues.size, 40);
    env.clock += 21 * HOUR; // the first ones are more than 24 hours old now
    assert.equal(env.post(await fresh()).ok, true);
  });

  test('duplicates within 24 hours return the request already opened', async () => {
    const env = makeRelay();
    const p = proposal([P.addChild('pahmed01')]);
    const payload = await payloadOf(p);
    const first = env.post(payload);
    assert.equal(first.issue, 1);
    assert.deepEqual(env.post(payload), { ok: true, issue: 1, url: first.url, duplicate: true });
    // Same proposal id, different code (e.g. a second tap after an edit) → the same request.
    const p2 = { ...p, note: 'changed' };
    assert.equal(env.post(await payloadOf(p2)).issue, 1);
    // Same code under another proposal id → the same request.
    assert.equal(env.post({ ...payload, proposalId: 'zzzz000001' }).issue, 1);
    assert.equal(env.gh.state.issues.size, 1);
    assert.equal(env.threads.size, 1, 'one e-mail');
    env.clock += 25 * HOUR;
    assert.equal(env.post(payload).issue, 2, 'after 24 hours it is a new request');
  });

  test('GitHub failure → github_error (no secret in the answer or the logs), nothing mailed', async () => {
    const env = makeRelay();
    env.failGitHub = true;
    const res = env.post(await payloadOf(proposal([P.addChild('pahmed01')])));
    assert.deepEqual(res, { ok: false, error: 'github_error' });
    assert.equal(env.threads.size, 0);
    assert.ok(env.logs.some((l) => /HTTP 500/.test(l)));
    assert.ok(!env.everything().includes(TOKEN) && !JSON.stringify(res).includes(TOKEN));
  });

  test('not configured → not_configured, nothing sent', async () => {
    const env = makeRelay({ props: { GITHUB_TOKEN: '' } });
    assert.deepEqual(env.post(await payloadOf(proposal([P.addChild('pahmed01')]))), { ok: false, error: 'not_configured' });
    assert.equal(env.requests.length, 0);
  });
});

describe('relay: the owner answers by e-mail', () => {
  test('«موافق» → "/approve <fp>" as the owner → the real apply workflow → "✅ Applied" e-mail in the same thread', async () => {
    const { gh, ctx } = automation();
    const env = makeRelay({ gh });
    const n = await proposed(env, ctx, proposal([P.addChild('pahmed01', 'يوسف')]));
    env.clock += 2 * MIN;
    env.answer(n, 'موافق');
    env.run();
    const fp = fpOf(gh, n);
    assert.equal(lastRelayComment(env), `/approve ${fp}`);
    assert.equal(env.posted.at(-1).comment.user.login, KEEPER);
    const cmd = parseCommand(lastRelayComment(env));
    assert.equal(cmd.cmd, 'approve');
    assert.equal(cmd.fp, fp);
    assert.equal(env.record(n).status, 'posted');

    await workflowRuns(env, ctx);
    assert.ok(gh.labelsOf(n).includes('applied'));
    assert.equal(gh.state.issues.get(n).state, 'closed');
    const before = env.messages(n).length;
    env.clock += 5 * MIN;
    env.run();
    const mails = env.messages(n);
    assert.equal(mails.length, before + 1);
    const done = mails.at(-1);
    assert.equal(done._to, OWNER, 'a reply to the owner');
    assert.match(done._subject, /^Re: 🌳 \[GFT #1\]/);
    assert.ok(done._body.startsWith('✅ طُبّقت التعديلات على شجرة العائلة — الطلب رقم 1\n✅ Applied to the family tree — request #1'));
    assert.match(done._body, /https:\/\/fam\.github\.io\/tree\/#\/p\/p[0-9a-z]{7}\?rev=6/, 'person link');
    assert.ok(done._body.includes('https://wa.me/?text='), '"tell them on WhatsApp" link');
    assert.ok(done._body.includes('https://github.com/fam/tree/issues/1'));
    assert.ok(!/<!--|gft-bot|<div|\*\*|\]\(/.test(done._body), 'plain text, no markers or Markdown');
    assert.equal(done._body.trim().split('\n').at(-1), 'gft-relay:1');
    assert.equal(env.record(n).status, 'done');

    // Nothing more happens afterwards (also the relay never answers its own notices).
    env.clock += 5 * MIN;
    env.run();
    env.run();
    assert.equal(env.messages(n).length, before + 1);
    assert.equal(env.posted.length, 0);
    assert.ok(!env.everything().includes(TOKEN));
  });

  test('«موافق حذف» on a removal → "/approve-deletion <fp>"', async () => {
    const { gh, ctx } = automation();
    const env = makeRelay({ gh });
    const n = await proposed(env, ctx, proposal([P.remove('pkid0001')]));
    env.answer(n, 'موافق حذف');
    env.run();
    assert.equal(lastRelayComment(env), `/approve-deletion ${fpOf(gh, n)}`);
    assert.equal(parseCommand(lastRelayComment(env)).cmd, 'approve-deletion');
    await workflowRuns(env, ctx);
    env.run();
    assert.ok(env.lastMessage(n)._body.includes('✅ Applied'));
    assert.equal(env.record(n).status, 'done');
  });

  test('plain «موافق» on a removal → explanation in the thread, nothing posted; then «موافق حذف» works', async () => {
    const { gh, ctx } = automation();
    const env = makeRelay({ gh });
    const n = await proposed(env, ctx, proposal([P.remove('pkid0001')]));
    env.answer(n, 'موافق');
    env.run();
    assert.equal(env.posted.length, 0);
    const note = env.lastMessage(n);
    assert.ok(note._body.includes('«موافق حذف»') && note._body.includes('"approve deletion"'));
    assert.ok(note._body.includes('nothing was done yet'));
    assert.equal(env.record(n).status, 'pending');
    env.run(); // the same answer is not handled twice
    assert.equal(env.messages(n).length, 3);
    env.answer(n, 'Approve deletion');
    env.run();
    assert.equal(lastRelayComment(env), `/approve-deletion ${fpOf(gh, n)}`);
  });

  test('«رفض» → "/reject" → the bot declines and closes → short confirmation', async () => {
    const { gh, ctx } = automation();
    const env = makeRelay({ gh });
    const n = await proposed(env, ctx, proposal([P.addChild('pahmed01')]));
    env.answer(n, '  رفض.');
    env.run();
    assert.equal(lastRelayComment(env), '/reject');
    await workflowRuns(env, ctx);
    assert.equal(gh.state.issues.get(n).state, 'closed');
    env.run();
    assert.ok(env.lastMessage(n)._body.includes('Request #1 was declined politely and closed.'));
    assert.equal(env.record(n).status, 'done');
  });

  test('"approve skip 3 5" (and Arabic digits «موافق تخطي ٣ و٥») → "/approve <fp> skip 3,5"', async () => {
    const { gh, ctx } = automation();
    const env = makeRelay({ gh });
    const ops = ['أ', 'ب', 'ج', 'د', 'ه'].map((name, i) => P.addChild('pahmed01', `ولد${name}`, `new${i + 1}`));
    const n = await proposed(env, ctx, proposal(ops));
    env.answer(n, 'approve skip 3 5');
    env.run();
    const fp = fpOf(gh, n);
    assert.equal(lastRelayComment(env), `/approve ${fp} skip 3,5`);
    assert.deepEqual(parseCommand(lastRelayComment(env)).skipShown, [3, 5]);

    const n2 = await proposed(env, ctx, proposal(ops.map((o) => ({ ...o, person: { ...o.person, name: { ar: `${o.person.name.ar}2` } } }))));
    env.answer(n2, '‏موافق تخطي ٣ و٥');
    env.run();
    assert.equal(lastRelayComment(env), `/approve ${fpOf(gh, n2)} skip 3,5`);
  });

  test('quoted text is ignored: only the first line the owner wrote counts', async () => {
    const { gh, ctx } = automation();
    const env = makeRelay({ gh });
    const n = await proposed(env, ctx, proposal([P.addChild('pahmed01')]));
    // An empty reply quoting the instructions (which contain «موافق») is not an approval.
    env.answer(n, '');
    env.run();
    assert.equal(env.posted.length, 0);
    assert.ok(env.lastMessage(n)._body.includes('The reply was not understood.'));
    // "رفض" written above a quote that says «موافق» → reject.
    env.answer(n, 'رفض');
    env.run();
    assert.equal(lastRelayComment(env), '/reject');
  });

  test('a reply from anyone else, or one not in the owner’s Sent mail, is never acted on', async () => {
    const { gh, ctx } = automation();
    const env = makeRelay({ gh });
    const n = await proposed(env, ctx, proposal([P.addChild('pahmed01')]));
    env.answer(n, 'موافق', { from: 'cousin@example.com' });
    env.run();
    assert.equal(env.posted.length, 0);
    assert.equal(env.messages(n).length, 2, 'no answer to strangers either');
    // Forged "From: owner" that is not in the account's Sent mail: waited for, then ignored with a notice.
    env.answer(n, 'موافق', { from: OWNER, sent: false });
    for (let i = 0; i < 6; i++) env.run();
    assert.equal(env.posted.length, 0);
    assert.ok(env.lastMessage(n)._body.includes('could not be confirmed as sent from this account'));
    // Failed DMARC is never trusted either.
    env.answer(n, 'موافق', { headers: { 'Authentication-Results': 'mx.google.com; dmarc=fail (p=NONE) header.from=gmail.com' } });
    env.run();
    assert.equal(env.posted.length, 0);
    // The real owner still can.
    env.answer(n, 'نعم');
    env.run();
    assert.equal(lastRelayComment(env), `/approve ${fpOf(gh, n)}`);
  });

  test('no check comment yet → the answer waits for the next run', async () => {
    const { gh, ctx } = automation();
    const env = makeRelay({ gh });
    const n = await proposed(env, null, proposal([P.addChild('pahmed01')]));
    env.answer(n, 'موافق');
    env.run();
    env.run();
    assert.equal(env.posted.length, 0);
    assert.equal(env.messages(n).length, 2, 'no e-mail while waiting');
    await checkIssue(ctx, n);
    env.run();
    assert.equal(lastRelayComment(env), `/approve ${fpOf(gh, n)}`);
  });

  test('a problem from the bot is forwarded and the owner can answer again in the same thread', async () => {
    const { gh, ctx } = automation();
    const env = makeRelay({ gh });
    // Change 2 fails when applied: it edits a person with a stale "before" value (STALE_EDIT in final mode).
    const p = proposal([P.addChild('pahmed01', 'يوسف'), P.edit('pkid0001', { 'name.ar': 'خلود' }, { 'name.ar': 'خالد٢' })]);
    const n = await proposed(env, ctx, p);
    env.answer(n, 'ok');
    env.run();
    await workflowRuns(env, ctx);
    assert.ok(gh.labelsOf(n).includes('needs-changes'));
    env.run();
    const fwd = env.lastMessage(n)._body;
    assert.ok(fwd.startsWith('ℹ️ ردّ روبوت الشجرة على الطلب رقم 1:'));
    assert.ok(fwd.includes('The proposal could not be applied'));
    assert.ok(fwd.includes(`/approve ${fpOf(gh, n)} skip 2`), 'the bot’s own hint');
    assert.ok(fwd.includes('«موافق تخطي 3»'));
    assert.ok(!/<!--|gft-bot/.test(fwd));
    assert.equal(env.record(n).status, 'pending');
    env.answer(n, `/approve ${fpOf(gh, n)} skip 2`); // pasted from the forwarded message
    env.run();
    assert.equal(lastRelayComment(env), `/approve ${fpOf(gh, n)} skip 2`);
    await workflowRuns(env, ctx);
    env.run();
    assert.ok(env.lastMessage(n)._body.includes('✅ Applied'));
    assert.ok(env.lastMessage(n)._body.includes('Skipped changes: 2'));
    assert.equal(env.record(n).status, 'done');
  });

  test('replies that are not understood get the instructions (a limited number of times)', async () => {
    const { ctx, gh } = automation();
    const env = makeRelay({ gh });
    const n = await proposed(env, ctx, proposal([P.addChild('pahmed01')]));
    for (const text of ['شكراً', 'approve 3', 'not approved', 'موافق تخطي', 'موافق ورفض', 'hello', 'more']) {
      env.answer(n, text);
      env.run();
    }
    assert.equal(env.posted.length, 0);
    const hints = env.messages(n).filter((m) => /^gft-relay:1$/m.test(m._body) && m._body.includes('The reply was not understood.'));
    assert.equal(hints.length, 5);
    assert.ok(hints[0]._body.includes('«موافق»، «موافق حذف»، «رفض»'));
  });

  test('no answer from the GitHub bot after 20 minutes → the owner is told once', async () => {
    const { gh, ctx } = automation();
    const env = makeRelay({ gh });
    const n = await proposed(env, ctx, proposal([P.addChild('pahmed01')]));
    env.answer(n, 'موافق');
    env.run();
    assert.equal(env.record(n).status, 'posted');
    const count = env.messages(n).length;
    env.clock += 10 * MIN;
    env.run();
    assert.equal(env.messages(n).length, count, 'not yet');
    env.clock += 11 * MIN;
    env.run();
    env.clock += 30 * MIN;
    env.run();
    assert.equal(env.messages(n).length, count + 1, 'exactly one notice');
    assert.ok(env.lastMessage(n)._body.includes('has not answered yet'));
    await workflowRuns(env, ctx); // the bot answers late: the result still arrives
    env.run();
    assert.ok(env.lastMessage(n)._body.includes('✅ Applied'));
    assert.equal(env.record(n).status, 'done');
  });

  test('a request closed on GitHub directly is dropped quietly; a late answer is told it is closed', async () => {
    const { gh, ctx } = automation();
    const env = makeRelay({ gh });
    const n = await proposed(env, ctx, proposal([P.addChild('pahmed01')]));
    gh.userClose(n);
    env.answer(n, 'موافق');
    env.run();
    assert.equal(env.posted.length, 0);
    assert.ok(env.lastMessage(n)._body.includes('already closed on GitHub'));
    env.clock += 31 * MIN;
    env.run();
    assert.equal(env.record(n).status, 'done');
  });
});

describe('relay: reply parsing', () => {
  const env = makeRelay();
  const parse = (line) => JSON.parse(JSON.stringify(env.ctx.parseReply_(line)));
  const first = (body) => env.ctx.firstReplyLine_(body);

  test('words in both languages', () => {
    for (const w of ['موافق', 'موافقة', 'مُوافِق', 'نعم', 'اعتماد', 'أوافق', 'لا مانع', 'Approve', 'APPROVED!', 'yes', 'ok', '«موافق»', 'نعم موافق']) {
      assert.deepEqual(parse(w), { verb: 'approve', skip: [], force: false }, w);
    }
    for (const w of ['موافق حذف', 'موافق على الحذف', 'approve deletion', 'approve-deletion', '/approve-deletion', 'موافقة-حذف']) {
      assert.deepEqual(parse(w), { verb: 'approve-deletion', skip: [], force: false }, w);
    }
    for (const w of ['رفض', 'مرفوض', 'reject', 'Rejected.', 'no', 'لا', 'رفض الحذف']) assert.deepEqual(parse(w), { verb: 'reject', skip: [], force: false }, w);
    assert.deepEqual(parse('approve skip 3 5'), { verb: 'approve', skip: [3, 5], force: false });
    assert.deepEqual(parse('موافق تخطي ٣، ٥'), { verb: 'approve', skip: [3, 5], force: false });
    assert.deepEqual(parse('موافق تخطى 2-4 و7'), { verb: 'approve', skip: [2, 3, 4, 7], force: false });
    assert.deepEqual(parse('موافق حذف تخطي 1'), { verb: 'approve-deletion', skip: [1], force: false });
    assert.deepEqual(parse('approve except 5,3,3'), { verb: 'approve', skip: [3, 5], force: false });
    assert.deepEqual(parse('موافق فرض'), { verb: 'approve', skip: [], force: true });
    // A command copied from a forwarded bot message: the fingerprint is dropped (the current one is used).
    assert.deepEqual(parse('/approve 0ae7dcdfc9764382 skip 2'), { verb: 'approve', skip: [2], force: false });
    assert.deepEqual(parse('/approve-deletion 0ae7dcdfc9764382 force'), { verb: 'approve-deletion', skip: [], force: true });
  });

  test('anything unclear is not a command', () => {
    for (const w of ['', 'شكراً', 'حذف', 'approve 3', 'موافق تخطي', 'approve skip 0', 'موافق ورفض', 'approve reject', 'not approved', 'لا أوافق', 'no problem, approve', 'I will think about whether to approve']) {
      assert.equal(env.ctx.parseReply_(w), null, w);
    }
  });

  test('first line: quotes, "On … wrote:" headers, signatures and invisible marks', () => {
    assert.equal(first('\n\n‏موافق‏\n\nOn Wed wrote:\n> رفض'), 'موافق');
    assert.equal(first('> «موافق»\n> approve'), '');
    assert.equal(first('On Wed, 25 Nov 2026 at 10:05, Keeper <keeper@gmail.com> wrote:\n> موافق'), '');
    assert.equal(first('في الأربعاء، ٢٥ نوفمبر ٢٠٢٦ ١٠:٠٥ ص، Keeper كتب:\n> موافق'), '');
    assert.equal(first('--\nSent from my iPhone'), '');
    assert.equal(first('Sent from my iPhone'), '');
    assert.equal(first('-----Original Message-----\nموافق'), '');
  });
});

describe('relay: setup and housekeeping', () => {
  test('setup(): checks the settings and GitHub, installs ONE 5-minute trigger, sends a test e-mail', () => {
    const env = makeRelay();
    assert.equal(env.ctx.setup(), 'ok');
    assert.equal(env.ctx.setup(), 'ok');
    assert.equal(env.triggers.length, 1);
    assert.equal(env.triggers[0].getHandlerFunction(), 'checkReplies');
    assert.equal(env.triggers[0].minutes, 5);
    assert.ok(env.requests.some((r) => r.method === 'GET' && r.url === 'https://api.github.com/repos/fam/tree'));
    assert.equal(env.plainMails.length, 2);
    assert.equal(env.plainMails[0].to, OWNER);
    assert.match(env.plainMails[0].subject, /relay is ready/);
    assert.equal(env.ctx.stopRelay(), 'stopped');
    assert.equal(env.triggers.length, 0);
    assert.ok(!env.everything().includes(TOKEN));
  });

  test('setup(): clear errors without secrets', () => {
    const missing = makeRelay({ props: { GITHUB_TOKEN: '', REPO: 'nope', SITE_URL: 'http://x' } });
    assert.throws(() => missing.ctx.setup(), /GITHUB_TOKEN is missing; REPO must look like owner\/name.*SITE_URL must start with https/);
    const denied = makeRelay({ props: { GITHUB_TOKEN: 'github_pat_WRONG' } });
    assert.throws(() => denied.ctx.setup(), (e) => /HTTP 401/.test(e.message) && !e.message.includes('WRONG'));
    assert.equal(denied.triggers.length, 0);
  });

  test('OWNER_EMAIL elsewhere: mails go there and only its replies count', async () => {
    const { gh, ctx } = automation();
    const env = makeRelay({ gh, me: 'script.account@gmail.com', props: { OWNER_EMAIL: OWNER } });
    const n = await proposed(env, ctx, proposal([P.addChild('pahmed01')]));
    assert.equal(env.lastMessage(n)._to, OWNER);
    env.answer(n, 'موافق', { from: 'script.account@gmail.com', sent: true });
    env.run();
    assert.equal(env.posted.length, 0, 'the script account is not the owner');
    env.answer(n, 'موافق', { from: OWNER, sent: false });
    env.run();
    assert.equal(lastRelayComment(env), `/approve ${fpOf(gh, n)}`);
  });

  test('finished requests and old duplicate entries are forgotten', async () => {
    const { gh, ctx } = automation();
    const env = makeRelay({ gh });
    const n = await proposed(env, ctx, proposal([P.addChild('pahmed01')]));
    env.answer(n, 'رفض');
    env.run();
    await workflowRuns(env, ctx);
    env.run();
    assert.equal(env.record(n).status, 'done');
    assert.ok([...env.store.keys()].some((k) => k.startsWith('gft:dedupe:')));
    env.clock += 31 * 24 * HOUR;
    env.run();
    assert.equal(env.record(n), null);
    assert.ok(![...env.store.keys()].some((k) => k.startsWith('gft:dedupe:')));
    assert.equal(env.store.get('GITHUB_TOKEN'), TOKEN, 'settings untouched');
  });
});

describe('relay: the site payload stays within the relay limits', () => {
  test('30 lines at most (15 per language, numbered from 1), clipped fields', async () => {
    const ops = Array.from({ length: 40 }, (_, i) => P.addChild('pahmed01', `ولد${i}`, `new${i + 1}`));
    const p = proposal(ops, { submitter: { name: 'س'.repeat(100), relation: 'ق'.repeat(300), personId: '' }, note: 'n'.repeat(2000) });
    const payload = await payloadOf(p);
    assert.equal(payload.summary.length, 30);
    assert.match(payload.summary[0], /^1\. إضافة/);
    assert.match(payload.summary[13], /^14\. /);
    assert.equal(payload.summary[14], '…و26 تعديلاً آخر');
    assert.match(payload.summary[15], /^1\. Add/);
    assert.equal(payload.summary[29], '…and 26 more');
    assert.equal([...payload.submitter].length, 200);
    const env = makeRelay();
    const res = env.post(payload);
    assert.equal(res.ok, true, JSON.stringify(res));
    const body = env.lastMessage(1)._body;
    assert.ok(body.indexOf('14. ') < body.indexOf('…و26 تعديلاً آخر'));
    assert.ok(body.indexOf('Changes (as described') < body.indexOf('1. Add'));
    assert.equal(payload.code, await encodeProposal(p));
  });
});
