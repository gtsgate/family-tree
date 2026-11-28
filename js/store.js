// App state: configuration, canonical data, the visitor's draft proposal, proposals already sent
// (awaiting approval) and the "working" graph = data + owner saves in progress + sent proposals + draft, applied in
// preview mode, so pending changes appear everywhere in the UI.  See docs/SPEC.md §7.3.
// Owner mode (js/owner.js, SPEC §5.1): while the keeper is signed in on this device, addOps() saves straight into
// the tree (store.saving holds the edits being committed) instead of adding them to the draft.
import { buildGraph } from './core/graph.js';
import { applyProposal, newProposal, opRefs } from './core/ops.js';
import { normalizeData, newProposalId } from './core/schema.js';
import { setDigits, setMonthNames } from './core/dates.js';
import { setLineageStyle } from './core/names.js';
import { setDefaultLang, setArabicDigits } from './i18n.js';

const DRAFT_KEY = 'gft.draft.v1';
const SENT_KEY = 'gft.sent.v1';
const COUNTER_KEY = 'gft.counter.v1';
const ME_KEY = 'gft.me';
const APPROVED_KEY = 'gft.approved.v1';
const DIGITS_KEY = 'gft.digits';
const SAVING_KEY = 'gft.saving.v1';
const UNCERTAIN_KEY = 'gft.uncertain.v1';
const ALIASES_KEY = 'gft.aliases.v1';
const ALIASES_MAX = 400;

const listeners = { draft: new Set(), sent: new Set(), data: new Set(), me: new Set(), owner: new Set(), config: new Set() };

function loadJSON(key) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch { return null; }
}
function saveJSON(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage full / unavailable */ }
}

function emptyDraft(submitter) {
  return {
    id: newProposalId(),
    ops: [],
    submitter: { name: '', relation: '', personId: '', ...(submitter || {}) },
    note: '',
    dependsOn: [],
    source: null, // {issue, hash} when the owner is correcting a proposal
    updatedAt: '',
  };
}

/** Deep-copy `value`, replacing every string that is a key of `map` (temp refs → other refs / real ids). */
function rewriteRefs(value, map) {
  if (typeof value === 'string') return Object.prototype.hasOwnProperty.call(map, value) ? map[value] : value;
  if (Array.isArray(value)) return value.map((v) => rewriteRefs(v, map));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = rewriteRefs(v, map);
    return out;
  }
  return value;
}

/**
 * Ops with every temp ref they USE (never the refs they declare: `ref`, `unionRef`) that `map` names replaced by the
 * real id — values inside `person`, `set` and `before` are data, never refs. Used when owner saves turn temp refs
 * into real records while other changes still name them.
 */
export function swapUsedRefs(ops, map) {
  const list = Array.isArray(ops) ? ops : [];
  const has = (k) => Object.prototype.hasOwnProperty.call(map || {}, k);
  if (!list.length || !Object.keys(map || {}).length) return list;
  const declared = new Set(list.flatMap((op) => opRefs(op).declares));
  // Top-level fields that hold data or declarations, never a reference to swap.
  const KEEP = new Set(['person', 'set', 'before', 'ref', 'unionRef', 'note', 'marriage', 'date', 'hijri']);
  const swap = (v, uses) => {
    if (typeof v === 'string') return uses.has(v) ? map[v] : v;
    if (Array.isArray(v)) return v.map((x) => swap(x, uses));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x, uses)]));
    return v;
  };
  return list.map((op) => {
    const uses = new Set(opRefs(op).uses.filter((u) => !declared.has(u) && has(u)));
    if (!uses.size) return op;
    return Object.fromEntries(Object.entries(op).map(([k, x]) => [k, KEEP.has(k) ? x : swap(x, uses)]));
  });
}

/** applied.json ledger → {proposalId: {idMap, issue}} (undone proposals no longer resolve their temp refs). */
function appliedById(ledger) {
  const byId = {};
  for (const entry of Object.values(ledger || {})) {
    if (entry && entry.proposalId && !entry.undone && !byId[entry.proposalId]) byId[entry.proposalId] = { idMap: entry.idMap || {}, issue: entry.issue ?? null };
  }
  return byId;
}

const PREVIEW = () => ({ mode: 'preview', now: new Date().toISOString(), allowDestructive: true });

