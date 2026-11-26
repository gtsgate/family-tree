// Owner mode — the interface (docs/SPEC.md §5.1, §7.8). The logic lives in js/owner.js.
//   ownerCard({rerender})        #/admin top card «وضع المشرف»: sign in with a GitHub key (instructions inline) / sign out
//   ownerHeader()                header pill: «المشرف» / Saving… / Saved ✓ / Not saved
//   ownerSaveCard({rerender})    #/draft: «حفظ الكل في الشجرة» (the draft straight into the tree)
//   applyNowBox(analysis)        #/preview and #/admin: «تطبيق مباشرة» for a relative's proposal
//   initOwnerUi()                shows the owner module's notices (toasts; a dialog when GitHub stops accepting the key)
// Never builds HTML from data; the token is only ever read from the password field and handed to owner.signIn().
import { h, icon, bdi, toast, modal, confirmDialog } from './dom.js';
import { t, register, lang } from './i18n.js';
import { store } from './store.js';
import { owner } from './owner.js';
import { formatIssue } from './core/messages.js';
import { refNames } from './core/describe.js';
import { LIMITS } from './core/schema.js';

const arCount = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`);

register({
  en: {
    'owner.badge': 'Owner',
    'owner.badgeTitle': 'Owner mode: changes made on this device go straight into the tree',
    'owner.saving': 'Saving…',
    'owner.saved': 'Saved ✓',
    'owner.notSaved': 'Not saved',
    'owner.unsavedPill': ({ n }) => `${n} not saved`,
    'owner.unsavedBar': ({ n }) => (n === 1 ? 'You have 1 change that is not saved in the tree yet' : `You have ${n} changes that are not saved in the tree yet`),
    'owner.reviewSave': 'Review & save',
    'owner.title': 'Owner mode',
    'owner.lead': 'Edit the tree directly from this device — no proposal and no approval step. Every change is saved into the tree on GitHub and appears on the site within about a minute.',
    'owner.signedIn': 'Signed in as {login} on this device',
    'owner.signedInText': 'Every addition and correction made here is saved straight into the tree. A relative’s proposal can be applied with “Apply now” on its preview.',
    'owner.signOut': 'Sign out',
    'owner.signOutHint': 'Signing out forgets the key on this device only; on GitHub it stays valid until it expires or is deleted there.',
    'owner.tokenLabel': 'GitHub key (fine-grained personal access token)',
    'owner.signIn': 'Sign in',
    'owner.checking': 'Checking with GitHub…',
    'owner.howTitle': 'How to create the key (once — about two minutes)',
    'owner.step1': 'On github.com, signed in as {login}: Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.',
    'owner.step2': 'Token name: family-tree keeper. Expiration: 1 year.',
    'owner.step3': 'Repository access: Only select repositories → {repo}.',
    'owner.step4': 'Repository permissions: Contents → Read and write, and Issues → Read and write.',
    'owner.step5': 'Generate token, copy it, paste it here, then “Sign in”.',
    'owner.relayNote': 'The same key also serves the e-mail relay (its GITHUB_TOKEN script property).',
    'owner.deviceNote': 'The key is kept in this browser on this device only and is sent to GitHub alone. Owner mode is best used on a personal phone or computer.',
    'owner.guide': 'Owner guide (step by step)',
    'owner.err.empty': 'Please paste the key first.',
    'owner.err.format': 'This does not look like a GitHub key (a fine-grained key starts with “github_pat_”).',
    'owner.err.invalid': 'GitHub did not accept this key — it may be incomplete, expired or deleted.',
    'owner.err.notApprover': 'This key belongs to {login}, who is not listed as an approver of this tree (config.json).',
    'owner.err.noAccess': 'This key cannot see the {repo} repository. Under “Repository access”, choose {repo}.',
    'owner.err.noPush': 'This key cannot save to the repository. Set “Contents” to “Read and write”.',
    'owner.err.rateLimit': 'GitHub asks to wait a little. Please try again in a few minutes.',
    'owner.err.network': 'Could not reach GitHub. Please check the connection and try again.',
    'owner.err.http': 'GitHub answered with an error. Please try again in a moment.',
    'owner.err.conflict': 'The tree kept changing at the same moment. Please try again.',
    'owner.publicOn': 'Owner mode is on for this device: changes made here go straight into the tree.',
    'owner.rejected': 'Not saved: {problems} The change is kept on this device, in “My proposal”.',
    'owner.failed.network': 'Not saved: GitHub could not be reached. The change is kept on this device, in “My proposal”.',
    'owner.failed.rateLimit': 'Not saved: GitHub asks to wait a little. The change is kept on this device, in “My proposal”.',
    'owner.failed.conflict': 'Not saved: the tree kept changing at the same moment. The change is kept on this device, in “My proposal”.',
    'owner.failed.http': 'Not saved: GitHub answered with an error. The change is kept on this device, in “My proposal”.',
    'owner.retry': 'Try again',
    'owner.open': 'Open',
    'owner.authTitle': 'Owner mode was turned off',
    'owner.authText': 'GitHub no longer accepts the key saved on this device — it may have expired or been deleted. Nothing was lost: changes not yet saved are kept in “My proposal”. A new key can be added on the Owner tools page.',
    'owner.forbiddenTitle': 'GitHub refused to save',
    'owner.forbiddenText': 'The key on this device is not allowed to save to the repository (“Contents” may be read-only, or the branch is protected). Nothing was lost: changes not yet saved are kept in “My proposal”. Signing out and adding a key with “Contents: Read and write” fixes it.',
    'owner.toAdmin': 'Owner tools',
    'owner.toDraft': 'My proposal',
    'owner.draftLead': 'Changes on this device that are not in the tree yet. Owner mode is on, so they can be saved straight into the tree.',
    'owner.saveTitle': 'Save to the tree',
    'owner.saveText': 'Saving puts these changes straight into the tree, in one update.',
    'owner.saveAll': 'Save all to the tree',
    'owner.saveCorr': 'Request #{n} is then closed as applied.',
    'owner.saveBlocked': 'Please remove or correct the changes with problems first.',
    'owner.saveTooBig': 'Too many changes for one update: please remove some and save them in two steps.',
    'owner.saveFailed': 'Not saved:',
    'owner.applyText': 'Applies this proposal to the tree straight away, as it is.',
    'owner.applyTextIssue': 'Applies this proposal to the tree straight away, as it is, and closes request #{n}.',
    'owner.apply': 'Apply now',
    'owner.applying': 'Applying…',
    'owner.applied': 'Applied ✓ — live on the site in about a minute.',
    'owner.appliedClosed': 'Request #{n} was closed with a note.',
    'owner.applyAlready': 'This proposal is already in the tree.',
    'owner.applyFailed': 'Could not apply:',
    'owner.applyConfirmTitle': 'Apply a removal or a move?',
    'owner.applyConfirmText': 'This proposal removes, merges or moves records (see the changes). It is applied at once; removed records can be restored later from Owner tools.',
    'owner.idReused': 'This proposal’s id is already used by a different proposal in the tree. Please ask for it to be sent again from the site.',
    'owner.notApplicable': 'It cannot be applied as it is — see the problems above, or use “Correct this proposal”.',
  },
  ar: {
    'owner.badge': 'المشرف',
    'owner.badgeTitle': 'وضع المشرف: التعديلات من هذا الجهاز تُحفظ في الشجرة مباشرة',
    'owner.saving': 'جارٍ الحفظ…',
    'owner.saved': 'تم الحفظ ✓',
    'owner.notSaved': 'لم يُحفظ',
    'owner.unsavedPill': ({ n }) => (n === 1 ? 'تعديل واحد لم يُحفظ' : n === 2 ? 'تعديلان لم يُحفظا' : n <= 10 ? `${n} تعديلات لم تُحفظ` : `${n} تعديلاً لم يُحفظ`),
    'owner.unsavedBar': ({ n }) => `لديك ${arCount(n, 'تعديل واحد', 'تعديلان', 'تعديلات', 'تعديلاً')} لم ${n === 2 ? 'يُحفظا' : n === 1 || n > 10 ? 'يُحفظ' : 'تُحفظ'} في الشجرة بعد`,
    'owner.reviewSave': 'مراجعة وحفظ',
    'owner.title': 'وضع المشرف',
    'owner.lead': 'تعديل الشجرة مباشرةً من هذا الجهاز، دون مقترح ولا خطوة موافقة. يُحفظ كل تعديل في الشجرة على GitHub ويظهر في الموقع خلال دقيقة تقريباً.',
    'owner.signedIn': 'تمّ تسجيل الدخول باسم {login} على هذا الجهاز',
    'owner.signedInText': 'كل إضافة أو تصحيح من هنا يُحفظ في الشجرة مباشرة، ويمكن تطبيق مقترح أحد الأقارب بزر «تطبيق مباشرة» في صفحة معاينته.',
    'owner.signOut': 'تسجيل الخروج',
    'owner.signOutHint': 'تسجيل الخروج يمحو المفتاح من هذا الجهاز فقط، ويبقى صالحاً على GitHub حتى تنتهي مدته أو يُحذف هناك.',
    'owner.tokenLabel': 'مفتاح GitHub (رمز وصول شخصي دقيق الصلاحيات)',
    'owner.signIn': 'تسجيل الدخول',
    'owner.checking': 'جارٍ التحقق مع GitHub…',
    'owner.howTitle': 'طريقة إنشاء المفتاح (مرة واحدة، نحو دقيقتين)',
    'owner.step1': 'في موقع github.com بحساب {login}: Settings ← Developer settings ← Personal access tokens ← Fine-grained tokens ← Generate new token.',
    'owner.step2': 'الاسم (Token name): family-tree keeper، والمدة (Expiration): سنة واحدة.',
    'owner.step3': 'الوصول إلى المستودعات (Repository access): Only select repositories ثم {repo}.',
    'owner.step4': 'الصلاحيات (Repository permissions): Contents على Read and write، وIssues على Read and write.',
    'owner.step5': 'بعدها Generate token، ثم نسخ المفتاح ولصقه هنا، ثم «تسجيل الدخول».',
    'owner.relayNote': 'المفتاح نفسه يصلح أيضاً لوسيط البريد (خاصية GITHUB_TOKEN في السكربت).',
    'owner.deviceNote': 'يُحفظ المفتاح في هذا المتصفح على هذا الجهاز فقط، ولا يُرسل إلا إلى GitHub. يُستحسن استخدام وضع المشرف على جوال أو حاسوب شخصي.',
    'owner.guide': 'دليل المشرف (خطوة بخطوة)',
    'owner.err.empty': 'يُرجى لصق المفتاح أولاً.',
    'owner.err.format': 'لا يبدو هذا مفتاحاً من GitHub (المفتاح الدقيق الصلاحيات يبدأ بـ«github_pat_»).',
    'owner.err.invalid': 'لم يقبل GitHub هذا المفتاح؛ ربما نُسخ ناقصاً أو انتهت صلاحيته أو حُذف.',
    'owner.err.notApprover': 'هذا المفتاح تابع للحساب {login}، وهو غير مدرج بين مشرفي هذه الشجرة (config.json).',
    'owner.err.noAccess': 'لا يصل هذا المفتاح إلى مستودع {repo}. يُرجى اختيار {repo} في «Repository access».',
    'owner.err.noPush': 'لا يملك هذا المفتاح صلاحية الحفظ في المستودع. يُرجى ضبط «Contents» على «Read and write».',
    'owner.err.rateLimit': 'يطلب GitHub الانتظار قليلاً. يُرجى المحاولة بعد دقائق.',
    'owner.err.network': 'تعذّر الوصول إلى GitHub. يُرجى التحقق من الاتصال والمحاولة مجدداً.',
    'owner.err.http': 'أعاد GitHub خطأً. يُرجى المحاولة بعد قليل.',
    'owner.err.conflict': 'كانت الشجرة تتغيّر في اللحظة نفسها. يُرجى المحاولة مجدداً.',
    'owner.publicOn': 'وضع المشرف مفعّل على هذا الجهاز: التعديلات من هنا تدخل الشجرة مباشرة.',
    'owner.rejected': 'لم يُحفظ: {problems} التعديل باقٍ على هذا الجهاز في «مقترحي».',
    'owner.failed.network': 'لم يُحفظ: تعذّر الوصول إلى GitHub. التعديل باقٍ على هذا الجهاز في «مقترحي».',
    'owner.failed.rateLimit': 'لم يُحفظ: يطلب GitHub الانتظار قليلاً. التعديل باقٍ على هذا الجهاز في «مقترحي».',
    'owner.failed.conflict': 'لم يُحفظ: كانت الشجرة تتغيّر في اللحظة نفسها. التعديل باقٍ على هذا الجهاز في «مقترحي».',
    'owner.failed.http': 'لم يُحفظ: أعاد GitHub خطأً. التعديل باقٍ على هذا الجهاز في «مقترحي».',
    'owner.retry': 'إعادة المحاولة',
    'owner.open': 'فتح',
    'owner.authTitle': 'توقّف وضع المشرف',
    'owner.authText': 'لم يعد GitHub يقبل المفتاح المحفوظ على هذا الجهاز، فربما انتهت صلاحيته أو حُذف. لم يضِع شيء: التعديلات التي لم تُحفظ باقية في «مقترحي». ويمكن إضافة مفتاح جديد من صفحة أدوات المشرف.',
    'owner.forbiddenTitle': 'رفض GitHub الحفظ',
    'owner.forbiddenText': 'المفتاح الموجود على هذا الجهاز غير مسموح له بالحفظ في المستودع (ربما صلاحية «Contents» للقراءة فقط، أو أن الفرع محميّ). لم يضِع شيء: التعديلات التي لم تُحفظ باقية في «مقترحي». ويُحلّ ذلك بتسجيل الخروج ثم إضافة مفتاح بصلاحية «Contents: Read and write».',
    'owner.toAdmin': 'أدوات المشرف',
    'owner.toDraft': 'مقترحي',
    'owner.draftLead': 'تعديلات على هذا الجهاز لم تدخل الشجرة بعد. وضع المشرف مفعّل، لذا يمكن حفظها في الشجرة مباشرة.',
    'owner.saveTitle': 'الحفظ في الشجرة',
    'owner.saveText': 'بالحفظ تدخل هذه التعديلات الشجرة مباشرة، في تحديث واحد.',
    'owner.saveAll': 'حفظ الكل في الشجرة',
    'owner.saveCorr': 'ثم يُغلق الطلب رقم {n} على أنه طُبّق.',
    'owner.saveBlocked': 'يُرجى أولاً حذف التعديلات التي فيها مشكلات أو تصحيحها.',
    'owner.saveTooBig': 'التعديلات أكثر مما يتّسع له تحديث واحد: يُرجى حذف بعضها وحفظها على مرحلتين.',
    'owner.saveFailed': 'لم يُحفظ:',
    'owner.applyText': 'يطبّق هذا المقترح على الشجرة فوراً كما هو.',
    'owner.applyTextIssue': 'يطبّق هذا المقترح على الشجرة فوراً كما هو، ويُغلق الطلب رقم {n}.',
    'owner.apply': 'تطبيق مباشرة',
    'owner.applying': 'جارٍ التطبيق…',
    'owner.applied': 'طُبّق ✓ — يظهر في الموقع خلال دقيقة.',
    'owner.appliedClosed': 'أُغلق الطلب رقم {n} مع ملاحظة.',
    'owner.applyAlready': 'هذا المقترح موجود في الشجرة من قبل.',
    'owner.applyFailed': 'تعذّر التطبيق:',
    'owner.applyConfirmTitle': 'تطبيق حذف أو نقل؟',
    'owner.applyConfirmText': 'يتضمّن هذا المقترح حذفاً أو دمجاً أو نقلاً لسجلات (كما في التعديلات)، وسيُطبَّق فوراً، ويمكن استعادة المحذوف لاحقاً من أدوات المشرف.',
    'owner.idReused': 'رقم هذا المقترح مستخدم لمقترح آخر موجود في الشجرة. يُرجى طلب إرساله مجدداً من الموقع.',
    'owner.notApplicable': 'لا يمكن تطبيقه كما هو؛ يُرجى مراجعة المشكلات أعلاه، أو استخدام «تصحيح هذا المقترح».',
  },
});

const repoName = () => store.config?.repo?.name || 'family-tree';
/** A failed save/apply (no proposal problems) as one short sentence. */
const failText = (kind) => t(`owner.err.${['network', 'rateLimit', 'conflict'].includes(kind) ? kind : 'http'}`);
const keeperLogin = () => (store.config?.approvers || [])[0] || '';
const portalPrefix = () => {
  const raw = store.config && 'portalPath' in store.config ? String(store.config.portalPath || '') : 'family-tree';
  const p = raw.replace(/^[./]+|\/+$/g, '');
  return p ? `${p}/` : '';
};

/** Issues of a save/apply as short texts (names from the proposal and the working graph). */
function problemTexts(errors, proposal = null, max = 3) {
  const graph = store.working || store.base;
  let names = {};
  try { names = proposal ? refNames(proposal, graph) : {}; } catch { names = {}; }
  const list = (errors || []).map((e) => (e?.code === 'PROPOSAL_ID_REUSED' ? t('owner.idReused') : formatIssue(e, lang(), { graph, refNames: names, withOp: false })));
  const uniq = [...new Set(list.filter(Boolean))];
  return uniq.length > max ? [...uniq.slice(0, max), '…'] : uniq;
}

// ---------------------------------------------------------------------------------------------------------------
// Header

/** The header pill while owner mode is on (null otherwise). */
export function ownerHeader() {
  if (!owner.active()) return null;
  const st = owner.status;
  const label = st === 'saving' ? t('owner.saving') : st === 'saved' ? t('owner.saved') : st === 'error' ? t('owner.notSaved') : t('owner.badge');
  const mark = st === 'saving'
    ? h('span', { class: 'spinner owner-pill-spin', attrs: { 'aria-hidden': 'true' } })
    : icon(st === 'saved' ? 'check' : st === 'error' ? 'warning' : 'key', { size: 16 });
  const href = st === 'error' && store.draft.ops.length ? '#/draft' : '#/admin';
  return h('a', {
    class: ['owner-pill', `is-${st}`], href, title: t('owner.badgeTitle'),
    attrs: { 'aria-label': `${t('owner.badge')} — ${label}` },
  }, mark, h('span', { class: 'owner-pill-text' }, label));
}

// ---------------------------------------------------------------------------------------------------------------
// #/admin card

const signState = { busy: false, error: null };

function errorMessage(r) {
  const vars = { login: r.login || '', repo: repoName() };
  return t(`owner.err.${['empty', 'format', 'invalid', 'notApprover', 'noAccess', 'noPush', 'rateLimit', 'network'].includes(r.reason) ? r.reason : 'http'}`, vars);
}

export function ownerCard({ rerender = () => {} } = {}) {
  const head = h('div', { class: 'owner-card-head' },
    h('span', { class: 'owner-card-mark', attrs: { 'aria-hidden': 'true' } }, icon('key', { size: 20 })),
    h('h2', { id: 'owner-card-title' }, t('owner.title')));
  if (owner.active()) {
    return h('section', { class: 'card stack owner-card is-on', attrs: { 'aria-labelledby': 'owner-card-title' } },
      head,
      h('p', { class: 'owner-signed', attrs: { role: 'status' } }, icon('check', { size: 18 }), h('span', null, t('owner.signedIn', { login: owner.login }))),
      h('p', { class: 'small' }, t('owner.signedInText')),
      h('div', { class: 'row' },
        h('button', {
          type: 'button', class: 'btn owner-signout',
          on: { click: () => { owner.signOut(); signState.error = null; rerender(); } },
        }, t('owner.signOut'))),
      h('p', { class: 'small muted' }, t('owner.signOutHint')));
  }
  const input = h('input', {
    id: 'owner-token', class: 'input owner-token', type: 'password', dir: 'ltr', placeholder: 'github_pat_…',
    autocomplete: 'off', spellcheck: false, disabled: signState.busy,
    attrs: { autocapitalize: 'off', autocorrect: 'off', 'aria-describedby': 'owner-token-note' },
  });
  const submit = async (e) => {
    e?.preventDefault?.();
    if (signState.busy) return;
    const token = input.value;
    signState.busy = true;
    signState.error = null;
    rerender();
    let r;
    try { r = await owner.signIn(token); } catch { r = { ok: false, reason: 'http' }; }
    signState.busy = false;
    signState.error = r.ok ? null : errorMessage(r);
    rerender();
    if (!r.ok) setTimeout(() => document.getElementById('owner-token')?.focus(), 0);
  };
  const steps = h('ol', { class: 'owner-steps' },
    h('li', null, t('owner.step1', { login: keeperLogin() })),
    h('li', null, t('owner.step2')),
    h('li', null, t('owner.step3', { repo: repoName() })),
    h('li', null, t('owner.step4')),
    h('li', null, t('owner.step5')));
  const guide = store.repoUrl(`/blob/${store.config?.repo?.branch || 'main'}/${portalPrefix()}docs/OWNER-GUIDE.md`);
  return h('section', { class: 'card stack owner-card', attrs: { 'aria-labelledby': 'owner-card-title' } },
    head,
    h('p', { class: 'small' }, t('owner.lead')),
    h('form', { class: 'stack owner-form', on: { submit } },
      h('div', { class: 'field' },
        h('label', { class: 'field-label', for: 'owner-token' }, t('owner.tokenLabel')),
        input,
        signState.error ? h('p', { class: 'field-error owner-error', attrs: { role: 'alert' } }, signState.error) : null),
      h('div', { class: 'row' },
        h('button', { type: 'submit', class: 'btn btn-primary owner-signin', disabled: signState.busy, attrs: { 'aria-busy': signState.busy ? 'true' : 'false' } },
          signState.busy ? h('span', { class: 'spinner owner-pill-spin', attrs: { 'aria-hidden': 'true' } }) : icon('key', { size: 18 }),
          signState.busy ? t('owner.checking') : t('owner.signIn')))),
    h('p', { id: 'owner-token-note', class: 'small muted' }, t('owner.deviceNote')),
    h('details', { class: 'owner-how' },
      h('summary', null, t('owner.howTitle')),
      steps,
      h('p', { class: 'small' }, t('owner.relayNote')),
      h('p', { class: 'small' }, h('a', { href: guide, target: '_blank', rel: 'noopener' }, t('owner.guide')))));
}

// ---------------------------------------------------------------------------------------------------------------
// #/draft card

let saveDraftState = { busy: false, error: null, id: null };

export function ownerSaveCard({ rerender = () => {} } = {}) {
  const n = store.draft.ops.length;
  const blocked = store.draftErrors.length > 0;
  const tooBig = n > LIMITS.ops;
  if (saveDraftState.id !== store.draft.id) saveDraftState = { busy: false, error: null, id: store.draft.id };
  const issue = Number(store.draft.source?.issue) || null;
  const busy = saveDraftState.busy || owner.busy();
  const save = async () => {
    if (busy || blocked || tooBig) return;
    saveDraftState = { busy: true, error: null, id: store.draft.id };
    rerender();
    const p = store.draftProposal();
    const res = await owner.saveDraft();
    saveDraftState = { busy: false, error: res.ok ? null : (res.errors ? problemTexts(res.errors, p) : [failText(res.error?.kind)]), id: store.draft.id };
    if (res.ok) toast(t('ui.savedToTree'), { type: 'success', timeout: 7000 });
    rerender();
  };
  return h('section', { class: 'card card-accent owner-save', attrs: { 'aria-labelledby': 'owner-save-title' } },
    h('h2', { id: 'owner-save-title' }, t('owner.saveTitle')),
    h('p', { class: 'small' }, t('owner.saveText')),
    issue ? h('p', { class: 'small muted' }, t('owner.saveCorr', { n: issue })) : null,
    blocked ? h('p', { class: 'notice notice-danger' }, icon('warning'), h('span', null, t('owner.saveBlocked'))) : null,
    tooBig ? h('p', { class: 'notice notice-danger' }, icon('warning'), h('span', null, t('owner.saveTooBig'))) : null,
    saveDraftState.error ? h('div', { class: 'notice notice-danger owner-save-error', attrs: { role: 'alert' } }, icon('warning'),
      h('div', null, h('p', null, t('owner.saveFailed')), h('ul', null, saveDraftState.error.map((x) => h('li', null, bdi(x)))))) : null,
    h('button', {
      type: 'button', class: 'btn btn-primary btn-lg btn-block owner-save-all', disabled: busy || blocked || tooBig || !n,
      attrs: { 'aria-busy': busy ? 'true' : 'false' }, on: { click: save },
    }, busy ? h('span', { class: 'spinner owner-pill-spin', attrs: { 'aria-hidden': 'true' } }) : icon('check', { size: 20 }),
    busy ? t('owner.saving') : t('owner.saveAll')));
}

// ---------------------------------------------------------------------------------------------------------------
// #/preview and #/admin: "Apply now"

/**
 * The owner's "Apply now" block for an analysis (preview.js): state on the analysis (a.direct = {status, result}),
 * re-rendered through a.onReady. → element | null (owner mode off)
 */
export function applyNowBox(a, { ok = true, destructive = false, alreadyApplied = false } = {}) {
  if (!owner.active()) return null;
  const st = a.direct || { status: 'idle' };
  const issue = Number(a.issue?.number) || null;
  const run = async () => {
    if (st.status === 'applying') return;
    if (destructive && !(await confirmDialog({ title: t('owner.applyConfirmTitle'), message: t('owner.applyConfirmText'), confirmLabel: t('owner.apply'), danger: true }))) return;
    a.direct = { status: 'applying' };
    a.onReady?.();
    let res;
    try { res = await owner.applyNow(a.proposal, { issue, hash: a.hash || '' }); } catch { res = { ok: false, error: { kind: 'http' } }; }
    a.direct = { status: res.ok ? 'done' : 'error', result: res };
    a.onReady?.();
    if (res.ok) toast(t('owner.applied'), { type: 'success', timeout: 7000 });
  };
  let outcome = null;
  if (st.status === 'done') {
    outcome = h('div', { class: 'notice notice-success owner-applied', attrs: { role: 'status' } }, icon('check'),
      h('div', null, h('p', null, t('owner.applied')), st.result?.closed && issue ? h('p', { class: 'small' }, t('owner.appliedClosed', { n: issue })) : null));
  } else if (st.status === 'error') {
    const r = st.result || {};
    const lines = r.already ? [t('owner.applyAlready')]
      : r.errors ? problemTexts(r.errors, a.proposal, 6)
        : [failText(r.error?.kind)];
    outcome = h('div', { class: ['notice', r.already ? 'notice-info' : 'notice-danger', 'owner-apply-error'], attrs: { role: 'alert' } }, icon(r.already ? 'info' : 'warning'),
      h('div', null, r.already ? null : h('p', null, t('owner.applyFailed')), h('ul', null, lines.map((x) => h('li', null, bdi(x))))));
  }
  const applying = st.status === 'applying';
  const canApply = ok && !alreadyApplied && st.status !== 'done';
  return h('div', { class: 'preview-owner owner-apply' },
    h('p', { class: 'preview-owner-title' }, icon('key', { size: 16 }), h('strong', null, t('owner.title'))),
    h('p', { class: 'small' }, issue ? t('owner.applyTextIssue', { n: issue }) : t('owner.applyText')),
    !ok && !alreadyApplied && st.status === 'idle' ? h('p', { class: 'small muted' }, t('owner.notApplicable')) : null,
    outcome,
    st.status === 'done' ? null : h('button', {
      type: 'button', class: ['btn', destructive ? 'btn-danger' : 'btn-primary', 'owner-apply-now'], disabled: !canApply || applying,
      attrs: { 'aria-busy': applying ? 'true' : 'false' }, on: { click: run },
    }, applying ? h('span', { class: 'spinner owner-pill-spin', attrs: { 'aria-hidden': 'true' } }) : icon('check', { size: 18 }),
    applying ? t('owner.applying') : t('owner.apply')));
}

// ---------------------------------------------------------------------------------------------------------------
// Notices from the save queue

function showNotice(n) {
  if (n.type === 'rejected') {
    const problems = problemTexts(n.errors, n.proposal).join(' · ');
    toast(t('owner.rejected', { problems: problems ? `${problems}.`.replace(/\.\.$/, '.') : '' }), {
      type: 'error', timeout: 15000, action: { label: t('owner.open'), href: '#/draft' },
    });
    return;
  }
  if (n.type === 'failed') {
    const kind = ['network', 'rateLimit', 'conflict'].includes(n.kind) ? n.kind : 'http';
    toast(t(`owner.failed.${kind}`), {
      type: 'error', timeout: 15000,
      action: store.draft.ops.length ? { label: t('owner.retry'), onClick: () => { owner.saveDraft(); } } : null,
    });
    return;
  }
  if (n.type === 'auth' || n.type === 'forbidden') {
    const auth = n.type === 'auth';
    modal({
      title: t(auth ? 'owner.authTitle' : 'owner.forbiddenTitle'),
      size: 'sm',
      className: 'owner-alert',
      body: h('p', null, t(auth ? 'owner.authText' : 'owner.forbiddenText')),
      actions: [
        { label: t('common.close'), variant: 'ghost', value: null },
        store.draft.ops.length ? { label: t('owner.toDraft'), value: '#/draft' } : null,
        auth ? null : { label: t('owner.signOut'), value: 'signout' },
        { label: t('owner.toAdmin'), variant: 'primary', value: '#/admin' },
      ].filter(Boolean),
    }).then((v) => {
      if (v === 'signout') { owner.signOut(); location.hash = '#/admin'; } else if (typeof v === 'string' && v.startsWith('#/')) location.hash = v;
    });
  }
}

let uiStarted = false;
/** Show the owner module's notices as they come (call once, after store.init). */
export function initOwnerUi() {
  if (uiStarted) return;
  uiStarted = true;
  store.on('owner', () => {
    for (const n of owner.takeNotices()) {
      try { showNotice(n); } catch (e) { console.error(e); }
    }
  });
}
