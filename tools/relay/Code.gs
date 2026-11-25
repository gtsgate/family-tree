/**
 * Grand Family Tree — e-mail relay (Google Apps Script, V8 runtime, one file, no libraries).
 *
 * WHAT IT DOES
 *   Relatives tap "Send to {owner}" on the site (#/draft). The site POSTs the proposal here (doPost). The relay
 *   opens the GitHub issue for it (the same body the issue form produces, label "family-tree") and e-mails the owner.
 *   The owner answers that e-mail in Gmail with one word — «موافق» / "approve", «موافق حذف» / "approve deletion",
 *   «رفض» / "reject", optionally «تخطي 3 5» / "skip 3 5". Every 5 minutes checkReplies() reads those answers, posts
 *   the matching command (e.g. "/approve 1a2b3c4d5e6f7081 skip 3,5") on the issue AS THE OWNER (his token), and
 *   later e-mails the outcome ("✅ Applied" with the bot's links, or the bot's problem message) in the same thread.
 *   The existing GitHub workflows do all the real work (check, apply, commit); this script only carries messages.
 *
 * SETUP (details: docs/OWNER-GUIDE.md, "Email approvals — one-time setup")
 *   1. Project Settings → Script properties:
 *        GITHUB_TOKEN  fine-grained personal access token of the owner: only the repository, Issues: Read and write
 *        REPO          gtsgate/family-tree
 *        SITE_URL      https://gtsgate.github.io/family-tree/
 *        OWNER_EMAIL   (optional) where proposals are mailed; default: the Google account running this script.
 *                      Replies are accepted ONLY from this address.
 *        VERIFY_SENT   (optional, advanced) "false" turns off the extra "the reply is in my Sent mail" check below.
 *   2. Run setup() once from the editor (allow the permissions). It checks the properties and GitHub access,
 *      installs the 5-minute trigger for checkReplies() and sends a test e-mail.
 *   3. Deploy → New deployment → Web app · Execute as: Me · Who has access: Anyone → copy the URL into the site's
 *      config.json "relayUrl".
 *   To stop: clear "relayUrl" in config.json (the site goes back to WhatsApp), run stopRelay(), archive the deployment.
 *
 * SECURITY
 *   * The token lives only in Script Properties. It is sent to api.github.com and nowhere else; it is never logged,
 *     returned to the site or put in an e-mail.
 *   * The web app is public (anyone can POST), so every field is validated strictly, a honeypot field must be empty,
 *     the number of new issues is capped globally (10 per hour, 40 per day) and repeats are folded into the issue
 *     already opened for them. The relay only ever CREATES issues labelled "family-tree"; it never approves anything
 *     because of what a relative sent.
 *   * Commands are posted only for replies that (a) are in the Gmail thread the relay opened for that issue,
 *     (b) come from OWNER_EMAIL, (c) are not the relay's own notices, and (d) when OWNER_EMAIL is this account, are in
 *     its Sent mail (a forged "From:" cannot put a message there). Only the first line of the reply is read and only a
 *     fixed set of words is understood; the fingerprint comes from the bot's check comment on GitHub, never from mail.
 *   * Text from relatives (title, name, note, change lines) is untrusted: e-mails are plain text, cut to size, with
 *     control/bidi characters removed and links defused. GitHub's apply workflow re-validates everything anyway.
 *
 * STATE (Script Properties, besides the four settings above)
 *   gft:issue:<n>       {n, thread, relayIds[], seen[], status: pending|posted|done, cmd, forwarded[], ...}
 *   gft:dedupe:<key>    {issue, url, at}   key = "p:<proposal id>" or "c:<sha-256 of the code>", kept 24 hours
 *   gft:rate            [timestamps of issues created in the last 24 hours]
 */

// ---------------------------------------------------------------------------------------------------------------
// Constants

const RELAY = {
  VERSION: 1,
  LABEL: 'family-tree',
  BOT_LOGIN: 'github-actions[bot]',
  API: 'https://api.github.com',
  MAX_BODY: 200000,          // raw POST body (a 60,000-char code + text fits easily)
  MAX_CODE: 60000,
  MAX_TITLE: 120,
  MAX_SUBMITTER: 200,
  MAX_NOTE: 2000,
  MAX_SUMMARY_LINES: 30,
  MAX_SUMMARY_LINE: 300,
  RATE_PER_HOUR: 10,
  RATE_PER_DAY: 40,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  POLL_PENDING_MS: 30 * 60 * 1000,      // pending issue (no command yet): look at GitHub every 30 minutes
  SAME_COMMAND_MS: 30 * 60 * 1000,      // the same command again within 30 minutes is not posted twice
  NO_ANSWER_MS: 20 * 60 * 1000,         // tell the owner (once) when the GitHub bot has not answered a command by then
  KEEP_DONE_MS: 30 * 24 * 60 * 60 * 1000,
  GIVE_UP_MS: 90 * 24 * 60 * 60 * 1000, // stop watching a request nobody answered for 90 days
  MAX_ISSUES_PER_RUN: 20,
  RUN_BUDGET_MS: 4 * 60 * 1000,         // Apps Script stops a run after 6 minutes
  MAX_HINTS: 5,                         // "reply not understood" answers per request
  SENT_CHECK_TRIES: 6,                  // runs to wait for Gmail search to index a reply before ignoring it
  MAX_IDS: 60,
  MAX_FORWARD_CHARS: 8000,
};

const CODE_RE = /^GFT[01]:[A-Za-z0-9_-]+(\.[0-9a-z]{1,7})?$/;
const PROPOSAL_ID_RE = /^[a-z0-9]{4,32}$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const MARKER_RE = /^gft-relay:\d+\s*$/m;
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const BIDI_RE = /[‪-‮⁦-⁩]/g;
const INVISIBLE_RE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿؜]/g;

const FORM = {
  code: '### رمز التعديلات — لا تغيير فيه · Change code — do not edit',
  submitter: '### اسمك وصلة القرابة (اختياري) · Your name and relation (optional)',
  note: '### ملاحظة للمشرف (اختيارية) · Note for the tree keeper (optional)',
  empty: '_No response_',
};

