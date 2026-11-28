// Tests for js/views/home-tree.js — the home page family trees: who appears on each tree for each option, the
// trunk (founder + single line of ancestors), which families are drawn (a crown) and which are only named, marriages
// joining two families, the home-page settings, and the layout guarantee that leaves and name tags never overlap
// (real data with every option, and a synthetic family of 300 men).
//
// The keeper keeps adding families (those of people who married in), so nothing here depends on how many families
// the real data has: assertions about آل عالم / آل محمود use the first two families; the invariants hold for every one.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { normalizeData } from '../js/core/schema.js';
import { buildGraph } from '../js/core/graph.js';
import { personName } from '../js/core/names.js';
import { familyTrees, familyBridges, layoutFamily, homeView, homeHidden, bridgeKey, bridgeHiddenBy, bridgeShownBy, bridgeToggle, treeHiddenBy, canHideTree, canHideBridge, hasCrown } from '../js/views/home-tree.js';
import { patchHome } from '../js/owner.js';

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
  const famsAll = familyTrees(G, ALL);
  const sonsOf = (p) => G.children(p.id).filter((c) => c.gender === 'm');
  test('one tree per family branch, titled from branches(); the first two are «آل عالم» / «آل محمود»', () => {
    const br = G.branches();
    assert.ok(br.length >= 2);
    assert.equal(fams.length, br.length);
    fams.forEach((f, i) => {
      assert.equal(f.index, i);
      assert.equal(f.head.id, br[i].person.id);
      assert.deepEqual(f.family, br[i].family);
    });
    assert.deepEqual(fams.slice(0, 2).map((f) => f.family.ar), ['آل عالم', 'آل محمود']);
    assert.deepEqual(fams.slice(0, 2).map((f) => f.family.en), ['The Alam family', 'The Mahmoud family']);
  });
  test('the trunk carries the founder and the single line above him: سالم ← حسن ← محمد', () => {
    const [alam, mahmoud] = fams;
    assert.deepEqual(names(alam.chain), ['سالم', 'حسن', 'محمد']);
    assert.equal(personName(alam.top, 'ar'), 'محمد');
    assert.deepEqual(names(mahmoud.chain), ['محمد علي']);
  });
  test('every trunk: the founder, then each man’s only son, up to the first man with no son or several', () => {
    for (const fam of fams) {
      assert.equal(fam.chain[0].id, fam.head.id);
      assert.equal(fam.chain[fam.chain.length - 1].id, fam.top.id);
      for (let i = 0; i < fam.chain.length - 1; i++) assert.deepEqual(sonsOf(fam.chain[i]).map((c) => c.id), [fam.chain[i + 1].id]);
      assert.notEqual(sonsOf(fam.top).length, 1, `${fam.family.ar}: the trunk stops too early`);
    }
  });
  test('by default only the men: sons with sons are name tags, the others leaves; every man exactly once', () => {
    for (const fam of fams) {
      const items = itemsOf(fam);
      assert.ok(items.every((it) => it.cat === 'man' && it.p.gender === 'm'), fam.family.ar);
      for (const it of items) {
        const hasSons = G.children(it.p.id).some((c) => c.gender === 'm');
        assert.equal(it.kind === 'tag', hasSons, `${personName(it.p, 'ar')}: tag iff he has sons`);
      }
      assert.deepEqual(fam.side, [], 'with men only, the trunk has no side shoots');
      // every man of the male line appears exactly once (on the trunk or in the crown)
      const ids = [...fam.chain, ...items.map((it) => it.p)].map((p) => p.id);
      assert.equal(new Set(ids).size, ids.length, fam.family.ar);
      assert.equal(ids.length, fam.stats.men, fam.family.ar);
    }
  });
  test('a crown iff the male line goes on above the trunk — the same with every option; the first two have one', () => {
    for (const [i, fam] of fams.entries()) {
      const crown = itemsOf(fam).length > 0; // men only: tags / leaves above the trunk
      assert.equal(hasCrown(fam), crown, fam.family.ar);
      assert.equal(hasCrown(fam), sonsOf(fam.top).length > 0, fam.family.ar);
      assert.equal(hasCrown(famsAll[i]), crown, `${fam.family.ar}: the options change the crown`);
      if (!crown) {
        // a single line of men: every man is on the trunk
        assert.equal(fam.chain.length, fam.stats.men, fam.family.ar);
        assert.equal(fam.stats.gens, fam.chain.length, fam.family.ar);
      }
    }
    assert.ok(fams.slice(0, 2).every(hasCrown));
  });
  test('options add mothers, wives (no children recorded), daughters and others', () => {
    const [alam, mahmoud] = famsAll;
    const a = itemsOf(alam);
    const byId = (items, id) => items.filter((it) => it.p.id === id);
    // فايزة: mother of علي's children; سوسن: عصام's wife with no children recorded → "wives"
    assert.equal(byId(a, 'p10p5jzy')[0]?.cat, 'mother');
    assert.equal(byId(a, 'po3n142y')[0]?.cat, 'wife');
    assert.ok(a.some((it) => it.cat === 'daughter'));
    // علاء: a child whose gender is not recorded → "others"
    assert.equal(byId(itemsOf(mahmoud), 'po3uyog1')[0]?.cat, 'other');
    // daughters' husbands come with "others" (never a man who is already on a male line), in every family
    assert.ok(a.some((it) => it.cat === 'other' && it.husband));
    const lines = new Set(fams.flatMap((f) => [...f.chain, ...itemsOf(f).map((it) => it.p)]).map((p) => p.id));
    assert.ok(famsAll.flatMap(itemsOf).filter((it) => it.husband).every((it) => !lines.has(it.p.id)));
    // with every option, the men are the same as with none (the options only add leaves); a man is a name tag
    // iff something hangs from him
    famsAll.forEach((f, i) => {
      const men = (fam) => itemsOf(fam).filter((it) => it.cat === 'man').map((it) => it.p.id).sort();
      assert.deepEqual(men(f), men(fams[i]), f.family.ar);
      assert.ok(itemsOf(f).every((it) => (it.kind === 'tag') === (it.cat === 'man' && (it.children || []).length > 0)), f.family.ar);
    });
    // only mothers
    for (const f of familyTrees(G, { mothers: true })) {
      assert.ok(itemsOf(f).every((it) => it.cat === 'man' || it.cat === 'mother'), f.family.ar);
    }
    const only = itemsOf(familyTrees(G, { mothers: true })[0]);
    assert.ok(only.some((it) => it.cat === 'mother'));
    assert.ok(!only.some((it) => it.p.id === 'po3n142y'), 'a wife without children is not a mother');
  });
  test('counts: men of the line, women around them', () => {
    const [alam] = fams;
    // The tree grows as edits are approved: at least the imported family (17 men, 6 generations).
    assert.ok(alam.stats.men >= 17, `men ${alam.stats.men}`);
    assert.ok(alam.stats.women > 0 && alam.stats.gens >= 6);
    for (const f of fams) assert.ok(f.stats.men >= f.chain.length && f.stats.gens >= f.chain.length && f.stats.women >= 0, f.family.ar);
  });
  test('marriages joining two families: علي (آل عالم) and فايزة (آل محمود); every bridge is a real cross-family marriage', () => {
    const bridges = familyBridges(G, fams);
    const aliFaiza = bridges.find((b) => b.wife.id === 'p10p5jzy');
    assert.ok(aliFaiza, 'the marriage of علي and فايزة is a bridge');
    assert.equal(personName(aliFaiza.husband, 'ar'), 'علي');
    assert.deepEqual([aliFaiza.from, aliFaiza.to], [0, 1]);
    const lineOf = (f) => new Set([...f.chain, ...itemsOf(f).map((it) => it.p)].map((p) => p.id));
    for (const b of bridges) {
      assert.notEqual(b.from, b.to);
      assert.ok(lineOf(fams[b.from]).has(b.husband.id), 'the husband is a man of the first family');
      assert.ok(lineOf(fams[b.to]).has(G.father(b.wife.id).id), 'the wife is a daughter of the second family');
      assert.ok(G.spouses(b.husband.id).some((s) => s.person.id === b.wife.id));
    }
    assert.equal(new Set(bridges.map(bridgeKey)).size, bridges.length);
  });
});

