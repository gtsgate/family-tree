#!/usr/bin/env node
// Validate the portal's data files (docs/SPEC.md §2.3, §6.4, §6.6) — run by CI and before committing by hand.
//
//   node scripts/validate-data.mjs [--file data/family.json] [--json] [--strict]
//
// Errors (exit code 1): family.json invariants (schema.js validateData), unreadable JSON, wrong ledger shapes,
// config.json without approvers. Warnings are printed but do not fail (with --strict, a non-canonical family.json
// formatting fails too). config.json "home" (home-page settings) naming unknown people or non-trees → warnings.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateData, normalizeData, serializeData } from '../js/core/schema.js';
import { formatIssue } from '../js/core/messages.js';
import { buildGraph } from '../js/core/graph.js';
import { portalPaths, parseArgs, isMain, CHANGELOG_MAX, PORTAL_DIR } from './lib/context.mjs';
import { runCli } from './lib/cli.mjs';

function readJson(file, problems, label) {
  if (!existsSync(file)) { problems.push(`${label}: file not found (${file})`); return { value: undefined, text: '' }; }
  const text = readFileSync(file, 'utf8');
  try {
    return { value: JSON.parse(text), text };
  } catch (e) {
    problems.push(`${label}: not valid JSON (${e.message})`);
    return { value: undefined, text };
  }
}

/**
 * config.json "home" (home-page settings, SPEC §5.1/§6.1): {hiddenTrees: [person ids], hiddenBridges: ["<husbandId>|<wifeId>"],
 * shownBridges: ["<husbandId>|<wifeId>"]}.
 * Unknown or removed people (a stale entry hides nothing) and wrong shapes → warnings. `data` = raw family.json or undefined.
 */
export function homeConfigWarnings(home, data, graph = null) {
  const out = [];
  if (home === undefined) return out;
  if (!home || typeof home !== 'object' || Array.isArray(home)) return ['"home" must be an object {hiddenTrees, hiddenBridges}'];
  const people = data && typeof data.people === 'object' && data.people ? data.people : null;
  const active = (id) => !people || (Object.prototype.hasOwnProperty.call(people, id) && people[id] && !people[id].removed);
  const unions = data && typeof data.unions === 'object' && data.unions ? Object.values(data.unions) : null;
  const married = (a, b) => !unions || unions.some((u) => u && !u.removed && Array.isArray(u.partners) && u.partners.includes(a) && u.partners.includes(b));
  for (const k of Object.keys(home)) if (!['hiddenTrees', 'hiddenBridges', 'shownBridges'].includes(k)) out.push(`"home.${k}" is not a known setting (ignored)`);
  const list = (k) => {
    const v = home[k];
    if (v === undefined) return [];
    if (!Array.isArray(v)) { out.push(`"home.${k}" must be a list`); return []; }
    return v.filter((x, i) => { if (typeof x === 'string' && x) return true; out.push(`"home.${k}" entry ${i} is not a string`); return false; });
  };
  // A tree is hidden by its head (founder) or a man of its trunk (the single line of sons above him) — home-tree.js.
  let trunks = null;
  try {
    if (graph) {
      trunks = new Set();
      for (const b of graph.branches() || []) {
        let cur = b?.person;
        for (let guard = 0; cur && guard < 200 && !trunks.has(cur.id); guard++) {
          trunks.add(cur.id);
          const sons = (graph.children(cur.id) || []).filter((c) => c && c.gender === 'm');
          cur = sons.length === 1 ? sons[0] : null;
        }
      }
    }
  } catch { trunks = null; }
  for (const id of list('hiddenTrees')) {
    if (!/^p[a-z0-9]{3,24}$/.test(id)) out.push(`"home.hiddenTrees": ${JSON.stringify(id)} is not a person id`);
    else if (!active(id)) out.push(`"home.hiddenTrees": unknown person ${id} (hides nothing)`);
    else if (trunks && !trunks.has(id)) out.push(`"home.hiddenTrees": ${id} is not the founder of a family tree (hides nothing)`);
  }
  for (const [k, does] of [['hiddenBridges', 'hides'], ['shownBridges', 'shows']]) {
    for (const key of list(k)) {
      const [a, b, ...rest] = key.split('|');
      if (rest.length || !/^p[a-z0-9]{3,24}$/.test(a || '') || !/^p[a-z0-9]{3,24}$/.test(b || '')) out.push(`"home.${k}": ${JSON.stringify(key)} is not "<husbandId>|<wifeId>"`);
      else if (!active(a) || !active(b)) out.push(`"home.${k}": unknown person in ${key} (${does} nothing)`);
      else if (!married(a, b)) out.push(`"home.${k}": ${key} are not a married couple (${does} nothing)`);
    }
  }
  return out;
}