// Reply words, after normalizeLine_ (Arabic letters unified: أإآ→ا, ى→ي, ة→ه; diacritics removed; lower case).
const WORDS = {
  approve: ['موافق', 'موافقه', 'اوافق', 'نعم', 'اعتماد', 'اعتمد', 'تمام', 'approve', 'approved', 'yes', 'ok', 'okay', 'accept', 'accepted'],
  deletion: ['حذف', 'الحذف', 'بالحذف', 'deletion', 'delete', 'removal'],
  reject: ['رفض', 'ارفض', 'مرفوض', 'reject', 'rejected', 'decline', 'declined'],
  negation: ['لا', 'غير', 'مش', 'no', 'not', 'dont', 'cannot'],
  skip: ['تخطي', 'تجاوز', 'استثناء', 'باستثناء', 'بدون', 'عدا', 'ماعدا', 'skip', 'except', 'without'],
  force: ['فرض', 'اجبار', 'force', 'forced'],
  connector: ['و', 'and'],
};

// ---------------------------------------------------------------------------------------------------------------
// Small helpers

/** Current time in ms (one place, so tests can move the clock). */
function now_() {
  return Date.now();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function props_() {
  return PropertiesService.getScriptProperties();
}

function readJson_(key, fallback) {
  const raw = props_().getProperty(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (e) { return fallback; }
}

function writeJson_(key, value) {
  props_().setProperty(key, JSON.stringify(value));
}

/** Length in characters as people count them (code points, so an emoji counts once). */
function charLength_(s) {
  return Array.from(String(s)).length;
}

function clip_(s, max) {
  const chars = Array.from(String(s || ''));
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join('');
}

/** Untrusted text → safe plain text: no control or bidi-override characters; one line unless keepLines. */
function cleanText_(s, keepLines) {
  let t = String(s || '').replace(/\r\n?/g, '\n').replace(BIDI_RE, '');
  if (keepLines) t = t.split('\n').map(function (l) { return l.replace(CONTROL_RE, '').replace(/\s+$/, ''); }).join('\n');
  else t = t.replace(/\s+/g, ' ').replace(CONTROL_RE, '');
  return t.trim();
}

/** Plain-text e-mail: defuse links and addresses written by relatives (Gmail would make them clickable). */
function defuse_(s) {
  return String(s || '')
    .replace(/:\/\//g, ':⁠//')
    .replace(/\bwww\./gi, function (m) { return m.slice(0, 3) + '⁠.'; })
    .replace(/@/g, '@⁠');
}

/** Untrusted text for the issue body (Markdown): same escaping as scripts/lib/render.mjs#esc. */
function mdEscape_(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_[\]{}|~!])/g, '\\$1')
    .replace(/[@#]/g, function (m) { return m + '⁠'; })
    .replace(/:\/\//g, ':⁠//')
    .replace(/\bwww\./gi, function (m) { return m.slice(0, 3) + '⁠.'; });
}

/** CRC-32 (IEEE) of an ASCII string, in base 36 — the checksum after the "." of a code (js/core/codec.js). */
function crc32Base36_(text) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < text.length; i++) {
    c ^= text.charCodeAt(i) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  }
  return ((c ^ 0xFFFFFFFF) >>> 0).toString(36);
}

function sha256Hex_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

/** "Name <a@b.c>" → "a@b.c" (lower case). */
function addressOf_(from) {
  const s = String(from || '');
  const m = /<([^<>]+)>/.exec(s);
  return (m ? m[1] : s).trim().toLowerCase();
}

/** Settings from Script Properties. `ready` is false when something required is missing. */
function config_() {
  const p = props_();
  const token = String(p.getProperty('GITHUB_TOKEN') || '').trim();
  const repo = String(p.getProperty('REPO') || '').trim();
  let site = String(p.getProperty('SITE_URL') || '').trim().replace(/#.*$/, '');
  if (site && !/\/$/.test(site)) site += '/';
  let me = '';
  try { me = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase(); } catch (e) { me = ''; }
  const owner = String(p.getProperty('OWNER_EMAIL') || '').trim().toLowerCase() || me;
  const verifySent = String(p.getProperty('VERIFY_SENT') || '').trim().toLowerCase() !== 'false';
  const problems = [];
  if (!token) problems.push('GITHUB_TOKEN is missing');
  if (!REPO_RE.test(repo)) problems.push('REPO must look like owner/name (e.g. gtsgate/family-tree)');
  if (!/^https:\/\/[^\s]+$/.test(site)) problems.push('SITE_URL must start with https://');
  if (!EMAIL_RE.test(owner)) problems.push('OWNER_EMAIL is not an e-mail address');
  return { token: token, repo: repo, site: site, owner: owner, me: me, verifySent: verifySent, ready: !problems.length, problems: problems };
}

// ---------------------------------------------------------------------------------------------------------------
// GitHub REST

/** One GitHub API call. Throws Error(status) on failure; the message never contains the token or a response body. */
function gh_(cfg, method, path, body) {
  const opts = {
    method: method,
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + cfg.token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  };
  if (body !== undefined) {
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(body);
  }
  let res;
  try {
    res = UrlFetchApp.fetch(RELAY.API + path, opts);
  } catch (e) {
    const err = new Error('GitHub ' + method.toUpperCase() + ' ' + path.split('?')[0] + ' failed (network)');
    err.status = 0;
    throw err;
  }
  const status = res.getResponseCode();
  if (status < 200 || status >= 300) {
    const err = new Error('GitHub ' + method.toUpperCase() + ' ' + path.split('?')[0] + ' → HTTP ' + status);
    err.status = status;
    throw err;
  }
  const text = res.getContentText();
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}

function issuePath_(cfg, n) {
  return '/repos/' + cfg.repo + '/issues/' + Number(n);
}

/** The issue and its comments (oldest first, at most 300). */
function issueState_(cfg, n) {
  const issue = gh_(cfg, 'get', issuePath_(cfg, n));
  const comments = [];
  for (let page = 1; page <= 3; page++) {
    const batch = gh_(cfg, 'get', issuePath_(cfg, n) + '/comments?per_page=100&page=' + page) || [];
    for (let i = 0; i < batch.length; i++) comments.push(batch[i]);
    if (batch.length < 100) break;
  }
  return { issue: issue || {}, comments: comments };
}

function labelsOf_(issue) {
  return ((issue && issue.labels) || []).map(function (l) { return typeof l === 'string' ? l : (l && l.name) || ''; });
}

function isBot_(c) {
  return !!(c && c.user && c.user.login === RELAY.BOT_LOGIN);
}

/** What the bot's check comment says: the fingerprint and which command the proposal needs. */
function readCheck_(state) {
  const c = state.comments.filter(function (x) { return isBot_(x) && /<!-- gft-bot:check[\s>]/.test(String(x.body || '')); })[0];
  if (!c) return null;
  const body = String(c.body || '');
  const marker = /<!-- gft-bot:check([^>]*)-->/.exec(body);
  const fields = marker ? marker[1] : '';
  if (/\bhash=none\b/.test(fields)) return { badCode: true };
  const m = /\bfp=([0-9a-f]{16,64})\b/.exec(fields)
    || /^\/approve-deletion ([0-9a-f]{16,64})\b/m.exec(body)
    || /^\/approve ([0-9a-f]{16,64})\b/m.exec(body);
  if (!m) return null;
  const deletion = /^\/approve-deletion [0-9a-f]{16,64}\b/m.test(body) || labelsOf_(state.issue).indexOf('deletion-request') >= 0;
  return { fp: m[1].slice(0, 16), deletion: deletion, failing: /^###\s*❌/m.test(body) };
}

/** Bot comment Markdown → readable plain text for an e-mail (markers, HTML and Markdown syntax removed). */
function plainFromMarkdown_(md) {
  let s = String(md || '').replace(/\r\n?/g, '\n');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<\/?(div|sub|sup|details|summary|br|p|b|strong|em|code|span)\b[^>]*>/gi, '');
  s = s.replace(/^```[a-z]*\s*$/gim, '');
  s = s.replace(/\[([^\]\n]*)\]\(([^)\s]+)\)/g, function (m, label, url) { return label + ': ' + url; });
  s = s.replace(/^#{1,6}\s*/gm, '');
  s = s.replace(/\*\*|__/g, '');
  s = s.replace(/\\([\\`*_[\]{}|~!#])/g, '$1');
  s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  s = s.replace(/^-{3,}\s*$/gm, '');
  s = s.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return clip_(s.replace(CONTROL_RE, ''), RELAY.MAX_FORWARD_CHARS);
}

function resultStatus_(body) {
  const m = /<!-- gft-bot:result[^>]*\bstatus=([A-Za-z0-9_.-]+)/.exec(String(body || ''));
  return m ? m[1] : '';
}

// ---------------------------------------------------------------------------------------------------------------
// Web app: health check and the site's POST

function doGet() {
  return json_({ ok: true, relay: 'gft', version: RELAY.VERSION });
}

function doPost(e) {
  let out;
  try {
    out = handlePost_(e);
  } catch (err) {
    console.error('doPost failed: ' + (err && err.message));
    out = { ok: false, error: 'server_error' };
  }
  return json_(out);
}

function handlePost_(e) {
  const raw = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
  if (!raw || raw.length > RELAY.MAX_BODY) return { ok: false, error: 'invalid' };
  let data;
  try { data = JSON.parse(raw); } catch (err) { return { ok: false, error: 'invalid' }; }
  const v = validatePayload_(data);
  if (!v.ok) return { ok: false, error: 'invalid', field: v.field };
  const cfg = config_();
  if (!cfg.ready) {
    console.error('Relay is not configured: ' + cfg.problems.join('; '));
    return { ok: false, error: 'not_configured' };
  }
  const p = v.value;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    const t = now_();
    const codeKey = 'gft:dedupe:c:' + sha256Hex_(p.code).slice(0, 40);
    const idKey = 'gft:dedupe:p:' + p.proposalId;
    const dup = [readJson_(idKey, null), readJson_(codeKey, null)].filter(function (d) {
      return d && d.issue && t - Number(d.at || 0) < RELAY.DAY;
    })[0];
    if (dup) return { ok: true, issue: dup.issue, url: dup.url, duplicate: true };

    if (!takeRateSlot_(t)) return { ok: false, error: 'rate_limited' };

    let issue;
    try {
      issue = gh_(cfg, 'post', '/repos/' + cfg.repo + '/issues', { title: p.title, body: issueBody_(p), labels: [RELAY.LABEL] });
    } catch (err) {
      console.error('Creating the issue failed: ' + err.message);
      return { ok: false, error: 'github_error' };
    }
    const n = Number(issue && issue.number);
    if (!n) return { ok: false, error: 'github_error' };
    const url = String((issue && issue.html_url) || 'https://github.com/' + cfg.repo + '/issues/' + n);
    const seen = { issue: n, url: url, at: t };
    writeJson_(idKey, seen);
    writeJson_(codeKey, seen);

    const rec = { n: n, thread: '', relayIds: [], seen: [], status: 'pending', created: t, polledAt: t, title: p.title, subject: '', hints: 0, forwarded: [], sentTries: {} };
    try {
      const mail = sendProposalMail_(cfg, n, url, p);
      rec.thread = mail.thread;
      rec.relayIds.push(mail.id);
      rec.subject = mail.subject;
    } catch (err) {
      console.error('#' + n + ': the e-mail to the owner failed: ' + err.message);
    }
    saveRecord_(rec);
    return { ok: true, issue: n, url: url };
  } finally {
    lock.releaseLock();
  }
}

/** Strict validation of the site's payload. → {ok, value} | {ok:false, field} */
function validatePayload_(d) {
  const bad = function (field) { return { ok: false, field: field }; };
  if (!d || typeof d !== 'object' || Array.isArray(d)) return bad('payload');
  if (d.website !== undefined && d.website !== null && d.website !== '') return bad('website');
  if (typeof d.code !== 'string') return bad('code');
  const code = d.code.replace(/\s+/g, '');
  if (!code || code.length > RELAY.MAX_CODE || !CODE_RE.test(code)) return bad('code');
  const dot = code.indexOf('.');
  if (dot < 0 || crc32Base36_(code.slice(5, dot)) !== code.slice(dot + 1)) return bad('code');
  const text = function (v, max, field) {
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string' || charLength_(v) > max) throw field;
    return v;
  };
  let title, submitter, note;
  try {
    title = text(d.title, RELAY.MAX_TITLE, 'title');
    submitter = text(d.submitter, RELAY.MAX_SUBMITTER, 'submitter');
    note = text(d.note, RELAY.MAX_NOTE, 'note');
  } catch (field) {
    return bad(field);
  }
  let summary = [];
  if (d.summary !== undefined && d.summary !== null) {
    if (!Array.isArray(d.summary) || d.summary.length > RELAY.MAX_SUMMARY_LINES) return bad('summary');
    for (let i = 0; i < d.summary.length; i++) {
      if (typeof d.summary[i] !== 'string' || charLength_(d.summary[i]) > RELAY.MAX_SUMMARY_LINE) return bad('summary');
    }
    summary = d.summary.map(function (l) { return cleanText_(l, false); }).filter(Boolean);
  }
  const lang = d.lang === undefined || d.lang === null || d.lang === '' ? 'ar' : d.lang;
  if (lang !== 'ar' && lang !== 'en') return bad('lang');
  if (typeof d.proposalId !== 'string' || !PROPOSAL_ID_RE.test(d.proposalId)) return bad('proposalId');
  if (d.destructive !== undefined && d.destructive !== null && typeof d.destructive !== 'boolean') return bad('destructive');
  const cleanTitle = cleanText_(title, false) || '🌳 Family tree proposal';
  return {
    ok: true,
    value: {
      code: code,
      title: cleanTitle,
      submitter: cleanText_(submitter, false),
      note: cleanText_(note, true),
      summary: summary,
      lang: lang,
      proposalId: d.proposalId,
      destructive: d.destructive === true,
    },
  };
}

/** Global rate limit (both windows), counted on issues actually opened. Returns false when over the limit. */
function takeRateSlot_(t) {
  const list = (readJson_('gft:rate', []) || []).filter(function (x) { return typeof x === 'number' && t - x < RELAY.DAY && x <= t; });
  const lastHour = list.filter(function (x) { return t - x < RELAY.HOUR; }).length;
  if (list.length >= RELAY.RATE_PER_DAY || lastHour >= RELAY.RATE_PER_HOUR) {
    writeJson_('gft:rate', list);
    return false;
  }
  list.push(t);
  writeJson_('gft:rate', list);
  return true;
}

/** The issue body, laid out exactly as the issue form (.github/ISSUE_TEMPLATE/family-tree-proposal.yml) renders it. */
function issueBody_(p) {
  return [
    FORM.code, '', '```text', p.code, '```', '',
    FORM.submitter, '', p.submitter ? mdEscape_(p.submitter) : FORM.empty, '',
    FORM.note, '', p.note ? mdEscape_(p.note) : FORM.empty,
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// E-mails (plain text, Arabic first, then English). Every relay message ends with the marker line "gft-relay:<n>".

function marker_(n) {
  return 'gft-relay:' + Number(n);
}

/** The Arabic and English blocks of the site's change lines (each list is numbered from 1; English starts at the restart). */
function splitSummary_(lines) {
  for (let i = 1; i < lines.length; i++) if (/^1[.)]\s/.test(lines[i])) return { ar: lines.slice(0, i), en: lines.slice(i) };
  return { ar: lines, en: [] };
}

function sendProposalMail_(cfg, n, url, p) {
  const title = p.title.replace(/^(⚠️\s*)?🌳\s*/, '$1');
  const subject = '🌳 [GFT #' + n + '] ' + defuse_(title);
  const preview = cfg.site + '#/preview/' + n;
  const lines = splitSummary_(p.summary.map(function (l) { return defuse_(clip_(l, RELAY.MAX_SUMMARY_LINE)); }));
  const who = p.submitter ? defuse_(p.submitter) : '';
  const note = p.note ? defuse_(p.note) : '';
  const destructive = p.destructive;

  const ar = [];
  ar.push('وصل مقترح جديد لشجرة العائلة — الطلب رقم ' + n);
  ar.push('');
  ar.push('المرسِل: ' + (who || '(لم يُذكر)'));
  ar.push('العنوان: ' + defuse_(title));
  if (destructive) {
    ar.push('');
    ar.push('⚠️ تنبيه: يتضمن هذا المقترح حذفاً أو دمجاً أو تغييراً للوالدين، لذلك تلزمه الموافقة بعبارة «موافق حذف».');
  }
  ar.push('');
  ar.push('التعديلات (كما وصفها موقع المرسِل):');
  (lines.ar.length ? lines.ar : ['—']).forEach(function (l) { ar.push(l); });
  if (note) {
    ar.push('');
    ar.push('ملاحظة المرسِل · Sender’s note:');
    ar.push(note);
  }
  ar.push('');
  ar.push('المعاينة على الموقع: ' + preview);
  ar.push('الطلب على GitHub: ' + url);
  ar.push('');
  ar.push('طريقة الرد (كلمة في أول سطر من الرد):');
  if (destructive) {
    ar.push('• «موافق حذف» — للموافقة على هذا المقترح بما فيه من حذف');
    ar.push('• «موافق حذف تخطي 3» — للموافقة دون التعديل 3');
  } else {
    ar.push('• «موافق» — لتطبيق التعديلات');
    ar.push('• «موافق تخطي 3 5» — لتطبيق الباقي دون التعديلين 3 و5');
    ar.push('• «موافق حذف» — إذا تضمّن المقترح حذفاً');
  }
  ar.push('• «رفض» — للاعتذار عن المقترح بلطف');
  ar.push('يُنفَّذ الرد خلال خمس دقائق تقريباً، ثم تصل النتيجة في هذه المحادثة نفسها.');

  const en = [];
  en.push('A new family-tree proposal arrived — request #' + n);
  en.push('');
  en.push('Sent by: ' + (who || '(not given)'));
  en.push('Title: ' + defuse_(title));
  if (destructive) {
    en.push('');
    en.push('⚠️ Note: this proposal removes, merges or re-parents people, so it needs the reply "approve deletion".');
  }
  en.push('');
  en.push('Changes (as described by the sender’s browser):');
  (lines.en.length ? lines.en : lines.ar.length ? ['(see the Arabic list above)'] : ['—']).forEach(function (l) { en.push(l); });
  if (note) {
    en.push('');
    en.push('Sender’s note: shown above.');
  }
  en.push('');
  en.push('Preview on the site: ' + preview);
  en.push('GitHub request: ' + url);
  en.push('');
  en.push('How to reply (one word on the first line of your reply):');
  if (destructive) {
    en.push('• "approve deletion" — approve this proposal, removals included');
    en.push('• "approve deletion skip 3" — approve it without change 3');
  } else {
    en.push('• "approve" — apply the changes');
    en.push('• "approve skip 3 5" — apply the rest, without changes 3 and 5');
    en.push('• "approve deletion" — when the proposal includes a removal');
  }
  en.push('• "reject" — decline politely');
  en.push('Your reply is carried out within about five minutes; the result arrives in this same conversation.');

  const body = ar.concat(['', '────────────', ''], en, ['', '—', marker_(n)]).join('\n');
  const msg = GmailApp.createDraft(cfg.owner, subject, body).send();
  return { thread: msg.getThread().getId(), id: msg.getId(), subject: subject };
}

/** A relay notice in the request's thread (to the owner). Returns the new message id ('' if sent outside the thread). */
function notify_(cfg, rec, thread, text) {
  const body = text + '\n\n—\n' + marker_(rec.n);
  if (thread) {
    const msgs = thread.getMessages();
    let target = null;
    for (let i = msgs.length - 1; i >= 0 && !target; i--) {
      if (addressOf_(msgs[i].getFrom()) === cfg.owner && !(msgs[i].isDraft && msgs[i].isDraft())) target = msgs[i];
    }
    if (target) {
      const sent = target.createDraftReply(body).send();
      const id = sent && sent.getId ? sent.getId() : '';
      if (id) rec.relayIds = (rec.relayIds || []).concat([id]).slice(-RELAY.MAX_IDS);
      return id;
    }
  }
  GmailApp.sendEmail(cfg.owner, 'Re: ' + (rec.subject || '🌳 [GFT #' + rec.n + ']'), body);
  return '';
}

const TXT = {
  howTo: [
    'يكفي كتابة إحدى هذه العبارات في أول سطر من الرد: «موافق»، «موافق حذف»، «رفض»، أو «موافق تخطي 3 5».',
    'Please write one of these on the first line of the reply: "approve", "approve deletion", "reject", or "approve skip 3 5".',
  ],
  unknown: ['لم يتضح المطلوب من الرد.', 'The reply was not understood.'],
  needDeletion: [
    '⚠️ يتضمن هذا المقترح حذفاً أو دمجاً أو تغييراً للوالدين، لذلك لا تكفي «موافق» وحدها، ولم يُنفَّذ شيء بعد. للموافقة عليه بما فيه من حذف، يكفي الرد بعبارة «موافق حذف».',
    '⚠️ This proposal removes, merges or re-parents people, so a plain "approve" is not enough — nothing was done yet. To approve it, removals included, reply "approve deletion".',
  ],
  closed: ['الطلب مغلق بالفعل على GitHub، فلم يُنفَّذ الرد.', 'This request is already closed on GitHub, so the reply was not carried out.'],
  badCode: [
    'تعذّرت قراءة رمز التعديلات في هذا الطلب، فلا يمكن الموافقة عليه. يمكن لصاحب المقترح إرساله من جديد من الموقع.',
    'The change code in this request could not be read, so it can’t be approved. The sender can send it again from the site.',
  ],
  notConfirmed: [
    'وصل رد في هذه المحادثة لم يُتحقَّق من أنه مُرسَل من هذا الحساب، فتم تجاهله. للتنفيذ، يكفي الرد من Gmail نفسه. وإن تكرر هذا مع ردود من Gmail، يمكن إضافة الخاصية VERIFY_SENT بالقيمة false في إعدادات مشروع Apps Script.',
    'A reply in this conversation could not be confirmed as sent from this account, so it was ignored. Replying from Gmail itself works. If this keeps happening with replies sent from Gmail, add the script property VERIFY_SENT with the value false in the Apps Script project settings.',
  ],
  noAnswer: (n) => [
    'نُشر الأمر على الطلب رقم ' + n + ' قبل أكثر من 20 دقيقة، ولم يردّ روبوت GitHub بعد. تظهر أسباب التأخير في صفحة Actions في المستودع (هل الإجراءات مفعّلة؟). وستصل النتيجة هنا متى ردّ الروبوت.',
    'The command on request #' + n + ' was posted more than 20 minutes ago and the GitHub bot has not answered yet. The repository’s Actions tab shows why (are Actions enabled?). The result will still arrive here when it answers.',
  ],
  applied: (n) => ['✅ طُبّقت التعديلات على شجرة العائلة — الطلب رقم ' + n, '✅ Applied to the family tree — request #' + n],
  botSaid: (n) => ['ℹ️ ردّ روبوت الشجرة على الطلب رقم ' + n + ':', 'ℹ️ The tree bot replied on request #' + n + ':'],
  goOn: [
    'للمتابعة، يكفي الرد على هذه الرسالة بأمر جديد، مثل «موافق حذف» أو «موافق تخطي 3» أو «رفض»، أو بالأمر المقترح أعلاه كما هو.',
    'To go on, reply to this email with a new command, such as "approve deletion", "approve skip 3" or "reject" — or with the command suggested above, as it is.',
  ],
  retry: ['ستُعاد المحاولة تلقائياً، ولا حاجة إلى أي رد.', 'It will be retried automatically — no reply needed.'],
  rejected: (n) => ['تم الاعتذار عن المقترح بلطف وإغلاق الطلب رقم ' + n + '.', 'Request #' + n + ' was declined politely and closed.'],
  closedElsewhere: (n) => ['أُغلق الطلب رقم ' + n + ' على GitHub.', 'Request #' + n + ' was closed on GitHub.'],
  link: ['الطلب على GitHub · GitHub request: '],
};

function bi_(pair) {
  return pair[0] + '\n' + pair[1];
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the owner's reply

/** The first line the owner wrote: not empty, not quoted ("> …"), before any "On … wrote:" header or signature. */
function firstReplyLine_(body) {
  const lines = String(body || '').slice(0, 20000).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(INVISIBLE_RE, '').trim();
    if (!line) continue;
    if (line.charAt(0) === '>') continue;
    if (isQuoteHeader_(line)) return '';
    return line.slice(0, 200);
  }
  return '';
}

function isQuoteHeader_(line) {
  return /^on\b.*\bwrote:?$/i.test(line)
    || /^on\s.*\d{4}/i.test(line)
    || /كتب:?$/.test(line)
    || /^في\s.*\d/.test(line)
    || /^(from|de|von|من|sent|to|subject)\s*:/i.test(line)
    || /^-{2,}\s*$/.test(line)
    || /^-{2,}.*(original|forwarded|الأصلية|إعادة توجيه)/i.test(line)
    || /^_{3,}\s*$/.test(line)
    || /^(sent from|get outlook|تم الإرسال من|أُرسلت من|ارسلت من)/i.test(line)
    || MARKER_RE.test(line);
}

/** Arabic/English digits, letters unified, punctuation → spaces; digits split from letters. → tokens */
function normalizeLine_(line) {
  let s = String(line || '').replace(INVISIBLE_RE, '');
  s = s.replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); });
  s = s.replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); });
  s = s.replace(/[ً-ٰٟـ]/g, '');
  s = s.replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase();
  s = s.replace(/[^a-z0-9ء-ي,،\-–\s]/g, ' ');
  s = s.replace(/([a-zء-ي])[\-–]+/g, '$1 ').replace(/[\-–]+([a-zء-ي])/g, ' $1');
  s = s.replace(/(\d)([a-zء-ي])/g, '$1 $2').replace(/([a-zء-ي])(\d)/g, '$1 $2');
  return s.split(/[\s,،]+/).filter(Boolean).slice(0, 40);
}

