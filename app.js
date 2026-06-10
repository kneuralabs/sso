const STORE_KEY    = 'kn-users-v3';
const OVERRIDE_KEY = 'kn-users-overrides-v1';
const DEFAULT_PW   = 'Kneuralabs@2026';

const $ = (id) => document.getElementById(id);

// Escape admin-entered strings (display names) before innerHTML insertion.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const APPS = [
  { id: 'portal',  name: 'Official Website' },
  { id: 'beacon',  name: 'Beacon' },
  { id: 'policy',  name: 'Handbook' },
  { id: 'days',    name: 'KneuraDAYS' },
  { id: 'sea',     name: 'SEA' },
  { id: 'scope',   name: 'KneuraSCOPE' },
  { id: 'lens',    name: 'KneuraLENS' },
  { id: 'audit',   name: 'KneurAUDIT' },
  { id: 'trax',    name: 'KneuraTRAX' },
  { id: 'comm',    name: 'KneuraCOMM' },
  { id: 'brand',   name: 'Brand' },
  { id: 'price',   name: 'KneuraPRICE' },
  { id: 'meet',    name: 'KneuraMEET' },
  { id: 'vigil',   name: 'Vigil' },
  { id: 'stratos', name: 'Stratos' },
  { id: 'nimbus',  name: 'Nimbus' },
  { id: 'pmo',     name: 'PMO' },
  { id: 'hire',    name: 'Hire' },
  { id: 'db',      name: 'PeopleBase' },
];

const USERS = {
  'admin':       { password: '2d7e38d6f21338fad753eb282c54b74c05b48f017674074fce9f33de583d60d4', name: 'Administrator', role: 'admin'    },
  'KN-2026-001': { password: '71b5dbfbb27c4799097fde2419b63e899746958d00a79584c65862e2434f8a90', name: 'Piyal Gupta',   role: 'employee' },
  'KN-2026-002': { password: '71b5dbfbb27c4799097fde2419b63e899746958d00a79584c65862e2434f8a90', name: 'Piyali Dhar',   role: 'employee' },
  'KN-2026-003': { password: '71b5dbfbb27c4799097fde2419b63e899746958d00a79584c65862e2434f8a90', name: 'Gautham Dhar',  role: 'employee' },
};

async function _sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function _readOverrides() {
  const legacy = localStorage.getItem(STORE_KEY);
  if (legacy !== null) {
    try { _writeOverrides(_diffOverrides(JSON.parse(legacy), false)); } catch {}
    localStorage.removeItem(STORE_KEY);
  }
  try { return JSON.parse(localStorage.getItem(OVERRIDE_KEY) || '{}') || {}; }
  catch { return {}; }
}
function _writeOverrides(ov) { localStorage.setItem(OVERRIDE_KEY, JSON.stringify(ov)); }

function _diffOverrides(u, detectDeletes = true) {
  const ov = {};
  for (const [id, rec] of Object.entries(u || {})) {
    const seed = USERS[id];
    if (!seed) { ov[id] = rec; continue; }
    const d = {};
    for (const k of ['password', 'name', 'role'])
      if (rec[k] !== seed[k]) d[k] = rec[k];
    if (JSON.stringify(rec.apps || []) !== JSON.stringify(seed.apps || [])) d.apps = rec.apps || [];
    if (Object.keys(d).length) ov[id] = d;
  }
  if (detectDeletes)
    for (const id of Object.keys(USERS))
      if (!(id in (u || {}))) ov[id] = { deleted: true };
  return ov;
}

function _loadUsers() {
  const out = JSON.parse(JSON.stringify(USERS));
  const ov  = _readOverrides();
  for (const [id, rec] of Object.entries(ov)) {
    if (rec && rec.deleted) { delete out[id]; continue; }
    out[id] = Object.assign(out[id] || {}, rec);
  }
  return out;
}

function _saveUsers(u) { _writeOverrides(_diffOverrides(u)); }

