// «إخفاء الكنية» — the per-person hideKunya flag (docs/SPEC.md §2.1, §3.3): stored form, validation, edit-person
// (incl. STALE_EDIT), merge, display (no recorded or automatic kunya; people shown BY their kunya get the polite
// relational label), describe lines in both languages, and search still finding a recorded nickname.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  normalizePerson, compactPerson, normalizeData, validateData, serializeData, PERSON_FIELDS, applyPersonSet,
} from '../js/core/schema.js';
import { applyProposal, validateProposal } from '../js/core/ops.js';
import { buildGraph } from '../js/core/graph.js';
import { displayName, fullName, nickOf, lineageName, initials, autoKunya } from '../js/core/names.js';
import { describeOp, refNames } from '../js/core/describe.js';
import { fieldLabel } from '../js/core/messages.js';

const NOW = '2026-11-28T10:00:00Z';
const proposal = (ops) => ({
  kind: 'gft-proposal', v: 1, id: 'hidekunya01', createdAt: NOW, baseRevision: 1, dependsOn: [],
  submitter: { name: '', relation: '', personId: '' }, note: '', ops,
});
const final = (data, ops, opts = {}) => applyProposal(data, proposal(ops), { mode: 'final', now: NOW, issue: null, actor: 'keeper', ...opts });
const preview = (data, ops) => applyProposal(data, proposal(ops), { mode: 'preview', now: NOW });

//   خالد p0001 ═ فاطمة p0002 → أحمد p0003 (eldest son), سارة p0004
//   أبو سعيد p0005 (kunya only, known) — father of سعيد p0006
//   p0007: withheld name, kunya «أم سعيد», wife of أبو سعيد
function fixture() {
  return {
    schema: 1,
    meta: { title: { ar: 'اختبار', en: 'Test' }, rootPersonId: 'p0001', revision: 1, updatedAt: NOW },
    people: {
      p0001: { id: 'p0001', name: { ar: 'خالد' }, surname: { ar: 'عالم' }, gender: 'm' },
      p0002: { id: 'p0002', name: { ar: 'فاطمة' }, gender: 'f', nickname: { ar: 'أم أحمد' } },
      p0003: { id: 'p0003', name: { ar: 'أحمد' }, gender: 'm', birth: { date: '1980' } },
      p0004: { id: 'p0004', name: { ar: 'سارة' }, gender: 'f', birth: { date: '1982' } },
      p0005: { id: 'p0005', nickname: { ar: 'أبو سعيد' }, gender: 'm', surname: { ar: 'محمود' } },
      p0006: { id: 'p0006', name: { ar: 'سعيد' }, gender: 'm' },
      p0007: { id: 'p0007', nameStatus: 'withheld', nickname: { ar: 'أم سعيد' }, gender: 'f' },
    },
    unions: {
      u0001: { id: 'u0001', partners: ['p0001', 'p0002'], children: ['p0003', 'p0004'], status: 'married' },
      u0002: { id: 'u0002', partners: ['p0005', 'p0007'], children: ['p0006'], status: 'married' },
    },
  };
}
const withHidden = (ids) => {
  const d = fixture();
  for (const id of ids) d.people[id].hideKunya = true;
  return d;
};
const graphOf = (d) => buildGraph(normalizeData(d));

describe('hideKunya: data model', () => {
  test('default false; compact drops false and keeps true; key right after the nickname', () => {
    assert.equal(normalizePerson({ id: 'p0001' }).hideKunya, false);
    assert.equal('hideKunya' in compactPerson({ id: 'p0001', name: { ar: 'خالد' }, hideKunya: false }), false);
    const c = compactPerson({ id: 'p0001', name: { ar: 'خالد' }, nickname: { ar: 'أبو أحمد' }, hideKunya: true, gender: 'm' });
    assert.equal(c.hideKunya, true);
    assert.deepEqual(Object.keys(c), ['id', 'name', 'nickname', 'hideKunya', 'gender']);
    assert.equal(PERSON_FIELDS.indexOf('hideKunya'), PERSON_FIELDS.indexOf('nickname') + 1);
  });
  test('normalizePerson keeps a real boolean only', () => {
    assert.equal(normalizePerson({ id: 'p0001', hideKunya: 'yes' }).hideKunya, false);
    assert.equal(normalizePerson({ id: 'p0001', hideKunya: 1 }).hideKunya, false);
    assert.equal(normalizePerson({ id: 'p0001', hideKunya: true }).hideKunya, true);
  });
  test('validateData type-checks it', () => {
    assert.equal(validateData(withHidden(['p0001'])).ok, true);
    const bad = fixture();
    bad.people.p0001.hideKunya = 'yes';
    const v = validateData(bad);
    assert.equal(v.ok, false);
    assert.deepEqual(v.errors.map((e) => [e.code, e.path]), [['BAD_TYPE', 'people.p0001.hideKunya']]);
  });
  test('stored data round-trips (serializeData)', () => {
    const text = serializeData(normalizeData(withHidden(['p0003'])));
    assert.match(text, /"hideKunya": true/);
    assert.equal(normalizeData(JSON.parse(text)).people.p0003.hideKunya, true);
    assert.equal(applyPersonSet(normalizePerson({ id: 'p0001' }), { hideKunya: true }).hideKunya, true);
  });
});