/**
 * The owner's decision in one line. → {verb: "approve"|"approve-deletion"|"reject", skip: [1-based numbers], force}
 * or null (not understood: no known word, contradicting words, a negated approval, stray numbers, or "skip" without
 * numbers). A command copied from a bot message ("/approve 0ae7dcdfc9764382 skip 2") is understood too: its
 * fingerprint is ignored — the relay always uses the one of the current check comment.
 */
function parseReply_(line) {
  const tokens = normalizeLine_(String(line || '').replace(/(^|[^0-9a-z])[0-9a-f]{16,64}(?![0-9a-z])/gi, '$1 '));
  if (!tokens.length) return null;
  const has = function (list, tok) { return list.indexOf(tok) >= 0; };
  const known = function (w) { return has(WORDS.approve, w) || has(WORDS.reject, w) || has(WORDS.deletion, w) || has(WORDS.skip, w) || has(WORDS.force, w); };
  // "و" (and) is written glued to the next word: «وموافق», «ورفض».
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].length > 2 && tokens[i].charAt(0) === 'و' && !known(tokens[i]) && known(tokens[i].slice(1))) tokens[i] = tokens[i].slice(1);
  }
  let verb = null;
  let deletion = false;
  let negated = false;
  let inSkip = false;
  let sawSkip = false;
  let stray = false;
  let force = false;
  const skip = [];
  let start = 0;
  if (tokens[0] === 'لا' && tokens[1] === 'مانع') { verb = 'approve'; start = 2; } // "no objection"
  for (let i = start; i < tokens.length; i++) {
    const tok = tokens[i];
    if (inSkip) {
      let m;
      if ((m = /^(\d{1,3})$/.exec(tok))) { skip.push(Number(m[1])); continue; }
      if ((m = /^(\d{1,3})[-–](\d{1,3})$/.exec(tok))) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        if (b < a || b - a > 150) return null;
        for (let k = a; k <= b; k++) skip.push(k);
        continue;
      }
      if (has(WORDS.connector, tok)) continue;
      inSkip = false;
    }
    if (has(WORDS.skip, tok)) { inSkip = true; sawSkip = true; continue; }
    if (/^\d/.test(tok)) { stray = true; continue; }
    if (has(WORDS.approve, tok)) {
      if (i > 3 && !verb) continue; // a command word deep inside a sentence is not a command
      if (verb === 'reject') return null;
      verb = verb || 'approve';
      continue;
    }
    if (has(WORDS.reject, tok)) {
      if (i > 3 && !verb) continue;
      if (verb === 'approve') return null;
      verb = 'reject';
      continue;
    }
    if (has(WORDS.deletion, tok)) { deletion = true; continue; }
    if (has(WORDS.force, tok)) { force = true; continue; }
    if (has(WORDS.negation, tok) && i < 2) negated = true;
  }
  if (!verb && negated && tokens.length === 1) verb = 'reject'; // "no" / «لا» alone
  if (!verb) return null;
  if (negated && verb === 'approve') return null; // "not approved", «لا أوافق»: ask again rather than guess
  if (verb === 'reject') return { verb: 'reject', skip: [], force: false };
  if (stray) return null;
  if (sawSkip && !skip.length) return null;
  const uniq = skip.filter(function (x, i) { return x >= 1 && x <= 150 && skip.indexOf(x) === i; }).sort(function (a, b) { return a - b; });
  if (sawSkip && !uniq.length) return null;
  return { verb: deletion ? 'approve-deletion' : 'approve', skip: uniq, force: force };
}

