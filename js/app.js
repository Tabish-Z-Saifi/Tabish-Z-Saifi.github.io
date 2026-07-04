/* ===================================================================
   Wedding Guest List v2 — Firebase auth + Firestore sync.
   UI layer. All data operations live in store.js.
   =================================================================== */
import { configReady } from './firebase.js';
import * as store from './store.js';

/* ---------- tiny helpers ---------- */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}

function confirmDialog(message, { title = 'Are you sure?', okLabel = 'OK', danger = false } = {}) {
  return new Promise(res => {
    $('#confirmTitle').textContent = title;
    $('#confirmMsg').textContent = message;
    const ok = $('#confirmOk');
    ok.textContent = okLabel;
    ok.className = danger ? 'btn-danger' : 'btn-primary';
    $('#confirmModal').hidden = false;
    const done = v => { $('#confirmModal').hidden = true; ok.onclick = null; $('#confirmCancel').onclick = null; res(v); };
    ok.onclick = () => done(true);
    $('#confirmCancel').onclick = () => done(false);
  });
}

const tsMs = t => (t && typeof t.toMillis === 'function') ? t.toMillis() : 0;
const fmtAt = t => (t && typeof t.toDate === 'function')
  ? t.toDate().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  : '';

/* =====================================================================
   SESSION + STATE
   ===================================================================== */
const session = { user: null, accountId: null, profileName: null };
const state = { account: null, functions: [], guests: [], members: [], invite: null };
let unsubs = [];
let migrationChecked = false;
const by = () => ({ uid: session.user.uid, name: session.profileName || 'Unknown' });

function showScreen(name) {
  ['setup', 'auth', 'onboard', 'app'].forEach(s => { $('#screen-' + s).hidden = s !== name; });
  document.body.classList.toggle('in-app', name === 'app');
}

function cleanupSession() {
  unsubs.forEach(u => u && u());
  unsubs = [];
  session.accountId = null;
  session.profileName = null;
  state.account = null; state.functions = []; state.guests = []; state.members = []; state.invite = null;
  migrationChecked = false;
}

/* =====================================================================
   BOOT
   ===================================================================== */
const joinCodeFromUrl = new URLSearchParams(location.search).get('join');

if (!configReady) {
  showScreen('setup');
} else {
  store.watchAuth(async user => {
    cleanupSession();
    session.user = user;
    if (!user) { showScreen('auth'); return; }
    try {
      const ptr = await store.getUserPointer(user.uid);
      if (!ptr) {
        showScreen('onboard');
        if (joinCodeFromUrl) {
          setOnboardMode('join');
          $('#obJoinCode').value = joinCodeFromUrl.toUpperCase();
        }
        return;
      }
      enterAccount(ptr.accountId, ptr.name);
    } catch (e) {
      console.error(e);
      toast('Could not load your account — check your connection');
      showScreen('auth');
    }
  });
}

function enterAccount(accountId, profileName) {
  session.accountId = accountId;
  session.profileName = profileName;
  showScreen('app');

  const lostAccess = err => {
    if (err && err.code === 'permission-denied') {
      cleanupSession();
      store.clearUserPointer(session.user.uid).catch(() => {});
      showScreen('onboard');
      toast('Your access to this wedding was removed');
    }
  };

  unsubs.push(store.listenAccount(accountId, acc => {
    state.account = acc;
    state.functions = (acc && acc.functions) || [];
    $('#brandText').textContent = acc ? acc.name : 'Guest List';
    rerenderCurrent();
  }, lostAccess));

  unsubs.push(store.listenGuests(accountId, guests => {
    state.guests = guests;
    rerenderCurrent();
    maybeOfferMigration();
  }, lostAccess));

  unsubs.push(store.listenMembers(accountId, members => {
    state.members = members;
    if (currentView === 'more') renderMore();
  }));

  unsubs.push(store.listenInviteSettings(accountId, inv => {
    state.invite = inv;
    if (currentView === 'more') renderMore();
  }));

  showView('dashboard');
}

/* =====================================================================
   AUTH SCREEN
   ===================================================================== */
let authMode = 'signin';
const AUTH_ERRORS = {
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/user-not-found': 'No account with that email — tap "Create an account".',
  'auth/wrong-password': 'Wrong password.',
  'auth/email-already-in-use': 'That email already has an account — sign in instead.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/invalid-email': 'That email address looks invalid.',
  'auth/too-many-requests': 'Too many attempts — wait a minute and try again.',
  'auth/network-request-failed': 'No internet connection — try again when online.',
  'auth/popup-closed-by-user': ''
};
function authError(e) {
  const msg = AUTH_ERRORS[e.code];
  if (msg === '') return;                       // user cancelled popup — silent
  const el = $('#authError');
  el.textContent = msg || 'Something went wrong: ' + (e.code || e.message);
  el.hidden = false;
}

