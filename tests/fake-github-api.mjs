// A fake GitHub REST API over an in-memory git repository — just what owner mode (js/owner.js) uses:
//   GET  /user                                   GET  /repos/{o}/{r}
//   GET  /repos/{o}/{r}/git/ref/heads/{branch}   PATCH /repos/{o}/{r}/git/refs/heads/{branch}   (fast-forward only → 422)
//   GET  /repos/{o}/{r}/contents/{path}?ref=     GET  /repos/{o}/{r}/git/blobs/{sha}
//   GET  /repos/{o}/{r}/git/commits/{sha}        POST /repos/{o}/{r}/git/{blobs,trees,commits}
//   POST /repos/{o}/{r}/issues/{n}/comments      POST /repos/{o}/{r}/issues/{n}/labels      PATCH /repos/{o}/{r}/issues/{n}
// Used as a fetch function by tests/owner.test.mjs and as a request handler by the Playwright smoke test.
//
//   const gh = createFakeGitHub({files: {'data/family.json': text, …}, token, login, push, writable})
//   gh.fetch(url, init) → Response          gh.handle({method, url, headers, body}) → {status, headers, body}
//   gh.file(path, ref = branch) → text|null gh.head() → sha            gh.commit(files, message) (another writer)
//   gh.commitsOf(sha) → [{sha, message, parents, files}]   gh.log: [{method, path, status}]   gh.issues: Map
//   gh.onPatchRef = (attempt) => {}  (runs before each branch update — e.g. to commit something first)
//   gh.failNext(predicate({method, path}), {status, body, network, after})  one-shot failure (after: done, answer lost)
import { createHash } from 'node:crypto';

export const FAKE_TOKEN = 'github_pat_11FAKE0TEST0TOKEN0abcdefghijklmnopqrstuvwxyz0123456789';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Authorization, Accept, Content-Type, X-GitHub-Api-Version',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-expose-headers': 'x-ratelimit-remaining, x-ratelimit-reset',
};

