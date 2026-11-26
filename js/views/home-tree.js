// Home page family trees (docs/SPEC.md §7.2): one illustrated tree per family branch, in the spirit of a
// traditional family-tree poster — a tapered trunk that carries the founder and the single line of ancestors,
// curved branches, sons who have families of their own as name tags on their branch, and everyone else as a
// leaf with their FIRST name written inside it. The skeleton is the male line; mothers, wives, daughters and
// "others" can be added as leaves in their own colour (and outline/pattern, for colour-blind readers).
//
//   abstractTree(graph, { lang }) → <section> element (call .dispose() when the view goes away)
//
// Layout (per family, in tree units — the SVG scales to its column): a polar fan centred a little above the fork.
//   Every crown item (tag or leaf) gets an angular sector in proportion to the room it and its descendants need;
//   then, generation by generation, each item settles at the free spot nearest to its father inside his sector
//   (oriented-box collision tests on a spatial grid) — so leaves never overlap each other, the name tags or the
//   trunk, and the foliage fills a round crown. Branches are tapered cubic curves (filled outlines); leaves of one
//   man hang in small bunches from short shared stems.
// Phones (≤700px): a switch shows one family at a time; tapping the tree opens a full-screen viewer (pan, pinch,
// zoom buttons). Wider screens: tapping a leaf or tag opens a small popover (profile / show in the detailed tree).
import { h, icon, bdi } from '../dom.js';
import { t, register, lang as currentLang, bi } from '../i18n.js';
import { store } from '../store.js';
import { nameOf, lineageOf, yearsOf, avatar, nameLabel, badges } from '../ui.js';
import { personName, familyName } from '../core/names.js';

register({
  en: {
    'ht.sectionTitle': 'The family trees',
    'ht.lead': 'Each family grows from its founding grandfather: his sons and grandsons are the branches and leaves. Mothers, wives, daughters and others can be added as coloured leaves.',
    'ht.hintTap': 'Tap a tree to enlarge it.',
    'ht.hintClick': 'Select a name for details.',
    'ht.treeOf': '{family} tree',
    'ht.show': 'Show on the trees',
    'ht.cat.men': 'Sons',
    'ht.cat.mothers': 'Mothers',
    'ht.cat.wives': 'Wives',
    'ht.cat.daughters': 'Daughters',
    'ht.cat.others': 'Others',
    'ht.tip.men': 'Sons and grandsons — the branches and leaves of the tree (always shown)',
    'ht.tip.mothers': 'Wives who are mothers of children in the family line',
    'ht.tip.wives': 'Wives with no children recorded in the tree (mothers have their own option)',
    'ht.tip.daughters': 'Daughters, on their father’s branch',
    'ht.tip.others': 'Children whose gender is not recorded, and the husbands of daughters (when daughters are shown)',
    'ht.families': 'Family',
    'ht.enlarge': 'Enlarge',
    'ht.enlargeTree': 'Enlarge {tree}',
    'ht.detailed': 'Open the detailed tree',
    'ht.openProfile': 'Open profile',
    'ht.showInTree': 'Show in the detailed tree',
    'ht.zoomIn': 'Zoom in',
    'ht.zoomOut': 'Zoom out',
    'ht.fit': 'Fit to screen',
    'ht.viewerHint': 'Drag to move · pinch or use the buttons to zoom · tap a name for details',
    'ht.role.wife': 'Wife of {name}',
    'ht.role.husband': 'Husband of {name}',
    'ht.role.founder': 'Founding grandfather',
    'ht.bridge': '{a} and {b} meet through the marriage of {husband} and {wife}.',
    'ht.summary': '{tree}: {generations}, {men} and {women}. Founding grandfather: {founder}.',
    'ht.counts': '{men} · {women}',
    'ht.empty': 'The family trees will appear here once the first family is added.',
  },
  ar: {
    'ht.sectionTitle': 'أشجار العائلة',
    'ht.lead': 'تنمو كل عائلة من جدّها المؤسّس، فأبناؤه وأحفاده هم أغصانها وأوراقها. ويمكن إضافة الأمهات والزوجات والبنات وغيرهم أوراقاً ملوّنة.',
    'ht.hintTap': 'النقر على الشجرة يكبّرها.',
    'ht.hintClick': 'النقر على أي اسم يعرض التفاصيل.',
    'ht.treeOf': 'شجرة {family}',
    'ht.show': 'الإظهار في الشجرة',
    'ht.cat.men': 'الأبناء',
    'ht.cat.mothers': 'الأمهات',
    'ht.cat.wives': 'الزوجات',
    'ht.cat.daughters': 'البنات',
    'ht.cat.others': 'وآخرون',
    'ht.tip.men': 'الأبناء والأحفاد: أغصان الشجرة وأوراقها (يظهرون دائماً)',
    'ht.tip.mothers': 'الزوجات اللواتي لهنّ أبناء في الشجرة',
    'ht.tip.wives': 'الزوجات اللواتي لم يُسجَّل لهنّ أبناء في الشجرة (وللأمهات خيار مستقل)',
    'ht.tip.daughters': 'البنات على غصن الأب',
    'ht.tip.others': 'الأبناء الذين لم يُحدَّد جنسهم، وأزواج البنات (عند إظهار البنات)',
    'ht.families': 'العائلة',
    'ht.enlarge': 'تكبير',
    'ht.enlargeTree': 'تكبير {tree}',
    'ht.detailed': 'فتح الشجرة المفصّلة',
    'ht.openProfile': 'فتح الصفحة الشخصية',
    'ht.showInTree': 'عرض في الشجرة المفصّلة',
    'ht.zoomIn': 'تكبير',
    'ht.zoomOut': 'تصغير',
    'ht.fit': 'ملاءمة الشاشة',
    'ht.viewerHint': 'السحب للتحريك · القرص بإصبعين أو الأزرار للتكبير · النقر على اسم لعرض التفاصيل',
    'ht.role.wife': 'زوجة {name}',
    'ht.role.husband': 'زوج {name}',
    'ht.role.founder': 'الجدّ المؤسّس',
    'ht.bridge': 'يلتقي {a} و{b} بزواج {husband} و{wife}.',
    'ht.summary': '{tree}: {generations}، تضمّ {men} و{women}. الجدّ المؤسّس: {founder}.',
    'ht.counts': '{men} · {women}',
    'ht.empty': 'ستظهر أشجار العائلة هنا عند إضافة أول عائلة.',
  },
});

// Plural-aware strings (keys `<base>.<Intl.PluralRules category>`), both languages.
const PLURAL_CATS = ['zero', 'one', 'two', 'few', 'many', 'other'];
function registerPlural(base, en, ar) {
  const out = { en: {}, ar: {} };
  for (const c of PLURAL_CATS) {
    out.en[`${base}.${c}`] = c === 'one' ? en[0] : en[1];
    out.ar[`${base}.${c}`] = ar[c] ?? ar.other;
  }
  register(out);
}
registerPlural('ht.men', ['{n} man', '{n} men'],
  { zero: 'لا رجال', one: 'رجل واحد', two: 'رجلان', few: '{n} رجال', many: '{n} رجلاً', other: '{n} رجل' });
registerPlural('ht.women', ['{n} woman', '{n} women'],
  { zero: 'لا نساء', one: 'امرأة واحدة', two: 'امرأتان', few: '{n} نساء', many: '{n} امرأة', other: '{n} امرأة' });
registerPlural('ht.gens', ['{n} generation', '{n} generations'],
  { zero: 'لا أجيال', one: 'جيل واحد', two: 'جيلان', few: '{n} أجيال', many: '{n} جيلاً', other: '{n} جيل' });
const pluralRules = {};
function plural(base, n) {
  const l = currentLang();
  let cat = 'other';
  try { cat = (pluralRules[l] ||= new Intl.PluralRules(l === 'ar' ? 'ar' : 'en')).select(n); } catch { cat = 'other'; }
  return t(`${base}.${cat}`, { n });
}

// ---------------------------------------------------------------------------------------------------------
// Preferences (per device)

const PREF = 'gft.hometree.';
export const LEAF_CATS = ['mothers', 'wives', 'daughters', 'others'];
function readPref(k) { try { return localStorage.getItem(PREF + k); } catch { return null; } }
function writePref(k, v) { try { localStorage.setItem(PREF + k, v); } catch { /* storage unavailable */ } }
function readShow() {
  const show = {};
  for (const c of LEAF_CATS) show[c] = readPref(c) === '1';
  return show;
}

// ---------------------------------------------------------------------------------------------------------
// Model: families → trunk chain + crown items

/** First name for a leaf: given name, else a kunya, else «؟». */
function leafName(p, l) {
  const given = personName(p, l);
  if (given) return given;
  if ((p.nameStatus || 'known') === 'known') {
    const nick = bi(p.nickname, l);
    if (nick) return nick;
  }
  return l === 'ar' ? '؟' : '?';
}

