/* ═══════════════════════════════════════════════════════════════
   Agentry Remote — mobile companion (prototype, mock daemon)
   Shares wire vocabulary with desktop: status queued|starting|running
   |finished|failed, activity working|idle|awaiting_input.
   ═══════════════════════════════════════════════════════════════ */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const now = () => Date.now();
const LS = { ntf: 'agentry.remote.ntf', lastProj: 'agentry.remote.lastProj' };
const TAILNET_HOST = 'dev-macbook';   // tailnet machine name; Tailscale carries identity

/* ── mock data ─────────────────────────────────────────────── */
const PROJECTS = [
  { id: 'p1', name: 'api-server',     path: '~/code/api-server' },
  { id: 'p2', name: 'web-dashboard',  path: '~/code/web-dashboard' },
  { id: 'p3', name: 'infra-scripts',  path: '~/work/infra-scripts' },
];
const PROFILES = [
  { id: 'pr1', name: 'Claude default', agent: 'claude',   def: true },
  { id: 'pr2', name: 'Codex review',   agent: 'codex',     def: false },
  { id: 'pr3', name: 'OpenCode',       agent: 'opencode',  def: false },
];

const T = (mins) => now() - mins * 60000;
let SESSIONS = [
  { id: 's1', title: 'fix-auth-flow', agent: 'claude', project: 'p1',
    status: 'running', activity: 'awaiting_input', since: T(34), waitSince: T(12),
    unread: 3,
    question: 'Run `npm run db:migrate` against production? (y/n)',
    log: [
      ['dim', '$ claude --resume fix-auth-flow'],
      ['', 'Analyzing auth middleware in src/auth/...'],
      ['grn', '✓ Found token expiry bug — using `<` instead of `<=`'],
      ['', 'Patched src/auth/jwt.ts (line 88).'],
      ['', 'The fix touches the production session table. To apply it I need'],
      ['', 'to run the pending migration.'],
      ['q', '? Run `npm run db:migrate` against production? (y/n) ▋'],
    ] },
  { id: 's2', title: 'add-export-csv', agent: 'codex', project: 'p2',
    status: 'running', activity: 'awaiting_input', since: T(52), waitSince: T(31),
    unread: 1,
    question: 'Which library for CSV? [1] papaparse  [2] csv-stringify',
    log: [
      ['dim', '$ codex add-export-csv'],
      ['', 'Implementing CSV export for the reports table.'],
      ['', 'Two libraries fit; they differ in bundle size and streaming.'],
      ['q', '? Pick a CSV library:'],
      ['q', '  [1] papaparse      (12kb, no streaming)'],
      ['q', '  [2] csv-stringify  (streaming, +deps)  ▋'],
    ] },
  { id: 's3', title: 'refactor-router', agent: 'claude', project: 'p1',
    status: 'running', activity: 'working', since: T(8), waitSince: null, unread: 0,
    log: [
      ['dim', '$ claude refactor-router'],
      ['', 'Splitting the monolith router into feature modules…'],
      ['blu', '→ editing src/routes/index.ts'],
      ['blu', '→ creating src/routes/billing.ts'],
      ['', 'Running type-check… ▋'],
    ] },
  { id: 's4', title: 'bump-deps', agent: 'opencode', project: 'p3',
    status: 'running', activity: 'working', since: T(3), waitSince: null, unread: 0,
    log: [
      ['dim', '$ opencode bump-deps'],
      ['', 'Resolving dependency tree…'],
      ['', 'Updating 14 packages ▋'],
    ] },
  { id: 's5', title: 'gen-openapi-spec', agent: 'codex', project: 'p2',
    status: 'finished', activity: 'idle', since: T(78), waitSince: null, unread: 0,
    exit: 0, finishedAt: T(2),
    log: [
      ['dim', '$ codex gen-openapi-spec'],
      ['', 'Generated openapi.yaml from route handlers.'],
      ['grn', '✓ 23 endpoints documented.'],
      ['grn', '■ Done · exit 0'],
    ] },
  { id: 's6', title: 'flaky-test-hunt', agent: 'claude', project: 'p1',
    status: 'failed', activity: 'idle', since: T(95), waitSince: null, unread: 1,
    exit: 1, finishedAt: T(6), failReason: 'Test suite timed out after 600s',
    log: [
      ['dim', '$ claude flaky-test-hunt'],
      ['', 'Running the suite 50× to catch the flake…'],
      ['red', '✗ Suite timed out after 600s'],
      ['red', '✗ Failed · exit 1'],
    ] },
];