describe('home page settings (config.json "home": hidden trees and «يلتقي» lines)', () => {
  const fams = familyTrees(G, {});
  const bridges = familyBridges(G, fams);
  const [alam, mahmoud] = fams;
  const aliFaiza = bridges.find((b) => b.wife.id === 'p10p5jzy');
  const ids = (list) => list.map((f) => f.head.id);
  const keys = (list) => list.map(bridgeKey).sort();
  const touches = (b, f) => b.from === f.index || b.to === f.index;
  /** The invariants of homeView for any setting. */
  const check = (v, home) => {
    const hidden = homeHidden(home);
    const famOff = (f) => treeHiddenBy(f, hidden).length > 0;
    // every family exactly once: drawn, named, or hidden
    assert.deepEqual([...ids(v.illustrated), ...ids(v.others), ...ids(v.hiddenTrees)].sort(), ids(fams).sort());
    assert.deepEqual(ids(v.trees), ids(fams.filter((f) => !famOff(f))));
    assert.ok(v.illustrated.every(hasCrown) && v.others.every((f) => !hasCrown(f)));
    assert.ok(v.hiddenTrees.every(famOff));
    // every caption exactly once; shown ⇔ no explicit hide and (both families shown or shown explicitly)
    assert.deepEqual([...keys(v.bridges), ...keys(v.hiddenBridges)].sort(), keys(bridges));
    for (const b of bridges) {
      const byFamily = famOff(fams[b.from]) || famOff(fams[b.to]);
      const shown = !bridgeHiddenBy(b, hidden).length && (!byFamily || bridgeShownBy(b, hidden).length > 0);
      assert.equal(v.bridges.includes(b), shown, bridgeKey(b));
      assert.equal(v.withFamily.has(b), !shown && !bridgeHiddenBy(b, hidden).length, bridgeKey(b));
    }
    // preferred order: between two drawn families, then one, then none
    const drawn = new Set(v.illustrated.map((f) => f.index));
    const rank = v.bridges.map((b) => 2 - drawn.has(b.from) - drawn.has(b.to));
    assert.deepEqual(rank, rank.slice().sort((a, b) => a - b));
  };
  test('absent or malformed settings hide nothing; drawn = the families with a crown, the others are named', () => {
    for (const home of [undefined, null, {}, [], 'x', { hiddenTrees: 'p1', hiddenBridges: [3], shownBridges: {} }]) {
      const v = homeView(fams, bridges, home);
      check(v, home);
      assert.equal(v.trees.length, fams.length);
      assert.deepEqual(ids(v.illustrated), ids(fams.filter(hasCrown)));
      assert.deepEqual(ids(v.others), ids(fams.filter((f) => !hasCrown(f))));
      assert.equal(v.bridges.length, bridges.length);
      assert.deepEqual([v.hiddenTrees.length, v.hiddenBridges.length, v.withFamily.size], [0, 0, 0]);
    }
    assert.ok(homeView(fams, bridges, {}).illustrated.length >= 2);
    if (bridges.length) assert.equal(homeView(fams, bridges, {}).bridges[0], aliFaiza, 'between the two drawn families first');
  });
  test('a hidden family (by its founder) disappears, with the captions naming it; the others stay', () => {
    for (const f of fams) {
      const home = { hiddenTrees: [f.head.id] };
      const v = homeView(fams, bridges, home);
      check(v, home);
      assert.deepEqual(ids(v.hiddenTrees), [f.head.id]);
      assert.deepEqual(ids(v.trees), ids(fams.filter((x) => x !== f)));
      assert.deepEqual(keys(v.bridges), keys(bridges.filter((b) => !touches(b, f))));
      assert.deepEqual(keys([...v.withFamily]), keys(bridges.filter((b) => touches(b, f))));
      assert.deepEqual(treeHiddenBy(f, homeHidden(home)), [f.head.id]);
      for (const g of fams) if (g !== f) assert.deepEqual(treeHiddenBy(g, homeHidden(home)), []);
    }
    const v = homeView(fams, bridges, { hiddenTrees: [mahmoud.head.id] });
    assert.ok(v.trees.some((f) => f.family.ar === 'آل عالم') && !v.trees.some((f) => f.family.ar === 'آل محمود'));
    assert.ok(!v.bridges.includes(aliFaiza) && v.withFamily.has(aliFaiza));
  });
  test('a man of the trunk hides the tree too (an older ancestor added later keeps it hidden)', () => {
    assert.ok(alam.chain.length >= 2);
    const v = homeView(fams, bridges, { hiddenTrees: [alam.chain[1].id] });
    assert.deepEqual(ids(v.hiddenTrees), [alam.head.id]);
    assert.ok(!v.illustrated.includes(alam) && v.illustrated.includes(mahmoud));
    // a man outside the trunk hides nothing
    const son = alam.items[0].p; // a son of the top of the trunk: on the crown, not on the trunk
    assert.ok(!alam.chain.some((x) => x.id === son.id));
    assert.equal(homeView(fams, bridges, { hiddenTrees: [son.id, 'pnobody0'] }).trees.length, fams.length);
  });
  test('every family hidden → none shown, nor any caption', () => {
    const home = { hiddenTrees: ids(fams) };
    const v = homeView(fams, bridges, home);
    check(v, home);
    assert.deepEqual([v.trees.length, v.illustrated.length, v.others.length, v.hiddenTrees.length], [0, 0, 0, fams.length]);
    assert.deepEqual([v.bridges.length, v.withFamily.size], [0, bridges.length]);
  });
  test('every drawn family hidden → the named ones stay (the page then shows their names only)', () => {
    const home = { hiddenTrees: ids(fams.filter(hasCrown)) };
    const v = homeView(fams, bridges, home);
    check(v, home);
    assert.deepEqual([v.illustrated.length, ids(v.others)], [0, ids(fams.filter((f) => !hasCrown(f)))]);
  });
  test('a hidden «يلتقي» caption: key "<husbandId>|<wifeId>"', () => {
    const key = bridgeKey(aliFaiza);
    assert.equal(key, `${aliFaiza.husband.id}|p10p5jzy`);
    const v = homeView(fams, bridges, { hiddenBridges: [key] });
    check(v, { hiddenBridges: [key] });
    assert.deepEqual([v.bridges.length, v.hiddenBridges, v.trees.length, v.withFamily.size], [bridges.length - 1, [aliFaiza], fams.length, 0]);
    assert.deepEqual(bridgeHiddenBy(aliFaiza, homeHidden({ hiddenBridges: [key] })), [key]);
  });
  test('the same couple written the other way round ("<wifeId>|<husbandId>", config.json edited by hand) hides it too', () => {
    const rev = `p10p5jzy|${aliFaiza.husband.id}`;
    const v = homeView(fams, bridges, { hiddenBridges: [rev] });
    assert.deepEqual([v.bridges.length, v.hiddenBridges.length], [bridges.length - 1, 1]);
    // «إظهار» removes whichever spelling hides it
    assert.deepEqual(bridgeHiddenBy(aliFaiza, homeHidden({ hiddenBridges: [rev, bridgeKey(aliFaiza), 'pzzzz|pyyyy'] })), [bridgeKey(aliFaiza), rev]);
  });
  test('a caption naming a hidden family shows again only when the keeper shows it explicitly (home.shownBridges)', () => {
    let home = { hiddenTrees: [mahmoud.head.id] };
    assert.ok(homeView(fams, bridges, home).withFamily.has(aliFaiza));
    // «إظهار» → shownBridges; the family stays hidden, the caption is shown
    const show = bridgeToggle(aliFaiza, fams, home, true);
    assert.deepEqual(show, { keepBridges: [bridgeKey(aliFaiza)] });
    home = patchHome(home, show);
    assert.deepEqual(home, { hiddenTrees: [mahmoud.head.id], shownBridges: [bridgeKey(aliFaiza)] });
    let v = homeView(fams, bridges, home);
    check(v, home);
    assert.ok(v.bridges.includes(aliFaiza) && v.hiddenTrees.includes(mahmoud));
    // either spelling counts
    const rev = { hiddenTrees: [mahmoud.head.id], shownBridges: [`p10p5jzy|${aliFaiza.husband.id}`] };
    assert.ok(homeView(fams, bridges, rev).bridges.includes(aliFaiza));
    // «إخفاء» → it follows its family again (and comes back with it)
    const hide = bridgeToggle(aliFaiza, fams, home, false);
    assert.deepEqual(hide, { unkeepBridges: [bridgeKey(aliFaiza)] });
    home = patchHome(home, hide);
    assert.deepEqual(home, { hiddenTrees: [mahmoud.head.id] });
    assert.ok(homeView(fams, bridges, home).withFamily.has(aliFaiza));
    assert.ok(homeView(fams, bridges, patchHome(home, { showTrees: [mahmoud.head.id] })).bridges.includes(aliFaiza));
    // an explicit hide always wins (a hand edit naming it in both lists)
    v = homeView(fams, bridges, { hiddenBridges: [bridgeKey(aliFaiza)], shownBridges: [bridgeKey(aliFaiza)] });
    assert.ok(!v.bridges.includes(aliFaiza) && !v.withFamily.has(aliFaiza));
    // «إظهار» on a caption hidden explicitly AND with its family: both go
    home = { hiddenTrees: [mahmoud.head.id], hiddenBridges: [bridgeKey(aliFaiza)] };
    home = patchHome(home, bridgeToggle(aliFaiza, fams, home, true));
    assert.deepEqual(home, { hiddenTrees: [mahmoud.head.id], shownBridges: [bridgeKey(aliFaiza)] });
    assert.ok(homeView(fams, bridges, home).bridges.includes(aliFaiza));
  });
  test('the toggle of an ordinary caption: hide / show explicitly (a stale shownBridges entry is cleared)', () => {
    const key = bridgeKey(aliFaiza);
    assert.deepEqual(bridgeToggle(aliFaiza, fams, undefined, false), { hideBridges: [key] });
    assert.deepEqual(bridgeToggle(aliFaiza, fams, { hiddenBridges: [key] }, true), { showBridges: [key] });
    assert.deepEqual(bridgeToggle(aliFaiza, fams, { shownBridges: [key] }, false), { hideBridges: [key], unkeepBridges: [key] });
    assert.deepEqual(bridgeToggle(aliFaiza, fams, {}, true), {}, 'already shown: nothing to change');
    assert.equal(patchHome(patchHome(undefined, { hideBridges: [key] }), { showBridges: [key] }), undefined);
  });
  test('people not saved yet (temporary ids) cannot be named in the settings: no hide control for them', () => {
    assert.equal(canHideTree(alam), true);
    assert.equal(canHideBridge(aliFaiza), true);
    assert.equal(canHideTree({ ...alam, head: { ...alam.head, id: 'new3' } }), false);
    assert.equal(canHideBridge({ ...aliFaiza, wife: { ...aliFaiza.wife, id: 'new1' } }), false);
    assert.deepEqual(patchHome(undefined, { keepBridges: ['new1|p10p5jzy', 'pa111|pb222|pc333'] }), undefined, 'malformed keys are never written');
  });
});