function fallbackFamily(graph, head, label) {
  const ar = familyName(graph, head.id, 'ar');
  const en = familyName(graph, head.id, 'en');
  if (ar || en) return { ar: `آل ${ar || en}`, en: `The ${en || ar} family` };
  return { ar: `عائلة ${label?.ar || ''}`.trim(), en: `Family of ${label?.en || ''}`.trim() };
}

const sonsOf = (graph, id) => (graph.children(id) || []).filter((c) => c && c.gender === 'm');

/**
 * Families with their trees for the current options.
 *   show: {mothers, wives, daughters, others}
 * → [{ index, head, family:{ar,en}, chain:[persons bottom→top], top, items:[crown roots], side:[{person, items}],
 *      stats:{men, women, gens}, maleIds:Set }]
 * Crown item: { kind:'tag'|'leaf', p, cat:'man'|'mother'|'wife'|'daughter'|'other', rel (related person), children }
 */
export function familyTrees(graph, show = {}) {
  let branches = [];
  try { branches = graph.branches() || []; } catch { branches = []; }
  const maleLine = new Map(); // id → family index
  const fams = [];
  for (const b of branches) {
    if (!b || !b.person || maleLine.has(b.person.id)) continue;
    const index = fams.length;
    const stack = [b.person.id];
    let men = 0;
    while (stack.length) {
      const id = stack.pop();
      if (maleLine.has(id)) continue;
      maleLine.set(id, index);
      men++;
      for (const c of sonsOf(graph, id)) stack.push(c.id);
    }
    fams.push({ index, head: b.person, family: b.family || fallbackFamily(graph, b.person, b.label), stats: { men } });
  }
  for (const fam of fams) buildFamily(graph, fam, show, maleLine);
  return fams;
}

function buildFamily(graph, fam, show, maleLine) {
  const visited = new Set();
  const women = new Set();
  let gens = 0;

  // Everyone in the family's circle, for the counts (independent of the options).
  const walk = [[fam.head, 1]];
  const seen = new Set();
  while (walk.length) {
    const [p, depth] = walk.pop();
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    gens = Math.max(gens, depth);
    for (const c of graph.children(p.id) || []) {
      if (c.gender === 'm') walk.push([c, depth + 1]);
      else if (c.gender === 'f') women.add(c.id);
    }
    if (p.gender !== 'f') for (const s of graph.spouses(p.id) || []) if (s.person && s.person.gender !== 'm') women.add(s.person.id);
  }
  fam.stats.women = women.size;
  fam.stats.gens = gens;

  /** Leaf/tag items for a man's family (spouses grouped with their children), skipping `skip` (trunk son). */
  const membersOf = (J, depth, skip = null) => {
    if (visited.has(J.id)) return [];
    visited.add(J.id);
    const out = [];
    const used = new Set();
    const childItems = (c) => {
      if (!c || used.has(c.id) || c.id === skip) return [];
      used.add(c.id);
      if (c.gender === 'm') {
        const sub = membersOf(c, depth + 1);
        return [sub.length ? { kind: 'tag', p: c, cat: 'man', rel: J, children: sub } : { kind: 'leaf', p: c, cat: 'man', rel: J }];
      }
      if (c.gender === 'f') {
        if (!show.daughters) return [];
        const items = [{ kind: 'leaf', p: c, cat: 'daughter', rel: J }];
        if (show.others) {
          for (const s of graph.spouses(c.id) || []) {
            if (s.person && !maleLine.has(s.person.id)) items.push({ kind: 'leaf', p: s.person, cat: 'other', rel: c, husband: true });
          }
        }
        return items;
      }
      return show.others ? [{ kind: 'leaf', p: c, cat: 'other', rel: J }] : [];
    };
    const isMan = J.gender !== 'f';
    for (const u of graph.unionsOf(J.id) || []) {
      const partner = (u.partners || []).map((id) => graph.person(id)).find((q) => q && q.id !== J.id) || null;
      const kids = graph.childrenOfUnion(u.id) || [];
      if (isMan && partner && partner.gender !== 'm') {
        const mother = kids.length > 0;
        if ((mother && show.mothers) || (!mother && show.wives)) out.push({ kind: 'leaf', p: partner, cat: mother ? 'mother' : 'wife', rel: J });
      }
      for (const c of kids) out.push(...childItems(c));
    }
    for (const c of graph.children(J.id) || []) out.push(...childItems(c));
    return out;
  };

  // Trunk: the founder and the single line of sons above him, up to the first man with 0 or ≥2 sons.
  const chain = [fam.head];
  let cur = fam.head;
  for (let guard = 0; guard < 200; guard++) {
    const sons = sonsOf(graph, cur.id);
    if (sons.length !== 1 || chain.some((x) => x.id === sons[0].id)) break;
    cur = sons[0];
    chain.push(cur);
  }
  fam.chain = chain;
  fam.top = cur;
  fam.side = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const items = membersOf(chain[i], 0, chain[i + 1].id);
    if (items.length) fam.side.push({ person: chain[i], index: i, items: items.map((x) => (x.kind === 'tag' ? flattenTag(x) : x)) });
  }
  fam.items = membersOf(fam.top, 0);
}

/** A trunk ancestor's son can only be the trunk itself, so side shoots carry leaves only. */
function flattenTag(item) { return { kind: 'leaf', p: item.p, cat: item.cat, rel: item.rel }; }