/* ── state ─────────────────────────────────────────────────── */
const state = {
  view: 'home',
  conn: 'connected',       // connected | reconnecting | daemon-down | tailnet-down
  snapshotAt: null,        // when offline froze
  filter: 'all',           // project id or 'all'
  openSession: null,
  ntf: JSON.parse(localStorage.getItem(LS.ntf) || '{"await":true,"failed":true,"finished":false}'),
};
const timers = new Set();

/* ── helpers ───────────────────────────────────────────────── */
const projName = (id) => (PROJECTS.find(p => p.id === id) || {}).name || '—';
const projPath = (id) => (PROJECTS.find(p => p.id === id) || {}).path || '';
const isLive = (s) => ['queued', 'starting', 'running'].includes(s.status);
const isAwait = (s) => s.status === 'running' && s.activity === 'awaiting_input';

function fmtAgo(ts) {
  if (!ts) return '';
  const m = Math.floor((now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}
function fmtClock(ts) {
  const d = new Date(ts);
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.hidden = true; }, 2200);
}

/* ── view routing ──────────────────────────────────────────── */
function show(view) {
  state.view = view;
  $$('.view').forEach(v => { v.hidden = true; });
  $('#view-' + view).hidden = false;
}

/* ── home render ───────────────────────────────────────────── */
function visibleSessions() {
  return state.filter === 'all' ? SESSIONS : SESSIONS.filter(s => s.project === state.filter);
}

function renderFilters() {
  const row = $('#filter-row');
  const counts = {};
  SESSIONS.forEach(s => { if (isLive(s)) counts[s.project] = (counts[s.project] || 0) + 1; });
  const liveTotal = SESSIONS.filter(isLive).length;
  let html = `<button class="fchip ${state.filter === 'all' ? 'on' : ''}" data-f="all">All<span class="fchip-n">${liveTotal}</span></button>`;
  PROJECTS.forEach(p => {
    const n = counts[p.id] || 0;
    if (n === 0 && !SESSIONS.some(s => s.project === p.id)) return;
    html += `<button class="fchip ${state.filter === p.id ? 'on' : ''}" data-f="${p.id}">${p.name}${n ? `<span class="fchip-n">${n}</span>` : ''}</button>`;
  });
  // only show filters when >1 project has sessions
  const projWithSess = new Set(SESSIONS.map(s => s.project)).size;
  row.hidden = projWithSess <= 1;
  row.innerHTML = html;
}