export function createFakeGitHub({
  owner = 'gtsgate', repo = 'family-tree', branch = 'main', login = 'gtsgate', token = FAKE_TOKEN,
  files = {}, push = true, writable = true,
} = {}) {
  const blobs = new Map(); // sha → Buffer
  const trees = new Map(); // sha → Map(path → blob sha)
  const commits = new Map(); // sha → {tree, parents, message}
  const refs = new Map(); // branch → sha
  const issues = new Map(); // n → {state, state_reason, labels: Set, comments: []}
  const log = [];
  let seq = 0;
  let failures = [];

  const sha = (kind, payload) => createHash('sha1').update(`${kind}\0${++seq}\0${payload}`).digest('hex');
  const putBlob = (buf) => { const s = sha('blob', buf.toString('base64')); blobs.set(s, buf); return s; };
  const putTree = (map) => { const s = sha('tree', JSON.stringify([...map])); trees.set(s, map); return s; };
  const putCommit = (tree, parents, message) => { const s = sha('commit', `${tree}${parents.join()}${message}`); commits.set(s, { tree, parents, message }); return s; };

  const initial = new Map(Object.entries(files).map(([p, text]) => [p, putBlob(Buffer.from(text, 'utf8'))]));
  refs.set(branch, putCommit(putTree(initial), [], 'initial'));

  function resolveRef(ref) {
    if (refs.has(ref)) return refs.get(ref);
    if (commits.has(ref)) return ref;
    return null;
  }
  function fileAt(ref, path) {
    const c = commits.get(resolveRef(ref || branch));
    if (!c) return null;
    const b = trees.get(c.tree).get(path);
    return b ? blobs.get(b).toString('utf8') : null;
  }
  function isAncestor(anc, of) {
    const seen = new Set();
    const todo = [of];
    while (todo.length) {
      const s = todo.pop();
      if (s === anc) return true;
      if (seen.has(s)) continue;
      seen.add(s);
      todo.push(...(commits.get(s)?.parents || []));
    }
    return false;
  }
  /** Another writer (the bot, another device) commits `files` on the branch. */
  function commit(changed, message = 'other writer') {
    const head = refs.get(branch);
    const map = new Map(trees.get(commits.get(head).tree));
    for (const [p, text] of Object.entries(changed)) map.set(p, putBlob(Buffer.from(text, 'utf8')));
    const s = putCommit(putTree(map), [head], message);
    refs.set(branch, s);
    return s;
  }
  function commitsOf(from = refs.get(branch)) {
    const out = [];
    let s = from;
    while (s) {
      const c = commits.get(s);
      const parent = c.parents[0] || null;
      const before = parent ? trees.get(commits.get(parent).tree) : new Map();
      const now = trees.get(c.tree);
      const changed = [...now.keys()].filter((p) => before.get(p) !== now.get(p));
      out.push({ sha: s, message: c.message, parents: c.parents, files: changed });
      s = parent;
    }
    return out;
  }
  function issue(n) {
    if (!issues.has(n)) issues.set(n, { state: 'open', state_reason: null, labels: new Set(), comments: [] });
    return issues.get(n);
  }

  const json = (status, value) => ({ status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS }, body: value === undefined ? '' : JSON.stringify(value) });
  const b64lines = (buf) => buf.toString('base64').replace(/.{60}/g, '$&\n');

  function route(method, path, query, body) {
    const base = `/repos/${owner}/${repo}`;
    if (method === 'GET' && path === '/user') return json(200, { login, id: 1, type: 'User' });
    if (method === 'GET' && path === base) {
      return json(200, { full_name: `${owner}/${repo}`, default_branch: branch, permissions: { admin: false, maintain: false, push, triage: true, pull: true } });
    }
    if (!path.startsWith(`${base}/`)) return json(404, { message: 'Not Found' });
    const rest = path.slice(base.length + 1);
    const write = method !== 'GET';
    if (write && !writable) return json(403, { message: 'Resource not accessible by personal access token' });
    let m;
    if (method === 'GET' && (m = /^git\/ref\/heads\/(.+)$/.exec(rest))) {
      const s = refs.get(decodeURIComponent(m[1]));
      return s ? json(200, { ref: `refs/heads/${m[1]}`, object: { sha: s, type: 'commit' } }) : json(404, { message: 'Not Found' });
    }
    if (method === 'GET' && (m = /^contents\/(.+)$/.exec(rest))) {
      const p = m[1].split('/').map(decodeURIComponent).join('/');
      const c = commits.get(resolveRef(query.get('ref') || branch));
      if (!c) return json(404, { message: 'No commit found for the ref' });
      const b = trees.get(c.tree).get(p);
      if (!b) return json(404, { message: 'Not Found' });
      return json(200, { type: 'file', path: p, sha: b, size: blobs.get(b).length, encoding: 'base64', content: b64lines(blobs.get(b)) });
    }
    if (method === 'GET' && (m = /^git\/blobs\/([0-9a-f]+)$/.exec(rest))) {
      const b = blobs.get(m[1]);
      return b ? json(200, { sha: m[1], encoding: 'base64', content: b64lines(b), size: b.length }) : json(404, { message: 'Not Found' });
    }
    if (method === 'GET' && (m = /^git\/commits\/([0-9a-f]+)$/.exec(rest))) {
      const c = commits.get(m[1]);
      return c ? json(200, { sha: m[1], tree: { sha: c.tree }, parents: c.parents.map((s) => ({ sha: s })), message: c.message }) : json(404, { message: 'Not Found' });
    }
    if (method === 'POST' && rest === 'git/blobs') {
      if (typeof body?.content !== 'string') return json(422, { message: 'Invalid request' });
      const buf = body.encoding === 'base64' ? Buffer.from(body.content, 'base64') : Buffer.from(body.content, 'utf8');
      return json(201, { sha: putBlob(buf) });
    }
    if (method === 'POST' && rest === 'git/trees') {
      const baseTree = body?.base_tree ? trees.get(body.base_tree) : new Map();
      if (!baseTree || !Array.isArray(body?.tree)) return json(422, { message: 'Invalid tree' });
      const map = new Map(baseTree);
      for (const e of body.tree) {
        if (e.sha && !blobs.has(e.sha)) return json(422, { message: 'Invalid blob sha' });
        map.set(e.path, e.sha || putBlob(Buffer.from(String(e.content ?? ''), 'utf8')));
      }
      return json(201, { sha: putTree(map) });
    }
    if (method === 'POST' && rest === 'git/commits') {
      if (!trees.has(body?.tree) || !Array.isArray(body?.parents) || body.parents.some((p) => !commits.has(p))) return json(422, { message: 'Invalid commit' });
      return json(201, { sha: putCommit(body.tree, body.parents, String(body.message || '')) });
    }
    if (method === 'PATCH' && (m = /^git\/refs\/heads\/(.+)$/.exec(rest))) {
      const b = decodeURIComponent(m[1]);
      if (!refs.has(b)) return json(422, { message: 'Reference does not exist' });
      api.patches += 1;
      if (api.onPatchRef) api.onPatchRef(api.patches);
      if (!commits.has(body?.sha)) return json(422, { message: 'Object does not exist' });
      if (!body.force && !isAncestor(refs.get(b), body.sha)) return json(422, { message: 'Update is not a fast forward' });
      refs.set(b, body.sha);
      return json(200, { ref: `refs/heads/${b}`, object: { sha: body.sha, type: 'commit' } });
    }
    if ((m = /^issues\/(\d+)(\/comments|\/labels)?$/.exec(rest))) {
      const it = issue(Number(m[1]));
      if (method === 'POST' && m[2] === '/comments') { it.comments.push(String(body?.body || '')); return json(201, { id: it.comments.length }); }
      if (method === 'POST' && m[2] === '/labels') { for (const l of body?.labels || []) it.labels.add(l); return json(200, [...it.labels].map((name) => ({ name }))); }
      if (method === 'PATCH' && !m[2]) { if (body?.state) it.state = body.state; if (body?.state_reason) it.state_reason = body.state_reason; return json(200, { number: Number(m[1]), state: it.state }); }
    }
    return json(404, { message: 'Not Found' });
  }

  /** {method, url, headers, body (string)} → {status, headers, body (string)}; {network: true} = connection failure. */
  function handle({ method = 'GET', url, headers = {}, body = null }) {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '') || '/';
    method = String(method).toUpperCase();
    if (method === 'OPTIONS') return { status: 204, headers: { ...CORS }, body: '' };
    const h = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const failIdx = failures.findIndex((f) => f.when({ method, path }));
    if (failIdx >= 0 && !failures[failIdx].after) {
      const f = failures[failIdx];
      failures.splice(failIdx, 1);
      log.push({ method, path, status: f.network ? 'network' : f.status });
      if (f.network) return { network: true };
      return json(f.status, f.body || { message: 'Failure' });
    }
    let res;
    if (h.authorization !== `Bearer ${token}`) res = json(401, { message: 'Bad credentials' });
    else {
      let parsed = null;
      try { parsed = body ? JSON.parse(body) : null; } catch { parsed = null; }
      res = route(method, path, u.searchParams, parsed);
    }
    log.push({ method, path, status: res.status });
    // {after: true}: the request is carried out, then the answer is lost.
    if (failIdx >= 0 && failures[failIdx].after) { failures.splice(failIdx, 1); return { network: true }; }
    return res;
  }

  const api = {
    owner, repo, branch, login, token, log, issues, patches: 0, onPatchRef: null,
    handle,
    async fetch(url, init = {}) {
      const r = handle({ method: init.method || 'GET', url: String(url), headers: init.headers || {}, body: init.body ?? null });
      if (r.network) throw new TypeError('Failed to fetch');
      return new Response(r.status === 204 ? null : r.body, { status: r.status, headers: r.headers });
    },
    failNext(when, { status = 500, body = null, network = false, after = false } = {}) { failures.push({ when, status, body, network, after }); },
    head: () => refs.get(branch),
    file: (path, ref = branch) => fileAt(ref, path),
    commit,
    commitsOf,
    set writable(v) { writable = !!v; },
    get writable() { return writable; },
  };
  return api;
}