// ── Shared per-user app grants (Supabase) ───────────────────────────────────
// Stores each user's granted app ids in a shared backend so grants apply on
// every device, not just the browser where the admin set them. RLS allows
// anon read/write on this table only (no password data is exposed here).
const SB_URL = 'https://brysartqcjylgqwmnjkk.supabase.co';
const SB_KEY = 'sb_publishable_C5e5ViwIlW9dV14ZLi4O0A_ipIXhTB5';
const _sbHeaders = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };

// Fetch granted app ids for one user. Returns the array when a grant row
// exists, or null when there is no row / the backend is unreachable — letting
// callers fall back to the local copy instead of treating it as "zero apps".
async function _remoteGetApps(empId) {
  try {
    const r = await fetch(SB_URL + '/rest/v1/kn_app_access?select=apps&employee_id=eq.' + encodeURIComponent(empId), { headers: _sbHeaders });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!rows.length) return null;
    return Array.isArray(rows[0].apps) ? rows[0].apps : [];
  } catch { return null; }
}

// Fetch all users' grants as { empId: [appIds] }. Returns {} if unreachable.
async function _remoteGetAllApps() {
  try {
    const r = await fetch(SB_URL + '/rest/v1/kn_app_access?select=employee_id,apps', { headers: _sbHeaders });
    if (!r.ok) return {};
    const rows = await r.json();
    const out = {};
    for (const row of rows) out[row.employee_id] = Array.isArray(row.apps) ? row.apps : [];
    return out;
  } catch { return {}; }
}

// Upsert a user's granted app ids.
async function _remoteSetApps(empId, apps) {
  try {
    await fetch(SB_URL + '/rest/v1/kn_app_access?on_conflict=employee_id', {
      method: 'POST',
      headers: { ..._sbHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ employee_id: empId, apps, updated_at: new Date().toISOString() }),
    });
  } catch {}
}

async function _remoteDeleteApps(empId) {
  try {
    await fetch(SB_URL + '/rest/v1/kn_app_access?employee_id=eq.' + encodeURIComponent(empId), { method: 'DELETE', headers: _sbHeaders });
  } catch {}
}

// One-time migration: push any grants that exist only in this admin browser's
// localStorage up to the shared backend, for users that have no row yet. This
// recovers pre-Supabase selections automatically — no manual re-save needed.
async function _syncLocalGrantsToRemote() {
  const users  = _loadUsers();
  const remote = await _remoteGetAllApps();
  for (const [id, u] of Object.entries(users)) {
    if (id === 'admin') continue;
    if (Array.isArray(u.apps) && u.apps.length && !(id in remote))
      await _remoteSetApps(id, u.apps);
  }
}

// Only these origins may receive an SSO auth token (redirect or postMessage).
// Prevents open-redirect token exfiltration and cross-origin postMessage leaks.
function _isTrustedOrigin(origin) {
  try {
    const u = new URL(origin);
    if (u.origin === location.origin) return true;
    if (u.protocol === 'https:' &&
        (u.hostname === 'kneuralabs.com' || u.hostname.endsWith('.kneuralabs.com'))) return true;
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true; // local dev
    return false;
  } catch { return false; }
}

// UTF-8-safe base64: btoa() only accepts Latin1 (code points 0-255) and throws
// on names containing non-Latin scripts or emoji, which silently aborts redirect.
function _encodeAuth(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

let currentID = '';
let currentPw = '';

const _params     = new URLSearchParams(window.location.search);
const redirectUrl = _params.get('redirect') || _params.get('next') || _params.get('returnUrl') || _params.get('continue') || '';

const _ssoChannel = new BroadcastChannel('kn-sso-close');
_ssoChannel.onmessage = () => _closeThisTab();

(function initTheme() {
  const stored = localStorage.getItem('kn-theme');
  const h = new Date().getHours();
  const theme = stored || ((h >= 6 && h < 18) ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeMeta(theme);
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('theme-ready')));
})();

function updateThemeMeta(t) {
  const m = $('theme-color-meta');
  if (m) m.content = t === 'dark' ? '#050c18' : '#0D2E5A';
}

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('kn-theme', next);
  updateThemeMeta(next);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = $(id);
  if (el) el.classList.add('active');
  clearErrors();
  if (id === 's-admin') renderAdminAppGrid([]);
}

