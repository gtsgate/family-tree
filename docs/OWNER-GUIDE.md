# دليل المشرف · Owner guide

<div dir="rtl">

## وضع المشرف — التعديل المباشر (تسجيل دخول مرة واحدة لكل جهاز)

في وضع المشرف لا مقترحات ولا خطوة موافقة: كل إضافة أو تصحيح يقوم به المشرف من الموقع يُحفظ في الشجرة فوراً، ويظهر للجميع خلال دقيقة تقريباً. يكفي تسجيل الدخول مرة واحدة على كل جهاز (الجوال، الحاسوب) بمفتاح من GitHub.

**(أ) إنشاء المفتاح في GitHub (مرة واحدة، نحو دقيقتين)**

1. فتح github.com بحساب `gtsgate`، ثم الصورة الشخصية (أعلى الصفحة) ← **Settings**.
2. في آخر القائمة الجانبية: **Developer settings** ← **Personal access tokens** ← **Fine-grained tokens** ← **Generate new token**.
3. **Token name:** ‏`family-tree keeper`. **Expiration:** ‏*1 year* (أو *Custom* وتاريخ بعد سنة)، مع تذكير في التقويم قبل انتهائه بأسبوع.
4. **Repository access:** ‏*Only select repositories* ثم اختيار **family-tree**.
5. **Permissions** ← **Repository permissions**:
   - **Contents** ← *Read and write*
   - **Issues** ← *Read and write*

   (تُضاف صلاحية Metadata للقراءة تلقائياً.) لا شيء غير ذلك.
6. **Generate token** ثم نسخ المفتاح (يبدأ بـ `github_pat_`). لا يظهر إلا مرة واحدة.

**(ب) تسجيل الدخول في الموقع (مرة لكل جهاز)**

1. فتح الموقع ← في أسفل أي صفحة: **أدوات المشرف** (أو `https://gtsgate.github.io/family-tree/#/admin`).
2. في البطاقة الأولى **وضع المشرف**: لصق المفتاح في الحقل ← **تسجيل الدخول**.
3. يتحقق الموقع مع GitHub من أن الحساب من المشرفين (`approvers` في `config.json`) وأن المفتاح يستطيع الحفظ، ثم تظهر عبارة «تمّ تسجيل الدخول باسم gtsgate على هذا الجهاز»، وفي أعلى كل صفحة شارة **المشرف** 🔑.

**الاستخدام اليومي**

- كل إضافة أو تصحيح (إضافة قريب، تصحيح المعلومات، وضع علامة، إعادة الترتيب، تغيير الوالدين، الدمج، معالج «إضافة عائلتي») يُحفظ في الشجرة مباشرة: تظهر رسالة **«تم الحفظ — يظهر في الموقع خلال دقيقة»**، وتصبح الشارة «جارٍ الحفظ…» ثم «تم الحفظ ✓». ويظهر التعديل على الجهاز نفسه فوراً.
- في معالج «إضافة عائلتي» تُحفظ كل مجموعة صفوف عند الانتقال إلى الخطوة التالية، وتصبح الخطوة الأخيرة **«تم»** بدل الإرسال.
- الحذف والدمج وتغيير الوالدين: تبقى أسئلة التأكيد كما هي (السبب وكتابة الاسم)، ثم يُحفظ التعديل مباشرة، فالمشرف هو صاحب الموافقة. ويمكن استعادة المحذوف من **أدوات المشرف ← الاستعادة**.
- **مقترحات الأقارب:** في معاينة أي مقترح (رابط المعاينة في رسالة البريد أو في تعليق الروبوت، أو لصق الرمز في أدوات المشرف ← «معاينة») يظهر زر **«تطبيق مباشرة»**: يطبّق المقترح فوراً، ويسجّله في `applied.json` حتى لا يُطبَّق مرة ثانية إن وصل من طريق آخر، وإن كان طلباً في GitHub يُغلَق مع ملاحظة شكر. (الموافقة بالرد على البريد تعمل كما كانت.)
- كل حفظ يظهر في **«آخر التحديثات»**، ويُسجَّل في GitHub بإيداع (commit) عنوانه `family-tree: owner edit (rev N, K changes)`.
- **إذا تعذّر الحفظ** (انقطاع الاتصال مثلاً) لا يضيع شيء: يبقى التعديل على الجهاز في **«مقترحي»**، وفيها زر **«حفظ الكل في الشجرة»**.
- **تسجيل الخروج:** أدوات المشرف ← وضع المشرف ← **تسجيل الخروج** (يُمحى المفتاح من هذا الجهاز فقط). بعدها يعمل الموقع بالمقترحات كما يراه الأقارب.

**مفتاح واحد للأمرين:** هذا المفتاح يصلح أيضاً لوسيط البريد (القسم التالي): يكفي وضعه في خاصية `GITHUB_TOKEN` في إعدادات السكربت (الخطوة (ب) 4 هناك)، فيُجدَّد مفتاح واحد فقط كل سنة.

**عند انتهاء المفتاح أو تجديده:** تظهر في الموقع رسالة «توقّف وضع المشرف»، ويبقى ما لم يُحفظ في «مقترحي». يُنشأ مفتاح جديد (أو **Regenerate token**) ويُلصق في أدوات المشرف على كل جهاز، وفي `GITHUB_TOKEN` إن كان الوسيط يستخدمه.

**الأمان:** يُحفظ المفتاح في متصفح هذا الجهاز فقط (لا في الموقع ولا في GitHub)، ولا يُرسل إلا إلى GitHub. يُستحسن استخدام وضع المشرف على الجوال أو الحاسوب الشخصي، وتسجيل الخروج من أي جهاز مشترك. وإذا فُقد الجهاز: GitHub ← Settings ← Developer settings ← Fine-grained tokens ← المفتاح ← **Delete**، فيتوقف فوراً.

