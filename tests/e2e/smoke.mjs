#!/usr/bin/env node
// End-to-end smoke test for the Grand Family Tree site (local only — NOT part of `node --test`).
//
//   cd family-tree && node tests/e2e/smoke.mjs [--routes-only | --flows-only] [--shots=<dir>] [--quick]
//
// * Serves this folder with a tiny node:http static server on port 8199 (no python needed).
// * Visits every route in Arabic and English, at 360×740 and 1280×800, light and dark; fails on any console error,
//   page error, failed request (Google Fonts are stubbed so the test works offline), missing i18n string,
//   or horizontal overflow at 360px. Saves a screenshot of every route/viewport.
// * Checks the string registry: every key in both languages; no Arabic string starts with a masculine imperative.
// * Runs the main flows end to end: wizard → draft → WhatsApp code that applies in FINAL mode; person-page dialogs;
//   send via "copy code" → #/me → simulated approval (new family.json + changelog + applied ledger) → toast;
//   admin paste → preview → approve-issue URL; home family trees (options, popover, keyboard, viewer, no overlaps);
//   owner mode (api.github.com routed to tests/fake-github-api.mjs): sign in, a child added from the person page is
//   committed at once and shown without a proposal, "Apply now" on a preview; signed out → the proposal flow again;
//   home-page settings (hide a family tree and a «يلتقي» line → one commit of config.json only; a visitor loading that
//   config does not see them; the #/admin "Home page" card) and «إخفاء الكنية» from the edit form.
// Needs Playwright with Chromium (`require('playwright')` must resolve, e.g. via NODE_PATH or a global install).
// --flow=<text> runs only the flows whose name contains <text> (with the i18n check and route sweep unless --flows-only).
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodeProposal, decodeProposal } from '../../js/core/codec.js';
import { applyProposal, newProposal, proposalHash } from '../../js/core/ops.js';
import { normalizeData, serializeData, validateData } from '../../js/core/schema.js';
import { buildGraph } from '../../js/core/graph.js';
import { describeProposal } from '../../js/core/describe.js';
import { lineageName, displayName, autoKunya, personName } from '../../js/core/names.js';
import { createFakeGitHub, FAKE_TOKEN } from '../fake-github-api.mjs';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Install it (npm i -g playwright && npx playwright install chromium) or set NODE_PATH.');
  process.exit(2);
}

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.GFT_E2E_PORT || 8199);
const ARGS = process.argv.slice(2);
const argVal = (name) => (ARGS.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
const SHOTS = path.resolve(argVal('shots') || process.env.GFT_E2E_SHOTS || path.join(os.tmpdir(), 'gft-e2e'));
const ROUTES_ONLY = ARGS.includes('--routes-only');
const FLOWS_ONLY = ARGS.includes('--flows-only');
const QUICK = ARGS.includes('--quick'); // light theme only for the route sweep
const ONLY_FLOW = argVal('flow');
fs.mkdirSync(SHOTS, { recursive: true });

// ---------------------------------------------------------------------------------------------------------------
// Static server (root can be switched to a temp copy of the site for the approval simulation; same origin keeps
// localStorage).
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
const server = { root: SITE };
const httpServer = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(server.root, `.${rel}`);
    if (!file.startsWith(server.root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});
const BASE = `http://localhost:${PORT}/`;

// ---------------------------------------------------------------------------------------------------------------
// Test data
const FAMILY = JSON.parse(fs.readFileSync(path.join(SITE, 'data', 'family.json'), 'utf8'));
const DATA = normalizeData(FAMILY);
const G = buildGraph(DATA);
const ROOT = DATA.meta.rootPersonId;
const people = G.people();
const childOfSomeone = (p) => !!G.birthUnion(p.id);
const UNKNOWN_NAME = people.find((p) => p.nameStatus !== 'known')?.id;
const LIVING = people.find((p) => !p.deceased && childOfSomeone(p) && G.children(p.id).length > 0)?.id;
const MARRIED_IN_WIFE = people.find((p) => p.gender === 'f' && !childOfSomeone(p) && G.spouses(p.id).length && G.children(p.id).length)?.id;
const DEEP = people.map((p) => [p.id, G.ancestors(p.id).size]).sort((a, b) => b[1] - a[1])[0]?.[0];
const LEAF = people.find((p) => !p.deceased && childOfSomeone(p) && !G.children(p.id).length && G.father(p.id))?.id;
for (const [k, v] of Object.entries({ ROOT, UNKNOWN_NAME, LIVING, MARRIED_IN_WIFE, DEEP, LEAF })) {
  if (!v) throw new Error(`could not pick a test person for ${k}`);
}

async function sampleCode() {
  const p = newProposal();
  p.submitter = { name: 'Smoke test', relation: 'cousin', personId: '' };
  p.ops = [
    { op: 'add-person', ref: 'new1', person: { name: { ar: 'يوسف' }, gender: 'm', birth: { date: '2015' } }, link: { as: 'child', of: LIVING, with: null }, unionRef: 'newu2' },
    { op: 'mark', id: ROOT, mark: 'verified' },
  ];
  return { code: await encodeProposal(p), proposal: p };
}

// ---------------------------------------------------------------------------------------------------------------
// Failure bookkeeping
const failures = [];
let checks = 0;
function fail(where, msg) {
  failures.push(`${where}: ${msg}`);
  console.log(`  ✗ ${where}: ${msg}`);
}
function check(cond, where, msg) {
  checks++;
  if (!cond) fail(where, msg);
  return !!cond;
}

const IGNORED_HOSTS = /(^|\.)(fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

/** New context with language/theme preset, external calls stubbed, and error collectors attached. */
async function newContext(browser, { lang = 'ar', theme = 'light', width = 360, height = 740, storage = null } = {}) {
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 1, colorScheme: theme, locale: lang === 'ar' ? 'ar-SA' : 'en-GB',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await context.addInitScript(({ lang, theme, storage }) => {
    try {
      if (!sessionStorage.getItem('gft.e2e.init')) {
        sessionStorage.setItem('gft.e2e.init', '1');
        if (storage) for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
      }
      localStorage.setItem('gft.lang', lang);
      localStorage.setItem('gft.theme', theme);
    } catch { /* ignore */ }
  }, { lang, theme, storage });
  // Fonts: stub (works offline, deterministic). GitHub REST: no network in tests.
  await context.route((url) => IGNORED_HOSTS.test(url.hostname), (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route((url) => url.hostname === 'api.github.com', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  return context;
}

/** Attach collectors; returns an array that receives problem strings. */
function watch(page) {
  const problems = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') problems.push(`console error: ${text}`);
    else if (msg.type() === 'warning' && /\[i18n\] missing/.test(text)) problems.push(`i18n: ${text}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  page.on('requestfailed', (req) => {
    const u = new URL(req.url());
    if (IGNORED_HOSTS.test(u.hostname)) return;
    problems.push(`request failed: ${req.url()} (${req.failure()?.errorText})`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) problems.push(`HTTP ${res.status()}: ${res.url()}`);
  });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  return problems;
}

let navSeq = 0;
/** Full page load of a hash route (cache-busting query forces a real reload, so init scripts run). */
async function load(page, hash) {
  await page.goto(`${BASE}?v=${++navSeq}${hash}`, { waitUntil: 'load' });
  await page.waitForSelector('#app section.view, #app .error-state, #app .empty-state', { timeout: 15000 });
  await settle(page);
}
async function settle(page, ms = 150) {
  try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch { /* keep going */ }
  await page.waitForTimeout(ms);
}
/** In-app navigation by hash (no reload). */
async function go(page, hash) {
  await page.evaluate((hsh) => { location.hash = hsh; }, hash);
  await page.waitForFunction((hsh) => location.hash === hsh, hash);
  await settle(page);
}

async function overflowAt(page) {
  return page.evaluate(() => {
    const se = document.scrollingElement;
    if (se.scrollWidth <= innerWidth + 1) return null;
    // Find the widest offenders to make the report useful.
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > innerWidth + 1 || r.left < -1)) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed') continue;
        out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${[...el.classList].join('.')} [${Math.round(r.left)}..${Math.round(r.right)}]`);
      }
      if (out.length > 6) break;
    }
    return `scrollWidth ${se.scrollWidth} > ${innerWidth}: ${out.join(' | ')}`;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Route sweep
async function routeSweep(browser) {
  const { code } = await sampleCode();
  const routes = [
    ['home', '#/'],
    ['tree', '#/tree'],
    ['tree-chart', `#/tree/${ROOT}?view=chart`],
    ['tree-list', `#/tree/${ROOT}?view=list`],
    ['tree-up', `#/tree/${DEEP}?dir=up`],
    ['p-root', `#/p/${ROOT}`],
    ['p-unknown', `#/p/${UNKNOWN_NAME}`],
    ['p-living', `#/p/${LIVING}`],
    ['p-wife', `#/p/${MARRIED_IN_WIFE}`],
    ['search-ar', `#/search?q=${encodeURIComponent('محمد')}`],
    ['search-en', '#/search?q=Muhammad'],
    ['add-family', '#/add-family'],
    ['draft', '#/draft'],
    ['me', '#/me'],
    ['relationship', `#/relationship/${LEAF}/${MARRIED_IN_WIFE}`],
    ['changes', '#/changes'],
    ['about', '#/about'],
    ['admin', '#/admin'],
    ['preview', `#/preview?code=${encodeURIComponent(code)}`],
  ];
  const combos = [];
  for (const lang of ['ar', 'en']) {
    for (const [width, height] of [[360, 740], [1280, 800]]) {
      for (const theme of QUICK ? ['light'] : ['light', 'dark']) combos.push({ lang, width, height, theme });
    }
    // Largest text size (A++) on a phone: the most likely place for overflow.
    combos.push({ lang, width: 360, height: 740, theme: 'light', textSize: 'xl' });
  }
  for (const combo of combos) {
    const tag = `${combo.lang}-${combo.width}-${combo.theme}${combo.textSize ? `-${combo.textSize}` : ''}`;
    console.log(`• routes ${tag}`);
    const storage = { 'gft.me': JSON.stringify(LEAF), ...(combo.textSize ? { 'gft.textSize': combo.textSize } : {}) };
    const context = await newContext(browser, { ...combo, storage });
    const page = await context.newPage();
    const problems = watch(page);
    for (const [name, hash] of routes) {
      problems.length = 0;
      const where = `${tag} ${name}`;
      try {
        await load(page, hash);
      } catch (e) {
        fail(where, `did not render: ${e.message.split('\n')[0]}`);
        continue;
      }
      const state = await page.evaluate(() => ({
        error: !!document.querySelector('#app .error-state'),
        notFound: !!document.querySelector('#app h1') && /not found|غير موجود/i.test(document.querySelector('#app h1')?.textContent || ''),
        lang: document.documentElement.lang,
        dir: document.documentElement.dir,
        theme: document.documentElement.dataset.theme,
        me: globalThis.__gft?.me || null,
        title: document.title,
        textLen: (document.querySelector('#app')?.innerText || '').trim().length,
        rawKeys: [...(document.querySelector('#app')?.innerText || '').matchAll(/\b[a-z]+\.[a-zA-Z]+(?:\.[a-zA-Z0-9]+)+\b/g)].map((m) => m[0]).filter((s) => !/^(gtsgate|github|wa|api)\./.test(s) && !/\.(com|io|me|json|js|html|jpg|png)$/.test(s)),
      }));
      check(!state.error, where, 'error state rendered');
      check(!state.notFound, where, 'not-found rendered');
      check(state.lang === combo.lang && state.dir === (combo.lang === 'ar' ? 'rtl' : 'ltr'), where, `html lang/dir is ${state.lang}/${state.dir}`);
      check(state.theme === combo.theme, where, `theme is ${state.theme}`);
      check(state.me === LEAF, where, `"me" is ${state.me}, expected ${LEAF}`);
      check(state.textLen > 20, where, 'page looks empty');
      check(!state.rawKeys.length, where, `raw i18n keys visible: ${state.rawKeys.slice(0, 5).join(', ')}`);
      if (combo.width === 360) {
        const over = await overflowAt(page);
        check(!over, where, `horizontal overflow — ${over}`);
      }
      for (const p of problems) fail(where, p);
      await page.screenshot({ path: path.join(SHOTS, `route-${tag}-${name}.png`), fullPage: combo.width === 360 });
    }
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 2. i18n registry
const IMPERATIVES = ['أضف', 'اختر', 'أرسل', 'اكتب', 'ابحث', 'اضغط', 'تعرّف', 'تعرف', 'ادخل', 'أدخل'];
async function i18nCheck(browser) {
  console.log('• i18n registry');
  const context = await newContext(browser, { lang: 'ar' });
  const page = await context.newPage();
  const problems = watch(page);
  await load(page, '#/about');
  const result = await page.evaluate(async () => {
    const mods = ['home', 'tree', 'person', 'search', 'wizard', 'draft', 'me', 'relationship', 'changes', 'about', 'admin', 'preview']
      .map((m) => `./js/views/${m}.js`).concat(['./js/forms/dialogs.js', './js/forms/person-form.js', './js/forms/picker.js', './js/ui.js', './js/submit.js', './js/owner-ui.js', './js/app.js']);
    for (const m of mods) await import(new URL(m, location.href).href);
    const i18n = await import(new URL('./js/i18n.js', location.href).href);
    const d = i18n.dictionaries();
    const vars = new Proxy({}, { get: (_, k) => (k === 'n' || k === 'count' || k === 'total' ? 3 : typeof k === 'string' ? 'X' : undefined), has: () => true });
    const sample = (v) => {
      if (typeof v !== 'function') return String(v);
      const outs = [];
      for (const n of [0, 1, 2, 3, 11]) {
        try { outs.push(String(v(new Proxy({}, { get: (_, k) => (k === 'n' || k === 'count' || k === 'total' ? n : typeof k === 'string' ? 'X' : undefined), has: () => true })))); } catch { /* ignore */ }
      }
      try { outs.push(String(v(vars))); } catch { /* ignore */ }
      return outs.join('\n');
    };
    const arKeys = Object.keys(d.ar);
    const enKeys = Object.keys(d.en);
    return {
      total: new Set([...arKeys, ...enKeys]).size,
      missingAr: enKeys.filter((k) => !(k in d.ar)),
      missingEn: arKeys.filter((k) => !(k in d.en)),
      emptyAr: arKeys.filter((k) => typeof d.ar[k] === 'string' && !d.ar[k].trim()),
      emptyEn: enKeys.filter((k) => typeof d.en[k] === 'string' && !d.en[k].trim()),
      ar: Object.fromEntries(arKeys.map((k) => [k, sample(d.ar[k])])),
    };
  });
  console.log(`  ${result.total} keys`);
  check(result.total > 300, 'i18n', `only ${result.total} keys registered`);
  check(!result.missingAr.length, 'i18n', `missing Arabic: ${result.missingAr.join(', ')}`);
  check(!result.missingEn.length, 'i18n', `missing English: ${result.missingEn.join(', ')}`);
  check(!result.emptyAr.length && !result.emptyEn.length, 'i18n', `empty strings: ${[...result.emptyAr, ...result.emptyEn].join(', ')}`);
  const bad = [];
  for (const [k, v] of Object.entries(result.ar)) {
    for (const line of v.split('\n')) {
      const first = line.trim().replace(/^[\s«"“(\[•·\-–—:!؟?.،]+/, '').split(/[\s،,.:!؟?»”)]+/)[0] || '';
      // Drop tatweel and harakat except shadda (تعرّف) and damma: "أُرسل" (passive, "was sent") is fine; "أرسل"/"أَرسِل" is not.
      const plain = first.replace(/\u0640/g, '').replace(/[\u064B-\u0652]/g, (m) => (m === '\u0651' || m === '\u064F' ? m : ''));
      if (IMPERATIVES.includes(plain) || IMPERATIVES.includes(plain.replace(/\u0651/g, ''))) bad.push(`${k}: ${line.slice(0, 40)}`);
    }
  }
  check(!bad.length, 'i18n', `Arabic strings starting with a masculine imperative: ${[...new Set(bad)].join(' | ')}`);
  for (const p of problems) fail('i18n', p);
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Flows
const FLOWS = [];
const flow = (name, fn) => FLOWS.push([name, fn]);

// A father in the tree with exactly one wife and children (wizard "I'm not listed" path), and a father whose
// children have no listed mother (person-page dialogs).
const WIZ_FATHER = people.find((p) => p.gender === 'm' && G.spouses(p.id).length === 1 && G.children(p.id).length >= 2 && G.father(p.id))?.id;
const DLG_PERSON = people.find((p) => p.gender === 'm' && p.id !== WIZ_FATHER && G.children(p.id).length >= 3 && G.father(p.id) && !p.deceased)?.id;
if (!WIZ_FATHER || !DLG_PERSON) throw new Error('could not pick flow test people');

const draftOps = (page) => page.evaluate(() => globalThis.__gft.draft.ops.map((o) => JSON.parse(JSON.stringify(o))));
const modalOpen = async (page) => { await page.waitForSelector('dialog.modal[open]', { timeout: 5000 }); await page.waitForTimeout(250); }; // let the sheet animation finish
const modalClosed = (page) => page.waitForFunction(() => !document.querySelector('dialog.modal[open]'), null, { timeout: 5000 });
async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, `flow-${name}.png`), fullPage: false });
}
function problemsOf(where, problems) { for (const p of problems) fail(where, p); problems.length = 0; }

/** Decode every GFT code inside a wa.me / GitHub URL and return the proposal. */
async function proposalFromUrl(href) {
  const u = new URL(href);
  const text = [...u.searchParams.values()].join('\n');
  return decodeProposal(text);
}

flow('wizard → draft → WhatsApp code applies in final mode (ar, 360px)', async (browser) => {
  const W = 'wizard';
  const context = await newContext(browser, { lang: 'ar', width: 360, height: 740 });
  const page = await context.newPage();
  const problems = watch(page);
  await load(page, '#/add-family');
  await page.locator('.wiz-tile').nth(1).click(); // "I am not listed yet"
  await page.fill('.picker-input', lineageName(G, WIZ_FATHER, 'ar'));
  await page.waitForSelector('.picker-option');
  await page.locator('.picker-option').first().click();
  await page.waitForSelector('.wiz-other-parent .chip');
  await page.locator('.wiz-other-parent .chip').first().click(); // his wife = my mother
  const self = page.locator('.wiz-step-who .wiz-row').first();
  await self.locator('.wiz-ar').fill('سلمان');
  check(/salman/i.test(await self.locator('.wiz-en').inputValue()), W, 'English name is not filled in automatically');
  await self.locator('.wiz-gender button[data-v="m"]').click();
  await self.locator('.wiz-year').fill('١٩٩٠'); // Arabic-Indic digits are accepted
  await shot(page, 'wizard-1-self');
  await page.locator('.wiz-step-who .wiz-next').click();
  await page.waitForSelector('.wiz-step-spouses');
  check((await draftOps(page)).length === 1, W, 'self was not added to the draft');
  const wife = page.locator('.wiz-step-spouses .wiz-row').last();
  await wife.locator('.wiz-ar').fill('نورة');
  if (await wife.locator('.wiz-gender button[data-v="f"]').count()) await wife.locator('.wiz-gender button[data-v="f"]').click();
  await page.locator('.wiz-step-spouses .wiz-next').click();
  await page.waitForSelector('.wiz-step-children');
  const kids = [['ريم', 'f', '2015'], ['فيصل', 'm', '2017'], ['لمى', 'f', '2020']];
  for (let i = 0; i < kids.length; i++) {
    const union = page.locator('.wiz-union').first();
    if (i > 0) { await union.locator('.wiz-another').click(); await page.waitForTimeout(150); }
    const row = page.locator('.wiz-union').first().locator('.wiz-row').last();
    await row.locator('.wiz-ar').fill(kids[i][0]);
    await row.locator(`.wiz-gender button[data-v="${kids[i][1]}"]`).click();
    await row.locator('.wiz-year').fill(kids[i][2]);
  }
  await shot(page, 'wizard-2-children');
  await page.locator('.wiz-step-children .wiz-footer .wiz-next').click();
  await page.waitForSelector('.wiz-step-review');
  const lines = await page.locator('.wiz-review-list li').allInnerTexts();
  check(lines.length === 5, W, `review lists ${lines.length} changes, expected 5`);
  check(lines.some((l) => l.includes('سلمان')) && lines.some((l) => l.includes('لمى')), W, 'review lines do not name the new people');
  check(await page.locator('.wiz-whatsapp').count() === 1, W, 'no "tell the owner on WhatsApp" link');
  await shot(page, 'wizard-3-review');
  await page.locator('.wiz-send').click();
  await page.waitForSelector('.view-draft .draft-changes .draft-ops');
  check((await page.locator('.draft-changes .draft-ops li').count()) === 5, W, 'draft page does not list the 5 changes');
  // Public-data acknowledgement unlocks the send links.
  await page.check('#draft-ack');
  await page.waitForFunction(() => /GFT[01]:/.test(decodeURIComponent(document.querySelector('.draft-wa')?.getAttribute('href') || '')), null, { timeout: 10000 });
  const wa = await page.locator('.draft-wa').getAttribute('href');
  check(/^https:\/\/wa\.me\//.test(wa), W, `WhatsApp href is ${wa.slice(0, 40)}`);
  const ghHref = await page.locator('a.draft-way').first().getAttribute('href');
  check(ghHref && ghHref.includes('template=family-tree-proposal.yml') && /GFT[01]/.test(decodeURIComponent(ghHref)), W, 'GitHub issue link has no template/code');
  await shot(page, 'wizard-4-draft');
  const proposal = await proposalFromUrl(wa);
  check(proposal.ops.length === 5, W, `decoded proposal has ${proposal.ops.length} ops`);
  const r = applyProposal(DATA, proposal, { mode: 'final', now: new Date().toISOString(), issue: 1, actor: 'e2e' });
  check(r.ok, W, `proposal does not apply in final mode: ${JSON.stringify(r.errors).slice(0, 300)}`);
  if (r.ok) {
    check(r.created.people.length === 5, W, `created ${r.created.people.length} people`);
    check(validateData(r.data).ok, W, 'result does not validate');
    const gg = buildGraph(r.data);
    const salman = r.idMap[proposal.ops[0].ref];
    check(gg.father(salman)?.id === WIZ_FATHER, W, 'self is not a child of the chosen father');
    check(gg.children(salman).length === 3, W, 'self does not have 3 children');
    check(gg.person(salman).birth.date === '1990', W, `birth year stored as ${gg.person(salman).birth.date}`);
  }
  problemsOf(W, problems);
  await context.close();
});

/** Open "More options" and pick an item by its label. */
async function moreOption(page, label) {
  await page.click('.person-btn-more');
  await modalOpen(page);
  await page.locator('dialog.modal[open] .sheet-item', { hasText: label }).first().click();
  await page.waitForTimeout(150);
  await modalOpen(page);
}
/** Radios in dialogs are styled labels: click the label that wraps the input. */
async function pickRadio(page, value) {
  await page.locator(`dialog.modal[open] label:has(input[type="radio"][value="${value}"])`).first().click();
  await page.waitForTimeout(200); // highlight transition
  check(await page.locator(`dialog.modal[open] input[type="radio"][value="${value}"]`).first().isChecked(), 'dialogs', `radio ${value} not checked`);
}
const primaryAction = (page) => page.locator('dialog.modal[open] .modal-actions .btn-primary').last();

let SENT_STATE = null; // handed from the dialogs flow to the approval flow

flow('person-page dialogs (en, 360px)', async (browser) => {
  const W = 'dialogs';
  const context = await newContext(browser, { lang: 'en', width: 360, height: 740 });
  const page = await context.newPage();
  const problems = watch(page);
  await load(page, `#/p/${DLG_PERSON}`);
  // (1) add a child
  await page.click('.person-btn-add');
  await modalOpen(page);
  await shot(page, 'dialogs-1-sheet');
  await page.click('dialog.modal[open] .dlg-tile-child');
  await page.waitForSelector('dialog.dlg-add-child[open]');
  await page.locator('dialog.modal[open] input.form-input-ar[id$="-name"]').fill('يوسف');
  await pickRadio(page, 'm');
  await page.locator('dialog.modal[open] input.form-year').first().fill('2019');
  await shot(page, 'dialogs-2-add-child');
  await primaryAction(page).click();
  await modalClosed(page);
  let ops = await draftOps(page);
  check(ops.length === 1 && ops[0].op === 'add-person' && ops[0].link?.as === 'child' && ops[0].link?.of === DLG_PERSON, W, `add child produced ${JSON.stringify(ops).slice(0, 200)}`);
  await settle(page);
  check(await page.locator('.draft-bar:not([hidden])').count() === 1, W, 'sticky "unsent changes" bar is not shown');
  check((await page.locator('#app').innerText()).includes('Yousef'), W, 'new child is not shown on the person page');
  // (2) mark the father as deceased
  const fatherId = G.father(DLG_PERSON).id;
  await load(page, `#/p/${fatherId}`);
  await moreOption(page, 'Mark as');
  await pickRadio(page, 'deceased');
  await page.waitForTimeout(100);
  await shot(page, 'dialogs-3-mark');
  await primaryAction(page).click();
  await modalClosed(page);
  ops = await draftOps(page);
  check(ops.length === 2 && ops[1].op === 'mark' && ops[1].mark === 'deceased' && ops[1].id === fatherId, W, `mark produced ${JSON.stringify(ops[1])}`);
  await settle(page);
  check(/may god have mercy|رحمه الله|rahimahu/i.test(await page.locator('#app').innerText()), W, 'deceased person page has no "may God have mercy" line');
  check(!/[✝†✞]/.test(await page.locator('#app').innerText()), W, 'a cross symbol is shown for the deceased');
  // (3) re-arrange children
  await load(page, `#/p/${DLG_PERSON}`);
  await moreOption(page, 'Re-arrange children');
  await page.locator('dialog.modal[open] .dlg-order-down').first().click();
  await shot(page, 'dialogs-4-reorder');
  await primaryAction(page).click();
  await modalClosed(page);
  ops = await draftOps(page);
  check(ops.length === 3 && ops[2].op === 'reorder-children', W, `reorder produced ${JSON.stringify(ops[2])}`);
  // (4) request removal is blocked for a person with children
  await moreOption(page, 'Request removal');
  const blocked = await page.locator('dialog.modal[open] .notice-danger').count();
  const removeBtn = await page.locator('dialog.modal[open] .modal-actions .btn-danger').count();
  check(blocked === 1 && removeBtn === 0, W, 'removal of a person with children is not blocked');
  await shot(page, 'dialogs-5-remove-blocked');
  await page.click('dialog.modal[open] .modal-close');
  await modalClosed(page);
  check((await draftOps(page)).length === 3, W, 'blocked removal changed the draft');
  // (5) add a FORMER wife (new person) — the union is recorded as divorced
  await page.click('.person-btn-add');
  await modalOpen(page);
  await page.click('dialog.modal[open] .dlg-tile-spouse');
  await page.waitForSelector('dialog.dlg-add-spouse[open] .dlg-new-person');
  await page.click('dialog.modal[open] .dlg-new-person');
  await page.locator('dialog.modal[open] input.form-input-ar[id$="-name"]').fill('ميسون');
  if (await page.locator('dialog.modal[open] label:has(input[type="radio"][value="f"])').count()) await pickRadio(page, 'f');
  await pickRadio(page, 'former');
  await shot(page, 'dialogs-6-former-wife');
  await primaryAction(page).click();
  await modalClosed(page);
  ops = await draftOps(page);
  const spouseOp = ops[3];
  check(ops.length === 4 && spouseOp.op === 'add-person' && spouseOp.link?.as === 'spouse' && spouseOp.link?.status === 'divorced', W, `former spouse produced ${JSON.stringify(spouseOp)}`);
  // (6) marriage details of an existing marriage → edit-union with "before"
  await load(page, `#/p/${WIZ_FATHER}`);
  await page.locator('.person-marriage-btn').first().click();
  await page.waitForSelector('dialog.dlg-marriage[open]');
  await page.waitForTimeout(250);
  await page.locator('dialog.modal[open] input.form-year').first().fill('1985');
  await shot(page, 'dialogs-7-marriage');
  await primaryAction(page).click();
  await modalClosed(page);
  ops = await draftOps(page);
  const mOp = ops[4];
  check(ops.length === 5 && mOp.op === 'edit-union' && mOp.set?.['marriage.date'] === '1985' && mOp.before?.['marriage.date'] === '', W, `marriage details produced ${JSON.stringify(mOp)}`);
  await settle(page);
  check(/1985/.test(await page.locator('.person-sec-spouses').innerText()), W, 'marriage year not shown on the person page');
  // (7) the draft page lists the five changes; send via "copy code"
  await load(page, '#/draft');
  check((await page.locator('.draft-changes .draft-ops li').count()) === 5, W, 'draft does not list 5 changes');
  await page.check('#draft-ack');
  await page.locator('details.draft-other > summary').click();
  await page.waitForFunction(() => !document.querySelector('button.draft-way')?.disabled, null, { timeout: 10000 });
  await shot(page, 'dialogs-8-draft');
  const draftId = await page.evaluate(() => globalThis.__gft.draft.id);
  await page.locator('button.draft-way').click();
  await page.waitForFunction(() => globalThis.__gft.sent.length === 1 && globalThis.__gft.draft.ops.length === 0, null, { timeout: 5000 });
  await settle(page);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  check(/^GFT[01]:/.test(clip), W, `clipboard holds ${clip.slice(0, 20)}`);
  check(await page.locator('.draft-thanks').count() === 1, W, 'no thank-you card after sending');
  await shot(page, 'dialogs-9-sent');
  const sent = await page.evaluate(() => globalThis.__gft.sent[0]);
  check(sent.id === draftId && sent.via === 'copy', W, `sent entry ${sent.id}/${sent.via}`);
  if (clip) {
    const decoded = await decodeProposal(clip);
    check(decoded.id === draftId && decoded.ops.length === 5, W, 'copied code does not decode to the draft');
  }
  // #/me shows it as sent
  await load(page, '#/me');
  check(await page.locator('.me-prop-sent').count() === 1, W, '#/me does not list the sent proposal');
  await shot(page, 'dialogs-10-me');
  problemsOf(W, problems);
  SENT_STATE = { context, page, sent, problems };
});

flow('approval simulation → toast, sent proposal disappears (en, 360px)', async () => {
  const W = 'approval';
  if (!SENT_STATE) { fail(W, 'needs the dialogs flow'); return; }
  const { context, page, sent, problems } = SENT_STATE;
  const proposal = sent.proposal;
  const now = new Date().toISOString();
  const r = applyProposal(DATA, proposal, { mode: 'final', now, issue: 4242, actor: 'gtsgate' });
  check(r.ok, W, `sent proposal does not apply in final mode: ${JSON.stringify(r.errors).slice(0, 300)}`);
  if (!r.ok) return;
  const hash = await proposalHash(proposal);
  const en = describeProposal(proposal, G, 'en');
  const ar = describeProposal(proposal, G, 'ar');
  const changelog = { entries: [{
    issue: 4242, proposalId: proposal.id, hash, commit: 'abc1234', rev: r.data.meta.revision, at: now, title: en.title,
    summary: { en: en.lines, ar: ar.lines }, submitter: { name: proposal.submitter?.name || '', relation: proposal.submitter?.relation || '' },
    approvedBy: 'gtsgate', people: [...new Set([...r.created.people, ...r.touched.people])],
    touched: { people: [...new Set([...r.touched.people, ...r.created.people])], unions: [...new Set([...r.touched.unions, ...r.created.unions])] },
    destructive: false, action: 'apply',
  }] };
  const applied = { [hash]: { issue: 4242, proposalId: proposal.id, commit: 'abc1234', idMap: r.idMap, at: now, rev: r.data.meta.revision } };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gft-site-'));
  for (const entry of ['index.html', 'manifest.json', 'config.json', 'css', 'js', 'img', 'data']) fs.cpSync(path.join(SITE, entry), path.join(tmp, entry), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'data', 'family.json'), serializeData(r.data));
  fs.writeFileSync(path.join(tmp, 'data', 'changelog.json'), `${JSON.stringify(changelog, null, 2)}\n`);
  fs.writeFileSync(path.join(tmp, 'data', 'applied.json'), `${JSON.stringify(applied, null, 2)}\n`);
  server.root = tmp;
  try {
    await load(page, '#/');
    const toast = page.locator('.toast-success');
    check(await toast.count() >= 1, W, 'no "your changes were approved" toast');
    check(/approved/i.test(await toast.first().innerText().catch(() => '')), W, 'toast text does not say approved');
    await shot(page, 'approval-1-toast');
    const st = await page.evaluate(() => ({ sent: globalThis.__gft.sent.length, approved: globalThis.__gft.approved.length, rev: globalThis.__gft.data.meta.revision }));
    check(st.sent === 0, W, `${st.sent} proposals still in the sent queue`);
    check(st.approved === 1, W, 'approved history not recorded');
    check(st.rev === DATA.meta.revision + 1, W, `revision ${st.rev}`);
    await load(page, '#/me');
    check(await page.locator('.me-prop-sent').count() === 0, W, '#/me still lists the proposal as sent');
    check(await page.locator('.me-prop-approved').count() === 1, W, '#/me does not list the approved proposal');
    await shot(page, 'approval-2-me');
    const newChild = r.idMap[proposal.ops[0].ref];
    await load(page, `#/p/${newChild}`);
    const txt = await page.locator('#app').innerText();
    check(/Yousef/.test(txt) && !/Not sent yet|awaiting approval/i.test(txt), W, 'approved child page wrong or still pending');
    await load(page, '#/changes');
    check(/#?4242/.test(await page.locator('#app').innerText()) || (await page.locator('#app .change-entry, #app li').count()) > 0, W, 'changes page does not show the approved entry');
    await shot(page, 'approval-3-changes');
  } finally {
    server.root = SITE;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  problemsOf(W, problems);
  await context.close();
});

flow('admin paste → preview ✅ → approve-issue URL (ar, 1280px)', async (browser) => {
  const W = 'admin';
  const context = await newContext(browser, { lang: 'ar', width: 1280, height: 800 });
  const page = await context.newPage();
  const problems = watch(page);
  const { code } = await sampleCode();
  await load(page, '#/admin');
  const message = `السلام عليكم\nهذه تعديلاتي\n\nرمز التعديلات — يُرجى عدم تغييره / Change code — do not edit\n\`\`\`\n${code}\n\`\`\``;
  await page.fill('#admin-paste', message);
  await page.locator('.admin-section .btn-primary', { hasText: 'معاينة' }).first().click();
  await page.waitForSelector('.preview-status', { timeout: 10000 });
  check(await page.locator('.preview-status-ok').count() === 1, W, 'preview does not show ✅');
  check((await page.locator('.preview-status-ok').innerText()).includes('✅'), W, 'no ✅ mark');
  await page.waitForFunction(() => !!document.querySelector('.preview-approve')?.getAttribute('href'), null, { timeout: 10000 });
  const href = await page.locator('.preview-approve').getAttribute('href');
  const u = new URL(href);
  check(u.searchParams.get('labels') === 'family-tree,approve', W, `labels=${u.searchParams.get('labels')}`);
  check(u.searchParams.get('template') === 'family-tree-proposal.yml', W, 'approve URL without the issue template');
  check(/GFT[01]:/.test(u.searchParams.get('code') || ''), W, 'approve URL without the code');
  await shot(page, 'admin-1-preview');
  // A removal request needs the separate deletion approval label.
  const del = newProposal();
  del.ops = [{ op: 'remove-person', id: LEAF, reasonCode: 'entered-by-mistake' }];
  await page.fill('#admin-paste', await encodeProposal(del));
  await page.locator('.admin-section .btn-primary', { hasText: 'معاينة' }).first().click();
  await page.waitForFunction(() => /approve-deletion/.test(decodeURIComponent(document.querySelector('.preview-approve')?.getAttribute('href') || '')), null, { timeout: 10000 });
  const delHref = new URL(await page.locator('.preview-approve').getAttribute('href'));
  check(delHref.searchParams.get('labels') === 'family-tree,approve-deletion', W, `deletion labels=${delHref.searchParams.get('labels')}`);
  await shot(page, 'admin-2-deletion');
  // The preview route itself (link from the bot comment)
  await load(page, `#/preview?code=${encodeURIComponent(code)}`);
  check(await page.locator('.preview-status-ok').count() === 1, W, '#/preview?code= does not show ✅');
  problemsOf(W, problems);
  await context.close();
});

flow('e-mail relay: failed send shows the other ways; "Send to {owner}" → sent with the request number (ar, 360px)', async (browser) => {
  const W = 'relay';
  const RELAY = 'https://script.google.com/macros/s/AKfy-e2e-relay/exec';
  const context = await newContext(browser, { lang: 'ar', width: 360, height: 740 });
  // The site's config with a relayUrl; the relay itself answers from the test (a failure first, then success).
  const config = JSON.parse(fs.readFileSync(path.join(SITE, 'config.json'), 'utf8'));
  await context.route((url) => url.hostname === 'localhost' && url.pathname === '/config.json',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...config, relayUrl: RELAY }) }));
  let answer = { ok: false, error: 'github_error' };
  const posts = [];
  await context.route((url) => url.href === RELAY, async (route) => {
    const req = route.request();
    posts.push({ method: req.method(), headers: req.headers(), body: req.postData() || '' });
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(answer) });
  });
  const page = await context.newPage();
  const problems = watch(page);
  await load(page, `#/p/${LEAF}`);
  const added = await page.evaluate((id) => globalThis.__gft.addOps([{ op: 'mark', id, mark: 'verified' }]).ok, LEAF);
  check(added, W, 'could not add a change to the draft');
  await load(page, '#/draft');
  check(await page.locator('button.draft-relay').count() === 1, W, 'no "Send to {owner}" button although relayUrl is set');
  check(/إرسال إلى/.test(await page.locator('button.draft-relay').innerText()), W, 'relay button label');
  check(await page.locator('a.btn.draft-wa').count() === 0, W, 'WhatsApp is still the primary button');
  check(await page.locator('#draft-ack').count() === 1, W, 'the public-data notice is missing');
  check(await page.locator('.draft-hp input[name="website"]').count() === 1, W, 'no honeypot field');
  await page.check('#draft-ack');
  await page.waitForFunction(() => !document.querySelector('button.draft-relay')?.disabled, null, { timeout: 10000 });
  const draftId = await page.evaluate(() => globalThis.__gft.draft.id);

  // (1) The relay fails → error notice, the other ways open (WhatsApp first), the draft stays unsent.
  await page.click('button.draft-relay');
  await page.waitForSelector('.draft-relay-error:not([hidden])', { timeout: 10000 });
  check(await page.locator('details.draft-other[open]').count() === 1, W, 'other ways are not opened after a failed send');
  const waHref = await page.locator('details.draft-other a.draft-way.draft-wa').getAttribute('href');
  check(/^https:\/\/wa\.me\//.test(waHref || ''), W, `WhatsApp fallback link is ${String(waHref).slice(0, 40)}`);
  check(await page.evaluate(() => globalThis.__gft.sent.length) === 0, W, 'a failed send moved the draft to the sent queue');
  const over = await overflowAt(page);
  check(!over, W, `horizontal overflow — ${over}`);
  await shot(page, 'relay-1-failed');
  check(posts.length === 1, W, `${posts.length} POSTs to the relay`);
  if (posts[0]) {
    check(posts[0].method === 'POST', W, `method ${posts[0].method}`);
    check(/^text\/plain/.test(posts[0].headers['content-type'] || ''), W, `content-type ${posts[0].headers['content-type']} (a preflight would be needed)`);
    const body = JSON.parse(posts[0].body);
    check(body.proposalId === draftId && body.website === '' && body.lang === 'ar', W, 'payload id / honeypot / lang');
    check(Array.isArray(body.summary) && body.summary.length === 2 && /^1\. /.test(body.summary[0]) && /^1\. /.test(body.summary[1]), W, `summary ${JSON.stringify(body.summary)}`);
    const decoded = await decodeProposal(body.code);
    check(decoded.id === draftId && decoded.ops.length === 1 && decoded.ops[0].op === 'mark', W, 'payload code does not decode to the draft');
  }

  // (2) The relay accepts → sent via "relay" with request #7, thank-you panel.
  answer = { ok: true, issue: 7, url: 'https://github.com/gtsgate/family-tree/issues/7' };
  await page.click('button.draft-relay');
  await page.waitForFunction(() => globalThis.__gft.sent.length === 1 && globalThis.__gft.draft.ops.length === 0, null, { timeout: 10000 });
  await settle(page);
  const sent = await page.evaluate(() => globalThis.__gft.sent[0]);
  check(sent.id === draftId && sent.via === 'relay' && sent.issue === 7, W, `sent entry ${sent.id}/${sent.via}/${sent.issue}`);
  check(await page.locator('.draft-thanks-relay').count() === 1, W, 'no relay thank-you panel');
  const thanks = await page.locator('.draft-thanks').innerText();
  check(/أُرسل ✓/.test(thanks) && /#7/.test(thanks), W, `thank-you panel says ${thanks.slice(0, 80)}`);
  check(await page.locator('.draft-thanks-undo').count() === 0, W, '"it was not sent" offered after a confirmed relay send');
  await shot(page, 'relay-2-sent');
  await load(page, '#/me');
  check(/الإرسال المباشر/.test(await page.locator('#app').innerText()), W, '#/me does not say it was sent directly');
  check(await page.locator('#app').innerText().then((x) => !/GitHub \(من الحاسوب\)/.test(x)), W, '#/me shows the draft send options');

  // (3) A proposal sent another way (copy code — e.g. a GitHub request that arrived empty) can be sent again through
  // the relay from the sent list.
  await page.evaluate((id) => globalThis.__gft.addOps([{ op: 'mark', id, mark: 'needs-info', note: 'سنة الميلاد' }]), LEAF);
  await load(page, '#/draft');
  check(/من الحاسوب/.test(await page.locator('details.draft-other').textContent()), W, 'the GitHub option does not say it needs a computer');
  await page.locator('details.draft-other > summary').click();
  await page.waitForFunction(() => !document.querySelector('button.draft-way')?.disabled, null, { timeout: 10000 });
  await page.locator('button.draft-way').click();
  await page.waitForFunction(() => globalThis.__gft.sent.length === 2, null, { timeout: 5000 });
  await load(page, '#/draft');
  check(await page.locator('.draft-sent-relay').count() === 1, W, `${await page.locator('.draft-sent-relay').count()} relay resend buttons (expected 1: only the copied one)`);
  await page.waitForFunction(() => !document.querySelector('.draft-sent-relay')?.disabled, null, { timeout: 10000 });
  answer = { ok: true, issue: 8, url: 'https://github.com/gtsgate/family-tree/issues/8' };
  await page.locator('.draft-sent-relay').click();
  await page.waitForFunction(() => globalThis.__gft.sent.every((x) => x.via === 'relay'), null, { timeout: 10000 });
  const resent = await page.evaluate(() => globalThis.__gft.sent.map((x) => x.issue));
  check(JSON.stringify(resent) === '[7,8]', W, `request numbers ${JSON.stringify(resent)}`);
  await settle(page);
  check(await page.locator('.draft-sent-relay').count() === 0, W, 'relay resend still offered after it was sent');

  // (4) Owner: a code pasted on the Admin page is sent for approval by e-mail; GitHub is the computer-only fallback.
  const { code } = await sampleCode();
  await load(page, '#/admin');
  await page.fill('#admin-paste', code);
  await page.locator('.admin-section .btn-primary', { hasText: 'معاينة' }).first().click();
  await page.waitForSelector('.preview-relay', { timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector('.preview-relay')?.disabled, null, { timeout: 10000 });
  check(!(await page.locator('.preview-approve').getAttribute('class')).includes('btn-primary'), W, 'GitHub link is still the primary owner action');
  check(/الحاسوب/.test(await page.locator('.preview-owner').innerText()), W, 'GitHub link does not say it needs a computer browser');
  answer = { ok: true, issue: 9, url: 'https://github.com/gtsgate/family-tree/issues/9' };
  await page.locator('.preview-relay').click();
  await page.waitForSelector('.preview-relay-sent', { timeout: 10000 });
  check(/رقم 9\b/.test(await page.locator('.preview-relay-sent').innerText()), W, 'admin relay send does not show request #9');
  const adminPost = JSON.parse(posts.at(-1).body);
  check(adminPost.code === code && adminPost.website === '' && adminPost.summary.length >= 2, W, 'admin relay payload');
  await page.waitForTimeout(300); // the panel fades in after a re-render
  await shot(page, 'relay-3-admin');
  // (5) Owner correcting that pasted code: the draft's correction banner sends through the relay too.
  await page.locator('.preview-actions .row .btn').nth(1).click(); // "Correct this proposal"
  await page.waitForSelector('.draft-correction .draft-corr-relay', { timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector('.draft-corr-relay')?.disabled, null, { timeout: 10000 });
  answer = { ok: true, issue: 9, duplicate: true, url: 'https://github.com/gtsgate/family-tree/issues/9' };
  await page.locator('.draft-corr-relay').click();
  await page.waitForSelector('.draft-corr-relay-sent', { timeout: 10000 });
  check(/رقم 9\b/.test(await page.locator('.draft-corr-relay-sent').innerText()), W, 'correction relay send does not name request 9');
  check(await page.locator('.draft-correction a.btn-sm').count() === 1, W, 'no secondary GitHub link in the correction banner');
  problemsOf(W, problems);
  await context.close();
});

// ---------------------------------------------------------------------------------------------------------------
/** In-page check: rendered leaves/tags of every home tree never overlap (separating-axis test on their boxes). */
const OVERLAPS = () => {
  const out = [];
  for (const svg of document.querySelectorAll('.ht-tree .ht-svg')) {
    const boxes = [...svg.querySelectorAll('.ht-leaf, .ht-tag')].map((g) => {
      const shape = g.querySelector('.ht-leaf-shape, .ht-tag-bg');
      const b = shape.getBBox();
      const leaf = g.classList.contains('ht-leaf');
      const sx = leaf ? 0.06 : 0;
      const sy = leaf ? 0.1 : 0; // a leaf's pointed ends do not fill its box
      const m = svg.getCTM().inverse().multiply(g.getCTM());
      return [[sx, sy], [1 - sx, sy], [1 - sx, 1 - sy], [sx, 1 - sy]].map(([u, v]) => {
        const q = new DOMPoint(b.x + b.width * u, b.y + b.height * v).matrixTransform(m);
        return [q.x, q.y];
      });
    });
    const axes = (P) => [0, 1].map((i) => { const dx = P[i + 1][0] - P[i][0]; const dy = P[i + 1][1] - P[i][1]; const l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; });
    const apart = (A, B) => [...axes(A), ...axes(B)].some((ax) => {
      const a = A.map((q) => q[0] * ax[0] + q[1] * ax[1]);
      const c = B.map((q) => q[0] * ax[0] + q[1] * ax[1]);
      return Math.max(...a) <= Math.min(...c) + 0.01 || Math.max(...c) <= Math.min(...a) + 0.01;
    });
    let n = 0;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (!apart(boxes[i], boxes[j])) n++;
    out.push(n);
  }
  return out;
};

flow('home family trees: options, popover, keyboard, viewer (ar 1280px + 360px)', async (browser) => {
  const W = 'home-trees';
  const branches = G.branches();
  // --- desktop ---
  let context = await newContext(browser, { lang: 'ar', width: 1280, height: 800 });
  let page = await context.newPage();
  let problems = watch(page);
  await load(page, '#/');
  check(await page.locator('#app .home-help').count() === 0, W, 'the home page still shows "help complete the tree"');
  check(await page.locator('.ht-tree').count() === branches.length, W, `${await page.locator('.ht-tree').count()} trees for ${branches.length} families`);
  const titles = await page.locator('.ht-name').allInnerTexts();
  check(branches.every((b) => titles.some((x) => x.includes(`شجرة ${b.family.ar}`))), W, `tree titles: ${titles.join(' | ')}`);
  check(await page.locator('.ht-leaf').count() > 0 && await page.locator('.ht-leaf:not(.ht-c-man)').count() === 0, W, 'by default the trees should show the men only');
  check(await page.locator('.ht-trunk-name').count() >= branches.length, W, 'no names on the trunks');
  // Options: daughters on → rose leaves, remembered across a reload; off again.
  await page.locator('.ht-chip[data-cat="daughters"]').click();
  await page.waitForTimeout(150);
  check(await page.locator('.ht-leaf.ht-c-daughter').count() > 0, W, 'the daughters option adds no leaves');
  check(await page.evaluate(() => localStorage.getItem('gft.hometree.daughters')) === '1', W, 'the daughters option is not remembered');
  await load(page, '#/');
  check(await page.locator('.ht-chip[data-cat="daughters"]').getAttribute('aria-pressed') === 'true', W, 'daughters option lost after reload');
  check(await page.locator('.ht-leaf.ht-c-daughter').count() > 0, W, 'daughter leaves lost after reload');
  for (const c of ['mothers', 'wives', 'others']) await page.locator(`.ht-chip[data-cat="${c}"]`).click();
  await page.waitForTimeout(150);
  check(await page.locator('.ht-leaf.ht-c-mother').count() > 0 && await page.locator('.ht-leaf.ht-c-wife').count() > 0, W, 'mothers / wives leaves missing');
  const overlaps = await page.evaluate(OVERLAPS);
  check(overlaps.every((n) => n === 0), W, `overlapping leaves/tags with every option on: ${overlaps.join(', ')}`);
  await shot(page, 'home-trees-1-all-options');
  for (const c of ['daughters', 'mothers', 'wives', 'others']) await page.locator(`.ht-chip[data-cat="${c}"]`).click();
  check(await page.locator('.ht-leaf:not(.ht-c-man)').count() === 0, W, 'options do not switch off');
  // Popover by pointer.
  const tag = page.locator('.ht-tree').first().locator('.ht-tag').first();
  await tag.click();
  await page.waitForSelector('.ht-pop', { timeout: 3000 });
  const links = await page.locator('.ht-pop a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  check(links.some((x) => /^#\/p\//.test(x)) && links.some((x) => new RegExp(`^#/tree/${branches[0].person.id}\\?focus=`).test(x)), W, `popover links: ${links.join(' ')}`);
  await shot(page, 'home-trees-2-popover');
  await page.keyboard.press('Escape');
  check(await page.locator('.ht-pop').count() === 0, W, 'Esc does not close the popover');
  // Keyboard: Enter on a focused tag opens the popover with focus inside; Esc returns focus to the tag.
  await tag.focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.ht-pop', { timeout: 3000 });
  check(await page.evaluate(() => !!document.activeElement?.closest('.ht-pop')), W, 'keyboard: focus is not in the popover');
  await page.keyboard.press('Escape');
  check(await page.evaluate(() => document.activeElement?.classList.contains('ht-tag')), W, 'keyboard: Esc does not return focus to the tag');
  // Viewer.
  await page.locator('.ht-enlarge').first().click();
  await page.waitForSelector('dialog.ht-viewer[open]', { timeout: 3000 });
  check(await page.locator('dialog.ht-viewer .ht-leaf').count() > 0, W, 'the viewer shows no tree');
  await page.locator('dialog.ht-viewer button[aria-label="تكبير"]').click();
  await page.keyboard.press('Escape');
  check(await page.locator('dialog.ht-viewer').count() === 0, W, 'Esc does not close the viewer');
  problemsOf(W, problems);
  await context.close();
  // --- phone ---
  context = await newContext(browser, { lang: 'ar', width: 360, height: 740 });
  page = await context.newPage();
  problems = watch(page);
  await load(page, '#/');
  const visible = () => page.locator('.ht-tree').evaluateAll((els) => els.filter((e) => e.offsetParent !== null).map((e) => e.dataset.head));
  check((await visible()).length === 1, W, 'phone: more than one tree visible');
  if (branches.length > 1) {
    await page.locator(`.ht-switch button[data-head="${branches[1].person.id}"]`).click();
    check((await visible())[0] === branches[1].person.id, W, 'phone: the family switch does not change the tree');
    await page.locator(`.ht-switch button[data-head="${branches[0].person.id}"]`).click();
  }
  const svg = page.locator('.ht-tree.is-selected .ht-svg');
  await svg.scrollIntoViewIfNeeded();
  await svg.click();
  await page.waitForSelector('dialog.ht-viewer[open]', { timeout: 3000 });
  await page.waitForTimeout(200);
  await page.locator('dialog.ht-viewer .ht-tag').first().click();
  await page.waitForSelector('dialog.ht-viewer .ht-pop', { timeout: 3000 });
  await shot(page, 'home-trees-3-phone-viewer');
  await page.keyboard.press('Escape');
  check(await page.locator('dialog.ht-viewer[open]').count() === 1 && await page.locator('.ht-pop').count() === 0, W, 'phone: first Esc should close only the popover');
  await page.keyboard.press('Escape');
  check(await page.locator('dialog.ht-viewer').count() === 0, W, 'phone: second Esc does not close the viewer');
  const over = await overflowAt(page);
  check(!over, W, `phone: horizontal overflow after the viewer — ${over}`);
  problemsOf(W, problems);
  await context.close();
});

flow('owner mode: sign in → a child added on the person page is committed at once; Apply now; sign out → proposals (en, 360px)', async (browser) => {
  const W = 'owner';
  const CONFIG = JSON.parse(fs.readFileSync(path.join(SITE, 'config.json'), 'utf8'));
  const files = Object.fromEntries(['family.json', 'changelog.json', 'applied.json'].map((f) => [`data/${f}`, fs.readFileSync(path.join(SITE, 'data', f), 'utf8')]));
  files['config.json'] = fs.readFileSync(path.join(SITE, 'config.json'), 'utf8');
  const gh = createFakeGitHub({ files, owner: CONFIG.repo.owner, repo: CONFIG.repo.name, branch: CONFIG.repo.branch || 'main', login: CONFIG.approvers[0] });
  const context = await newContext(browser, { lang: 'en', width: 360, height: 740 });
  // Registered after newContext's stub, so it answers first: a fake GitHub with a real in-memory repository.
  await context.route((url) => url.hostname === 'api.github.com', async (route) => {
    const req = route.request();
    const r = gh.handle({ method: req.method(), url: req.url(), headers: await req.allHeaders(), body: req.postData() });
    if (r.network) { await route.abort('failed'); return; }
    await route.fulfill({ status: r.status, headers: r.headers, body: r.body });
  });
  const page = await context.newPage();
  const problems = watch(page);
  const remote = () => normalizeData(JSON.parse(gh.file('data/family.json')));

  // (1) Sign in on #/admin
  await load(page, '#/admin');
  check(await page.locator('.owner-card #owner-token').count() === 1, W, 'no token field in the Owner mode card');
  check(await page.locator('.owner-pill').count() === 0, W, 'owner pill shown before signing in');
  await page.fill('#owner-token', FAKE_TOKEN);
  await shot(page, 'owner-0-sign-in');
  await page.click('.owner-signin');
  await page.waitForSelector('.owner-card.is-on', { timeout: 10000 });
  check(/Signed in as gtsgate on this device/i.test(await page.locator('.owner-card').innerText()), W, 'no "Signed in as …" text');
  check(await page.locator('.owner-pill').count() === 1, W, 'no owner pill in the header');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gft.owner.v1') || 'null'));
  check(stored?.login === 'gtsgate' && stored?.token === FAKE_TOKEN, W, 'credentials not stored on the device');
  check(gh.log.every((l) => !l.path.includes(FAKE_TOKEN)), W, 'the token appeared in a URL');
  check(gh.commitsOf().length === 1, W, 'signing in committed something');
  await shot(page, 'owner-1-signed-in');

  // (2) Add a child through the person dialog → one commit, shown at once, no proposal
  const head0 = gh.head();
  const rev0 = await page.evaluate(() => globalThis.__gft.data.meta.revision);
  await load(page, `#/p/${DLG_PERSON}`);
  await page.click('.person-btn-add');
  await modalOpen(page);
  await page.click('dialog.modal[open] .dlg-tile-child');
  await page.waitForSelector('dialog.dlg-add-child[open]');
  check(/Save to the tree/.test(await primaryAction(page).innerText()), W, 'the dialog still says "proposal"');
  await page.locator('dialog.modal[open] input.form-input-ar[id$="-name"]').fill('نوفل');
  await pickRadio(page, 'm');
  await page.locator('dialog.modal[open] input.form-year').first().fill('2021');
  await primaryAction(page).click();
  await modalClosed(page);
  const toastText = await page.locator('.toast-success').last().innerText().catch(() => '');
  check(/Saved — live on the site in about a minute/.test(toastText), W, `toast says "${toastText}"`);
  await page.waitForFunction((r) => globalThis.__gft.saving.length === 0 && globalThis.__gft.data.meta.revision > r, rev0, { timeout: 15000 });
  await settle(page);
  const commits = gh.commitsOf();
  check(commits.length === 2, W, `${commits.length - 1} commits made`);
  check(commits[0].parents[0] === head0, W, 'the commit is not on top of the branch head');
  check(JSON.stringify(commits[0].files.sort()) === JSON.stringify(['data/changelog.json', 'data/family.json']), W, `commit files ${commits[0].files}`);
  check(/^family-tree: owner edit \(rev \d+, 1 change\)/.test(commits[0].message) && !commits[0].message.includes('نوفل'), W, `commit message ${JSON.stringify(commits[0].message)}`);
  const after = remote();
  const kid = Object.values(after.people).find((p) => p.name?.ar === 'نوفل');
  check(!!kid && /^p[a-z0-9]{7}$/.test(kid.id), W, 'the child is not in the committed family.json');
  const entry = JSON.parse(gh.file('data/changelog.json')).entries[0];
  check(entry.action === 'owner-edit' && entry.approvedBy === 'gtsgate' && entry.people.includes(kid?.id), W, `changelog entry ${JSON.stringify(entry).slice(0, 200)}`);
  const st = await page.evaluate(() => ({ draft: globalThis.__gft.draft.ops.length, sent: globalThis.__gft.sent.length, rev: globalThis.__gft.data.meta.revision }));
  check(st.draft === 0 && st.sent === 0, W, `draft ${st.draft}, sent ${st.sent} — expected no proposal at all`);
  check(st.rev === after.meta.revision, W, 'the site did not adopt the committed data at once');
  check(await page.locator('.draft-bar:not([hidden])').count() === 0, W, 'the "unsent changes" bar is shown in owner mode');
  const text = await page.locator('#app').innerText();
  const kidName = kid ? displayName(kid, 'en', buildGraph(after)) : 'Nawfal';
  check(text.includes(kidName), W, `the new child (${kidName}) is not shown on the person page`);
  check(!/Not sent yet|Not saved yet|awaiting approval/i.test(text), W, 'pending badges shown in owner mode');
  check(await page.locator(`#app a[href="#/p/${kid?.id}"]`).count() >= 1, W, 'the child is not linked with its real id');
  await shot(page, 'owner-2-saved');

  // (3) Apply now: a relative's proposal from a pasted code
  const p = newProposal();
  p.submitter = { name: 'Smoke test', relation: 'cousin', personId: '' };
  p.ops = [{ op: 'add-person', ref: 'new1', person: { name: { ar: 'سديم' }, gender: 'f' }, link: { as: 'child', of: LIVING, with: null }, unionRef: 'newu2' }];
  await load(page, `#/preview?code=${encodeURIComponent(await encodeProposal(p))}`);
  await page.waitForSelector('.owner-apply-now', { timeout: 10000 });
  await page.click('.owner-apply-now');
  await page.waitForSelector('.owner-applied', { timeout: 15000 });
  const hash = await proposalHash(p);
  const ledger = JSON.parse(gh.file('data/applied.json'));
  check(ledger[hash]?.proposalId === p.id && ledger[hash]?.issue === null, W, 'no applied.json entry for "Apply now"');
  check(Object.values(remote().people).some((x) => x.name?.ar === 'سديم'), W, '"Apply now" did not commit the proposal');
  await shot(page, 'owner-3-applied');

  // (4) The family wizard: each committed step is saved straight away; temp refs become real ids mid-flow; "Done".
  const commitsBeforeWizard = gh.commitsOf().length;
  await load(page, '#/add-family');
  await page.locator('.wiz-tile').nth(1).click(); // "I am not listed yet"
  await page.fill('.picker-input', lineageName(G, WIZ_FATHER, 'en'));
  await page.waitForSelector('.picker-option');
  await page.locator('.picker-option').first().click();
  await page.waitForSelector('.wiz-other-parent .chip');
  await page.locator('.wiz-other-parent .chip').first().click();
  const self = page.locator('.wiz-step-who .wiz-row').first();
  await self.locator('.wiz-ar').fill('مهيار');
  await self.locator('.wiz-gender button[data-v="m"]').click();
  await page.locator('.wiz-step-who .wiz-next').click();
  await page.waitForSelector('.wiz-step-spouses');
  await page.waitForFunction(() => globalThis.__gft.saving.length === 0, null, { timeout: 15000 });
  await settle(page);
  check(await page.locator('.wiz-step-spouses').count() === 1, W, 'the wizard left the spouse step once the first save finished');
  const wife = page.locator('.wiz-step-spouses .wiz-row').last();
  await wife.locator('.wiz-ar').fill('شذى');
  if (await wife.locator('.wiz-gender button[data-v="f"]').count()) await wife.locator('.wiz-gender button[data-v="f"]').click();
  await page.locator('.wiz-step-spouses .wiz-next').click();
  await page.waitForSelector('.wiz-step-children');
  const kids = [['لجين', 'f'], ['أوس', 'm'], ['قصي', 'm']];
  for (let i = 0; i < kids.length; i++) {
    if (i > 0) { await page.locator('.wiz-union').first().locator('.wiz-another').click(); await page.waitForTimeout(150); }
    const row = page.locator('.wiz-union').first().locator('.wiz-row').last();
    await row.locator('.wiz-ar').fill(kids[i][0]);
    await row.locator(`.wiz-gender button[data-v="${kids[i][1]}"]`).click();
  }
  await page.locator('.wiz-step-children .wiz-footer .wiz-next').click();
  await page.waitForSelector('.wiz-review-owner .wiz-done');
  await page.waitForFunction(() => globalThis.__gft.saving.length === 0 && !document.querySelector('.owner-pill.is-saving'), null, { timeout: 15000 });
  await settle(page);
  const wz = remote();
  const wg = buildGraph(wz);
  const mahyar = Object.values(wz.people).find((x) => x.name?.ar === 'مهيار');
  check(!!mahyar && wg.father(mahyar.id)?.id === WIZ_FATHER, W, 'wizard: self not committed as a child of the chosen father');
  check(mahyar && wg.spouses(mahyar.id).some((x) => x.person.name?.ar === 'شذى'), W, 'wizard: spouse not committed');
  check(mahyar && wg.children(mahyar.id).map((x) => x.name?.ar).sort().join(',') === ['أوس', 'قصي', 'لجين'].sort().join(','), W, 'wizard: children not committed under the couple');
  check(gh.commitsOf().length - commitsBeforeWizard === 3, W, `wizard made ${gh.commitsOf().length - commitsBeforeWizard} commits (expected one per step: 3)`);
  check(/3 changes/.test(gh.commitsOf()[0].message), W, 'the three children were not saved in one commit');
  check((await draftOps(page)).length === 0, W, 'wizard left changes in the draft');
  check(await page.locator('.wiz-done').getAttribute('href') === `#/p/${mahyar?.id}`, W, '"Done" does not lead to the saved person');
  await shot(page, 'owner-4-wizard-done');
  await page.locator('.wiz-done').click();
  await page.waitForFunction((id) => location.hash === `#/p/${id}`, mahyar?.id);
  await settle(page);
  check((await page.locator('#app').innerText()).includes(displayName(mahyar, 'en', wg, { kunya: false })), W, 'the saved person page does not open');

  // (5) Sign out → the normal proposal flow returns
  await load(page, '#/admin');
  await page.click('.owner-signout');
  await page.waitForSelector('.owner-card:not(.is-on) #owner-token');
  check(await page.locator('.owner-pill').count() === 0, W, 'owner pill still shown after signing out');
  check(await page.evaluate(() => localStorage.getItem('gft.owner.v1')) === null, W, 'credentials kept after signing out');
  const before = gh.commitsOf().length;
  await load(page, `#/p/${DLG_PERSON}`);
  await page.click('.person-btn-add');
  await modalOpen(page);
  await page.click('dialog.modal[open] .dlg-tile-child');
  await page.waitForSelector('dialog.dlg-add-child[open]');
  check(/proposal/i.test(await primaryAction(page).innerText()), W, 'signed out, the dialog does not add to the proposal');
  await page.locator('dialog.modal[open] input.form-input-ar[id$="-name"]').fill('رتاج');
  await pickRadio(page, 'f');
  await primaryAction(page).click();
  await modalClosed(page);
  await settle(page);
  const ops = await draftOps(page);
  check(ops.length === 1 && ops[0].op === 'add-person', W, `signed out, the draft has ${ops.length} ops`);
  check(await page.locator('.draft-bar:not([hidden])').count() === 1, W, 'signed out, no "unsent changes" bar');
  check(gh.commitsOf().length === before, W, 'signed out, something was committed');
  await shot(page, 'owner-5-signed-out');
  problemsOf(W, problems);
  await context.close();
});

// A man shown with an automatic kunya (known name, no recorded nickname, a named son) — for «إخفاء الكنية».
const KUNYA_MAN = people.find((p) => p.gender === 'm' && p.nameStatus === 'known' && personName(p, 'ar') && !p.nickname?.ar && !p.nickname?.en
  && !p.hideKunya && autoKunya(p, 'ar', G) && G.father(p.id) && p.id !== DLG_PERSON && p.id !== WIZ_FATHER)?.id;

/** A fake GitHub (tests/fake-github-api.mjs) holding this site's files, answering api.github.com for `context`. */
async function fakeGitHubFor(context) {
  const CONFIG = JSON.parse(fs.readFileSync(path.join(SITE, 'config.json'), 'utf8'));
  const files = Object.fromEntries(['family.json', 'changelog.json', 'applied.json'].map((f) => [`data/${f}`, fs.readFileSync(path.join(SITE, 'data', f), 'utf8')]));
  files['config.json'] = fs.readFileSync(path.join(SITE, 'config.json'), 'utf8');
  const gh = createFakeGitHub({ files, owner: CONFIG.repo.owner, repo: CONFIG.repo.name, branch: CONFIG.repo.branch || 'main', login: CONFIG.approvers[0] });
  await context.route((url) => url.hostname === 'api.github.com', async (route) => {
    const req = route.request();
    const r = gh.handle({ method: req.method(), url: req.url(), headers: await req.allHeaders(), body: req.postData() });
    if (r.network) { await route.abort('failed'); return; }
    await route.fulfill({ status: r.status, headers: r.headers, body: r.body });
  });
  return gh;
}

flow('owner home settings: hide a tree and a «يلتقي» line (config.json only); a visitor does not see them; admin card; hide a kunya (ar, 390px)', async (browser) => {
  const W = 'owner-home';
  const owner = JSON.stringify({ v: 1, token: FAKE_TOKEN, login: 'gtsgate', at: new Date().toISOString() });
  const context = await newContext(browser, { lang: 'ar', width: 390, height: 844, storage: { 'gft.owner.v1': owner } });
  const gh = await fakeGitHubFor(context);
  const page = await context.newPage();
  const problems = watch(page);
  const remoteConfig = () => JSON.parse(gh.file('config.json'));
  const mahmoud = G.branches().find((b) => b.family?.ar === 'آل محمود')?.person.id;
  const alam = G.branches().find((b) => b.family?.ar === 'آل عالم')?.person.id;
  if (!check(mahmoud && alam, W, 'the real data has no «آل عالم» / «آل محمود» trees')) { await context.close(); return; }
  /** Wait until the fake repository has `n` commits after the initial one and the save is over → exactly n? */
  const waitCommits = async (n) => {
    for (let i = 0; i < 150 && gh.commitsOf().length - 1 < n; i++) await page.waitForTimeout(100);
    await page.waitForFunction(() => !document.querySelector('.owner-pill.is-saving'), null, { timeout: 15000 }).catch(() => {});
    await settle(page);
    return gh.commitsOf().length - 1 === n;
  };

  // (1) The keeper sees the low-key owner controls on the home page.
  await load(page, '#/');
  await page.waitForSelector('.ht-tree');
  check(await page.locator('.owner-pill').count() === 1, W, 'not in owner mode');
  check(await page.locator('.ht-tree .ht-own-hide').count() === 2, W, 'no «إخفاء من الصفحة الرئيسية» button on each tree');
  check(await page.locator('.ht-bridge .ht-bridge-hide').count() === 1, W, 'no «إخفاء» button on the «يلتقي» line');
  check(await page.locator('.ht-own-row').count() === 0, W, 'the hidden row is shown while nothing is hidden');
  check(/إخفاء من الصفحة الرئيسية/.test(await page.locator('.ht-own-hide').first().innerText()), W, 'hide button label');
  await page.locator(`.ht-tree[data-head="${mahmoud}"] .ht-tree-foot`).scrollIntoViewIfNeeded().catch(() => {});
  await shot(page, 'owner-home-0-controls');

  // (2) Hide «شجرة آل محمود» → gone at once; one commit changing config.json only.
  await page.evaluate((id) => document.querySelector(`.ht-tree[data-head="${id}"] .ht-own-hide`).click(), mahmoud);
  await page.waitForFunction((id) => !document.querySelector(`.ht-tree[data-head="${id}"]`), mahmoud, { timeout: 3000 });
  check(await waitCommits(1), W, `${gh.commitsOf().length - 1} commits after hiding a tree`);
  let c = gh.commitsOf()[0];
  check(JSON.stringify(c.files) === JSON.stringify(['config.json']), W, `the commit changed ${c.files}`);
  check(c.message === 'family-tree: owner home settings\n', W, `commit message ${JSON.stringify(c.message)}`);
  check(JSON.stringify(remoteConfig().home) === JSON.stringify({ hiddenTrees: [mahmoud] }), W, `config.home ${JSON.stringify(remoteConfig().home)}`);
  const toastText = await page.locator('.toast-success').last().innerText().catch(() => '');
  check(/تم الحفظ — يصل التغيير إلى الجميع خلال دقيقة/.test(toastText), W, `toast says "${toastText}"`);
  check(await page.locator('.ht-switch').count() === 0, W, 'the phone family switch still lists the hidden tree');
  check(await page.locator('.ht-tree').count() === 1, W, 'more than one tree left');
  check(/شجرة آل محمود/.test(await page.locator('.ht-own-row').innerText().catch(() => '')), W, 'the hidden row does not list «شجرة آل محمود»');

  // (3) Hide the «يلتقي» line.
  const key = await page.locator('.ht-bridge').first().getAttribute('data-key');
  await page.locator('.ht-bridge .ht-bridge-hide').click();
  await page.waitForFunction(() => !document.querySelector('.ht-bridge'), null, { timeout: 3000 });
  check(await waitCommits(2), W, `${gh.commitsOf().length - 1} commits after hiding the line`);
  c = gh.commitsOf()[0];
  check(JSON.stringify(c.files) === JSON.stringify(['config.json']), W, `the second commit changed ${c.files}`);
  check(JSON.stringify(remoteConfig().home) === JSON.stringify({ hiddenTrees: [mahmoud], hiddenBridges: [key] }), W, `config.home ${JSON.stringify(remoteConfig().home)}`);
  check(await page.locator('.ht-own-row .ht-own-item').count() === 2, W, 'the hidden row does not list the tree and the line');
  check(!/\bnull\b/.test(await page.locator('.home-trees').innerText()), W, 'a stray "null" in the trees section');
  const { home: _h, ...rest } = remoteConfig();
  check(JSON.stringify(rest) === JSON.stringify(JSON.parse(fs.readFileSync(path.join(SITE, 'config.json'), 'utf8'))), W, 'other settings of config.json changed');
  await page.locator('.ht-own-row').scrollIntoViewIfNeeded();
  await shot(page, 'owner-home-1-hidden');
  problemsOf(W, problems);

  // (4) A visitor (no owner key) loading the committed config.json does not see them, nor any owner control.
  const visitor = await newContext(browser, { lang: 'ar', width: 390, height: 844 });
  await visitor.route((url) => url.hostname === 'localhost' && url.pathname.endsWith('/config.json'),
    (route) => route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: gh.file('config.json') }));
  const vpage = await visitor.newPage();
  const vproblems = watch(vpage);
  await load(vpage, '#/');
  await vpage.waitForSelector('.ht-tree');
  check(await vpage.locator(`.ht-tree[data-head="${mahmoud}"]`).count() === 0, W, 'visitor: «شجرة آل محمود» is shown');
  check(await vpage.locator(`.ht-tree[data-head="${alam}"]`).count() === 1, W, 'visitor: «شجرة آل عالم» is missing');
  check(await vpage.locator('.ht-bridge').count() === 0, W, 'visitor: the «يلتقي» line is shown');
  check(await vpage.locator('.ht-own-hide, .ht-own-row, .ht-switch').count() === 0, W, 'visitor: owner controls or the family switch are shown');
  await shot(vpage, 'owner-home-2-visitor');
  problemsOf(`${W} (visitor)`, vproblems);
  await visitor.close();

  // (5) «إظهار» from the hidden row brings the tree back.
  await page.locator('.ht-own-row .ht-own-show').first().click();
  await page.waitForSelector(`.ht-tree[data-head="${mahmoud}"]`, { state: 'attached', timeout: 3000 });
  check(await page.locator('.ht-switch button').count() === 2, W, 'the family switch does not list the tree shown again');
  check(await waitCommits(3), W, `${gh.commitsOf().length - 1} commits after showing the tree`);
  check(JSON.stringify(remoteConfig().home) === JSON.stringify({ hiddenBridges: [key] }), W, `config.home after «إظهار» ${JSON.stringify(remoteConfig().home)}`);

  // (6) #/admin «الصفحة الرئيسية» card: every tree and line with a toggle.
  await load(page, '#/admin');
  await page.waitForSelector('.admin-home');
  // low-key: a closed disclosure with a one-line status; opened, it lists everything
  check(await page.evaluate(() => !document.querySelector('.admin-home').open), W, 'admin: the home card is open by default');
  const homeStatus = await page.locator('.admin-home-status').innerText().catch(() => '');
  check(/المخفيّ: (1|١)/.test(homeStatus), W, `admin: home card status «${homeStatus}»`);
  await page.locator('.admin-home > summary').click();
  check(await page.locator('.admin-home .admin-home-row').count() === 3, W, `admin card rows: ${await page.locator('.admin-home .admin-home-row').count()}`);
  const lineBox = page.locator(`.admin-home .admin-home-row[data-key="${key}"] input[type=checkbox]`);
  check(await lineBox.count() === 1 && !(await lineBox.isChecked()), W, 'admin: the hidden line is not unchecked');
  check(await page.locator(`.admin-home .admin-home-row[data-head="${mahmoud}"] input[type=checkbox]`).isChecked(), W, 'admin: the shown tree is not checked');
  await page.locator('.admin-home').scrollIntoViewIfNeeded();
  await shot(page, 'owner-home-3-admin');
  await lineBox.check();
  check(await waitCommits(4), W, `${gh.commitsOf().length - 1} commits after the admin toggle`);
  check(!('home' in remoteConfig()), W, `config.home left after showing everything: ${JSON.stringify(remoteConfig().home)}`);
  check(await page.locator(`.admin-home .admin-home-row[data-key="${key}"] input[type=checkbox]`).isChecked(), W, 'admin: the line toggle did not follow');
  check(await page.evaluate(() => document.querySelector('.admin-home')?.open === true), W, 'admin: the home card closed after a toggle');
  check(await page.evaluate((id) => document.activeElement?.id === id, `admin-home-b-${key.replace('|', '-')}`), W, 'admin: the focus left the toggle');

  // (7) «إخفاء الكنية» from the edit form: no kunya on the person's page nor on their card.
  if (check(!!KUNYA_MAN, W, 'no person with an automatic kunya in the data')) {
    const kid = G.children(KUNYA_MAN).find((x) => x.nameStatus === 'known');
    const kunya = autoKunya(G.person(KUNYA_MAN), 'ar', G);
    await load(page, `#/p/${KUNYA_MAN}`);
    check((await page.locator('.person-nick').innerText().catch(() => '')).includes(kunya), W, `the person page does not show the kunya «${kunya}» first`);
    await page.click('.person-btn-edit');
    await modalOpen(page);
    const box = page.locator('dialog.modal[open] .form-hide-kunya-input');
    check(await box.count() === 1, W, 'no «إخفاء الكنية» checkbox in the edit form');
    check(/إخفاء الكنية/.test(await page.locator('dialog.modal[open] .form-hide-kunya').innerText()), W, 'checkbox label');
    await box.check();
    await page.locator('dialog.modal[open] .form-hide-kunya').scrollIntoViewIfNeeded();
    await shot(page, 'owner-home-4-hide-kunya-form');
    await primaryAction(page).click();
    await modalClosed(page);
    await page.waitForFunction(() => globalThis.__gft.saving.length === 0, null, { timeout: 15000 });
    check(await waitCommits(5), W, `${gh.commitsOf().length - 1} commits after hiding the kunya`);
    const committed = normalizeData(JSON.parse(gh.file('data/family.json'))).people[KUNYA_MAN];
    check(committed?.hideKunya === true, W, 'hideKunya not committed');
    const entry = JSON.parse(gh.file('data/changelog.json')).entries[0];
    check(entry.summary.ar.some((x) => x.startsWith('إخفاء كنية')), W, `changelog line ${JSON.stringify(entry.summary.ar)}`);
    await settle(page);
    check(await page.locator('.person-nick').count() === 0, W, 'the person page still shows a kunya');
    check(!(await page.locator('.person-hero').innerText()).includes(kunya), W, 'the kunya is still in the header');
    await shot(page, 'owner-home-5-kunya-hidden');
    if (kid) {
      await load(page, `#/p/${kid.id}`);
      const card = page.locator(`#app a[href="#/p/${KUNYA_MAN}"]`).first();
      check(await card.count() === 1, W, 'the father card is missing on the child page');
      check(await card.locator('.pname-kunya').count() === 0, W, 'the father card still shows a kunya');
      check(!(await card.innerText()).includes(kunya), W, 'the father card text still has the kunya');
    }
  }
  problemsOf(W, problems);
  await context.close();
});

async function main() {
  await new Promise((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(PORT, '127.0.0.1', resolve); });
  const browser = await chromium.launch();
  const started = Date.now();
  try {
    if (!FLOWS_ONLY) {
      await i18nCheck(browser);
      await routeSweep(browser);
    }
    if (!ROUTES_ONLY) {
      for (const [name, fn] of FLOWS) {
        if (ONLY_FLOW && !name.includes(ONLY_FLOW)) continue;
        console.log(`• flow ${name}`);
        try { await fn(browser); } catch (e) { fail(`flow ${name}`, e.stack || e.message); }
      }
    }
  } finally {
    await browser.close();
    httpServer.close();
  }
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`\nScreenshots: ${SHOTS}`);
  if (failures.length) {
    console.log(`\nFAILED — ${failures.length} problem(s) in ${checks} checks (${secs}s):`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\nOK — ${checks} checks passed (${secs}s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