/** Marriages between two families: a man of one family's line married to a daughter of another's. */
export function familyBridges(graph, fams) {
  const famOf = new Map();
  for (const f of fams) {
    const stack = [f.head.id];
    while (stack.length) {
      const id = stack.pop();
      if (famOf.has(id)) continue;
      famOf.set(id, f.index);
      for (const c of sonsOf(graph, id)) stack.push(c.id);
    }
  }
  const out = [];
  for (const [id, fi] of famOf) {
    const man = graph.person(id);
    if (!man || man.gender === 'f') continue;
    for (const s of graph.spouses(id) || []) {
      const wife = s.person;
      const father = wife && graph.father(wife.id);
      if (!father || !famOf.has(father.id) || famOf.get(father.id) === fi) continue;
      out.push({ husband: man, wife, from: fi, to: famOf.get(father.id) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Geometry

const DEG = Math.PI / 180;
const FAN = 108 * DEG; // half-angle of the crown fan around its centre (0 = straight up; >90° wraps down the sides)
const RING_STEP = 44; // spacing between generations (tree units) when sizing the sectors
const LEAF_FS = 11;
const TAG_FS = 12.5;
const TRUNK_FS = 16;
const TRUNK_FS2 = 12.5;
const GAP = 5;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = (n) => Math.round(n * 10) / 10;

let measureCtx = null;
let fontFamily = '';
function fontStack() {
  if (!fontFamily) {
    try { fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-names').trim(); } catch { fontFamily = ''; }
    fontFamily ||= 'serif';
  }
  return fontFamily;
}
function textWidth(text, size, weight = 700) {
  const font = `${weight} ${size}px ${fontStack()}`;
  try {
    measureCtx ||= document.createElement('canvas').getContext('2d');
    measureCtx.font = font;
    const w = measureCtx.measureText(text).width;
    if (w > 0) return w;
  } catch { /* no canvas */ }
  return String(text).length * size * 0.58;
}

/** Oriented box (centre, size, angle) with its corners/axes/bbox for SAT tests. */
function obb(cx, cy, w, hh, ang = 0) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const hx = w / 2;
  const hy = hh / 2;
  const pts = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { pts, axes: [[c, s], [-s, c]], minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
function collide(a, b) {
  if (a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY) return false;
  for (const ax of [...a.axes, ...b.axes]) {
    let amin = Infinity; let amax = -Infinity; let bmin = Infinity; let bmax = -Infinity;
    for (const p of a.pts) { const d = p[0] * ax[0] + p[1] * ax[1]; if (d < amin) amin = d; if (d > amax) amax = d; }
    for (const p of b.pts) { const d = p[0] * ax[0] + p[1] * ax[1]; if (d < bmin) bmin = d; if (d > bmax) bmax = d; }
    if (amax <= bmin || bmax <= amin) return false;
  }
  return true;
}
class Grid {
  constructor(size = 48) { this.size = size; this.cells = new Map(); }
  keys(b) {
    const s = this.size;
    const out = [];
    for (let i = Math.floor(b.minX / s); i <= Math.floor(b.maxX / s); i++) {
      for (let j = Math.floor(b.minY / s); j <= Math.floor(b.maxY / s); j++) out.push(`${i},${j}`);
    }
    return out;
  }
  add(b) { for (const k of this.keys(b)) { let c = this.cells.get(k); if (!c) this.cells.set(k, (c = [])); c.push(b); } }
  hits(b) {
    for (const k of this.keys(b)) for (const o of this.cells.get(k) || []) if (collide(b, o)) return true;
    return false;
  }
}

/** Leaf axis for a leaf at q whose stem comes from p: points away (left/right), tilted up ≤30°, down ≤14°. */
function leafAxis(p, q, sideHint) {
  const vx = q[0] - p[0];
  const vy = q[1] - p[1];
  const side = Math.abs(vx) < 1.5 ? sideHint : Math.sign(vx);
  const up = clamp(Math.atan2(-vy, Math.abs(vx) || 0.001), -14 * DEG, 30 * DEG);
  return [side * Math.cos(up), -Math.sin(up)];
}

/** Along-arc / radial footprints of a leaf (axis tilted with the fan) at angle th. */
function leafFoot(L, H, th) {
  const a = Math.abs(th);
  const up = clamp(Math.PI / 2 - a, -14 * DEG, 30 * DEG); // axis elevation
  const tang = Math.abs(Math.cos(up) * Math.cos(a) - Math.sin(up) * Math.sin(a));
  return L * tang + H * Math.sqrt(1 - tang * tang);
}

/**
 * Lay out one family tree. Coordinates: trunk top at (0,0), y down; ground at y = trunkH.
 * → { items: [placed items], wood: [paths], twigs: [paths], trunk, names, bbox }
 */
export function layoutFamily(fam, { rtl, lang: l }) {
  const all = [];
  const sizeOne = (it) => {
    it.text = leafName(it.p, l);
    const tw = textWidth(it.text, it.kind === 'tag' ? TAG_FS : LEAF_FS);
    if (it.kind === 'tag') { it.w = tw + 22; it.h = 22; } else { it.L = clamp(tw + 26, 40, 104); it.H = clamp(9 + it.L * 0.17, 17, 25); }
  };
  const sizeAll = (it) => { sizeOne(it); all.push(it); for (const c of it.children || []) sizeAll(c); };
  for (const it of fam.items) sizeAll(it);

  // Weights (for branch thickness): items in the subtree.
  const weigh = (it) => { it.weight = 1 + (it.children || []).reduce((s, c) => s + weigh(c), 0); return it.weight; };
  const total = fam.items.reduce((s, c) => s + weigh(c), 0) || 1;

  // Trunk names (the top of the trunk first): long ones wrap at a space. The trunk is sized by the tree and
  // widened, if needed, so the longest line stays readable; lines then shrink to fit.
  const wrap = (text, size) => {
    if (!text.includes(' ')) return [text];
    const words = text.split(' ');
    let best = null;
    for (let k = 1; k < words.length; k++) {
      const pair = [words.slice(0, k).join(' '), words.slice(k).join(' ')];
      const w = Math.max(...pair.map((x) => textWidth(x, size)));
      if (!best || w < best.w) best = { pair, w };
    }
    return best.pair;
  };
  const chainTop = fam.chain.slice().reverse();
  const minLine = Math.max(0, ...chainTop.map((p) => {
    const text = leafName(p, l);
    return Math.min(textWidth(text, 12.5), Math.max(...wrap(text, 12.5).map((x) => textWidth(x, 12.5))));
  }));
  const trunkW = Math.round(clamp(Math.max(30 + Math.sqrt(total) * 4.6, (minLine + 6) / 0.8), 56, 150));
  const room = trunkW * 0.8 - 6;
  const names = chainTop.map((p, i) => {
    const base = i === 0 ? TRUNK_FS : TRUNK_FS2;
    const text = leafName(p, l);
    const lines = textWidth(text, base) > room ? wrap(text, base) : [text];
    const widest = Math.max(...lines.map((x) => textWidth(x, base)));
    const fs = widest > room ? Math.max(10, base * room / widest) : base;
    return { p, lines, fs };
  });

  // Angular sectors: every item gets a slice of the fan in proportion to the room it and its descendants need
  // (footprint ÷ radius, on rings one generation apart; the first ring's radius is the smallest that fits).
  const minR1 = trunkW * 0.5 + 46;
  let R1 = minR1;
  const ring = (k) => R1 + (k - 1) * RING_STEP;
  const needOf = (it, k) => {
    const r = ring(k);
    const th = it.th ?? 0;
    const own = it.kind === 'tag'
      ? (it.w * Math.abs(Math.cos(th)) + it.h * Math.abs(Math.sin(th)) + GAP) / r
      : (leafFoot(it.L, it.H, th) + GAP) / r;
    let sum = 0;
    for (const c of it.children || []) sum += needOf(c, k + 1);
    it.need = Math.max(own, sum);
    return it.need;
  };
  const assign = (items, a0, a1) => {
    const need = items.reduce((s, c) => s + c.need, 0) || 1;
    const extra = Math.max(0, (a1 - a0) - need);
    let pos = rtl ? a1 : a0; // the first-born is on the right in Arabic
    for (const c of items) {
      const span = c.need + extra * (c.need / need);
      const lo = rtl ? pos - span : pos;
      const hi = rtl ? pos : pos + span;
      c.slot = [lo, hi];
      c.th = (lo + hi) / 2;
      pos = rtl ? lo : hi;
      if (c.children) assign(c.children, lo, hi);
    }
  };
  const depthOf = (items, k) => { for (const c of items) { c.depth = k; if (c.children) depthOf(c.children, k + 1); } };
  depthOf(fam.items, 1);
  if (fam.items.length) {
    const target = 2 * FAN * 0.92;
    const totalNeed = () => fam.items.reduce((s, c) => s + needOf(c, 1), 0);
    for (let pass = 0; pass < 3; pass++) {
      R1 = minR1;
      if (totalNeed() > target) {
        let lo = minR1;
        let hi = minR1 * 2;
        while (hi < 20000) { R1 = hi; if (totalNeed() <= target) break; lo = hi; hi *= 2; }
        for (let i = 0; i < 22; i++) { R1 = (lo + hi) / 2; if (totalNeed() <= target) hi = R1; else lo = R1; }
        R1 = hi;
      }
      totalNeed();
      assign(fam.items, -FAN, FAN);
    }
  }

  // The crown is sized by the area of its foliage and centred a little above the fork, so it sits on the
  // trunk like a ball.
  const area = all.reduce((s, it) => s + (it.kind === 'tag' ? (it.w + 8) * (it.h + 8) : (it.L + 4) * (it.H + 6)), 0);
  const crownR = Math.sqrt(area / 0.62 / FAN) + minR1 * 0.5;
  const lift = fam.items.length ? clamp(crownR * 0.42, 20, 700) : 0;
  const O = [0, -lift];
  const at = (r, th) => [r * Math.sin(th), -lift - r * Math.cos(th)];
  const nameRows = names.reduce((s, n) => s + n.lines.length, 0);
  const trunkH = Math.round(clamp(Math.max(38 + nameRows * 20 + 34, crownR * 0.4), 90, 220));

  // Placement, generation by generation: every item settles at the free spot nearest to its father, inside
  // his sector (oriented boxes tested on a grid) — leaves never overlap each other, the tags or the trunk, and
  // the foliage fills the crown instead of lining its rim.
  const grid = new Grid(48);
  grid.add(obb(0, trunkH / 2 - 6, trunkW + 8, trunkH + 12));
  const byDepth = all.slice().sort((a, b) => a.depth - b.depth || (a.kind === 'tag' ? 0 : 1) - (b.kind === 'tag' ? 0 : 1) || Math.abs(a.th) - Math.abs(b.th));
  const parentPos = new Map();
  for (const it of all) for (const c of it.children || []) parentPos.set(c, it);

  const shapeFor = (it, x, y) => {
    if (it.kind === 'tag') return { box: obb(x, y, it.w + 6, it.h + 6), axis: null };
    const par = parentPos.get(it);
    const pp = par ? [par.x, par.y] : O;
    const axis = leafAxis(pp, [x, y], Math.sign(it.th) || (rtl ? 1 : -1));
    const ang = Math.atan2(axis[1], axis[0]);
    return { box: obb(x, y, it.L * 0.94 + 3, it.H * 0.86 + 3, ang), axis, ang };
  };
  const tryAt = (it, r, th) => {
    const [x, y] = at(r, th);
    if (y > -8 && Math.abs(x) < trunkW) return null; // keep clear of the trunk top
    const s = shapeFor(it, x, y);
    return grid.hits(s.box) ? null : { x, y, ...s };
  };
  const place = (it) => {
    const par = parentPos.get(it);
    const rMin = par ? Math.hypot(par.x - O[0], par.y - O[1]) + RING_STEP * 0.6 : minR1;
    const own = it.slot[1] - it.slot[0];
    const lo = Math.min(it.slot[0], par ? par.slot[0] : it.slot[0] - own, it.th - 0.12);
    const hi = Math.max(it.slot[1], par ? par.slot[1] : it.slot[1] + own, it.th + 0.12);
    // Cost = distance outwards + 0.55 × distance along the arc from the item's own angle; scan rings outwards
    // and stop once no ring can beat the best spot found.
    let best = null;
    for (let r = rMin; r < rMin + 900 && !(best && r - rMin >= best.cost); r += 5) {
      const step = 4 / r;
      const n = Math.ceil(Math.max(it.th - lo, hi - it.th) / step);
      for (let j = 0; j <= n; j++) {
        const cost = (r - rMin) + j * step * r * 0.55;
        if (best && cost >= best.cost) break;
        let found = null;
        for (const sgn of j ? [1, -1] : [1]) {
          const th = it.th + sgn * j * step;
          if (th >= lo && th <= hi) found = tryAt(it, r, th);
          if (found) break;
        }
        if (found) { best = { cost, spot: found }; break; }
      }
    }
    if (!best) { const [x, y] = at(rMin + 900, it.th); best = { spot: { x, y, ...shapeFor(it, x, y) } }; }
    const spot = best.spot;
    Object.assign(it, { x: spot.x, y: spot.y, axis: spot.axis, ang: spot.ang });
    grid.add(spot.box);
    if (it.kind === 'leaf') it.base = [it.x - it.axis[0] * it.L / 2, it.y - it.axis[1] * it.L / 2];
  };
  for (const it of byDepth) place(it);

  // Side shoots on the trunk for the ancestors' own leaves (their daughters, wives…).
  let yAcc = 40;
  for (const n of names) { n.y = yAcc; yAcc += n.lines.length * (n.fs + 6) + 4; }
  const lineY = (i) => names[i]?.y ?? 40; // i = 0 for the top name
  const sideLeaves = [];
  for (const sh of fam.side) {
    const row = names.length - 1 - sh.index;
    sh.items.forEach((it, j) => {
      sizeOne(it);
      const side = (j % 2 ? -1 : 1) * (rtl ? 1 : -1);
      const y0 = lineY(row);
      let spot = null;
      for (let dx = 0; dx <= 160 && !spot; dx += 6) {
        for (const dy of [0, -10, 10, -20, 20, -30, 30]) {
          const x = side * (trunkW / 2 + it.L / 2 + 10 + dx);
          const y = y0 + dy;
          const axis = [side * Math.cos(12 * DEG), -Math.sin(12 * DEG)];
          const box = obb(x, y, it.L * 0.94 + 3, it.H * 0.86 + 3, Math.atan2(axis[1], axis[0]));
          if (!grid.hits(box)) { spot = { x, y, axis, box }; break; }
        }
      }
      if (!spot) return;
      grid.add(spot.box);
      Object.assign(it, { x: spot.x, y: spot.y, axis: spot.axis, ang: Math.atan2(spot.axis[1], spot.axis[0]), depth: 1, side: true });
      it.base = [it.x - it.axis[0] * it.L / 2, it.y - it.axis[1] * it.L / 2];
      it.stemFrom = [side * trunkW * 0.42, y0];
      sideLeaves.push(it);
    });
  }

  // Branches (tapered, filled) and twigs.
  const wMax = trunkW * 0.46;
  const wMin = 2.2;
  const widthOf = (it) => wMin + (wMax - wMin) * Math.sqrt((it.weight || 1) / total);
  const wood = [];
  const twigs = [];
  const dirFrom = (it) => {
    const par = parentPos.get(it);
    const p = par ? [par.x, par.y] : [0, 6];
    const d = Math.hypot(it.x - p[0], it.y - p[1]) || 1;
    return [(it.x - p[0]) / d, (it.y - p[1]) / d];
  };
  const link = (fromIt, it) => {
    let S;
    let dS;
    if (fromIt) { S = [fromIt.x, fromIt.y]; dS = dirFrom(fromIt); } else {
      S = [clamp(it.x / Math.max(crownR, 1), -1, 1) * trunkW * 0.18, 24];
      dS = [0, -1];
    }
    const E = it.kind === 'tag' ? [it.x, it.y] : it.base;
    const dE = it.kind === 'tag' ? (() => { const d = Math.hypot(E[0] - S[0], E[1] - S[1]) || 1; return [(E[0] - S[0]) / d, (E[1] - S[1]) / d]; })() : it.axis;
    const dist = Math.hypot(E[0] - S[0], E[1] - S[1]);
    const P1 = [S[0] + dS[0] * dist * 0.42, S[1] + dS[1] * dist * 0.42];
    const P2 = [E[0] - dE[0] * dist * 0.3, E[1] - dE[1] * dist * 0.3];
    if (it.kind === 'tag') {
      const w = widthOf(it);
      wood.push({ d: taper(S, P1, P2, E, fromIt ? Math.min(widthOf(fromIt), w * 1.05) : Math.max(w * 1.15, trunkW * 0.3), w * 0.78), depth: it.depth });
    } else {
      const w0 = fromIt ? clamp(widthOf(fromIt) * 0.42, 1.8, 5) : clamp(wMax * 0.3, 2.4, 6);
      twigs.push({ d: taper(S, P1, P2, E, w0, 1.1), depth: it.depth });
    }
  };
  // Leaves of one man hang in small bunches: a short shared stem (hub) per 2–4 neighbouring leaves.
  const hubLink = (from, group) => {
    const cx = group.reduce((s, c) => s + c.base[0], 0) / group.length;
    const cy = group.reduce((s, c) => s + c.base[1], 0) / group.length;
    const hub = { x: from.x + (cx - from.x) * 0.48, y: from.y + (cy - from.y) * 0.48, kind: 'hub' };
    const dS = dirFrom(from);
    const S = [from.x, from.y];
    const dist = Math.hypot(hub.x - S[0], hub.y - S[1]);
    const w = clamp(widthOf(from) * 0.5, 2.2, 6);
    wood.push({ d: taper(S, [S[0] + dS[0] * dist * 0.5, S[1] + dS[1] * dist * 0.5], [hub.x, hub.y], [hub.x, hub.y], w, w * 0.6), depth: from.depth + 0.5 });
    parentPos.set(hub, from);
    for (const c of group) {
      const E = c.base;
      const d2 = Math.hypot(E[0] - hub.x, E[1] - hub.y);
      const dH = [(hub.x - S[0]) / (dist || 1), (hub.y - S[1]) / (dist || 1)];
      twigs.push({ d: taper([hub.x, hub.y], [hub.x + dH[0] * d2 * 0.4, hub.y + dH[1] * d2 * 0.4], [E[0] - c.axis[0] * d2 * 0.3, E[1] - c.axis[1] * d2 * 0.3], E, w * 0.55, 1.1), depth: c.depth });
    }
  };
  const walkLinks = (items, from) => {
    const leaves = from ? items.filter((c) => c.kind === 'leaf') : [];
    const bunched = new Set();
    if (leaves.length >= 3) {
      const ang = (c) => Math.atan2(c.base[0] - from.x, -(c.base[1] - from.y));
      const sorted = leaves.slice().sort((a, b) => ang(a) - ang(b));
      const groups = Math.ceil(sorted.length / 3);
      for (let g = 0; g < groups; g++) {
        const group = sorted.slice(Math.round(g * sorted.length / groups), Math.round((g + 1) * sorted.length / groups));
        if (group.length < 2) continue;
        hubLink(from, group);
        group.forEach((c) => bunched.add(c));
      }
    }
    for (const it of items) {
      if (!bunched.has(it)) link(from, it);
      if (it.children) walkLinks(it.children, it);
    }
  };
  walkLinks(fam.items, null);
  for (const it of sideLeaves) {
    const S = it.stemFrom;
    const E = it.base;
    const dS = [Math.sign(E[0] - S[0]), -0.3];
    const dist = Math.hypot(E[0] - S[0], E[1] - S[1]);
    twigs.push({ d: taper(S, [S[0] + dS[0] * dist * 0.4, S[1] + dS[1] * dist * 0.4], [E[0] - it.axis[0] * dist * 0.3, E[1] - it.axis[1] * dist * 0.3], E, 3.2, 1.1), depth: 1 });
  }

  // Trunk outline, roots, bark lines.
  const tw2 = trunkW / 2;
  const H = trunkH;
  // Trunk: narrower at the fork (rounded, hidden under the limbs), widening to a flared base.
  const top = tw2 * 0.7;
  const trunk = [
    `M${r1(-top)} 4`,
    `C${r1(-tw2 * 0.86)} ${r1(H * 0.3)} ${r1(-tw2 * 0.92)} ${r1(H * 0.62)} ${r1(-tw2 * 1.06)} ${r1(H * 0.84)}`,
    `C${r1(-tw2 * 1.3)} ${r1(H * 0.96)} ${r1(-tw2 * 1.75)} ${r1(H)} ${r1(-tw2 * 1.9)} ${r1(H + 2)}`,
    `L${r1(tw2 * 1.9)} ${r1(H + 2)}`,
    `C${r1(tw2 * 1.75)} ${r1(H)} ${r1(tw2 * 1.3)} ${r1(H * 0.96)} ${r1(tw2 * 1.06)} ${r1(H * 0.84)}`,
    `C${r1(tw2 * 0.92)} ${r1(H * 0.62)} ${r1(tw2 * 0.86)} ${r1(H * 0.3)} ${r1(top)} 4`,
    `Q0 ${r1(-top * 0.35)} ${r1(-top)} 4Z`,
  ].join('');
  const roots = [
    taper([-tw2 * 1.2, H - 2], [-tw2 * 1.8, H + 2], [-tw2 * 2.4, H + 4], [-tw2 * 3.1, H + 7], 7, 1.2),
    taper([tw2 * 1.2, H - 2], [tw2 * 1.8, H + 2], [tw2 * 2.4, H + 4], [tw2 * 3.1, H + 7], 7, 1.2),
    taper([-tw2 * 0.4, H], [-tw2 * 0.6, H + 4], [-tw2 * 0.9, H + 8], [-tw2 * 1.3, H + 10], 5, 1),
    taper([tw2 * 0.5, H], [tw2 * 0.7, H + 4], [tw2 * 1.0, H + 8], [tw2 * 1.4, H + 10], 5, 1),
  ];
  const bark = [
    `M${r1(-tw2 * 0.55)} ${r1(H * 0.08)}C${r1(-tw2 * 0.45)} ${r1(H * 0.4)} ${r1(-tw2 * 0.7)} ${r1(H * 0.7)} ${r1(-tw2 * 0.95)} ${r1(H * 0.95)}`,
    `M${r1(tw2 * 0.6)} ${r1(H * 0.12)}C${r1(tw2 * 0.5)} ${r1(H * 0.45)} ${r1(tw2 * 0.72)} ${r1(H * 0.72)} ${r1(tw2)} ${r1(H * 0.96)}`,
  ];

  // Bounds.
  let minX = -tw2 * 3.2; let maxX = tw2 * 3.2; let minY = 0; const maxY = H + 34;
  for (const it of [...all, ...sideLeaves]) {
    const ext = it.kind === 'tag' ? Math.max(it.w, it.h) / 2 + 4 : it.L / 2 + 6;
    minX = Math.min(minX, it.x - ext); maxX = Math.max(maxX, it.x + ext); minY = Math.min(minY, it.y - ext);
  }
  const pad = 14;
  const bbox = { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad };
  return { fam, items: [...all, ...sideLeaves], wood, twigs, trunk, roots, bark, names, trunkW, trunkH, crownR, bbox };
}

/** Tapered stroke along a cubic Bézier, as a filled outline. */
function taper(p0, p1, p2, p3, w0, w1, steps = 12) {
  const left = [];
  const right = [];
  for (let i = 0; i <= steps; i++) {
    const tt = i / steps;
    const mt = 1 - tt;
    const x = mt * mt * mt * p0[0] + 3 * mt * mt * tt * p1[0] + 3 * mt * tt * tt * p2[0] + tt * tt * tt * p3[0];
    const y = mt * mt * mt * p0[1] + 3 * mt * mt * tt * p1[1] + 3 * mt * tt * tt * p2[1] + tt * tt * tt * p3[1];
    let dx = 3 * mt * mt * (p1[0] - p0[0]) + 6 * mt * tt * (p2[0] - p1[0]) + 3 * tt * tt * (p3[0] - p2[0]);
    let dy = 3 * mt * mt * (p1[1] - p0[1]) + 6 * mt * tt * (p2[1] - p1[1]) + 3 * tt * tt * (p3[1] - p2[1]);
    let len = Math.hypot(dx, dy);
    if (len < 1e-6) { dx = p3[0] - p0[0]; dy = p3[1] - p0[1]; len = Math.hypot(dx, dy) || 1; }
    const nx = -dy / len;
    const ny = dx / len;
    const hw = (w0 + (w1 - w0) * tt) / 2;
    left.push(`${r1(x + nx * hw)} ${r1(y + ny * hw)}`);
    right.push(`${r1(x - nx * hw)} ${r1(y - ny * hw)}`);
  }
  return `M${left.join('L')}L${right.reverse().join('L')}Z`;
}

/** Leaf outline from its stem (0,0) to its tip (L,0); ovate, widest a little before the middle. */
function leafPath(L, H) {
  const w = H * 0.68;
  return `M0 0C${r1(L * 0.1)} ${r1(-w)} ${r1(L * 0.58)} ${r1(-w * 1.02)} ${r1(L)} 0C${r1(L * 0.58)} ${r1(w * 1.02)} ${r1(L * 0.1)} ${r1(w)} 0 0Z`;
}

// ---------------------------------------------------------------------------------------------------------
// SVG

const SVG_NS = 'http://www.w3.org/2000/svg';
function sv(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, String(v));
  for (const c of kids.flat()) if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

let svgSeq = 0;
const CAT_CLASS = { man: 'ht-c-man', mother: 'ht-c-mother', wife: 'ht-c-wife', daughter: 'ht-c-daughter', other: 'ht-c-other' };

/** Build the SVG of a laid-out family. focusAll: every leaf is a tab stop (viewer); else tags + trunk names only. */
function treeSvg(lay, { focusAll = false, animate = false, label = '' } = {}) {
  const id = `ht${++svgSeq}`;
  const { bbox } = lay;
  const svg = sv('svg', {
    class: ['ht-svg', animate ? 'ht-grow' : ''].join(' ').trim(),
    viewBox: `${r1(bbox.x)} ${r1(bbox.y)} ${r1(bbox.w)} ${r1(bbox.h)}`,
    width: r1(bbox.w), height: r1(bbox.h),
    preserveAspectRatio: 'xMidYMax meet',
    role: 'group', 'aria-label': label || null, focusable: 'false',
  });
  const grads = ['man', 'mother', 'wife', 'daughter', 'other'].map((c) => sv('linearGradient', { id: `${id}-g-${c}`, x1: 0, y1: 0, x2: 0, y2: 1 },
    sv('stop', { offset: '0%', class: `ht-s1 ${CAT_CLASS[c]}` }), sv('stop', { offset: '100%', class: `ht-s2 ${CAT_CLASS[c]}` })));
  const defs = sv('defs', null,
    sv('linearGradient', { id: `${id}-trunk`, x1: 0, y1: 0, x2: 1, y2: 0 },
      sv('stop', { offset: '0%', class: 'ht-bark-a' }), sv('stop', { offset: '45%', class: 'ht-bark-b' }), sv('stop', { offset: '100%', class: 'ht-bark-a' })),
    sv('linearGradient', { id: `${id}-hill`, x1: 0, y1: 0, x2: 0, y2: 1 },
      sv('stop', { offset: '0%', class: 'ht-hill-a' }), sv('stop', { offset: '100%', class: 'ht-hill-b' })),
    sv('filter', { id: `${id}-soft`, x: '-20%', y: '-20%', width: '140%', height: '140%' }, sv('feGaussianBlur', { stdDeviation: 9 })),
    sv('pattern', { id: `${id}-dots`, width: 4.5, height: 4.5, patternUnits: 'userSpaceOnUse' }, sv('circle', { cx: 2.25, cy: 2.25, r: 0.85, class: 'ht-pat' })),
    sv('pattern', { id: `${id}-hatch`, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, sv('rect', { x: 0, y: 0, width: 1.3, height: 5, class: 'ht-pat' })),
    ...grads);
  svg.appendChild(defs);

  // Ground: a wide gentle hill (the SVG overflows its viewBox sideways, the frame clips).
  const H = lay.trunkH;
  const span = Math.max(bbox.w, 400) * 1.6;
  svg.appendChild(sv('g', { class: 'ht-ground', 'aria-hidden': 'true' },
    sv('path', { d: `M${r1(-span)} ${H + 600}L${r1(-span)} ${H + 52}Q0 ${H - 48} ${r1(span)} ${H + 52}L${r1(span)} ${H + 600}Z`, fill: `url(#${id}-hill)` }),
    sv('ellipse', { cx: 0, cy: H + 4, rx: lay.trunkW * 2.6, ry: 6, class: 'ht-shadow' })));

  // A soft canopy behind the foliage gives the crown its volume.
  if (lay.items.length) {
    const canopy = sv('g', { class: 'ht-canopy', 'aria-hidden': 'true', filter: `url(#${id}-soft)` });
    for (const it of lay.items) {
      if (it.side) continue;
      const rr = it.kind === 'tag' ? 34 : 26 + it.L * 0.34;
      canopy.appendChild(sv('circle', { cx: r1(it.x), cy: r1(it.y), r: r1(rr) }));
    }
    svg.appendChild(canopy);
  }
  const wood = sv('g', { class: 'ht-wood', 'aria-hidden': 'true', style: `transform-origin: 0px ${H}px` });
  for (const d of lay.roots) wood.appendChild(sv('path', { d, class: 'ht-branch' }));
  wood.appendChild(sv('path', { d: lay.trunk, fill: `url(#${id}-trunk)`, class: 'ht-trunk' }));
  for (const d of lay.bark) wood.appendChild(sv('path', { d, class: 'ht-barkline' }));
  for (const b of lay.wood.slice().sort((a, c) => a.depth - c.depth)) wood.appendChild(sv('path', { d: b.d, class: 'ht-branch' }));
  for (const b of lay.twigs) wood.appendChild(sv('path', { d: b.d, class: 'ht-twig' }));
  svg.appendChild(wood);

  const leaves = sv('g', { class: 'ht-leaves' });
  const tags = sv('g', { class: 'ht-tags' });
  lay.items.forEach((it, k) => {
    const kind = store.isCreated(it.p.id) ? (store.pendingKind(it.p.id) || 'draft') : null;
    const cls = ['ht-item', it.kind === 'tag' ? 'ht-tag' : 'ht-leaf', CAT_CLASS[it.cat], kind ? `is-${kind}` : '', store.me === it.p.id ? 'is-me' : ''].filter(Boolean).join(' ');
    const focusable = it.kind === 'tag' || focusAll;
    const common = {
      class: cls,
      'data-k': k,
      tabindex: focusable ? 0 : null,
      role: focusable ? 'button' : null,
      'aria-label': focusable ? ariaOf(it) : null,
      'aria-haspopup': focusable ? 'dialog' : null,
      'aria-hidden': focusable ? null : 'true',
    };
    if (it.kind === 'tag') {
      const g = sv('g', { ...common, transform: `translate(${r1(it.x)} ${r1(it.y)})` },
        sv('title', null, nameOf(it.p)),
        sv('rect', { class: 'ht-tag-shadow', x: r1(-it.w / 2), y: r1(-it.h / 2 + 1.6), width: r1(it.w), height: r1(it.h), rx: r1(it.h / 2) }),
        sv('rect', { class: 'ht-tag-bg', x: r1(-it.w / 2), y: r1(-it.h / 2), width: r1(it.w), height: r1(it.h), rx: r1(it.h / 2) }),
        sv('text', { class: 'ht-tag-text', x: 0, y: 0, dy: '0.34em', 'text-anchor': 'middle', 'font-size': TAG_FS }, it.text));
      tags.appendChild(g);
      return;
    }
    const deg = Math.atan2(it.axis[1], it.axis[0]) / DEG;
    const flip = Math.abs(deg) > 90;
    const L = it.L;
    const tx = L * 0.5;
    const tw = textWidth(it.text, LEAF_FS);
    const shape = leafPath(L, it.H);
    const inner = sv('g', { class: 'ht-leaf-in', style: `--d:${it.depth || 1}` },
      sv('title', null, nameOf(it.p)),
      sv('path', { class: 'ht-leaf-shape', d: shape, fill: `url(#${id}-g-${it.cat})` }),
      it.cat === 'wife' ? sv('path', { class: 'ht-leaf-pat', d: shape, fill: `url(#${id}-dots)` }) : null,
      it.cat === 'other' ? sv('path', { class: 'ht-leaf-pat', d: shape, fill: `url(#${id}-hatch)` }) : null,
      it.cat === 'daughter' ? sv('path', { class: 'ht-leaf-inline', d: shape, transform: `translate(${r1(L * 0.09)} 0) scale(0.84 0.74)` }) : null,
      sv('path', { class: 'ht-leaf-rib', d: `M2 0H${r1(Math.max(3, tx - tw / 2 - 2))}M${r1(Math.min(L - 5, tx + tw / 2 + 2))} 0H${r1(L - 4)}` }),
      sv('text', {
        class: 'ht-leaf-text', x: r1(tx), y: 0, dy: '0.35em', 'text-anchor': 'middle', 'font-size': LEAF_FS,
        transform: flip ? `rotate(180 ${r1(tx)} 0)` : null,
      }, it.text));
    leaves.appendChild(sv('g', { ...common, transform: `translate(${r1(it.base[0])} ${r1(it.base[1])}) rotate(${r1(deg)})` }, inner));
  });
  svg.appendChild(leaves);
  svg.appendChild(tags);

  // Names on the trunk: the top of the trunk (where it branches) first, then the earlier ancestors below.
  const names = sv('g', { class: 'ht-trunk-names' });
  lay.names.forEach((n, i) => {
    names.appendChild(sv('g', {
      class: ['ht-item', 'ht-trunk-name', i === 0 ? 'is-top' : ''].join(' ').trim(),
      'data-k': `t${i}`, tabindex: 0, role: 'button', 'aria-haspopup': 'dialog',
      'aria-label': i === lay.names.length - 1 ? `${nameOf(n.p)} — ${t('ht.role.founder')}` : nameOf(n.p),
    },
    sv('title', null, nameOf(n.p)),
    sv('rect', { class: 'ht-hit', x: r1(-lay.trunkW * 0.4), y: r1(n.y - n.fs * 0.85), width: r1(lay.trunkW * 0.8), height: r1(n.lines.length * (n.fs + 6)) }),
    n.lines.map((line, j) => sv('text', { x: 0, y: r1(n.y + j * (n.fs + 6)), dy: '0.3em', 'text-anchor': 'middle', 'font-size': r1(n.fs) }, line))));
  });
  svg.appendChild(names);
  return svg;
}

function ariaOf(it) {
  const y = yearsOf(it.p);
  return y ? `${nameOf(it.p)}${currentLang() === 'ar' ? '، ' : ', '}${y}` : nameOf(it.p);
}

/** Small leaf swatch for the legend chips. */
function swatch(cat) {
  const d = leafPath(22, 12);
  return sv('svg', { class: `ht-swatch ${CAT_CLASS[cat]}`, viewBox: '-1 -7 24 14', width: 24, height: 14, 'aria-hidden': 'true', focusable: 'false' },
    sv('path', { class: 'ht-sw-shape', d }),
    cat === 'daughter' ? sv('path', { class: 'ht-sw-inline', d, transform: 'translate(2 0) scale(0.84 0.7)' }) : null,
    cat === 'wife' ? sv('g', { class: 'ht-sw-pat' }, sv('circle', { cx: 7, cy: -1.5, r: 1 }), sv('circle', { cx: 11, cy: 1.5, r: 1 }), sv('circle', { cx: 15, cy: -1.5, r: 1 })) : null,
    cat === 'other' ? sv('path', { class: 'ht-sw-hatch', d: 'M6 3L10 -3M10 3L14 -3M14 3L18 -3' }) : null);
}

// ---------------------------------------------------------------------------------------------------------
// Popover (one at a time)

let pop = null;
function closePop({ restore = false } = {}) {
  if (!pop) return;
  const { el, anchor, off } = pop;
  pop = null;
  off();
  el.remove();
  if (anchor && anchor.isConnected) {
    anchor.setAttribute('aria-expanded', 'false');
    if (restore && anchor.hasAttribute('tabindex')) anchor.focus({ preventScroll: true });
  }
}

function openPop(host, anchor, item, fam, { focus = false } = {}) {
  const same = pop && pop.anchor === anchor;
  closePop();
  if (same || !item) return;
  const p = item.p;
  const lin = lineageOf(p);
  const y = yearsOf(p);
  let role = '';
  if (item.founder) role = t('ht.role.founder');
  else if ((item.cat === 'mother' || item.cat === 'wife') && personName(p, currentLang())) role = t('ht.role.wife', { name: lineageOf(item.rel, { depth: 2 }) });
  else if (item.husband) role = t('ht.role.husband', { name: lineageOf(item.rel, { depth: 2 }) });
  const bs = badges(p);
  const el = h('div', { class: 'ht-pop', dir: currentLang() === 'ar' ? 'rtl' : 'ltr', attrs: { role: 'dialog', 'aria-label': nameOf(p) } },
    h('div', { class: 'ht-pop-head' },
      avatar(p),
      h('div', { class: 'ht-pop-id' },
        nameLabel(p),
        role ? h('span', { class: 'ht-pop-role small' }, bdi(role)) : null,
        lin && lin !== nameOf(p) ? bdi(lin, { class: 'ht-pop-lineage muted small' }) : null,
        y ? h('span', { class: 'muted small' }, y) : null,
        bs.length ? h('span', { class: 'ht-pop-badges' }, bs) : null),
      h('button', { type: 'button', class: 'btn-icon ht-pop-close', attrs: { 'aria-label': t('common.close') }, on: { click: () => closePop({ restore: true }) } }, icon('close'))),
    h('div', { class: 'sheet-list ht-pop-list' },
      h('a', { class: 'sheet-item', href: `#/p/${encodeURIComponent(p.id)}` }, icon('user'), h('span', null, t('ht.openProfile'))),
      h('a', { class: 'sheet-item', href: `#/tree/${encodeURIComponent(fam.head.id)}?focus=${encodeURIComponent(p.id)}` }, icon('tree'), h('span', null, t('ht.showInTree')))));
  el.addEventListener('click', (e) => { if (e.target.closest('a')) closePop(); });
  host.appendChild(el);
  // Position under the anchor (above when there is no room), clamped inside the host (an LTR box).
  const hr = host.getBoundingClientRect();
  const ar = anchor.getBoundingClientRect();
  const pw = el.offsetWidth;
  const ph = el.offsetHeight;
  const hostH = host.clientHeight;
  let top = ar.bottom - hr.top + 6;
  if (top + ph > hostH - 6 && ar.top - hr.top - ph - 6 >= 6) top = ar.top - hr.top - ph - 6;
  top = Math.max(6, Math.min(top, Math.max(6, hostH - ph - 6)));
  let left = ar.left - hr.left + ar.width / 2 - pw / 2;
  left = Math.max(6, Math.min(left, hr.width - pw - 6));
  el.style.setProperty('--pop-x', `${Math.round(left)}px`);
  el.style.setProperty('--pop-y', `${Math.round(top)}px`);
  anchor.setAttribute('aria-expanded', 'true');
  const onDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closePop(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop({ restore: true }); } };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  pop = { el, anchor, off: () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true); } };
  if (focus) el.querySelector('.sheet-item')?.focus({ preventScroll: true });
}

/** The layout item behind an SVG element ([data-k]). */
function itemOf(lay, el) {
  const k = el?.getAttribute('data-k');
  if (k === null || k === undefined) return null;
  if (k.startsWith('t')) {
    const i = Number(k.slice(1));
    const n = lay.names[i];
    return n ? { p: n.p, cat: 'man', founder: i === lay.names.length - 1 } : null;
  }
  return lay.items[Number(k)] || null;
}

// ---------------------------------------------------------------------------------------------------------
// Full-screen viewer (pan / pinch / zoom)

function openViewer(lay, title, { at = null, opener = null } = {}) {
  closePop();
  const svg = treeSvg(lay, { focusAll: true, label: title });
  const { bbox } = lay;
  const canvas = h('div', { class: 'ht-viewer-canvas' }, svg);
  const surface = h('div', { class: 'ht-viewer-surface ht-sky', attrs: { tabindex: '-1' } }, canvas);
  const zoomBtn = (ic, label, fn) => h('button', { type: 'button', class: 'btn btn-icon btn-sm', attrs: { 'aria-label': label, title: label }, on: { click: fn } }, icon(ic));
  const dlg = h('dialog', { class: 'ht-viewer', attrs: { 'aria-label': title } },
    h('header', { class: 'ht-viewer-bar' },
      h('h2', { class: 'ht-viewer-title' }, title),
      h('div', { class: 'ht-viewer-tools' },
        zoomBtn('zoomOut', t('ht.zoomOut'), () => zoomBy(1 / 1.35)),
        zoomBtn('zoomIn', t('ht.zoomIn'), () => zoomBy(1.35)),
        zoomBtn('fit', t('ht.fit'), () => { fit(); apply(); }),
        h('a', { class: 'btn btn-sm ht-viewer-detailed', href: `#/tree/${encodeURIComponent(lay.fam.head.id)}` }, icon('tree', { size: 16 }), h('span', null, t('ht.detailed'))),
        h('button', { type: 'button', class: 'btn btn-icon btn-sm ht-viewer-close', attrs: { 'aria-label': t('common.close') }, on: { click: () => close() } }, icon('close')))),
    surface,
    h('p', { class: 'ht-viewer-hint' }, t('ht.viewerHint')));

  let s = 1; let x = 0; let y = 0; let minS = 0.2; const maxS = 4;
  const apply = () => { canvas.style.transform = `translate(${r1(x)}px, ${r1(y)}px) scale(${s})`; };
  const fit = () => {
    const sw = surface.clientWidth || innerWidth;
    const sh = surface.clientHeight || innerHeight;
    s = Math.min(sw / bbox.w, sh / bbox.h) * 0.96;
    minS = Math.min(s, 1) * 0.7;
    x = (sw - bbox.w * s) / 2;
    y = (sh - bbox.h * s) / 2;
  };
  const zoomAt = (px, py, f) => {
    const ns = clamp(s * f, minS, maxS);
    x = px - (px - x) * (ns / s);
    y = py - (py - y) * (ns / s);
    s = ns;
    apply();
  };
  const zoomBy = (f) => { closePop(); zoomAt(surface.clientWidth / 2, surface.clientHeight / 2, f); };

  // Pointers: one = pan, two = pinch; a short still press = tap (opens the popover).
  const pts = new Map();
  let moved = 0;
  let pinch = null;
  surface.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.ht-pop')) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    try { surface.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (pts.size === 1) moved = 0;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1 };
      closePop();
    }
  });
  surface.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    const cur = [e.clientX, e.clientY];
    pts.set(e.pointerId, cur);
    if (pts.size === 1) {
      const dx = cur[0] - prev[0];
      const dy = cur[1] - prev[1];
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 6) { if (pop) closePop(); x += dx; y += dy; apply(); }
    } else if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
      const r = surface.getBoundingClientRect();
      zoomAt((a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top, d / pinch.d);
      pinch.d = d;
      moved = 99;
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0 && moved <= 6 && e.type === 'pointerup') {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-k]');
      const item = el && itemOf(lay, el);
      if (item) openPop(surface, el, item, lay.fam);
      else closePop();
    }
  };
  surface.addEventListener('pointerup', up);
  surface.addEventListener('pointercancel', up);
  surface.addEventListener('wheel', (e) => {
    e.preventDefault();
    closePop();
    const r = surface.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });
  surface.addEventListener('keydown', (e) => {
    const el = e.target.closest?.('[data-k]');
    if (el && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openPop(surface, el, itemOf(lay, el), lay.fam, { focus: true });
      return;
    }
    const step = 60;
    const map = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (map[e.key] && !el) { e.preventDefault(); x += map[e.key][0]; y += map[e.key][1]; apply(); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.25); }
    else if (e.key === '-') { e.preventDefault(); zoomBy(1 / 1.25); }
  });
  // Keep the focused item in view.
  surface.addEventListener('focusin', (e) => {
    const el = e.target.closest?.('[data-k]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const sr = surface.getBoundingClientRect();
    if (r.left < sr.left + 20) x += sr.left + 40 - r.left;
    if (r.right > sr.right - 20) x -= r.right - sr.right + 40;
    if (r.top < sr.top + 20) y += sr.top + 40 - r.top;
    if (r.bottom > sr.bottom - 20) y -= r.bottom - sr.bottom + 40;
    apply();
  });

  const close = () => {
    closePop();
    try { dlg.close(); } catch { /* ignore */ }
    dlg.remove();
    document.body.classList.remove('modal-open');
    removeEventListener('resize', onResize);
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
  };
  const onResize = () => { fit(); apply(); };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.appendChild(dlg);
  document.body.classList.add('modal-open');
  dlg.showModal();
  addEventListener('resize', onResize);
  fit();
  if (at) {
    // Opened by tapping a spot: zoom so names are comfortably readable, centred on that spot.
    const sw = surface.clientWidth;
    const sh = surface.clientHeight;
    const ns = clamp(15 / LEAF_FS, s, maxS);
    s = ns;
    x = sw / 2 - (at[0] - bbox.x) * s;
    y = sh / 2 - (at[1] - bbox.y) * s;
  }
  apply();
  surface.focus({ preventScroll: true });
  return close;
}

