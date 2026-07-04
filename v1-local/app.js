/* ===================================================================
   Wedding Guest List — vanilla JS, localStorage, offline PWA
   Data model:
     state = {
       functions: [ { id, name } ],
       guests: [ {
         id, city, name, people, note,
         type: "WhatsApp + Call" | "In-Person Card",
         status: "done" | "pending",
         functions: [functionId, ...],      // invited-to
         accommodation: bool,
         conveyance: bool
       } ]
     }
   =================================================================== */

const STORAGE_KEY = 'wedding-guest-list-v1';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      s.functions = Array.isArray(s.functions) ? s.functions : [];
      s.guests = Array.isArray(s.guests) ? s.guests : [];
      return s;
    }
  } catch (e) { console.warn('Load failed', e); }
  // Sensible starter set of functions for a typical wedding
  return {
    functions: ['Mehendi', 'Haldi', 'Barat', 'Niqqah', 'Reception'].map(n => ({ id: uid(), name: n })),
    guests: []
  };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('⚠️ Could not save — storage may be full');
  }
}

/* ---------- tiny helpers ---------- */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const funcName = id => (state.functions.find(f => f.id === id) || {}).name || '';

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

/* =====================================================================
   NAVIGATION
   ===================================================================== */
function showView(name) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  $$('.tab[data-view]').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  window.scrollTo(0, 0);
  if (name === 'dashboard') renderDashboard();
  if (name === 'guests') renderGuests();
  if (name === 'functions') renderFunctions();
}
$$('.tab[data-view]').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));

/* =====================================================================
   DASHBOARD
   ===================================================================== */
function renderDashboard() {
  const g = state.guests;
  const totalPeople = g.reduce((s, x) => s + (x.people || 0), 0);
  const done = g.filter(x => x.status === 'done');
  const donePeople = done.reduce((s, x) => s + (x.people || 0), 0);
  void donePeople;
  const accom = g.filter(x => x.accommodation).reduce((s, x) => s + (x.people || 0), 0);
  const convey = g.filter(x => x.conveyance).reduce((s, x) => s + (x.people || 0), 0);

  $('#statGuests').textContent = g.length;
  $('#statPeople').textContent = totalPeople;
  $('#statAccom').textContent = accom;
  $('#statConvey').textContent = convey;

  const doneCount = done.length;
  const pending = g.length - doneCount;
  $('#statDone').textContent = doneCount;
  $('#statPending').textContent = pending;
  $('#progressLabel').textContent = `${doneCount} / ${g.length}`;
  const pct = g.length ? Math.round((doneCount / g.length) * 100) : 0;
  $('#progressFill').style.width = pct + '%';

  $('#headerCount').textContent = g.length ? `${g.length} families · ${totalPeople} people` : '';

  // People per function
  const fEl = $('#dashFunctions');
  if (!state.functions.length) {
    fEl.innerHTML = '<p class="empty-mini">No functions yet — add some in Events.</p>';
  } else {
    fEl.innerHTML = state.functions.map(f => {
      const ppl = g.filter(x => (x.functions || []).includes(f.id)).reduce((s, x) => s + (x.people || 0), 0);
      const fam = g.filter(x => (x.functions || []).includes(f.id)).length;
      return `<div class="dash-row"><span class="name">${esc(f.name)}</span>
        <span class="val">${ppl} ppl · ${fam} fam</span></div>`;
    }).join('');
  }

  // People per city
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
$('#filterToggle').addEventListener('click', () => {
  const p = $('#filtersPanel');
  p.hidden = !p.hidden;
});
$('#fCity').addEventListener('change', e => { filters.city = e.target.value; renderGuests(); });
$('#fFunction').addEventListener('change', e => { filters.func = e.target.value; renderGuests(); });
$('#fStatus').addEventListener('change', e => { filters.status = e.target.value; renderGuests(); });
$('#fType').addEventListener('change', e => { filters.type = e.target.value; renderGuests(); });
$('#fAccom').addEventListener('change', e => { filters.accom = e.target.value; renderGuests(); });
$('#fConvey').addEventListener('change', e => { filters.convey = e.target.value; renderGuests(); });
$('#clearFilters').addEventListener('click', () => {
  filters.city = filters.func = filters.status = filters.type = filters.accom = filters.convey = '';
  ['#fCity', '#fFunction', '#fStatus', '#fType', '#fAccom', '#fConvey'].forEach(s => { $(s).value = ''; });
  renderGuests();
});

function refreshFilterOptions() {
  // Cities
  const cities = [...new Set(state.guests.map(g => (g.city || '').trim()).filter(Boolean))].sort();
  const cs = $('#fCity');
  const cur = cs.value;
  cs.innerHTML = '<option value="">All</option>' + cities.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  cs.value = cur;
  $('#cityList').innerHTML = cities.map(c => `<option value="${esc(c)}">`).join('');
  // Functions
  const fs = $('#fFunction');
  const curF = fs.value;
  fs.innerHTML = '<option value="">All</option>' + state.functions.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
  fs.value = curF;
}

function activeFilterCount() {
  return ['city', 'func', 'status', 'type', 'accom', 'convey'].filter(k => filters[k]).length;
}

function renderGuests() {
  refreshFilterOptions();
  const badge = $('#filterBadge');
  const n = activeFilterCount();
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
    return `<div class="guest-card" data-id="${g.id}">
      <div class="gc-top">
        <div>
          <div class="gc-name">${esc(g.name)}</div>
          <div class="gc-city">📍 ${esc(g.city || '—')}</div>
        </div>
        <div class="gc-people">${g.people} ppl</div>
      </div>
      <div class="gc-tags">
        <span class="tag ${g.status === 'done' ? 'done' : 'pending'}">${g.status === 'done' ? '✓ Done' : '◷ Not Yet'}</span>
        <span class="tag info">${esc(g.type)}</span>
        ${g.accommodation ? '<span class="tag info">🏨 Stay</span>' : ''}
        ${g.conveyance ? '<span class="tag info">🚗 Barat ride</span>' : ''}
        ${funcTags}
      </div>
      ${g.note ? `<div class="gc-note">“${esc(g.note)}”</div>` : ''}
    </div>`;
  }).join('');

  $$('#guestList .guest-card').forEach(c =>
    c.addEventListener('click', () => openGuest(c.dataset.id)));
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

  // Functions checkboxes
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

  refreshCityList();
  $('#guestModal').hidden = false;
}