$('#authToggle').addEventListener('click', () => {
  authMode = authMode === 'signin' ? 'signup' : 'signin';
  $('#authSubmit').textContent = authMode === 'signin' ? 'Sign In' : 'Create Account';
  $('#authToggle').textContent = authMode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in';
  $('#authSubtitle').textContent = authMode === 'signin' ? "Sign in to your family's guest list" : 'Create your login (each family member gets their own)';
  $('#authPassword').autocomplete = authMode === 'signin' ? 'current-password' : 'new-password';
  $('#authError').hidden = true;
});

$('#authForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#authError').hidden = true;
  const email = $('#authEmail').value.trim();
  const pw = $('#authPassword').value;
  const btn = $('#authSubmit');
  btn.disabled = true;
  try {
    if (authMode === 'signin') await store.signIn(email, pw);
    else await store.signUp(email, pw);
  } catch (err) { authError(err); }
  btn.disabled = false;
});

$('#googleBtn').addEventListener('click', async () => {
  $('#authError').hidden = true;
  try { await store.signInGoogle(); }
  catch (err) {
    // Popups are unreliable inside installed iOS PWAs — guide the user.
    if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment') {
      authError({ code: '', message: 'Google sign-in is blocked here — use email & password instead.' });
    } else authError(err);
  }
});

$('#forgotBtn').addEventListener('click', async () => {
  const email = $('#authEmail').value.trim();
  if (!email) { toast('Type your email above first'); return; }
  try {
    await store.resetPassword(email);
    toast('Password reset email sent — check your inbox');
  } catch (err) { authError(err); }
});

/* =====================================================================
   ONBOARDING
   ===================================================================== */
function setOnboardMode(mode) {
  $$('#onboardSeg button').forEach(b => b.classList.toggle('active', b.dataset.val === mode));
  $('#onboardCreate').hidden = mode !== 'create';
  $('#onboardJoin').hidden = mode !== 'join';
  $('#onboardError').hidden = true;
}
$('#onboardSeg').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) setOnboardMode(b.dataset.val);
});

function onboardError(msg) {
  const el = $('#onboardError');
  el.textContent = msg;
  el.hidden = false;
}

$('#onboardCreate').addEventListener('submit', async e => {
  e.preventDefault();
  const accountName = $('#obAccountName').value.trim();
  const profileName = $('#obCreateProfile').value.trim();
  if (!accountName || !profileName) return;
  e.submitter.disabled = true;
  try {
    const accountId = await store.createAccount(session.user, accountName, profileName);
    enterAccount(accountId, profileName);
  } catch (err) {
    console.error(err);
    onboardError('Could not create the wedding — check your connection and that the Firestore rules are published.');
  }
  e.submitter.disabled = false;
});

$('#onboardJoin').addEventListener('submit', async e => {
  e.preventDefault();
  const code = $('#obJoinCode').value.trim().toUpperCase();
  const profileName = $('#obJoinProfile').value.trim();
  if (!code || !profileName) return;
  e.submitter.disabled = true;
  try {
    const accountId = await store.joinAccount(session.user, code, profileName);
    enterAccount(accountId, profileName);
    toast('Welcome to the wedding! 🎉');
  } catch (err) {
    console.error(err);
    onboardError(err.message && !err.code ? err.message : 'Could not join — the code may be invalid, used, or expired.');
  }
  e.submitter.disabled = false;
});

$('#onboardSignOut').addEventListener('click', () => store.logOut());

/* =====================================================================
   NAVIGATION
   ===================================================================== */
let currentView = 'dashboard';
function showView(name) {
  currentView = name;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  $$('.tab[data-view]').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  window.scrollTo(0, 0);
  rerenderCurrent();
}
function rerenderCurrent() {
  if (!session.accountId) return;
  if (currentView === 'dashboard') renderDashboard();
  if (currentView === 'guests') renderGuests();
  if (currentView === 'functions') renderFunctions();
  if (currentView === 'more') renderMore();
}
$$('.tab[data-view]').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));

/* Online/offline indicator */
function updateOnline() { $('#offlineDot').hidden = navigator.onLine; }
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);
updateOnline();

/* =====================================================================
   DASHBOARD
   ===================================================================== */
const funcName = id => (state.functions.find(f => f.id === id) || {}).name || '';