function renderAdminAppGrid(checkedIds) {
  const grid = $('admin-app-grid');
  if (!grid) return;
  grid.innerHTML = APPS.map(a =>
    `<label class="app-check-item">
      <input type="checkbox" id="admin-app-${a.id}"${checkedIds.includes(a.id) ? ' checked' : ''}>
      <span>${escapeHtml(a.name)}</span>
    </label>`
  ).join('');
}

function setAllApps(on) {
  const btn = $('app-select-toggle');
  if (btn) { btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', String(on)); }
  APPS.forEach(a => { const el = $('admin-app-' + a.id); if (el) el.checked = on; });
}

function toggleAllApps(btn) { setAllApps(!btn.classList.contains('on')); }
function adminSelectAllApps()   { setAllApps(true); }
function adminDeselectAllApps() { setAllApps(false); }

function adminPrefillUser() {
  const id = $('admin-new-id').value.trim().toUpperCase();
  if (!validEmpID(id)) return;
  const users = _loadUsers();
  const user  = users[id];
  if (!user) return;
  $('admin-new-name').value = user.name || '';
  renderAdminAppGrid(user.apps || []);
}

function clearErrors() {
  document.querySelectorAll('.errmsg').forEach(e => e.classList.remove('show'));
  document.querySelectorAll('input.err').forEach(e => e.classList.remove('err'));
}

function fmtID(el) {
  if (el.value.toLowerCase().startsWith('a'))
    el.value = el.value.toLowerCase().replace(/[^a-z]/g, '');
  else
    el.value = el.value.toUpperCase().replace(/[^KN0-9\-]/g, '');
}

function fmtEmpID(el) {
  el.value = el.value.toUpperCase().replace(/[^KN0-9\-]/g, '');
}

function validEmpID(v) { return /^KN-\d{4}-\d{3}$/.test(v); }
function validID(v)    { return v === 'admin' || validEmpID(v); }

function checkID() {
  const raw   = $('emp-id').value.trim();
  const v     = raw.toLowerCase() === 'admin' ? 'admin' : raw.toUpperCase();
  const errEl = $('err-id');
  if (!validID(v)) {
    errEl.textContent = 'Enter a valid Employee ID (KN-YYYY-NNN)';
    errEl.classList.add('show');
    $('emp-id').classList.add('err');
    return;
  }
  currentID = v;
  $('pw-who').textContent = v;
  $('pw-input').value = '';
  showScreen('s-pw');
  setTimeout(() => $('pw-input').focus(), 100);
}

async function checkPW() {
  const pw    = $('pw-input').value;
  const errEl = $('err-pw');
  const btn   = document.querySelector('#s-pw .btn-primary');
  btn.disabled = true; btn.textContent = 'Verifying…';
  const users = _loadUsers();
  const user  = users[currentID];
  const hash  = await _sha256(pw);
  if (!user || user.password !== hash) {
    errEl.classList.add('show');
    $('pw-input').classList.add('err');
    $('pw-input').focus();
    btn.disabled = false; btn.textContent = 'Sign in';
    return;
  }
  errEl.classList.remove('show');
  currentPw = pw;
  btn.disabled = false; btn.textContent = 'Sign in';
  // App grants live in the shared backend so they apply on any device. Fall
  // back to the local copy only if the backend is unreachable.
  let _apps = user.role === 'admin' ? [] : await _remoteGetApps(currentID);
  if (_apps === null) _apps = user.apps || [];
  const _authPayload = {id:currentID,name:user.name,role:user.role,apps:_apps};
  if (redirectUrl === 'postmessage') {
    // Target the embedding parent's origin explicitly — never '*'.
    const parentOrigin = _params.get('origin') || (document.referrer ? new URL(document.referrer).origin : '');
    if (!_isTrustedOrigin(parentOrigin)) { showToast('This site is not authorised to receive sign-in.', 'err'); return; }
    window.parent.postMessage({type:'kn-auth', ..._authPayload}, parentOrigin);
    return;
  }
  if (redirectUrl) {
    const _rDest = new URL(redirectUrl, location.href);
    if (!_isTrustedOrigin(_rDest.origin)) { showToast('Sign-in destination is not authorised.', 'err'); return; }
    _rDest.searchParams.set('kn-auth', _encodeAuth(_authPayload));
    location.replace(_rDest.toString());
    return;
  }
  if (user.role === 'admin') {
    await _syncLocalGrantsToRemote();
    refreshUserList();
    showScreen('s-admin');
  } else {
    $('dash-name').textContent = 'Welcome, ' + user.name + '.';
    $('dash-id').textContent   = currentID;
    showScreen('s-dash');
    showToast('Signed in successfully ✓', 'ok');
  }
}

// Shared password-change flow. Requires the account's OWN current password —
// the former admin-password fallback was a pre-auth backdoor: anyone knowing
// the admin password could take over any account from the public screen.
async function _submitPasswordChange(ids, afterSave) {
  const oldPw  = $(ids.oldPw).value;
  const newPw  = $(ids.newPw).value;
  const confPw = $(ids.confPw).value;
  if (newPw !== confPw) { $(ids.errConf).classList.add('show'); return; }
  if (newPw.length < 8) { showToast('Password must be at least 8 characters.', 'err'); return; }
  const users   = _loadUsers();
  const user    = users[currentID];
  const oldHash = await _sha256(oldPw);
  if (!user || user.password !== oldHash) {
    $(ids.errOld).classList.add('show'); return;
  }
  user.password = await _sha256(newPw);
  _saveUsers(users);
  currentPw = newPw;
  if (afterSave) afterSave(user);
  showScreen('s-dash');
  showToast('Password updated ✓', 'ok');
}

function changePassword() {
  return _submitPasswordChange(
    { oldPw: 'old-pw', newPw: 'new-pw', confPw: 'conf-pw', errOld: 'err-old', errConf: 'err-conf' },
    (user) => {
      $('dash-name').textContent = 'Welcome, ' + (user.name || currentID) + '.';
      $('dash-id').textContent   = currentID;
    });
}

function changeSelfPassword() {
  return _submitPasswordChange(
    { oldPw: 'self-old-pw', newPw: 'self-new-pw', confPw: 'self-conf-pw', errOld: 'err-self-old', errConf: 'err-self-conf' });
}

async function refreshUserList() {
  const users  = _loadUsers();
  const remote = await _remoteGetAllApps();
  for (const id of Object.keys(users))
    if (id !== 'admin' && remote[id]) users[id].apps = remote[id];
  const el    = $('user-list');
  const rows  = Object.entries(users).filter(([id]) => id !== 'admin');
  if (!rows.length) { el.innerHTML = '<div style="font-size:.82rem;color:var(--text-muted)">No users yet.</div>'; return; }
  el.innerHTML = rows.map(([id, u]) => {
    const appCount = Array.isArray(u.apps) ? u.apps.length : 0;
    const appLabel = appCount === 0 ? 'No apps' : appCount + ' app' + (appCount !== 1 ? 's' : '');
    return `<div class="user-row" role="listitem">
      <span style="display:flex;flex-direction:column;gap:2px">
        <span>${escapeHtml(id)}</span>
        <span style="font-size:.6875rem;color:var(--text-muted)">${escapeHtml(u.name || '—')}</span>
      </span>
      <span style="display:flex;align-items:center;gap:.5rem">
        <span class="app-count-badge" title="${escapeHtml(appCount > 0 ? (u.apps || []).join(', ') : 'No application access')}" style="cursor:default">${appLabel}</span>
        <button onclick="adminEditUser('${id}')" style="background:none;border:none;cursor:pointer;color:var(--accent);font-size:.75rem;font-weight:600;font-family:var(--font);padding:2px 6px;border-radius:4px;line-height:1" title="Edit user">✎</button>
        <button onclick="adminReset('${id}')" style="background:none;border:none;cursor:pointer;color:var(--kn-slate);font-size:.75rem;font-weight:600;font-family:var(--font);padding:2px 6px;border-radius:4px;line-height:1" title="Reset to default password">↺</button>
        <button onclick="adminDelete('${id}')" style="background:none;border:none;cursor:pointer;color:var(--kn-red);font-size:.75rem;font-weight:600;font-family:var(--font);padding:2px 6px;border-radius:4px;line-height:1" title="Delete user">✕</button>
      </span>
    </div>`;
  }).join('');
}

async function adminCreate() {
  const id   = $('admin-new-id').value.trim().toUpperCase();
  const name = $('admin-new-name').value.trim();
  if (!validEmpID(id)) { showToast('Enter a valid Employee ID.', 'err'); return; }
  const selectedApps = APPS.filter(a => $('admin-app-' + a.id)?.checked).map(a => a.id);
  const users = _loadUsers();
  const existing = users[id];
  users[id] = {
    password: existing ? existing.password : await _sha256(DEFAULT_PW),
    name: name || id,
    role: 'employee',
    apps: selectedApps,
  };
  _saveUsers(users);
  await _remoteSetApps(id, selectedApps);
  $('admin-new-id').value   = '';
  $('admin-new-name').value = '';
  adminDeselectAllApps();
  refreshUserList();
  showToast('User saved ✓', 'ok');
}

async function adminDelete(empId) {
  const users = _loadUsers();
  delete users[empId];
  _saveUsers(users);
  await _remoteDeleteApps(empId);
  refreshUserList();
  showToast('Deleted ' + empId + ' ✓', 'ok');
}

async function adminEditUser(empId) {
  const users = _loadUsers();
  const user  = users[empId];
  if (!user) return;
  $('admin-new-id').value   = empId;
  $('admin-new-name').value = user.name || '';
  const remote = await _remoteGetApps(empId);
  renderAdminAppGrid(remote || user.apps || []);
  $('admin-new-id').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  $('admin-new-name').focus();
}

async function adminReset(empId) {
  const users = _loadUsers();
  if (!users[empId]) { showToast('User not found.', 'err'); return; }
  users[empId].password = await _sha256(DEFAULT_PW);
  _saveUsers(users);
  showToast('Password reset to default for ' + empId + ' ✓', 'ok');
}

function doClose() {
  _ssoChannel.postMessage('close');
  _closeThisTab();
}

function _closeThisTab() {
  window.close();
  setTimeout(() => {
    if (window.closed) return;
    window.location.replace('about:blank');
    setTimeout(() => {
      ['btn-close-dash','btn-close-admin'].forEach(id => {
        const btn = $(id);
        if (!btn) return;
        btn.textContent = 'You may close this tab';
        btn.disabled = false;
        btn.onclick = () => window.location.replace('about:blank');
      });
    }, 300);
  }, 300);
}

function togglePw(id, btn) {
  const el = $(id);
  if (el.type === 'password') { el.type = 'text';     btn.textContent = 'Hide'; }
  else                        { el.type = 'password'; btn.textContent = 'Show'; }
}

function strengthScore(v) {
  let s = 0;
  if (v.length >= 8) s++;
  if (/[A-Z]/.test(v)) s++;
  if (/[0-9]/.test(v)) s++;
  if (/[^A-Za-z0-9]/.test(v)) s++;
  return s;
}

function applyStrength(v, fillId, labelId) {
  const colors = ['#C8281E','#D97706','#16A34A','#1C5CAA'];
  const labels = ['Weak','Fair','Good','Strong'];
  const fill   = $(fillId);
  const label  = $(labelId);
  if (!v) { fill.style.width = '0%'; label.textContent = ''; return; }
  const s = strengthScore(v);
  fill.style.width      = (s * 25) + '%';
  fill.style.background = colors[Math.max(s - 1, 0)];
  label.textContent     = labels[Math.max(s - 1, 0)];
  label.style.color     = colors[Math.max(s - 1, 0)];
}

function checkStrength(v)  { applyStrength(v, 'str-fill',  'str-label'); }
function checkStrength2(v) { applyStrength(v, 'str-fill2', 'str-label2'); }

let toastTimer;
function showToast(msg, type) {
  const t = $('toast');
  t.textContent = msg;
  t.className   = 'toast show' + (type === 'err' ? ' err-t' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}