**حلّ المشكلات:** «لا يملك هذا المفتاح صلاحية الحفظ» ← صلاحية Contents ليست *Read and write*. «لا يصل هذا المفتاح إلى المستودع» ← لم يُختر family-tree في Repository access. «رفض GitHub الحفظ» بعد أن كان يعمل ← ربما فُعّلت حماية للفرع `main` تشترط طلبات الدمج (Settings ← Branches)، أو تغيّرت صلاحيات المفتاح.

</div>

## Owner mode — edit directly (one-time sign-in per device)

In owner mode there are no proposals and no approval step: every addition or correction the keeper makes on the site is saved into the tree at once and appears for everyone within about a minute. Each device (phone, computer) needs a one-time sign-in with a GitHub key.

**(a) Create the key on GitHub (once — about two minutes)**

1. Open github.com signed in as `gtsgate` → profile picture (top right) → **Settings**.
2. At the bottom of the left menu: **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
3. **Token name:** `family-tree keeper`. **Expiration:** *1 year* (or *Custom*, a date one year from today) — and a calendar reminder a week before it expires.
4. **Repository access:** *Only select repositories* → **family-tree**.
5. **Permissions** → **Repository permissions**:
   - **Contents** → *Read and write*
   - **Issues** → *Read and write*

   (*Metadata: Read-only* is added by itself.) Nothing else.
6. **Generate token**, then copy it (it starts with `github_pat_`). It is shown only once.

**(b) Sign in on the site (once per device)**

1. Open the site → at the bottom of any page: **Owner tools** (or `https://gtsgate.github.io/family-tree/#/admin`).
2. In the first card, **Owner mode**: paste the key → **Sign in**.
3. The site checks with GitHub that the account is an approver (`approvers` in `config.json`) and that the key can save, then shows “Signed in as gtsgate on this device”; an **Owner** 🔑 badge appears at the top of every page.

**Everyday use**

- Every addition or correction (add a relative, correct info, mark as…, re-arrange, change parents, merge, the “Add my family” wizard) is saved straight into the tree: a **“Saved — live on the site in about a minute”** message appears and the badge shows “Saving…”, then “Saved ✓”. The change shows on the same device at once.
- In the “Add my family” wizard each group of rows is saved when moving on, and the last step is **“Done”** instead of sending.
- Removals, merges and parent changes keep their confirmations (reason, typed name), then save directly — the keeper is the approver. Removed records can be restored from **Owner tools → Restore**.
- **Relatives’ proposals:** every proposal preview (the preview link in the e-mail or the bot comment, or a code pasted in Owner tools → *Preview*) offers **“Apply now”**: the proposal is applied at once and recorded in `applied.json`, so it is never applied twice if it also arrives another way; a GitHub request is closed with a thank-you note. (Approving by replying to the e-mail still works.)
- Every save is listed on **Updates** and recorded on GitHub as a commit `family-tree: owner edit (rev N, K changes)`.
- **If a save fails** (no connection, for example) nothing is lost: the change stays on the device in **“My proposal”**, which offers **“Save all to the tree”**.
- **Sign out:** Owner tools → Owner mode → **Sign out** (forgets the key on this device only). The site then works with proposals, as relatives see it.

**One key for both:** the same key also serves the e-mail relay (next section): put it in the relay’s `GITHUB_TOKEN` script property (step (b) 4 there), so only one key needs renewing each year.

**When the key expires or is renewed:** the site says “Owner mode was turned off” and keeps anything unsaved in “My proposal”. Create a new key (or **Regenerate token**) and paste it in Owner tools on each device — and in `GITHUB_TOKEN` if the relay uses it.

**Security:** the key is kept in this device’s browser only (not on the site, not on GitHub) and is sent to GitHub alone. Use owner mode on a personal phone or computer and sign out of any shared device. If a device is lost: GitHub → Settings → Developer settings → Fine-grained tokens → the key → **Delete** — it stops working at once.

**Troubleshooting:** “This key cannot save to the repository” → *Contents* is not *Read and write*. “This key cannot see the repository” → family-tree was not chosen under *Repository access*. “GitHub refused to save” after it used to work → `main` may have gained a branch protection rule requiring pull requests (Settings → Branches), or the key’s permissions changed.

---

<div dir="rtl">

## الموافقة بالبريد الإلكتروني — إعداد لمرة واحدة (10 دقائق)

بعد هذا الإعداد يضغط القريب في الموقع زرّاً واحداً: **«إرسال إلى» + اسم المشرف**. فتصل إلى بريد Gmail رسالة لكل مقترح، ويكفي الرد عليها بكلمة واحدة مثل «موافق». لا نسخ للرموز، ولا حاجة إلى فتح GitHub.

**(أ) مفتاح GitHub للوسيط (Fine-grained token)**

1. فتح github.com بحساب `gtsgate`، ثم الصورة الشخصية (أعلى الصفحة) ← **Settings**.
2. في آخر القائمة الجانبية: **Developer settings** ← **Personal access tokens** ← **Fine-grained tokens** ← **Generate new token**.
3. **Token name:** ‏`family-tree email relay`. **Expiration:** ‏*Custom* ثم تاريخ بعد سنة من اليوم، مع وضع تذكير في التقويم قبله بأسبوع (انظر «تغيير المفتاح أو تجديده» أدناه).
4. **Repository access:** ‏*Only select repositories* ثم اختيار **family-tree**.
5. **Permissions** ← **Repository permissions** ← **Issues** ← ‏*Read and write*. (تُضاف صلاحية Metadata للقراءة تلقائياً.) لا شيء غير ذلك.
6. **Generate token** ثم نسخ المفتاح (يبدأ بـ `github_pat_`). لا يظهر إلا مرة واحدة، لذا تبقى الصفحة مفتوحة حتى الخطوة (ب) 4.