function renderDashboard() {
  const g = state.guests;
  const totalPeople = g.reduce((s, x) => s + (x.people || 0), 0);
  const done = g.filter(x => x.status === 'done');
  const accom = g.filter(x => x.accommodation).reduce((s, x) => s + (x.people || 0), 0);
  const convey = g.filter(x => x.conveyance).reduce((s, x) => s + (x.people || 0), 0);

  $('#statGuests').textContent = g.length;
  $('#statPeople').textContent = totalPeople;
  $('#statAccom').textContent = accom;
  $('#statConvey').textContent = convey;

  const doneCount = done.length;
  $('#statDone').textContent = doneCount;
  $('#statPending').textContent = g.length - doneCount;
  $('#progressLabel').textContent = `${doneCount} / ${g.length}`;
  $('#progressFill').style.width = (g.length ? Math.round((doneCount / g.length) * 100) : 0) + '%';
  $('#headerCount').textContent = g.length ? `${g.length} families · ${totalPeople} people` : '';

  const fEl = $('#dashFunctions');
  if (!state.functions.length) {
    fEl.innerHTML = '<p class="empty-mini">No functions yet — add some in Events.</p>';
  } else {
    fEl.innerHTML = state.functions.map(f => {
      const inv = g.filter(x => (x.functions || []).includes(f.id));
      const ppl = inv.reduce((s, x) => s + (x.people || 0), 0);
      return `<div class="dash-row"><span class="name">${esc(f.name)}</span>
        <span class="val">${ppl} ppl · ${inv.length} fam</span></div>`;
    }).join('');
  }

  const cEl = $('#dashCities');
  const cities = {};
  g.forEach(x => {
    const c = (x.city || 'Unknown').trim() || 'Unknown';
    cities[c] = (cities[c] || 0) + (x.people || 0);
  });
  const entries = Object.entries(cities).sort((a, b) => b[1] - a[1]);
  cEl.innerHTML = entries.length
    ? entries.map(([c, n]) => `<div class="dash-row"><span class="name">${esc(c)}</span><span class="val">${n} ppl</span></div>`).join('')
    : '<p class="empty-mini">No guests yet.</p>';
}

/* =====================================================================
   GUEST LIST + FILTERS
   ===================================================================== */
const filters = { search: '', city: '', func: '', status: '', type: '', accom: '', convey: '' };

$('#searchInput').addEventListener('input', e => { filters.search = e.target.value.toLowerCase().trim(); renderGuests(); });
$('#filterToggle').addEventListener('click', () => { const p = $('#filtersPanel'); p.hidden = !p.hidden; });
[['#fCity', 'city'], ['#fFunction', 'func'], ['#fStatus', 'status'], ['#fType', 'type'], ['#fAccom', 'accom'], ['#fConvey', 'convey']]
  .forEach(([sel, key]) => $(sel).addEventListener('change', e => { filters[key] = e.target.value; renderGuests(); }));
$('#clearFilters').addEventListener('click', () => {
  filters.city = filters.func = filters.status = filters.type = filters.accom = filters.convey = '';
  ['#fCity', '#fFunction', '#fStatus', '#fType', '#fAccom', '#fConvey'].forEach(s => { $(s).value = ''; });
  renderGuests();
});

function refreshFilterOptions() {
  const cities = [...new Set(state.guests.map(g => (g.city || '').trim()).filter(Boolean))].sort();
  const cs = $('#fCity');
  const cur = cs.value;
  cs.innerHTML = '<option value="">All</option>' + cities.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  cs.value = cur;
  $('#cityList').innerHTML = cities.map(c => `<option value="${esc(c)}">`).join('');
  const fs = $('#fFunction');
  const curF = fs.value;
  fs.innerHTML = '<option value="">All</option>' + state.functions.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
  fs.value = curF;
}

function auditLine(g) {
  const c = g.createdBy, u = g.updatedBy;
  if (!c && !u) return '';
  let s = c ? `Added by ${esc(c.name)}${c.at ? ' · ' + fmtAt(c.at) : ''}` : '';
  if (u && (!c || u.name !== c.name || tsMs(u.at) - tsMs(c.at) > 60000)) {
    s += `${s ? ' — ' : ''}Edited by ${esc(u.name)}${u.at ? ' · ' + fmtAt(u.at) : ''}`;
  }
  return s;
}