function refreshCityList() {
  const cities = [...new Set(state.guests.map(g => (g.city || '').trim()).filter(Boolean))].sort();
  $('#cityList').innerHTML = cities.map(c => `<option value="${esc(c)}">`).join('');
}

function setSeg(sel, val) {
  $$(sel + ' button').forEach(b => b.classList.toggle('active', b.dataset.val === val));
}
function getSeg(sel) {
  const a = $(sel + ' button.active');
  return a ? a.dataset.val : null;
}
$$('.seg').forEach(seg => seg.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  seg.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
}));

/* people stepper + solo */
$('#peopleMinus').addEventListener('click', () => { stepPeople(-1); });
$('#peoplePlus').addEventListener('click', () => { stepPeople(1); });
$('#gPeople').addEventListener('input', syncSolo);
function stepPeople(d) {
  const inp = $('#gPeople');
  inp.value = Math.max(1, (parseInt(inp.value) || 1) + d);
  syncSolo();
}
$('#soloBtn').addEventListener('click', () => {
  $('#gPeople').value = 1;
  syncSolo();
});
function syncSolo() {
  const solo = (parseInt($('#gPeople').value) || 1) === 1;
  $('#soloBtn').classList.toggle('active', solo);
}

function closeModal() { $('#guestModal').hidden = true; editingId = null; }
$('#guestCancel').addEventListener('click', closeModal);
$('#guestModal').addEventListener('click', e => { if (e.target.id === 'guestModal') closeModal(); });
$('#addGuestTab').addEventListener('click', () => openGuest(null));

$('#guestSave').addEventListener('click', () => {
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
    const g = state.guests.find(x => x.id === editingId);
    Object.assign(g, data);
    toast('✓ Guest updated');
  } else {
    state.guests.push({ id: uid(), ...data });
    toast('✓ Guest added');
  }
  save();
  closeModal();
  renderGuests();
});

$('#guestDelete').addEventListener('click', () => {
  if (!editingId) return;
  const g = state.guests.find(x => x.id === editingId);
  if (confirm(`Delete "${g ? g.name : 'this guest'}"? This cannot be undone.`)) {
    state.guests = state.guests.filter(x => x.id !== editingId);
    save();
    closeModal();
    renderGuests();
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
    if (v) { f.name = v; save(); }
    renderFunctions();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') renderFunctions();
  });
}

function deleteFunction(id) {
  const f = state.functions.find(x => x.id === id);
  const used = state.guests.filter(g => (g.functions || []).includes(id)).length;
  const msg = used
    ? `Delete "${f.name}"? It will be removed from ${used} guest(s).`
    : `Delete "${f.name}"?`;
  if (!confirm(msg)) return;
  state.functions = state.functions.filter(x => x.id !== id);
  state.guests.forEach(g => { g.functions = (g.functions || []).filter(fid => fid !== id); });
  save();
  renderFunctions();
  toast('Function deleted');
}