describe('hideKunya: ops', () => {
  test('edit-person sets and clears it (history, compact form)', () => {
    let r = final(fixture(), [{ op: 'edit-person', id: 'p0001', set: { hideKunya: true }, before: { hideKunya: false } }]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.data.people.p0001.hideKunya, true);
    assert.deepEqual(r.data.people.p0001.history.map((x) => x.action), ['edit-person']);
    r = final(r.data, [{ op: 'edit-person', id: 'p0001', set: { hideKunya: false }, before: { hideKunya: true } }]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.data.people.p0001.hideKunya, false);
    assert.equal('hideKunya' in compactPerson(r.data.people.p0001), false);
  });
  test('STALE_EDIT: an error in final mode, a warning in preview', () => {
    const ops = [{ op: 'edit-person', id: 'p0001', set: { hideKunya: false }, before: { hideKunya: true } }];
    const r = final(fixture(), ops);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors.map((e) => e.code), ['STALE_EDIT']);
    assert.deepEqual(r.errors[0].params, { id: 'p0001', path: 'hideKunya', expected: true, actual: false });
    const pv = preview(fixture(), ops);
    assert.equal(pv.ok, true);
    assert.ok(pv.warnings.some((w) => w.code === 'STALE_EDIT'));
    assert.equal(final(fixture(), ops, { force: true }).ok, true);
  });
  test('a non-boolean value is refused; add-person accepts it', () => {
    const v = validateProposal(proposal([{ op: 'edit-person', id: 'p0001', set: { hideKunya: 'yes' } }]));
    assert.deepEqual(v.errors.map((e) => [e.code, e.params.field]), [['BAD_TYPE', 'set.hideKunya']]);
    const bad = validateProposal(proposal([{ op: 'add-person', ref: 'new1', person: { name: { ar: 'زيد' }, gender: 'm', hideKunya: 1 }, link: { as: 'child', of: 'p0003' } }]));
    assert.ok(bad.errors.some((e) => e.code === 'BAD_TYPE' && e.params.field === 'person.hideKunya'));
    const r = final(fixture(), [{ op: 'add-person', ref: 'new1', person: { name: { ar: 'زيد' }, gender: 'm', hideKunya: true }, link: { as: 'child', of: 'p0003' } }]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.data.people[r.idMap.new1].hideKunya, true);
  });
  test('merge: a kunya hidden on either record stays hidden', () => {
    const d = fixture();
    d.people.p0008 = { id: 'p0008', name: { ar: 'سارة' }, gender: 'f', hideKunya: true };
    const r = final(d, [{ op: 'merge-person', keep: 'p0004', remove: 'p0008', reasonCode: 'duplicate' }], { allowDestructive: true });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.data.people.p0004.hideKunya, true);
  });
});