function renderGuests() {
  refreshFilterOptions();
  const badge = $('#filterBadge');
  const n = ['city', 'func', 'status', 'type', 'accom', 'convey'].filter(k => filters[k]).length;
  badge.textContent = n;
  badge.classList.toggle('show', n > 0);

  let list = state.guests.slice();
  if (filters.search) list = list.filter(g => (g.name || '').toLowerCase().includes(filters.search));
  if (filters.city) list = list.filter(g => (g.city || '').trim() === filters.city);
  if (filters.func) list = list.filter(g => (g.functions || []).includes(filters.func));
  if (filters.status) list = list.filter(g => g.status === filters.status);
  if (filters.type) list = list.filter(g => g.type === filters.type);
  if (filters.accom) list = list.filter(g => (g.accommodation ? 'yes' : 'no') === filters.accom);
  if (filters.convey) list = list.filter(g => (g.conveyance ? 'yes' : 'no') === filters.convey);
  list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const people = list.reduce((s, x) => s + (x.people || 0), 0);
  $('#listMeta').textContent = state.guests.length
    ? `Showing ${list.length} of ${state.guests.length} families · ${people} people`
    : '';

  const el = $('#guestList');
  if (!state.guests.length) {
    el.innerHTML = `<div class="empty-state"><span class="big">👰</span>No guests yet.<br>Tap the ＋ button to add your first family.</div>`;
    return;
  }
  if (!list.length) {
    el.innerHTML = `<div class="empty-state"><span class="big">🔍</span>No guests match your search/filters.</div>`;
    return;
  }

  el.innerHTML = list.map(g => {
    const funcs = (g.functions || []).map(funcName).filter(Boolean);
    const funcTags = funcs.length
      ? funcs.map(f => `<span class="tag func">${esc(f)}</span>`).join('')
      : `<span class="tag">No functions</span>`;
    const isWA = g.type === 'WhatsApp + Call';
    const doneInv = g.status === 'done';
    const audit = auditLine(g);
    return `<div class="guest-card" data-id="${g.id}">
      <div class="gc-top">
        <div>
          <div class="gc-name">${esc(g.name)}</div>
          <div class="gc-city">📍 ${esc(g.city || '—')}</div>
        </div>
        <div class="gc-right">
          <div class="gc-people">${g.people} ppl</div>
          ${isWA ? `<button class="invite-btn ${doneInv ? 'sent' : ''}" data-invite="${g.id}">${doneInv ? '✓ Invited' : '📤 Invite'}</button>` : ''}
        </div>
      </div>
      <div class="gc-tags">
        <span class="tag ${doneInv ? 'done' : 'pending'}">${doneInv ? '✓ Done' : '◷ Not Yet'}</span>
        <span class="tag info">${esc(g.type)}</span>
        ${g.accommodation ? '<span class="tag info">🏨 Stay</span>' : ''}
        ${g.conveyance ? '<span class="tag info">🚗 Barat ride</span>' : ''}
        ${funcTags}
      </div>
      ${g.note ? `<div class="gc-note">“${esc(g.note)}”</div>` : ''}
      ${audit ? `<div class="gc-audit">${audit}</div>` : ''}
    </div>`;
  }).join('');

  el.querySelectorAll('.guest-card').forEach(c => c.addEventListener('click', e => {
    const inviteBtn = e.target.closest('[data-invite]');
    if (inviteBtn) { e.stopPropagation(); inviteFlow(inviteBtn.dataset.invite); return; }
    openGuest(c.dataset.id);
  }));
}

/* =====================================================================
   WHATSAPP INVITE FLOW
   ===================================================================== */
function dataUrlToFile(dataUrl, filename) {
  const [head, b64] = dataUrl.split(',');
  const mime = (head.match(/data:(.*?);/) || [])[1] || 'image/jpeg';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], filename, { type: mime });
}

async function inviteFlow(guestId) {
  const g = state.guests.find(x => x.id === guestId);
  if (!g) return;

  // Already invited → offer to un-mark
  if (g.status === 'done') {
    if (await confirmDialog(`“${g.name}” is marked as invited. Mark as NOT invited?`, { title: 'Undo invite', okLabel: 'Mark Not Invited' })) {
      store.updateGuest(session.accountId, g.id, { status: 'pending' }, by()).catch(() => toast('Could not update'));
    }
    return;
  }

  const inv = state.invite;
  if (!inv || (!inv.message && !inv.imageData)) {
    toast('First set up your invitation card & message in More');
    showView('more');
    return;
  }

  try {
    let shared = false;
    if (inv.imageData && navigator.canShare) {
      const file = dataUrlToFile(inv.imageData, 'wedding-invitation.jpg');
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: inv.message || '' });
        shared = true;
      }
    }
    if (!shared && navigator.share) {
      await navigator.share({ text: inv.message || '' });
      shared = true;
    }
    if (!shared) {
      // Last-resort fallback (mostly desktop): open WhatsApp with the text; image must be attached manually.
      window.open('https://wa.me/?text=' + encodeURIComponent(inv.message || ''), '_blank');
      shared = true;
    }
    // navigator.share resolves only after the user completes the share sheet
    // (and rejects on cancel) — so this is the "share finished" moment.
    if (await confirmDialog(`Did you send the invite to “${g.name}”? Mark them as invited?`, { title: 'Invitation shared', okLabel: 'Mark Invited' })) {
      store.updateGuest(session.accountId, g.id, { status: 'done' }, by()).catch(() => toast('Could not update'));
      toast(`✓ ${g.name} marked as invited`);
    }
  } catch (err) {
    /* AbortError = user cancelled the share sheet — do nothing */
    if (err && err.name !== 'AbortError') toast('Sharing failed on this device');
  }
}

/* =====================================================================
   GUEST EDITOR MODAL
   ===================================================================== */
let editingId = null;