/** → {ok, errors: string[], warnings: string[], stats} */
export function validateAll({ portalDir = PORTAL_DIR, file = null, strict = false } = {}) {
  const p = portalPaths(portalDir);
  const errors = [];
  const warnings = [];
  const stats = {};

  const dataFile = file ? resolve(file) : p.data;
  const { value: raw, text } = readJson(dataFile, errors, 'family.json');
  let graph = null;
  if (raw !== undefined) {
    const v = validateData(raw);
    try { graph = buildGraph(normalizeData(raw)); } catch { graph = null; }
    const ctx = { graph, withOp: false };
    for (const e of v.errors) errors.push(`family.json: [${e.code}] ${formatIssue(e, 'en', ctx)}${e.path ? ` (${e.path})` : ''}`);
    for (const w of v.warnings) warnings.push(`family.json: [${w.code}] ${formatIssue(w, 'en', ctx)}${w.path ? ` (${w.path})` : ''}`);
    if (v.ok) {
      const canonical = serializeData(normalizeData(raw));
      if (canonical !== text) (strict ? errors : warnings).push('family.json: not in canonical form (serializeData) — it is rewritten on the next apply');
      stats.people = Object.keys(raw.people || {}).length;
      stats.unions = Object.keys(raw.unions || {}).length;
      stats.revision = raw.meta?.revision ?? 0;
    }
  }

  if (!file) {
    const { value: changelog } = readJson(p.changelog, errors, 'changelog.json');
    if (changelog !== undefined) {
      if (!changelog || typeof changelog !== 'object' || !Array.isArray(changelog.entries)) errors.push('changelog.json: must be {"entries": [...]}');
      else {
        if (changelog.entries.length > CHANGELOG_MAX) warnings.push(`changelog.json: ${changelog.entries.length} entries (max ${CHANGELOG_MAX}; trimmed on the next apply)`);
        changelog.entries.forEach((e, i) => {
          if (!e || typeof e !== 'object') errors.push(`changelog.json: entry ${i} is not an object`);
          else if (!Number.isFinite(Number(e.issue)) || typeof e.at !== 'string') errors.push(`changelog.json: entry ${i} needs "issue" and "at"`);
        });
        stats.changelog = changelog.entries.length;
      }
    }
    const { value: applied } = readJson(p.applied, errors, 'applied.json');
    if (applied !== undefined) {
      if (!applied || typeof applied !== 'object' || Array.isArray(applied)) errors.push('applied.json: must be an object {hash: entry}');
      else {
        for (const [hash, e] of Object.entries(applied)) {
          if (!/^[0-9a-f]{64}$/.test(hash)) errors.push(`applied.json: key ${hash.slice(0, 20)}… is not a SHA-256 hex hash`);
          if (!e || typeof e !== 'object' || !Number.isFinite(Number(e.issue))) errors.push(`applied.json: entry ${hash.slice(0, 8)} needs "issue"`);
        }
        stats.applied = Object.keys(applied).length;
      }
    }
    const { value: config } = readJson(p.config, errors, 'config.json');
    if (config !== undefined) {
      if (!Array.isArray(config.approvers) || !config.approvers.length) errors.push('config.json: "approvers" must list at least one GitHub login');
      if (!config.repo?.owner || !config.repo?.name) warnings.push('config.json: "repo.owner"/"repo.name" missing (the site links to GitHub with them)');
      if (!config.siteUrl) warnings.push('config.json: "siteUrl" missing (bot comments derive it from the repository name)');
      if (config.relayUrl && !/^https:\/\/[^\s"'<>]+$/.test(String(config.relayUrl).trim())) {
        warnings.push('config.json: "relayUrl" must be the https Web app URL of the e-mail relay (the site ignores it otherwise)');
      }
      for (const w of homeConfigWarnings(config.home, raw, graph)) warnings.push(`config.json: ${w}`);
    }
  }
  return { ok: errors.length === 0, errors, warnings, stats };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const strict = args.rest.includes('--strict');
  const res = validateAll({ file: args.file, strict });
  if (args.json) {
    console.log(JSON.stringify(res, null, 2));
    return res.ok ? 0 : 1;
  }
  for (const w of res.warnings.slice(0, 50)) console.log(`warning: ${w}`);
  if (res.warnings.length > 50) console.log(`… and ${res.warnings.length - 50} more warnings`);
  for (const e of res.errors) console.error(`error: ${e}`);
  const s = res.stats;
  console.log(`${res.ok ? 'OK' : 'FAILED'} — ${s.people ?? '?'} people, ${s.unions ?? '?'} unions, revision ${s.revision ?? '?'}; `
    + `${res.errors.length} error(s), ${res.warnings.length} warning(s)`);
  return res.ok ? 0 : 1;
}

if (isMain(import.meta.url)) runCli(main);