function sessionCard(s) {
  const awaiting = isAwait(s);
  const unread = s.unread > 0 ? `<span class="scard-unread">${s.unread}</span>` : '';

  // ── Tier 1: "needs you" — loud card. Wait time is the headline signal. ──
  if (awaiting) {
    const wm = Math.floor((now() - s.waitSince) / 60000);
    return `<button class="scard scard-await" data-sid="${s.id}">
      <div class="scard-top">
        <span class="agent-dot" data-agent="${s.agent}"></span>
        <span class="scard-title">${s.title}</span>
        ${unread}
        <span class="wait-chip ${wm >= 15 ? 'long' : ''}">
          <svg width="11" height="11"><use href="#i-clock"/></svg>${fmtAgo(s.waitSince)}
        </span>
      </div>
      ${s.question ? `<div class="scard-q">${s.question}</div>` : ''}
      <div class="scard-foot">
        <span class="scard-foot-meta">${s.agent} · ${projName(s.project)}</span>
        <span class="scard-reply">Reply <svg width="12" height="12"><use href="#i-corner"/></svg></span>
      </div>
    </button>`;
  }

  // ── Tier 2: quiet rows (running / queued / recent) ──
  let badge, badgeCls, meta = '';
  if (s.status === 'running') { badge = 'running'; badgeCls = 'running'; meta = `running ${fmtAgo(s.since)}`; }
  else if (s.status === 'queued') { badge = 'queued'; badgeCls = 'queued'; }
  else if (s.status === 'starting') { badge = 'starting'; badgeCls = 'starting'; }
  else if (s.status === 'finished') { badge = 'done'; badgeCls = 'finished'; meta = `done ${fmtAgo(s.finishedAt)} ago · exit ${s.exit}`; }
  else { badge = 'failed'; badgeCls = 'failed'; meta = s.failReason || ''; }

  return `<button class="scard scard-quiet ${s.status === 'failed' ? 'scard-failed' : ''}" data-sid="${s.id}">
    <div class="scard-top">
      <span class="agent-dot" data-agent="${s.agent}"></span>
      <span class="scard-title">${s.title}</span>
      ${unread}
      <span class="badge badge-${badgeCls}">${badge}</span>
    </div>
    <div class="scard-meta">
      <span>${s.agent}</span><span class="meta-sep">·</span>
      <span>${projName(s.project)}</span>
      ${meta ? `<span class="meta-sep">·</span><span class="${s.status === 'failed' ? 'scard-fail-reason' : ''}">${meta}</span>` : ''}
    </div>
  </button>`;
}

function renderHome() {
  const vis = visibleSessions();
  const awaitL = vis.filter(isAwait).sort((a, b) => a.waitSince - b.waitSince);
  const runL = vis.filter(s => s.status === 'running' && !isAwait(s));
  const recentL = vis.filter(s => s.status === 'finished' || s.status === 'failed')
    .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));

  // hero
  const hero = $('#hero');
  const n = awaitL.length;
  const heroNum = $('#hero-num'), heroCheck = $('#hero-check');
  if (n > 0) {
    hero.classList.remove('hero-ok');
    heroNum.hidden = false; heroCheck.hidden = true;
    heroNum.textContent = n;
    $('#hero-text').textContent = n === 1 ? 'agent needs you' : 'agents need you';
    // longest wait = strongest urgency cue
    const longest = awaitL[0];
    $('#hero-sub').textContent = longest ? `longest waiting ${fmtAgo(longest.waitSince)}` : '';
    $('#hero-sub').hidden = !longest;
  } else if (runL.length > 0) {
    hero.classList.add('hero-ok');
    heroNum.hidden = true; heroCheck.hidden = false;
    $('#hero-text').textContent = 'nothing waiting';
    $('#hero-sub').textContent = `${runL.length} agent${runL.length === 1 ? '' : 's'} still running`;
    $('#hero-sub').hidden = false;
  } else {
    hero.classList.add('hero-ok');
    heroNum.hidden = true; heroCheck.hidden = false;
    $('#hero-text').textContent = 'all quiet';
    $('#hero-sub').textContent = 'nothing needs your attention';
    $('#hero-sub').hidden = false;
  }

  renderFilters();

  const totalVisible = vis.length;
  $('#quiet-state').hidden = totalVisible !== 0;
  $('#hero').hidden = totalVisible === 0;

  const fill = (id, list, sectId) => {
    $('#' + id).innerHTML = list.map(sessionCard).join('');
    $('#' + sectId).hidden = list.length === 0;
  };
  fill('list-await', awaitL, 'sect-await');
  fill('list-running', runL, 'sect-running');
  fill('list-recent', recentL, 'sect-recent');
}