$('#addFunctionBtn').addEventListener('click', addFunction);
$('#newFunctionInput').addEventListener('keydown', e => { if (e.key === 'Enter') addFunction(); });
function addFunction() {
  const inp = $('#newFunctionInput');
  const name = inp.value.trim();
  if (!name) return;
  if (state.functions.some(f => f.name.toLowerCase() === name.toLowerCase())) {
    toast('That function already exists');
    return;
  }
  // New function => simply not present in any guest.functions => "Not Invited" everywhere.
  state.functions.push({ id: uid(), name });
  inp.value = '';
  save();
  renderFunctions();
  toast('✓ Function added');
}

/* =====================================================================
   EXPORT / IMPORT (JSON sync)
   ===================================================================== */
$('#exportJsonBtn').addEventListener('click', () => {
  const payload = { app: 'wedding-guest-list', version: 1, exportedAt: new Date().toISOString(), data: state };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `guest-list-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('✓ Exported — now share the file');
});

$('#importJsonBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const incoming = parsed.data || parsed; // accept raw state too
      if (!incoming || !Array.isArray(incoming.guests) || !Array.isArray(incoming.functions)) {
        throw new Error('bad shape');
      }
      const replace = confirm(
        `Import ${incoming.guests.length} guests & ${incoming.functions.length} functions.\n\n` +
        `Press OK to REPLACE all current data.\n` +
        `Press Cancel to MERGE with your existing data.`
      );
      if (replace) {
        state = incoming;
      } else {
        mergeData(incoming);
      }
      save();
      showView('dashboard');
      toast(replace ? '✓ Data replaced' : '✓ Data merged');
    } catch (err) {
      alert('Could not import: the file is not a valid guest-list export.');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

function mergeData(incoming) {
  // Merge functions by name (case-insensitive); build a map old-id -> resulting-id
  const idMap = {};
  incoming.functions.forEach(f => {
    const existing = state.functions.find(x => x.name.toLowerCase() === (f.name || '').toLowerCase());
    if (existing) {
      idMap[f.id] = existing.id;
    } else {
      const nid = uid();
      idMap[f.id] = nid;
      state.functions.push({ id: nid, name: f.name });
    }
  });
  // Merge guests; de-dupe on name+city, otherwise add (remapping function ids)
  incoming.guests.forEach(g => {
    const remapped = (g.functions || []).map(fid => idMap[fid] || fid).filter(id => state.functions.some(f => f.id === id));
    const dup = state.guests.find(x =>
      (x.name || '').toLowerCase() === (g.name || '').toLowerCase() &&
      (x.city || '').toLowerCase() === (g.city || '').toLowerCase());
    if (dup) {
      Object.assign(dup, g, { id: dup.id, functions: remapped });
    } else {
      state.guests.push({ ...g, id: uid(), functions: remapped });
    }
  });
}

$('#clearAllBtn').addEventListener('click', () => {
  if (!confirm('Delete ALL guests and functions permanently? Export a backup first if unsure.')) return;
  if (!confirm('Are you absolutely sure? This cannot be undone.')) return;
  state = { functions: [], guests: [] };
  save();
  showView('dashboard');
  toast('All data deleted');
});

/* =====================================================================
   PDF EXPORT  (grouped by city)
   ===================================================================== */
$('#exportPdfBtn').addEventListener('click', () => {
  if (!window.jspdf) { toast('PDF library still loading — try again'); return; }
  if (!state.guests.length) { toast('No guests to export'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const M = 40;                  // margin
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = M;

  const newPageIfNeeded = h => { if (y + h > pageH - M) { doc.addPage(); y = M; } };

  // Title
  doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(122, 31, 61);
  doc.text('Wedding Guest List', M, y); y += 24;
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(120);
  const totalPeople = state.guests.reduce((s, x) => s + (x.people || 0), 0);
  doc.text(`${state.guests.length} families · ${totalPeople} people · generated ${new Date().toLocaleDateString()}`, M, y);
  y += 22;

  // Group by city
  const byCity = {};
  state.guests.forEach(g => {
    const c = (g.city || 'Unknown').trim() || 'Unknown';
    (byCity[c] = byCity[c] || []).push(g);
  });
  const cities = Object.keys(byCity).sort();

  cities.forEach(city => {
    const guests = byCity[city].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const cityPeople = guests.reduce((s, x) => s + (x.people || 0), 0);

    newPageIfNeeded(40);
    // City heading
    doc.setFillColor(122, 31, 61);
    doc.rect(M, y - 12, pageW - 2 * M, 22, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(255);
    doc.text(`${city}`, M + 8, y + 3);
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

      // wrap function text
      const funcLines = doc.setFontSize(9).splitTextToSize('Functions: ' + funcs, pageW - 2 * M - 16);
      const metaLines = doc.splitTextToSize(meta, pageW - 2 * M - 16);
      const blockH = 16 + funcLines.length * 11 + metaLines.length * 11 + 6;
      newPageIfNeeded(blockH);

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

  // Page numbers
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
   INIT
   ===================================================================== */
showView('dashboard');

/* Register service worker for offline use */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