function openGuest(id) {
  editingId = id;
  const g = id ? state.guests.find(x => x.id === id) : null;
  $('#guestModalTitle').textContent = g ? 'Edit Guest' : 'Add Guest';
  $('#guestDelete').hidden = !g;

  $('#gCity').value = g ? g.city : '';
  $('#gName').value = g ? g.name : '';
  $('#gPeople').value = g ? g.people : 1;
  $('#gNote').value = g ? (g.note || '') : '';
  $('#gType').value = g ? g.type : 'WhatsApp + Call';
  setSeg('#gStatus', g ? g.status : 'pending');
  setSeg('#gAccom', g && g.accommodation ? 'yes' : 'no');
  setSeg('#gConvey', g && g.conveyance ? 'yes' : 'no');
  syncSolo();

  const auditEl = $('#gAudit');
  const audit = g ? auditLine(g) : '';
  auditEl.hidden = !audit;
  auditEl.innerHTML = audit;

  const fc = $('#gFunctions');
  if (!state.functions.length) {
    fc.innerHTML = '<p class="no-func-msg">No functions defined yet. Add them in the Events tab.</p>';
  } else {
    const sel = new Set(g ? (g.functions || []) : []);
    fc.innerHTML = state.functions.map(f => `
      <label class="check-item ${sel.has(f.id) ? 'checked' : ''}">
        <input type="checkbox" value="${f.id}" ${sel.has(f.id) ? 'checked' : ''}>
        <span>${esc(f.name)}</span>
      </label>`).join('');
    fc.querySelectorAll('input').forEach(cb =>
      cb.addEventListener('change', () => cb.closest('.check-item').classList.toggle('checked', cb.checked)));
  }

  $('#guestModal').hidden = false;
}

function setSeg(sel, val) { $$(sel + ' button').forEach(b => b.classList.toggle('active', b.dataset.val === val)); }
function getSeg(sel) { const a = $(sel + ' button.active'); return a ? a.dataset.val : null; }
$$('.seg').forEach(seg => seg.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || seg.id === 'onboardSeg') return;
  seg.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
}));

$('#peopleMinus').addEventListener('click', () => stepPeople(-1));
$('#peoplePlus').addEventListener('click', () => stepPeople(1));
$('#gPeople').addEventListener('input', syncSolo);
function stepPeople(d) {
  const inp = $('#gPeople');
  inp.value = Math.max(1, (parseInt(inp.value) || 1) + d);
  syncSolo();
}
$('#soloBtn').addEventListener('click', () => { $('#gPeople').value = 1; syncSolo(); });
function syncSolo() { $('#soloBtn').classList.toggle('active', (parseInt($('#gPeople').value) || 1) === 1); }

function closeModal() { $('#guestModal').hidden = true; editingId = null; }
$('#guestCancel').addEventListener('click', closeModal);
$('#guestModal').addEventListener('click', e => { if (e.target.id === 'guestModal') closeModal(); });
$('#addGuestTab').addEventListener('click', () => openGuest(null));

/* ---------- duplicate detection ---------- */
const TITLES = new Set(['mr', 'mrs', 'ms', 'dr', 'md', 'mohd', 'muhammad', 'mohammad', 'syed', 'haji', 'hafiz', 'janab', 'shri', 'smt']);
function firstNameKey(name) {
  const parts = String(name || '').toLowerCase().replace(/\./g, '').split(/\s+/).filter(Boolean);
  while (parts.length > 1 && TITLES.has(parts[0])) parts.shift();
  return parts[0] || '';
}
function findDuplicate(name, city) {
  const key = firstNameKey(name);
  const c = city.toLowerCase().trim();
  if (!key) return null;
  return state.guests.find(g =>
    firstNameKey(g.name) === key && (g.city || '').toLowerCase().trim() === c) || null;
}
function dupDialog(dup) {
  return new Promise(res => {
    $('#dupMsg').innerHTML =
      `A guest named <b>${esc(dup.name)}</b> from <b>${esc(dup.city)}</b> (${dup.people} people) already exists. Continue adding as a new person, or edit the existing entry?`;
    $('#dupModal').hidden = false;
    const done = v => {
      $('#dupModal').hidden = true;
      ['#dupEdit', '#dupNew', '#dupCancel'].forEach(s => { $(s).onclick = null; });
      res(v);
    };
    $('#dupEdit').onclick = () => done('edit');
    $('#dupNew').onclick = () => done('new');
    $('#dupCancel').onclick = () => done('cancel');
  });
}

$('#guestSave').addEventListener('click', async () => {
  const name = $('#gName').value.trim();
  const city = $('#gCity').value.trim();
  if (!name) { toast('Please enter a name'); $('#gName').focus(); return; }
  if (!city) { toast('Please enter a city'); $('#gCity').focus(); return; }
  const people = Math.max(1, parseInt($('#gPeople').value) || 1);
  const funcs = $$('#gFunctions input:checked').map(cb => cb.value);

  const data = {
    city, name, people,
    note: $('#gNote').value.trim(),
    type: $('#gType').value,
    status: getSeg('#gStatus'),
    functions: funcs,
    accommodation: getSeg('#gAccom') === 'yes',
    conveyance: getSeg('#gConvey') === 'yes'
  };

  if (editingId) {
    store.updateGuest(session.accountId, editingId, data, by()).catch(() => toast('⚠️ Save failed — will retry when online'));
    toast('✓ Guest updated');
  } else {
    const dup = findDuplicate(name, city);
    if (dup) {
      const choice = await dupDialog(dup);
      if (choice === 'cancel') return;
      if (choice === 'edit') { closeModal(); openGuest(dup.id); return; }
    }
    store.addGuest(session.accountId, data, by()).catch(() => toast('⚠️ Save failed — will retry when online'));
    toast('✓ Guest added');
  }
  closeModal();
});