describe('hideKunya: display', () => {
  test('a known name: neither the recorded nor the automatic kunya is shown', () => {
    const g0 = graphOf(fixture());
    assert.equal(displayName(g0.person('p0001'), 'ar', g0), 'خالد (أبو أحمد)');
    assert.equal(displayName(g0.person('p0002'), 'ar', g0), 'فاطمة (أم أحمد)');
    const g = graphOf(withHidden(['p0001', 'p0002']));
    for (const id of ['p0001', 'p0002']) {
      assert.equal(nickOf(g.person(id), 'ar', g), '');
      assert.equal(nickOf(g.person(id), 'en', g), '');
    }
    assert.equal(displayName(g.person('p0001'), 'ar', g), 'خالد');
    assert.equal(displayName(g.person('p0001'), 'en', g), 'Khalid');
    assert.equal(displayName(g.person('p0002'), 'ar', g), 'فاطمة');
    assert.equal(fullName(g.person('p0002'), 'ar', g), 'فاطمة');
    assert.equal(fullName(g.person('p0001'), 'ar', g), 'خالد عالم');
    // the automatic kunya is still computed (the edit form shows it as a hint)
    assert.equal(autoKunya(g.person('p0001'), 'ar', g), 'أبو أحمد');
  });
  test('people shown BY their kunya fall back to the polite relational label', () => {
    const g0 = graphOf(fixture());
    assert.equal(displayName(g0.person('p0005'), 'ar', g0), 'أبو سعيد');
    assert.equal(displayName(g0.person('p0007'), 'ar', g0), 'أم سعيد');
    const g = graphOf(withHidden(['p0005', 'p0007']));
    // kunya-only (known) father → "father of …" (the son carries the family name); the withheld mother likewise
    // (her husband has no name to show any more)
    assert.equal(displayName(g.person('p0005'), 'ar', g), 'والد سعيد محمود');
    assert.equal(displayName(g.person('p0005'), 'en', g), 'Father of Saeed Mahmoud');
    assert.equal(displayName(g.person('p0007'), 'ar', g), 'والدة سعيد محمود');
    assert.equal(displayName(g.person('p0007'), 'en', g), 'Mother of Saeed Mahmoud');
    // the son's lineage stops at a father who has no name to show
    assert.equal(lineageName(g, 'p0006', 'ar'), 'سعيد محمود');
    assert.equal(initials(g.person('p0005'), 'ar'), '');
  });
  test('relatives are named in labels without their hidden kunya', () => {
    const d = fixture();
    d.unions.u0002.children = []; // the withheld wife is then named after her husband …
    delete d.people.p0006;
    d.people.p0007.hideKunya = true;
    let g = graphOf(d);
    assert.equal(displayName(g.person('p0007'), 'ar', g), 'حرم أبي سعيد محمود');
    d.people.p0005.hideKunya = true; // … unless his kunya is hidden too
    g = graphOf(d);
    assert.equal(displayName(g.person('p0007'), 'ar', g), 'غير معروف');
  });
});

describe('hideKunya: describe lines', () => {
  const g = graphOf(fixture());
  const both = (op) => ['ar', 'en'].map((l) => describeOp(op, { graph: g, refNames: refNames([op], g) }, l));
  test('«إخفاء كنية X» / "Hide the kunya of X", «إظهار كنية X» / "Show the kunya of X"', () => {
    assert.deepEqual(both({ op: 'edit-person', id: 'p0001', set: { hideKunya: true } }), ['إخفاء كنية خالد عالم', 'Hide the kunya of Khalid Alam']);
    assert.deepEqual(both({ op: 'edit-person', id: 'p0001', set: { hideKunya: false } }), ['إظهار كنية خالد عالم', 'Show the kunya of Khalid Alam']);
  });
  test('together with other changes: the generic edit line ends with the kunya change', () => {
    const [ar, en] = both({ op: 'edit-person', id: 'p0001', set: { 'occupation.ar': 'معلم', hideKunya: true } });
    assert.equal(ar, 'تعديل بيانات خالد عالم: المهنة بالعربية: «معلم»؛ مع إخفاء الكنية');
    assert.equal(en, 'Edit Khalid Alam: occupation (Arabic): “معلم”; the kunya is hidden');
  });
  test('a new person shown only by a kunya that is hidden: the kunya is not quoted as their name', () => {
    const op = (hideKunya) => ({ op: 'add-person', ref: 'new1', person: { nameStatus: 'withheld', nickname: { ar: 'أم سعيد' }, gender: 'f', ...(hideKunya ? { hideKunya: true } : {}) }, link: { type: 'spouse', of: 'p0001' } });
    const [shownAr] = both(op(false));
    assert.match(shownAr, /«أم سعيد»/);
    for (const text of both(op(true))) assert.doesNotMatch(text, /سعيد|Saeed|Said/);
  });
  test('field label in both languages', () => {
    assert.equal(fieldLabel('hideKunya', 'ar'), 'إخفاء الكنية');
    assert.equal(fieldLabel('set.hideKunya', 'en'), 'kunya hidden');
  });
});

describe('hideKunya: search still finds a recorded nickname', () => {
  test('fixture: «أبو سعيد» and «أم أحمد» are found although hidden', () => {
    const g = graphOf(withHidden(['p0005', 'p0002']));
    assert.equal(g.search('أبو سعيد')[0]?.person.id, 'p0005');
    assert.ok(g.search('أم أحمد').some((r) => r.person.id === 'p0002'));
  });
  test('real data: a recorded nickname hidden on one person', () => {
    const raw = JSON.parse(readFileSync(fileURLToPath(new URL('../data/family.json', import.meta.url)), 'utf8'));
    const id = Object.keys(raw.people).find((k) => raw.people[k].nickname?.ar === 'بيبي');
    assert.ok(id, 'fixture person with nickname بيبي');
    raw.people[id].hideKunya = true;
    const g = buildGraph(normalizeData(raw));
    assert.ok(g.search('بيبي').some((r) => r.person.id === id));
    assert.equal(displayName(g.person(id), 'ar', g).includes('بيبي'), false);
  });
});
