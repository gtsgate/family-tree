// Tests for js/views/home-tree.js — the home page family trees: who appears on each tree for each option, the
// trunk (founder + single line of ancestors), marriages joining two families, and the layout guarantee that
// leaves and name tags never overlap (real data with every option, and a synthetic family of 300 men).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { normalizeData } from '../js/core/schema.js';
import { buildGraph } from '../js/core/graph.js';
import { personName } from '../js/core/names.js';
import { familyTrees, familyBridges, layoutFamily } from '../js/views/home-tree.js';

const raw = JSON.parse(readFileSync(fileURLToPath(new URL('../data/family.json', import.meta.url)), 'utf8'));
const G = buildGraph(normalizeData(raw));
const ALL = { mothers: true, wives: true, daughters: true, others: true };

/** Every item of a tree (crown, depth-first) + the trunk's side shoots. */
function itemsOf(fam) {
  const out = [];
  const walk = (items) => { for (const it of items) { out.push(it); if (it.children) walk(it.children); } };
  walk(fam.items);
  for (const s of fam.side) out.push(...s.items);
  return out;
}
const names = (list) => list.map((x) => personName(x.p || x, 'ar'));

/** Oriented boxes exactly as the layout reserves them; true when two of them intersect. */
function overlaps(lay) {
  const box = (it) => {
    const leaf = it.kind === 'leaf';
    const w = leaf ? it.L * 0.94 + 3 : it.w + 6;
    const h = leaf ? it.H * 0.86 + 3 : it.h + 6;
    const a = leaf ? Math.atan2(it.axis[1], it.axis[0]) : 0;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [it.x + x * c - y * s, it.y + x * s + y * c]);
  };
  const axes = (P) => [0, 1].map((i) => { const dx = P[i + 1][0] - P[i][0]; const dy = P[i + 1][1] - P[i][1]; const l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; });
  const apart = (A, B) => [...axes(A), ...axes(B)].some((ax) => {
    const a = A.map((q) => q[0] * ax[0] + q[1] * ax[1]);
    const b = B.map((q) => q[0] * ax[0] + q[1] * ax[1]);
    return Math.max(...a) <= Math.min(...b) + 1e-6 || Math.max(...b) <= Math.min(...a) + 1e-6;
  });
  const boxes = lay.items.map(box);
  const bad = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (!apart(boxes[i], boxes[j])) bad.push([lay.items[i].text, lay.items[j].text]);
  return bad;
}

describe('familyTrees — real data', () => {
  const fams = familyTrees(G, {});
  test('one tree per family branch, titled «آل عالم» / «آل محمود»', () => {
    assert.equal(fams.length, 2);
    assert.deepEqual(fams.map((f) => f.family.ar), ['آل عالم', 'آل محمود']);
    assert.deepEqual(fams.map((f) => f.family.en), ['The Alam family', 'The Mahmoud family']);
  });
  test('the trunk carries the founder and the single line above him: سالم ← حسن ← محمد', () => {
    const [alam, mahmoud] = fams;
    assert.deepEqual(names(alam.chain), ['سالم', 'حسن', 'محمد']);
    assert.equal(personName(alam.top, 'ar'), 'محمد');
    assert.deepEqual(names(mahmoud.chain), ['محمد علي']);
  });
  test('by default only the men: sons with sons are name tags, the others leaves', () => {
    for (const fam of fams) {
      const items = itemsOf(fam);
      assert.ok(items.length > 0);
      assert.ok(items.every((it) => it.cat === 'man' && it.p.gender === 'm'));
      for (const it of items) {
        const hasSons = G.children(it.p.id).some((c) => c.gender === 'm');
        assert.equal(it.kind === 'tag', hasSons, `${personName(it.p, 'ar')}: tag iff he has sons`);
      }
    }
    // every man of the male line appears exactly once (on the trunk or in the crown)
    for (const fam of fams) {
      const ids = [...fam.chain, ...itemsOf(fam).map((it) => it.p)].map((p) => p.id);
      assert.equal(new Set(ids).size, ids.length);
      assert.equal(ids.length, fam.stats.men);
    }
  });
  test('options add mothers, wives (no children recorded), daughters and others', () => {
    const [alam, mahmoud] = familyTrees(G, ALL);
    const a = itemsOf(alam);
    const byId = (items, id) => items.filter((it) => it.p.id === id);
    // فايزة: mother of علي's children; سوسن: عصام's wife with no children recorded → "wives"
    assert.equal(byId(a, 'p10p5jzy')[0]?.cat, 'mother');
    assert.equal(byId(a, 'po3n142y')[0]?.cat, 'wife');
    assert.ok(a.some((it) => it.cat === 'daughter'));
    // علاء: a child whose gender is not recorded → "others"
    assert.equal(byId(itemsOf(mahmoud), 'po3uyog1')[0]?.cat, 'other');
    // daughters' husbands come with "others" (never a man who is already on a male line)
    assert.ok(a.some((it) => it.cat === 'other' && it.husband));
    const lines = new Set(familyTrees(G, {}).flatMap((f) => [...f.chain, ...itemsOf(f).map((it) => it.p)]).map((p) => p.id));
    assert.ok(itemsOf(alam).concat(itemsOf(mahmoud)).filter((it) => it.husband).every((it) => !lines.has(it.p.id)));
    // only mothers
    const only = itemsOf(familyTrees(G, { mothers: true })[0]);
    assert.ok(only.some((it) => it.cat === 'mother') && only.every((it) => it.cat === 'man' || it.cat === 'mother'));
    assert.ok(!only.some((it) => it.p.id === 'po3n142y'), 'a wife without children is not a mother');
  });
  test('counts: men of the line, women around them', () => {
    const [alam] = fams;
    assert.equal(alam.stats.men, 17);
    assert.ok(alam.stats.women > 0 && alam.stats.gens === 6);
  });
  test('the marriage of علي (آل عالم) and فايزة (آل محمود) joins the two families', () => {
    const bridges = familyBridges(G, fams);
    assert.equal(bridges.length, 1);
    assert.equal(personName(bridges[0].husband, 'ar'), 'علي');
    assert.equal(bridges[0].wife.id, 'p10p5jzy');
    assert.deepEqual([bridges[0].from, bridges[0].to], [0, 1]);
  });
});

