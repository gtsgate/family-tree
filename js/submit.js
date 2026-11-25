// Proposal transport (docs/SPEC.md §5): everything a send button needs, precomputed so that click handlers stay
// synchronous (iOS and in-app browsers block new windows / clipboard writes after an await).
//
//   const sub = await buildSubmission(proposal, { graph, lang, destructive?, config? });
//   sub = {
//     code, hash, fp, title, summaryTitle, lines, destructive, tooBig,
//     whatsapp: { url, text, tooLong, hasNumber },        // tooLong → copy `text`, show paste steps, open `plainUrl`
//     github:   { url, fits, body },                       // !fits → copy `body` (the code), the form opens without it
//     email:    { url } | null,                            // only when config.owner.email is set
//     approveIssueUrl, approve: { url, fits },             // owner: issue form pre-labelled family-tree + approve(-deletion)
//     approvalComment,                                     // "/approve <fp>\n" + code ("/approve-deletion <fp>" when destructive)
//     relay: { url, payload } | null,                      // only when config.relayUrl is set (e-mail relay, SPEC §5)
//   }
//   sendToRelay(relay.url, {...relay.payload, website}) → {ok:true, issue, url, duplicate} | {ok:false, error} (async send)
//
// Pure apart from reading store.config by default (pass `config` to use it without the store, e.g. in tests).
import { encodeProposal } from './core/codec.js';
import { proposalHash, isDestructive, fingerprintOf } from './core/ops.js';
import { describeProposal } from './core/describe.js';
import { LIMITS } from './core/schema.js';
import { store } from './store.js';

export const WHATSAPP_MAX = 4000;
export const GITHUB_URL_MAX = 7500;
export const ISSUE_TITLE_MAX = 120;
export const WHATSAPP_LINES = 10;
export const ISSUE_TEMPLATE = 'family-tree-proposal.yml';
export const CODE_LABEL = 'رمز التعديلات — يُرجى عدم تغييره / Change code — do not edit';
// E-mail relay (tools/relay/Code.gs validates the same limits; lengths count characters, not UTF-16 units).
export const RELAY_LINES_PER_LANG = 15;
export const RELAY_LINE_MAX = 300;
export const RELAY_SUBMITTER_MAX = 200;
export const RELAY_NOTE_MAX = 2000;
export const RELAY_TIMEOUT_MS = 45000;

const TXT = {
  ar: {
    greeting: 'السلام عليكم ورحمة الله وبركاته،',
    intro: 'هذه تعديلات مقترحة على شجرة العائلة:',
    from: 'المرسِل',
    id: 'رقم المقترح',
    more: (n) => (n === 1 ? '…وتعديل آخر' : n === 2 ? '…وتعديلان آخران' : n <= 10 ? `…و${n} تعديلات أخرى` : `…و${n} تعديلاً آخر`),
    about: 'بخصوص',
  },
  en: {
    greeting: 'Assalamu alaikum,',
    intro: 'Here are some proposed changes to the family tree:',
    from: 'From',
    id: 'Proposal id',
    more: (n) => `…and ${n} more`,
    about: 'About',
  },
};

const langOf = (l) => (l === 'en' ? 'en' : 'ar');
const str = (v) => (typeof v === 'string' ? v : '');

function clip(s, max) {
  const chars = [...String(s || '')];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}

/** Owner's WhatsApp number as digits only ('' when not configured). */
export function ownerNumber(config = store.config) {
  return str(config?.owner?.whatsapp).replace(/[^0-9]/g, '');
}

/** wa.me link; an empty number lets WhatsApp ask for the recipient. */
export function waUrl(text, number = '') {
  const n = String(number || '').replace(/[^0-9]/g, '');
  return text ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : `https://wa.me/${n}`;
}

/** "Name — relation" text for the submitter field / message. */
export function submitterText(submitter) {
  const name = str(submitter?.name).trim();
  const relation = str(submitter?.relation).trim();
  if (name && relation) return `${name} — ${relation}`;
  return name || relation;
}

/** Issue title: "🌳 <describe title>" ("⚠️ " first when destructive), at most 120 characters. */
export function issueTitle(summaryTitle, destructive = false) {
  return clip(`${destructive ? '⚠️ ' : ''}🌳 ${str(summaryTitle).trim()}`, ISSUE_TITLE_MAX);
}