/* ── session detail ────────────────────────────────────────── */
const TCLS = { dim: 't-dim', grn: 't-grn', ylw: 't-ylw', red: 't-red', blu: 't-blu', cmd: 't-cmd', q: 't-q', '': '' };
function renderTerm(s) {
  const out = $('#term-out');
  out.innerHTML = s.log.map(([cls, txt]) => {
    const esc = txt.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const html = esc.replace('▋', '<span class="t-cursor"> </span>');
    return cls ? `<span class="${TCLS[cls] || ''}">${html}</span>` : html;
  }).join('\n');
  const sc = $('#term-scroll');
  sc.scrollTop = sc.scrollHeight;
}

function renderSessionHead(s) {
  $('#sess-title').textContent = s.title;
  $('#sess-agent-name').textContent = s.agent;
  $('#sess-agent-dot').dataset.agent = s.agent;
  $('#sess-project').textContent = projName(s.project);
  const b = $('#sess-badge');
  const awaiting = isAwait(s);
  let label, cls;
  if (awaiting) { label = 'needs input'; cls = 'await'; }
  else if (s.status === 'running') { label = 'running'; cls = 'running'; }
  else if (s.status === 'finished') { label = 'done'; cls = 'finished'; }
  else if (s.status === 'failed') { label = 'failed'; cls = 'failed'; }
  else { label = s.status; cls = 'queued'; }
  b.textContent = label;
  b.className = 'badge badge-' + cls;
  const strip = $('#await-strip');
  strip.hidden = !awaiting;
  if (awaiting) $('#await-strip-text').textContent = 'Waiting for your input · ' + fmtAgo(s.waitSince);
  $('#btn-kill').style.visibility = isLive(s) ? 'visible' : 'hidden';
  const rb = $('#replybar');
  rb.classList.toggle('disabled', !isLive(s) || state.conn !== 'connected');
}

function openSession(id) {
  const s = SESSIONS.find(x => x.id === id);
  if (!s) return;
  state.openSession = id;
  s.unread = 0;
  renderSessionHead(s);
  renderTerm(s);
  show('session');
}

/* ── send input / quick keys ───────────────────────────────── */
const KEYLBL = { Enter: '⏎', Up: '↑', Down: '↓', Esc: 'Esc', CtrlC: '^C' };
function sendToSession(text, isKey) {
  if (state.conn !== 'connected') { toast('Disconnected — input not sent'); return; }
  const s = SESSIONS.find(x => x.id === state.openSession);
  if (!s || !isLive(s)) { toast('Session is no longer running'); return; }
  // strip cursor from last line
  if (s.log.length) s.log[s.log.length - 1][1] = s.log[s.log.length - 1][1].replace(' ▋', '').replace('▋', '');
  s.log.push(['cmd', '› ' + (isKey ? KEYLBL[text] || text : text)]);
  if (text === 'CtrlC') {
    s.log.push(['red', '^C — interrupt sent']);
  }
  // agent picks it up → working
  if (isAwait(s)) {
    s.activity = 'working'; s.waitSince = null; s.question = null;
    s.log.push(['', 'Continuing… ▋']);
    // simulate progress + maybe finish
    const t1 = setTimeout(() => {
      if (s.status !== 'running') return;
      s.log.push(['grn', '✓ Step complete.'], ['', 'Running follow-up checks… ▋']);
      if (state.openSession === s.id) renderTerm(s);
      renderHome();
    }, 1800);
    timers.add(t1);
  } else {
    s.log.push(['', '… ▋']);
  }
  if (state.openSession === s.id) { renderSessionHead(s); renderTerm(s); }
  renderHome();
}

