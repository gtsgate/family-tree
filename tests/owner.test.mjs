// Owner mode (js/owner.js, docs/SPEC.md §5.1): sign-in checks, direct edits committed through the GitHub API (one commit
// with family.json + changelog.json, parent = the branch head), conflicts re-applied on fresh data, 401 → signed out,
// nothing lost on failures (ops kept in the draft), "Apply now" with its applied.json entry. GitHub is faked
// (tests/fake-github-api.mjs) and injected as fetch.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createFakeGitHub, FAKE_TOKEN } from './fake-github-api.mjs';

// ---------------------------------------------------------------------------------------------------------------
// Browser-ish globals: localStorage (per test), fetch for the site's own files + api.github.com.
class MemoryStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}
Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true });

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const FILES = {
  'data/family.json': read('../data/family.json'),
  'data/changelog.json': read('../data/changelog.json'),
  'data/applied.json': read('../data/applied.json'),
};
const CONFIG = {
  ...JSON.parse(read('../config.json')),
  repo: { owner: 'gtsgate', name: 'family-tree', branch: 'main' },
  portalPath: '',
  approvers: ['GtsGate'], // logins compare case-insensitively
};

let gh = null;
let site = { ...FILES };
const fetchCalls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  fetchCalls.push({ url: u, init });
  if (u.startsWith('https://api.github.com/')) return gh.fetch(u, init);
  const rel = u.replace(/^\.?\//, '').split('?')[0];
  if (rel === 'config.json') return new Response(JSON.stringify(CONFIG), { status: 200 });
  if (site[rel] !== undefined) return new Response(site[rel], { status: 200 });
  return new Response('not found', { status: 404 });
};

const { store } = await import('../js/store.js');
const { owner, verifyToken, planSave, ownerCommitMessage, OWNER_KEY, utf8ToBase64, base64ToUtf8, dataPaths, planHomeConfig, patchHome, configPath, HOME_COMMIT_MESSAGE } = await import('../js/owner.js');
const { normalizeData, serializeData, validateData } = await import('../js/core/schema.js');
const { buildGraph } = await import('../js/core/graph.js');
const { newProposal, proposalHash } = await import('../js/core/ops.js');

const DATA = normalizeData(JSON.parse(FILES['data/family.json']));
const G = buildGraph(DATA);
const REV = DATA.meta.revision;
const people = G.people();
const FATHER = people.find((p) => p.gender === 'm' && !p.deceased && G.children(p.id).length >= 2 && G.spouses(p.id).length === 1 && G.father(p.id)).id;
const LEAF = people.find((p) => !p.deceased && !G.children(p.id).length && G.father(p.id) && p.id !== FATHER).id;

const childOp = (name, of = FATHER) => ({ op: 'add-person', ref: store.newRef(), person: { name: { ar: name }, gender: 'm', birth: { date: '2020' } }, link: { as: 'child', of, with: null }, unionRef: store.newUnionRef() });
const remoteData = () => normalizeData(JSON.parse(gh.file('data/family.json')));
const remoteChangelog = () => JSON.parse(gh.file('data/changelog.json'));
const remoteApplied = () => JSON.parse(gh.file('data/applied.json'));
const byName = (data, name) => Object.values(data.people).find((p) => p.name?.ar === name) || null;
const NEW_NAMES = ['نوفل', 'غيث', 'سلمى', 'حفيد', 'نادر', 'مهيار', 'فراس', 'فارس', 'وضاح', 'تميم', 'قصي', 'ريم', 'زيد'];
for (const n of NEW_NAMES) assert.equal(byName(DATA, n), null, `test name ${n} is already in the data`);

/** Fresh fake GitHub + fresh store/owner state; signed in unless told otherwise. */
async function session({ signedIn = true, fake = {}, keepStorage = false } = {}) {
  if (owner.active()) owner.signOut();
  await owner.idle();
  if (!keepStorage) localStorage.clear();
  gh = createFakeGitHub({ files: FILES, ...fake });
  site = { ...FILES };
  Object.assign(store, { saving: [], aliases: {}, uncertain: [], sent: [], approved: [], justApproved: [], me: null, changelog: null, appliedById: {} });
  store.draft = { ...store.draft, ops: [], dependsOn: [], source: null };
  await store.init();
  owner.configure({ fetch: (u, i) => globalThis.fetch(u, i), sleep: async () => {}, savedMs: 0 });
  owner.takeNotices();
  if (signedIn) {
    const r = await owner.signIn(FAKE_TOKEN);
    assert.equal(r.ok, true, `sign-in failed: ${JSON.stringify(r)}`);
  }
  owner.start();
  await owner.idle();
  gh.log.length = 0;
}