**(ب) الوسيط في Google Apps Script** (بحساب Google الذي يُراد وصول المقترحات إلى بريده)

1. فتح https://script.google.com ← **New project**.
2. الضغط على «Untitled project» أعلى الصفحة، وتسمية المشروع `Family tree relay`.
3. فتح https://raw.githubusercontent.com/gtsgate/family-tree/main/tools/relay/Code.gs ونسخ كل ما فيه، ثم وضعه مكان كل محتوى الملف `Code.gs` في المحرر، ثم الحفظ (💾 أو Ctrl+S).
4. **Project Settings** (رمز الترس ⚙️ في القائمة الجانبية) ← **Script properties** ← **Add script property** ثلاث مرات:

   | Property | Value |
   |---|---|
   | `GITHUB_TOKEN` | المفتاح المنسوخ في (أ) 6 |
   | `REPO` | `gtsgate/family-tree` |
   | `SITE_URL` | `https://gtsgate.github.io/family-tree/` |

   ثم **Save script properties**. (اختياري: `OWNER_EMAIL` إذا كان المطلوب وصول المقترحات إلى عنوان آخر؛ ولا تُقبل الردود إلا من هذا العنوان.)
5. العودة إلى **Editor** (الرمز `< >` في القائمة الجانبية)، واختيار الدالة **setup** من القائمة أعلى المحرر ← **Run**.
6. تطلب Google الإذن: **Review permissions** ← اختيار الحساب ← تظهر صفحة «Google hasn’t verified this app»، وهذا طبيعي لأن البرنامج خاص بالمشرف نفسه ← **Advanced** ← **Go to Family tree relay (unsafe)** ← **Allow**. يتحقق setup من الإعدادات ومن الوصول إلى GitHub، ويشغّل الفحص التلقائي كل 5 دقائق، ويرسل رسالة تجريبية بعنوان «relay is ready». وإن ظهر خطأ فهو يذكر ما يلزم إصلاحه (المفتاح مثلاً).
7. **Deploy** (أعلى الصفحة) ← **New deployment** ← رمز الترس بجانب «Select type» ← **Web app** ← في Description ‏`relay`، و**Execute as:** ‏*Me*، و**Who has access:** ‏*Anyone* ← **Deploy** (مع السماح مرة أخرى إن طُلب) ← نسخ **Web app URL** (ينتهي بـ `/exec`).

**(ج) ربط الموقع**

- إرسال هذا الرابط إلى Claude، **أو** تعديل `config.json` في GitHub: فتح الملف ← ✏️ ← كتابة الرابط في `"relayUrl": "https://script.google.com/macros/s/…/exec"` ← **Commit changes**.
- بعد دقائق يصبح الزر الرئيسي في صفحة «مقترحي» هو «إرسال إلى» + اسم المشرف، ويبقى واتساب وGitHub ونسخ الرمز تحت «طرق أخرى للإرسال» (وتُفتح تلقائياً إذا تعذّر الإرسال).

**كل يوم**