/* ── kill ──────────────────────────────────────────────────── */
function confirmDlg(title, msg, okLabel, cb) {
  $('#dlg-title').textContent = title;
  $('#dlg-msg').innerHTML = msg;
  $('#dlg-ok').textContent = okLabel;
  $('#dlg-overlay').hidden = false;
  $('#dlg-ok').onclick = () => { $('#dlg-overlay').hidden = true; cb(); };
}
function killSession() {
  if (state.conn !== 'connected') { toast('Disconnected — can\'t kill'); return; }
  const s = SESSIONS.find(x => x.id === state.openSession);
  if (!s || !isLive(s)) return;
  confirmDlg('Kill session?', `<strong>${s.title}</strong> on ${projName(s.project)} will be terminated. Unsaved agent work may be lost.`, 'Kill', () => {
    s.status = 'finished'; s.activity = 'idle'; s.exit = 130; s.finishedAt = now(); s.waitSince = null;
    if (s.log.length) s.log[s.log.length - 1][1] = s.log[s.log.length - 1][1].replace(' ▋', '').replace('▋', '');
    s.log.push(['ylw', '■ Killed · exit 130']);
    renderSessionHead(s); renderTerm(s); renderHome();
    toast('Session killed');
  });
}

/* ── new session sheet ─────────────────────────────────────── */
/* Project is inherited from context, never a forced choice:
   - filtering on project X  → start in X (confirm line only)
   - filter "All"            → last-used project (or first), changeable */
function sheetProject() {
  if (state.filter !== 'all' && PROJECTS.some(p => p.id === state.filter)) return state.filter;
  const last = localStorage.getItem(LS.lastProj);
  if (last && PROJECTS.some(p => p.id === last)) return last;
  return PROJECTS[0] ? PROJECTS[0].id : null;
}
function renderSheetCtx() {
  $('#ns-ctx-name').textContent = projName($('#ns-project').value);
}
function openSheet() {
  if (state.conn !== 'connected') { toast('Disconnected — can\'t start a session'); return; }
  const sp = $('#ns-project');
  sp.innerHTML = PROJECTS.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  const ctx = sheetProject();
  if (ctx) sp.value = ctx;
  const sf = $('#ns-profile');
  sf.innerHTML = PROFILES.map(p => `<option value="${p.id}" ${p.def ? 'selected' : ''}>${p.name}${p.def ? ' (default)' : ''}</option>`).join('');
  updateProfileMeta();
  renderSheetCtx();
  $('#ns-opts').hidden = true;          // common path: prompt → Start, nothing else
  $('#ns-ctx-change').textContent = 'Change';
  $('#ns-prompt').value = '';
  $('#sheet-overlay').hidden = false;
  $('#sheet-new').hidden = false;
  setTimeout(() => $('#ns-prompt').focus(), 50);
}
function closeSheet() { $('#sheet-overlay').hidden = true; $('#sheet-new').hidden = true; }
function updateProfileMeta() {
  const p = PROFILES.find(x => x.id === $('#ns-profile').value);
  $('#ns-profile-meta').textContent = p ? `agent: ${p.agent} · params & env come from the profile` : '';
}
let seq = 7;
function startSession() {
  const proj = $('#ns-project').value;
  const prof = PROFILES.find(x => x.id === $('#ns-profile').value);
  const prompt = $('#ns-prompt').value.trim();
  const id = 's' + (seq++);
  const s = {
    id, title: prompt ? prompt.slice(0, 28).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session-' + id : 'session-' + id,
    agent: prof.agent, project: proj, status: 'queued', activity: 'working',
    since: now(), waitSince: null, unread: 0,
    log: [['dim', `$ ${prof.agent} ${prompt ? JSON.stringify(prompt) : '(interactive)'}`], ['dim', 'queued…']],
  };
  SESSIONS.unshift(s);
  localStorage.setItem(LS.lastProj, proj);   // remember for next "All" launch
  // don't let an active project filter hide the session just created
  if (state.filter !== 'all' && state.filter !== proj) state.filter = 'all';
  closeSheet(); renderHome();
  const fc = $(`.scard[data-sid="${id}"]`);
  if (fc) {
    fc.classList.add('scard-fresh');
    const sc = $('#home-scroll');
    if (sc) sc.scrollTop = Math.max(0, fc.offsetTop - 80);
  }
  toast('Session queued in ' + projName(proj));
  const t1 = setTimeout(() => { s.status = 'starting'; s.log.push(['dim', 'starting PTY…']); refreshIfVisible(s); }, 500);
  const t2 = setTimeout(() => {
    s.status = 'running';
    s.log.push(['', (prompt ? 'Working on: ' + prompt : 'Ready.') + ' ▋']);
    refreshIfVisible(s);
  }, 1400);
  timers.add(t1); timers.add(t2);
}
function refreshIfVisible(s) {
  renderHome();
  if (state.openSession === s.id && state.view === 'session') { renderSessionHead(s); renderTerm(s); }
}

