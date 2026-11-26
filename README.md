# شجرة العائلة الكبرى · The Grand Family Tree

<div dir="rtl">

موقع ثنائي اللغة (العربية والإنجليزية) لشجرة العائلة: يتصفحه الجميع دون تسجيل دخول، ويقترح الأقارب الإضافات والتصحيحات (أفراد، أزواج، أبناء، فروع كاملة)، ثم يوافق عليها المشرف قبل ظهورها. تصل المقترحات إلى المشرف بالبريد الإلكتروني (فيكفي الرد بكلمة «موافق») أو عبر واتساب، ويطبّقها روبوت في GitHub بعد الموافقة، مع إمكانية التراجع عن أي موافقة. أما المشرف فيعدّل الشجرة مباشرةً من الموقع في **وضع المشرف** (تسجيل دخول مرة واحدة لكل جهاز بمفتاح GitHub)، دون مقترحات.

- **الموقع:** https://gtsgate.github.io/family-tree/
- **دليل المشرف** (الإعداد، الموافقة من الجوال، الأوامر، التراجع، الخصوصية، النسخ الاحتياطية): [docs/OWNER-GUIDE.md](docs/OWNER-GUIDE.md)
- **المواصفات التقنية:** [docs/SPEC.md](docs/SPEC.md)

</div>

A bilingual (Arabic / English) family-tree portal: anyone can browse it without logging in; relatives propose additions and corrections (people, spouses, children, whole branches), and nothing changes until an approver says so. Proposals reach the keeper by e-mail (replying “approve” is enough) or on WhatsApp; a GitHub Action validates and applies approved ones, and any approval can be undone. The keeper edits the tree directly from the site in **owner mode** (a one-time sign-in per device with a GitHub key) — no proposals.

- **Site:** https://gtsgate.github.io/family-tree/
- **Owner guide** (setup, approving from a phone, commands, undo, privacy, backups): [docs/OWNER-GUIDE.md](docs/OWNER-GUIDE.md)
- **Technical specification:** [docs/SPEC.md](docs/SPEC.md)

## How it fits together

| Part | Where |
|---|---|
| Site (plain HTML/CSS/ES modules, no build step, no dependencies) | `index.html`, `css/`, `js/` |
| Pure logic shared by the site and the automation | `js/core/` |
| Owner mode: direct edits committed through the GitHub API (keeper's key on the keeper's devices) | `js/owner.js`, `js/owner-ui.js` |
| Data: people and families, changelog, ledger of applied proposals | `data/family.json`, `data/changelog.json`, `data/applied.json` |
| Automation scripts (check, apply, validate, backup) | `scripts/` |
| Workflows and the proposal issue form | `../.github/workflows/family-tree-*.yml`, `../.github/ISSUE_TEMPLATE/family-tree-proposal.yml` |
| E-mail relay (Google Apps Script the owner deploys: site → issue → e-mail; e-mail reply → `/approve`) | `tools/relay/Code.gs` |
| Tests (`node:test`) | `tests/` |

## Working on it

```sh
cd family-tree
python3 -m http.server 8080        # then open http://localhost:8080/
node --test                        # all tests (Node ≥ 20; CI uses 22)
node tests/e2e/smoke.mjs           # local browser smoke test (needs Playwright + Chromium; serves itself on :8199)
node scripts/validate-data.mjs     # check data/family.json and the ledgers
node scripts/apply-proposal.mjs --dry-run --event scripts/fixtures/approve-comment.json   # try the bot offline
```