/** Is this Gmail message in this account's Sent mail? (null = not indexed yet / cannot tell) */
function inSentMail_(msg, thread) {
  let mid = '';
  try { mid = String(msg.getHeader('Message-ID') || '').trim().replace(/^<|>$/g, ''); } catch (e) { mid = ''; }
  if (!mid || /[\s"]/.test(mid)) return null;
  const hits = GmailApp.search('in:sent rfc822msgid:' + mid, 0, 5) || [];
  for (let i = 0; i < hits.length; i++) if (hits[i].getId() === thread.getId()) return true;
  return null;
}

/** A message whose Authentication-Results say DMARC/SPF/DKIM failed is never trusted. */
function failedAuth_(msg) {
  let h = '';
  try { h = String(msg.getHeader('Authentication-Results') || ''); } catch (e) { h = ''; }
  return /\b(dmarc|spf|dkim)=(fail|softfail)\b/i.test(h);
}

// ---------------------------------------------------------------------------------------------------------------
// The 5-minute trigger

function checkReplies() {
  const started = now_();
  const cache = CacheService.getScriptCache();
  if (cache.get('gft:running')) return;
  cache.put('gft:running', '1', 330);
  try {
    const cfg = config_();
    if (!cfg.ready) {
      console.error('Relay is not configured: ' + cfg.problems.join('; '));
      return;
    }
    housekeeping_(started);
    const active = records_().filter(function (r) { return r.status !== 'done'; });
    let handled = 0;
    for (let i = 0; i < active.length; i++) {
      if (handled >= RELAY.MAX_ISSUES_PER_RUN || now_() - started > RELAY.RUN_BUDGET_MS) break;
      handled++;
      try {
        processRecord_(cfg, active[i]);
      } catch (err) {
        console.error('#' + active[i].n + ': ' + (err && err.message));
      }
    }
  } finally {
    cache.remove('gft:running');
  }
}

function recordKey_(n) {
  return 'gft:issue:' + Number(n);
}

function saveRecord_(rec) {
  writeJson_(recordKey_(rec.n), rec);
}

/** Every request the relay opened, oldest first. */
function records_() {
  const all = props_().getProperties();
  const out = [];
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('gft:issue:') !== 0) return;
    try { out.push(JSON.parse(all[k])); } catch (e) { /* ignore a damaged record */ }
  });
  return out.filter(function (r) { return r && r.n; }).sort(function (a, b) { return a.n - b.n; });
}