export const store = {
  /** config.json */
  config: null,
  /** canonical normalized data (family.json) */
  data: null,
  /** Graph of canonical data only */
  base: null,
  /** Graph of data + sent (unapproved) proposals + draft. Views normally read from this. */
  working: null,
  draft: emptyDraft(),
  /** [{id, at, via, proposal}] proposals the visitor sent that are not yet approved */
  sent: [],
  /** ids of sent proposals that no longer apply to the latest data */
  sentStale: new Set(),
  /** Sent proposals that the changelog now lists as applied (filled on load; views may toast them) */
  justApproved: [],
  /** This visitor's proposals that were approved (local history, newest first, max 30): {id, at, via, ops, approvedAt, issue} — listed on #/me */
  approved: [],
  /** id sets for badges: draft-only vs sent-awaiting-approval */
  pending: { draft: new Set(), sent: new Set(), created: new Set() },
  draftErrors: [],
  draftWarnings: [],
  /**
   * Owner mode: direct edits being saved into the tree ([{id, at, proposal}], oldest first; kept in localStorage until
   * committed). Shown in the working graph without "pending" badges (the header shows "Saving…").
   */
  saving: [],
  /** Temp refs of owner saves → the real ids they got (so open pages, the wizard and "me" follow them). */
  aliases: {},
  /**
   * Owner saves interrupted while committing (the connection dropped): [{id, ops}] — their ops are in the draft, but the
   * commit may have landed. The next save (or load) checks the repository's changelog before anything is applied twice.
   */
  uncertain: [],
  /** Owner-mode hook set by js/owner.js: {active() → boolean, enqueue(id)}; null → every change goes to the draft. */
  direct: null,
  changelog: null,
  /** applied.json ledger: proposalId → {idMap} for proposals already approved (resolves refs of dependants) */
  appliedById: {},
  me: null,
  ready: false,

  async init() {
    const [config, data] = await Promise.all([fetchJSON('config.json'), fetchJSON('data/family.json')]);
    this.config = config;
    setDefaultLang(config.defaultLanguage || 'ar');
    const digits = loadJSON(DIGITS_KEY);
    this.setDigitsPref(digits === 'arab' || digits === 'latn' ? digits : (config.arabicDigits ? 'arab' : 'latn'), { silent: true });
    try { setMonthNames(config.arabicMonthNames || 'standard'); } catch { /* optional */ }
    try { setLineageStyle(config.lineageStyle || 'plain'); } catch { /* optional */ }
    this.setData(data, { silent: true });

    const savedDraft = loadJSON(DRAFT_KEY);
    if (savedDraft && Array.isArray(savedDraft.ops)) {
      this.draft = { ...emptyDraft(), ...savedDraft, submitter: { ...emptyDraft().submitter, ...(savedDraft.submitter || {}) } };
      if (!this.draft.id) this.draft.id = newProposalId();
      if (!Array.isArray(this.draft.dependsOn)) this.draft.dependsOn = [];
    }
    const savedSent = loadJSON(SENT_KEY);
    if (Array.isArray(savedSent)) this.sent = savedSent.filter((s) => s && s.proposal && Array.isArray(s.proposal.ops));
    const savedApproved = loadJSON(APPROVED_KEY);
    if (Array.isArray(savedApproved)) this.approved = savedApproved.filter((a) => a && a.id);
    const savedSaving = loadJSON(SAVING_KEY);
    if (Array.isArray(savedSaving)) this.saving = savedSaving.filter((x) => x && typeof x.id === 'string' && x.proposal && Array.isArray(x.proposal.ops));
    const savedUncertain = loadJSON(UNCERTAIN_KEY);
    if (Array.isArray(savedUncertain)) this.uncertain = savedUncertain.filter((x) => x && typeof x.id === 'string' && Array.isArray(x.ops));
    const savedAliases = loadJSON(ALIASES_KEY);
    if (savedAliases && typeof savedAliases === 'object' && !Array.isArray(savedAliases)) this.aliases = savedAliases;
    const savedMe = loadJSON(ME_KEY);
    this.me = savedMe ? (this.base.resolve ? this.base.resolve(savedMe)?.id || savedMe : savedMe) : null;

    // Drop sent proposals the changelog says were applied; learn their real ids.
    await Promise.all([this.loadChangelog().catch(() => null), this.loadApplied().catch(() => null)]);
    this.remapTempIds();
    this.reconcileSent();
    this.recompute();
    this.ready = true;
    // Another tab changed the draft / sent queue / "me" → adopt it (the same visitor uses several tabs).
    try {
      globalThis.addEventListener?.('storage', (e) => {
        if (![DRAFT_KEY, SENT_KEY, ME_KEY, APPROVED_KEY].includes(e.key)) return;
        if (this.syncFromStorage()) { this.recompute(); this.emit('draft'); this.emit('sent'); this.emit('me'); }
      });
    } catch { /* no window */ }
  },

  /**
   * Re-read draft, sent queue, approved list and "me" from localStorage (another tab may have changed them).
   * Returns true when anything differed. A draft whose id was already sent gets a fresh id.
   */
  syncFromStorage() {
    let changed = false;
    const d = loadJSON(DRAFT_KEY);
    if (d && Array.isArray(d.ops) && JSON.stringify(d) !== JSON.stringify(this.draft)) {
      this.draft = { ...emptyDraft(), ...d, submitter: { ...emptyDraft().submitter, ...(d.submitter || {}) } };
      if (!this.draft.id) this.draft.id = newProposalId();
      if (!Array.isArray(this.draft.dependsOn)) this.draft.dependsOn = [];
      changed = true;
    }
    const sent = loadJSON(SENT_KEY);
    if (Array.isArray(sent) && JSON.stringify(sent) !== JSON.stringify(this.sent)) {
      this.sent = sent.filter((x) => x && x.proposal && Array.isArray(x.proposal.ops));
      changed = true;
    }
    const approved = loadJSON(APPROVED_KEY);
    if (Array.isArray(approved) && JSON.stringify(approved) !== JSON.stringify(this.approved)) { this.approved = approved; changed = true; }
    const me = loadJSON(ME_KEY);
    if ((me || null) !== (this.me || null)) { this.me = me || null; changed = true; }
    if (this.sent.some((x) => x.id === this.draft.id)) {
      // This draft was already sent (from another tab): its changes live in the sent queue now.
      this.draft = emptyDraft(this.draft.submitter);
      this.persistDraft();
      changed = true;
    }
    return changed;
  },

  /**
   * Replace canonical data (initial load, "publishing…" refresh, owner save). `ledgers` = {changelog, applied} known
   * together with the data (owner mode reads them from the repository): used as they are instead of fetching the
   * published copies, which GitHub Pages may still serve from before the change.
   */
  setData(raw, { silent = false, ledgers = null } = {}) {
    this.data = normalizeData(raw);
    this.base = buildGraph(this.data);
    if (ledgers) {
      if (ledgers.changelog && Array.isArray(ledgers.changelog.entries)) this.changelog = ledgers.changelog;
      if (ledgers.applied && typeof ledgers.applied === 'object') this.appliedById = appliedById(ledgers.applied);
      if (!silent) { this.reconcileSent(); this.remapTempIds(); this.recompute(); this.emit('data'); }
      return;
    }
    if (!silent) {
      this.changelog = null;
      Promise.all([this.loadChangelog(), this.loadApplied()])
        .then(() => { this.reconcileSent(); this.remapTempIds(); this.recompute(); this.emit('data'); })
        .catch(() => { this.recompute(); this.emit('data'); });
    }
  },

  /**
   * Home-page settings (config.json "home": {hiddenTrees, hiddenBridges}) — changed by the keeper in owner mode
   * (js/owner.js saveHome: at once, before the commit lands). Emits "config" when they differ. → changed?
   */
  setHome(home) {
    const next = home && typeof home === 'object' && !Array.isArray(home) && Object.keys(home).length ? home : undefined;
    if (!this.config || JSON.stringify(next ?? null) === JSON.stringify(this.config.home ?? null)) return false;
    const cfg = { ...this.config };
    if (next) cfg.home = next;
    else delete cfg.home;
    this.config = cfg;
    this.emit('config');
    return true;
  },

  /** Re-read the published data; only a NEWER revision is adopted (an owner save may be ahead of GitHub Pages). */
  async refreshData() {
    const raw = await fetchJSON('data/family.json');
    if ((raw?.meta?.revision ?? 0) > (this.data?.meta?.revision ?? 0)) this.setData(raw);
    return raw?.meta?.revision ?? 0;
  },

  async loadChangelog() {
    if (this.changelog) return this.changelog;
    try { this.changelog = await fetchJSON('data/changelog.json'); } catch { this.changelog = { entries: [] }; }
    if (!this.changelog || !Array.isArray(this.changelog.entries)) this.changelog = { entries: [] };
    return this.changelog;
  },

  async loadApplied() {
    let ledger = {};
    try { ledger = await fetchJSON('data/applied.json'); } catch { ledger = {}; }
    this.appliedById = appliedById(ledger);
    return this.appliedById;
  },

  /** "This is me" / submitter set to a person who was pending (temp ref) → their real id once approved. */
  remapTempIds() {
    // Only this visitor's own proposals (sent / approved) and owner saves: temp refs of other devices are unrelated.
    const own = [...this.sent.map((x) => x.id), ...this.approved.map((x) => x.id)];
    const real = (ref) => {
      if (!ref || !/^new\d+$/.test(ref)) return ref;
      if (Object.prototype.hasOwnProperty.call(this.aliases, ref)) return this.aliases[ref];
      for (const id of own) { const m = this.appliedById[id]?.idMap; if (m && m[ref]) return m[ref]; }
      return ref;
    };
    const me = real(this.me);
    if (me !== this.me) { this.me = me; saveJSON(ME_KEY, me); }
    const sub = real(this.draft.submitter.personId);
    if (sub !== this.draft.submitter.personId) { this.draft.submitter.personId = sub; this.persistDraft(); }
    // Draft ops built on people of a proposal that is now approved: use the real ids, drop the dependency.
    const deps = this.draft.dependsOn || [];
    const done = deps.filter((id) => this.appliedById[id]);
    if (done.length) {
      const map = this.appliedRefMap(done);
      this.draft.ops = rewriteRefs(this.draft.ops, map);
      this.draft.dependsOn = deps.filter((id) => !this.appliedById[id]);
      this.persistDraft();
    }
  },

  /** refMap seeded with real ids of temp refs declared by already-applied proposals this one depends on. */
  appliedRefMap(dependsOn = []) {
    const map = {};
    for (const id of dependsOn || []) Object.assign(map, this.appliedById[id]?.idMap || {});
    return map;
  },

  /** The real id an owner save gave to a temp ref (or the id itself). */
  realId(id) {
    return id && Object.prototype.hasOwnProperty.call(this.aliases, id) ? this.aliases[id] : id;
  },

  /** Ids of dependsOn proposals that are already applied. */
  appliedDeps(dependsOn = []) {
    return (dependsOn || []).filter((id) => this.appliedById[id]);
  },

  reconcileSent() {
    const applied = new Set((this.changelog?.entries || []).map((e) => e.proposalId).filter(Boolean));
    const still = [];
    const refMap = {};
    for (const s of this.sent) {
      if (applied.has(s.id)) { this.justApproved.push(s); this.rememberApproved(s); continue; }
      // Already in the tree by another route (e.g. the keeper entered the same changes directly)?
      const map = this.reflectedMap(s);
      if (map) { Object.assign(refMap, map); this.justApproved.push(s); this.rememberApproved(s); continue; }
      still.push(s);
    }
    if (still.length !== this.sent.length) { this.sent = still; saveJSON(SENT_KEY, this.sent); }
    if (Object.keys(refMap).length) {
      // "This is me", the submitter and draft ops that pointed at those pending people now use the real records.
      if (this.me && refMap[this.me]) { this.me = refMap[this.me]; saveJSON(ME_KEY, this.me); }
      const sub = this.draft.submitter.personId;
      if (sub && refMap[sub]) this.draft.submitter.personId = refMap[sub];
      this.draft.ops = rewriteRefs(this.draft.ops, refMap);
      this.persistDraft();
    }
  },

  /**
   * Is everything a sent proposal asks for already in the tree? Every person it adds must match an existing
   * person (POSSIBLE_DUPLICATE: same name and same family), and its other changes must change nothing.
   * Returns {tempRef → real id} when reflected, else null. Conservative: anything unclear keeps it pending.
   */
  reflectedMap(s) {
    try {
      const ops = s?.proposal?.ops || [];
      if (!ops.length) return null;
      const r = applyProposal(this.data, s.proposal, { ...PREVIEW(), refMap: this.appliedRefMap(s.proposal.dependsOn), appliedDeps: this.appliedDeps(s.proposal.dependsOn) });
      if (!r.ok) return null;
      const map = {};
      for (const w of r.warnings || []) {
        if (w.code !== 'POSSIBLE_DUPLICATE' || !Number.isInteger(w.op)) continue;
        const op = ops[w.op];
        if (op && op.op === 'add-person' && w.params?.id && !map[op.ref]) map[op.ref] = w.params.id;
      }
      const adds = ops.filter((o) => o.op === 'add-person');
      if (adds.some((o) => !map[o.ref])) return null;
      // Union refs bound by the add ops → the union the matched person is a child / partner of.
      for (const o of adds) {
        if (!o.unionRef) continue;
        const real = this.base.person(map[o.ref]);
        const u = o.link?.as === 'spouse' ? this.base.unionsOf(real.id).find((x) => x.partners.includes(o.link.of)) : this.base.birthUnion(real.id);
        if (u) map[o.unionRef] = u.id;
      }
      const rest = ops.filter((o) => o.op !== 'add-person');
      if (!rest.length) return map;
      const r2 = applyProposal(this.data, { ...s.proposal, dependsOn: [], ops: rewriteRefs(rest, map) }, { ...PREVIEW() });
      if (!r2.ok) return null;
      const bare = (x) => JSON.stringify({ ...(x || {}), history: undefined });
      for (const id of r2.touched.people) if (bare(r2.data.people[id]) !== bare(this.data.people[id])) return null;
      for (const id of r2.touched.unions) if (bare(r2.data.unions[id]) !== bare(this.data.unions[id])) return null;
      return map;
    } catch {
      return null;
    }
  },

  /** The draft as a full proposal envelope. */
  draftProposal() {
    const p = newProposal();
    p.id = this.draft.id;
    p.createdAt = this.draft.updatedAt || new Date().toISOString();
    p.baseRevision = this.data?.meta?.revision ?? 0;
    p.dependsOn = [...(this.draft.dependsOn || [])];
    p.submitter = { ...this.draft.submitter };
    p.note = this.draft.note || '';
    p.ops = this.draft.ops.map((o) => structuredClone(o));
    return p;
  },

  /**
   * Apply sent proposals (that still apply) then `draftOps` on top of canonical data in preview mode.
   * Returns { data, refMap, sentResults, draftResult }.
   */
  overlay(draftProposal) {
    const base = this.savingOverlay();
    let data = base.data;
    const refMap = { ...base.refMap };
    const sentTouched = new Set();
    const created = new Set();
    this.sentStale = new Set();
    for (const s of this.sent) {
      const deps = s.proposal.dependsOn || [];
      const r = applyProposal(data, s.proposal, { ...PREVIEW(), refMap: { ...this.appliedRefMap(deps), ...refMap }, appliedDeps: this.appliedDeps(deps) });
      if (!r.ok) { this.sentStale.add(s.id); continue; }
      data = r.data;
      for (const ref of Object.keys(r.idMap || {})) refMap[ref] = r.idMap[ref];
      for (const op of s.proposal.ops) for (const d of opRefs(op).declares) if (!(d in refMap)) refMap[d] = d;
      r.touched.people.forEach((id) => sentTouched.add(id));
      r.touched.unions.forEach((id) => sentTouched.add(id));
      [...(r.created.people || []), ...(r.created.unions || [])].forEach((id) => created.add(id));
    }
    let draftResult = null;
    if (draftProposal && draftProposal.ops.length) {
      const deps = draftProposal.dependsOn || [];
      draftResult = applyProposal(data, draftProposal, { ...PREVIEW(), refMap: { ...this.appliedRefMap(deps), ...refMap }, appliedDeps: this.appliedDeps(deps) });
    }
    return { data, refMap, sentTouched, created, draftResult };
  },

  /**
   * Canonical data + the owner's direct edits that are still being saved (preview mode) → {data, refMap}. Cached
   * per data/saving state: every overlay starts from it.
   */
  savingOverlay() {
    const key = this.saving.map((s) => `${s.id}:${s.proposal.ops.length}`).join(',');
    const c = this._savingCache;
    if (c && c.data === this.data && c.key === key && c.aliases === this.aliases) return c.value;
    let data = this.data;
    const refMap = {};
    for (const s of this.saving) {
      const r = applyProposal(data, s.proposal, { ...PREVIEW(), refMap: { ...this.aliases, ...refMap } });
      if (!r.ok) continue;
      data = r.data;
      for (const ref of Object.keys(r.idMap || {})) refMap[ref] = r.idMap[ref];
      for (const op of s.proposal.ops) for (const d of opRefs(op).declares) if (!(d in refMap)) refMap[d] = d;
    }
    const value = { data, refMap };
    this._savingCache = { data: this.data, key, aliases: this.aliases, value };
    return value;
  },

  /** Re-apply owner saves in progress + sent proposals + draft on top of the canonical data. */
  recompute() {
    this.draftErrors = [];
    this.draftWarnings = [];
    this.pending = { draft: new Set(), sent: new Set(), created: new Set() };
    if (!this.saving.length && !this.sent.length && !this.draft.ops.length) { this.working = this.base; return; }
    const { data, sentTouched, created, draftResult } = this.overlay(this.draftProposal());
    this.pending.sent = sentTouched;
    this.pending.created = created;
    let finalData = data;
    if (draftResult) {
      if (draftResult.ok) {
        finalData = draftResult.data;
        draftResult.touched.people.forEach((id) => this.pending.draft.add(id));
        draftResult.touched.unions.forEach((id) => this.pending.draft.add(id));
        [...(draftResult.created.people || []), ...(draftResult.created.unions || [])].forEach((id) => this.pending.created.add(id));
        this.draftWarnings = draftResult.warnings || [];
      } else {
        this.draftErrors = draftResult.errors || [];
      }
    }
    this.working = finalData === this.data ? this.base : buildGraph(finalData);
  },

  /** 'draft' | 'sent' | null — for "not sent yet" / "awaiting approval" badges. */
  pendingKind(id) {
    if (this.pending.draft.has(id)) return 'draft';
    if (this.pending.sent.has(id)) return 'sent';
    return null;
  },
  isPending(id) { return this.pendingKind(id) !== null; },
  isCreated(id) { return this.pending.created.has(id); },

  /** Fresh temp refs from a per-browser counter that never resets (refs stay unique across proposals). */
  nextCounter() {
    const n = (Number(loadJSON(COUNTER_KEY)) || 0) + 1;
    saveJSON(COUNTER_KEY, n);
    return n;
  },
  newRef() { return `new${this.nextCounter()}`; },
  newUnionRef() { return `newu${this.nextCounter()}`; },

  /** Which sent proposals declared these refs? (for automatic dependsOn) */
  sentProposalsDeclaring(refs) {
    const ids = new Set();
    for (const s of this.sent) {
      for (const op of s.proposal.ops) {
        if (opRefs(op).declares.some((d) => refs.includes(d))) ids.add(s.id);
      }
    }
    return [...ids];
  },

  /**
   * Try to add ops to the draft. They are trial-applied with the existing draft (on top of sent proposals);
   * if anything fails nothing is added and {ok:false, errors} is returned (op indexes are relative to the FULL draft).
   */
  addOps(ops) {
    if (this.syncFromStorage()) this.recompute();
    let list = (Array.isArray(ops) ? ops : [ops]).map((o) => structuredClone(o));
    if (this.direct?.active?.()) {
      // A dialog opened before an owner save finished may still name its temp refs.
      list = swapUsedRefs(list, this.aliases);
      const res = this.addOpsDirect(list);
      if (res) return res;
    }
    const trial = this.draftProposal();
    trial.ops.push(...list);
    // Refs used but not declared in the draft must come from sent proposals → dependsOn.
    const declared = new Set(trial.ops.flatMap((o) => opRefs(o).declares));
    const foreign = [...new Set(trial.ops.flatMap((o) => opRefs(o).uses))].filter((r) => /^newu?\d+$/.test(r) && !declared.has(r));
    const deps = new Set([...(trial.dependsOn || []), ...this.sentProposalsDeclaring(foreign)]);
    trial.dependsOn = [...deps];
    const { draftResult } = this.overlay(trial);
    if (!draftResult || !draftResult.ok) return { ok: false, errors: draftResult ? draftResult.errors : [], warnings: draftResult ? draftResult.warnings : [] };
    this.draft.ops.push(...list);
    this.draft.dependsOn = trial.dependsOn;
    this.touchDraft();
    return { ok: true, warnings: draftResult.warnings, idMap: draftResult.idMap };
  },

  /**
   * Owner mode: save `list` straight into the tree. Trial-applied (preview) on the canonical data + the saves still in
   * progress — exactly what will be committed — then queued for js/owner.js, which commits it asynchronously.
   * → {ok:true, saving:true, warnings, idMap} | {ok:false, errors, warnings} (op indexes offset by the draft length,
   * as for the draft path), or null when the ops build on unsaved draft or sent changes: those cannot go to the tree
   * alone, so they join the draft like a visitor's (the draft page saves it with one button).
   */
  addOpsDirect(list) {
    const own = new Set(list.flatMap((o) => opRefs(o).declares));
    const uses = [...new Set(list.flatMap((o) => opRefs(o).uses))].filter((r) => /^newu?\d+$/.test(r) && !own.has(r));
    const draftRefs = new Set(this.draft.ops.flatMap((o) => opRefs(o).declares));
    if (uses.some((r) => draftRefs.has(r)) || this.sentProposalsDeclaring(uses).length) return null;
    const p = newProposal();
    p.baseRevision = this.data?.meta?.revision ?? 0;
    p.ops = list;
    const { data, refMap } = this.savingOverlay();
    const r = applyProposal(data, p, { ...PREVIEW(), refMap: { ...this.aliases, ...refMap } });
    const base = this.draft.ops.length;
    const shift = (x) => (Number.isInteger(x?.op) ? { ...x, op: x.op + base } : x);
    if (!r.ok) return { ok: false, errors: (r.errors || []).map(shift), warnings: (r.warnings || []).map(shift) };
    this.saving = [...this.saving, { id: p.id, at: p.createdAt, proposal: p }];
    this.persistSaving();
    this.recompute();
    this.emit('draft');
    this.emit('owner');
    try { this.direct.enqueue(p.id); } catch (e) { console.error(e); }
    return { ok: true, saving: true, warnings: (r.warnings || []).map(shift), idMap: r.idMap };
  },

  persistSaving() { saveJSON(SAVING_KEY, this.saving.length ? this.saving : null); },

  /**
   * Owner mode: a save finished. `data`/`changelog`/`applied` = the repository's files after it (or as they are, when
   * nothing was committed); `savedIds` = direct edits now in the tree; `idMap` = their temp refs → real ids;
   * `draftSaved` = {id, ops} when the draft was saved ("Save all to the tree"): those ops leave the draft.
   */
  finishSave({ data = null, changelog = null, applied = null, savedIds = [], idMap = {}, draftSaved = null } = {}) {
    this.addAliases(idMap);
    if (savedIds.length || Object.keys(idMap || {}).length) {
      // Edits still waiting may name the refs that just became real records.
      this.saving = this.saving.filter((s) => !savedIds.includes(s.id))
        .map((s) => ({ ...s, proposal: { ...s.proposal, ops: swapUsedRefs(s.proposal.ops, idMap || {}) } }));
      this.persistSaving();
    }
    this.syncFromStorage();
    if (draftSaved && this.draft.id === draftSaved.id) this.removeDraftOps(draftSaved.ops);
    if (Object.keys(idMap || {}).length && this.draft.ops.length) {
      this.draft.ops = swapUsedRefs(this.draft.ops, idMap);
      this.persistDraft();
    }
    const ledgers = { changelog, applied };
    if (data && (data?.meta?.revision ?? 0) >= (this.data?.meta?.revision ?? 0)) this.setData(data, { ledgers });
    else {
      if (changelog) this.changelog = changelog;
      if (applied) this.appliedById = appliedById(applied);
      this.reconcileSent();
      this.remapTempIds();
      this.recompute();
      this.emit('data');
    }
    this.emit('owner');
  },

  /** Remember temp ref → real id pairs of owner saves (≤ ALIASES_MAX, newest kept). */
  addAliases(idMap) {
    if (!Object.keys(idMap || {}).length) return;
    const merged = { ...this.aliases, ...idMap };
    const keys = Object.keys(merged);
    this.aliases = keys.length > ALIASES_MAX ? Object.fromEntries(keys.slice(-ALIASES_MAX).map((k) => [k, merged[k]])) : merged;
    saveJSON(ALIASES_KEY, this.aliases);
  },

  /** Take `ops` (saved into the tree) out of the draft: the leading run when it matches, else each equal op once. */
  removeDraftOps(ops) {
    const key = (o) => JSON.stringify(o);
    const saved = (ops || []).map(key);
    if (!saved.length) return;
    const head = this.draft.ops.slice(0, saved.length).map(key);
    let rest;
    if (head.join('\n') === saved.join('\n')) rest = this.draft.ops.slice(saved.length);
    else {
      const left = [...saved];
      rest = this.draft.ops.filter((o) => { const i = left.indexOf(key(o)); if (i < 0) return true; left.splice(i, 1); return false; });
    }
    if (rest.length) this.draft.ops = rest;
    else this.draft = emptyDraft(this.draft.submitter);
    this.persistDraft();
  },

  /**
   * Owner mode: the repository's changelog says which interrupted saves (store.uncertain) did land — their ops leave the
   * draft (they are in the tree) and their temp refs get the real ids. Every uncertain save is settled. → number landed
   */
  settleUncertain(changelog) {
    if (!this.uncertain.length) return 0;
    const byId = new Map((changelog?.entries || []).filter((e) => e && e.action === 'owner-edit').map((e) => [e.proposalId, e]));
    const landed = this.uncertain.filter((u) => byId.has(u.id));
    this.uncertain = [];
    saveJSON(UNCERTAIN_KEY, null);
    if (!landed.length) return 0;
    const idMap = Object.assign({}, ...landed.map((u) => byId.get(u.id).idMap || {}));
    this.addAliases(idMap);
    this.syncFromStorage();
    this.removeDraftOps(landed.flatMap((u) => u.ops));
    if (Object.keys(idMap).length && this.draft.ops.length) this.draft.ops = swapUsedRefs(this.draft.ops, idMap);
    this.touchDraft();
    return landed.length;
  },

  /**
   * Owner mode: saves that could not be made (signed out, network, refused) — their ops join the draft, in order, so
   * nothing is lost. ids: which ones (default: all); uncertain: ids whose commit may have landed (lost answer).
   */
  moveSavingToDraft(ids = null, { uncertain = [] } = {}) {
    const moving = this.saving.filter((s) => !ids || ids.includes(s.id));
    if (!moving.length) return 0;
    this.syncFromStorage();
    this.saving = this.saving.filter((s) => !moving.includes(s));
    this.persistSaving();
    const ops = swapUsedRefs(moving.flatMap((s) => s.proposal.ops), this.aliases);
    for (const s of moving) {
      if (uncertain.includes(s.id)) this.uncertain.push({ id: s.id, ops: swapUsedRefs(s.proposal.ops, this.aliases) });
    }
    if (this.uncertain.length) saveJSON(UNCERTAIN_KEY, this.uncertain);
    this.draft.ops.push(...ops.map((o) => structuredClone(o)));
    const deps = new Set([...(this.draft.dependsOn || []), ...moving.flatMap((s) => s.proposal.dependsOn || [])]);
    this.draft.dependsOn = [...deps];
    this.touchDraft();
    this.emit('owner');
    return ops.length;
  },

  /**
   * Remove op at index i, plus later ops that depend on refs it declared (transitively),
   * plus later ops that no longer apply. Returns the number of ops removed.
   */
  removeOp(i) {
    // The list on screen may be stale if another tab changed the draft: refresh instead of removing the wrong change.
    if (this.syncFromStorage()) { this.recompute(); this.emit('draft'); return 0; }
    if (i < 0 || i >= this.draft.ops.length) return 0;
    const before = this.draft.ops.length;
    const dead = new Set(opRefs(this.draft.ops[i]).declares);
    let ops = [];
    this.draft.ops.forEach((op, idx) => {
      if (idx === i) return;
      if (idx > i) {
        const { declares, uses } = opRefs(op);
        if (uses.some((u) => dead.has(u))) { declares.forEach((d) => dead.add(d)); return; }
      }
      ops.push(op);
    });
    for (let guard = 0; guard < 50; guard++) {
      const p = this.draftProposal();
      p.ops = ops;
      const { draftResult } = this.overlay(p);
      if (!draftResult || draftResult.ok) break;
      const bad = new Set((draftResult.errors || []).map((e) => e.op).filter((n) => Number.isInteger(n)));
      if (!bad.size) break;
      const deadRefs = new Set();
      ops.forEach((op, idx) => { if (bad.has(idx)) opRefs(op).declares.forEach((d) => deadRefs.add(d)); });
      ops = ops.filter((op, idx) => !bad.has(idx) && !opRefs(op).uses.some((u) => deadRefs.has(u)));
    }
    this.draft.ops = ops;
    this.touchDraft();
    return before - ops.length;
  },

  /** Replace the draft with a proposal (admin "correct this proposal" / preview "load into my draft"). */
  replaceDraft(proposal, { source = null } = {}) {
    this.syncFromStorage();
    const d = emptyDraft(this.draft.submitter);
    // Rename every temp ref the loaded proposal declares to a fresh ref of THIS browser, so it cannot collide
    // with refs of proposals this visitor already sent (every browser starts at new1).
    const renames = {};
    for (const op of proposal.ops || []) {
      for (const r of opRefs(op).declares) {
        if (renames[r]) continue;
        renames[r] = /^newu\d+$/.test(r) ? this.newUnionRef() : this.newRef();
      }
    }
    d.ops = rewriteRefs(proposal.ops || [], renames);
    d.submitter = { ...d.submitter, ...rewriteRefs(proposal.submitter || {}, renames) };
    d.note = proposal.note || '';
    d.dependsOn = [...(proposal.dependsOn || [])];
    d.source = source;
    if (source && proposal.id) d.id = proposal.id;
    // Keep the global ref counter above any ref used in the loaded ops.
    let max = 0;
    for (const op of d.ops) {
      const { declares, uses } = opRefs(op);
      for (const r of [...declares, ...uses]) {
        const m = /^newu?(\d+)$/.exec(r);
        if (m) max = Math.max(max, Number(m[1]));
      }
    }
    if (max > (Number(loadJSON(COUNTER_KEY)) || 0)) saveJSON(COUNTER_KEY, max);
    this.draft = d;
    this.touchDraft();
  },

  clearDraft() {
    this.syncFromStorage();
    this.draft = emptyDraft(this.draft.submitter);
    this.touchDraft();
  },

  /**
   * Called when the visitor sends the draft (relay / WhatsApp / GitHub / email / copy). Moves it to the sent queue.
   * extra.issue: the GitHub request number the e-mail relay opened for it.
   */
  markSent(via, extra = {}) {
    if (this.syncFromStorage()) this.recompute();
    if (!this.draft.ops.length) return null;
    const proposal = this.draftProposal();
    const entry = { id: proposal.id, at: new Date().toISOString(), via, proposal };
    const issue = Number(extra?.issue);
    if (Number.isInteger(issue) && issue > 0) entry.issue = issue;
    // Write the fresh empty draft BEFORE the sent queue, so other tabs never see the old draft as unsent.
    this.draft = emptyDraft(this.draft.submitter);
    this.persistDraft();
    this.sent = [...this.sent.filter((s) => s.id !== entry.id), entry];
    saveJSON(SENT_KEY, this.sent);
    this.recompute();
    this.emit('sent');
    this.emit('draft');
    return entry;
  },

  /** Update how a sent proposal went out (sent again through the e-mail relay: via + request number). */
  updateSent(id, { via, issue } = {}) {
    this.syncFromStorage();
    let changed = false;
    this.sent = this.sent.map((s) => {
      if (s.id !== id) return s;
      changed = true;
      const next = { ...s, at: new Date().toISOString() };
      if (via) next.via = String(via);
      if (Number.isInteger(Number(issue)) && Number(issue) > 0) next.issue = Number(issue);
      return next;
    });
    if (changed) { saveJSON(SENT_KEY, this.sent); this.emit('sent'); }
    return changed;
  },

  /** Remember an approved proposal of this visitor (small summary only; the changelog holds the text). */
  rememberApproved(s) {
    if (!s || this.approved.some((a) => a.id === s.id)) return;
    const entry = (this.changelog?.entries || []).find((e) => e.proposalId === s.id) || null;
    const item = { id: s.id, at: s.at || '', via: s.via || '', ops: s.proposal?.ops?.length || 0, approvedAt: entry?.at || new Date().toISOString(), issue: entry?.issue ?? null };
    this.approved = [item, ...this.approved].slice(0, 30);
    saveJSON(APPROVED_KEY, this.approved);
  },

  /** Drop an approved proposal from the local history (#/me "forget"). */
  forgetApproved(id) {
    this.approved = this.approved.filter((a) => a.id !== id);
    saveJSON(APPROVED_KEY, this.approved);
    this.emit('sent');
  },

  /** Forget a sent proposal (e.g. the owner rejected it, or the visitor withdraws it). */
  forgetSent(id) {
    this.sent = this.sent.filter((s) => s.id !== id);
    saveJSON(SENT_KEY, this.sent);
    this.recompute();
    this.emit('sent');
  },

  setSubmitter(patch) { this.syncFromStorage(); Object.assign(this.draft.submitter, patch); this.persistDraft(); },
  setNote(note) { this.syncFromStorage(); this.draft.note = note; this.persistDraft(); },

  touchDraft() {
    this.draft.updatedAt = new Date().toISOString();
    this.persistDraft();
    this.recompute();
    this.emit('draft');
  },
  persistDraft() { saveJSON(DRAFT_KEY, this.draft); },

  setMe(id) {
    this.me = id || null;
    saveJSON(ME_KEY, this.me);
    if (this.me && !this.draft.submitter.personId) this.setSubmitter({ personId: this.me });
    this.emit('me');
  },

  /** Viewer preference for Arabic-Indic (arab) vs Western (latn) digits. */
  digits: 'latn',
  setDigitsPref(d, { silent = false } = {}) {
    this.digits = d === 'arab' ? 'arab' : 'latn';
    setArabicDigits(this.digits === 'arab');
    try { setDigits(this.digits); } catch { /* optional */ }
    if (!silent) { saveJSON(DIGITS_KEY, this.digits); this.emit('data'); }
  },

  on(evt, fn) {
    listeners[evt].add(fn);
    return () => listeners[evt].delete(fn);
  },
  emit(evt) {
    for (const fn of [...listeners[evt]]) {
      try { fn(); } catch (e) { console.error(e); }
    }
  },

  /** Links to the GitHub repository. */
  repoUrl(path = '') {
    const { owner, name } = this.config.repo;
    return `https://github.com/${owner}/${name}${path}`;
  },
  /** Absolute site URL + hash route, for sharing. */
  siteLink(hash = '') {
    const base = this.config.siteUrl || (location.origin + location.pathname);
    return base.replace(/#.*$/, '') + hash;
  },
};

async function fetchJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

// Debug handle (harmless): lets the owner inspect state from the browser console.
globalThis.__gft = store;