describe('layoutFamily', () => {
  test('real data, every option, both languages and directions: no leaf or tag overlaps another', () => {
    for (const [lang, rtl] of [['ar', true], ['en', false]]) {
      for (const fam of familyTrees(G, ALL)) {
        const lay = layoutFamily(fam, { rtl, lang });
        assert.ok(lay.items.length > 20);
        assert.deepEqual(overlaps(lay), []);
        assert.ok(lay.items.every((it) => Number.isFinite(it.x) && Number.isFinite(it.y)));
        assert.ok(lay.bbox.w > 0 && lay.bbox.h > 0);
      }
    }
  });
  test('deterministic, and the first-born son is on the right in Arabic, on the left in English', () => {
    const fam = familyTrees(G, {})[1];
    const a = layoutFamily(fam, { rtl: true, lang: 'ar' });
    const b = layoutFamily(familyTrees(G, {})[1], { rtl: true, lang: 'ar' });
    assert.deepEqual(a.items.map((it) => [it.x, it.y]), b.items.map((it) => [it.x, it.y]));
    const first = fam.items.find((it) => it.p.gender === 'm');
    const last = [...fam.items].reverse().find((it) => it.p.gender === 'm');
    const x = (lay, p) => lay.items.find((it) => it.p.id === p.p.id).x;
    assert.ok(x(a, first) > x(a, last));
    const en = layoutFamily(familyTrees(G, {})[1], { rtl: false, lang: 'en' });
    assert.ok(x(en, first) < x(en, last));
  });
  test('a family of 300 men (and their wives and daughters) still lays out without overlaps, quickly', () => {
    const people = {};
    const unions = {};
    let n = 0;
    let seed = 11;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const MEN = ['أحمد', 'محمد', 'علي', 'حسن', 'عبدالرحمن', 'خالد', 'يوسف', 'إبراهيم', 'عمر', 'طارق', 'فيصل', 'عبدالله'];
    const WOMEN = ['فاطمة', 'مريم', 'زينب', 'نورة', 'سارة', 'هند', 'أمل'];
    const person = (ar, gender) => { const id = `p${String(++n).padStart(7, '0')}`; people[id] = { id, name: { ar }, gender }; return id; };
    let frontier = [person('سالم', 'm')];
    let men = 1;
    while (men < 300) {
      const next = [];
      for (const father of frontier) {
        if (men >= 300) break;
        const wife = person(WOMEN[Math.floor(rnd() * WOMEN.length)], 'f');
        const children = [];
        for (let i = 1 + Math.floor(rnd() * 4); i > 0 && men < 300; i--) { const c = person(MEN[Math.floor(rnd() * MEN.length)], 'm'); children.push(c); next.push(c); men++; }
        for (let i = Math.floor(rnd() * 3); i > 0; i--) children.push(person(WOMEN[Math.floor(rnd() * WOMEN.length)], 'f'));
        const uid = `u${String(++n).padStart(7, '0')}`;
        unions[uid] = { id: uid, partners: [father, wife], children, status: 'married' };
      }
      frontier = next;
    }
    const g = buildGraph(normalizeData({ schema: raw.schema, meta: { ...raw.meta, rootPersonId: 'p0000001' }, people, unions }));
    for (const show of [{}, ALL]) {
      const [fam] = familyTrees(g, show);
      assert.equal(fam.stats.men, 300);
      const t0 = Date.now();
      const lay = layoutFamily(fam, { rtl: true, lang: 'ar' });
      assert.ok(Date.now() - t0 < 5000, `layout took ${Date.now() - t0} ms`);
      assert.deepEqual(overlaps(lay), []);
      // a round crown, not a thin fan: roughly as tall as it is wide
      assert.ok(lay.bbox.h > lay.bbox.w * 0.45, `crown ${Math.round(lay.bbox.w)}×${Math.round(lay.bbox.h)}`);
    }
  });
});
