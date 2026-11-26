// A visitor's sent proposal whose changes are already in the tree (e.g. the keeper entered them directly)
// is recognised and cleared; "this is me" moves from the pending person to the real record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { store } from '../js/store.js';
import { buildGraph } from '../js/core/graph.js';
import { normalizeData } from '../js/core/schema.js';

const raw = JSON.parse(readFileSync(new URL('../data/family.json', import.meta.url), 'utf8'));
const g = buildGraph(normalizeData(raw));
const essam = g.people().find((p) => p.name.ar === 'عصام' && g.father(p.id)?.name.ar === 'علي');
const zulfa = g.spouses(essam.id).find((s) => s.person.name.ar === 'زلفى').person;
const realAli = g.children(essam.id).find((c) => c.name.ar === 'علي');

function reset() {
  store.setData(raw, { silent: true });
  store.changelog = { entries: [] };
  store.appliedById = {};
  store.justApproved = [];
  store.approved = [];
  store.draft = { id: 'draft000001', ops: [], submitter: { name: '', relation: '', personId: 'new1' }, note: '', dependsOn: [], source: null, updatedAt: '' };
}

const kid = (ref, ar, nick, gender, union) => ({ op: 'add-person', ref, unionRef: union, person: { name: { ar }, nickname: { ar: nick }, gender }, link: { as: 'child', of: essam.id, with: zulfa.id } });
const childrenProposal = { kind: 'gft-proposal', v: 1, id: 'sentkids01', createdAt: '2026-11-25T22:37:00Z', baseRevision: 1, dependsOn: [], submitter: {}, note: '',
  ops: [kid('new1', 'علي', 'أبو دان', 'm', 'newu2'), kid('new3', 'علياء', 'أم هاشم', 'f', 'newu4'), kid('new5', 'علاء', 'أبو رند', 'm', 'newu6')] };
const deathProposal = { kind: 'gft-proposal', v: 1, id: 'sentdeath1', createdAt: '2026-11-25T22:49:00Z', baseRevision: 1, dependsOn: [], submitter: {}, note: '',
  ops: [{ op: 'mark', id: essam.id, mark: 'deceased', date: '2026-02-02' }] };

test('sent proposals already reflected in the tree are cleared and "me" moves to the real person', () => {
  reset();
  store.sent = [
    { id: childrenProposal.id, at: '2026-11-25T22:37:00Z', via: 'github', proposal: childrenProposal },
    { id: deathProposal.id, at: '2026-11-25T22:49:00Z', via: 'github', proposal: deathProposal },
  ];
  store.me = 'new1';
  store.reconcileSent();
  assert.equal(store.sent.length, 0);
  assert.equal(store.me, realAli.id);
  assert.equal(store.draft.submitter.personId, realAli.id);
  assert.equal(store.justApproved.length, 2);
  store.recompute();
  assert.equal(g.children(essam.id).length, store.working.children(essam.id).length, 'no duplicate children shown');
});

test('a sent proposal that is NOT in the tree yet stays pending', () => {
  reset();
  const other = { ...childrenProposal, id: 'sentnew001', ops: [{ ...kid('new9', 'يوسف', '', 'm', 'newu10') }] };
  const otherDeath = { ...deathProposal, id: 'sentdeath2', ops: [{ op: 'mark', id: essam.id, mark: 'deceased', date: '2026-03-01' }] };
  store.sent = [{ id: other.id, at: '', via: 'github', proposal: other }, { id: otherDeath.id, at: '', via: 'github', proposal: otherDeath }];
  store.me = null;
  store.reconcileSent();
  assert.deepEqual(store.sent.map((s) => s.id), ['sentnew001', 'sentdeath2']);
});