$('#guestDelete').addEventListener('click', async () => {
  if (!editingId) return;
  const g = state.guests.find(x => x.id === editingId);
  if (await confirmDialog(`Delete "${g ? g.name : 'this guest'}"? This removes them for all family members.`, { title: 'Delete guest', okLabel: 'Delete', danger: true })) {
    store.deleteGuest(session.accountId, editingId).catch(() => toast('Delete failed'));
    closeModal();
    toast('Guest deleted');
  }
});

/* =====================================================================
   FUNCTIONS MANAGEMENT
   ===================================================================== */
function renderFunctions() {
  const el = $('#functionList');
  if (!state.functions.length) {
    el.innerHTML = `<div class="empty-state"><span class="big">🎉</span>No functions yet.<br>Add Haldi, Barat, Reception, etc. above.</div>`;
    return;
  }
  el.innerHTML = state.functions.map(f => {
    const ppl = state.guests.filter(g => (g.functions || []).includes(f.id)).reduce((s, x) => s + (x.people || 0), 0);
    return `<div class="func-item" data-id="${f.id}">
      <span class="fname">${esc(f.name)}</span>
      <span class="count">${ppl} ppl</span>
      <button class="icon-btn" data-act="rename" title="Rename">✏️</button>
      <button class="icon-btn danger" data-act="delete" title="Delete">🗑️</button>
    </div>`;
  }).join('');

  el.querySelectorAll('.func-item').forEach(item => {
    const id = item.dataset.id;
    item.querySelector('[data-act="delete"]').addEventListener('click', () => deleteFunction(id));
    item.querySelector('[data-act="rename"]').addEventListener('click', () => startRename(item, id));
  });
}

function startRename(item, id) {
  const f = state.functions.find(x => x.id === id);
  const span = item.querySelector('.fname');
  const input = document.createElement('input');
  input.className = 'rename';
  input.value = f.name;
  span.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => {
    const v = input.value.trim();
    if (v && v !== f.name) {
      const fns = state.functions.map(x => x.id === id ? { ...x, name: v } : x);
      store.saveFunctions(session.accountId, fns).catch(() => toast('Rename failed'));
    }
    renderFunctions();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') renderFunctions();
  });
}

async function deleteFunction(id) {
  const f = state.functions.find(x => x.id === id);
  const usedBy = state.guests.filter(g => (g.functions || []).includes(id));
  const msg = usedBy.length
    ? `Delete "${f.name}"? It will be removed from ${usedBy.length} guest(s), for everyone.`
    : `Delete "${f.name}"?`;
  if (!await confirmDialog(msg, { title: 'Delete function', okLabel: 'Delete', danger: true })) return;
  try {
    await store.saveFunctions(session.accountId, state.functions.filter(x => x.id !== id));
    await store.removeFunctionFromGuests(session.accountId, id, usedBy.map(g => g.id));
    toast('Function deleted');
  } catch (e) { toast('Delete failed'); }
}

$('#addFunctionBtn').addEventListener('click', addFunction);
$('#newFunctionInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addFunction(); } });
function addFunction() {
  const inp = $('#newFunctionInput');
  const name = inp.value.trim();
  if (!name) return;
  if (state.functions.some(f => f.name.toLowerCase() === name.toLowerCase())) {
    toast('That function already exists');
    return;
  }
  store.saveFunctions(session.accountId, [...state.functions, { id: store.rid(8), name }])
    .catch(() => toast('Could not add'));
  inp.value = '';
  toast('✓ Function added');
}

/* =====================================================================
   MORE: account, members, invitation setup, exports
   ===================================================================== */
let invFormDirty = false;
let pendingInvImage = null;

function renderMore() {
  $('#accountNameLbl').textContent = state.account ? state.account.name : 'Account';
  $('#profileLbl').textContent = `Signed in as ${session.profileName || ''} · ${session.user?.email || ''}`;

  const ml = $('#membersList');
  ml.innerHTML = state.members.map(m => `
    <div class="member-row">
      <span class="member-avatar">${esc((m.name || '?')[0].toUpperCase())}</span>
      <span class="member-name">${esc(m.name)}${m.uid === session.user.uid ? ' <span class="you">(you)</span>' : ''}</span>
      ${m.uid !== session.user.uid ? `<button class="icon-btn danger" data-remove="${m.uid}" title="Remove access">✕</button>` : ''}
    </div>`).join('') || '<p class="empty-mini">Loading members…</p>';
  ml.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', async () => {
    const m = state.members.find(x => x.uid === b.dataset.remove);
    if (await confirmDialog(`Remove ${m.name}'s access to this guest list?`, { title: 'Remove access', okLabel: 'Remove', danger: true })) {
      store.removeMember(session.accountId, m.uid).catch(() => toast('Could not remove'));
    }
  }));

  // Invitation form — don't clobber unsaved edits
  if (!invFormDirty) {
    $('#invMessage').value = (state.invite && state.invite.message) || '';
    const img = state.invite && state.invite.imageData;
    $('#invPreview').hidden = !img && !pendingInvImage;
    if (pendingInvImage) $('#invPreview').src = pendingInvImage;
    else if (img) $('#invPreview').src = img;
  }
}