beforeEach(() => { fetchCalls.length = 0; });

// ---------------------------------------------------------------------------------------------------------------
describe('owner: sign-in checks', () => {
  beforeEach(async () => { await session({ signedIn: false }); });

  test('an approver with push access signs in; the token stays on this device and only goes to api.github.com', async () => {
    const r = await owner.signIn(`  ${FAKE_TOKEN}\n`);
    assert.deepEqual(r, { ok: true, login: 'gtsgate' });
    assert.equal(owner.active(), true);
    assert.equal(owner.login, 'gtsgate');
    const saved = JSON.parse(localStorage.getItem(OWNER_KEY));
    assert.equal(saved.token, FAKE_TOKEN);
    assert.equal(saved.login, 'gtsgate');
    const withToken = fetchCalls.filter((c) => JSON.stringify(c.init.headers || {}).includes(FAKE_TOKEN));
    assert.ok(withToken.length >= 3);
    for (const c of withToken) {
      assert.ok(c.url.startsWith('https://api.github.com/'), c.url);
      assert.equal(c.init.headers.Authorization, `Bearer ${FAKE_TOKEN}`);
    }
    for (const c of fetchCalls) assert.ok(!c.url.includes(FAKE_TOKEN), 'the token must never be in a URL');
    // The write check created a blob only: the branch did not move.
    assert.equal(gh.commitsOf().length, 1);
    owner.signOut();
    assert.equal(owner.active(), false);
    assert.equal(localStorage.getItem(OWNER_KEY), null);
  });

  test('a login that is not in config.approvers is refused (and nothing is stored)', async () => {
    gh = createFakeGitHub({ files: FILES, login: 'cousin-sam' });
    const r = await owner.signIn(FAKE_TOKEN);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'notApprover');
    assert.equal(r.login, 'cousin-sam');
    assert.equal(owner.active(), false);
    assert.equal(localStorage.getItem(OWNER_KEY), null);
    assert.ok(!JSON.stringify(r).includes(FAKE_TOKEN));
  });

  test('no push permission → refused; a token that cannot write contents → refused', async () => {
    gh = createFakeGitHub({ files: FILES, push: false });
    assert.equal((await owner.signIn(FAKE_TOKEN)).reason, 'noPush');
    gh = createFakeGitHub({ files: FILES, writable: false });
    assert.equal((await owner.signIn(FAKE_TOKEN)).reason, 'noPush');
    assert.equal(owner.active(), false);
  });

  test('bad, malformed and empty tokens; network failure', async () => {
    assert.equal((await verifyToken('github_pat_11WRONG0TOKEN0abcdefghijklmnop', { config: CONFIG, fetchImpl: gh.fetch })).reason, 'invalid');
    assert.equal((await verifyToken('abc', { config: CONFIG, fetchImpl: gh.fetch })).reason, 'format');
    assert.equal((await verifyToken('has space in it 0123456789', { config: CONFIG, fetchImpl: gh.fetch })).reason, 'format');
    assert.equal((await verifyToken('   ', { config: CONFIG, fetchImpl: gh.fetch })).reason, 'empty');
    gh.failNext(() => true, { network: true });
    assert.equal((await verifyToken(FAKE_TOKEN, { config: CONFIG, fetchImpl: gh.fetch })).reason, 'network');
    gh.failNext(({ path }) => path === '/repos/gtsgate/family-tree', { status: 404, body: { message: 'Not Found' } });
    assert.equal((await verifyToken(FAKE_TOKEN, { config: CONFIG, fetchImpl: gh.fetch })).reason, 'noAccess');
  });

  test('signed out, addOps keeps the visitor flow (draft)', async () => {
    const r = store.addOps([childOp('زيد')]);
    assert.equal(r.ok, true);
    assert.equal(r.saving, undefined);
    assert.equal(store.draft.ops.length, 1);
    assert.equal(store.saving.length, 0);
    await owner.idle();
    assert.equal(gh.log.length, 0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('owner: direct edits', () => {
  beforeEach(async () => { await session(); });

  test('a new child is committed with family.json + changelog.json in ONE commit on top of the head', async () => {
    const head0 = gh.head();
    const op = childOp('نوفل');
    const r = store.addOps([op]);
    assert.equal(r.ok, true);
    assert.equal(r.saving, true);
    assert.equal(store.draft.ops.length, 0, 'nothing goes to the draft');
    assert.equal(store.saving.length, 1);
    assert.ok(store.working.person(op.ref), 'the new child shows at once (preview) while saving');
    assert.equal(store.pendingKind(op.ref), null, 'no "not sent" badge in owner mode');
    await owner.idle();

    const commits = gh.commitsOf();
    assert.equal(commits.length, 2);
    const c = commits[0];
    assert.deepEqual(c.parents, [head0]);
    assert.deepEqual(c.files.sort(), ['data/changelog.json', 'data/family.json']);
    assert.match(c.message, /^family-tree: owner edit \(rev \d+, 1 change\)\n\nGft-Owner-Edit: [a-z0-9]{10}\n$/);
    assert.ok(!c.message.includes('نوفل'), 'no personal text in the commit message');

    const after = remoteData();
    assert.equal(after.meta.revision, REV + 1);
    const kid = byName(after, 'نوفل');
    assert.ok(kid && /^p[a-z0-9]{7}$/.test(kid.id));
    assert.ok(validateData(after).ok);
    assert.equal(gh.file('data/family.json'), serializeData(after), 'canonical formatting (serializeData)');
    const entry = remoteChangelog().entries[0];
    assert.equal(entry.action, 'owner-edit');
    assert.equal(entry.approvedBy, 'gtsgate');
    assert.equal(entry.issue, null);
    assert.equal(entry.rev, REV + 1);
    assert.ok(entry.people.includes(kid.id));
    assert.deepEqual(entry.idMap[op.ref], kid.id);
    assert.match(entry.summary.en[0], /^Add “/);
    assert.ok(entry.summary.ar[0].includes('نوفل'));
    assert.equal(remoteChangelog().entries.length, JSON.parse(FILES['data/changelog.json']).entries.length + 1);

    // Optimistic: the site shows the saved data at once, with real ids; the temp ref follows.
    assert.equal(store.data.meta.revision, REV + 1);
    assert.equal(store.saving.length, 0);
    assert.ok(store.base.person(kid.id));
    assert.equal(store.realId(op.ref), kid.id);
    assert.equal(store.changelog.entries[0].proposalId, entry.proposalId);
    assert.equal(owner.status, 'saved');
    assert.equal(localStorage.getItem('gft.saving.v1'), null);
  });

  test('changes made in the same moment share one commit (refs resolve within it)', async () => {
    const a = childOp('غيث');
    const b = childOp('سلمى');
    b.person.gender = 'f';
    assert.equal(store.addOps([a, b]).saving, true);
    const gc = { op: 'add-person', ref: store.newRef(), person: { name: { ar: 'حفيد' }, gender: 'm' }, link: { as: 'child', of: a.ref, with: null }, unionRef: store.newUnionRef() };
    assert.equal(store.addOps([gc]).saving, true);
    await owner.idle();
    const commits = gh.commitsOf();
    assert.equal(commits.length, 2);
    assert.match(commits[0].message, /\(rev \d+, 3 changes\)/);
    assert.equal(commits[0].message.match(/^Gft-Owner-Edit: /gm).length, 2);
    const d = remoteData();
    assert.deepEqual(buildGraph(d).parents(byName(d, 'حفيد').id).map((p) => p.id), [byName(d, 'غيث').id]);
    assert.equal(d.meta.revision, REV + 2);
    assert.equal(remoteChangelog().entries[0].proposalId, store.changelog.entries[0].proposalId);
  });

  test('a change made while a save is in flight waits, then names the real record', async () => {
    const a = childOp('غيث');
    let gc = null;
    gh.onPatchRef = (n) => {
      if (n !== 1) return;
      // The keeper adds a grandchild while the first save is being committed.
      gc = { op: 'add-person', ref: store.newRef(), person: { name: { ar: 'حفيد' }, gender: 'm' }, link: { as: 'child', of: a.ref, with: null }, unionRef: store.newUnionRef() };
      const r = store.addOps([gc]);
      assert.equal(r.saving, true);
    };
    store.addOps([a]);
    await owner.idle();
    const commits = gh.commitsOf();
    assert.equal(commits.length, 3);
    const d = remoteData();
    const ghaith = byName(d, 'غيث');
    assert.deepEqual(buildGraph(d).parents(byName(d, 'حفيد').id).map((p) => p.id), [ghaith.id]);
    assert.equal(store.realId(a.ref), ghaith.id);
    assert.equal(store.draft.ops.length, 0);
    assert.equal(store.saving.length, 0);
  });

  test('someone else committed meanwhile → the edit is re-applied on the fresh data, parent = their commit', async () => {
    let bot = null;
    gh.onPatchRef = (n) => {
      if (n !== 1) return;
      // The bot applies a relative's proposal between our read and our ref update.
      const d = remoteData();
      d.people[LEAF].occupation = { ar: 'مهندس', en: 'Engineer' };
      d.meta.revision += 1;
      bot = gh.commit({ 'data/family.json': serializeData(d) }, 'family-tree: apply #99');
    };
    store.addOps([childOp('نادر')]);
    await owner.idle();
    assert.equal(gh.patches, 2);
    const commits = gh.commitsOf();
    assert.equal(commits.length, 3);
    assert.deepEqual(commits[0].parents, [bot]);
    const d = remoteData();
    assert.equal(d.people[LEAF].occupation.en, 'Engineer', 'the other change is kept');
    assert.ok(byName(d, 'نادر'), 'ours is applied too');
    assert.equal(d.meta.revision, REV + 2);
    assert.equal(store.data.meta.revision, REV + 2);
  });

  test('401 while saving → signed out on this device, the change is kept in the draft', async () => {
    gh.failNext(({ path }) => path.includes('/git/ref/heads/'), { status: 401, body: { message: 'Bad credentials' } });
    const op = childOp('مهيار');
    store.addOps([op]);
    await owner.idle();
    assert.equal(owner.active(), false);
    assert.equal(localStorage.getItem(OWNER_KEY), null);
    assert.equal(store.saving.length, 0);
    assert.equal(store.draft.ops.length, 1);
    assert.equal(store.draft.ops[0].ref, op.ref);
    assert.ok(store.working.person(op.ref), 'still visible (now as a draft change)');
    assert.equal(store.pendingKind(op.ref), 'draft');
    assert.equal(gh.commitsOf().length, 1);
    assert.ok(owner.takeNotices().some((n) => n.type === 'auth' && !n.home && n.kept === 1), 'a data edit: the usual text (kept in «مقترحي»)');
  });

  test('network failure → kept in the draft; "Save all to the tree" then commits it', async () => {
    gh.failNext(() => true, { network: true });
    store.addOps([childOp('فراس')]);
    await owner.idle();
    assert.equal(owner.active(), true, 'still signed in');
    assert.equal(store.draft.ops.length, 1);
    assert.equal(owner.status, 'error');
    const n = owner.takeNotices().find((x) => x.type === 'failed');
    assert.equal(n.kind, 'network');
    const res = await owner.saveDraft();
    assert.equal(res.ok, true);
    assert.equal(store.draft.ops.length, 0);
    assert.ok(byName(remoteData(), 'فراس'));
    assert.equal(remoteChangelog().entries[0].action, 'owner-edit');
  });

  test('the answer to the commit is lost (it landed): kept in the draft, and "Save all" never applies it twice', async () => {
    gh.failNext(({ method, path }) => method === 'PATCH' && path.includes('/git/refs/'), { network: true, after: true });
    const op = childOp('نادر');
    store.addOps([op]);
    await owner.idle();
    assert.equal(gh.commitsOf().length, 2, 'the commit did land');
    assert.equal(store.draft.ops.length, 1, 'but the site could not know: the change waits in the draft');
    assert.equal(store.uncertain.length, 1);
    const res = await owner.saveDraft();
    assert.equal(res.ok, true);
    assert.equal(gh.commitsOf().length, 2, 'nothing committed twice');
    assert.equal(store.draft.ops.length, 0);
    assert.equal(store.uncertain.length, 0);
    assert.equal(Object.values(remoteData().people).filter((x) => x.name?.ar === 'نادر').length, 1);
    assert.ok(store.base.person(store.realId(op.ref)), 'the site shows the landed change');
  });

  test('refused on the latest data (the parent was removed meanwhile) → errors reported, ops kept in the draft', async () => {
    const d = remoteData();
    d.people[LEAF].removed = { at: new Date().toISOString(), by: 'gtsgate', reasonCode: 'entered-by-mistake', issue: null };
    d.meta.revision += 1;
    gh.commit({ 'data/family.json': serializeData(d) }, 'elsewhere');
    store.addOps([childOp('فارس', LEAF)]);
    await owner.idle();
    assert.equal(store.draft.ops.length, 1);
    const n = owner.takeNotices().find((x) => x.type === 'rejected');
    assert.ok(n && n.errors.some((e) => e.code === 'TARGET_REMOVED'), JSON.stringify(n));
    assert.equal(gh.commitsOf().length, 2, 'nothing committed by us');
    assert.equal(store.data.meta.revision, REV + 1, 'the latest data was adopted');
  });

  test('ops that build on unsaved draft changes join the draft; the draft is saved with one button', async () => {
    owner.signOut();
    const parent = childOp('وضاح');
    store.addOps([parent]);
    await owner.signIn(FAKE_TOKEN);
    await owner.idle();
    const r = store.addOps([childOp('تميم', parent.ref)]);
    assert.equal(r.ok, true);
    assert.equal(r.saving, undefined);
    assert.equal(store.draft.ops.length, 2);
    const res = await owner.saveDraft();
    assert.equal(res.ok, true);
    assert.equal(store.draft.ops.length, 0);
    const d = remoteData();
    const m = byName(d, 'وضاح');
    assert.deepEqual(buildGraph(d).parents(byName(d, 'تميم').id).map((p) => p.id), [m.id]);
    assert.match(gh.commitsOf()[0].message, /2 changes/);
  });

  test('a save interrupted by a reload resumes (and is never applied twice)', async () => {
    const op = childOp('قصي');
    // Simulate: queued, committed, but the page closed before it learned so.
    gh.failNext(({ method, path }) => method === 'PATCH' && path.includes('/git/refs/'), { network: true });
    store.addOps([op]);
    await owner.idle();
    // The ref update "failed" (network): the change is in the draft now. Re-queue it as a reload would find it.
    assert.equal(store.draft.ops.length, 1);
    store.clearDraft();
    const p = newProposal();
    p.ops = [op];
    localStorage.setItem('gft.saving.v1', JSON.stringify([{ id: p.id, at: p.createdAt, proposal: p }]));
    // A reload: a fresh repository, the queue found in localStorage, still signed in → the save resumes by itself.
    await session({ keepStorage: true });
    const d = remoteData();
    assert.ok(byName(d, 'قصي'));
    assert.equal(gh.commitsOf().length, 2);
    // The same proposal again (e.g. another tab) → recognised as saved, no second commit.
    localStorage.setItem('gft.saving.v1', JSON.stringify([{ id: p.id, at: p.createdAt, proposal: p }]));
    store.saving = JSON.parse(localStorage.getItem('gft.saving.v1'));
    owner.start();
    await owner.idle();
    assert.equal(gh.commitsOf().length, 2);
    assert.equal(store.saving.length, 0);
    assert.equal(Object.values(remoteData().people).filter((x) => x.name?.ar === 'قصي').length, 1);
  });

  test('a removal (destructive) applies directly — the keeper is the approver', async () => {
    const leafKid = people.find((x) => !G.children(x.id).length && G.father(x.id) && !x.deceased && x.id !== LEAF && !G.spouses(x.id).length).id;
    const r = store.addOps([{ op: 'remove-person', id: leafKid, reasonCode: 'entered-by-mistake' }]);
    assert.equal(r.saving, true);
    await owner.idle();
    assert.ok(remoteData().people[leafKid].removed);
    assert.equal(remoteChangelog().entries[0].destructive, true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('owner: Apply now (a relative\'s proposal)', () => {
  beforeEach(async () => { await session(); });

  function relativeProposal() {
    const p = newProposal();
    p.submitter = { name: 'سارة', relation: 'ابنة العم', personId: '' };
    p.ops = [{ op: 'add-person', ref: 'new1', person: { name: { ar: 'ريم' }, gender: 'f' }, link: { as: 'child', of: FATHER, with: null }, unionRef: 'newu2' }];
    return p;
  }

  test('committed with an applied.json entry {hash: {issue:null, proposalId, commit, idMap, at}}; a repeat is "already applied"', async () => {
    store.setMe('new1'); // the keeper's own temp refs must not be confused with the relative's
    const p = relativeProposal();
    const hash = await proposalHash(p);
    const res = await owner.applyNow(p);
    assert.equal(res.ok, true, JSON.stringify(res));
    const c = gh.commitsOf()[0];
    assert.deepEqual(c.files.sort(), ['data/applied.json', 'data/changelog.json', 'data/family.json']);
    const ledger = remoteApplied();
    const e = ledger[hash];
    assert.ok(e);
    assert.equal(e.issue, null);
    assert.equal(e.proposalId, p.id);
    assert.equal(e.commit, '');
    const reem = byName(remoteData(), 'ريم');
    assert.equal(e.idMap.new1, reem.id);
    assert.equal(typeof e.at, 'string');
    const entry = remoteChangelog().entries[0];
    assert.equal(entry.action, 'apply');
    assert.equal(entry.hash, hash);
    assert.equal(entry.approvedBy, 'gtsgate');
    assert.equal(entry.submitter.name, 'سارة');
    assert.equal(store.appliedById[p.id].idMap.new1, reem.id);
    assert.equal(store.me, 'new1', 'a relative\'s refs never become the keeper\'s aliases');
    assert.equal(store.realId('new1'), 'new1');

    const again = await owner.applyNow(p);
    assert.equal(again.ok, false);
    assert.equal(again.already, true);
    assert.equal(gh.commitsOf().length, 2);
  });

  test('from a request: the request is closed with a note, label applied, Gft-Apply trailer', async () => {
    const p = relativeProposal();
    const hash = await proposalHash(p);
    const res = await owner.applyNow(p, { issue: 12 });
    assert.equal(res.ok, true);
    assert.equal(res.closed, true);
    const it = gh.issues.get(12);
    assert.equal(it.state, 'closed');
    assert.ok(it.labels.has('applied'));
    assert.equal(it.comments.length, 1);
    assert.ok(!it.comments[0].includes('/'), 'the note never looks like a command');
    assert.match(gh.commitsOf()[0].message, new RegExp(`Gft-Apply: #12 ${hash} rev ${REV + 1}`));
    assert.equal(remoteApplied()[hash].issue, 12);
    assert.equal(remoteChangelog().entries[0].issue, 12);
  });

  test('a corrected proposal in the draft ("Correct this proposal", request #7) → "Save all" applies it and closes #7', async () => {
    const p = relativeProposal();
    store.replaceDraft(p, { source: { issue: 7, hash: await proposalHash(p) } });
    assert.equal(store.draft.ops.length, 1);
    const saved = store.draftProposal();
    const res = await owner.saveDraft();
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(store.draft.ops.length, 0);
    assert.equal(store.draft.source, null);
    const entry = remoteChangelog().entries[0];
    assert.equal(entry.action, 'apply');
    assert.equal(entry.issue, 7);
    assert.equal(entry.proposalId, p.id, 'a correction keeps the proposal id');
    assert.equal(remoteApplied()[await proposalHash(saved)].issue, 7);
    assert.equal(gh.issues.get(7).state, 'closed');
    assert.ok(byName(remoteData(), 'ريم'));
  });

  test('a proposal that does not apply is refused with its errors; nothing is committed', async () => {
    const p = relativeProposal();
    p.ops[0].link.of = 'pzzzzzzz';
    const res = await owner.applyNow(p);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.code === 'UNKNOWN_ID'));
    assert.equal(gh.commitsOf().length, 1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('owner: home-page settings (config.json "home")', () => {
  const CONFIG_TEXT = `${JSON.stringify(CONFIG, null, 2)}\n`;
  const TREE = 'p1aaaaaa';
  const LINE = 'p2bbbbbb|p3cccccc';
  const remoteConfig = () => JSON.parse(gh.file('config.json'));
  beforeEach(async () => { await session({ fake: { files: { ...FILES, 'config.json': CONFIG_TEXT } } }); });

  test('hiding a tree: the page changes at once, then ONE commit that changes only config.json', async () => {
    const events = [];
    const off = store.on('config', () => events.push(JSON.stringify(store.config.home ?? null)));
    const done = owner.saveHome({ hideTrees: [TREE] });
    assert.deepEqual(store.config.home, { hiddenTrees: [TREE] }, 'optimistic: before the commit lands');
    const r = await done;
    off();
    assert.equal(r.ok, true);
    assert.equal(r.committed, true);
    const commits = gh.commitsOf();
    assert.equal(commits.length, 2);
    assert.deepEqual(commits[0].files, ['config.json']);
    assert.equal(commits[0].message, HOME_COMMIT_MESSAGE);
    assert.equal(commits[0].message, 'family-tree: owner home settings\n');
    const cfg = remoteConfig();
    assert.deepEqual(cfg.home, { hiddenTrees: [TREE] });
    // every other setting (and the key order) is kept as it was
    const { home, ...rest } = cfg;
    assert.deepEqual(rest, CONFIG);
    assert.deepEqual(Object.keys(rest), Object.keys(CONFIG));
    assert.ok(gh.file('config.json').endsWith('}\n'));
    assert.deepEqual(events, [JSON.stringify({ hiddenTrees: [TREE] })], 'one change event; the commit confirms it');
    assert.equal(owner.status, 'saved');
  });

  test('show again: the list empties and "home" is dropped; nothing to change → no commit', async () => {
    await owner.saveHome({ hideTrees: [TREE], hideBridges: [LINE] });
    let r = await owner.saveHome({ showTrees: [TREE] });
    assert.equal(r.committed, true);
    assert.deepEqual(remoteConfig().home, { hiddenBridges: [LINE] });
    r = await owner.saveHome({ showBridges: [LINE] });
    assert.equal('home' in remoteConfig(), false);
    assert.equal(store.config.home, undefined);
    assert.equal(gh.file('config.json'), CONFIG_TEXT, 'back to the original text');
    const n = gh.commitsOf().length;
    r = await owner.saveHome({ showTrees: [TREE] });
    assert.deepEqual([r.ok, r.committed], [true, false]);
    assert.equal(gh.commitsOf().length, n);
  });

  test('someone else changed config.json meanwhile → re-read and patched on top (both changes kept)', async () => {
    gh.onPatchRef = (n) => {
      if (n !== 1) return;
      const other = JSON.parse(gh.file('config.json'));
      other.home = { hiddenBridges: [LINE] };
      other.showDivorce = true;
      gh.commit({ 'config.json': `${JSON.stringify(other, null, 2)}\n` }, 'another device');
    };
    const r = await owner.saveHome({ hideTrees: [TREE] });
    assert.equal(r.ok, true);
    assert.equal(gh.patches, 2);
    const cfg = remoteConfig();
    assert.deepEqual(cfg.home, { hiddenBridges: [LINE], hiddenTrees: [TREE] });
    assert.equal(cfg.showDivorce, true);
    assert.deepEqual(store.config.home, { hiddenBridges: [LINE], hiddenTrees: [TREE] }, 'the page follows the repository');
    const commits = gh.commitsOf();
    assert.equal(commits[0].parents[0], commits[1].sha);
    assert.deepEqual(commits[0].files, ['config.json']);
  });

  test('401 → signed out on this device, the page goes back, nothing committed', async () => {
    gh.failNext(({ path }) => path.includes('/git/ref/heads/'), { status: 401, body: { message: 'Bad credentials' } });
    const done = owner.saveHome({ hideTrees: [TREE] });
    assert.deepEqual(store.config.home, { hiddenTrees: [TREE] });
    const r = await done;
    assert.deepEqual(r, { ok: false, error: { kind: 'auth' } });
    assert.equal(owner.active(), false);
    assert.equal(localStorage.getItem(OWNER_KEY), null);
    assert.equal(store.config.home, undefined);
    assert.equal(gh.commitsOf().length, 1);
    // the dialog says the home page was not changed (nothing went to «مقترحي»)
    assert.ok(owner.takeNotices().some((n) => n.type === 'auth' && n.home === true && !n.kept));
  });

  test('403 → the forbidden explanation; network → an error, still signed in; the page goes back each time', async () => {
    gh.failNext(({ method }) => method === 'POST', { status: 403, body: { message: 'Resource not accessible by personal access token' } });
    let r = await owner.saveHome({ hideTrees: [TREE] });
    assert.equal(r.error.kind, 'forbidden');
    assert.equal(store.config.home, undefined);
    assert.ok(owner.takeNotices().some((n) => n.type === 'forbidden' && n.home === true && !n.kept));
    assert.equal(owner.active(), true, '403 does not sign out');
    gh.failNext(() => true, { network: true });
    r = await owner.saveHome({ hideBridges: [LINE] });
    assert.deepEqual(r, { ok: false, error: { kind: 'network' } });
    assert.equal(store.config.home, undefined);
    assert.equal(owner.active(), true);
    assert.equal(owner.status, 'error');
    assert.equal(gh.commitsOf().length, 1);
    r = await owner.saveHome({ hideBridges: [LINE] });
    assert.equal(r.ok, true, 'works again afterwards');
  });

  test('a signed-in device adopts the repository\'s settings on load (GitHub Pages may still serve the old config.json)', async () => {
    const other = JSON.parse(gh.file('config.json'));
    other.home = { hiddenTrees: [TREE] };
    gh.commit({ 'config.json': `${JSON.stringify(other, null, 2)}\n` }, 'another device');
    assert.equal(store.config.home, undefined);
    await owner.refresh();
    assert.deepEqual(store.config.home, { hiddenTrees: [TREE] });
  });

  test('…even when reading the data fails at that moment (each read on its own)', async () => {
    const other = JSON.parse(gh.file('config.json'));
    other.home = { hiddenBridges: [LINE] };
    gh.commit({ 'config.json': `${JSON.stringify(other, null, 2)}\n` }, 'another device');
    gh.failNext(({ path }) => path.includes('family.json'), { status: 500, body: { message: 'Server Error' } });
    await owner.refresh();
    assert.deepEqual(store.config.home, { hiddenBridges: [LINE] });
    assert.equal(owner.active(), true);
  });

  test('pure: patchHome / planHomeConfig', () => {
    assert.equal(patchHome(undefined, {}), undefined);
    assert.deepEqual(patchHome({ hiddenTrees: [TREE], other: 1 }, { hideTrees: [TREE, 'bad id', 'new3'], hideBridges: [LINE, 'p1|p2', 'pa111|pb222|pc333'] }),
      { hiddenTrees: [TREE], other: 1, hiddenBridges: [LINE] }, 'malformed ids are never written');
    assert.equal(patchHome({ hiddenTrees: [TREE] }, { showTrees: [TREE] }), undefined);
    const plan = planHomeConfig(CONFIG_TEXT, { hideTrees: [TREE] });
    assert.equal(plan.changed, true);
    assert.equal(plan.text, `${JSON.stringify({ ...CONFIG, home: { hiddenTrees: [TREE] } }, null, 2)}\n`);
    assert.equal(planHomeConfig(plan.text, { hideTrees: [TREE] }).changed, false);
    assert.throws(() => planHomeConfig('{oops', {}), /GitHub http/);
    assert.equal(configPath({ portalPath: '' }), 'config.json');
    assert.equal(configPath({ portalPath: 'family-tree' }), 'family-tree/config.json');
  });

  test('signed out: nothing is saved and the page does not change', async () => {
    owner.signOut();
    const r = await owner.saveHome({ hideTrees: [TREE] });
    assert.deepEqual(r, { ok: false, error: { kind: 'auth' } });
    assert.equal(store.config.home, undefined);
  });
});

describe('owner: pure helpers', () => {
  test('base64 round-trip keeps Arabic text intact', () => {
    const s = 'شجرة العائلة — Family 🌳 '.repeat(5000);
    assert.equal(base64ToUtf8(utf8ToBase64(s)), s);
    assert.equal(base64ToUtf8(utf8ToBase64(s).replace(/.{60}/g, '$&\n')), s);
  });

  test('data paths follow config.portalPath', () => {
    assert.equal(dataPaths({ portalPath: '' }).data, 'data/family.json');
    assert.equal(dataPaths({ portalPath: 'family-tree/' }).changelog, 'family-tree/data/changelog.json');
    assert.equal(dataPaths({}).applied, 'family-tree/data/applied.json');
  });

  test('planSave: per-proposal changelog entries newest first, trimmed to 500; message with counts and trailers only', () => {
    const changelog = { entries: Array.from({ length: 500 }, (_, i) => ({ issue: i + 1, proposalId: `old${i}xxxx`, at: '2020-01-01', action: 'apply' })) };
    const mk = (name) => { const p = newProposal(); p.ops = [{ op: 'add-person', ref: 'new7', person: { name: { ar: name, en: 'Closes #1' }, gender: 'm' }, link: { as: 'child', of: FATHER, with: null } }]; return p; };
    const a = mk('أ');
    const b = mk('ب');
    b.ops[0].ref = 'new8';
    const plan = planSave({ data: JSON.parse(FILES['data/family.json']), changelog, applied: {} },
      [{ id: a.id, kind: 'edit', proposal: a }, { id: b.id, kind: 'edit', proposal: b }], { actor: 'gtsgate', now: '2026-01-01T00:00:00.000Z' });
    assert.equal(plan.ok, true);
    assert.equal(plan.changelog.entries.length, 500);
    assert.equal(plan.changelog.entries[0].proposalId, b.id);
    assert.equal(plan.changelog.entries[1].proposalId, a.id);
    assert.equal(plan.texts.applied, null, 'owner edits do not touch applied.json');
    assert.equal(plan.message, `family-tree: owner edit (rev ${REV + 2}, 2 changes)\n\nGft-Owner-Edit: ${a.id}\nGft-Owner-Edit: ${b.id}\n`);
    assert.ok(!plan.message.includes('Closes'));
    assert.equal(ownerCommitMessage([{ item: { proposal: { id: 'BAD ID!', ops: [1] } }, rev: 3 }]), 'family-tree: owner edit (rev 3, 1 change)\n\nGft-Owner-Edit: unknown\n');
  });
});