/* ── connection sim ────────────────────────────────────────── */
/* connected      — normal, quiet
   daemon-down    — on tailnet, but dev machine / daemon not responding
   tailnet-down   — this device dropped off the tailnet (Tailscale off / expired)
   reconnecting   — retry in flight                                            */
const CONN_DOWN = ['daemon-down', 'tailnet-down'];
function setConn(c) {
  state.conn = c;
  $('#app').dataset.conn = c;
  const off = c !== 'connected';
  if (off && !state.snapshotAt) state.snapshotAt = now();
  if (!off) state.snapshotAt = null;
  // pill: tailnet host name is the stable identity; label only when degraded
  const lbl = { 'reconnecting': 'reconnecting…', 'daemon-down': 'unreachable', 'tailnet-down': 'off tailnet' }[c] || '';
  $$('.conn-label').forEach(e => { e.textContent = lbl; e.hidden = !lbl; });
  $$('.conn-host').forEach(e => { e.textContent = TAILNET_HOST; });
  // stale-data banner — cause-specific guidance
  const at = fmtClock(state.snapshotAt || now());
  const txt = c === 'daemon-down'
    ? `Can't reach ${TAILNET_HOST} — data from ${at}. Is the dev machine awake?`
    : c === 'tailnet-down'
      ? `Off the tailnet — data from ${at}. Check Tailscale on this device.`
      : `Reconnecting — data from ${at}`;
  $('#offline-banner').hidden = !off;
  $('#offline-banner-sess').hidden = !off;
  $('#ob-text').textContent = txt;
  $('#ob-text-sess').textContent = txt.replace('data from', 'output frozen at');
  const tag = $('#set-conn-tag');
  if (tag) { tag.textContent = off ? (c === 'reconnecting' ? 'Reconnecting…' : 'Unreachable') : 'Connected'; tag.dataset.state = off ? 'down' : 'ok'; }
  const s = SESSIONS.find(x => x.id === state.openSession);
  if (s) renderSessionHead(s);
}
function retryConn() {
  setConn('reconnecting');
  const t = setTimeout(() => { setConn('connected'); toast('Reconnected to ' + TAILNET_HOST); renderHome(); }, 1500);
  timers.add(t);
}

/* ── full-screen connection-problem view (boot failure / details) ── */
function showConnProblem(kind) {            // 'daemon' | 'tailnet'
  $('#conn-step-daemon').hidden = kind !== 'daemon';
  $('#conn-step-tailnet').hidden = kind !== 'tailnet';
  $('#conn-step-busy').hidden = true;
  show('conn');
}
function connRetryFull() {
  $('#conn-step-daemon').hidden = true;
  $('#conn-step-tailnet').hidden = true;
  $('#conn-step-busy').hidden = false;
  const t = setTimeout(() => {
    $('#conn-step-busy').hidden = true;
    setConn('connected');
    show('home'); renderHome();
    toast('Connected to ' + TAILNET_HOST);
  }, 1400);
  timers.add(t);
}
function connFlow() {
  $('#btn-conn-retry').addEventListener('click', connRetryFull);
  $('#btn-conn-retry-2').addEventListener('click', connRetryFull);
}