/** Forget finished requests after 30 days, duplicates after 24 hours; stop watching requests nobody answered. */
function housekeeping_(t) {
  const p = props_();
  const all = p.getProperties();
  Object.keys(all).forEach(function (k) {
    let v;
    try { v = JSON.parse(all[k]); } catch (e) { return; }
    if (k.indexOf('gft:dedupe:') === 0 && (!v || t - Number(v.at || 0) >= RELAY.DAY)) p.deleteProperty(k);
    if (k.indexOf('gft:issue:') === 0 && v) {
      if (v.status === 'done' && t - Number(v.doneAt || v.created || 0) >= RELAY.KEEP_DONE_MS) p.deleteProperty(k);
      else if (v.status !== 'done' && t - Number(v.created || 0) >= RELAY.GIVE_UP_MS) { v.status = 'done'; v.doneAt = t; p.setProperty(k, JSON.stringify(v)); }
    }
  });
}

function markSeen_(rec, id) {
  rec.seen = (rec.seen || []).concat([id]).slice(-RELAY.MAX_IDS);
  if (rec.sentTries) delete rec.sentTries[id];
}

function processRecord_(cfg, rec) {
  rec.relayIds = rec.relayIds || [];
  rec.seen = rec.seen || [];
  rec.forwarded = rec.forwarded || [];
  rec.sentTries = rec.sentTries || {};
  const thread = rec.thread ? GmailApp.getThreadById(rec.thread) : null;
  let state = null;
  const getState = function () {
    if (!state) state = issueState_(cfg, rec.n);
    return state;
  };
  if (thread) handleReplies_(cfg, rec, thread, getState);
  saveRecord_(rec);
  if (rec.status === 'posted') {
    followIssue_(cfg, rec, thread, getState());
  } else if (now_() - Number(rec.polledAt || 0) >= RELAY.POLL_PENDING_MS) {
    // Nothing asked of GitHub yet: only see whether the request was closed there (handled on GitHub directly).
    followIssue_(cfg, rec, thread, state || { issue: gh_(cfg, 'get', issuePath_(cfg, rec.n)) || {}, comments: [] });
  } else {
    return;
  }
  rec.polledAt = now_();
  saveRecord_(rec);
}

