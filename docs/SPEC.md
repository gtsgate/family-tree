# Grand Family Tree — Technical Specification (v2)

Single source of truth for every module. If code and spec disagree, the spec wins (or is changed deliberately).
v2 incorporates an independent design review (UX/culture, GitHub automation/security, genealogy data model).

## 0. Goals

A bilingual (Arabic / English) collaborative family-tree portal:

* Hosted free on **GitHub Pages**, readable by everyone, no login to browse (`noindex` — not listed by search engines).
* Relatives **propose** changes: add people (spouses, children, parents, siblings — whole branches at once), correct info,
  "mark as" (deceased, verified, needs-info, duplicate, private…), re-arrange (order of children/spouses, change parents).
  Proposals never change the live data directly.
* **Only approvers** (the owner; `config.approvers`) can approve, on GitHub (label or `/approve` comment). A GitHub Action
  validates, applies to `data/family.json`, commits, and the site updates.
* **Owner mode** (§5.1): the keeper — an approver signed in on a device with a GitHub key — edits the tree DIRECTLY from the
  site, always: every change is committed at once (no proposal, no approval step), and a relative's proposal can be applied
  with "Apply now".
* **Deletion is never casual**: removals are soft (restorable), need a reason code + typed-name confirmation, are blocked when
  they would orphan descendants, are capped per proposal, and need a *separate* approval (`approve-deletion`). Any approval can be
  undone (`/undo`).
* Spouses who married in can add *their own* families → the model is a graph (unions), not a single tree.
* Most relatives will use **WhatsApp**, not GitHub: WhatsApp-to-owner is the primary send path; GitHub is optional. When the owner
  sets up the **e-mail relay** (§5, §6.8), "Send to {owner}" posts the proposal for them and the owner approves by replying to an
  e-mail — nobody copies codes; WhatsApp then becomes one of the other ways.
* Privacy & culture: living people's birth dates default to year-only and are *stored* truncated; names may be withheld
  (shown as kunya or polite relational label); divorce is not displayed by default; no crosses for the deceased.
* Zero build step, zero runtime dependencies: plain HTML + CSS + ES modules. Node ≥ 20 (CI uses 22) for scripts/tests.

## 1. Repository layout

The portal lives in `family-tree/` (movable to its own repo unchanged). The repo root hosts an unrelated app (Spelling Coach) —
never touch files outside `family-tree/` and `.github/`.

```
family-tree/
  index.html  manifest.json  config.json  package.json
  img/                         # icons, og image
  data/
    family.json                # canonical data (§2)
    changelog.json             # applied proposals, newest first (§6.6)
    applied.json               # permanent ledger of applied proposal hashes (§6.6) — never truncated
    photos/                    # optional person photos  <personId>.jpg|webp
  css/  base.css tree.css person.css forms.css pages.css home-tree.css flows.css owner.css
  js/
    core/                      # PURE logic (no DOM/fetch). Browser AND Node ES modules.
      schema.js dates.js names.js graph.js ops.js codec.js describe.js kinship.js messages.js
    i18n.js dom.js store.js app.js ui.js submit.js owner.js (owner mode: GitHub API, save queue) owner-ui.js
    views/   home.js home-tree.js tree.js person.js search.js wizard.js draft.js me.js relationship.js changes.js about.js admin.js preview.js
    forms/   person-form.js dialogs.js picker.js
  scripts/
    apply-proposal.mjs  check-proposal.mjs  validate-data.mjs  import-initial.mjs  backup.mjs(optional)
    lib/  github.mjs labels.mjs commands.mjs render.mjs hash.mjs repo.mjs
  tests/   *.test.mjs (node:test)   e2e/smoke.mjs (Playwright, local only)   fake-github-api.mjs (owner-mode fake API)
  tools/relay/Code.gs          # e-mail relay (Google Apps Script web app + 5-minute trigger, run by the owner) — §5, §6.8
  docs/    SPEC.md  OWNER-GUIDE.md
.github/
  workflows/family-tree-check.yml     # issues opened/edited/reopened → dry-run + bot comment
  workflows/family-tree-apply.yml     # approvals queue → apply → commit → comment/close; /reject /undo
  workflows/family-tree-ci.yml        # push/PR touching family-tree/** → tests + validate-data
  workflows/family-tree-backup.yml    # weekly data release
  ISSUE_TEMPLATE/family-tree-proposal.yml
  ISSUE_TEMPLATE/config.yml           # blank_issues_enabled: true (keeps Spelling Coach issues working)
```
Live URL (after merge to `main`; Pages "deploy from branch" root): `https://<owner>.github.io/<repo>/family-tree/`.
All site paths are relative. GitHub automation & the issue form only work once merged to the default branch.

## 2. Data model — `data/family.json`

```jsonc
{
  "schema": 1,
  "meta": { "title": {"ar":"…","en":"…"}, "rootPersonId": "p…", "revision": 12, "updatedAt": "ISO", "demo": false },
  "people": { "<pid>": Person },     // keyed by id, insertion order = creation order
  "unions": { "<uid>": Union }
}
```

### 2.1 Person — full in-memory shape (`normalizePerson`)
```jsonc
{
  "id": "pa1b2c3d",
  "name":       {"ar": "أحمد", "en": "Ahmad"},  // GIVEN name only (ism; compounds like "عبد الله", "عماد الدين" are one name)
  "nameStatus": "known",                       // "known" | "unknown" | "withheld"  (see below)
  "surname":    {"ar": "", "en": ""},          // family/tribe name or rest of a married-in spouse's full name, rendered VERBATIM
  "nickname":   {"ar": "", "en": ""},          // kunya/laqab/other name: "أبو خالد", "بيبي"
  "hideKunya":  false,                         // true: no kunya shown beside the name at all (recorded or automatic)
  "gender":     "m",                           // "m" | "f" | ""   (UI requires it for new people; data may be "")
  "birth":  {"date": "1950", "hijri": "", "approx": false, "place": {"ar":"","en":""}},
  "deceased":   false,
  "death":  {"date": "", "hijri": "", "approx": false, "place": {"ar":"","en":""}},
  "occupation": {"ar": "", "en": ""},
  "bio":        {"ar": "", "en": ""},
  "photo":      "",                            // "" | "https://…" | "photos/<pid>.jpg|webp"
  "privacy":    "year",                        // birth-date precision STORED & shown: "full" | "year" | "hidden"
  "tags":       [],                            // "verified", "needs-info"
  "needsInfo":  "",                            // what is missing (free text, ≤300)
  "duplicateOf": "",
  "spouseOrder": [],                           // uids: display order of this person's unions
  "ties": [],                                  // non-biological ties, see below
  "removed":    null,                          // soft-delete record (§2.4) or null
  "history":    []                             // newest last, max 20: {"issue":12|null,"rev":13,"at":"ISO","action":"add-person","from"?:uid,"index"?:n}
}
```
* **Auto English** (`js/core/translit.js`): `name.en`, `surname.en`, `nickname.en` are stored ONLY when someone typed or corrected
  them. When empty, the English spelling is generated from the Arabic (`englishOf(field, kind)`; dictionary of preferred spellings —
  the owner chose **Muhammad** for محمد — plus compound rules and a letter-based fallback). Every English display (cards, lineage,
  describe, search index, issue text) uses `englishOf`, never raw Arabic, when the language is English. Forms auto-fill the English
  field live as Arabic is typed until the user edits it; on save the English value is sent only if it differs from the automatic one.
  The person page marks automatic spellings subtly ("automatic spelling — correct it") so each person can choose their own.
* **Compact stored form** (`compactPerson`): drops `""`, empty bilingual objects, `approx:false`, empty arrays, `null`, `deceased:false`,
  `hideKunya:false`, `nameStatus:"known"`, `privacy:"full"`; empty `birth`/`death` objects. Always keeps `id`. Key order on write = order above.
  `normalizePerson` restores the full shape. Note: compact drops `privacy:"full"`, so a missing `privacy` means `"full"`.
* **nameStatus**: `known` → `name.ar` or `name.en` or `nickname.*` non-empty (kunya-only men allowed).
  `unknown` / `withheld` → `name.ar` and `name.en` MUST be empty (`NAME_SHOULD_BE_EMPTY`) so a withheld name never reaches the repo.
  Display for unknown/withheld: nickname if any (e.g. "أم خالد"), else a polite relational label computed by names.js
  (§4 names). Surname may still be shown.
* **Kunya** (`names.js`): beside a known name the site shows the recorded `nickname`, else an AUTOMATIC kunya «أبو/أم + eldest son
  (else eldest daughter)» (`autoKunya`), low-key. **`hideKunya`** (boolean, default `false`; `normalizePerson` keeps a real boolean only,
  `validateData` type-checks it) hides both: `nickOf()` → `""` and `displayName()` shows no kunya; someone who would be shown BY their
  kunya (kunya-only, or an unknown/withheld name) gets the polite relational label instead; a relative whose kunya is hidden is not named
  by it in others' labels. The recorded nickname stays in the data and search still finds it. The form offers «إخفاء الكنية» /
  "Don't show a kunya" under the kunya field (§7.4); a merge keeps it hidden when either record hides it.
* **Privacy is enforced in storage**: `normalizePerson` truncates `birth.date`/`birth.hijri` to the year when `privacy:"year"` and clears
  them when `"hidden"`. So private detail never reaches the public repo, whatever path the data came from.
  Forms default to `year` for every living person; `full` is the default only for deceased people (or after an explicit warning).
* **Dates**: partial Gregorian `"YYYY" | "YYYY-MM" | "YYYY-MM-DD"` (real calendar dates, year 1–9999) or `""`.
  `hijri` holds the date *as entered* in Hijri (`"YYYY"…`, year 1–1500). When `hijri` is set, `date` is derived from it:
  full → exact Gregorian (Umm al-Qura via Intl); year/month only → Gregorian of day 1 of that Hijri year/month, `approx:true`.
  Setting `date` directly (edit path `birth.date`) clears `hijri`. Display shows the original calendar first.