/** The WhatsApp / e-mail message text (SPEC §5.1). */
export function messageText({ lang = 'ar', submitter = null, lines = [], id = '', code = '' } = {}) {
  const T = TXT[langOf(lang)];
  const out = [T.greeting, T.intro];
  const who = submitterText(submitter);
  if (who) out.push(`${T.from}: ${who}`);
  out.push('');
  lines.slice(0, WHATSAPP_LINES).forEach((line, i) => out.push(`${i + 1}. ${line}`));
  if (lines.length > WHATSAPP_LINES) out.push(T.more(lines.length - WHATSAPP_LINES));
  out.push('');
  if (id) out.push(`${T.id}: ${id}`);
  out.push('');
  out.push(CODE_LABEL);
  out.push('```');
  out.push(code);
  out.push('```');
  return out.join('\n');
}

/**
 * GitHub issue-form URL (template family-tree-proposal.yml, fields code / submitter / note), measured on the fully
 * encoded URL: drop the note, then the submitter, then shorten the title to 60; when the code still does not fit,
 * the form opens without it (fits:false) and the caller copies the code.
 */
export function issueUrl({ title = '', code = '', submitter = '', note = '', labels = '', config = store.config } = {}) {
  const owner = config?.repo?.owner || '';
  const name = config?.repo?.name || '';
  const make = (fields) => {
    const params = [['template', ISSUE_TEMPLATE]];
    if (labels) params.push(['labels', labels]);
    for (const [k, v] of fields) if (v) params.push([k, v]);
    return `https://github.com/${owner}/${name}/issues/new?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
  };
  const short = clip(title, 60);
  const attempts = [
    [['title', title], ['code', code], ['submitter', submitter], ['note', note]],
    [['title', title], ['code', code], ['submitter', submitter]],
    [['title', title], ['code', code]],
    [['title', short], ['code', code]],
  ];
  for (const fields of attempts) {
    const url = make(fields);
    if (url.length <= GITHUB_URL_MAX) return { url, fits: true };
  }
  return { url: make([['title', short]]), fits: false };
}

/**
 * The owner's correction comment for an open request: "/approve <fp>" (or "/approve-deletion <fp>" when the proposal is
 * destructive, incl. a REPARENT found by a dry run), then the corrected code on its own line.
 */
export function approvalComment(code, { destructive = false, fp = '' } = {}) {
  return `/${destructive ? 'approve-deletion' : 'approve'}${fp ? ` ${fp}` : ''}\n${code}`;
}

/** config.relayUrl when it is an https URL, else '' (the relay is then not offered). */
export function relayUrl(config = store.config) {
  const u = str(config?.relayUrl).trim();
  return /^https:\/\/[^\s"'<>]+$/.test(u) ? u : '';
}

/**
 * Change lines for the relay e-mail: the Arabic list, then the English list, each numbered from 1 (the relay starts the
 * English block where the numbering restarts) — at most 15 lines per language (14 + "…and n more"), 300 chars each.
 */
export function relaySummary(arLines = [], enLines = []) {
  const block = (lines, l) => {
    const list = (Array.isArray(lines) ? lines : []).map((x) => str(x).replace(/\s+/g, ' ').trim());
    const shown = list.length > RELAY_LINES_PER_LANG ? list.slice(0, RELAY_LINES_PER_LANG - 1) : list;
    const out = shown.map((line, i) => clip(`${i + 1}. ${line}`, RELAY_LINE_MAX));
    if (list.length > shown.length) out.push(clip(TXT[l].more(list.length - shown.length), RELAY_LINE_MAX));
    return out;
  };
  return [...block(arLines, 'ar'), ...block(enLines, 'en')];
}

/** The JSON the site POSTs to the relay. `website` is the honeypot field: people never fill it (it is hidden). */
export function relayPayload({ code = '', title = '', proposal = null, summary = [], lang = 'ar', destructive = false, website = '' } = {}) {
  return {
    code,
    title: clip(title, ISSUE_TITLE_MAX),
    submitter: clip(submitterText(proposal?.submitter), RELAY_SUBMITTER_MAX),
    note: clip(str(proposal?.note), RELAY_NOTE_MAX),
    lang: langOf(lang),
    summary,
    proposalId: str(proposal?.id),
    destructive: !!destructive,
    website: str(website),
  };
}

/**
 * POST a payload to the relay. No custom headers: a string body is sent as text/plain, so the browser makes no CORS
 * preflight; Apps Script answers with a redirect to googleusercontent.com, which allows any origin.
 * → {ok:true, issue, url, duplicate} | {ok:false, error}  (duplicate: this proposal had already been sent — `issue` is that
 *   request; error: the relay's code, e.g. "rate_limited", or network / timeout / http_<n>)
 */
export async function sendToRelay(url, payload, { fetchImpl = globalThis.fetch, timeoutMs = RELAY_TIMEOUT_MS } = {}) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, { method: 'POST', body: JSON.stringify(payload), redirect: 'follow', ...(ctrl ? { signal: ctrl.signal } : {}) });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    const issue = Number(data?.issue);
    if (data && data.ok === true && Number.isInteger(issue) && issue > 0) {
      const link = str(data.url);
      return { ok: true, issue, url: /^https:\/\/github\.com\//.test(link) ? link : '', duplicate: data.duplicate === true };
    }
    const code = str(data?.error);
    return { ok: false, error: /^[a-z_]{1,40}$/.test(code) ? code : res.ok ? 'bad_response' : `http_${res.status}` };
  } catch (e) {
    return { ok: false, error: e?.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Whole-proposal summary in a language (describe.js against `graph`, the data the proposal applies to). */
export function summarize(proposal, graph, lang) {
  try { return describeProposal(proposal, graph || null, langOf(lang)); } catch { return { title: '', lines: [], destructive: isDestructive(proposal), counts: {} }; }
}

/**
 * Precompute every way of sending `proposal`. opts.destructive (e.g. a REPARENT found by a dry run) adds to the static
 * check. opts.code reuses an already-encoded code (owner previews).
 */
export async function buildSubmission(proposal, { graph = null, lang = 'ar', destructive = false, config = store.config, code = null } = {}) {
  const L = langOf(lang);
  // crypto.subtle only exists in secure contexts (https / localhost); without it the fingerprint is just left empty.
  const [theCode, hash] = await Promise.all([code ? Promise.resolve(code) : encodeProposal(proposal), proposalHash(proposal).catch(() => '')]);
  const summary = summarize(proposal, graph, L);
  const isDestr = !!(destructive || summary.destructive || isDestructive(proposal));
  const title = issueTitle(summary.title, isDestr);
  const sub = proposal?.submitter || {};
  const note = str(proposal?.note);

  // WhatsApp
  const number = ownerNumber(config);
  const text = messageText({ lang: L, submitter: sub, lines: summary.lines, id: proposal?.id || '', code: theCode });
  const tooLong = text.length > WHATSAPP_MAX;
  const whatsapp = { url: tooLong ? waUrl('', number) : waUrl(text, number), plainUrl: waUrl('', number), text, tooLong, hasNumber: !!number };

  // GitHub (any family member with an account)
  const gh = issueUrl({ title, code: theCode, submitter: submitterText(sub), note, config });
  const github = { url: gh.url, fits: gh.fits, body: theCode };

  // E-mail
  const email = str(config?.owner?.email).trim()
    ? { url: `mailto:${encodeURIComponent(config.owner.email.trim()).replace(/%40/g, '@')}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}` }
    : null;

  // Owner: create the request already labelled for approval (GitHub honours labels only for users with triage rights).
  const approve = issueUrl({ title, code: theCode, submitter: submitterText(sub), note, labels: `family-tree,${isDestr ? 'approve-deletion' : 'approve'}`, config });

  // E-mail relay: the change lines in both languages (the owner reads Arabic first, then English).
  const rUrl = relayUrl(config);
  let relay = null;
  if (rUrl) {
    const ar = L === 'ar' ? summary : summarize(proposal, graph, 'ar');
    const en = L === 'en' ? summary : summarize(proposal, graph, 'en');
    relay = { url: rUrl, payload: relayPayload({ code: theCode, title, proposal, summary: relaySummary(ar.lines, en.lines), lang: L, destructive: isDestr }) };
  }

  return {
    code: theCode,
    hash,
    fp: fingerprintOf(hash),
    title,
    summaryTitle: summary.title,
    lines: summary.lines,
    counts: summary.counts,
    destructive: isDestr,
    tooBig: theCode.length > LIMITS.code || (proposal?.ops?.length || 0) > LIMITS.ops,
    whatsapp,
    github,
    email,
    approveIssueUrl: approve.url,
    approve,
    approvalComment: approvalComment(theCode, { destructive: isDestr, fp: fingerprintOf(hash) }),
    relay,
  };
}

/** "Tell the owner on WhatsApp instead" text: "بخصوص: <lineage> <siteUrl>#/p/<id>". */
export function aboutText(lang, label, link) {
  const T = TXT[langOf(lang)];
  return `${T.about}: ${[label, link].filter(Boolean).join(' ')}`.trim();
}