/** New answers of the owner in the request's thread → at most one command on GitHub. */
function handleReplies_(cfg, rec, thread, getState) {
  const msgs = thread.getMessages();
  const fresh = [];
  let unconfirmed = false;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    const id = m.getId();
    if (rec.relayIds.indexOf(id) >= 0 || rec.seen.indexOf(id) >= 0) continue;
    if ((m.isDraft && m.isDraft()) || (m.isInTrash && m.isInTrash())) continue;
    const body = String(m.getPlainBody() || '');
    if (MARKER_RE.test(body)) { rec.relayIds = rec.relayIds.concat([id]).slice(-RELAY.MAX_IDS); continue; } // our own notice
    if (addressOf_(m.getFrom()) !== cfg.owner || failedAuth_(m)) { markSeen_(rec, id); continue; } // never act on others
    if (cfg.verifySent && cfg.owner === cfg.me && inSentMail_(m, thread) !== true) {
      // Gmail search can lag a little behind a fresh message: wait a few runs before giving up on it.
      rec.sentTries[id] = (rec.sentTries[id] || 0) + 1;
      if (rec.sentTries[id] >= RELAY.SENT_CHECK_TRIES) { markSeen_(rec, id); unconfirmed = true; }
      continue;
    }
    fresh.push({ id: id, line: firstReplyLine_(body) });
  }
  if (unconfirmed) notify_(cfg, rec, thread, bi_(TXT.notConfirmed));
  if (!fresh.length) return;

  // The newest understood answer wins (the owner may correct himself); unknown answers get the instructions once.
  let cmd = null;
  let unknown = false;
  fresh.forEach(function (f) {
    const c = parseReply_(f.line);
    if (c) cmd = c;
    else unknown = true;
  });
  const seenAll = function () { fresh.forEach(function (f) { markSeen_(rec, f.id); }); };
  if (!cmd) {
    seenAll();
    if (unknown && (rec.hints || 0) < RELAY.MAX_HINTS) {
      rec.hints = (rec.hints || 0) + 1;
      notify_(cfg, rec, thread, bi_(TXT.unknown) + '\n\n' + bi_(TXT.howTo));
    }
    return;
  }

  const st = getState();
  if (st.issue.state === 'closed') {
    seenAll();
    notify_(cfg, rec, thread, bi_(TXT.closed));
    return;
  }
  let text;
  if (cmd.verb === 'reject') {
    text = '/reject';
  } else {
    const check = readCheck_(st);
    if (!check) return; // the bot has not checked the proposal yet: try again on the next run (answers stay unread)
    if (check.badCode) {
      seenAll();
      notify_(cfg, rec, thread, bi_(TXT.badCode));
      return;
    }
    if (cmd.verb === 'approve' && check.deletion && !cmd.skip.length) {
      seenAll();
      notify_(cfg, rec, thread, bi_(TXT.needDeletion));
      return;
    }
    const verb = cmd.verb === 'approve-deletion' && !check.deletion ? 'approve' : cmd.verb;
    text = '/' + verb + ' ' + check.fp + (cmd.skip.length ? ' skip ' + cmd.skip.join(',') : '') + (cmd.force ? ' force' : '');
  }
  if (rec.status === 'posted' && rec.cmd && rec.cmd.text === text && now_() - Number(rec.cmd.at || 0) < RELAY.SAME_COMMAND_MS) {
    seenAll(); // the same command is already on its way
    return;
  }
  const posted = gh_(cfg, 'post', issuePath_(cfg, rec.n) + '/comments', { body: text });
  seenAll();
  rec.cmd = { text: text, id: Number(posted && posted.id) || 0, at: now_() };
  rec.status = 'posted';
}