* `death.date` or `death.hijri` non-empty ⇒ `deceased:true`. Setting `deceased:false` clears `death.*`.
* **ties** (never parentage — excluded from ancestors, cycles, lineage, branches, generations, invariant 6):
  `{"type": "milk-child-of" | "foster-child-of", "person": "<pid>", "note": {"ar":"","en":""}}` stored on the child;
  milk-child-of = nursed by (rada'a); foster-child-of = raised under kafala by.

### 2.2 Union — a couple and/or a set of children sharing parents
```jsonc
{
  "id": "ux9y8z7w",
  "partners": ["p…", "p…"],          // 0..2 distinct (0 = siblings with unknown parents)
  "children": ["p…", "p…"],          // ORDERED (birth order / as re-arranged)
  "status":   "married",             // "married" | "divorced" | "widowed" | "unknown"
  "marriage": {"date": "", "hijri": "", "approx": false, "place": {"ar":"","en":""}},
  "divorce":  {"date": "", "hijri": "", "approx": false},
  "note":     {"ar": "", "en": ""},  // ≤500, e.g. "remarried in 1980"
  "removed":  null
}
```
Compact drops empty `marriage`/`divorce`/`note`, `status:"unknown"`, empty `children`, `removed:null`.
Remarriage to the same person = the same union (status back to `married`; earlier divorce in `note`).
Widowhood is *derived*: status `married` + a deceased partner → UI shows أرملة/أرمل (widow/widower), kinship says "late husband".
`config.showDivorce` (default `false`): when false, divorced unions display like any marriage and kinship never says "former".

### 2.3 Invariants — `validateData(data, {allowTempIds = false})` → `{ok, errors:[Issue], warnings:[Issue]}`
Errors:
1. `schema === 1`; `people`/`unions` are objects; keys equal ids.
2. ids: people `/^p[a-z0-9]{3,24}$/`, unions `/^u[a-z0-9]{3,24}$/`. With `allowTempIds` (preview mode only) also people `/^new[0-9]+$/`,
   unions `/^newu[0-9]+$/` and `/^tmpu[0-9]+$/`.
3. nameStatus rules (§2.1). 4. Enumerations, dates (incl. hijri), photo format, string limits.
5. Union partners ≤2, distinct, existing; children existing, no duplicates; nobody is partner and child of the same union.
6. A person is a child of **at most one** non-removed union.
7. No cycles (ancestor = partner of birth union, transitively, active unions only).
8. `duplicateOf`, `removed.mergedInto`, `ties[].person` reference existing people ≠ self.
9. At most one active union per 2-partner set, and at most one active single-partner union per person (`DUPLICATE_UNION`).
10. In an active 2-partner union neither partner is an ancestor of the other (`ANCESTOR_LINK`).
11. `privacy` truncation respected (`PRIVATE_DATE_STORED`).
Warnings: stale `spouseOrder`; root missing/removed; death before birth; child born before parent aged 12 / >1y after father's death /
after mother's death (±1y tolerance for Hijri-year-only dates); siblings with the same normalized name; `SAME_GENDER_PARTNERS`;
`PARENT_GENDER_UNKNOWN`; `MARRIAGE_BEFORE_12`; `MARRIAGE_AFTER_DEATH`; `WIDOWED_BUT_LIVING`; `CONCURRENT_HUSBANDS`;
`DIVORCE_DATE_WITHOUT_STATUS`; union with < 2 members.

`Issue` = `{code: "UPPER_SNAKE", params: {...}, op?: number, path?: string}`; `messages.js#formatIssue(issue, lang)` renders every code in `ar` and `en`.

### 2.4 Removal records
`removed = {at, reasonCode, issue, by, mergedInto?, with?, auto?, merge?}` where
`reasonCode ∈ "duplicate" | "entered-by-mistake" | "wrong-parents" | "person-requested" | "other"` — **no free text** (sensitive
family matters stay private; "other" → the UI asks the user to explain to the owner on WhatsApp).
`with: pid` = union auto-removed because that person was removed; `auto: true` = removed because it became empty.

## 3. Proposals

### 3.1 Envelope
```jsonc
{ "kind": "gft-proposal", "v": 1,
  "id": "k3j9x0a2mq",                 // 10 random base36 chars, stable for this proposal
  "createdAt": "ISO", "baseRevision": 12,
  "dependsOn": ["<proposalId>", …],   // earlier proposals (same browser) whose temp refs this one uses
  "submitter": {"name": "", "relation": "", "personId": ""},
  "note": "",                          // ≤2000
  "ops": [Op, …] }                     // 1..150
```
LIMITS: ops ≤150; names ≤100; surname/nickname/place ≤200; other text ≤2000; bio ≤4000; needsInfo ≤300; union note ≤500;
encoded code ≤ 60,000 chars; decoded JSON ≤ 1 MB; destructive ≤3 + merges ≤30 per proposal.

### 3.2 References & resolution
* `PersonRef` = existing person id, or temp ref `/^new[0-9]+$/` declared by an `add-person` (`ref`) earlier in this proposal **or** in a
  proposal listed in `dependsOn`. `UnionRef` = existing union id or `/^newu[0-9]+$/` bound by an op's `unionRef`.
* Temp refs come from a per-browser monotonic counter (never reused, even across drafts), so refs are unique across one person's proposals.
* Re-declaring a ref → `DUPLICATE_REF`; undeclared temp ref → `UNKNOWN_REF` (in final mode refs from `dependsOn` resolve via `opts.refMap`;
  a missing dependency → `DEPENDS_ON_PENDING {proposalId}`); a real-looking id that does not exist → `UNKNOWN_ID`.
* Resolving any ref field (id, of, with, a, b, union, keep, remove, mark `of`, `order[]`, tie person): if the target exists but is removed
  and has `removed.mergedInto` → follow it (transitively, ≤10 hops), warning `MERGED_REDIRECT {from,to}`; removed without mergedInto →
  `TARGET_REMOVED` (except restore ops, which require a removed target).
* Ops that use **or** create a union carry `"unionRef":"newuN"` (the site always sets it), binding the ref to the union actually used.
  Without it, a created union gets preview id `tmpu<n>` (not referenceable).

### 3.3 Operations
`PersonInput` = any of `name, nameStatus, surname, nickname, hideKunya, gender, birth, deceased, death, occupation, bio, photo, privacy, needsInfo`.
Unknown keys → `UNKNOWN_FIELD`.

| op | fields | semantics |
|---|---|---|
| `add-person` | `ref`, `person`, `link`?, `unionRef`?, `index`? | Create person (nameStatus rules apply). Warning `POSSIBLE_DUPLICATE {id}` when an active person has the same normalized given name AND (same target birth union \| same father \| same normalized surname & birth year ±2 \| link is spouse/parent and same nickname or surname). Warning `MINOR_DETAIL` if a person under 18 has photo/bio/occupation/birth place or a full birth date. Warning `NAME_LOOKS_FULL` (name contains بن/بنت/ابن/bin/bint/ibn or > 2 tokens after joining compounds). Warning `GENDER_MISSING`. |
| `edit-person` | `id`, `set` {path:value}, `before`? | Paths: `name.ar name.en nameStatus surname.ar surname.en nickname.ar nickname.en hideKunya gender birth.date birth.hijri birth.approx birth.place.ar birth.place.en deceased death.date death.hijri death.approx death.place.ar death.place.en occupation.ar occupation.en bio.ar bio.en photo privacy`. Result must satisfy nameStatus rules (`NAME_REQUIRED`). `hideKunya` (and `deceased`, `*.approx`) take a boolean (`BAD_TYPE` otherwise); describe reads `{hideKunya}` alone as «إخفاء كنية X» / "Hide the kunya of X" («إظهار كنية X» / "Show the kunya of X"). `before[path]` ≠ current → `STALE_EDIT`: **error in final mode** unless `opts.force`, warning in preview. Changing gender of a parent → warning `GENDER_FLIPS_PARENT`. |
| `mark` | `id`, `mark`, `date`?, `hijri`?, `of`?, `note`? | `deceased` (deceased=true; date/hijri → death) · `living` (deceased=false, death cleared) · `verified`/`unverified` · `needs-info` (tag + needsInfo=note) / `info-complete` · `duplicate` (duplicateOf=`of`, active other person) / `not-duplicate` · `private` (privacy→year with truncation, clears places, occupation, bio, photo, sets nameStatus `withheld` and clears name — for people who ask to be hidden; links kept). |
| `link-spouse` | `a`, `b`, `status`?, `marriage`?, `unionRef`? | New union [a,b]. Errors `SAME_PERSON`, `DUPLICATE_UNION`, `ANCESTOR_LINK`. |
| `move-person` | `id`, `to`: `{union}` \| `{of, with}`, `unionRef`?, `index`? | Change parents (remove from current birth union, add to target resolved as in §3.4). Errors `INVALID_RELATION` (target has id as partner), `CYCLE`, `ANCESTOR_LINK`. If a known parent (an active partner of the old birth union not in the target) is dropped → warning `REPARENT {from, droppedParents, descendants}` and the proposal becomes destructive (needs approve-deletion; does not count toward the cap). History `{action, from, index}`. |
| `edit-union` | `union`, `set`, `before`? | Paths: `status marriage.date marriage.hijri marriage.approx marriage.place.ar marriage.place.en divorce.date divorce.hijri divorce.approx note.ar note.en`. STALE_EDIT as edit-person. |
| `reorder-children` | `union`, `order`, `beforeOrder`? | New order = listed current children in that order + the rest in current order. Unknown ids → warning `ORDER_IGNORED`. `beforeOrder` ≠ current → STALE_EDIT rule. |
| `reorder-spouses` | `id`, `order` [UnionRef] | spouseOrder = listed unions containing id, then the remaining ones in current display order. |
| `add-tie` | `id`, `type`, `person`, `note`? | Add a milk/foster tie (no duplicates `DUPLICATE_TIE`, not self). |
| `restore-person` | `id` | `removed=null`; re-activates unions with `removed.with===id`. Errors `RESTORE_CONFLICT {reason}` (would break invariants 6/9/10 or create a cycle); merged person → `MERGED_USE_UNDO`. |
| `restore-union` | `union` | Re-activate a removed union (same conflict checks). |
| **`remove-person`** ⚠ | `id`, `reasonCode`, `redact`? | Soft delete. Errors `IS_ROOT`, `HAS_CHILDREN {children}` (active children in any of their unions), `ALREADY_REMOVED`. Also soft-removes their active childless unions (`removed.with=id`). `redact:true` additionally clears every personal field (nameStatus withheld) — for "remove me" requests. |
| **`unlink-spouse`** ⚠ | `union`, `reasonCode` | Soft-remove a 2-partner union; `HAS_CHILDREN` if it has active children. |
| **`detach-person`** ⚠ | `id`, `reasonCode` | Remove id from its birth union's children (UI label: "linked to the wrong parents"). Union kept (soft-removed with `auto` if emptied). History `{from, index}` so `move-person {union: from}` undoes it. |
| **`remove-tie`** ⚠ | `id`, `type`, `person`, `reasonCode` | Remove a tie. |
| **`merge-person`** ⚠ | `keep`, `remove`, `reasonCode`, `parents`? (`"keep"\|"remove"`) | `remove` is the same human as `keep`. Errors: `SAME_PERSON`, `TARGET_REMOVED`, `MERGE_SPOUSES` (they are partners in one union), `GENDER_CONFLICT`, `ANCESTOR_LINK`, `CYCLE` (checked on result), `CONFLICTING_PARENTS` (different birth unions and no `parents` choice). Unions where `remove` is partner → `keep` replaces it; if that yields two active unions with the same partner set, the later one's children are appended to the earlier, empty marriage/status fields filled, and the later is soft-removed with `mergedInto`. Birth union: `parents` decides; same union → drop remove; only remove has one → keep takes its slot. Empty fields of keep filled from remove; differing non-empty fields → warning `MERGE_FIELD_CONFLICT {path, keep, remove}` (keep wins). Tags/ties merged; `hideKunya` kept when either record has it; others' `duplicateOf===remove` → keep (cleared if self); `rootPersonId===remove` → keep; remove's unions appended to keep.spouseOrder. `remove.removed = {…, mergedInto: keep}`. Undo is via `/undo` (§6.5). |

⚠ destructive. `DESTRUCTIVE_OPS = remove-person, unlink-spouse, detach-person, remove-tie, merge-person`; plus move-person with REPARENT.
Max 3 non-merge destructive (`TOO_MANY_DESTRUCTIVE`) and 30 merges (`TOO_MANY_MERGES`). Destructive ops need existing ids (`TEMP_NOT_ALLOWED`).

**Every path that creates a union or adds a partner** (add-person links, link-spouse, move-person, merge, restores) runs
`SAME_PERSON`, `ANCESTOR_LINK`, `DUPLICATE_UNION` and `CYCLE` checks and reports them with its op index.

### 3.4 Links of `add-person` (and target resolution of `move-person`)
* `{"as":"child","of":P,"with":Q|null}` → active union whose partner set is exactly `{P,Q}` (or `{P}`); found → insert child; else create
  `{partners:[P,(Q)], status: Q ? "married" : "unknown"}`. `{"as":"child","union":U}` → insert into U.
  Insert position: `index` if given, else before the first sibling with a later known birth date, else append.
* `{"as":"spouse","of":P,"status"?,"marriage"?}` → create `[P,new]` (status default `married`; the UI's "former spouse" sends `divorced`).
* `{"as":"parent","of":P,"scope":"union"|"only"}` (default union) → B = birth union of P.
  `union`: B has <2 partners → add new as partner (every child of B gains this parent — describeOp lists them); 2 partners → `PARENTS_FULL`;
  same non-empty gender as B's single partner → `PARENT_GENDER_CONFLICT`; no B → create `{partners:[new], children:[P]}`.
  `only`: move P alone into find-or-create union {B's single partner (if any), new}.
* `{"as":"sibling","of":P,"share":"both"|"father"|"mother","otherParent"?:Q|null}` → `both`: append to P's birth union (create
  `{partners:[], children:[P,new]}` if none); `father`: resolve as `{as:"child", of: father(P), with: otherParent ?? null}`
  (`FATHER_UNKNOWN` if P has no male parent); `mother` likewise (`MOTHER_UNKNOWN`).

### 3.5 Apply — `applyProposal(data, proposal, opts)`
```
opts = { mode: "final"|"preview", now, issue, actor, rev?, allowDestructive (preview: true, final: false),
         force: false, refMap: {ref→id} (final: temp refs of dependsOn proposals), idGen?(prefix) }
→ { ok, data, errors, warnings, idMap, touched:{people,unions}, created:{people,unions}, destructive, reparent:[…], merges:n }
```
* Never mutates input; returns normalized deep copy. **Atomic**: any error → `ok:false`, data unchanged, all errors listed (with `op`).
* `validateProposal` first (shape, types, limits, ref declaration order).
* Preview: created people get id = their ref; unions get their `unionRef` (or `tmpu<n>`). Final: random ids `p`/`u` + 7 base36
  (crypto.getRandomValues), never colliding; `idMap` maps refs → real ids.
* Pruning: only unions **created by this proposal** left with <2 members are deleted. Pre-existing unions that drop below 2 members are
  soft-removed (`auto:true`). Soft-removed people count as members.
* Final: `meta.revision += 1`, `meta.updatedAt = now`, history entries `{issue, rev, at, action}` on touched people (cap 20).
* Destructive (incl. REPARENT) and `!allowDestructive` → `DESTRUCTIVE_NOT_ALLOWED`.
* Post-condition: `validateData(result, {allowTempIds: mode==="preview"}).ok`, else `ok:false` with those errors.
* `applyProposals(data, [proposal…], opts)` helper applies several in sequence (preview overlay of sent proposals).

## 4. Core module APIs (`js/core/*.js`)
Named exports only; no DOM/fetch/Node-only imports (`globalThis.crypto`, `CompressionStream`/`DecompressionStream`, `btoa/atob`,
`TextEncoder`, `Intl` exist in Node ≥20 and browsers).

**schema.js** — constants (`SCHEMA_VERSION, GENDERS, PRIVACY, NAME_STATUSES, UNION_STATUSES, MARKS, TIE_TYPES, REASON_CODES,
DESTRUCTIVE_OPS, PERSON_EDIT_PATHS, UNION_EDIT_PATHS, LIMITS`), id/ref predicates, `emptyPerson emptyUnion normalizePerson
normalizeUnion normalizeData compactPerson compactUnion compactData validateData(data,{allowTempIds}) emptyData serializeData`
(compact, 2-space, trailing newline), `newProposalId()`.

**dates.js** — `toAsciiDigits(s)` (U+0660–0669, U+06F0–06F9 → 0–9) · `parseDate` · `isValidDate` · `isValidHijri` · `compareDates` ·
`yearOf` · `hijriToGregorian(h)` ("YYYY[-MM[-DD]]" Hijri → {date, approx}) by searching Gregorian days with
`Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn')` (no tables) · `gregorianToHijri(date)` · `formatDate(dateObj|string, lang,
{precision:"full"|"year"|"hidden", approx, hijri, calendar:"gregorian"|"hijri"})` → AR `"12 مارس 1950"`, EN `"12 Mar 1950"`, approx
`"حوالي 1950"`/`"c. 1950"`, Hijri-entered `"1370 هـ (حوالي 1950)"` / `"1370 AH (c. 1950–51)"` · `setDigits("latn"|"arab")` ·
`setMonthNames("standard"|"levantine")` (levantine: كانون الثاني…, static table) · `age(birth, end, today)` · `isMinor(person, today)` ·
`yearsLabel(person, lang)` (e.g. "1950–2010", "b. 1990"/"م 1990", "d. 2010"/"ت 2010" — never a cross). Locales are pinned:
`ar-u-ca-gregory-nu-latn|nu-arab`, `en-GB-u-ca-gregory`, Hijri via `-u-ca-islamic-umalqura`.

**translit.js** (exists) — `transliterate(ar, {kind:"given"|"surname"})`, `englishOf(field, kind)`, `isAutoEnglish(field)`,
`autoEnglish(person)`, `normalizeForTranslit`.

**names.js** — `personName(p, lang)` (given name; for `en` uses `englishOf(name)` so Arabic-only names get auto English; for `ar` falls
back to the English text) · `autoKunya(p, lang, graph)` (raw automatic kunya) · `nickOf(p, lang, graph)` (the kunya shown beside a known
name; `""` when `hideKunya`) · `displayName(p, lang, graph?)`: known → name (+ " (nickname or automatic kunya)", none when `hideKunya`);
unknown/withheld → nickname, else a polite relational label using graph: wife "زوجة X"/"Wife of X" (withheld wife: "حرم X"), daughter
"ابنة X" (withheld: "كريمة X"), son "ابن X", unknown gender "أحد أبناء X"/"Child of X", else "غير معروف"/"Unknown"; plus surname
when present · `fullName(p, lang, graph?)` (displayName + surname verbatim, never adds آل/Al-) · `lineageName(graph, id, lang,
{depth:3, style})`: style `"plain"` (default from `config.lineageStyle`) → "محمد حسن سالم عالم" / "Mohammed Hassan Salem Alam";
`"bin"` → "محمد بن حسن بن سالم عالم" / "Mohammed bin Hassan bin Salem Alam" (بنت/bint for women; kunya-only ancestor in genitive
after بن: أبو→أبي). Follows ONLY a male father (gender m); stops at unknown/withheld/absent father; surname = the first non-empty
surname along the whole paternal chain (unbounded) · `initials` · `normalizeArabic` (strip tashkeel/tatweel; أإآٱ→ا; ة→ه; ى→ي; ؤ→و;
ئ→ي; "عبد ال"≡"عبدال"; "ابو "≡"ابو") · `searchKey(s)` · `skeletonKey(s)`: shared consonant skeleton for Arabic, Latin and Arabizi
(Latin: lowercase, strip diacritics, Arabizi 2→'' 3→'' 5→kh 6→t 7→h 9→s, drop al/el tokens or glued prefix on words ≥5, drop vowels
a e i o u y w after the first letter, collapse doubles; Arabic: normalize, strip leading ال on tokens ≥4, transliterate consonants with
a static table, drop ا و ي ى and final ة/ه) so `Mohamed`, `Muhammad`, `محمد` share a key; `abdulrahman`↔`عبد الرحمن`; `alharbi`↔`الحربي`;
`3li`↔`علي` · `looksLikeFullName(s)` · `splitFullName(s)` → {given, father, family} suggestions · `setLineageStyle(style)`.

**graph.js** — `buildGraph(data, {includeRemoved:false})` → immutable `Graph`:
```
person(id) union(id) people() removedPeople() removedUnions() resolve(id) (follows mergedInto)
birthUnion(id) parents(id) father(id) mother(id)        // father/mother by gender only (null if gender "")
unionsOf(id)   // active unions where id is partner: spouseOrder first, then marriage date, then insertion
spouses(id) → [{person, union}]   childrenOfUnion(uid)   children(id) (by birth year when known, else union order then child order)
siblings(id) → {full:[], half:[{person, via:"father"|"mother"}], unspecified:[]}   // full only via one 2-partner union
ties(id) → [{type, person, direction:"to"|"from"}]   milkSiblings(id)
ancestors(id) → Map<id,depth>   descendants(id) → Map<id,depth> (blood only: unions where the focal person is partner)
isAncestor(a,b)   branches() → [{person, partner|null, label, count}]   // §4 below   generationDepth(id)
stats() → {people, living, deceased, unions, generations, branches}
search(query, {limit:30}) → [{person, score}]   // exact > normalized > skeleton; ar + en (stored OR auto English) name, nickname, surname, lineage tokens
duplicatesSuspects() → [[a,b,reason]]   recentlyAdded(n) (by history)
```
`branches()`: parentless active people with descendants, none of whose spouses in child-bearing unions has active parents; when both
partners of a union are parentless, the union is listed once, represented by the male partner (or partners[0]) and labelled "X & Y".

**ops.js** — `validateProposal(p)` · `applyProposal` · `applyProposals` · `isDestructive(p)` (static ops only; REPARENT known after apply) ·
`newProposal()` (with fresh id) · `opRefs(op)` → {declares, uses} · `proposalHash(p)` (sha-256 hex of canonical JSON with sorted keys,
excluding `createdAt`; async, `crypto.subtle`) · `skipOps(p, indexes)` → proposal without those ops and every op depending on them.

**codec.js** — `encodeProposal(p)` → `"GFT1:" + base64url(deflate-raw(UTF-8 JSON)) + "." + crc32(payload) in base36`
(`GFT0:` + base64url(JSON) when CompressionStream is missing) · `decodeProposal(text)`: accepts a code anywhere in text (regex
`/GFT[01]:[A-Za-z0-9_-]+(?:\.[0-9a-z]{1,7})?/`, whitespace/backticks inside are stripped first), raw JSON, or a fenced ```json block with
`kind:"gft-proposal"`; ignores codes on quoted lines (`> `) when `{ignoreQuoted:true}`; stops inflating at 1 MB; throws Error with
`.code ∈ NO_PROPOSAL | BAD_CODE | BAD_JSON | TRUNCATED_CODE | TOO_LARGE` · `extractProposal(body, opts)` → `{proposal, code}|null` (async).

**describe.js** — `describeOp(op, ctx, lang)` one-line plain text (no HTML/markdown), e.g. EN `Add “Ahmad” as son of Mohammed Hassan`,
AR `إضافة «أحمد» ابناً لـ محمد حسن`; ctx = `{graph, refNames}` (temp refs named from their add-person op) ·
`describeProposal(p, graph, lang)` → `{title, lines, destructive, counts:{add, edit, mark, arrange, remove}}` · Arabic is natural MSA with
gender agreement (ابناً/ابنةً، زوجاً/زوجةً، والداً/والدةً); never echo removal reasons beyond the reason-code label.

**kinship.js** — `findRelationship(graph, aId, bId)` → `{type:"self"|"blood"|"spouse"|"affinal"|"tie"|"none", up, down, path, lca,
half, via, side:"paternal"|"maternal"|null, spouseVia?, tie?}` ("what is b to a"; shortest path; cousin marriages → shortest) ·
`relationLabel(rel, graph, lang, {you:true, name})`: EN "your paternal uncle" / "Ahmad's paternal uncle"; AR "عمّك" / "عمّ أحمد".
Vocabulary — EN: father/mother, son/daughter, brother/sister (half-brother via father/mother), grandfather/grandmother (paternal/maternal),
grandson/granddaughter, great-…, uncle/aunt (paternal/maternal), great-uncle, nephew/niece, first cousin, n-th cousin k times removed,
husband/wife (late husband/wife; "former" only when showDivorce), *-in-law, "spouse of your …", "your spouse's …", milk mother/brother,
foster parent/child. AR: أب/أم، ابن/ابنة، أخ/أخت شقيق/شقيقة، أخ لأب/لأم، أخ (unspecified)، جد/جدة لأب/لأم، حفيد/حفيدة، عم/عمة/خال/خالة،
ابن/ابنة الأخ/الأخت، ابن/ابنة العم/العمة/الخال/الخالة، composed chains for distant relations ("ابن ابن عمّ والدك"، "عمّ جدّك")، زوج/زوجة،
زوجها الراحل، حمو/حماة، زوجة الأخ، زوج الأخت، "زوج/زوجة <relation>"، "<relation> زوجتك/زوجك"، أم/أخ من الرضاعة، كافل/مكفول.
Gender-unknown people use neutral forms ("قريب/Relative" fallback with a path description).

**messages.js** — `formatIssue(issue, lang)`; `ISSUE_CODES`. Every code has ar+en text; unknown → generic text with code.

## 5. Proposal transport (how a proposal reaches the owner)
The site never holds a GitHub credential. `submit.js` precomputes (on every draft/sent change) the code and every target URL, and renders
each link option as a plain `<a href>`; their click handlers do no async work (iOS/in-app browsers block windows/clipboard after awaits).
The relay send (0.) is the one asynchronous action: a `fetch`, which needs no window or clipboard.
Before any send, a mandatory notice: "Everything you send will be public on the internet and stays in GitHub's public history /
كل ما ترسله سيكون مرئياً لأي شخص على الإنترنت ويبقى في سجل GitHub العام" (checkbox acknowledgement, remembered).

0. **Primary when `config.relayUrl` is set (an https URL): "Send to {owner.name} / إرسال إلى {owner.name}"** — the e-mail relay
   (`tools/relay/Code.gs`, a Google Apps Script web app the owner deploys; §6.8). `fetch(relayUrl, {method:"POST", body:
   JSON.stringify(payload), redirect:"follow"})` with NO custom headers (a string body is `text/plain` → no CORS preflight; Apps Script
   answers through a redirect to googleusercontent.com with `Access-Control-Allow-Origin: *`), 45 s timeout. Payload
   `{code, title, submitter, note, lang, summary, proposalId, destructive, website}`: `title` = the issue title below (≤120 chars),
   `submitter` = "name — relation" ≤200, `note` ≤2000, `summary` = describe lines, Arabic list then English list, each numbered from
   "1. " (the relay starts the English block where the numbering restarts), ≤15 per language (14 + "…and n more"), ≤300 chars each;
   `website` = a visually hidden honeypot input (must stay empty). Answer `{ok:true, issue, url}` (also for a repeat: the issue already
   opened) or `{ok:false, error}` (`invalid`, `rate_limited`, `github_error`, `not_configured`, `busy`, `server_error`; network /
   timeout / http_<n> on the site's side). Sending state on the button ("Sending… / جارٍ الإرسال…"). Success → `store.markSent('relay',
   {issue})` and the thank-you panel "Sent ✓ — {owner} will review it; you'll see it in the tree once approved" with the request number
   (no "it was not sent" undo). Failure → an error notice (rate limit → "try again a little later") and the other ways opened, WhatsApp
   first; the draft stays unsent and the button can retry (the relay folds a repeat into the same issue).
1. **"Send to {owner.name} on WhatsApp"** — primary only when no relay is configured (else the first of the other ways).
   `https://wa.me/<owner.whatsapp>?text=…` (digits only). If no number is configured the
   button opens `https://wa.me/?text=…` and the label says "choose {owner.name} in WhatsApp" (never presented as automatic).
   Text: greeting; submitter name & relation; up to 10 describe lines (+ "…and {n} more"); proposal id; blank line;
   "رمز التعديلات — يُرجى عدم تغييره / Change code — do not edit"; the code alone on its own line inside ``` fences. If the text exceeds
   4,000 chars → copy to clipboard (precomputed, synchronous) and show paste instructions instead of opening wa.me.
2. **Other ways** (collapsed): **GitHub issue** (labelled "(computer) — needs a GitHub account and a computer browser": the GitHub
   mobile app opens `github.com/…/issues/new` links with the issue form emptied, keeping only the title; §6.2 answers such issues) →
   `https://github.com/<o>/<r>/issues/new?template=family-tree-proposal.yml&title=…&code=…&submitter=…&note=…` measured on the fully
   encoded URL ≤ 7,500 chars (drop note, then submitter, then shorten title to 60; then clipboard fallback); **Email** (if `owner.email`);
   **Copy code**.
3. After sending, the draft moves to the **sent queue** (§7.3). With the relay configured, each sent proposal not sent through it offers
   "Send to {owner}" (relay) besides "Send again" (WhatsApp) — the way out when a GitHub request arrived empty; success records
   `via:"relay"` and the request number (`store.updateSent`).
Issue title: `🌳 <describe title>` (prefix `⚠️ ` when destructive), ≤ 120 chars. The relay's owner side (e-mails, replies → commands)
is §6.8.

### 5.1 Owner mode — the keeper edits directly (`js/owner.js` logic, no DOM; `js/owner-ui.js` interface)
The one exception to "the site never holds a GitHub credential": the keeper's own key, on the keeper's own devices.
* **Sign-in** (`#/admin`, top card «وضع المشرف» / "Owner mode", with click-by-click key instructions): a fine-grained PAT (only this
  repository; Contents: Read and write; Issues: Read and write — the same key can serve the relay, §6.8). `verifyToken`:
  `GET /user` → login must be in `config.approvers` (case-insensitive); `GET /repos/{o}/{r}` → access, and `permissions.push`
  (or maintain/admin) when GitHub reports it; `POST /repos/{o}/{r}/git/blobs` (an unreferenced blob: invisible) proves the key
  may write contents. Refusals: `empty, format, invalid (401), notApprover, noAccess, noPush, rateLimit, network, http`, each
  with a bilingual hint. Stored in `localStorage gft.owner.v1 {v, token, login, at}` on this device only (re-checked against
  approvers on load); "Sign out" removes it. The token goes ONLY to `https://api.github.com`, in `Authorization: Bearer` (never in
  a URL), with `cache: "no-store"`; errors carry kind/status/GitHub's short message only — never the token. Header pill «المشرف»
  / "Owner" → "Saving…" / "Saved ✓" (6 s) / "Not saved" (phones: icon only); it replaces the pending pill and badges.
* **Direct edits** (`store.direct`, set by owner.js): while signed in, `store.addOps(ops)` swaps temp refs already saved
  (`store.aliases`); ops that use temp refs declared by the draft or a sent proposal cannot go to the tree alone → the normal
  draft path. Otherwise: trial-apply (preview) on data + `store.saving` → `{ok:false, errors, warnings}` (op indexes offset by the
  draft length, as for the draft) or `{ok:true, saving:true, warnings, idMap}`; the item `{id, at, proposal}` joins
  `store.saving` (persisted `gft.saving.v1`; overlaid first in `store.working`, without pending badges) and is queued. Every
  dialog, the wizard and the owner tools show the same toast (`ui.js notifyAdded`): «تم الحفظ — يظهر في الموقع خلال دقيقة» /
  "Saved — live on the site in about a minute" (else "added to your proposal"). Destructive dialogs keep their confirmations
  (reason, typed name) and then save directly — the keeper is the approver.
* **Save queue** (one save at a time; direct edits not yet started share one commit; "Save all", "Apply now" and the startup
  refresh are separate jobs): `GET git/ref/heads/<branch>` → head; `GET contents/<portalPath>data/{family,changelog,applied}.json
  ?ref=<head>` (base64 → UTF-8; the blob API when a file is over 1 MB) → `planSave`: each item in final mode (`actor` = login,
  `issue` = request number or null, `allowDestructive: true`, refMap/appliedDeps from applied.json for `dependsOn`; the keeper's
  own refs also from aliases and earlier items of the save) → family.json (serializeData) + one changelog entry per item (bot
  shape §6.6, `action: "owner-edit"`, `approvedBy` = login, `issue: null`, `idMap`, bilingual describe) [+ applied.json for
  "apply" items], committed in ONE commit with the Git Data API: blobs → tree (`base_tree`) → commit (parent = head) →
  `PATCH git/refs/heads/<branch> {force:false}`. Message (no proposal text): `family-tree: owner edit (rev N, K changes)` +
  `Gft-Owner-Edit: <proposalId>` per item (+ `Gft-Apply: #n <hash> rev N` for a request). 409/422 on the ref update → wait
  1/2/4 s, re-read, re-apply on the fresh data (≤ 4 tries). Idempotent: an edit whose proposal id the changelog already lists
  as `owner-edit` (or an apply whose hash applied.json holds) counts as saved — an interrupted save resumes after a reload.
* **After a save**: `store.finishSave` → `setData(newData, {ledgers: {changelog, applied}})` at once (before Pages rebuilds);
  temp refs → `store.aliases` (`gft.aliases.v1`, ≤ 400; `#/p/newN`, the tree, the wizard and "me" follow them); queued edits
  and the draft get the real ids. A signed-in device reads the repository on load and adopts a newer revision; `refreshData()`
  only ever adopts a newer revision.
* **Failures never lose ops**: refused on the latest data → those items join the draft + a toast with the problems
  (formatIssue); network / rate limit / conflicts exhausted / http → every unsaved direct edit joins the draft + toast "Try
  again" (= Save all); 401 → signed out on this device + a dialog (changes kept in "My proposal"; add a new key in Owner tools);
  403 → a dialog (key without Contents write, or a protected branch; "Sign out").
* **«حفظ الكل في الشجرة» / "Save all to the tree"** (`#/draft`, replaces the send card in owner mode; the draft bar reads "n
  changes not saved in the tree yet"): the whole draft as one item; a draft with `source` (correcting a relative's proposal)
  is an "apply" item for `source.issue` (request closed as below). Saved ops leave the draft.
* **«تطبيق مباشرة» / "Apply now"** (owner mode, every proposal preview: `#/preview?code=`, `#/preview/<n>`, admin paste; a
  destructive proposal asks first): changelog `action: "apply"` (submitter kept) + `applied.json {hash: {issue: n|null,
  proposalId, commit: "", idMap, at, rev}}`, so the bot treats the same proposal arriving later as already applied; with a request
  number: a bilingual note (no "/"), label `applied`, close (best effort). Hash already applied → "already in the tree"; an id
  already used under another hash → refused. A relative's temp refs never become aliases (other devices' counters).
* **Home-page settings** (keeper only; `config.json` `"home"`, §6.1): in owner mode each family tree on the home page carries a small
  low-key «إخفاء من الصفحة الرئيسية» / "Hide from the home page" button (eye-off icon), each family of the «عائلات أخرى» line a small
  eye-off icon button and each «يلتقي» caption a small «إخفاء» / "Hide"; a compact row «مخفيّ من الصفحة الرئيسية: …» lists what the keeper
  hid with «إظهار» / "Show" (captions hidden only with their family are not listed: they come back with it); `#/admin` has a «الصفحة الرئيسية» /
  "Home page" disclosure listing every tree and «يلتقي» line with show/hide toggles (§7.8). After a hide / show the keyboard focus moves
  to the counterpart button (the page re-renders). People not saved yet (temporary ids) get no hide control (an id that is not `p…`
  would hide nothing). `owner.saveHome(patch)` (`patch` =
  `{hideTrees|showTrees|hideBridges|showBridges|keepBridges|unkeepBridges: [...]}`; keep/unkeep add to / remove from `shownBridges`;
  `home-tree.js bridgeToggle` builds a caption's patch: showing one that names a hidden family keeps it, hiding a kept one unkeeps it) changes `store.config.home` at once (`store.setHome` → event `config`, the
  page re-renders), then queues ONE save job: `GET git/ref` → `GET contents/<portalPath>config.json?ref=<head>` → `planHomeConfig`
  applies the patch to the LATEST `"home"` only (other keys and their order untouched; empty lists and an empty `"home"` dropped;
  malformed ids never written) → a commit changing only `config.json`, message `family-tree: owner home settings` (no personal text);
  nothing to change → no commit; 409/422 → re-read and re-patch (≤ 4 tries). Toast «تم الحفظ — يصل التغيير إلى الجميع خلال دقيقة» / "Saved —
  the change reaches everyone in about a minute". Failures drop the patch again (the page goes back): 401 → signed out + the dialog; 403 → the
  "GitHub refused to save" dialog (both say «لم تتغيّر الصفحة الرئيسية» / "The home page was not changed" when only a home setting
  failed — nothing joined «مقترحي»); network / rate limit / http → «لم يُحفظ: …» toast; one toast at a time. A signed-in device re-reads `config.json` from the
  repository on load (`refresh`), so a reload before GitHub Pages republishes keeps the new settings. Visitors never see these controls.
* **Bot side**: `commitTrailers` maps `Gft-Owner-Edit: <id>` → `owner:<id>`, so `backfillCommits` fills the `commit` of owner
  entries; an applied.json entry without issue → "already applied directly by the keeper" (check comment, queue).

## 6. GitHub automation

### 6.1 `config.json`
```jsonc
{ "repo": {"owner":"gtsgate","name":"family-tree","branch":"main"}, "portalPath":"",
  "siteUrl":"https://gtsgate.github.io/family-tree/",
  "relayUrl":"",                       // e-mail relay Web app URL (https://script.google.com/macros/s/…/exec); "" = no relay
  "approvers":["gtsgate"],
  "owner": {"personId":"", "name":{"ar":"…","en":"…"}, "welcome":{"ar":"","en":""}, "whatsapp":"", "email":""},
  "defaultLanguage":"ar", "arabicDigits":false, "arabicMonthNames":"standard", "primaryCalendar":"gregorian",
  "lineageStyle":"plain", "showDivorce":false, "treeDefaultDepth":3,
  "privacyDefaults": {"femaleNameStatus":"known", "photos":"all"},
  "home": {"hiddenTrees": ["<head personId>"], "hiddenBridges": ["<husbandId>|<wifeId>"],
           "shownBridges": ["<husbandId>|<wifeId>"]} }   // optional; absent = nothing hidden
```
`home` is written by owner mode (§5.1). A tree is hidden when `hiddenTrees` holds its founder (head) or a man of its trunk (so adding an
older ancestor later keeps it hidden). A caption is hidden by `"<husbandId>|<wifeId>"` or the same couple the other way round (a hand
edit); «إظهار» removes either. A caption naming a hidden family is hidden with it unless `shownBridges` names it (either spelling;
`hiddenBridges` wins over it). `validate-data` warns on entries naming unknown/removed people, non-founders, non-couples or
wrong shapes (they hide nothing).
Label names are constants in `scripts/lib/labels.mjs` (not config): `family-tree, approve, approve-deletion, needs-changes, applied,
deletion-request, duplicate, undone`.

### 6.2 Check (`family-tree-check.yml`): `issues: [opened, edited, reopened]` + `workflow_dispatch {issue}`
* permissions `contents: read, issues: write`; checkout `persist-credentials: false`; Node 22; actions pinned.
* Re-fetch the issue via REST (never trust event payload state). Skip closed / `applied` issues and issues without a proposal
  (no comment, no labels) — except issues titled like the site's requests (`🌳 …`, or `⚠️ 🌳 …`): opened from the GitHub mobile app,
  they arrive with the title only. Those get ONE friendly bilingual check comment (marker `hash=none … why=missing-code`: the code did
  not arrive, probably the GitHub app, which drops the form — please send it again with the site's Send button, from "My proposal")
  and the label `needs-changes`; re-runs write nothing; if a code is added later, the same comment becomes the normal check and that
  `needs-changes` is removed. The workflow's job-level `if:` therefore also passes `startsWith(github.event.issue.title, '🌳')` /
  `contains(github.event.issue.title, '🌳')`. Ensure labels exist. Add `family-tree` (+ `deletion-request` when destructive).
* proposalHash; fingerprint `fp` = first 16 hex chars (`fingerprintOf` in ops.js; 64 bits — a 6-char/24-bit fp could be ground in
  seconds). If the hash is in `applied.json` or equals another open issue → say
  "identical to #N". Dry-run `applyProposal(mode:"final", allowDestructive:true)` with `refMap` from applied.json for `dependsOn`.
  Refs of `dependsOn` proposals already applied are shown as the real people they resolve to (describe runs on the proposal with those
  refs replaced by their ids). A proposal whose `id` is already used in `applied.json` (not undone) under a DIFFERENT hash is refused
  (❌ "this proposal's id was already used by a different proposal, applied in #N", bilingual): ids are public, and the first applied
  entry of an id is the one `dependsOn` resolves to.
* Outsider-controlled text is parsed in linear time: bodies are cut at 65,536 chars (GitHub's limit), issue-form fields are read line
  by line (sections start at lines beginning with `### `).
* ONE bot comment (found by marker `<!-- gft-bot:check … -->` AND author `github-actions[bot]`), updated in place, containing: status
  ✅/❌, bilingual errors & warnings, submitter, numbered change lines (1-based op index) in English and Arabic, preview link
  `<siteUrl>#/preview?code=<code>` (fallback `#/preview/<n>` when code > 30,000 chars), and owner instructions with the exact commands
  in code blocks: `/approve <fp>` (or `/approve-deletion <fp>`), `/approve <fp> skip 3,5`, `/reject`, close to ignore.
  Marker stores `hash=<full> rev=<revision> edits=<n>`; `edits` increments on every `edited` event where the hash changed.
* Untrusted text: never interpolate `${{ github.event.* }}` outsider-controlled values (issue title/body, comment body, label name) in
  `run:`; scripts read `$GITHUB_EVENT_PATH` / REST. Rendered comments escape markdown/HTML, insert U+2060 after `@` and `#`, are cut at
  60,000 chars ("…and N more — see preview").

### 6.3 Apply (`family-tree-apply.yml`)
Triggers: `issues: [labeled, opened]`, `issue_comment: [created]`, `schedule: "23 */6 * * *"`, `workflow_dispatch {issue?, dry_run?}`.
Job-level `if:` only passes for: labeled with `approve`/`approve-deletion`; opened with one of those labels; comments on issues (not PRs:
`github.event.issue.pull_request == null`) whose body contains `/` anywhere (`contains`, not `startsWith`: a quote-reply puts `> …` before
the command; the script reads the first non-quoted line and decides); schedule; dispatch. `concurrency: {group: family-tree-data,
cancel-in-progress: false}` is on the **job**. permissions `contents: write, issues: write, pages: write`.
* **Commands** (first non-empty line, case-insensitive, trailing punctuation stripped; quoted lines ignored; the line is cut at 200 chars
  and bodies at 65,536 before any parsing, which is linear): `/approve [fp] [skip 3,5] [force]`, `/approve-deletion [fp] …`, `/reject`,
  `/undo`; Arabic aliases `/موافق`, `/موافق-حذف`, `/رفض`, `/تراجع`. A hex word of 6–64 chars is read as the fp; one shorter than 16 is
  refused as too short (reply with the 16-char command).
  Comment author must be in `config.approvers` (case-insensitive; `author_association` is not trusted) — else a polite reply.
  An approve comment adds the matching label via API (recording fp/skip/force AND the FULL hash of the version checked at that moment in
  a hidden bot note `<!-- gft-bot:approval … hash=<64 hex> -->`), then the queue runs.
  A comment may contain a corrected proposal code (owner correction): it replaces the issue's proposal; it is dry-run and the result posted.
* **Replies & the sweep**: every bot reply to a command carries `for=<comment id>` in its marker (queue results carry `for=-`). A command
  counts as answered only when a bot comment names its id (legacy replies without any `for` answer every command before them). Every run
  first answers, per issue, the NEWEST approver command if it is unanswered (a newer run cancelled its run, or it failed): approve /
  approve-deletion / correct / reject on open proposals, and `/undo` on closed `applied` proposals updated in the last 3 days. Only
  approvers' comments are parsed (authorization first), so outsiders can neither hide a command nor slow the sweep down.
* **Queue**: every run lists open issues labelled `family-tree` + (`approve` | `approve-deletion`) without `applied`, oldest first, and for
  each re-fetches the issue and verifies via the issue events API that the actor of the most recent approve label was an approver (or the
  bot acting on an approver's comment). A cancelled/failed run therefore loses nothing; the schedule picks up stragglers.
* **Integrity**: recompute the hash from the current body (or correction). A label/bare `/approve` is accepted only if the body was never
  edited after the first check (`edits==0`) or the issue author is the approver; otherwise `/approve <fp>` with the current fp is required
  (reply with the exact command, remove label). A typed fp must be ≥ 16 hex chars and a prefix of the current hash. An approval given by
  comment is bound to the full hash in its bot note: if the current hash differs (whatever the fp says), reply asking to approve the
  current version (with its fp) and remove the label. If the hash is in `applied.json` → comment "already applied in #N", labels
  `applied` + `duplicate` (only `applied` when N is the issue itself), close.
* Destructive (incl. REPARENT) without `approve-deletion` → comment with the exact `/approve-deletion <fp>`; remove `approve`; skip.
* Apply all queued proposals in order into ONE commit: `applyProposal(mode:"final", allowDestructive, force, refMap, issue, actor, now)`.
  Failure → bilingual errors comment, label `needs-changes`, remove approve label (others in the batch still apply).
  `DEPENDS_ON_PENDING` → "approve #N first". Building the batch (also after every fetch + reset of the push loop) re-reads `applied.json`
  and skips every item whose hash is already there (e.g. our own push that landed although it was reported as failed → reported as
  applied with that commit) or that an earlier item of the same batch applies (→ "already applied in #N", `applied` + `duplicate`,
  close; "retry" instead if that batch was not pushed). An item whose proposal id an applied (or earlier-in-batch) proposal uses under
  another hash is refused (as in §6.2).
* Write `family.json` (serializeData), prepend changelog entries, add `applied.json` entries `{hash: {issue, proposalId, commit,
  idMap, at}}`; commit message built in Node via `git commit -F` from issue numbers, counts and (validated) proposal ids ONLY — never
  proposal text (a name "Closes #1" would close issue #1): title `family-tree: apply #12, #13` (≤72 chars), one line per issue
  `#12 (rev 6): proposal <id>, 3 changes[, 1 skipped]`, trailers `Gft-Apply: #12 <hash> rev 6`; the bilingual descriptions stay in the
  comments and the changelog. Checkout: the default branch BY NAME (its current tip; for schedule runs the name comes from
  `GET /repos/{repo}`), never `github.sha`; push loop ≤5 attempts with backoff; on non-fast-forward: `git fetch && git reset --hard
  origin/main`, reload, re-apply the batch, commit, push. Never rebase/merge JSON. After 5 failures: comment "will retry automatically",
  leave labels.
* Pages: poll `GET /pages/builds/latest` ≤90 s; `POST /pages/builds` only if it is not building the pushed SHA (continue-on-error).
* Success comment: ✅ commit link; links `<siteUrl>#/p/<id>?rev=<N>` for created/changed people; warnings (bilingual); a "tell them on
  WhatsApp" link (`https://wa.me/?text=` bilingual "your update is now on the family tree … it may take a few minutes to appear");
  then label `applied`, close (completed). Afterwards re-run the check on other open family-tree issues (≤30) so their comments are current.
* `/reject` → fixed polite bilingual thank-you/decline text (never echoes a reason), close as not planned.

### 6.4 CI (`family-tree-ci.yml`): push/PR touching `family-tree/**` → `node --test` in `family-tree/`, `node scripts/validate-data.mjs`.
### 6.5 Undo: `/undo` (approver, on a closed `applied` issue). Using the changelog entry's `commit`: load family.json at `<commit>^` and
`<commit>`; for each person/union that commit changed: if current == `<commit>` version → restore `<commit>^` version (delete if it did
not exist); if any changed since → refuse, listing them. Commit `family-tree: undo #N`, changelog entry `{action:"undo", issue:N}`, label
`undone`, revision +1. (Batch commits: restore only records listed for that issue in the changelog entry's `touched`; a record that ANY
other proposal of the same commit also touched — earlier or later in the batch — blocks the undo, since `<commit>^` predates the whole
batch: refuse, listing those records and naming the other issues.) A push that fails 5 times → "will retry automatically": that reply
does not name the `/undo`, so the sweep (§6.3) retries it.
### 6.6 Ledgers
`changelog.json`: `{"entries":[{"issue","proposalId","hash","commit","rev","at","title","summary":{"en":[],"ar":[]},"submitter",
"approvedBy","people":[ids],"touched":{"people":[],"unions":[]},"destructive","action":"apply"|"undo"|"owner-edit"}]}` newest first,
max 500. Owner-mode entries (§5.1): `issue` may be null; `owner-edit` entries also hold the edit's `idMap`.
`applied.json`: `{"<hash>": {"issue","proposalId","commit","idMap","at"}}`, never truncated (`issue: null` = applied directly by
the keeper with "Apply now"). Per `proposalId`, the FIRST applied
(not undone) entry is the one `dependsOn` resolves to; a different proposal re-using that id is refused by check and apply.
### 6.7 Backup (`family-tree-backup.yml`): weekly (`41 2 * * 5`) + dispatch: release `data-YYYY-MM-DD` with family.json, changelog.json,
applied.json attached; keep the latest 12 data releases.

### 6.8 E-mail relay (`tools/relay/Code.gs`, Google Apps Script V8, one file, no libraries)
Owner-run glue between the site, Gmail and the workflows above; it never decides anything itself. Script Properties: `GITHUB_TOKEN`
(the owner's fine-grained PAT: only this repository, Issues read & write — the owner-mode key of §5.1, which adds Contents, serves too), `REPO`, `SITE_URL`, `OWNER_EMAIL` (optional; default the
account running the script). `setup()` validates them, tests GitHub (`GET /repos/{REPO}`), installs ONE 5-minute `checkReplies`
trigger and sends a test e-mail; `stopRelay()` removes the trigger; `doGet` → `{ok:true}` health.
* **doPost** (web app, Execute as: Me, Anyone): strict validation (code `/^GFT[01]:[A-Za-z0-9_-]+(\.[0-9a-z]{1,7})?$/` after removing
  whitespace, ≤60,000, CRC checked; title ≤120, submitter ≤200, note ≤2000, summary ≤30 lines ≤300 — lengths in characters;
  proposalId `/^[a-z0-9]{4,32}$/`; lang ar|en; destructive boolean; honeypot empty). A repeat within 24 h (same proposal id or same
  code) returns the issue already opened. Global rate limit counted on issues opened: ≤10 per hour, ≤40 per day. Creates the issue
  (`POST /repos/{REPO}/issues`, `Authorization: Bearer`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`)
  with the issue-form body layout (`### <code label>` + ```` ```text ```` fence, `### <name label>`, `### <note label>`, `_No response_`
  when empty; name and note Markdown-escaped like render.mjs#esc) and label `family-tree`, so §6.2 parses it like a form issue. Then
  one plain-text e-mail to the owner (subject `🌳 [GFT #<n>] <title>`; Arabic then English: submitter, the site's change lines marked
  as described by the sender's browser, a ⚠️ paragraph and «موافق حذف» instructions when the payload says destructive, note, preview
  link `<siteUrl>#/preview/<n>`, issue link, reply instructions; untrusted text cleaned of control/bidi characters, links defused;
  last line `gft-relay:<n>`), and remembers `{n, thread, relay message ids, status: pending}`.
* **checkReplies** (every 5 min; ≤20 requests and ≤4 min per run): in each open request's own Gmail thread, new messages that are not
  the relay's (known ids, or an unquoted `gft-relay:` line), not drafts, from `OWNER_EMAIL` only, without failed DMARC/SPF/DKIM, and —
  when `OWNER_EMAIL` is the script's account — found in its Sent mail (`in:sent rfc822msgid:`; a forged From cannot be there; retried
  for 6 runs while Gmail indexes). The first non-empty, non-quoted line before any "On … wrote:" header/signature is read: digits
  unified, Arabic letters normalised; approve words (موافق، موافقة، أوافق، نعم، اعتماد، لا مانع، approve, yes, ok …), + حذف/deletion →
  approve-deletion, رفض/reject/no/لا → reject, تخطي/skip + numbers (ranges, «و»), فرض/force; a pasted bot command is accepted (its
  fingerprint ignored). Unclear lines (contradictions, negated approval, stray numbers) → the instructions again (≤5 times). The fp and
  the needed command come from the bot's check comment (author `github-actions[bot]`, marker `gft-bot:check … fp=`; `/approve-deletion`
  code block or label `deletion-request` → deletion needed); no check comment yet → retry on the next run. Plain approve (without skip)
  when deletion is needed → an explanation in the thread asking for «موافق حذف», nothing posted. Otherwise it posts
  `/approve <fp>[ skip 3,5][ force]`, `/approve-deletion <fp>…` or `/reject` as an issue comment with the owner's token (so §6.3 sees
  an approver's command; the same command is not re-posted within 30 min).
* **Outcome**: after a command, the bot's `gft-bot:result` comments newer than it are turned into plain text (markers, HTML, Markdown
  removed) and e-mailed in the same thread: `applied` → "✅ Applied" (people links, "tell them on WhatsApp" link) and done;
  `rejected` → a short confirmation, done; `duplicate`/`already-applied` → forwarded, done; `retry` → forwarded, still waiting; anything
  else (needs-changes, deletion approval, fingerprint) → forwarded, and the owner may answer again. A request closed on GitHub otherwise
  is dropped quietly (checked every 30 min while nothing is pending); a late answer is told it is closed. Finished requests are forgotten
  after 30 days, repeats after 24 h; unanswered requests are dropped after 90 days.
* **Notes for §6.2–6.3**: relay issues are authored by the owner's account and relay commands are ordinary approver comments made with
  a PAT (so they trigger the workflows, unlike `GITHUB_TOKEN`). The relay never adds approval labels and never forwards a relative's
  text as a command; the fingerprint binds the approval to the version the bot checked.

## 7. Front-end

### 7.1 Contracts (read `js/i18n.js`, `js/dom.js`, `js/store.js`, `js/app.js`, `js/ui.js`)
* View module: `export default { title(params, query) → string, render(root, params, query) → cleanup|void }`. Re-render happens on
  route change, language change and store `draft`/`sent`/`data`/`me` events — keep UI state (zoom, wizard step, open panels) in module
  variables so re-renders are seamless.
* i18n: each module `register({en:{…}, ar:{…}})` at top level; namespaced keys; `t(key, vars)`; `bi(obj)`. Arabic copy is natural MSA,
  warm, respectful and **gender-neutral when addressing the user**: buttons/headings use verbal nouns (إضافة فرد، تعديل المعلومات،
  إرسال، بحث، اختيار) never masculine imperatives (أضف، اختر، أرسل، اكتب، ابحث، اضغط، تعرّف); sentences use forms valid for both
  genders (لديك، عائلتك). A test enforces this. Never use a cross for deceased; use "رحمه الله / رحمها الله" on person pages.
* Never build HTML from user data (`innerHTML`); use `h()`/text. Logical CSS properties only; names in `<bdi>`.
* Mobile-first: works at 360px; base font 17px; Arabic line-height ≥1.7; tap targets ≥44px; text-size control (A / A+ / A++) in header;
  dark mode; `prefers-reduced-motion`; keyboard accessible; AA contrast; no console errors.
* Base CSS component classes (base.css provides; everyone uses): `.btn .btn-primary .btn-ghost .btn-danger .btn-sm .btn-lg .btn-block
  .btn-icon .card .card-header .stack .row .grid .chip .chip-link .badge .badge-pending .badge-sent .badge-verified .badge-needs-info
  .badge-deceased .avatar .avatar-sm .avatar-lg .avatar-m .avatar-f .avatar-u .field .field-label .field-hint .field-error .input .select
  .textarea .check .radio-group .segmented .notice .notice-info .notice-warning .notice-danger .muted .small .empty-state .spinner .sheet
  .tabs .list .list-item .section-title .kbd .sr-only .modal… .toast…` (see dom.js for modal/toast markup).

### 7.2 Routes
| hash | module | purpose |
|---|---|---|
| `#/` | home | owner welcome (config.owner) + "get to know me" link; search; primary actions (Explore tree, Add my family); "Who are you?" (set me); then one illustrated tree per family branch that has a crown (`home-tree.js`, titled «شجرة آل عالم» / "The Alam family tree" from `branches()[i].family`): trunk = founder + the single line of sons above him (names written on it), male line as branches, sons who have families as name tags, everyone else as a leaf with their first name («؟» when unknown); option chips (remembered, `gft.hometree.*`) add mothers / wives without children / daughters / others (unknown-gender children, daughters' husbands) as leaves in their own colour + outline/pattern; leaves never overlap; pending people dashed; tap → popover (profile, "show in the detailed tree" `#/tree/<head>?focus=<id>`); phones: family switch (visible drawn trees only) + full-screen pan/zoom viewer. A family whose male line has NO crown (every man on the trunk: no tags/leaves with men only — typically a family added for someone who married in) is not drawn as a bare trunk: under the trees one compact low-key line «عائلات أخرى: عائلة أحمد الريس، آل عيد» / "Other families: …" names each such family (its `branches()[i].family` title) as a link to `#/tree/<head>` (the test ignores the leaf options; when no shown family has a crown the line reads «العائلات: …» and nothing is drawn). Under that, up to three «يلتقي آل X وآل Y بزواج …» captions (marriages joining two families), those between two drawn families first, then a drawn and a named one, then two named ones. Families and captions listed in `config.home` (§6.1) are shown to nobody, and a caption naming a hidden family is hidden with it unless `home.shownBridges` names it; when every family is hidden the section shows nothing — except, in owner mode, the «مخفيّ من الصفحة الرئيسية» row; the keeper's hide/show controls are §5.1. No suggestions list (it lives on `#/me`), no birthdays. |
| `#/tree/:id?` `?view=chart\|list&dir=down\|up` | tree | descendants chart, ancestors (`dir=up`), outline list (default when width < 700px) |
| `#/p/:id` | person | family card (§7.5) |
| `#/search?q=` | search | results with lineage & years |
| `#/add-family?near=<pid>` | wizard | §7.7 |
| `#/draft` | draft | review & send (§5, §7.3) |
| `#/me` | me | who I am, my sent proposals & status, my close family, tasks near me |
| `#/relationship/:a?/:b?` | relationship | "How are we related?" with path visualization |
| `#/changes` | changes | changelog |
| `#/about` | about | how it works, privacy ("to hide yourself message {owner}"), deletion policy, public-data notice |
| `#/admin` | admin | §7.8 (top: owner mode sign-in, §5.1) |
| `#/preview?code=` / `#/preview/:issue` | preview | decode (or fetch issue via public REST) → dry-run → summary, errors, "Correct this proposal", "Load into my draft" |
Any route with `?rev=N` where N > loaded `meta.revision` shows "Publishing your update… / جارٍ نشر التحديث…" and re-fetches every 20 s for
≤5 min (handled by app.js). `#/p/<merged id>` redirects to its `mergedInto`.

### 7.3 Draft, sent queue, overlay
* Draft (`localStorage gft.draft.v1`): ops + submitter + note + proposal id + `dependsOn`. `store.addOps()` trial-applies; failing ops are
  refused with messages. Removing an op prunes dependants (opRefs) and anything that no longer applies (user told how many).
* On any send action the draft becomes a **sent** proposal (`gft.sent.v1`: `[{id, at, via, proposal}]`) and a new empty draft starts
  (counter continues). `store.working` = preview-apply of sent proposals not yet in the changelog, then the draft. Sent people show badge
  "sent — awaiting approval / أُرسل — بانتظار الموافقة"; draft people "not sent yet / لم يُرسل بعد". New ops that use refs from a sent
  proposal automatically add it to `dependsOn`.
* When the changelog lists a sent proposal id → drop it from the queue and toast "your changes were approved" with links. A sent proposal
  that no longer applies is hidden from the overlay and flagged on `#/me`.
* Sticky bottom bar on every route while the draft is non-empty: "You have {n} unsent changes — Send / لديك {n} تعديلات لم تُرسل — إرسال"
  (owner mode: "{n} changes not saved in the tree yet — Review & save", badges "Not saved yet").
* Owner mode (§5.1): `store.saving` (direct edits being committed) is overlaid before the sent proposals, with no badges;
  `store.addOps` returns `{ok, saving:true}` for them; `store.aliases`/`store.realId(ref)` map saved temp refs to real ids.
* Large drafts: when ops > 150 or the code > 60,000 chars, the draft page asks to send what exists first (continuing is possible thanks to
  dependsOn).

### 7.4 Forms & dialogs (`js/forms/`)
* `person-form.js`: English name/surname/nickname fields auto-fill from the Arabic (translit.js) while untouched (shown with an
  "automatic" hint); once edited they keep the user's spelling; the value is included only when it differs from the automatic one.
  Given-name field labelled "الاسم الأول فقط (مثال: محمد، عبد الله، نور الدين)" with `NAME_LOOKS_FULL` hint offering
  to split into given/father/family; Arabic `dir=rtl` and English `dir=ltr` side by side (English optional; a "suggest" transliteration
  button is NOT required); "Name not known" and "Prefer not to publish the name" options (nameStatus) — prefilled from
  `privacyDefaults.femaleNameStatus` for women; surname; nickname (placeholder "أبو خالد، أم خالد، الحاج"; the automatic kunya as
  placeholder/hint when none is recorded) with the checkbox «إخفاء الكنية» / "Don't show a kunya" + a short hint (`hideKunya`; the edit
  diff includes it only when it changed); gender as
  ابن/ابنة (son/daughter) or زوج/زوجة wording by context, required for new people; birth date = year text input
  (`inputmode=numeric`, `toAsciiDigits`) + optional month/day + approximate + calendar switch م/هـ (stores `hijri` when هـ); living/deceased +
  death date/place; birth-date privacy (living → year by default; minors cannot choose full); occupation, bio, photo hidden for minors;
  photo → "send the photo to {owner} on WhatsApp" link for members (URL field only in admin). Returns PersonInput or an edit `set` diff with `before`.
* `picker.js`: person search-as-you-type picker (uses graph.search incl. skeleton keys; shows lineage + years; keyboard accessible).
* `dialogs.js`: edit person; add child (asks ابن/ابنة; other parent = one of the spouses, "another mother/father", or unknown; kind:
  biological / raised under kafala / nursed (rada'a) → tie); add spouse (first searches existing people: "already in the tree → link";
  current/former); add parent (scope question when siblings exist); add sibling ("same father and mother / same father only / same mother
  only"); link existing; mark as…; reorder children (drag + up/down, keyboard); reorder spouses; change parents (move); merge duplicate;
  request removal (reason code select, consequences, HAS_CHILDREN/IS_ROOT blocks, type the name to confirm; "other" → WhatsApp explanation).
  Before any add, a quick duplicate check shows "Is it one of these?" matches. Each dialog ends with `store.addOps([...])` + the shared
  toast (`ui.js notifyAdded`: linking to the draft, or "Saved — live on the site in about a minute" in owner mode, whose dialogs
  also say "Save to the tree" and drop the "needs the owner's approval" notes).

### 7.5 Person page (family card)
Order: avatar, display name (other language small), lineage name, nickname, badges, "رحمه الله/رحمها الله" if deceased, relation to me;
then Parents (chips), Spouses (status per showDivorce; widow/er derived), Children grouped per spouse, Siblings (full / via father / via
mother / unspecified), Ties; then details (dates in both calendars, places, occupation, bio, needs-info). Exactly three primary buttons:
"إضافة قريب / Add a relative" (sheet with 4 big tiles child/spouse/parent/sibling), "تصحيح المعلومات / Correct info", "هذا أنا / This is me".
"خيارات أخرى / More options": mark as…, re-arrange, change parents, link existing person, merge duplicate, share on WhatsApp, invite a
relative (`siteUrl#/add-family?near=<id>`), view in tree, how are we related; and last, set apart in red, "request removal".

### 7.6 Tree view
* Descendants chart: node = person card + spouse cards; each union's children hang below that union. Tidy layout (subtree widths), SVG
  connectors under absolutely positioned HTML cards, pan (pointer/touch), zoom (wheel, pinch, buttons), fit, center. Collapsible; default
  depth `config.treeDefaultDepth`; expand-all with a safety cap (e.g. 600 nodes). RTL mirrors (first child on the right). Blood-only: a
  spouse's other unions appear as "also married to Y (n children)" links. A person reachable twice (cousin marriage) is drawn once; the
  other occurrence is a compact linked card.
* Ancestors chart (`dir=up`). Outline list (`view=list`): nested, expandable, virtual-friendly (thousands of people), default on phones.
* Toggle "paternal line only / الخط الأبوي فقط" (children of female descendants collapsed, expandable).
* Card: avatar (photo per privacyDefaults.photos, never for minors; else initials with subtle gender tint), display name, years label,
  badges (draft/sent pending, needs-info, verified). Tap → popover: open profile, focus tree here, add child/spouse.

### 7.7 Wizard `#/add-family` (the growth flow; state in module variables; each committed row → `store.addOps` immediately)
Step 0 "من أنت؟ / Who are you?": (a) "I'm in the tree" → search (scoped near `?near=`) → set me; (b) "I'm not listed" → find father or
mother → add self as son/daughter; (c) "I married into the family" → find spouse → add self as spouse. Step 1 spouses: confirm/add,
"+ another spouse". Step 2 children per union: inline repeatable rows [name · ابن/ابنة toggle · birth year with م/هـ · living/deceased]
with "+ another child" on ONE screen (no modal per child). Step 3 (optional per child row "add their family"): spouse & children (recursive).
Step 4 (path c only, optional): your parents and siblings, with the public-data notice. Step 5: review describe lines → send (§5).
Every step: Skip, and "Tell {owner} on WhatsApp instead (voice notes welcome)" → wa.me with "بخصوص: <lineageName> <siteUrl>#/p/<id>".
Owner mode (§5.1): each committed row (rows committed together → one commit) is saved straight into the tree; the wizard's state
and typed rows follow the new real ids (`store.realId`); step 5 becomes «تم» / "Done" (anything not saved is listed with
"Review & save").
Acceptance: self + spouse + 5 children in ≤3 screens and ≤25 taps at 360px. Duplicate check on each row.

### 7.8 Admin `#/admin` (tools; real power is GitHub permissions)
**Owner mode card** first (§5.1): signed out → what it does, the key field (password, `autocomplete=off`), "Sign in", the
click-by-click key steps (Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token;
name "family-tree keeper", 1 year, only this repository, Contents + Issues: Read and write; the same key serves the relay) and
a link to the owner guide; signed in → "Signed in as {login} on this device" + "Sign out". With owner mode on, every preview
offers "Apply now" and restores/photo paths save directly, and a **«الصفحة الرئيسية» / "Home page" disclosure** follows the owner card,
closed by default with a one-line status («المخفيّ: n» / "Hidden: n", or «كلّ الأشجار والسطور ظاهرة» / "Every family tree and line is
shown"); opened (it stays open across the re-render after a toggle), it lists every family tree (with its counts; a family without a crown notes that it is named under the trees) and every «يلتقي»
line, each with a checkbox «تظهر/يظهر في الصفحة الرئيسية» / "Shown on the home page" (saved as in §5.1); a line hidden with its family
says so, and ticking it shows it anyway (`shownBridges`). The status counts what the keeper hid.
Paste code(s) → preview → **"Create issue and approve"** (issue-form URL with `&labels=family-tree,approve` or `approve-deletion` — GitHub
honours labels only for users with triage rights; noted "needs a computer browser", as the GitHub app empties the form). With
`config.relayUrl` set, the primary action is **"Send for approval by e-mail"** instead (same payload as the draft send, §5.0; "Sent ✓ —
you'll get the e-mail to approve it", or "already sent as request #n"), and the GitHub link becomes the secondary "Or create it on GitHub
(computer browser only)"; the same holds for the draft page's correction of a pasted code · "Correct this proposal" → loads into draft with `source:{issue, hash}`; the draft page
then offers "Copy approval comment" (`/approve` + new code) · open proposals list (public REST, handles rate-limit errors) · removed people
& unions with restore buttons · data health (validateData warnings, duplicatesSuspects) · after approval: "copy thank-you message" (bilingual,
links) and "weekly family news" generator from the changelog · photo tool: pick image → canvas resize 400px JPEG → download `<pid>.jpg` → open
`https://github.com/<o>/<r>/upload/<branch>/family-tree/data/photos` · download family.json.

### 7.9 Personalization
`store.me` (localStorage; rewritten through mergedInto on load). Person pages show "He is your paternal uncle / هو عمّك"; home greets.

## 8. Testing
* `family-tree/tests/*.test.mjs` with `node:test` + `node:assert/strict`; `cd family-tree && node --test`.
* Core: every op + error code, atomicity, preview vs final ids (preview drafts with add-person pass validateData with allowTempIds; a later
  reorder on a `newuK` union resolves), pruning vs soft-removal, merge (incl. union collapse, redirect), restore conflicts, sibling share,
  parent scope, privacy truncation, hijri derivation, STALE_EDIT final vs preview, dependsOn/refMap, codec round-trip with Arabic, CRC
  truncation detection, 1 MB inflate cap, describe both languages, kinship both languages (polygamy half-siblings, cousins, in-laws,
  milk ties), names (lineage plain/bin, withheld labels, normalization, skeleton search: Mohamed→محمد, Muhammad, abdulrahman→عبد الرحمن,
  alharbi→الحربي, 3li→علي), dates (partial, hijri, digits), branches, the real data file validates.
* i18n: every registered key exists in both languages; no Arabic string starts with a masculine imperative (§7.1).
* Scripts: check & apply on fixture events with a fake GitHub client: label/comment/unauthorized/destructive/fp mismatch/edited body/
  duplicate hash/skip/force/dependsOn/undo/reject/push conflict retry.
* Relay (`tests/relay.test.mjs`): Code.gs in `node:vm` with fakes for UrlFetchApp (backed by the scripts' fake GitHub, with the real
  check and apply answering), GmailApp, PropertiesService, CacheService, LockService, ContentService, ScriptApp, Session, Utilities:
  issue-form layout parsed by check.mjs, honeypot, invalid payloads, rate limits, repeats, replies → commands, destructive gating,
  quoted text, foreign/forged senders, waiting for the check comment, forwarded problems, "✅ Applied", setup.
* Owner mode (`tests/owner.test.mjs`, GitHub faked by `tests/fake-github-api.mjs` and injected as fetch): sign-in checks (non-approver,
  no push, no contents write, bad/malformed token, the token only in the Authorization header to api.github.com), a direct edit =
  ONE commit (family.json + changelog.json, parent = head, message without names), several ops → one commit and a dependent edit
  waiting for real ids, conflict → re-applied on fresh data, 401 → signed out with ops in the draft, network → draft then "Save
  all", refused on fresh data → draft + problems, resume after a reload without applying twice, removal applies directly,
  "Apply now" (applied.json entry, already applied, request closed with Gft-Apply trailer, refused proposals), home-page settings
  (one commit changing only config.json, other keys kept, show again drops "home", conflict → re-patched on top, 401 → signed out and
  the page goes back, 403 / network, a signed-in device adopts the repository's settings). `tests/hide-kunya.test.mjs`: hideKunya
  in the schema, edit-person (STALE_EDIT), merge, display (incl. the relational-label fallback), describe lines, search. Bot side
  (`tests/scripts-apply.test.mjs`): owner trailers backfill commits; a directly applied proposal arriving as a request.
* E2E (local): `tests/e2e/smoke.mjs` — serve folder, visit every route in both languages at 360px and 1280px, add a family through the
  wizard, check the draft, the WhatsApp/GitHub URLs, the relay send (a routed fake relayUrl: failure → other ways, success → sent with
  the request number), owner mode (api.github.com routed to the fake: sign in, a child added from the person dialog is committed at
  once and shown without a proposal, "Apply now", sign out → proposals again; hiding «شجرة آل محمود» and a «يلتقي» line commits
  config.json only, the lines naming آل محمود go with it, and a visitor loading that config does not see them; a family of the «عائلات
  أخرى» line hidden and shown again; the #/admin "Home page" card; «إخفاء الكنية» from the edit form
  removes the kunya from the person's page and card), and that there are no console errors.