/* ── live ticking (wait timers, demo events) ───────────────── */
function tick() {
  if (state.view === 'home' && state.conn === 'connected') renderHome();
  if (state.view === 'session') {
    const s = SESSIONS.find(x => x.id === state.openSession);
    if (s && isAwait(s)) $('#await-strip-text').textContent = 'Waiting for your input · ' + fmtAgo(s.waitSince);
  }
}

/* ── wiring + init ─────────────────────────────────────────── */
function init() {
  // home
  $('#home-scroll').addEventListener('click', (e) => {
    const card = e.target.closest('.scard');
    if (card) { openSession(card.dataset.sid); return; }
    const chip = e.target.closest('.fchip');
    if (chip) { state.filter = chip.dataset.f; renderHome(); }
  });
  $('#fab-new').addEventListener('click', openSheet);
  $('#btn-quiet-new').addEventListener('click', openSheet);
  $('#btn-settings').addEventListener('click', () => show('settings'));

  // session
  $('#btn-back').addEventListener('click', () => { state.openSession = null; show('home'); renderHome(); });
  $('#btn-kill').addEventListener('click', killSession);
  $('#btn-send').addEventListener('click', () => {
    const v = $('#reply-input').value.trim();
    if (!v) return;
    $('#reply-input').value = '';
    sendToSession(v, false);
  });
  $('#reply-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-send').click(); });
  $('#quickkeys').addEventListener('click', (e) => {
    const b = e.target.closest('.qk');
    if (!b) return;
    if (b.dataset.send) sendToSession(b.dataset.send, false);
    else sendToSession(b.dataset.key, true);
  });

  // settings
  $('#btn-settings-back').addEventListener('click', () => { show('home'); renderHome(); });
  [['ntf-await', 'await'], ['ntf-failed', 'failed'], ['ntf-finished', 'finished']].forEach(([id, key]) => {
    const el = $('#' + id);
    el.checked = !!state.ntf[key];
    el.addEventListener('change', () => {
      state.ntf[key] = el.checked;
      localStorage.setItem(LS.ntf, JSON.stringify(state.ntf));
      toast(el.checked ? 'Notifications on' : 'Notifications off');
    });
  });

  // sheet + dialog
  $('#sheet-overlay').addEventListener('click', closeSheet);
  $('#ns-ctx-change').addEventListener('click', () => {
    const o = $('#ns-opts'); o.hidden = !o.hidden;
    $('#ns-ctx-change').textContent = o.hidden ? 'Change' : 'Done';
    if (!o.hidden) $('#ns-project').focus();
  });
  $('#ns-project').addEventListener('change', renderSheetCtx);
  $('#ns-profile').addEventListener('change', updateProfileMeta);
  $('#btn-ns-start').addEventListener('click', startSession);
  $('#dlg-cancel').addEventListener('click', () => { $('#dlg-overlay').hidden = true; });

  // connection pill cycles states (prototype affordance to demo 4.1/4.6):
  // connected → daemon-down → tailnet-down (full-screen) → retry → connected
  $('#conn-pill').addEventListener('click', () => {
    if (state.conn === 'connected') { setConn('daemon-down'); toast('Simulating: dev machine unreachable'); }
    else if (state.conn === 'daemon-down') { setConn('tailnet-down'); showConnProblem('tailnet'); toast('Simulating: this device off the tailnet'); }
    else retryConn();
  });
  $('#ob-retry').addEventListener('click', retryConn);
  $('#ob-retry-sess').addEventListener('click', retryConn);

  connFlow();

  // entry: no login, no pairing — Tailscale already authenticated this
  // device by virtue of being on the tailnet. Boot straight into Home.
  show('home'); renderHome();
  setConn('connected');
  setInterval(tick, 30000);
}
document.addEventListener('DOMContentLoaded', init);