describe('layoutFamily', () => {
  test('real data, every family, every option, both languages and directions: no leaf or tag overlaps another', () => {
    for (const [lang, rtl] of [['ar', true], ['en', false]]) {
      for (const show of [ALL, {}]) {
        for (const fam of familyTrees(G, show)) {
          const lay = layoutFamily(fam, { rtl, lang });
          // every crown item and side shoot is placed (a family without a crown may have none with men only)
          assert.equal(lay.items.length, itemsOf(fam).length, fam.family.ar);
          assert.ok(show === ALL ? lay.items.length > 0 : hasCrown(fam) === lay.items.length > 0, fam.family.ar);
          assert.deepEqual(overlaps(lay), [], `${fam.family.ar} (${lang})`);
          assert.ok(lay.items.every((it) => Number.isFinite(it.x) && Number.isFinite(it.y)));
          assert.ok(lay.names.length === fam.chain.length && lay.names.every((n) => Number.isFinite(n.y)));
          assert.ok(lay.bbox.w > 0 && lay.bbox.h > 0 && Number.isFinite(lay.bbox.x) && Number.isFinite(lay.bbox.y));
        }
      }
    }
    // the big families are big trees
    assert.ok(layoutFamily(familyTrees(G, ALL)[0], { rtl: true, lang: 'ar' }).items.length > 20);
  });
  test('deterministic, and the first-born son is on the right in Arabic, on the left in English', () => {
    const fam = familyTrees(G, {})[1];
    const a = layoutFamily(fam, { rtl: true, lang: 'ar' });
    const b = layoutFamily(familyTrees(G, {})[1], { rtl: true, lang: 'ar' });
    assert.deepEqual(a.items.map((it) => [it.x, it.y]), b.items.map((it) => [it.x, it.y]));
    const first = fam.items.find((it) => it.p.gender === 'm');
    const last = [...fam.items].reverse().find((it) => it.p.gender === 'm');
    assert.notEqual(first, last);
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