$('#invMessage').addEventListener('input', () => { invFormDirty = true; });

$('#signOutBtn').addEventListener('click', async () => {
  if (await confirmDialog('Sign out of this device? Your data stays safely in the cloud.', { title: 'Sign out', okLabel: 'Sign Out' })) {
    store.logOut();
  }
});

/* ---------- invites ---------- */
$('#createInviteBtn').addEventListener('click', async () => {
  const btn = $('#createInviteBtn');
  btn.disabled = true;
  try {
    const code = await store.createInvite(session.accountId, session.user.uid);
    $('#inviteCodeBox').textContent = code;
    $('#inviteModal').hidden = false;
    const link = location.origin + location.pathname + '?join=' + code;
    $('#copyInviteLink').onclick = () => { navigator.clipboard.writeText(`Join our wedding guest list: ${link}`); toast('Link copied — send it on WhatsApp'); };
    $('#copyInviteCode').onclick = () => { navigator.clipboard.writeText(code); toast('Code copied'); };
    $('#inviteClose').onclick = () => { $('#inviteModal').hidden = true; };
  } catch (e) { toast('Could not create invite'); }
  btn.disabled = false;
});

/* ---------- invitation image upload (compressed into Firestore) ---------- */
$('#invImageBtn').addEventListener('click', () => $('#invImageInput').click());
$('#invImageInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    pendingInvImage = await compressImage(file);
    invFormDirty = true;
    $('#invPreview').src = pendingInvImage;
    $('#invPreview').hidden = false;
    toast('Image ready — tap Save invitation');
  } catch (err) { toast('Could not process that image'); }
  e.target.value = '';
});

function compressImage(file) {
  // Target: dataURL under ~850k chars so the Firestore doc stays below its 1 MiB limit.
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      const dims = [1400, 1100, 900, 700];
      for (const maxDim of dims) {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        for (let q = 0.85; q >= 0.45; q -= 0.1) {
          const url = canvas.toDataURL('image/jpeg', q);
          if (url.length < 850000) return resolve(url);
        }
      }
      reject(new Error('image too large'));
    };
    img.onerror = () => reject(new Error('bad image'));
    img.src = URL.createObjectURL(file);
  });
}

$('#invSaveBtn').addEventListener('click', async () => {
  const data = { message: $('#invMessage').value.trim() };
  if (pendingInvImage) data.imageData = pendingInvImage;
  try {
    await store.saveInviteSettings(session.accountId, data);
    pendingInvImage = null;
    invFormDirty = false;
    toast('✓ Invitation saved for the whole family');
  } catch (e) { toast('Save failed — check connection'); }
});

