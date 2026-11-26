// Owner mode (docs/SPEC.md §5.1, §7.8): the tree keeper — a GitHub login listed in config.approvers — signs in once
// per device with a fine-grained personal access token and then edits the tree DIRECTLY: every change is committed to
// the repository through the GitHub REST API, with no proposal and no approval step.
//
//   verifyToken(token, {config, fetchImpl})   → {ok, login} | {ok:false, reason, login?}
//   createApi({token, config, fetchImpl})      tiny GitHub client (contents + Git Data + issues)
//   planSave(files, items, opts)               pure: apply items to the repository's files → new files + commit message
//   saveItems(api, items, opts)                read the branch head → plan → ONE commit (blobs → tree → commit → ref),
//                                              re-reading and re-applying on a non-fast-forward (≤ SAVE_TRIES tries)
//   owner                                      the controller: credentials, the save queue (one save at a time),
//                                              "Save all to the tree" (the draft), "Apply now" (a relative's proposal)
//
// No DOM here (the interface is js/owner-ui.js), so Node tests drive it with an injected fetch.
// Security: the token stays in this device's localStorage (gft.owner.v1) and is sent nowhere but api.github.com, in the
// Authorization header (never in a URL). It never appears in errors, notices or logs: GitHubError carries only a kind,
// the HTTP status and GitHub's short message.
import { store } from './store.js';
import { applyProposal, opRefs, proposalHash } from './core/ops.js';
import { normalizeData, serializeData } from './core/schema.js';
import { buildGraph } from './core/graph.js';
import { describeProposal } from './core/describe.js';

export const OWNER_KEY = 'gft.owner.v1';
export const API_ROOT = 'https://api.github.com';
export const CHANGELOG_MAX = 500;
export const SAVE_TRIES = 4;
const PROPOSAL_ID = /^[a-z0-9]{4,32}$/;
const SHA_RE = /^[0-9a-f]{40,64}$/;
/** Fine-grained ("github_pat_…") and classic ("ghp_…") tokens: letters, digits and underscores. */
const TOKEN_RE = /^[A-Za-z0-9_\-.]{20,255}$/;
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// ---------------------------------------------------------------------------------------------------------------
// Encoding (the contents API speaks base64; family.json is UTF-8 with Arabic)