// ---------------------------------------------------------------------------------------------------------
// The section

let grownOnce = false;
const narrow = () => { try { return matchMedia('(max-width: 700px)').matches; } catch { return false; } };

/**
 * The family-trees section of the home page (one illustrated tree per family branch).
 */
export function abstractTree(graph, { lang: l = currentLang() } = {}) {
  const rtl = l === 'ar';
  const section = h('section', { class: 'home-trees', attrs: { 'aria-labelledby': 'ht-title' } });
  const disposers = [];
  section.dispose = () => { closePop(); for (const fn of disposers.splice(0)) { try { fn(); } catch { /* ignore */ } } };

  const show = readShow();
  let fams = familyTrees(graph, show);
  if (!fams.length) {
    section.append(
      h('div', { class: 'section-title' }, h('h2', { id: 'ht-title' }, t('ht.sectionTitle'))),
      h('p', { class: 'muted' }, t('ht.empty')));
    return section;
  }
  const famTitle = (f) => t('ht.treeOf', { family: bi(f.family) });

  // Selected family on phones (remembered).
  let selected = readPref('family');
  if (!fams.some((f) => f.head.id === selected)) selected = fams[0].head.id;

  const grid = h('div', { class: ['ht-grid', `ht-n${Math.min(fams.length, 3)}`] });
  const switcher = fams.length > 1
    ? h('div', { class: 'segmented segmented-block ht-switch', attrs: { role: 'group', 'aria-label': t('ht.families') } },
      fams.map((f) => h('button', {
        type: 'button',
        dataset: { head: f.head.id },
        attrs: { 'aria-pressed': String(f.head.id === selected) },
        on: { click: () => select(f.head.id) },
      }, icon('tree', { size: 16 }), h('span', null, bi(f.family)))))
    : null;

  const chips = h('div', { class: 'ht-legend', attrs: { role: 'group', 'aria-label': t('ht.show') } },
    h('span', { class: 'chip ht-chip ht-chip-static', title: t('ht.tip.men') }, swatch('man'), h('span', null, t('ht.cat.men'))),
    LEAF_CATS.map((c) => h('button', {
      type: 'button',
      class: ['chip', 'ht-chip', `ht-chip-${c}`],
      title: t(`ht.tip.${c}`),
      dataset: { cat: c },
      attrs: { 'aria-pressed': String(!!show[c]) },
      on: {
        click: (e) => {
          show[c] = !show[c];
          writePref(c, show[c] ? '1' : '0');
          e.currentTarget.setAttribute('aria-pressed', String(show[c]));
          fams = familyTrees(graph, show);
          draw({ leavesOnly: true });
        },
      },
    }, swatch(c === 'mothers' ? 'mother' : c === 'wives' ? 'wife' : c === 'daughters' ? 'daughter' : 'other'), h('span', null, t(`ht.cat.${c}`)))));

  const hint = h('p', { class: 'ht-hint muted small' });
  const summary = h('div', { class: 'sr-only' });
  const bridgesLine = h('div', { class: 'ht-bridges' });

  function select(id) {
    selected = id;
    writePref('family', id);
    closePop();
    for (const b of switcher?.querySelectorAll('button') || []) b.setAttribute('aria-pressed', String(b.dataset.head === id));
    for (const fr of grid.querySelectorAll('.ht-tree')) fr.classList.toggle('is-selected', fr.dataset.head === id);
  }

  // Side by side on wide screens — unless that would shrink a tree too much: then one tree per row.
  let lays = [];
  function arrange() {
    let vw = 1280;
    try { vw = grid.isConnected ? grid.clientWidth : Math.min(document.documentElement.clientWidth, 1120) - 64; } catch { /* keep */ }
    const cols = fams.length > 1 && vw >= 940 ? Math.min(fams.length, 3) : 1;
    const col = (vw - (cols - 1) * 16) / cols;
    const cramped = cols > 1 && lays.some((x) => col / x.bbox.w < 0.62);
    grid.classList.toggle('ht-stack', cramped);
  }

  function draw({ leavesOnly = false } = {}) {
    closePop();
    const animate = !grownOnce;
    grownOnce = true;
    grid.replaceChildren();
    const lines = [];
    lays = fams.map((fam) => layoutFamily(fam, { rtl, lang: l }));
    arrange();
    for (const [fi, fam] of fams.entries()) {
      const lay = lays[fi];
      const title = famTitle(fam);
      const svg = treeSvg(lay, { animate, label: title });
      if (leavesOnly) svg.classList.add('ht-fade');
      const stage = h('div', { class: 'ht-stage' }, svg);
      const enlarge = h('button', {
        type: 'button', class: 'btn btn-sm ht-enlarge',
        attrs: { 'aria-label': t('ht.enlargeTree', { tree: title }) },
        on: { click: (e) => openViewer(lay, title, { opener: e.currentTarget }) },
      }, icon('zoomIn', { size: 16 }), h('span', null, t('ht.enlarge')));
      const frame = h('article', {
        class: ['ht-tree', fam.head.id === selected ? 'is-selected' : ''],
        dataset: { head: fam.head.id },
        attrs: { 'aria-labelledby': `ht-t-${fam.index}` },
      },
      h('div', { class: 'ht-frame ht-sky' },
        h('header', { class: 'ht-banner' },
          h('h3', { id: `ht-t-${fam.index}`, class: 'ht-name' }, title),
          h('p', { class: 'ht-count' }, t('ht.counts', { men: plural('ht.men', fam.stats.men), women: plural('ht.women', fam.stats.women) }))),
        stage),
      h('div', { class: 'ht-tree-foot' },
        enlarge,
        h('a', { class: 'btn btn-sm btn-ghost', href: `#/tree/${encodeURIComponent(fam.head.id)}` }, icon('tree', { size: 16 }), h('span', null, t('ht.detailed')))));
      // Interaction: phones open the viewer at the tapped spot; wider screens open the popover.
      svg.addEventListener('click', (e) => {
        if (narrow()) {
          let at = null;
          try {
            const m = svg.getScreenCTM()?.inverse();
            if (m) { const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m); at = [q.x, q.y]; }
          } catch { at = null; }
          openViewer(lay, title, { at, opener: enlarge });
          return;
        }
        const el = e.target.closest('[data-k]');
        if (!el) { closePop(); return; }
        openPop(stage, el, itemOf(lay, el), fam);
      });
      svg.addEventListener('keydown', (e) => {
        const el = e.target.closest?.('[data-k]');
        if (!el || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        openPop(stage, el, itemOf(lay, el), fam, { focus: true });
      });
      grid.appendChild(frame);
      lines.push(t('ht.summary', {
        tree: title,
        generations: plural('ht.gens', fam.stats.gens),
        men: plural('ht.men', fam.stats.men),
        women: plural('ht.women', fam.stats.women),
        founder: nameOf(fam.head),
      }));
    }
    summary.replaceChildren(...lines.map((x) => h('p', null, x)));
    hint.textContent = narrow() ? t('ht.hintTap') : t('ht.hintClick');
  }

  // Marriages that join two families.
  const bridges = familyBridges(graph, fams).slice(0, 3);
  const person = (p) => h('a', { href: `#/p/${encodeURIComponent(p.id)}` }, bdi(lineageOf(p, { depth: 2 })));
  for (const b of bridges) {
    const a = bi(fams[b.from].family);
    let c = bi(fams[b.to].family);
    if (l === 'en') c = c.replace(/^The /, 'the ');
    const tpl = t('ht.bridge', { a, b: c, husband: '\u0001', wife: '\u0002' });
    const parts = tpl.split(/([\u0001\u0002])/).map((x) => (x === '\u0001' ? person(b.husband) : x === '\u0002' ? person(b.wife) : x));
    bridgesLine.appendChild(h('p', { class: 'ht-bridge small' }, h('span', { class: 'ht-rings', attrs: { 'aria-hidden': 'true' } }, icon('heart', { size: 14 })), h('span', null, ...parts)));
  }

  draw();
  section.append(
    h('div', { class: 'section-title' }, h('h2', { id: 'ht-title' }, t('ht.sectionTitle'))),
    h('p', { class: 'ht-lead muted' }, t('ht.lead')),
    h('div', { class: 'ht-controls' }, switcher, chips),
    grid,
    hint,
    bridges.length ? bridgesLine : null,
    summary);

  // Fonts arriving after the first layout change the name widths: lay out again once.
  try {
    if (document.fonts && document.fonts.status !== 'loaded') {
      let alive = true;
      disposers.push(() => { alive = false; });
      document.fonts.ready.then(() => { fontFamily = ''; if (alive && section.isConnected) draw(); });
    }
  } catch { /* ignore */ }
  let resizeTimer = null;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (section.isConnected) arrange(); }, 150); };
  addEventListener('resize', onResize);
  disposers.push(() => { removeEventListener('resize', onResize); clearTimeout(resizeTimer); });
  // Phone ↔ wide: the hint and the click behaviour follow the width.
  try {
    const mq = matchMedia('(max-width: 700px)');
    const onMq = () => { closePop(); hint.textContent = mq.matches ? t('ht.hintTap') : t('ht.hintClick'); };
    mq.addEventListener('change', onMq);
    disposers.push(() => mq.removeEventListener('change', onMq));
  } catch { /* ignore */ }
  return section;
}