/** After a command: pass on the bot's answers; notice when the request is closed. */
function followIssue_(cfg, rec, thread, st) {
  const issue = st.issue;
  const labels = labelsOf_(issue);
  if (rec.status === 'posted' && rec.cmd) {
    const after = Number(rec.cmd.id) || 0;
    const replies = st.comments
      .filter(function (c) { return isBot_(c) && Number(c.id) > after && rec.forwarded.indexOf(Number(c.id)) < 0 && /<!-- gft-bot:result[\s>]/.test(String(c.body || '')); })
      .sort(function (a, b) { return Number(a.id) - Number(b.id); });
    for (let i = 0; i < replies.length && rec.status !== 'done'; i++) {
      const c = replies[i];
      rec.forwarded = rec.forwarded.concat([Number(c.id)]).slice(-RELAY.MAX_IDS);
      rec.cmd.answered = true;
      const status = resultStatus_(c.body);
      const text = plainFromMarkdown_(c.body);
      const link = TXT.link[0] + (issue.html_url || 'https://github.com/' + cfg.repo + '/issues/' + rec.n);
      if (status === 'applied') {
        notify_(cfg, rec, thread, bi_(TXT.applied(rec.n)) + '\n\n' + text + '\n\n' + link);
        finish_(rec);
      } else if (status === 'rejected') {
        notify_(cfg, rec, thread, bi_(TXT.rejected(rec.n)));
        finish_(rec);
      } else if (status === 'duplicate' || status === 'already-applied') {
        notify_(cfg, rec, thread, bi_(TXT.botSaid(rec.n)) + '\n\n' + text + '\n\n' + link);
        finish_(rec);
      } else if (status === 'retry') {
        notify_(cfg, rec, thread, bi_(TXT.botSaid(rec.n)) + '\n\n' + text + '\n\n' + bi_(TXT.retry));
      } else {
        // needs-changes, deletion approval required, fingerprint, …: the owner decides again by replying.
        notify_(cfg, rec, thread, bi_(TXT.botSaid(rec.n)) + '\n\n' + text + '\n\n' + bi_(TXT.goOn) + '\n\n' + link);
        rec.status = 'pending';
      }
    }
  }
  if (rec.status === 'posted' && rec.cmd && !rec.cmd.answered && !rec.cmd.nudged && issue.state !== 'closed'
    && now_() - Number(rec.cmd.at || 0) >= RELAY.NO_ANSWER_MS) {
    rec.cmd.nudged = true;
    notify_(cfg, rec, thread, bi_(TXT.noAnswer(rec.n)));
  }
  if (rec.status === 'done' || issue.state !== 'closed') return;
  if (rec.status === 'posted') {
    if (labels.indexOf('applied') >= 0) notify_(cfg, rec, thread, bi_(TXT.applied(rec.n)) + '\n\n' + TXT.link[0] + (issue.html_url || ''));
    else if (rec.cmd && rec.cmd.text === '/reject') notify_(cfg, rec, thread, bi_(TXT.rejected(rec.n)));
    else notify_(cfg, rec, thread, bi_(TXT.closedElsewhere(rec.n)));
  }
  finish_(rec); // closed while nothing was pending from the relay (e.g. handled on GitHub directly): stop quietly
}