export function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(String(text ?? ''));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToUtf8(b64) {
  const bin = atob(String(b64 ?? '').replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration helpers

export function repoOf(config) {
  const r = config?.repo || {};
  return { owner: String(r.owner || ''), name: String(r.name || ''), branch: String(r.branch || 'main') };
}

/** Repository paths of the data files ("" portalPath = the portal is the repository root). */
export function dataPaths(config) {
  const raw = config && 'portalPath' in config ? String(config.portalPath || '') : 'family-tree';
  const p = raw.replace(/^[./]+|\/+$/g, '');
  const pre = p ? `${p}/` : '';
  return { data: `${pre}data/family.json`, changelog: `${pre}data/changelog.json`, applied: `${pre}data/applied.json` };
}

export function isApprover(login, config) {
  const l = String(login || '').toLowerCase();
  return !!l && (Array.isArray(config?.approvers) ? config.approvers : []).some((a) => String(a).toLowerCase() === l);
}

// ---------------------------------------------------------------------------------------------------------------
// GitHub client

/**
 * kind: network | auth (401: bad or expired token) | forbidden (403: the token lacks a permission, or a protected
 * branch) | rateLimit | notFound | conflict (the branch moved: not a fast-forward) | http (anything else).
 */
export class GitHubError extends Error {
  constructor(kind, status = 0, detail = '') {
    super(`GitHub ${kind}${status ? ` (${status})` : ''}`);
    this.name = 'GitHubError';
    this.kind = kind;
    this.status = status;
    this.detail = String(detail || '').slice(0, 200);
  }
}

function errorFor(res, json) {
  const msg = typeof json?.message === 'string' ? json.message : '';
  const s = res.status;
  if (s === 401) return new GitHubError('auth', s, msg);
  if (s === 403 || s === 429) {
    const remaining = res.headers?.get?.('x-ratelimit-remaining');
    if (s === 429 || remaining === '0' || /rate limit/i.test(msg)) return new GitHubError('rateLimit', s, msg);
    return new GitHubError('forbidden', s, msg);
  }
  if (s === 404) return new GitHubError('notFound', s, msg);
  return new GitHubError('http', s, msg);
}

const encPath = (p) => String(p).split('/').map(encodeURIComponent).join('/');

export function createApi({ token, config, fetchImpl = null }) {
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const { owner, name } = repoOf(config);
  const repo = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  async function call(method, path, body) {
    // Never a cached answer: a stale branch head would make every commit a non-fast-forward.
    const init = { method, cache: 'no-store', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` } };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let res;
    try { res = await doFetch(`${API_ROOT}${path}`, init); } catch { throw new GitHubError('network'); }
    let json = null;
    try {
      const text = await res.text();
      json = text ? JSON.parse(text) : null;
    } catch { json = null; }
    if (res.ok) return json;
    throw errorFor(res, json);
  }

  async function head(branch) {
    const r = await call('GET', `${repo}/git/ref/heads/${encPath(branch)}`);
    const sha = r?.object?.sha;
    if (typeof sha !== 'string' || !SHA_RE.test(sha)) throw new GitHubError('http', 0, 'unexpected ref');
    return sha;
  }

  /** Text of a file at a commit, or null when it does not exist. */
  async function readFile(path, ref) {
    let r;
    try {
      r = await call('GET', `${repo}/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`);
    } catch (e) {
      if (e.kind === 'notFound') return null;
      throw e;
    }
    if (!isObj(r) || (r.type && r.type !== 'file')) throw new GitHubError('http', 0, 'not a file');
    if (typeof r.content === 'string' && r.content && r.encoding === 'base64') return base64ToUtf8(r.content);
    // Files over 1 MB come without content: read the blob.
    const b = await call('GET', `${repo}/git/blobs/${encodeURIComponent(r.sha)}`);
    return base64ToUtf8(b?.content || '');
  }

  const createBlob = (text) => call('POST', `${repo}/git/blobs`, { content: utf8ToBase64(text), encoding: 'base64' });

  /** ONE commit with `files` ({path: text}) on top of `head`, then move the branch (fast-forward only). → sha */
  async function commitFiles({ branch, head: parent, files, message }) {
    const base = await call('GET', `${repo}/git/commits/${encodeURIComponent(parent)}`);
    const baseTree = base?.tree?.sha;
    if (!baseTree) throw new GitHubError('http', 0, 'unexpected commit');
    const tree = [];
    for (const [path, text] of Object.entries(files)) {
      const blob = await createBlob(text);
      tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const newTree = await call('POST', `${repo}/git/trees`, { base_tree: baseTree, tree });
    const commit = await call('POST', `${repo}/git/commits`, { message, tree: newTree.sha, parents: [parent] });
    try {
      await call('PATCH', `${repo}/git/refs/heads/${encPath(branch)}`, { sha: commit.sha, force: false });
    } catch (e) {
      if (e.status === 409 || e.status === 422) throw new GitHubError('conflict', e.status, e.detail);
      throw e;
    }
    return commit.sha;
  }

  return {
    user: () => call('GET', '/user'),
    repo: () => call('GET', repo),
    head,
    readFile,
    createBlob,
    commitFiles,
    comment: (n, body) => call('POST', `${repo}/issues/${Number(n)}/comments`, { body }),
    addLabels: (n, labels) => call('POST', `${repo}/issues/${Number(n)}/labels`, { labels }),
    closeIssue: (n) => call('PATCH', `${repo}/issues/${Number(n)}`, { state: 'closed', state_reason: 'completed' }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Sign-in

/**
 * Check a token: GET /user (the login must be an approver), GET /repos/{repo} (access; push when GitHub reports the
 * permissions), then create an unreferenced blob — invisible, it proves the token may write contents.
 * → {ok:true, login} | {ok:false, reason: empty|format|invalid|notApprover|noAccess|noPush|rateLimit|network|http, login?}
 */
export async function verifyToken(rawToken, { config, fetchImpl = null } = {}) {
  const token = String(rawToken ?? '').trim();
  if (!token) return { ok: false, reason: 'empty' };
  if (!TOKEN_RE.test(token)) return { ok: false, reason: 'format' };
  const api = createApi({ token, config, fetchImpl });
  const why = (e, fallback) => (e?.kind === 'auth' ? 'invalid' : e?.kind === 'network' ? 'network' : e?.kind === 'rateLimit' ? 'rateLimit' : fallback);
  let user;
  try { user = await api.user(); } catch (e) { return { ok: false, reason: why(e, 'http') }; }
  const login = typeof user?.login === 'string' ? user.login : '';
  if (!login) return { ok: false, reason: 'http' };
  if (!isApprover(login, config)) return { ok: false, reason: 'notApprover', login };
  let repo;
  try { repo = await api.repo(); } catch (e) { return { ok: false, reason: why(e, ['notFound', 'forbidden'].includes(e?.kind) ? 'noAccess' : 'http'), login }; }
  const perms = isObj(repo?.permissions) ? repo.permissions : null;
  if (perms && !perms.push && !perms.maintain && !perms.admin) return { ok: false, reason: 'noPush', login };
  try {
    await api.createBlob('family-tree owner mode: write check\n');
  } catch (e) {
    return { ok: false, reason: why(e, ['notFound', 'forbidden'].includes(e?.kind) ? 'noPush' : 'http'), login };
  }
  return { ok: true, login };
}

// ---------------------------------------------------------------------------------------------------------------
// Planning a save (pure)

/** proposalId → first applied (not undone) ledger entry (+ hash) — as the bot resolves dependsOn (SPEC §6.6). */
export function appliedIndex(applied) {
  const byId = new Map();
  for (const [hash, e] of Object.entries(isObj(applied) ? applied : {})) {
    if (!isObj(e) || e.undone || !e.proposalId) continue;
    const prev = byId.get(e.proposalId);
    if (!prev || String(e.at || '') < String(prev.at || '')) byId.set(e.proposalId, { ...e, hash });
  }
  return byId;
}

function depsFor(proposal, index, batch) {
  const refMap = {};
  const appliedDeps = [];
  for (const id of Array.isArray(proposal?.dependsOn) ? proposal.dependsOn : []) {
    const e = batch.get(id) || index.get(id);
    if (!e) continue;
    Object.assign(refMap, e.idMap || {});
    appliedDeps.push(id);
  }
  return { refMap, appliedDeps };
}

/** For the description only: used temp refs that refMap resolves → the real records' ids (as the bot shows them). */
function shownProposal(p, refMap) {
  const keys = Object.keys(refMap || {});
  if (!keys.length) return p;
  const declared = new Set(p.ops.flatMap((op) => opRefs(op).declares));
  const KEEP = new Set(['person', 'set', 'before', 'ref', 'unionRef', 'note', 'marriage']);
  const swap = (v, uses) => {
    if (typeof v === 'string') return uses.has(v) ? refMap[v] : v;
    if (Array.isArray(v)) return v.map((x) => swap(x, uses));
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x, uses)]));
    return v;
  };
  return {
    ...p,
    ops: p.ops.map((op) => {
      const uses = new Set(opRefs(op).uses.filter((u) => !declared.has(u) && hasOwn(refMap, u)));
      return uses.size ? Object.fromEntries(Object.entries(op).map(([k, x]) => [k, KEEP.has(k) ? x : swap(x, uses)])) : op;
    }),
  };
}

/**
 * The commit message: counts, the revision, proposal ids and trailers ONLY — never proposal text (a name such as
 * "Closes #1" in a commit on the default branch would close issue #1; SPEC §6.3).
 */
export function ownerCommitMessage(ok) {
  const rev = Number(ok[ok.length - 1]?.rev) || 0;
  const k = ok.reduce((n, o) => n + (Number(o.item.proposal?.ops?.length) || 0), 0);
  const trailers = [];
  for (const o of ok) {
    const id = PROPOSAL_ID.test(String(o.item.proposal?.id || '')) ? o.item.proposal.id : 'unknown';
    trailers.push(`Gft-Owner-Edit: ${id}`);
    const n = Number(o.item.issue);
    if (o.item.kind === 'apply' && Number.isInteger(n) && n > 0 && /^[0-9a-f]{64}$/.test(String(o.item.hash || ''))) {
      trailers.push(`Gft-Apply: #${n} ${o.item.hash} rev ${Number(o.rev)}`);
    }
  }
  return `family-tree: owner edit (rev ${rev}, ${k} change${k === 1 ? '' : 's'})\n\n${trailers.join('\n')}\n`;
}

/**
 * Apply `items` in order to the repository's files (final mode, the keeper is the approver: destructive allowed).
 *   files = {data, changelog, applied} (parsed JSON); items = [{id, kind: 'edit'|'apply', proposal, hash?, issue?}]
 *   'edit'  = the keeper's own change: changelog action "owner-edit" (with its idMap); already saved when the
 *             changelog lists its proposal id (a retry after a lost answer, or another tab).
 *   'apply' = a relative's proposal applied directly ("Apply now", or a corrected one saved from the draft):
 *             changelog action "apply" + applied.json {hash: {issue, proposalId, commit, idMap, at, rev}}, so the bot
 *             treats the same proposal arriving later as already applied.
 * → {ok (anything to commit), results: [{item, ok, already?, errors?, warnings, idMap, rev, people}], data, changelog,
 *    applied, texts: {data, changelog, applied|null} | null, message | null}
 */
export function planSave(files, items, { actor = '', now = new Date().toISOString(), aliases = {} } = {}) {
  let cur = files.data;
  const entries = Array.isArray(files.changelog?.entries) ? files.changelog.entries.slice() : [];
  const ledger = isObj(files.applied) ? { ...files.applied } : {};
  let ledgerChanged = false;
  const index = appliedIndex(ledger);
  const batch = new Map(); // proposalId → {idMap, hash, issue} of items planned earlier in this save
  const batchRefs = {}; // temp refs of the keeper's edits planned earlier → real ids
  const results = [];
  const fresh = [];
  for (const item of items) {
    const p = item.proposal;
    const kind = item.kind === 'apply' ? 'apply' : 'edit';
    const issue = Number.isInteger(Number(item.issue)) && Number(item.issue) > 0 ? Number(item.issue) : null;
    if (kind === 'edit') {
      const done = entries.find((e) => isObj(e) && e.proposalId === p.id && e.action === 'owner-edit');
      if (done) {
        const idMap = isObj(done.idMap) ? done.idMap : {};
        Object.assign(batchRefs, idMap);
        results.push({ item, ok: false, already: true, idMap, rev: done.rev, warnings: [] });
        continue;
      }
    } else {
      const done = item.hash && isObj(ledger[item.hash]) && !ledger[item.hash].undone ? ledger[item.hash] : null;
      if (done) {
        results.push({ item, ok: false, already: true, issue: done.issue ?? null, idMap: isObj(done.idMap) ? done.idMap : {}, rev: done.rev, warnings: [] });
        continue;
      }
      // Proposal ids are public: one already applied under another hash is refused (as the bot does).
      const prev = index.get(p.id) || batch.get(p.id);
      if (prev && prev.hash && prev.hash !== item.hash) {
        results.push({ item, ok: false, errors: [{ code: 'PROPOSAL_ID_REUSED', params: { proposalId: p.id, issue: prev.issue ?? null } }], warnings: [] });
        continue;
      }
    }
    const deps = depsFor(p, index, batch);
    // A relative's proposal has its own temp refs: only its dependsOn resolve them (the keeper's refs could clash).
    const refMap = kind === 'edit' ? { ...aliases, ...batchRefs, ...deps.refMap } : deps.refMap;
    const r = applyProposal(cur, p, {
      mode: 'final', now, issue, actor, allowDestructive: true, refMap, appliedDeps: deps.appliedDeps,
    });
    if (!r.ok) {
      results.push({ item, ok: false, errors: r.errors, warnings: r.warnings });
      continue;
    }
    const before = cur;
    cur = r.data;
    if (kind === 'edit') Object.assign(batchRefs, r.idMap);
    batch.set(p.id, { idMap: r.idMap, hash: item.hash || '', issue });
    const g = buildGraph(normalizeData(before));
    const shown = shownProposal(p, refMap);
    const en = describeProposal(shown, g, 'en');
    const ar = describeProposal(shown, g, 'ar');
    const rev = r.data.meta.revision;
    const people = [...new Set([...r.created.people, ...r.touched.people])].filter((id) => cur.people[id] && !cur.people[id].removed);
    const s = p.submitter || {};
    const entry = {
      issue, proposalId: p.id || '', hash: item.hash || '', commit: '', rev, at: now, title: en.title,
      summary: { en: en.lines.slice(0, 150), ar: ar.lines.slice(0, 150) },
      submitter: kind === 'apply' ? { name: String(s.name || ''), relation: String(s.relation || '') } : { name: '', relation: '' },
      approvedBy: actor, people,
      touched: {
        people: [...new Set([...r.touched.people, ...r.created.people])],
        unions: [...new Set([...r.touched.unions, ...r.created.unions])],
      },
      destructive: !!r.destructive, action: kind === 'apply' ? 'apply' : 'owner-edit',
    };
    if (kind === 'edit' && Object.keys(r.idMap).length) entry.idMap = r.idMap;
    fresh.push(entry);
    if (kind === 'apply' && item.hash) {
      ledger[item.hash] = { issue, proposalId: p.id || '', commit: '', idMap: r.idMap, at: now, rev };
      ledgerChanged = true;
    }
    results.push({ item, ok: true, idMap: r.idMap, rev, warnings: r.warnings, destructive: !!r.destructive, people });
  }
  for (const e of fresh) entries.unshift(e); // newest first
  const changelog = { entries: entries.slice(0, CHANGELOG_MAX) };
  const ok = results.filter((x) => x.ok);
  return {
    ok: ok.length > 0,
    results,
    data: cur,
    changelog,
    applied: ledger,
    texts: ok.length ? {
      data: serializeData(cur),
      changelog: `${JSON.stringify(changelog, null, 2)}\n`,
      applied: ledgerChanged ? `${JSON.stringify(ledger, null, 2)}\n` : null,
    } : null,
    message: ok.length ? ownerCommitMessage(ok) : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Saving (network)

const defaultSleep = (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); t?.unref?.(); });
const backoffMs = (attempt) => 1000 * 2 ** (attempt - 1);

function parseJSON(text, fallback) {
  if (text === null || text === undefined || !String(text).trim()) return fallback;
  try { return JSON.parse(text); } catch { throw new GitHubError('http', 0, 'unreadable data file'); }
}

/** The repository's data files at the branch head → {head, files: {data, changelog, applied}}. */
export async function readLatest(api, config) {
  const { branch } = repoOf(config);
  const paths = dataPaths(config);
  const head = await api.head(branch);
  const [d, c, a] = await Promise.all([api.readFile(paths.data, head), api.readFile(paths.changelog, head), api.readFile(paths.applied, head)]);
  if (d === null) throw new GitHubError('http', 404, 'family.json not found');
  const changelog = parseJSON(c, { entries: [] });
  const applied = parseJSON(a, {});
  return {
    head,
    files: {
      data: parseJSON(d, null),
      changelog: isObj(changelog) && Array.isArray(changelog.entries) ? changelog : { entries: [] },
      applied: isObj(applied) ? applied : {},
    },
  };
}

/**
 * Read the latest files at the branch head, plan, commit once (family.json + changelog.json [+ applied.json]) with
 * parent = that head. A non-fast-forward (someone else committed meanwhile) → wait, re-read, re-apply on the fresh
 * data (≤ tries). → {committed, sha?, head, attempt, plan}. Throws GitHubError (network, auth, forbidden, conflict…).
 */
export async function saveItems(api, items, { config, actor = '', now = () => new Date().toISOString(), sleep = defaultSleep, aliases = {}, tries = SAVE_TRIES } = {}) {
  const { branch } = repoOf(config);
  const paths = dataPaths(config);
  let last = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    const { head, files } = await readLatest(api, config);
    const plan = planSave(files, items, { actor, now: now(), aliases });
    if (!plan.ok) return { committed: false, head, attempt, plan };
    const out = { [paths.data]: plan.texts.data, [paths.changelog]: plan.texts.changelog };
    if (plan.texts.applied !== null) out[paths.applied] = plan.texts.applied;
    try {
      const sha = await api.commitFiles({ branch, head, files: out, message: plan.message });
      return { committed: true, sha, head, attempt, plan };
    } catch (e) {
      if (e?.kind !== 'conflict' || attempt >= tries) throw e;
      last = e;
      await sleep(backoffMs(attempt));
    }
  }
  throw last || new GitHubError('conflict');
}

/** Bilingual note posted on a request applied directly (no "/" anywhere: it must never look like a command). */
export function appliedRequestComment({ rev, sha }) {
  const short = String(sha || '').slice(0, 7);
  return [
    `✅ طبّق المشرف هذا المقترح مباشرةً من الموقع (نسخة الشجرة ${Number(rev) || 0}${short ? `، الإيداع ${short}` : ''}). شكراً لكم.`,
    '',
    `✅ The keeper applied this proposal directly from the site (tree revision ${Number(rev) || 0}${short ? `, commit ${short}` : ''}). Thank you.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Controller

const env = {
  fetch: null, // null → globalThis.fetch
  sleep: defaultSleep,
  now: () => new Date().toISOString(),
  savedMs: 6000,
};

let creds = null; // {token, login}
const jobs = []; // {kind:'edit', ids} | {kind:'draft'} | {kind:'apply', proposal, hash, issue, resolve}
let running = null;
let savedTimer = null;
let started = false;

function readCreds(config) {
  try {
    const v = JSON.parse(localStorage.getItem(OWNER_KEY) || 'null');
    if (isObj(v) && typeof v.token === 'string' && v.token && typeof v.login === 'string') {
      if (isApprover(v.login, config)) return { token: v.token, login: v.login };
      localStorage.removeItem(OWNER_KEY); // no longer an approver: do not keep the key around
    }
  } catch { /* unavailable */ }
  return null;
}
function writeCreds(c) {
  try {
    if (c) localStorage.setItem(OWNER_KEY, JSON.stringify({ v: 1, token: c.token, login: c.login, at: env.now() }));
    else localStorage.removeItem(OWNER_KEY);
  } catch { /* unavailable */ }
}

const api = () => createApi({ token: creds?.token || '', config: store.config, fetchImpl: env.fetch });

function setStatus(status, extra = {}) {
  owner.status = status;
  Object.assign(owner, extra);
  if (savedTimer) { clearTimeout(savedTimer); savedTimer = null; }
  if (status === 'saved' && env.savedMs > 0) {
    savedTimer = setTimeout(() => { savedTimer = null; if (owner.status === 'saved') { owner.status = 'idle'; store.emit('owner'); } }, env.savedMs);
    savedTimer?.unref?.();
  }
  store.emit('owner');
}

function notice(n) {
  owner.notices.push(n);
  if (owner.notices.length > 20) owner.notices.splice(0, owner.notices.length - 20);
}

function saveOpts() {
  return { config: store.config, actor: creds?.login || '', now: env.now, sleep: env.sleep, aliases: store.aliases };
}

/** Apply a save's outcome to the store. → {done, failed} results */
function adopt(res, { draftSaved = null } = {}) {
  const results = res.plan.results;
  const done = results.filter((r) => r.ok || r.already);
  const failed = results.filter((r) => !r.ok && !r.already);
  // Only the keeper's own temp refs become aliases (a relative's refs come from another device's counter).
  const idMap = Object.assign({}, ...done.filter((r) => r.item.own).map((r) => r.idMap || {}));
  const draftDone = draftSaved && done.length ? draftSaved : null;
  store.finishSave({
    data: res.plan.data, changelog: res.plan.changelog, applied: res.plan.applied,
    savedIds: done.filter((r) => r.item.kind !== 'apply').map((r) => r.item.id), idMap, draftSaved: draftDone,
  });
  if (res.committed) owner.lastSaved = { rev: Number(res.plan.data?.meta?.revision) || 0, sha: res.sha, at: env.now() };
  return { done, failed };
}

/** Best effort: comment, label `applied`, close — the request was applied directly. → true when closed. */
async function closeRequest(n, { rev, sha }) {
  try {
    const a = api();
    await a.comment(n, appliedRequestComment({ rev, sha }));
    await a.addLabels(n, ['applied']);
    await a.closeIssue(n);
    return true;
  } catch {
    return false;
  }
}

async function runJob(job) {
  if (job.kind === 'refresh') {
    try {
      await catchUp();
    } catch (e) {
      if (e?.kind === 'auth') throw e; // the token no longer works: sign out (giveUp)
    }
    return;
  }
  if (job.kind === 'edit') {
    const items = store.saving.filter((s) => job.ids.includes(s.id)).map((s) => ({ id: s.id, kind: 'edit', proposal: s.proposal, own: true }));
    if (!items.length) return;
    const res = await saveItems(api(), items, saveOpts());
    const { failed } = adopt(res);
    if (failed.length) {
      store.moveSavingToDraft(failed.map((r) => r.item.id));
      notice({ type: 'rejected', errors: failed[0].errors || [], proposal: failed[0].item.proposal, kept: 'draft' });
    }
    if (res.committed && !failed.length) setStatus('saved', { lastError: null });
    else if (failed.length) setStatus('error', { lastError: { kind: 'rejected' } });
    return;
  }
  if (job.kind === 'draft') {
    // A save interrupted earlier may have landed: never apply its ops twice.
    if (store.uncertain.length) await catchUp();
    const p = store.draftProposal();
    if (!p.ops.length) { job.resolve?.({ ok: true, rev: store.data?.meta?.revision ?? 0, sha: '' }); return; }
    const src = store.draft.source || null;
    const issue = Number(src?.issue) > 0 ? Number(src.issue) : null;
    const item = src
      ? { id: p.id, kind: 'apply', proposal: p, hash: await proposalHash(p), issue, own: true }
      : { id: p.id, kind: 'edit', proposal: p, own: true };
    const res = await saveItems(api(), [item], saveOpts());
    const r = res.plan.results[0];
    adopt(res, { draftSaved: { id: p.id, ops: p.ops } });
    if (r.ok || r.already) {
      if (r.ok && issue) await closeRequest(issue, { rev: r.rev, sha: res.sha });
      setStatus('saved', { lastError: null });
      job.resolve?.({ ok: true, rev: r.rev, sha: res.sha || '' });
    } else {
      notice({ type: 'rejected', errors: r.errors || [], proposal: p, kept: 'draft' });
      setStatus('error', { lastError: { kind: 'rejected' } });
      job.resolve?.({ ok: false, errors: r.errors || [] });
    }
    return;
  }
  if (job.kind === 'apply') {
    const item = { id: job.proposal.id, kind: 'apply', proposal: job.proposal, hash: job.hash, issue: job.issue };
    const res = await saveItems(api(), [item], saveOpts());
    const r = res.plan.results[0];
    adopt(res);
    if (r.ok) {
      const closed = job.issue ? await closeRequest(job.issue, { rev: r.rev, sha: res.sha }) : false;
      setStatus('saved', { lastError: null });
      job.resolve({ ok: true, rev: r.rev, sha: res.sha, people: r.people || [], closed });
    } else if (r.already) {
      setStatus('idle');
      job.resolve({ ok: false, already: true, issue: r.issue ?? null });
    } else {
      setStatus('idle');
      job.resolve({ ok: false, errors: r.errors || [] });
    }
  }
}

/**
 * Read the repository: settle interrupted saves (store.uncertain) and adopt a newer revision. GitHub Pages serves a
 * change about a minute after it is committed; a signed-in device does not wait for it.
 */
async function catchUp() {
  const { files } = await readLatest(api(), store.config);
  store.settleUncertain(files.changelog);
  if ((files.data?.meta?.revision ?? 0) > (store.data?.meta?.revision ?? 0)) {
    store.setData(files.data, { ledgers: { changelog: files.changelog, applied: files.applied } });
  }
  return files;
}

/** A save could not be made at all: nothing is lost (direct edits join the draft), the keeper is told why. */
function giveUp(e) {
  const kind = e instanceof GitHubError ? e.kind : 'http';
  if (!(e instanceof GitHubError)) console.error(e);
  // The connection dropped (or GitHub failed) during a save: its commit may still have landed.
  const current = jobs[0];
  const uncertain = current?.started && current.kind === 'edit' && ['network', 'http'].includes(kind) ? current.ids : [];
  const pending = jobs.splice(0, jobs.length);
  for (const j of pending) j.resolve?.({ ok: false, error: { kind } });
  const kept = store.moveSavingToDraft(null, { uncertain });
  if (kind === 'auth') {
    // The token was revoked or expired: sign out on this device.
    creds = null;
    writeCreds(null);
    notice({ type: 'auth', kept });
  } else if (kind === 'forbidden') notice({ type: 'forbidden', kept });
  else notice({ type: 'failed', kind, kept });
  setStatus('error', { lastError: { kind } });
}

function pump() {
  if (running) return running;
  if (!jobs.length) return Promise.resolve();
  running = (async () => {
    try {
      // Changes made in the same moment (e.g. several groups of wizard rows) join the first save: one commit.
      await null;
      while (jobs.length) {
        const job = jobs[0];
        job.started = true;
        if (job.kind !== 'refresh' && owner.status !== 'saving') setStatus('saving');
        try {
          if (!creds) throw new GitHubError('auth');
          await runJob(job);
          if (jobs[0] === job) jobs.shift();
        } catch (e) {
          giveUp(e);
        }
      }
    } finally {
      running = null;
      if (owner.status === 'saving') setStatus('idle');
    }
  })();
  return running;
}

export const owner = {
  /** idle | saving | saved | error */
  status: 'idle',
  /** {kind} of the last failure (network, auth, forbidden, rateLimit, conflict, http, rejected) */
  lastError: null,
  /** {rev, sha, at} of the last commit */
  lastSaved: null,
  /** Messages for the interface (js/owner-ui.js shows and clears them): {type: rejected|failed|auth|forbidden, …} */
  notices: [],

  /** Tests: {fetch, sleep, now, savedMs}. */
  configure(over = {}) { Object.assign(env, over); },
  get login() { return creds?.login || ''; },
  active() { return !!creds; },
  busy() { return !!running || jobs.length > 0; },
  /** Resolves when every queued save is finished (tests). */
  idle() { return running || Promise.resolve(); },
  takeNotices() { return owner.notices.splice(0, owner.notices.length); },

  /** Read the credentials of this device (after store.init: needs config.approvers). */
  load() {
    creds = store.config ? readCreds(store.config) : null;
    return !!creds;
  },

  /** After store.init: resume interrupted saves (or keep them in the draft when signed out), catch up with GitHub. */
  start() {
    owner.load();
    if (store.saving.length) {
      if (creds) owner.enqueue(...store.saving.map((s) => s.id));
      else store.moveSavingToDraft();
    }
    if (creds) owner.refresh();
    if (!started) {
      started = true;
      try {
        globalThis.addEventListener?.('storage', (e) => {
          if (e.key !== OWNER_KEY) return;
          owner.load();
          store.emit('owner');
          store.emit('draft');
        });
      } catch { /* no window */ }
    }
  },

  /** Verify and remember a token on this device. → {ok, login} | {ok:false, reason, login?} (never the token) */
  async signIn(token) {
    const r = await verifyToken(token, { config: store.config, fetchImpl: env.fetch });
    if (!r.ok) return r;
    creds = { token: String(token).trim(), login: r.login };
    writeCreds(creds);
    setStatus('idle', { lastError: null });
    store.recompute();
    store.emit('draft');
    owner.refresh();
    return { ok: true, login: r.login };
  },

  /** Forget the token on this device. Direct edits not yet saved join the draft (after a save in flight ends). */
  signOut() {
    creds = null;
    writeCreds(null);
    const pending = jobs.splice(running ? 1 : 0);
    for (const j of pending) j.resolve?.({ ok: false, error: { kind: 'signedOut' } });
    const finish = () => {
      store.moveSavingToDraft();
      setStatus('idle', { lastError: null });
      store.recompute();
      store.emit('draft');
    };
    if (running) { store.emit('owner'); running.then(finish, finish); } else finish();
  },

  /** Queue direct edits (store.saving ids) for saving; consecutive edits share one commit when they can. */
  enqueue(...ids) {
    const last = jobs[jobs.length - 1];
    if (last && last.kind === 'edit' && !last.started) last.ids.push(...ids);
    else jobs.push({ kind: 'edit', ids: [...ids] });
    pump();
  },

  /** "Save all to the tree": the whole draft in one commit. → Promise<{ok, rev?, sha?, errors?, error?}> */
  saveDraft() {
    if (!creds) return Promise.resolve({ ok: false, error: { kind: 'auth' } });
    return new Promise((resolve) => { jobs.push({ kind: 'draft', resolve }); pump(); });
  },

  /**
   * "Apply now": commit a relative's proposal as it is (+ an applied.json entry; the request, when there is one, is
   * closed with a note). → Promise<{ok, rev, sha, people, closed} | {ok:false, already, issue} | {ok:false, errors} |
   * {ok:false, error:{kind}}>
   */
  async applyNow(proposal, { issue = null, hash = '' } = {}) {
    if (!creds) return { ok: false, error: { kind: 'auth' } };
    const h = hash || await proposalHash(proposal);
    const n = Number(issue) > 0 ? Number(issue) : null;
    return new Promise((resolve) => { jobs.push({ kind: 'apply', proposal, hash: h, issue: n, resolve }); pump(); });
  },

  /**
   * GitHub Pages serves a change about a minute after it is committed: a signed-in device reads the repository itself
   * (queued with the saves) and adopts a newer revision at once.
   */
  refresh() {
    if (!creds) return Promise.resolve();
    if (!jobs.some((j) => j.kind === 'refresh' && !j.started)) jobs.push({ kind: 'refresh' });
    return pump();
  },
};

// The store routes addOps() here while this device is signed in.
store.direct = {
  active: () => !!creds,
  enqueue: (id) => owner.enqueue(id),
};