/* ---------- backup JSON (export only) ---------- */
$('#exportJsonBtn').addEventListener('click', () => {
  const payload = {
    app: 'wedding-guest-list', version: 2, exportedAt: new Date().toISOString(),
    account: state.account ? state.account.name : '',
    data: { functions: state.functions, guests: state.guests }
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `guest-list-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('✓ Backup downloaded');
});

/* ---------- danger: delete all guests ---------- */
$('#clearAllBtn').addEventListener('click', async () => {
  if (!await confirmDialog('Delete ALL guests for everyone in this account? Download a backup first if unsure.', { title: 'Delete all guests', okLabel: 'Continue', danger: true })) return;
  if (!await confirmDialog('This permanently deletes every guest, on every device. Absolutely sure?', { title: 'Final warning', okLabel: 'Delete Everything', danger: true })) return;
  try {
    await store.deleteAllGuests(session.accountId, state.guests.map(g => g.id));
    toast('All guests deleted');
  } catch (e) { toast('Delete failed'); }
});

/* =====================================================================
   PDF EXPORT (unchanged from v1 — grouped by city)
   ===================================================================== */
$('#exportPdfBtn').addEventListener('click', () => {
  if (!window.jspdf) { toast('PDF library still loading — try again'); return; }
  if (!state.guests.length) { toast('No guests to export'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const M = 40;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = M;
  const newPageIfNeeded = h => { if (y + h > pageH - M) { doc.addPage(); y = M; } };

  doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(122, 31, 61);
  doc.text(state.account ? state.account.name : 'Wedding Guest List', M, y); y += 24;
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(120);
  const totalPeople = state.guests.reduce((s, x) => s + (x.people || 0), 0);
  doc.text(`${state.guests.length} families · ${totalPeople} people · generated ${new Date().toLocaleDateString()}`, M, y);
  y += 22;

  const byCity = {};
  state.guests.forEach(g => {
    const c = (g.city || 'Unknown').trim() || 'Unknown';
    (byCity[c] = byCity[c] || []).push(g);
  });

  Object.keys(byCity).sort().forEach(city => {
    const guests = byCity[city].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const cityPeople = guests.reduce((s, x) => s + (x.people || 0), 0);

    newPageIfNeeded(40);
    doc.setFillColor(122, 31, 61);
    doc.rect(M, y - 12, pageW - 2 * M, 22, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(255);
    doc.text(city, M + 8, y + 3);
    doc.setFontSize(10);
    doc.text(`${guests.length} families · ${cityPeople} people`, pageW - M - 8, y + 3, { align: 'right' });
    y += 22;

    doc.setTextColor(40);
    guests.forEach(g => {
      const funcs = (g.functions || []).map(funcName).filter(Boolean).join(', ') || 'No functions';
      const line1 = `${g.name}  (${g.people} ${g.people > 1 ? 'people' : 'person'})`;
      const meta = [
        g.status === 'done' ? 'Invited ✓' : 'Pending',
        g.type,
        g.accommodation ? 'Needs stay' : null,
        g.conveyance ? 'Barat ride' : null
      ].filter(Boolean).join(' · ');

      const funcLines = doc.setFontSize(9).splitTextToSize('Functions: ' + funcs, pageW - 2 * M - 16);
      const metaLines = doc.splitTextToSize(meta, pageW - 2 * M - 16);
      newPageIfNeeded(16 + funcLines.length * 11 + metaLines.length * 11 + 6);

      doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(30);
      doc.text(line1, M + 8, y); y += 13;
      doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(110);
      metaLines.forEach(l => { doc.text(l, M + 8, y); y += 11; });
      doc.setTextColor(122, 31, 61);
      funcLines.forEach(l => { doc.text(l, M + 8, y); y += 11; });
      if (g.note) {
        const noteLines = doc.setTextColor(150).splitTextToSize('Note: ' + g.note, pageW - 2 * M - 16);
        newPageIfNeeded(noteLines.length * 11);
        noteLines.forEach(l => { doc.text(l, M + 8, y); y += 11; });
      }
      y += 6;
      doc.setDrawColor(235).line(M + 8, y - 3, pageW - M - 8, y - 3);
    });
    y += 14;
  });

  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(160);
    doc.text(`Page ${i} of ${pages}`, pageW / 2, pageH - 18, { align: 'center' });
  }

  doc.save(`wedding-guest-list-${new Date().toISOString().slice(0, 10)}.pdf`);
  toast('✓ PDF created');
});

/* =====================================================================
   ONE-TIME MIGRATION from v1 localStorage
   ===================================================================== */
async function maybeOfferMigration() {
  if (migrationChecked) return;
  migrationChecked = true;
  const raw = localStorage.getItem('wedding-guest-list-v1');
  if (!raw || state.guests.length > 0) return;
  let old;
  try { old = JSON.parse(raw); } catch { return; }
  if (!old || !Array.isArray(old.guests) || !old.guests.length) return;

  if (!await confirmDialog(
    `Found ${old.guests.length} guests saved on this device from the old version. Upload them into “${state.account?.name || 'this wedding'}”?`,
    { title: 'Import old data', okLabel: 'Upload' })) return;

  try {
    // Map old function ids → account function ids by name; add missing ones.
    let fns = [...state.functions];
    const idMap = {};
    (old.functions || []).forEach(f => {
      const match = fns.find(x => x.name.toLowerCase() === (f.name || '').toLowerCase());
      if (match) idMap[f.id] = match.id;
      else { const nid = store.rid(8); idMap[f.id] = nid; fns.push({ id: nid, name: f.name }); }
    });
    if (fns.length !== state.functions.length) await store.saveFunctions(session.accountId, fns);

    const guests = old.guests.map(({ id, ...g }) => ({
      ...g, functions: (g.functions || []).map(fid => idMap[fid]).filter(Boolean)
    }));
    await store.importGuests(session.accountId, guests, by());
    localStorage.setItem('wedding-guest-list-v1-archived', raw);
    localStorage.removeItem('wedding-guest-list-v1');
    toast(`✓ ${guests.length} guests uploaded to the cloud`);
  } catch (e) {
    console.error(e);
    toast('Import failed — your old data is untouched');
  }
}

/* =====================================================================
   SERVICE WORKER
   ===================================================================== */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