function finish_(rec) {
  rec.status = 'done';
  rec.doneAt = now_();
}

// ---------------------------------------------------------------------------------------------------------------
// One-time setup and stopping

/** Run once from the editor: checks the settings and GitHub access, installs the trigger, sends a test e-mail. */
function setup() {
  const cfg = config_();
  if (!cfg.ready) throw new Error('Relay setup: ' + cfg.problems.join('; '));
  let repo;
  try {
    repo = gh_(cfg, 'get', '/repos/' + cfg.repo);
    gh_(cfg, 'get', '/repos/' + cfg.repo + '/issues?per_page=1&state=all');
  } catch (err) {
    throw new Error('Relay setup: GitHub refused access (HTTP ' + (err.status || 'network') + '). Check GITHUB_TOKEN (Issues: Read and write on ' + cfg.repo + ') and REPO.');
  }
  if (repo && repo.has_issues === false) throw new Error('Relay setup: issues are turned off for ' + cfg.repo + ' (Settings → Features → Issues).');
  const mine = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'checkReplies'; });
  for (let i = 1; i < mine.length; i++) ScriptApp.deleteTrigger(mine[i]);
  if (!mine.length) ScriptApp.newTrigger('checkReplies').timeBased().everyMinutes(5).create();
  GmailApp.sendEmail(cfg.owner, '🌳 [GFT] relay is ready · الإرسال بالبريد جاهز', [
    'الإرسال بالبريد لشجرة العائلة جاهز ✓',
    'المستودع: ' + cfg.repo,
    'الخطوة الأخيرة: Deploy ← New deployment ← Web app (Execute as: Me · Who has access: Anyone)، ثم وضع رابط Web app في الخانة relayUrl في ملف config.json.',
    'بعدها يصل كل مقترح في رسالة مثل هذه، ويكفي الرد بكلمة «موافق».',
    '',
    'The family-tree e-mail relay is ready ✓',
    'Repository: ' + cfg.repo,
    'Last step: Deploy → New deployment → Web app (Execute as: Me · Who has access: Anyone), then put the Web app URL into "relayUrl" in config.json.',
    'From then on every proposal arrives in an e-mail like this one; replying "approve" is enough.',
  ].join('\n'));
  console.log('Relay ready for ' + cfg.repo + ' — proposals are mailed to ' + cfg.owner + '.');
  return 'ok';
}

/** Removes the 5-minute trigger (the web app keeps answering until its deployment is archived). */
function stopRelay() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkReplies') ScriptApp.deleteTrigger(t);
  });
  console.log('Relay stopped: replies are no longer read. Also clear "relayUrl" in config.json and archive the deployment.');
  return 'stopped';
}