- يصل كل مقترح برسالة عنوانها مثل «🌳 [GFT #12] …»، فيها المرسِل وصلة قرابته، والتعديلات مرقّمة، ورابط المعاينة على الموقع ورابط الطلب في GitHub.
- يكفي الرد على الرسالة بكلمة في **أول سطر**:
  - **«موافق»** لتطبيق التعديلات؛
  - **«موافق حذف»** إذا تضمّن المقترح حذفاً أو دمجاً أو تغييراً للوالدين (تذكر الرسالة ذلك بعلامة ⚠️، ولا تكفي «موافق» وحدها عندئذ)؛
  - **«رفض»** للاعتذار عن المقترح بلطف؛
  - **«موافق تخطي 3 5»** لتطبيق الباقي دون التعديلين 3 و5.
- خلال 5 دقائق تقريباً ينشر الوسيط الأمر في GitHub باسم المشرف، فيطبّقه الروبوت، ثم تصل رسالة «✅ طُبّقت التعديلات» في المحادثة نفسها، مع روابط الأشخاص ورابط «إبلاغ صاحب المقترح عبر واتساب». وإن وجد الروبوت مشكلة (يحتاج إلى تصحيح، أو تلزمه موافقة الحذف، أو سبق تطبيقه) تصل رسالته في المحادثة نفسها، ويكفي الرد من جديد.
- كل ما في GitHub يبقى كما هو: الأوامر في التعليقات، والتراجع `/undo`، وصفحة «الإدارة».
- **رمز وصل عبر واتساب:** في صفحة «الإدارة» في الموقع يُلصق الرمز ← «معاينة» ← **«إرسال للموافقة بالبريد»**، فتصل رسالة المقترح ويكفي الرد عليها بـ«موافق». (رابط «إنشاء الطلب على GitHub» يعمل من متصفح الحاسوب فقط، لأن تطبيق GitHub على الجوال يفتح النموذج فارغاً.)
- **طلب وصل فارغاً** (عنوانه «🌳 …» ولا رمز فيه، فُتح من تطبيق GitHub): يكتب الروبوت فيه تعليقاً لطيفاً يطلب إعادة الإرسال من الموقع، ويضيف التصنيف `needs-changes`. يمكن إغلاقه بعد وصول المقترح من جديد.

**تغيير المفتاح أو تجديده**

1. GitHub ← Settings ← Developer settings ← Personal access tokens ← Fine-grained tokens ← اختيار المفتاح ← **Regenerate token** (مع مدة جديدة) ← نسخه. (أو إنشاء مفتاح جديد كما في (أ).)
2. script.google.com ← المشروع ← **Project Settings** ← **Script properties** ← `GITHUB_TOKEN` ← **Edit script properties** ← لصق المفتاح الجديد ← **Save script properties**. لا يتغيّر شيء آخر: الرابط نفسه والفحص نفسه.

إذا انتهت صلاحية المفتاح يتوقف الوسيط: يرى الأقارب رسالة «تعذّر الإرسال» مع الطرق الأخرى، ولا تُنفَّذ الردود. لذلك يُجدَّد قبل انتهائه.

**إيقاف الوسيط**

- الأسرع: في `config.json` جعل `"relayUrl": ""`، فيعود زر واتساب رئيسياً في الموقع.
- وفي Apps Script: اختيار الدالة **stopRelay** ← **Run** (تتوقف قراءة الردود)، ثم **Deploy** ← **Manage deployments** ← **Archive** (يتوقف الرابط).
- حذف المفتاح من GitHub (Fine-grained tokens ← المفتاح ← Delete) إن لم تعد له حاجة.

**الأمان باختصار:** يبقى المفتاح داخل إعدادات المشروع فقط. الوسيط لا يفعل إلا أمرين: فتح طلب لكل مقترح يصله من الموقع، ونشر الأمر المستخلص من رد المشرف نفسه، ولا يقبل الردود إلا من عنوان المشرف وفي محادثة الطلب نفسه. والروبوت في GitHub يتحقق من كل شيء كما في السابق.

</div>

## Email approvals — one-time setup (10 minutes)

After this setup a relative taps one button on the site — **“Send to” + the keeper’s name** — and a Gmail message arrives for each proposal. Replying with one word such as “approve” is enough: nobody copies codes and nobody has to open GitHub.

**(a) A GitHub key for the relay (fine-grained token)**

1. On github.com, signed in as `gtsgate`: profile picture (top right) → **Settings**.
2. At the bottom of the left menu: **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
3. **Token name:** `family-tree email relay`. **Expiration:** *Custom* → a date one year from today. Put a reminder in your calendar a week before it (see “Changing or renewing the token” below).
4. **Repository access:** *Only select repositories* → choose **family-tree**.
5. **Permissions** → **Repository permissions** → **Issues** → *Read and write*. (Metadata: Read-only is added automatically.) Nothing else.
6. **Generate token** → copy the token (it starts with `github_pat_`). It is shown only once, so keep the page open until step (b) 4.

**(b) The relay in Google Apps Script** (signed in to the Google account whose Gmail should receive the proposals)

1. Open https://script.google.com → **New project**.
2. Click “Untitled project” at the top and name it `Family tree relay`.
3. Open https://raw.githubusercontent.com/gtsgate/family-tree/main/tools/relay/Code.gs, select everything and copy it; in the editor, replace the whole content of `Code.gs` with it; **Save** (💾 or Ctrl+S).
4. **Project Settings** (⚙️ gear in the left bar) → **Script properties** → **Add script property**, three times:

   | Property | Value |
   |---|---|
   | `GITHUB_TOKEN` | the token copied in (a) 6 |
   | `REPO` | `gtsgate/family-tree` |
   | `SITE_URL` | `https://gtsgate.github.io/family-tree/` |

   → **Save script properties**. (Optional: `OWNER_EMAIL` if proposals should go to another address; replies are accepted only from that address.)
5. Back in the **Editor** (`< >` in the left bar), choose **setup** in the function menu at the top → **Run**.
6. Google asks for permission: **Review permissions** → choose your account → the screen “Google hasn’t verified this app” appears — that is normal, it is your own script → **Advanced** → **Go to Family tree relay (unsafe)** → **Allow**. `setup` checks the settings and the GitHub access, starts the automatic check every 5 minutes and sends you a test email “relay is ready”. If it shows an error instead, the message says what to fix (e.g. the token).
7. **Deploy** (top right) → **New deployment** → the gear next to “Select type” → **Web app** → Description `relay`; **Execute as:** *Me*; **Who has access:** *Anyone* → **Deploy** (allow again if asked) → copy the **Web app URL** (it ends with `/exec`).

**(c) Connect the site**

- Send that URL to Claude, **or** edit `config.json` on GitHub: open the file → ✏️ → put the URL in `"relayUrl": "https://script.google.com/macros/s/…/exec"` → **Commit changes**.
- A few minutes later the main button on the “My proposal” page becomes “Send to” + the keeper’s name; WhatsApp, GitHub and “copy code” stay under “Other ways to send” (opened automatically when a send fails).

**Every day**

- Each proposal arrives as an email like “🌳 [GFT #12] …” with the sender and their relation, the numbered changes, a preview link on the site and the GitHub link.
- Reply with one word on the **first line**:
  - **«موافق»** or `approve` — apply the changes;
  - **«موافق حذف»** or `approve deletion` — when the proposal removes, merges or re-parents people (the email says so with ⚠️; a plain “approve” is then not enough);
  - **«رفض»** or `reject` — decline politely;
  - **«موافق تخطي 3 5»** or `approve skip 3 5` — apply the rest without changes 3 and 5.
- Within about 5 minutes the relay posts the command on GitHub in your name, the bot applies it, and “✅ Applied” arrives in the same email conversation with the links to the people and the “Tell them on WhatsApp” link. If the bot finds a problem (needs changes, deletion approval required, already applied), its message arrives in the same conversation — just reply again.
- Everything on GitHub keeps working as before: comment commands, `/undo`, the Admin page.
- **A code that came on WhatsApp:** on the site's Admin page paste it → “Preview” → **“Send for approval by e-mail”**; the proposal email arrives and replying “approve” is enough. (The “create it on GitHub” link only works from a computer browser: the GitHub app on a phone opens the form empty.)
- **A request that arrived empty** (title “🌳 …” but no code — opened from the GitHub app): the bot posts a friendly comment asking for it to be sent again from the site, and adds the `needs-changes` label. Close it once the proposal has arrived again.

**Changing or renewing the token**

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → click the token → **Regenerate token** (pick a new expiration) → copy it. (Or create a new one as in (a).)
2. script.google.com → the project → **Project Settings** → **Script properties** → **Edit script properties** → paste the new value into `GITHUB_TOKEN` → **Save script properties**. Nothing else changes: same URL, same automatic check.

When the token expires the relay stops: relatives see “Sending did not work” with the other ways, and replies are not carried out. Renew it before it expires.

**Stopping the relay**

- Quickest: set `"relayUrl": ""` in `config.json` — the site goes back to WhatsApp as the main button.
- In Apps Script: choose **stopRelay** in the function menu → **Run** (replies are no longer read), then **Deploy** → **Manage deployments** → **Archive** (the URL stops working).
- Delete the token on GitHub (Fine-grained tokens → the token → Delete) if it is no longer needed.

**Security in short:** the token stays in the project’s script properties. The relay does only two things: it opens one request per proposal sent from the site, and it posts the command taken from the keeper’s own reply — accepted only from the keeper’s address, in that request’s own email conversation. The GitHub bot still checks everything as before.

---

<div dir="rtl">

## دليل مشرف شجرة العائلة

هذا الدليل لمن يدير الشجرة ويوافق على التعديلات. لا يحتاج الأقارب إلى أي شيء منه: هم يقترحون التعديلات من الموقع ويرسلونها عبر واتساب أو GitHub، والمشرف وحده يوافق عليها.

### ١. الإعداد بعد الدمج في الفرع الرئيسي (main)

الأتمتة ونموذج المقترحات في GitHub لا يعملان إلا بعد دمج العمل في الفرع الافتراضي (main). بعد الدمج:

1. **تفعيل GitHub Pages:** من ‏Settings ← Pages، اختيار «Deploy from a branch»، ثم الفرع `main` والمجلد `/ (root)`. يظهر الموقع بعد دقائق على `https://<المالك>.github.io/<المستودع>/`.
2. **صلاحيات الإجراءات (Actions):** من ‏Settings ← Actions ← General، يجب أن تكون Actions مفعّلة. إذا ظهر خطأ 403 في سجل التشغيل، يُختار «Read and write permissions» تحت «Workflow permissions».
3. **حماية الفرع:** إذا كان الفرع `main` محمياً ويشترط طلبات دمج (Pull requests)، فلن يتمكن الروبوت من حفظ البيانات. الحل: إبقاء الفرع دون هذا الشرط، أو السماح لـ GitHub Actions بتجاوزه.
4. **ملف الإعدادات `config.json`:**
   - `approvers`: أسماء حسابات GitHub المسموح لها بالموافقة (مثل `["gtsgate"]`).
   - `owner.name`: اسم المشرف كما يظهر للأقارب، و`owner.whatsapp`: رقم واتساب بالأرقام فقط مع رمز الدولة (مثل `9665xxxxxxxx`) ليصل إليه زر «إرسال عبر واتساب» مباشرة.
   - `siteUrl`: رابط الموقع العام (تُبنى منه روابط المعاينة في تعليقات الروبوت).
   - `relayUrl`: رابط الوسيط (Web app) للموافقة بالبريد، كما في القسم الأول. إذا كان فارغاً يبقى زر واتساب هو الزر الرئيسي.
5. **التصنيفات (Labels):** تُنشأ تلقائياً عند أول مقترح. ولإنشائها مسبقاً: Actions ← «Family tree · check proposal» ← Run workflow مع رقم أي مقترح.
6. **التنبيهات على الجوال:** تثبيت تطبيق GitHub Mobile، ثم من صفحة المستودع: Watch ← Custom ← Issues، لتصل التنبيهات عند وصول كل مقترح.

### ٢. كيف تتم الموافقة من الجوال

عند تفعيل الموافقة بالبريد (القسم الأول أعلاه) يكفي الرد على رسالة المقترح؛ وما يلي طريقة الموافقة من GitHub، وهي تعمل دائماً.

1. يُعِدّ القريب تعديلاته في الموقع ثم يرسلها. أغلب الأقارب يرسلونها **عبر واتساب** إلى المشرف؛ وفي هذه الحالة تُفتح صفحة «الإدارة» في الموقع (`#/admin`)، ويُلصق الرمز، ثم يُستخدم زر «إنشاء المقترح والموافقة عليه» (من متصفح الحاسوب، لأن تطبيق GitHub على الجوال يفتح النموذج فارغاً؛ ومع الموافقة بالبريد يُستخدم «إرسال للموافقة بالبريد» بدلاً منه). ومن لديه حساب GitHub يرسلها مباشرة عبر نموذج المقترحات.
2. خلال دقيقة تقريباً يكتب الروبوت **تعليق مراجعة** واحداً في المقترح (ويحدّثه عند كل تعديل):
   - ✅ جاهز، أو ⚠️ جاهز ويتضمن حذفاً، أو ❌ فيه ما يمنع تطبيقه.
   - قائمة مرقّمة بالتعديلات بالعربية والإنجليزية، والتنبيهات، ورابط **معاينة** على الموقع.
   - الأوامر الجاهزة للنسخ، مثل `/approve a1b2c3d4e5f60718`.
3. **للموافقة:** يكفي نسخ الأمر من تعليق الروبوت وإرساله تعليقاً (أو كتابة `/موافق a1b2c3d4e5f60718`). الأحرف الستة عشر بعد الأمر هي **بصمة** المقترح، وتضمن أن الموافقة على النسخة التي ظهرت في المراجعة تماماً.
   - بديل سريع: إضافة التصنيف `approve`. يُقبل هذا فقط إذا لم يُعدَّل المقترح بعد مراجعته الأولى، وإلا يطلب الروبوت الأمر مع البصمة.
4. بعد دقيقة أو اثنتين يكتب الروبوت «✅ طُبّقت التعديلات»، مع روابط الأشخاص في الموقع ورابط **«إبلاغ صاحب المقترح عبر واتساب»**، ثم يُغلق المقترح. قد يستغرق ظهور التغيير على الموقع بضع دقائق؛ والروابط فيها `?rev=` فتنتظر الصفحة حتى يُنشر التحديث.

### ٣. الأوامر

تُكتب الأوامر في **أول سطر** من التعليق، ويجب أن يبدأ التعليق بالشرطة المائلة `/`. حالة الأحرف لا تهم، والأرقام العربية مقبولة.

| الأمر | البديل العربي | العمل |
|---|---|---|
| `/approve a1b2c3d4e5f60718` | `/موافق a1b2c3d4e5f60718` | الموافقة على المقترح |
| `/approve a1b2c3d4e5f60718 skip 3,5` | `/موافق a1b2c3d4e5f60718 تخطي 3،5` | الموافقة مع تخطي التعديلين 3 و5 (بأرقامهما في تعليق المراجعة) وما يعتمد عليهما |
| `/approve a1b2c3d4e5f60718 force` | `/موافق a1b2c3d4e5f60718 فرض` | التطبيق رغم أن بيانات الشخص تغيّرت منذ إعداد المقترح |
| `/approve-deletion a1b2c3d4e5f60718` | `/موافق-حذف a1b2c3d4e5f60718` | موافقة تشمل الحذف أو الدمج أو تغيير الوالدين (موافقة منفصلة عمداً) |
| `/correct` + رمز جديد | `/تصحيح` | استبدال المقترح بنسخة مصحّحة ومراجعتها فقط، دون موافقة |
| `/reject` | `/رفض` | اعتذار لطيف ثابت النص (لا يذكر أي سبب) وإغلاق المقترح |
| `/undo` | `/تراجع` | التراجع عن مقترح طُبّق (على المقترح المغلق نفسه) |

لتجاهل مقترح دون رد: يكفي إغلاقه.

### ٤. تصحيح مقترح

- **الطريقة الأسهل:** من صفحة «الإدارة» في الموقع، «تصحيح هذا المقترح» ينقله إلى مسودة المشرف، وبعد التعديل يظهر زر «نسخ تعليق الموافقة»، فيُلصق التعليق (وهو `/approve` متبوعاً بالرمز الجديد) في المقترح نفسه. يراجع الروبوت النسخة المصحّحة ويطبّقها، ولا حاجة إلى بصمة لأن الرمز مكتوب بيد المشرف.
- للمراجعة فقط دون موافقة: `/correct` في السطر الأول ثم الرمز الجديد.
- إذا عدّل القريب نص مقترحه بنفسه، يحدّث الروبوت تعليق المراجعة ويطلب الموافقة بالبصمة الجديدة.
- عند ظهور «يعتمد هذا المقترح على #12»: الموافقة على #12 أولاً، ثم على هذا المقترح.

### ٥. التراجع

- `/undo` على المقترح المطبّق (المغلق) يعيد الأشخاص والأسر التي غيّرها إلى ما كانت عليه، ويحذف من أضافهم، ثم يضيف التصنيف `undone`.
- إذا تغيّر أحد هذه السجلات بعد التطبيق (بمقترح لاحق)، يرفض الروبوت التراجع ويذكر السجلات، حتى لا تضيع التعديلات اللاحقة. يمكن عندها التصحيح بمقترح جديد من الموقع.
- لإعادة تطبيق مقترح بعد التراجع عنه: إعادة فتحه، وإزالة التصنيف `undone`، ثم الموافقة عليه من جديد.

### ٦. طلبات الخصوصية

- **قريب لا يريد ظهور اسمه أو تفاصيله:** من صفحته في الموقع، «خيارات أخرى ← تحديد الحالة ← خاص». يُحجب الاسم وتُحذف التفاصيل الشخصية مع بقاء موقعه في الشجرة.
- **طلب الحذف الكامل:** «خيارات أخرى ← طلب حذف» مع السبب «بطلب من الشخص نفسه»؛ وتلزمه موافقة الحذف `/approve-deletion`. الحذف «لين» وقابل للاسترجاع، مع إمكانية مسح كل البيانات الشخصية.
- **تنبيه مهم:** سجل GitHub عام ويحتفظ بالنسخ السابقة. لإزالة معلومة حساسة من التاريخ نهائياً يلزم تدخل تقني (إعادة كتابة السجل) أو التواصل مع دعم GitHub. لذلك تُحفظ تواريخ ميلاد الأحياء بالسنة فقط، ويُفضّل إرسال أي تفاصيل خاصة عبر واتساب لا في المقترحات. ويمكن لمالك المستودع حذف مقترح كامل من GitHub عند الحاجة (من قائمة المقترح ← Delete issue).

### ٧. النسخ الاحتياطية

- كل يوم جمعة يُنشئ الروبوت إصداراً باسم `data-YYYY-MM-DD` في صفحة **Releases**، مرفقاً به `family.json` و`changelog.json` و`applied.json`، ويحتفظ بآخر 12 نسخة.
- لنسخة فورية: Actions ← «Family tree · weekly backup» ← Run workflow.
- للاسترجاع: تنزيل الملفات من الإصدار المطلوب، ثم رفعها إلى مجلد `data/` من واجهة GitHub (Add file ← Upload files) وحفظها.

### ٨. إضافة مشرف ثانٍ

1. إضافة اسم حسابه في GitHub إلى `approvers` في `config.json` (مثل `["gtsgate", "second-user"]`) وحفظ الملف في الفرع الرئيسي.
2. هذا يكفي لأوامر التعليقات (`/approve` وغيرها). أما استخدام **التصنيفات** فيتطلب صلاحية في المستودع: Settings ← Collaborators ← Add people (صلاحية Triage على الأقل).
3. الروبوت لا يثق بصلاحيات GitHub وحدها: الموافقة تُقبل فقط ممن يرد اسمه في `approvers`.

### ٩. حل المشكلات

- **طلب عنوانه «🌳 …» بلا رمز:** فُتح من تطبيق GitHub على الجوال، وهو يحذف محتوى النموذج. يردّ الروبوت بتعليق يطلب إعادة الإرسال من الموقع؛ ورابط GitHub في الموقع مخصص لمتصفح الحاسوب.
- **لم يظهر تعليق الروبوت:** صفحة Actions تعرض سبب الفشل. هل دُمج العمل في main؟ هل Actions مفعّلة؟ هل في المقترح رمز يبدأ بـ `GFT1:`؟
- **«يلزم تأكيد البصمة»:** عُدّل المقترح بعد مراجعته؛ يكفي نسخ الأمر الذي يقترحه الروبوت.
- **«تلزم موافقة الحذف»:** المقترح يحذف أو يدمج أو يغيّر الوالدين؛ يُستخدم `/approve-deletion` مع البصمة.
- **«تعذّر حفظ التحديث… ستُعاد المحاولة تلقائياً»:** حدث تحديث آخر في الوقت نفسه؛ يعيد الروبوت المحاولة كل 6 ساعات، أو فوراً من Actions ← «Family tree · apply approved proposals» ← Run workflow.
- **الموقع لم يتحدّث:** التحقق من إعداد Pages، والانتظار بضع دقائق؛ روابط `?rev=` تنتظر النشر تلقائياً.
- **أمر بلا رد:** يجيب الروبوت في كل تشغيل لاحق على أوامر المشرف التي لم يرد عليها (عدا `/undo`)؛ وإذا لم يرد على `/undo` خلال دقائق، يكفي إرساله مرة أخرى.
- **تشغيل تجريبي دون أي تغيير:** Actions ← «Family tree · apply approved proposals» ← Run workflow مع خيار `dry_run`.

</div>

---

## Owner guide (English)

This guide is for whoever keeps the tree and approves changes. Relatives need none of it: they prepare changes on the site and send them through WhatsApp or GitHub; only approvers can apply them.

### 1. Setup after merging to `main`

The automation and the issue form only work once the work is merged into the default branch (`main`). Then:

1. **Turn on GitHub Pages:** Settings → Pages → *Deploy from a branch* → branch `main`, folder `/ (root)`. The site appears after a few minutes at `https://<owner>.github.io/<repo>/`.
2. **Actions permissions:** Settings → Actions → General — Actions must be enabled. If a run fails with HTTP 403, choose *Read and write permissions* under *Workflow permissions*. (Each workflow already asks only for what it needs.)
3. **Branch protection:** if `main` requires pull requests, the bot cannot save data. Leave that rule off, or let GitHub Actions bypass it.
4. **`config.json`:**
   - `approvers`: GitHub logins allowed to approve (e.g. `["gtsgate"]`).
   - `owner.name`: how relatives see the keeper's name; `owner.whatsapp`: digits only with the country code (e.g. `9665xxxxxxxx`) so “Send on WhatsApp” goes straight to the keeper.
   - `siteUrl`: the public site URL (preview links in bot comments are built from it).
   - `relayUrl`: the Web app URL of the email relay (first section). Empty = WhatsApp stays the main send button.
5. **Labels** (`family-tree, approve, approve-deletion, needs-changes, applied, deletion-request, duplicate, undone`) are created automatically on the first proposal. To create them earlier: Actions → *Family tree · check proposal* → *Run workflow* with any issue number.
6. **Phone notifications:** install GitHub Mobile, then on the repository: Watch → Custom → Issues.

### 2. How approval works on the phone

With email approvals set up (the first section above), replying to the proposal email is enough; what follows is the GitHub way, which always works.

1. A relative prepares changes on the site and sends them. Most will send **on WhatsApp**: open the site's Admin page (`#/admin`), paste the code and tap **“Create issue and approve”** (from a computer browser — the GitHub app on a phone opens the form empty; with email approvals, use **“Send for approval by e-mail”** instead). Relatives with a GitHub account can send through the issue form directly.
2. Within about a minute the bot writes **one check comment** on the issue (updated whenever the issue changes):
   - ✅ ready, ⚠️ ready but includes removals, or ❌ something prevents applying it;
   - the numbered changes in Arabic and English, warnings, and a **preview** link to the site;
   - ready-to-copy commands such as `/approve a1b2c3d4e5f60718`.
3. **To approve**, copy the command from the bot comment and post it as a comment (or type `/موافق a1b2c3d4e5f60718`). The 16 characters are the proposal's **fingerprint**: they guarantee that exactly the version shown in the check is approved.
   - Shortcut: add the `approve` label. This is accepted only if the proposal was not edited after its first check; otherwise the bot asks for the command with the fingerprint.
4. A minute or two later the bot posts “✅ Applied”, with links to the people on the site and a **“Tell them on WhatsApp”** link, and closes the issue. The site may take a few minutes to update; the links carry `?rev=` so the page waits for the new version.

### 3. Commands

Commands go on the **first line** of a comment, and the comment must start with `/`. Case does not matter; Arabic digits are fine.

| Command | Arabic alias | Effect |
|---|---|---|
| `/approve a1b2c3d4e5f60718` | `/موافق a1b2c3d4e5f60718` | Approve |
| `/approve a1b2c3d4e5f60718 skip 3,5` | `/موافق a1b2c3d4e5f60718 تخطي 3،5` | Approve but skip changes 3 and 5 (numbers from the check comment) and anything depending on them |
| `/approve a1b2c3d4e5f60718 force` | `/موافق a1b2c3d4e5f60718 فرض` | Apply even though the person's data changed since the proposal was prepared |
| `/approve-deletion a1b2c3d4e5f60718` | `/موافق-حذف a1b2c3d4e5f60718` | Approval that includes removals, merges or changing parents (deliberately separate) |
| `/correct` + new code | `/تصحيح` | Replace the proposal with a corrected one and check it, without approving |
| `/reject` | `/رفض` | A fixed, polite thank-you/decline (never states a reason) and close |
| `/undo` | `/تراجع` | Undo an applied proposal (on that closed issue) |

To ignore a proposal without replying, just close it.

### 4. Correcting a proposal

- **Easiest:** on the site's Admin page, **“Correct this proposal”** loads it into the keeper's draft; after editing, **“Copy approval comment”** copies `/approve` followed by the new code — paste it as a comment on the same issue. The bot checks the corrected version and applies it; no fingerprint is needed because the keeper wrote the code.
- To check a correction without approving: `/correct` on the first line, then the new code.
- If the relative edits their issue, the bot refreshes its check and asks for the new fingerprint.
- “This builds on #12”: approve #12 first, then this one.

### 5. Undo

- `/undo` on an applied (closed) issue puts the people and families it changed back as they were, removes the people it added, and labels the issue `undone`.
- If any of those records changed afterwards (a later proposal), the bot refuses and lists them, so later work is never erased. Fix them with a new proposal instead.
- To apply a proposal again after an undo: reopen it, remove the `undone` label and approve it again.

### 6. Privacy requests

- **Someone does not want their name or details shown:** on their page, *More options → Mark as → Private*. The name is withheld and personal details are cleared; their place in the tree stays.
- **Removal:** *More options → Request removal* with the reason “person requested”; it needs `/approve-deletion`. Removal is soft (restorable) and can also wipe all personal fields.
- **Important:** GitHub history is public and keeps earlier versions. Erasing something from history requires a history rewrite or GitHub Support. That is why living people's birth dates are stored as a year only, and why private details belong on WhatsApp, not in proposals. The repository owner can delete a whole issue on GitHub if needed (issue menu → *Delete issue*).

### 7. Backups

- Every Friday the bot creates a release `data-YYYY-MM-DD` on the **Releases** page with `family.json`, `changelog.json` and `applied.json` attached, keeping the latest 12. Data releases are never marked “latest”.
- On demand: Actions → *Family tree · weekly backup* → *Run workflow*.
- To restore: download the files from the release and upload them to `data/` in the GitHub web interface (*Add file → Upload files*), then commit.

### 8. Adding a second approver

1. Add their GitHub login to `approvers` in `config.json` (e.g. `["gtsgate", "second-user"]`) and commit it to `main`.
2. That is enough for comment commands. Using **labels** also needs repository access: Settings → Collaborators → *Add people* (at least *Triage*).
3. The bot does not rely on GitHub roles alone: an approval counts only from a login listed in `approvers` (labels are verified through the issue's event history).

### 9. Troubleshooting

- **A “🌳 …” request with no code:** it was opened in the GitHub mobile app, which drops the form. The bot answers asking for it to be sent again from the site; the site's GitHub link is meant for a computer browser.
- **No bot comment:** the Actions tab shows why. Is the work merged into `main`? Are Actions enabled? Does the issue contain a code starting with `GFT1:`?
- **“Please confirm the fingerprint”:** the proposal was edited after it was checked — copy the command the bot suggests.
- **“The deletion approval is needed”:** the proposal removes, merges or re-parents people — use `/approve-deletion` with the fingerprint.
- **“…will be retried automatically”:** another update happened at the same moment; the queue runs again every 6 hours, or immediately via Actions → *Family tree · apply approved proposals* → *Run workflow*.
- **Site not updated:** check the Pages settings and wait a few minutes; `?rev=` links wait for publication on their own.
- **A command got no reply:** every later run answers approver commands that never got a reply (except `/undo`); if `/undo` gets no reply within a few minutes, post it again.
- **Try without changing anything:** Actions → *Family tree · apply approved proposals* → *Run workflow* with `dry_run` ticked.

### For maintainers

```sh
cd family-tree
node --test                                   # all tests (core, site, automation)
node scripts/validate-data.mjs                # data invariants and ledger shapes
node scripts/check-proposal.mjs --dry-run --event scripts/fixtures/issue-opened.json
node scripts/apply-proposal.mjs --dry-run --event scripts/fixtures/approve-comment.json
```

Offline dry runs simulate GitHub from the event file, apply in memory and print the comments the bot would post; nothing is written. With `GITHUB_TOKEN` set, `--dry-run` reads the real issues and only logs writes.

**Moving the portal to its own repository:** copy the contents of `family-tree/` to the new repository root and `.github/` beside them; in each `family-tree-*.yml` change `PORTAL_DIR: family-tree` to `PORTAL_DIR: .` (the CI `paths:` filters already list both layouts); update `repo`, `siteUrl` and `portalPath` in `config.json`. The scripts find their files relative to their own location and read the repository name from `GITHUB_REPOSITORY`.
