/* ============================================================
   Agentry — app.js
   Navigation, Tweaks panel, Session interactions, Drawer,
   Elapsed timer, Keyboard shortcuts, localStorage persistence.
   Plain ES2020. No frameworks. No CDN deps.
   ============================================================ */

(function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────── */
  var STORAGE_KEY = 'agentry:tweaks';
  var STORAGE_NAV  = 'agentry:nav';

  /* ── Default tweaks ─────────────────────────────────────────── */
  var TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "theme":   "dark",
    "density": "comfortable",
    "accent":  "blue"
  }/*EDITMODE-END*/;

  /* ── Placeholder session data ───────────────────────────────── */
  var ICON_BASE = 'https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/';
  var AGENT_ICON = {
    'agent-claude': ICON_BASE + 'claudecode-color.svg',
    'agent-codex': ICON_BASE + 'codex-color.svg',
    'agent-opencode': ICON_BASE + 'opencode.svg'
  };
  function iconClass(agentClass) {
    return 'agent-icon' + (agentClass === 'agent-opencode' ? ' agent-icon-opencode' : '');
  }

  function ansi(cls, text) { return '<span class="ansi-' + cls + '">' + text + '</span>'; }
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* Stream scripts — ordered lines each running session emits over time.
     Each entry: [delayMs, html]. delayMs is the wait BEFORE printing it. */
  function claudeAuthStream() {
    return [
      [0,   ansi('green', '✓') + ' ' + ansi('bright-white', 'Starting Claude Code agent')],
      [0,   ansi('bright-black', '  Session: $SID | CWD: /home/user/projects/api-server')],
      [0,   ansi('bright-black', '  Model: claude-opus-4-5 | Mode: auto')],
      [300, ''],
      [200, ansi('blue', '?') + ' ' + ansi('bright-white', 'Reading task:') + ' ' + ansi('white', 'Refactor auth middleware to use JWT validation instead of session cookies.')],
      [600, ''],
      [500, ansi('yellow', '⏳') + ' Analyzing codebase' + ansi('bright-black', '…')],
      [700, ansi('green', '✓') + ' ' + ansi('bright-green', 'Read') + ' ' + ansi('cyan', 'src/middleware/auth.ts') + ' ' + ansi('bright-black', '(127 lines)')],
      [500, ansi('green', '✓') + ' ' + ansi('bright-green', 'Read') + ' ' + ansi('cyan', 'src/types/auth.ts') + ' ' + ansi('bright-black', '(43 lines)')],
      [800, ''],
      [400, ansi('yellow', '✎') + ' ' + ansi('bright-white', 'Creating') + ' ' + ansi('cyan', 'src/utils/jwt.ts') + ansi('bright-black', '…')],
      [900, ansi('green', '✓') + ' Created ' + ansi('cyan', 'src/utils/jwt.ts') + ' ' + ansi('bright-black', '(38 lines)')],
      [600, ansi('yellow', '✎') + ' ' + ansi('bright-white', 'Editing') + ' ' + ansi('cyan', 'src/middleware/auth.ts') + ansi('bright-black', '…')],
      [800, ansi('green', '✓') + ' Updated ' + ansi('cyan', 'src/middleware/auth.ts')],
      [700, ''],
      [500, ansi('yellow', '⏳') + ' Running ' + ansi('bright-white', 'tsc --noEmit') + ansi('bright-black', '…')],
      [1500, ansi('green', '✓') + ' ' + ansi('bright-green', 'Type check passed') + ' ' + ansi('bright-black', '(0 errors)')],
      [600, ''],
      [400, ansi('bright-green', '✓ Done') + ' ' + ansi('bright-black', 'exit 0 · task complete'), 'finish', 0]
    ];
  }
  function codexParserStream() {
    return [
      [0,   ansi('green', '✓') + ' ' + ansi('bright-white', 'Starting Codex agent')],
      [0,   ansi('bright-black', '  Session: $SID | CWD: /home/user/projects/parser-lib')],
      [300, ''],
      [200, ansi('blue', '?') + ' ' + ansi('bright-white', 'Task:') + ' ' + ansi('white', 'Write unit tests for the expression parser, covering precedence and error cases.')],
      [700, ''],
      [500, ansi('green', '✓') + ' ' + ansi('bright-green', 'Read') + ' ' + ansi('cyan', 'src/parser/expr.ts') + ' ' + ansi('bright-black', '(214 lines)')],
      [600, ansi('yellow', '✎') + ' ' + ansi('bright-white', 'Writing') + ' ' + ansi('cyan', 'test/expr.spec.ts') + ansi('bright-black', '…')],
      [500, ansi('bright-black', "   + describe('precedence', …) — 8 cases")],
      [500, ansi('bright-black', "   + describe('errors', …) — 5 cases")],
      [800, ''],
      [400, ansi('yellow', '⏳') + ' Running ' + ansi('bright-white', 'vitest run') + ansi('bright-black', '…')],
      [1600, ansi('bright-black', '   ✓ precedence (8)') + '  ' + ansi('bright-black', '✓ errors (5)')],
      [400, ansi('green', '✓') + ' ' + ansi('bright-green', '13 passed') + ansi('bright-black', ' · 142ms')],
      [600, ''],
      [400, ansi('bright-green', '✓ Done') + ' ' + ansi('bright-black', 'exit 0 · task complete'), 'finish', 0]
    ];
  }

  var SESSIONS = {
    'sess-001': {
      name: 'Refactor auth middleware', agent: 'Claude Code', agentClass: 'agent-claude',
      status: 'running', activity: 'working',
      projectId: 'proj-1', profileId: 'prof-1',
      cwd: '/home/user/projects/api-server', createdAt: '14:23:47',
      sessionId: 'sess-001', agentSessionId: 'asid-4f2a8bc3d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3c7e1',
      agentSessionName: 'auth-middleware-refactor',
      startTs: Date.now() - (14 * 60 + 32) * 1000, group: 'running', unread: 3,
      stream: claudeAuthStream
    },
    'sess-002': {
      name: 'Write unit tests for parser', agent: 'Codex', agentClass: 'agent-codex',
      status: 'running', activity: 'awaiting_input',
      projectId: 'proj-2', profileId: 'prof-2',
      cwd: '/home/user/projects/parser-lib', createdAt: '14:35:12',
      sessionId: 'sess-002', agentSessionId: null, agentSessionName: null,
      startTs: Date.now() - (2 * 60 + 11) * 1000, group: 'running',
      stream: codexParserStream
    },
    'sess-003': {
      name: 'Add OpenAPI schema gen', agent: 'OpenCode', agentClass: 'agent-opencode',
      status: 'finished', activity: 'idle',
      projectId: 'proj-1', profileId: 'prof-3',
      cwd: '/home/user/projects/api-server', createdAt: '13:22:05',
      sessionId: 'sess-003', agentSessionId: 'asid-3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d',
      agentSessionName: 'openapi-schema-gen',
      elapsed: '6m 04s', exitCode: 0, group: 'finished',
      output:
        ansi('green', '✓') + ' ' + ansi('bright-white', 'Starting OpenCode agent') + '\n' +
        ansi('bright-black', '  Session: sess-003 | CWD: /home/user/projects/api-server') + '\n\n' +
        ansi('green', '✓') + ' ' + ansi('bright-green', 'Generated') + ' ' + ansi('cyan', 'openapi.yaml') + ' ' + ansi('bright-black', '(412 lines, 23 paths)') + '\n' +
        ansi('green', '✓') + ' ' + ansi('bright-green', 'Validated') + ' schema — ' + ansi('bright-green', 'no errors') + '\n\n' +
        ansi('bright-green', '✓ Done') + ' ' + ansi('bright-black', 'exit 0 · 6m 04s')
    },
    'sess-004': {
      name: 'Migrate DB schema v4', agent: 'Claude Code', agentClass: 'agent-claude',
      status: 'failed', activity: 'idle',
      projectId: 'proj-3', profileId: 'prof-1',
      cwd: '/home/user/projects/db-migrations', createdAt: '11:10:33',
      sessionId: 'sess-004', agentSessionId: 'asid-4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e',
      agentSessionName: null, /* Option<String> — not every agent reports one */
      elapsed: '1m 47s', exitCode: 1, group: 'finished',
      output:
        ansi('green', '✓') + ' ' + ansi('bright-white', 'Starting Claude Code agent') + '\n' +
        ansi('bright-black', '  Session: sess-004 | CWD: /home/user/projects/db-migrations') + '\n\n' +
        ansi('yellow', '✎') + ' Applying migration ' + ansi('cyan', '004_add_audit_log.sql') + ansi('bright-black', '...') + '\n' +
        ansi('red', '✗') + ' ' + ansi('bright-red', 'Error:') + ' ' + ansi('white', 'relation "audit_log" already exists') + '\n' +
        ansi('bright-black', '   at migration 004, line 12') + '\n\n' +
        ansi('bright-red', '✗ Failed') + ' ' + ansi('bright-black', 'exit 1 · 1m 47s')
    }
  };

  /* Live stream runners keyed by sessionId. */
  var streamers = {};
  var seq = 5; /* next sess id counter */

  /* ── State ──────────────────────────────────────────────────── */
  var state = {
    activeView: 'sessions',
    activeSession: 'sess-001',
    drawerOpen: false,
    modalOpen: false,
    confirmOpen: false,
    projMenuOpen: false,
    projModalOpen: false,
    paletteOpen: false,
    tweaks: Object.assign({}, TWEAK_DEFAULTS)
  };

  /* ── DOM refs ───────────────────────────────────────────────── */
  var $html         = document.documentElement;

  var $drawer       = document.getElementById('session-drawer');
  var $drawerOverlay = document.getElementById('drawer-overlay');
  var $btnCloseDrawer = document.getElementById('btn-close-drawer');
  var $toastCont    = document.getElementById('toast-container');
  var $topbarTitle  = document.getElementById('topbar-title');
  var $toolbarTerminal = document.getElementById('toolbar-terminal');

  /* ================================================================
     TWEAKS
  ================================================================ */

  function loadTweaks() {
    try {
      var stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (stored && typeof stored === 'object') {
        Object.assign(state.tweaks, stored);
      }
    } catch (e) { /* ignore */ }
  }

  function saveTweaks() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tweaks));
    } catch (e) { /* ignore */ }
  }

  function applyTweaks() {
    $html.setAttribute('data-theme',   state.tweaks.theme);
    $html.setAttribute('data-accent',  state.tweaks.accent);
    $html.setAttribute('data-density', state.tweaks.density);

    /* Sync tweak-btn active states */
    document.querySelectorAll('[data-tweak]').forEach(function (btn) {
      var dim = btn.getAttribute('data-tweak');
      var val = btn.getAttribute('data-value');
      var active = state.tweaks[dim] === val;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });

    /* Sync settings theme buttons */
    var $dark  = document.getElementById('settings-theme-dark');
    var $light = document.getElementById('settings-theme-light');
    if ($dark && $light) {
      if (state.tweaks.theme === 'dark') {
        $dark.className  = 'btn btn-secondary btn-sm';
        $light.className = 'btn btn-ghost btn-sm';
        $dark.setAttribute('aria-pressed',  'true');
        $light.setAttribute('aria-pressed', 'false');
      } else {
        $dark.className  = 'btn btn-ghost btn-sm';
        $light.className = 'btn btn-secondary btn-sm';
        $dark.setAttribute('aria-pressed',  'false');
        $light.setAttribute('aria-pressed', 'true');
      }
    }
  }

  function setTweak(dim, val) {
    state.tweaks[dim] = val;
    applyTweaks();
    saveTweaks();
  }

  /* Tweak btn click delegation */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-tweak]');
    if (!btn) return;
    var dim = btn.getAttribute('data-tweak');
    var val = btn.getAttribute('data-value');
    if (dim && val) setTweak(dim, val);
  });



  /* ================================================================
     NAVIGATION
  ================================================================ */

  var VIEW_MAP = {
    sessions: 'view-sessions',
    launch:   'view-launch',
    overview: 'view-overview',
    profiles: 'view-profiles',
    projects: 'view-projects',
    settings: 'view-settings',
    r9router: 'view-r9router'
  };

  var TITLE_MAP = {
    sessions: null, /* dynamic, set by active session */
    launch:   'New Session',
    overview: 'Overview',
    profiles: 'Profiles',
    projects: 'Projects',
    settings: 'Settings',
    r9router: '9Router'
  };

  function navigateTo(viewId) {
    if (!VIEW_MAP[viewId]) return;

    state.activeView = viewId;

    /* Update actbar buttons */
    document.querySelectorAll('.actbar-btn[data-nav]').forEach(function (btn) {
      var active = btn.getAttribute('data-nav') === viewId;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-current', active ? 'page' : 'false');
    });

    /* Show/hide views */
    Object.keys(VIEW_MAP).forEach(function (key) {
      var el = document.getElementById(VIEW_MAP[key]);
      if (el) el.classList.toggle('active', key === viewId);
    });

    /* Topbar title + toolbar visibility */
    var title = TITLE_MAP[viewId];
    if (viewId === 'sessions' && state.activeSession && SESSIONS[state.activeSession]) {
      title = SESSIONS[state.activeSession].name;
    }
    if ($topbarTitle) $topbarTitle.textContent = title || 'Agentry';

    /* Show terminal toolbar only for terminal/sessions view */
    if ($toolbarTerminal) {
      $toolbarTerminal.style.display = viewId === 'sessions' ? '' : 'none';
    }

    if (viewId === 'profiles' && typeof renderProfiles === 'function') renderProfiles();
    if (viewId === 'projects' && typeof renderProjectsView === 'function') renderProjectsView();
    if (viewId === 'overview') renderOverview();

    /* Persist */
    try { localStorage.setItem(STORAGE_NAV, viewId); } catch (e) {}
  }

  /* Click delegation for data-nav */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-nav]');
    if (!btn) return;
    var nav = btn.getAttribute('data-nav');
    if (!nav) return;
    /* Mobile: tapping "Sessions" opens the session-list drawer
       (master view) instead of jumping straight to the terminal,
       so the user can pick which session to view. */
    if (nav === 'sessions' && isMobile()) {
      navigateTo('sessions');
      openMobileSidebar();
      return;
    }
    navigateTo(nav);
  });

  /* ================================================================
     SESSION SELECTION
  ================================================================ */

  var $termView    = document.getElementById('view-sessions');
  var $sessionList = document.getElementById('session-list');
  var $emptyState  = document.getElementById('empty-sessions');

  /* ── Elapsed formatting ──────────────────────────────────────── */
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function fmtElapsed(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(s / 60), h = Math.floor(m / 60);
    s %= 60; m %= 60;
    if (h > 0) return h + 'h ' + pad2(m) + 'm';
    return m + 'm ' + pad2(s) + 's';
  }
  function relTime(s) {
    if (!isLive(s) || !s.startTs) return s.createdAt || '—';
    return fmtElapsed(Date.now() - s.startTs) + ' ago';
  }
  function sessElapsed(s) {
    if (isLive(s) && s.startTs) return fmtElapsed(Date.now() - s.startTs);
    return s.elapsed || '';
  }

  /* ── Badge / status helpers ──────────────────────────────────── */
  /* Wire lifecycle: queued → starting → running → finished/failed.
     While running, ActivityState (working/idle/awaiting_input) overlays. */
  function isLive(s) {
    return s.status === 'running' || s.status === 'starting' || s.status === 'queued';
  }
  function badgeHtml(s) {
    if (s.status === 'queued')   return '<span class="badge badge-queued"><span class="badge-dot"></span>queued</span>';
    if (s.status === 'starting') return '<span class="badge badge-starting"><span class="badge-dot"></span>starting</span>';
    if (s.status === 'running') {
      if (s.activity === 'awaiting_input')
        return '<span class="badge badge-awaiting"><span class="badge-dot"></span>needs input</span>';
      return '<span class="badge badge-running"><span class="badge-dot"></span>running</span>';
    }
    if (s.status === 'finished') return '<span class="badge badge-finished"><span class="badge-dot"></span>done</span>';
    if (s.status === 'failed') return '<span class="badge badge-failed"><span class="badge-dot"></span>failed</span>';
    return '';
  }
  function statusLabel(s) {
    if (s.status === 'queued') return '<span class="pane-status-tag">queued</span>';
    if (s.status === 'starting') return '<div class="terminal-running-indicator"><span class="terminal-running-dot"></span><span>starting</span></div>';
    if (s.status === 'running') {
      var act = s.activity === 'awaiting_input'
        ? '<span class="activity-pill awaiting_input">awaiting input</span>'
        : '';
      return '<div class="terminal-running-indicator"><span class="terminal-running-dot"></span><span>running</span></div>' + act;
    }
    if (s.status === 'finished') return '<span class="pane-status-tag ok">exit ' + (s.exitCode != null ? s.exitCode : 0) + '</span>';
    if (s.status === 'failed') return '<span class="pane-status-tag fail">exit ' + (s.exitCode != null ? s.exitCode : 1) + '</span>';
    return '';
  }
  function agentLabel(cls) {
    return cls === 'agent-claude' ? 'Claude' : cls === 'agent-codex' ? 'Codex' : 'OpenCode';
  }

  /* ── Sidebar render (data-driven) ────────────────────────────── */
  function sessionItemHtml(id, s) {
    var actionBtn = isLive(s)
      ? '<button class="icon-btn" title="Kill session" aria-label="Kill session" data-action="kill" data-session-id="' + id + '"><i data-lucide="x"></i></button>'
      : '<button class="icon-btn" title="Restart session" aria-label="Restart session" data-action="restart" data-session-id="' + id + '"><i data-lucide="rotate-ccw"></i></button>';
    var right = badgeHtml(s) + (s.unread ? '<span class="unread-badge" aria-label="' + s.unread + ' unread">' + s.unread + '</span>' : '');
    var active = id === state.activeSession;
    return '<div class="session-item' + (active ? ' active' : '') + '" data-session-id="' + id + '" role="option" aria-selected="' + active + '" tabindex="0">' +
      '<span class="session-item-icon"><img class="' + iconClass(s.agentClass) + '" src="' + AGENT_ICON[s.agentClass] + '" alt="' + s.agent + '" /></span>' +
      '<div class="session-item-body">' +
        '<div class="session-item-name">' + esc(s.name) + '</div>' +
        '<div class="session-item-meta">' +
          '<span class="session-item-agent ' + s.agentClass + '">' + agentLabel(s.agentClass) + '</span>' +
          '<span class="session-item-time">' + relTime(s) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="session-item-right">' + right + '</div>' +
      '<div class="session-item-actions">' + actionBtn + '</div>' +
    '</div>';
  }

  function renderSidebar() {
    if (!$sessionList) return;
    var running = [], finished = [];
    Object.keys(SESSIONS).forEach(function (id) {
      var s = SESSIONS[id];
      /* Sidebar is scoped to the active project. */
      if (activeProjectId && s.projectId !== activeProjectId) return;
      (isLive(s) ? running : finished).push(id);
    });

    var html = '';
    if (running.length) {
      html += '<div class="session-group-label">Running</div><div id="group-running">';
      running.forEach(function (id) { html += sessionItemHtml(id, SESSIONS[id]); });
      html += '</div>';
    }
    if (finished.length) {
      html += '<div class="session-group-label">Finished</div><div id="group-finished">';
      finished.forEach(function (id) { html += sessionItemHtml(id, SESSIONS[id]); });
      html += '</div>';
    }
    $sessionList.innerHTML = html;

    if ($emptyState) {
      var empty = !running.length && !finished.length;
      $emptyState.style.display = empty ? '' : 'none';
      $emptyState.setAttribute('aria-hidden', String(!empty));
      if (empty) $sessionList.appendChild($emptyState);
    }
    if (window.lucide) window.lucide.createIcons();
  }

  /* ── Overview render ─────────────────────────────────────────── */
  function renderOverview() {
    var counts = { running: 0, finished: 0, failed: 0 };
    Object.keys(SESSIONS).forEach(function (id) {
      var s = SESSIONS[id];
      if (activeProjectId && s.projectId !== activeProjectId) return;
      if (isLive(s)) counts.running++;
      else if (counts[s.status] != null) counts[s.status]++;
    });
    var setStat = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
    setStat('stat-running', counts.running);
    setStat('stat-finished', counts.finished);
    setStat('stat-failed', counts.failed);

    var scope = document.getElementById('overview-scope');
    if (scope) {
      var ap = activeProject();
      scope.textContent = ap ? ap.name : 'All projects';
    }

    var tbody = document.querySelector('.sessions-table');
    if (!tbody) return;
    var rows = '';
    var ids = Object.keys(SESSIONS).filter(function (id) {
      return !activeProjectId || SESSIONS[id].projectId === activeProjectId;
    });
    ids.forEach(function (id) {
      var s = SESSIONS[id];
      var proj = projectById(s.projectId);
      var act = isLive(s)
        ? '<button class="icon-btn" title="Focus" data-action="focus" data-session-id="' + id + '" aria-label="Focus session"><i data-lucide="maximize-2"></i></button>'
        : '<button class="icon-btn" title="Restart" data-action="restart" data-session-id="' + id + '" aria-label="Restart session"><i data-lucide="rotate-ccw"></i></button>';
      rows += '<div class="sessions-table-row" data-session-id="' + id + '">' +
        '<span style="font-weight:500;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(s.name) + '</span>' +
        '<span class="ov-proj" data-project-id="' + esc(s.projectId || '') + '" title="' + esc(proj ? proj.path : '') + '">' + esc(proj ? proj.name : '—') + '</span>' +
        '<span class="' + s.agentClass + '" style="display:inline-flex;align-items:center;gap:5px;"><img class="' + iconClass(s.agentClass) + '" src="' + AGENT_ICON[s.agentClass] + '" alt="' + agentLabel(s.agentClass) + '" style="width:13px;height:13px;" />' + agentLabel(s.agentClass) + '</span>' +
        '<span>' + badgeHtml(s) + '</span>' +
        '<span style="color:var(--fg-2);font-family:var(--font-mono);font-size:11px;">' + relTime(s) + '</span>' +
        '<span style="display:flex;gap:4px;">' + act + '</span>' +
      '</div>';
    });
    if (!ids.length) {
      rows = '<div class="sessions-table-empty">No sessions in this project yet.</div>';
    }
    tbody.innerHTML = rows;
    if (window.lucide) window.lucide.createIcons();
  }

  /* ── Terminal render + live streaming ────────────────────────── */
  function renderTerminalHeader(s) {
    var iconEl = $termView.querySelector('.terminal-header-info');
    var hdrIcon = $termView.querySelector('.terminal-header > .agent-icon img');
    if (hdrIcon) {
      hdrIcon.src = AGENT_ICON[s.agentClass] || '';
      hdrIcon.classList.toggle('agent-icon-opencode', s.agentClass === 'agent-opencode');
    }
    var titleEl = $termView.querySelector('.terminal-session-title');
    if (titleEl) titleEl.textContent = s.name;
    var meta = $termView.querySelector('.terminal-session-meta');
    if (meta) {
      meta.innerHTML =
        '<span class="mono-chip">' + s.sessionId + '</span>' +
        '<span class="terminal-elapsed">' + sessElapsed(s) + '</span>' +
        statusLabel(s);
    }
    void iconEl;
  }

  function scrollTermBottom() {
    var body = $termView.querySelector('.terminal-body');
    if (body) body.scrollTop = body.scrollHeight;
  }

  /* Append one streamed line to a session's persisted output + live DOM. */
  function streamAppend(id, html) {
    var s = SESSIONS[id];
    if (!s) return;
    s.output = (s.output || '') + (s.output ? '\n' : '') + html;
    if (id === state.activeSession && state.activeView === 'sessions') {
      var out = $termView.querySelector('.terminal-output');
      if (out) {
        out.innerHTML = s.output;
        scrollTermBottom();
      }
    }
  }

  function startStream(id) {
    var s = SESSIONS[id];
    if (!s || !s.stream || streamers[id]) return;
    var lines = s.stream().map(function (l) {
      return [l[0], l[1].replace(/\$SID/g, id), l[2], l[3]];
    });
    /* Resume from where we left off (so background sessions advance too). */
    s.streamIdx = s.streamIdx || 0;
    s.output = s.output || '';

    function tick() {
      if (s.status !== 'running' || s.streamIdx >= lines.length) {
        clearTimeout(streamers[id]);
        delete streamers[id];
        if (s.streamIdx >= lines.length && s.status === 'running') {
          /* Stream ended without explicit finish marker → mark finished */
          finishSession(id, 0);
        }
        return;
      }
      var line = lines[s.streamIdx++];
      streamAppend(id, line[1]);
      if (line[2] === 'finish') {
        finishSession(id, line[3] != null ? line[3] : 0);
        clearTimeout(streamers[id]);
        delete streamers[id];
        return;
      }
      var nextDelay = (lines[s.streamIdx] ? lines[s.streamIdx][0] : 400);
      streamers[id] = setTimeout(tick, nextDelay);
    }
    streamers[id] = setTimeout(tick, lines[s.streamIdx] ? lines[s.streamIdx][0] : 200);
  }

  function stopStream(id) {
    if (streamers[id]) { clearTimeout(streamers[id]); delete streamers[id]; }
  }

  /* Transition a running session to finished/failed. */
  function finishSession(id, exitCode) {
    var s = SESSIONS[id];
    if (!s) return;
    stopStream(id);
    s.status = exitCode === 0 ? 'finished' : 'failed';
    s.exitCode = exitCode;
    s.elapsed = sessElapsed(s);
    s.unread = (id === state.activeSession) ? 0 : (s.unread || 0) + 1;
    if (s.startTs) s.startTs = null;
    var tail = exitCode === 0
      ? '\n\n' + ansi('bright-green', '✓ Done') + ' ' + ansi('bright-black', 'exit 0 · ' + s.elapsed)
      : '\n\n' + ansi('bright-red', '✗ Failed') + ' ' + ansi('bright-black', 'exit ' + exitCode + ' · ' + s.elapsed);
    if (s.output && s.output.indexOf('✓ Done') === -1 && s.output.indexOf('✗ Failed') === -1) {
      s.output += tail;
    }
    renderSidebar();
    renderOverview();
    renderProjectSwitcher();
    if (id === state.activeSession) selectSession(id);
    toast(s.name + ' ' + (exitCode === 0 ? 'completed' : 'failed'), exitCode === 0 ? 'success' : 'error');
  }

  function syncSidebar(sessionId) {
    document.querySelectorAll('.session-item').forEach(function (item) {
      var isActive = item.getAttribute('data-session-id') === sessionId;
      item.classList.toggle('active', isActive);
      item.setAttribute('aria-selected', String(isActive));
    });
  }

  /* Selecting from sidebar loads the session into the terminal view. */
  function selectSession(sessionId) {
    var s = SESSIONS[sessionId];
    if (!s) return;
    state.activeSession = sessionId;
    if (s.unread) { s.unread = 0; renderSidebar(); }

    renderTerminalHeader(s);
    var out = $termView.querySelector('.terminal-output');
    if (out) out.innerHTML = s.output || '';

    /* Footer running indicator */
    var footer = $termView.querySelector('.terminal-body > .terminal-running-indicator');
    if (footer) footer.style.display = isLive(s) ? '' : 'none';

    scrollTermBottom();
    syncSidebar(sessionId);
    if (state.activeView === 'sessions' && $topbarTitle) $topbarTitle.textContent = s.name;
    if (window.lucide) window.lucide.createIcons();
  }

  /* Session item click */
  document.addEventListener('click', function (e) {
    var item = e.target.closest('.session-item');
    if (!item) return;
    if (e.target.closest('[data-action]')) return;
    var id = item.getAttribute('data-session-id');
    if (id) { selectSession(id); navigateTo('sessions'); }
  });

  /* Session item keyboard (Enter / Space) */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var item = document.activeElement && document.activeElement.closest('.session-item');
    if (!item) return;
    if (document.activeElement.closest('[data-action]')) return;
    e.preventDefault();
    var id = item.getAttribute('data-session-id');
    if (id) { selectSession(id); navigateTo('sessions'); }
  });

  /* ================================================================
     SESSION ACTIONS (kill / restart / focus)
  ================================================================ */

  function killSession(id) {
    var s = SESSIONS[id];
    if (!s || !isLive(s)) return;
    stopStream(id);
    s.elapsed = sessElapsed(s);
    /* Daemon kill() → SIGTERM → PTY EOF → finish_session() → SessionFinished
       (NOT SessionFailed). Exit code 130 = 128+SIGTERM, but status is finished. */
    streamAppend(id, '\n' + ansi('bright-yellow', '■ Killed') + ' ' + ansi('bright-black', 'SIGTERM · exit 130 · ' + s.elapsed));
    s.status = 'finished';
    s.activity = 'idle';
    s.exitCode = 130;
    if (s.startTs) s.startTs = null;
    renderSidebar(); renderOverview(); renderProjectSwitcher();
    if (id === state.activeSession) selectSession(id);
    toast('Kill signal sent to ' + s.name, 'info');
  }

  /* Restart = a brand-new start_session with the same project+profile
     (matches the real GUI: Inspector restart calls startSession again). */
  function restartSession(id) {
    var s = SESSIONS[id];
    if (!s) return;
    if (s.projectId && s.profileId && projectById(s.projectId) && profileById(s.profileId)) {
      startSession(s.projectId, s.profileId, s.cwd, null);
      return;
    }
    /* Demo sessions predating project/profile linkage: replay in place
       through the same queued → starting → running lifecycle. */
    stopStream(id);
    s.status = 'queued';
    s.activity = null;
    s.exitCode = undefined;
    s.startTs = Date.now();
    s.streamIdx = 0;
    s.unread = 0;
    s.output = '';
    s.agentSessionId = null;
    s.agentSessionName = null;
    if (!s.stream) s.stream = (s.agentClass === 'agent-codex' ? codexParserStream : claudeAuthStream);
    s.group = 'running';
    renderSidebar(); renderOverview();
    selectSession(id);
    navigateTo('sessions');
    setTimeout(function () {
      if (!SESSIONS[id] || SESSIONS[id].status !== 'queued') return;
      SESSIONS[id].status = 'starting';
      renderSidebar(); renderOverview();
      if (id === state.activeSession) selectSession(id);
    }, 350);
    setTimeout(function () {
      if (!SESSIONS[id] || SESSIONS[id].status !== 'starting') return;
      SESSIONS[id].status = 'running';
      SESSIONS[id].activity = 'working';
      renderSidebar(); renderOverview();
      if (id === state.activeSession) selectSession(id);
      startStream(id);
    }, 1050);
    setTimeout(function () {
      var t = SESSIONS[id];
      if (!t || (t.status !== 'running' && t.status !== 'finished')) return;
      var rand = function () { return Math.random().toString(16).slice(2); };
      t.agentSessionId = 'asid-' + rand() + rand();
      t.agentSessionName = t.name;
      if (state.drawerOpen && id === state.activeSession) openDrawer(id);
    }, 2600);
    toast('Restarting ' + s.name + '…', 'info');
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    var id = btn.getAttribute('data-session-id');
    if (action === 'kill') killSession(id);
    else if (action === 'restart') restartSession(id);
    else if (action === 'focus') { selectSession(id); navigateTo('sessions'); }
  });

  /* Overview table row click → focus session (delegated, table is re-rendered) */
  document.addEventListener('click', function (e) {
    /* Project cell → switch active project instead of focusing the session. */
    var pcell = e.target.closest('.ov-proj');
    if (pcell) {
      e.stopPropagation();
      var pid = pcell.getAttribute('data-project-id');
      if (pid && pid !== activeProjectId) setActiveProject(pid);
      return;
    }
    var row = e.target.closest('.sessions-table-row');
    if (!row) return;
    if (e.target.closest('[data-action]')) return;
    var id = row.getAttribute('data-session-id');
    if (id) { selectSession(id); navigateTo('sessions'); }
  });

  /* Topbar Kill button */
  var $btnKill = document.getElementById('btn-kill-session');
  if ($btnKill) {
    $btnKill.addEventListener('click', function () {
      var s = SESSIONS[state.activeSession];
      if (!s) return;
      if (s.status !== 'running') { toast('Session is not running', 'info'); return; }
      killSession(state.activeSession);
    });
  }

  /* Sidebar new session shortcut */
  var $btnNewSession = document.getElementById('btn-new-session');
  if ($btnNewSession) {
    $btnNewSession.addEventListener('click', function () { navigateTo('launch'); });
  }

  /* Quick launch — 1-click with the default profile (GetSettings.default_profile_id) */
  var $btnQuickLaunch = document.getElementById('btn-quick-launch');
  if ($btnQuickLaunch) {
    $btnQuickLaunch.addEventListener('click', function () {
      if (!defaultProfileId || !profileById(defaultProfileId)) {
        toast('No default profile — set one in Profiles (★)', 'info');
        navigateTo('profiles');
        return;
      }
      launchFromProfile(defaultProfileId);
    });
  }

  /* Refresh sessions btn */
  var $btnRefresh = document.getElementById('btn-refresh-sessions');
  if ($btnRefresh) {
    $btnRefresh.addEventListener('click', function () {
      toast('Sessions refreshed', 'success');
    });
  }

  /* ================================================================
     TERMINAL TOOLS
  ================================================================ */

  var $btnCopy = document.getElementById('btn-copy-output');
  if ($btnCopy) {
    $btnCopy.addEventListener('click', function () {
      var output = $termView.querySelector('.terminal-output');
      if (output && navigator.clipboard) {
        navigator.clipboard.writeText(output.textContent || '').then(function () {
          toast('Terminal output copied', 'success');
        }).catch(function () {
          toast('Copy failed — clipboard not available', 'error');
        });
      } else {
        toast('Copy not supported in this context', 'error');
      }
    });
  }

  var $btnClear = document.getElementById('btn-clear-terminal');
  if ($btnClear) {
    $btnClear.addEventListener('click', function () {
      var output = $termView.querySelector('.terminal-output');
      if (output) {
        output.innerHTML = '<span style="color:var(--fg-3);">[terminal cleared]</span>\n';
        toast('Terminal cleared', 'info');
      }
    });
  }

  /* ================================================================
     LAUNCH PANEL — wire-aligned start_session flow
     start_session{project_id, profile_id, cwd?, initial_input?, cols?, rows?}
       → resp {session_id, status: queued|starting}
       → event session_started (status: running)
       → event agent_session_captured (async, may never arrive)
  ================================================================ */

  var AGENT_MAP = {
    claude_code: { agent: 'Claude Code', agentClass: 'agent-claude', stream: claudeAuthStream },
    codex:       { agent: 'Codex',       agentClass: 'agent-codex',  stream: codexParserStream },
    open_code:   { agent: 'OpenCode',    agentClass: 'agent-opencode', stream: claudeAuthStream }
  };
  var PROF_AGENT_TO_KEY = {
    'agent-claude': 'claude_code',
    'agent-codex': 'codex',
    'agent-opencode': 'open_code'
  };
  /* Wire agent_type → CSS class. Profiles now store agent_type verbatim
     (claude_code/codex/open_code, matching CreateProfileCmd.agent_type);
     agentClass is derived for icons/labels only. */
  var AGENT_TYPE_TO_CLASS = {
    claude_code: 'agent-claude',
    codex: 'agent-codex',
    open_code: 'agent-opencode'
  };
  function classForAgentType(t) { return AGENT_TYPE_TO_CLASS[t] || 'agent-claude'; }
  function agentTypeForClass(c) { return PROF_AGENT_TO_KEY[c] || 'claude_code'; }

  function deriveName(prompt) {
    var t = prompt.trim().replace(/\s+/g, ' ');
    if (t.length <= 42) return t;
    return t.slice(0, 42).replace(/\s\S*$/, '') + '…';
  }

  /* Measure the visible terminal grid — wire start_session carries cols/rows
     so the PTY is sized correctly from the first byte. */
  function termSize() {
    var body = $termView ? $termView.querySelector('.terminal-body') : null;
    var w = body ? body.clientWidth : 960;
    var h = body ? body.clientHeight : 540;
    return {
      cols: Math.max(20, Math.floor(w / 8.4)),
      rows: Math.max(5, Math.floor(h / 19))
    };
  }

  /* Simulated daemon round-trip for start_session. Mirrors:
     dispatch() → resp{session_id,status:queued} → SessionStarted → AgentSessionCaptured */
  function startSession(projectId, profileId, cwd, initialInput) {
    var project = projectById(projectId);
    var profile = profileById(profileId);
    if (!project) { toast('Project is required', 'error'); return null; }
    if (!profile) { toast('Profile is required', 'error'); return null; }

    var meta = AGENT_MAP[profile.agentType || agentTypeForClass(profile.agentClass)] || AGENT_MAP.claude_code;
    var size = termSize();
    void size; /* sent on the wire as cols/rows; rendering here is HTML, not a PTY */

    var id = 'sess-' + pad2(seq++);
    var effectiveCwd = (cwd || '').trim() || project.path; /* daemon falls back to project path */

    /* resp arrives: {session_id, status: 'queued'} — NOT running yet */
    SESSIONS[id] = {
      name: initialInput ? deriveName(initialInput) : (profile.name + ' session'),
      agent: meta.agent, agentClass: meta.agentClass,
      status: 'queued', activity: null,
      projectId: projectId, profileId: profileId,
      cwd: effectiveCwd,
      createdAt: new Date().toTimeString().slice(0, 8),
      sessionId: id,
      agentSessionId: null, /* captured async via agent_session_captured */
      startTs: Date.now(), group: 'running',
      stream: meta.stream, streamIdx: 0, output: ''
    };
    profile.uses = (profile.uses || 0) + 1;
    saveProfiles();

    /* A session must be visible in its own project's scope — make that
       project active so the new session shows up in the sidebar. */
    if (projectId !== activeProjectId) setActiveProject(projectId, { silent: true });

    renderSidebar();
    renderOverview();
    renderProjectSwitcher();
    selectSession(id);
    navigateTo('sessions');

    /* daemon: spawn PTY → status starting */
    setTimeout(function () {
      var s = SESSIONS[id];
      if (!s || s.status !== 'queued') return;
      s.status = 'starting';
      renderSidebar(); renderOverview(); renderProjectSwitcher();
      if (id === state.activeSession) selectSession(id);
    }, 350);

    /* event session_started → running */
    setTimeout(function () {
      var s = SESSIONS[id];
      if (!s || s.status !== 'starting') return;
      s.status = 'running';
      s.activity = 'working';
      renderSidebar(); renderOverview(); renderProjectSwitcher();
      if (id === state.activeSession) selectSession(id);
      startStream(id);
    }, 1050);

    /* event agent_session_captured — async, after the agent boots */
    setTimeout(function () {
      var s = SESSIONS[id];
      if (!s || (s.status !== 'running' && s.status !== 'finished')) return;
      var rand = function () { return Math.random().toString(16).slice(2); };
      s.agentSessionId = 'asid-' + rand() + rand();
      s.agentSessionName = s.name; /* Option<String> — some agents report a name */
      if (state.drawerOpen && id === state.activeSession) openDrawer(id);
    }, 2600);

    toast('Session queued — ' + profile.name + ' in ' + project.name, 'success');
    return id;
  }

  /* ── Launch form: project + profile selects ──────────────────── */
  function renderProjectSelect() {
    var sel = document.getElementById('select-project');
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = '<option value="">— Select a project —</option>' +
      PROJECTS.map(function (p) {
        return '<option value="' + p.id + '">' + esc(p.name) + ' · ' + esc(p.path) + '</option>';
      }).join('');
    /* Default the launch form to the active project. */
    if (cur && projectById(cur)) sel.value = cur;
    else if (activeProjectId) sel.value = activeProjectId;
    else if (PROJECTS.length === 1) sel.value = PROJECTS[0].id;
  }

  /* ── Project switcher (topbar dropdown) ──────────────────────── */
  function renderProjectSwitcher() {
    var nameEl = document.getElementById('proj-switcher-name');
    var countEl = document.getElementById('proj-switcher-count');
    var ap = activeProject();
    if (nameEl) nameEl.textContent = ap ? ap.name : 'No project';
    if (countEl) {
      var c = ap ? projectSessionCounts(ap.id).running : 0;
      if (c > 0) { countEl.textContent = c; countEl.style.display = ''; countEl.title = c + ' running'; }
      else countEl.style.display = 'none';
    }
    var list = document.getElementById('proj-menu-list');
    if (!list) return;
    if (!PROJECTS.length) {
      list.innerHTML = '<div class="proj-menu-empty">No projects yet.</div>';
      return;
    }
    list.innerHTML = PROJECTS.map(function (p) {
      var counts = projectSessionCounts(p.id);
      var active = p.id === activeProjectId;
      var runChip = counts.running > 0
        ? '<span class="proj-run-chip" title="' + counts.running + ' running"><span class="proj-run-dot"></span>' + counts.running + '</span>'
        : '<span class="proj-run-chip muted">' + counts.total + '</span>';
      return '<button class="proj-menu-item' + (active ? ' active' : '') + '" role="option" aria-selected="' + active + '" data-project-id="' + p.id + '">' +
        '<span class="proj-mi-check">' + (active ? '<i data-lucide="check"></i>' : '') + '</span>' +
        '<span class="proj-mi-body">' +
          '<span class="proj-mi-name">' + esc(p.name) + '</span>' +
          '<span class="proj-mi-path" title="' + esc(p.path) + '">' + esc(shortPath(p.path)) + '</span>' +
        '</span>' +
        runChip +
      '</button>';
    }).join('');
    if (window.lucide) window.lucide.createIcons();
  }

  function openProjMenu() {
    var menu = document.getElementById('proj-menu');
    var btn = document.getElementById('btn-proj-switcher');
    if (!menu) return;
    renderProjectSwitcher();
    menu.classList.add('open');
    menu.setAttribute('aria-hidden', 'false');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    state.projMenuOpen = true;
  }
  function closeProjMenu() {
    var menu = document.getElementById('proj-menu');
    var btn = document.getElementById('btn-proj-switcher');
    if (!menu) return;
    menu.classList.remove('open');
    menu.setAttribute('aria-hidden', 'true');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    state.projMenuOpen = false;
  }

  (function wireProjSwitcher() {
    var btn = document.getElementById('btn-proj-switcher');
    if (btn) btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (state.projMenuOpen) closeProjMenu(); else openProjMenu();
    });
    var list = document.getElementById('proj-menu-list');
    if (list) list.addEventListener('click', function (e) {
      var item = e.target.closest('.proj-menu-item');
      if (!item) return;
      var id = item.getAttribute('data-project-id');
      closeProjMenu();
      if (id !== activeProjectId) setActiveProject(id);
    });
    var newBtn = document.getElementById('proj-menu-new');
    if (newBtn) newBtn.addEventListener('click', function () { closeProjMenu(); openProjectModal(); });
    var mngBtn = document.getElementById('proj-menu-manage');
    if (mngBtn) mngBtn.addEventListener('click', function () { closeProjMenu(); navigateTo('projects'); });
    /* Click-away + Escape close */
    document.addEventListener('click', function (e) {
      if (!state.projMenuOpen) return;
      if (e.target.closest('#proj-switcher')) return;
      closeProjMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.projMenuOpen) closeProjMenu();
    });
  })();

  function renderLaunchProfilePreview() {
    var box = document.getElementById('launch-profile-preview');
    var sel = document.getElementById('select-profile');
    if (!box || !sel) return;
    var p = profileById(sel.value);
    if (!p) { box.style.display = 'none'; box.innerHTML = ''; return; }
    var rows =
      '<div class="pp-row"><span class="pp-key">agent</span><span class="pp-val">' + esc(agentLabel(p.agentClass)) + '</span></div>';
    var ps = paramsSummary(p);
    if (ps) rows += '<div class="pp-row"><span class="pp-key">params</span><span class="pp-val">' + esc(ps) + '</span></div>';
    if (p.env && p.env.length) {
      rows += '<div class="pp-row"><span class="pp-key">env</span><span class="pp-val">' +
        esc(p.env.map(function (e) { return e.key + '=' + e.value; }).join(' ')) + '</span></div>';
    }
    if (p.startScript) rows += '<div class="pp-row"><span class="pp-key">script</span><span class="pp-val">' + esc(p.startScript) + '</span></div>';
    box.innerHTML = rows;
    box.style.display = '';
  }

  var $btnLaunch = document.getElementById('btn-launch');
  if ($btnLaunch) {
    $btnLaunch.addEventListener('click', function () {
      var projSel = document.getElementById('select-project');
      var profSel = document.getElementById('select-profile');
      var cwd     = document.getElementById('input-cwd');
      var prompt  = document.getElementById('input-prompt');

      if (!projSel || !projSel.value) {
        toast('Select a project — sessions are project-scoped', 'error');
        if (projSel) projSel.focus();
        return;
      }
      if (!profSel || !profSel.value) {
        toast('Select a profile — it defines the agent and params', 'error');
        if (profSel) profSel.focus();
        return;
      }
      /* cwd + prompt are both optional on the wire */
      var id = startSession(
        projSel.value, profSel.value,
        cwd ? cwd.value : '',
        prompt && prompt.value.trim() ? prompt.value.trim() : null
      );
      if (id && prompt) prompt.value = '';
    });
  }

  /* New-project inline → shared create-project modal */
  var $btnNewProject = document.getElementById('btn-new-project');
  if ($btnNewProject) {
    $btnNewProject.addEventListener('click', function () { openProjectModal(); });
  }

  /* New-profile inline → open the profile editor modal */
  var $btnNewProfileInline = document.getElementById('btn-new-profile-inline');
  if ($btnNewProfileInline) {
    $btnNewProfileInline.addEventListener('click', function () { openProfileModal(null); });
  }

  /* Browse dir button */
  var $btnBrowse = document.getElementById('btn-browse-dir');
  if ($btnBrowse) {
    $btnBrowse.addEventListener('click', function () {
      toast('Directory picker — not available in browser preview', 'info');
    });
  }

  /* ================================================================
     SESSION INFO DRAWER
  ================================================================ */

  function openDrawer(sessionId) {
    var sess = SESSIONS[sessionId || state.activeSession];
    if (!sess) return;

    /* Populate drawer fields */
    var setEl = function (id, txt) {
      var el = document.getElementById(id);
      if (el) el.textContent = txt || '—';
    };

    setEl('drawer-session-id', sess.sessionId);
    /* agent_session_id is captured async (AgentSessionCaptured) — may be pending */
    setEl('drawer-agent-session-id', sess.agentSessionId
      ? sess.agentSessionId.slice(0, 18) + '…' + sess.agentSessionId.slice(-4)
      : (isLive(sess) ? 'pending…' : '—'));
    /* agent_session_name also arrives with AgentSessionCaptured (Option<String>) */
    setEl('drawer-agent-session-name', sess.agentSessionName
      || (sess.agentSessionId ? '—' : (isLive(sess) ? 'pending…' : '—')));
    setEl('drawer-session-name', sess.name);
    setEl('drawer-cwd', sess.cwd);
    setEl('drawer-created-at', sess.createdAt);

    /* Project — clickable: jump to that project (set active + go to sessions). */
    var projEl = document.getElementById('drawer-project');
    if (projEl) {
      var pj = projectById(sess.projectId);
      projEl.textContent = pj ? pj.name : '—';
      if (pj) {
        projEl.className = 'meta-val meta-link';
        projEl.setAttribute('role', 'button');
        projEl.setAttribute('tabindex', '0');
        projEl.title = 'Go to ' + pj.path;
        projEl.onclick = function () { closeDrawer(); setActiveProject(pj.id); navigateTo('sessions'); };
      } else {
        projEl.className = 'meta-val';
        projEl.onclick = null;
        projEl.removeAttribute('role');
      }
    }

    /* Profile — name of the launching profile. */
    var profEl = document.getElementById('drawer-profile');
    if (profEl) {
      var pr = profileById(sess.profileId);
      profEl.textContent = pr ? pr.name : '—';
    }

    /* Activity (ActivityState overlay while running). */
    var actRow = document.getElementById('drawer-activity-row');
    var actEl = document.getElementById('drawer-activity');
    if (actRow && actEl) {
      if (isLive(sess) && sess.activity) {
        actRow.style.display = '';
        actEl.textContent = sess.activity === 'awaiting_input' ? 'Awaiting input'
          : sess.activity === 'working' ? 'Working' : 'Idle';
        actEl.className = 'meta-val activity-pill ' + sess.activity;
      } else {
        actRow.style.display = 'none';
      }
    }

    var agentEl = document.getElementById('drawer-agent');
    if (agentEl) {
      agentEl.textContent = sess.agent;
      agentEl.className = 'meta-val ' + sess.agentClass;
      agentEl.style.fontFamily = 'var(--font-ui)';
    }

    /* Status banner */
    var banner = document.getElementById('drawer-status-banner');
    if (banner) {
      banner.className = 'session-status-banner ' + sess.status;
    }
    setEl('drawer-status-label', sess.status.charAt(0).toUpperCase() + sess.status.slice(1));

    /* Exit code row */
    var exitRow = document.getElementById('drawer-exit-row');
    if (exitRow) {
      if (sess.exitCode !== undefined) {
        exitRow.style.display = '';
        setEl('drawer-exit-code', String(sess.exitCode));
      } else {
        exitRow.style.display = 'none';
      }
    }

    /* Open */
    state.drawerOpen = true;
    $drawer.classList.add('open');
    $drawerOverlay.classList.add('open');
    $drawerOverlay.removeAttribute('aria-hidden');
    $btnCloseDrawer && $btnCloseDrawer.focus();
  }

  function closeDrawer() {
    state.drawerOpen = false;
    $drawer.classList.remove('open');
    $drawerOverlay.classList.remove('open');
    $drawerOverlay.setAttribute('aria-hidden', 'true');
  }

  if ($btnCloseDrawer) $btnCloseDrawer.addEventListener('click', closeDrawer);
  if ($drawerOverlay)  $drawerOverlay.addEventListener('click',  closeDrawer);

  /* Session Info button in topbar */
  var $btnInfo = document.getElementById('btn-session-info');
  if ($btnInfo) {
    $btnInfo.addEventListener('click', function () {
      openDrawer(state.activeSession);
    });
  }

  /* Drawer action buttons */
  var $drawerKill = document.getElementById('drawer-btn-kill');
  if ($drawerKill) {
    $drawerKill.addEventListener('click', function () {
      toast('Kill signal sent', 'info');
      closeDrawer();
    });
  }

  var $drawerRestart = document.getElementById('drawer-btn-restart');
  if ($drawerRestart) {
    $drawerRestart.addEventListener('click', function () {
      toast('Restarting session…', 'info');
      closeDrawer();
    });
  }

  /* Copy session ID buttons */
  function makeCopyBtn(btnId, sourceId) {
    var btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', function () {
      var source = document.getElementById(sourceId);
      var text = source ? source.textContent.trim() : '';
      if (text && navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () {
          toast('Copied: ' + text.slice(0, 32) + (text.length > 32 ? '…' : ''), 'success');
        }).catch(function () {
          toast('Copy failed', 'error');
        });
      } else {
        toast('Copy not supported', 'error');
      }
    });
  }

  makeCopyBtn('btn-copy-session-id',       'drawer-session-id');
  makeCopyBtn('btn-copy-agent-session-id', 'drawer-agent-session-id');

  /* ================================================================
     9ROUTER PANEL
  ================================================================ */

  var r9State = 'stopped'; /* 'stopped' | 'running' | 'detecting' */

  function setR9State(newState) {
    r9State = newState;

    var dot    = document.getElementById('r9-conn-dot');
    var label  = document.getElementById('r9-status-label');
    var btnStart = document.getElementById('btn-r9-start');
    var btnStop  = document.getElementById('btn-r9-stop');
    var pidChip  = document.getElementById('r9-pid-chip');
    var pidVal   = document.getElementById('r9-pid');

    if (newState === 'running') {
      if (dot)   { dot.className = 'conn-dot connected'; }
      if (label) label.textContent = 'Running';
      if (btnStart) btnStart.style.display = 'none';
      if (btnStop)  btnStop.style.display = '';
      if (pidChip) { pidChip.style.display = ''; pidChip.textContent = 'pid: 24891'; }
      if (pidVal)  pidVal.textContent = '24891';
    } else if (newState === 'detecting') {
      if (dot)   { dot.className = 'conn-dot'; }
      if (label) label.textContent = 'Detecting…';
    } else {
      if (dot)   { dot.className = 'conn-dot'; }
      if (label) label.textContent = 'Stopped';
      if (btnStart) btnStart.style.display = '';
      if (btnStop)  btnStop.style.display = 'none';
      if (pidChip) pidChip.style.display = 'none';
      if (pidVal)  pidVal.textContent = '—';
    }
  }

  var $btnR9Detect = document.getElementById('btn-r9-detect');
  var $btnR9Start  = document.getElementById('btn-r9-start');
  var $btnR9Stop   = document.getElementById('btn-r9-stop');

  if ($btnR9Detect) {
    $btnR9Detect.addEventListener('click', function () {
      setR9State('detecting');
      toast('Detecting 9Router…', 'info');
      setTimeout(function () {
        setR9State('stopped');
        var pathEl = document.getElementById('r9-resolved-path');
        if (pathEl) pathEl.textContent = 'not installed';
        toast('9Router not found in PATH', 'error');
      }, 1200);
    });
  }

  if ($btnR9Start) {
    $btnR9Start.addEventListener('click', function () {
      toast('Starting 9Router…', 'info');
      setTimeout(function () {
        setR9State('running');
        toast('9Router started on :20128', 'success');
        /* Swap placeholder for iframe */
        var ph = document.getElementById('r9-iframe-placeholder');
        if (ph) {
          ph.innerHTML = '<iframe src="about:blank" title="9Router dashboard"></iframe>';
        }
      }, 900);
    });
  }

  if ($btnR9Stop) {
    $btnR9Stop.addEventListener('click', function () {
      setR9State('stopped');
      toast('9Router stopped', 'info');
      /* Restore placeholder */
      var ph = document.getElementById('r9-iframe-placeholder');
      if (ph) {
        ph.innerHTML = [
          '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.2" width="32" height="32" style="opacity:.4;">',
          '<rect x="2" y="4" width="28" height="24" rx="2"/><line x1="2" y1="10" x2="30" y2="10"/>',
          '<circle cx="6" cy="7" r="1" fill="currentColor" stroke="none"/>',
          '<circle cx="10" cy="7" r="1" fill="currentColor" stroke="none"/>',
          '</svg>',
          '<span>Dashboard unavailable — 9Router not running</span>',
          '<span style="font-size:10px;opacity:.5;">Start 9Router to load the dashboard</span>'
        ].join('');
      }
    });
  }

  /* ================================================================
     LIVE TICK — elapsed + relative times, once per second
  ================================================================ */

  setInterval(function () {
    var anyRunning = Object.keys(SESSIONS).some(function (id) { return SESSIONS[id].status === 'running'; });
    if (!anyRunning) return;

    /* Active terminal header elapsed */
    if (state.activeView === 'sessions') {
      var s = SESSIONS[state.activeSession];
      if (s && s.status === 'running') {
        var el = $termView.querySelector('.terminal-elapsed');
        if (el) el.textContent = sessElapsed(s);
      }
    }
    /* Sidebar relative times */
    document.querySelectorAll('.session-item').forEach(function (item) {
      var id = item.getAttribute('data-session-id');
      var sess = SESSIONS[id];
      if (sess && sess.status === 'running') {
        var t = item.querySelector('.session-item-time');
        if (t) t.textContent = relTime(sess);
      }
    });
    /* Overview relative times (when visible) */
    if (state.activeView === 'overview') {
      document.querySelectorAll('.sessions-table-row').forEach(function (row) {
        var id = row.getAttribute('data-session-id');
        var sess = SESSIONS[id];
        if (sess && sess.status === 'running') {
          var cell = row.children[3];
          if (cell) cell.textContent = relTime(sess);
        }
      });
    }
  }, 1000);

  /* ================================================================
     TOAST NOTIFICATIONS
  ================================================================ */

  function toast(message, type) {
    type = type || 'info';
    var el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = message;
    el.setAttribute('role', 'status');
    $toastCont.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 3000);
  }

  /* ================================================================
     KEYBOARD SHORTCUTS
  ================================================================ */

  document.addEventListener('keydown', function (e) {
    /* Escape always closes the top-most layer, even from an input */
    if (e.key === 'Escape' && (state.confirmOpen || state.modalOpen)) {
      if (state.confirmOpen) closeConfirm(); else closeProfileModal();
      return;
    }

    /* Ignore if focus is in an input */
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.activeElement && document.activeElement.isContentEditable) return;

    /* Modifier shortcuts */
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      var $btn = document.getElementById('btn-launch');
      if ($btn && state.activeView === 'launch') { e.preventDefault(); $btn.click(); }
      return;
    }

    /* Escape: close confirm → modal → drawer (top-most first) */
    if (e.key === 'Escape') {
      if (state.confirmOpen) { closeConfirm(); return; }
      if (state.projModalOpen) { closeProjectModal(); return; }
      if (state.modalOpen) { closeProfileModal(); return; }
      if (state.drawerOpen) { closeDrawer(); return; }
    }

    /* No modifier, single key shortcuts */
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.key) {
      case 's': case 'S': navigateTo('sessions');  break;
      case 'n': case 'N': navigateTo('launch');    break;
      case 'o': case 'O': navigateTo('overview');  break;
      case 'g': case 'G': navigateTo('projects');  break;
      case 'p': case 'P': navigateTo('profiles');  break;
      case ',':            navigateTo('settings'); break;
    }
  });

  /* ================================================================
     AGENT PROFILES
  ================================================================ */

  var STORAGE_PROFILES = 'agentry:profiles';

  var COLOR_HEX = {
    blue: '#3b82f6', violet: '#8b5cf6', green: '#22c55e',
    amber: '#f59e0b', rose: '#f43f5e', cyan: '#06b6d4'
  };

  /* ── Profiles — mirror wire CreateProfileCmd ─────────────────────
     Daemon-bound fields: name, agentType (1:1 agent_type), params[{flag,value}],
     env[{key,value}], startScript. agentClass is DERIVED from agentType for
     CSS/icons only. Client-only (localStorage, never sent): color, template. NOTE: cwd + model are NOT profile fields in the wire —
     cwd is per-launch (StartSessionCmd.cwd, falls back to project path) and
     "model" is just one ParamEntry (e.g. {flag:'--model', value:'…'}). */
  var DEFAULT_PROFILES = [
    {
      id: 'prof-1', name: 'Frontend — Claude Code',
      agentType: 'claude_code', agentClass: 'agent-claude',
      params: [{ flag: '--model', value: 'claude-sonnet-4-5' }],
      env: [], startScript: '',
      template: '', color: 'blue', uses: 12
    },
    {
      id: 'prof-2', name: 'Rust Review — Codex',
      agentType: 'codex', agentClass: 'agent-codex',
      params: [{ flag: '--model', value: 'codex-1' }],
      env: [{ key: 'RUST_LOG', value: 'debug' }], startScript: '',
      template: 'Review the diff on {{branch}} for safety + perf regressions.',
      color: 'violet', uses: 5
    },
    {
      id: 'prof-3', name: 'Quick Fix — OpenCode',
      agentType: 'open_code', agentClass: 'agent-opencode',
      params: [], env: [], startScript: '',
      template: '', color: 'green', uses: 28
    }
  ];

  var PROFILES = [];
  var pfSeq = 4;          /* next prof id counter */
  var pfEditingId = null; /* null = creating, else editing */
  var pfFormColor = 'blue';
  var pfFormAgent = 'agent-claude';

  /* ── Projects — mirror wire ProjectInfo {id,name,path} ───────────
     A session REQUIRES a project_id (StartSessionCmd.project_id). */
  var STORAGE_PROJECTS = 'agentry:projects';
  var DEFAULT_PROJECTS = [
    { id: 'proj-1', name: 'api-server',     path: '/home/user/projects/api-server' },
    { id: 'proj-2', name: 'parser-lib',     path: '/home/user/projects/parser-lib' },
    { id: 'proj-3', name: 'db-migrations',  path: '/home/user/projects/db-migrations' }
  ];
  var PROJECTS = [];
  var projSeq = 4;

  function loadProjects() {
    try {
      var raw = localStorage.getItem(STORAGE_PROJECTS);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) {
          PROJECTS = parsed;
          parsed.forEach(function (p) {
            var n = parseInt((p.id || '').replace('proj-', ''), 10);
            if (!isNaN(n) && n >= projSeq) projSeq = n + 1;
          });
          return;
        }
      }
    } catch (e) {}
    PROJECTS = DEFAULT_PROJECTS.slice();
  }
  function saveProjects() {
    try { localStorage.setItem(STORAGE_PROJECTS, JSON.stringify(PROJECTS)); } catch (e) {}
  }
  function projectById(id) {
    for (var i = 0; i < PROJECTS.length; i++) if (PROJECTS[i].id === id) return PROJECTS[i];
    return null;
  }

  /* ── Active project — the app-wide scope ─────────────────────────
     At any moment exactly one project is "active": the sidebar session
     list, quick-launch, and the launch form default all follow it.
     Persisted across app restarts. */
  var STORAGE_ACTIVE_PROJECT = 'agentry:activeProject';
  var activeProjectId = null;

  function loadActiveProject() {
    try { activeProjectId = localStorage.getItem(STORAGE_ACTIVE_PROJECT) || null; } catch (e) {}
    if (activeProjectId && !projectById(activeProjectId)) activeProjectId = null;
    if (!activeProjectId && PROJECTS.length) activeProjectId = PROJECTS[0].id;
  }
  function activeProject() { return projectById(activeProjectId); }

  /* Count helper: running (live) + total sessions per project. */
  function projectSessionCounts(projectId) {
    var running = 0, total = 0;
    Object.keys(SESSIONS).forEach(function (id) {
      var s = SESSIONS[id];
      if (s.projectId !== projectId) return;
      total++;
      if (isLive(s)) running++;
    });
    return { running: running, total: total };
  }

  /* Shorten long absolute paths for display: /home/user/projects/api-server
     → ~/…/api-server (keep first + last segment). */
  function shortPath(path) {
    if (!path) return '';
    var p = path.replace(/^\/home\/[^/]+/, '~').replace(/^\/Users\/[^/]+/, '~');
    var parts = p.split('/');
    if (parts.length <= 3) return p;
    return parts[0] + '/…/' + parts[parts.length - 1];
  }

  /* Switch the app-wide active project. Re-scopes sidebar, overview,
     quick-launch and the launch form default. */
  function setActiveProject(id, opts) {
    if (id && !projectById(id)) return;
    activeProjectId = id || null;
    try {
      if (id) localStorage.setItem(STORAGE_ACTIVE_PROJECT, id);
      else localStorage.removeItem(STORAGE_ACTIVE_PROJECT);
    } catch (e) {}

    /* If the focused session belongs to another project, drop focus to
       the first session of the new scope (or none). */
    var act = SESSIONS[state.activeSession];
    if (act && act.projectId !== activeProjectId) {
      var firstId = null;
      Object.keys(SESSIONS).some(function (sid) {
        if (SESSIONS[sid].projectId === activeProjectId) { firstId = sid; return true; }
        return false;
      });
      state.activeSession = firstId;
    }

    renderProjectSwitcher();
    renderSidebar();
    renderOverview();
    renderProjectSelect();
    renderProjectsView();
    if (state.activeSession) selectSession(state.activeSession);
    else clearTerminalPane();
    if (!(opts && opts.silent)) {
      var p = activeProject();
      if (p) toast('Switched to ' + p.name, 'info');
    }
  }

  /* Blank the terminal pane when the active scope has no session. */
  function clearTerminalPane() {
    if (!$termView) return;
    var titleEl = $termView.querySelector('.terminal-session-title');
    if (titleEl) titleEl.textContent = 'No session selected';
    var meta = $termView.querySelector('.terminal-session-meta');
    if (meta) meta.innerHTML = '<span class="mono-chip">—</span>';
    var out = $termView.querySelector('.terminal-output');
    if (out) out.innerHTML = '<span style="color:var(--fg-3);">No session in this project yet. Press N to launch one.</span>';
    if ($topbarTitle && state.activeView === 'sessions') $topbarTitle.textContent = 'Sessions';
  }

  /* ── Create-project modal (wire CreateProjectCmd {name, path}) ── */
  function openProjectModal() {
    var ov = document.getElementById('project-modal-overlay');
    var md = document.getElementById('project-modal');
    var pathEl = document.getElementById('proj-input-path');
    var nameEl = document.getElementById('proj-input-name');
    var err = document.getElementById('proj-path-error');
    if (!md) return;
    if (pathEl) pathEl.value = '';
    if (nameEl) { nameEl.value = ''; nameEl.dataset.touched = ''; }
    if (err) err.style.display = 'none';
    state.projModalOpen = true;
    md.classList.add('open'); md.setAttribute('aria-hidden', 'false');
    if (ov) { ov.classList.add('open'); ov.removeAttribute('aria-hidden'); }
    if (window.lucide) window.lucide.createIcons();
    setTimeout(function () { if (pathEl) pathEl.focus(); }, 40);
  }
  function closeProjectModal() {
    var ov = document.getElementById('project-modal-overlay');
    var md = document.getElementById('project-modal');
    state.projModalOpen = false;
    if (md) { md.classList.remove('open'); md.setAttribute('aria-hidden', 'true'); }
    if (ov) { ov.classList.remove('open'); ov.setAttribute('aria-hidden', 'true'); }
  }
  function baseName(path) {
    return (path || '').replace(/\/+$/, '').split('/').pop() || '';
  }
  function createProjectFromModal() {
    var pathEl = document.getElementById('proj-input-path');
    var nameEl = document.getElementById('proj-input-name');
    var err = document.getElementById('proj-path-error');
    var path = pathEl ? pathEl.value.trim().replace(/\/+$/, '') : '';
    var name = nameEl ? nameEl.value.trim() : '';
    function fail(msg) { if (err) { err.textContent = msg; err.style.display = ''; } }

    if (!path) { fail('Path is required.'); if (pathEl) pathEl.focus(); return; }
    /* Duplicate path check (daemon rejects a project with the same path). */
    var dup = PROJECTS.filter(function (p) { return p.path === path; })[0];
    if (dup) { fail('A project already exists at this path: “' + dup.name + '”.'); return; }
    if (!name) name = baseName(path) || path;

    var proj = { id: 'proj-' + projSeq++, name: name, path: path };
    PROJECTS.push(proj);
    saveProjects();
    closeProjectModal();
    setActiveProject(proj.id, { silent: true }); /* new project becomes active */
    renderProjectSwitcher();
    renderProjectsView();
    toast('Project “' + name + '” created', 'success');
  }

  (function wireProjectModal() {
    var ov = document.getElementById('project-modal-overlay');
    var pathEl = document.getElementById('proj-input-path');
    var nameEl = document.getElementById('proj-input-name');
    if (pathEl) pathEl.addEventListener('input', function () {
      /* Suggest name from folder unless the user has edited it. */
      if (nameEl && !nameEl.dataset.touched) nameEl.value = baseName(pathEl.value);
    });
    if (nameEl) nameEl.addEventListener('input', function () { nameEl.dataset.touched = '1'; });
    ['proj-btn-cancel', 'btn-close-project-modal'].forEach(function (bid) {
      var b = document.getElementById(bid);
      if (b) b.addEventListener('click', closeProjectModal);
    });
    if (ov) ov.addEventListener('click', closeProjectModal);
    var create = document.getElementById('proj-btn-create');
    if (create) create.addEventListener('click', createProjectFromModal);
    var browse = document.getElementById('proj-btn-browse');
    if (browse) browse.addEventListener('click', function () {
      /* In the desktop shell this opens the native dir picker; the prototype
         simulates a pick so name auto-fill is demonstrable. */
      var demo = '/home/user/projects/new-project';
      if (pathEl) { pathEl.value = demo; pathEl.dispatchEvent(new Event('input')); }
      toast('Native picker — simulated in browser preview', 'info');
    });
    [pathEl, nameEl].forEach(function (el) {
      if (el) el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); createProjectFromModal(); }
      });
    });
  })();

  /* ── Projects manager view (the "library") ───────────────────── */
  function renderProjectsView() {
    var grid = document.getElementById('projects-grid');
    var empty = document.getElementById('empty-projects');
    if (!grid) return;
    if (!PROJECTS.length) {
      grid.innerHTML = '';
      grid.style.display = 'none';
      if (empty) empty.style.display = '';
      if (window.lucide) window.lucide.createIcons();
      return;
    }
    grid.style.display = '';
    if (empty) empty.style.display = 'none';
    grid.innerHTML = PROJECTS.map(function (p) {
      var counts = projectSessionCounts(p.id);
      var active = p.id === activeProjectId;
      return '<div class="project-card' + (active ? ' active' : '') + '" data-project-id="' + p.id + '">' +
        '<div class="pc-head">' +
          '<span class="pc-name">' + esc(p.name) + (active ? ' <span class="pc-active-tag">active</span>' : '') + '</span>' +
          '<div class="pc-actions">' +
            (active ? '' : '<button class="btn btn-secondary btn-xs" data-pj-action="switch" data-project-id="' + p.id + '">Switch</button>') +
            '<button class="icon-btn pc-del" title="Delete project" aria-label="Delete project" data-pj-action="delete" data-project-id="' + p.id + '"><i data-lucide="trash-2"></i></button>' +
          '</div>' +
        '</div>' +
        '<div class="pc-path" title="' + esc(p.path) + '">' + esc(p.path) + '</div>' +
        '<div class="pc-stats">' +
          (counts.running > 0
            ? '<span class="pc-stat running"><span class="proj-run-dot"></span>' + counts.running + ' running</span>'
            : '<span class="pc-stat muted">idle</span>') +
          '<span class="pc-stat muted">' + counts.total + ' total</span>' +
        '</div>' +
      '</div>';
    }).join('');
    if (window.lucide) window.lucide.createIcons();
  }

  function deleteProject(id) {
    var p = projectById(id);
    if (!p) return;
    var counts = projectSessionCounts(id);
    var live = counts.running;
    var body = live > 0
      ? 'Project “' + p.name + '” has ' + live + ' running session' + (live > 1 ? 's' : '') +
        ' and ' + counts.total + ' total. Deleting it will kill running agents and remove all its sessions. This cannot be undone.'
      : 'Delete “' + p.name + '”? Its ' + counts.total + ' session' + (counts.total === 1 ? '' : 's') +
        ' will be removed. This cannot be undone.';
    openConfirm(
      live > 0 ? 'Delete project with running sessions?' : 'Delete project?',
      body,
      live > 0 ? 'Kill & delete' : 'Delete',
      function () {
      /* Kill + drop every session of this project. */
      Object.keys(SESSIONS).forEach(function (sid) {
        if (SESSIONS[sid].projectId !== id) return;
        stopStream(sid);
        if (state.activeSession === sid) state.activeSession = null;
        delete SESSIONS[sid];
      });
      PROJECTS = PROJECTS.filter(function (x) { return x.id !== id; });
      saveProjects();
      /* Active failover → first remaining project, or none. */
      if (activeProjectId === id) {
        setActiveProject(PROJECTS.length ? PROJECTS[0].id : null, { silent: true });
      } else {
        renderProjectSwitcher(); renderSidebar(); renderOverview();
      }
      renderProjectsView();
      renderProjectSelect();
      toast('Project “' + p.name + '” deleted', 'info');
    });
  }

  (function wireProjectsView() {
    var grid = document.getElementById('projects-grid');
    if (grid) grid.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-pj-action]');
      if (btn) {
        var act = btn.getAttribute('data-pj-action');
        var id = btn.getAttribute('data-project-id');
        if (act === 'switch') setActiveProject(id);
        else if (act === 'delete') deleteProject(id);
        return;
      }
      /* Card click (not on a button) → switch + go to sessions. */
      var card = e.target.closest('.project-card');
      if (card) {
        var pid = card.getAttribute('data-project-id');
        if (pid !== activeProjectId) setActiveProject(pid);
        navigateTo('sessions');
      }
    });
    ['btn-projects-new', 'btn-empty-new-project'].forEach(function (bid) {
      var b = document.getElementById(bid);
      if (b) b.addEventListener('click', openProjectModal);
    });
  })();

  /* ── Command palette (⌘K / Ctrl-K) ───────────────────────────── */
  var paletteItems = [];
  var paletteIdx = 0;
  function buildPaletteItems(q) {
    q = (q || '').toLowerCase().trim();
    var items = [];
    /* Projects */
    PROJECTS.forEach(function (p) {
      items.push({
        type: 'project', icon: 'folder-git-2',
        label: p.name, sub: shortPath(p.path),
        hay: (p.name + ' ' + p.path).toLowerCase(),
        run: function () { setActiveProject(p.id); navigateTo('sessions'); }
      });
    });
    /* Sessions */
    Object.keys(SESSIONS).forEach(function (id) {
      var s = SESSIONS[id];
      var pj = projectById(s.projectId);
      items.push({
        type: 'session', icon: 'terminal',
        label: s.name, sub: (pj ? pj.name + ' · ' : '') + agentLabel(s.agentClass),
        hay: (s.name + ' ' + (pj ? pj.name : '') + ' ' + s.agent).toLowerCase(),
        run: function () {
          if (s.projectId !== activeProjectId) setActiveProject(s.projectId, { silent: true });
          selectSession(id); navigateTo('sessions');
        }
      });
    });
    /* Views + actions */
    [['Sessions', 'layout-list', 'sessions'], ['New Session', 'circle-plus', 'launch'],
     ['Overview', 'grid-2x2', 'overview'], ['Projects', 'folder-git-2', 'projects'],
     ['Profiles', 'bookmark', 'profiles'], ['Settings', 'settings-2', 'settings'],
     ['9Router', 'network', 'r9router']].forEach(function (v) {
      items.push({
        type: 'view', icon: v[1], label: v[0], sub: 'Go to view',
        hay: v[0].toLowerCase(), run: function () { navigateTo(v[2]); }
      });
    });
    items.push({
      type: 'action', icon: 'folder-plus', label: 'New project…', sub: 'Create a project',
      hay: 'new project create', run: function () { openProjectModal(); }
    });
    if (!q) return items.slice(0, 12);
    return items.filter(function (it) { return it.hay.indexOf(q) !== -1; }).slice(0, 14);
  }
  function renderPalette(q) {
    var box = document.getElementById('palette-results');
    if (!box) return;
    paletteItems = buildPaletteItems(q);
    if (paletteIdx >= paletteItems.length) paletteIdx = 0;
    if (!paletteItems.length) {
      box.innerHTML = '<div class="palette-empty">No matches.</div>';
      return;
    }
    box.innerHTML = paletteItems.map(function (it, i) {
      return '<button class="palette-item' + (i === paletteIdx ? ' active' : '') + '" role="option" data-idx="' + i + '">' +
        '<i data-lucide="' + it.icon + '"></i>' +
        '<span class="pi-label">' + esc(it.label) + '</span>' +
        '<span class="pi-type">' + it.type + '</span>' +
        '<span class="pi-sub">' + esc(it.sub || '') + '</span>' +
      '</button>';
    }).join('');
    if (window.lucide) window.lucide.createIcons();
  }
  function openPalette() {
    var ov = document.getElementById('palette-overlay');
    var pl = document.getElementById('palette');
    var inp = document.getElementById('palette-input');
    if (!pl) return;
    state.paletteOpen = true;
    paletteIdx = 0;
    if (inp) inp.value = '';
    renderPalette('');
    pl.classList.add('open'); pl.setAttribute('aria-hidden', 'false');
    if (ov) { ov.classList.add('open'); ov.removeAttribute('aria-hidden'); }
    setTimeout(function () { if (inp) inp.focus(); }, 30);
  }
  function closePalette() {
    var ov = document.getElementById('palette-overlay');
    var pl = document.getElementById('palette');
    state.paletteOpen = false;
    if (pl) { pl.classList.remove('open'); pl.setAttribute('aria-hidden', 'true'); }
    if (ov) { ov.classList.remove('open'); ov.setAttribute('aria-hidden', 'true'); }
  }
  function runPaletteItem(i) {
    var it = paletteItems[i];
    if (!it) return;
    closePalette();
    it.run();
  }
  (function wirePalette() {
    var inp = document.getElementById('palette-input');
    var box = document.getElementById('palette-results');
    var ov = document.getElementById('palette-overlay');
    if (inp) inp.addEventListener('input', function () { paletteIdx = 0; renderPalette(inp.value); });
    if (inp) inp.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); paletteIdx = Math.min(paletteIdx + 1, paletteItems.length - 1); renderPalette(inp.value); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); paletteIdx = Math.max(paletteIdx - 1, 0); renderPalette(inp.value); }
      else if (e.key === 'Enter') { e.preventDefault(); runPaletteItem(paletteIdx); }
    });
    if (box) box.addEventListener('click', function (e) {
      var item = e.target.closest('.palette-item');
      if (item) runPaletteItem(parseInt(item.getAttribute('data-idx'), 10));
    });
    if (ov) ov.addEventListener('click', closePalette);
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (state.paletteOpen) closePalette(); else openPalette();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        if (state.projMenuOpen) closeProjMenu(); else openProjMenu();
        return;
      }
      if (e.key === 'Escape' && state.paletteOpen) closePalette();
    });
  })();

  /* ── Settings — mirror wire GetSettings ─────────────────────────── */
  var STORAGE_DEFAULT_PROFILE = 'agentry:defaultProfile';
  var defaultProfileId = null;
  function loadDefaultProfile() {
    try { defaultProfileId = localStorage.getItem(STORAGE_DEFAULT_PROFILE) || null; } catch (e) {}
    if (defaultProfileId && !profileById(defaultProfileId)) defaultProfileId = null;
  }
  function setDefaultProfile(id) {
    defaultProfileId = id || null;
    try {
      if (id) localStorage.setItem(STORAGE_DEFAULT_PROFILE, id);
      else localStorage.removeItem(STORAGE_DEFAULT_PROFILE);
    } catch (e) {}
  }
  /* Pull a display "model" string out of a profile's params for cards. */
  function profileModel(p) {
    if (!p || !p.params) return '';
    for (var i = 0; i < p.params.length; i++) {
      var f = p.params[i].flag || '';
      if (f === '--model' || f === '-m' || f === '--model-name') return p.params[i].value || '';
    }
    return '';
  }
  function paramsSummary(p) {
    if (!p || !p.params || !p.params.length) return '';
    return p.params.map(function (e) {
      return e.flag + (e.value != null && e.value !== '' ? ' ' + e.value : '');
    }).join(' ');
  }
  var confirmCb = null;

  function loadProfiles() {
    try {
      var raw = localStorage.getItem(STORAGE_PROFILES);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          /* Migrate any pre-wire-schema profiles (had cwd/model/flags). */
          PROFILES = parsed.map(function (p) {
            if (!Array.isArray(p.params)) {
              var params = [];
              if (p.model) params.push({ flag: '--model', value: p.model });
              if (p.flags) {
                String(p.flags).split(/\s+/).forEach(function (f) {
                  if (f) params.push({ flag: f, value: null });
                });
              }
              p = {
                id: p.id, name: p.name, agentClass: p.agentClass,
                params: params, env: [], startScript: '',
                template: p.template || '', color: p.color || 'blue',
                uses: p.uses || 0
              };
            }
            if (!Array.isArray(p.env)) p.env = [];
            if (p.startScript == null) p.startScript = '';
            /* Backfill agentType for profiles saved before the 1:1 schema. */
            if (!p.agentType) p.agentType = agentTypeForClass(p.agentClass);
            p.agentClass = classForAgentType(p.agentType);
            return p;
          });
          PROFILES.forEach(function (p) {
            var n = parseInt((p.id || '').replace('prof-', ''), 10);
            if (!isNaN(n) && n >= pfSeq) pfSeq = n + 1;
          });
          return;
        }
      }
    } catch (e) {}
    PROFILES = DEFAULT_PROFILES.slice();
  }
  function saveProfiles() {
    try { localStorage.setItem(STORAGE_PROFILES, JSON.stringify(PROFILES)); } catch (e) {}
  }
  function profileById(id) {
    for (var i = 0; i < PROFILES.length; i++) if (PROFILES[i].id === id) return PROFILES[i];
    return null;
  }

  function shortDir(cwd, askDir) {
    if (askDir) return 'Ask each launch';
    return cwd || '—';
  }

  /* ── Render profile grid ─────────────────────────────────────── */
  var $profileGrid  = document.getElementById('profile-grid');
  var $profilesEmpty = document.getElementById('profiles-empty');

  function profileCardHtml(p) {
    var hex = COLOR_HEX[p.color] || COLOR_HEX.blue;
    var label = agentLabel(p.agentClass);
    var icon = AGENT_ICON[p.agentClass];
    var ic = iconClass(p.agentClass);
    var isDefault = p.id === defaultProfileId;
    var model = profileModel(p);
    var ps = paramsSummary(p);
    var envSummary = (p.env && p.env.length)
      ? p.env.map(function (e) { return e.key + '=' + e.value; }).join(' ')
      : '';
    return '<div class="profile-card" data-profile-id="' + p.id + '" style="--pf-color:' + hex + ';">' +
      '<div class="profile-card-top">' +
        '<div class="profile-card-name">' + esc(p.name) +
          (isDefault ? ' <span class="badge badge-queued" title="Default profile" style="vertical-align:middle;">default</span>' : '') +
        '</div>' +
        '<span class="profile-badge ' + p.agentClass + '">' +
          '<img class="' + ic + '" src="' + icon + '" alt="' + label + '" />' + label +
        '</span>' +
      '</div>' +
      '<div class="profile-meta">' +
        (model ? '<div class="profile-meta-row"><span class="k">model</span><span class="v">' + esc(model) + '</span></div>' : '') +
        (ps ? '<div class="profile-meta-row"><span class="k">params</span><span class="v">' + esc(ps) + '</span></div>' : '') +
        (envSummary ? '<div class="profile-meta-row"><span class="k">env</span><span class="v">' + esc(envSummary) + '</span></div>' : '') +
        (p.startScript ? '<div class="profile-meta-row"><span class="k">script</span><span class="v">' + esc(p.startScript) + '</span></div>' : '') +
        (!model && !ps && !envSummary && !p.startScript ? '<div class="profile-meta-row"><span class="k">params</span><span class="v">agent defaults</span></div>' : '') +
      '</div>' +
      '<div class="profile-card-actions">' +
        '<button class="btn btn-primary btn-sm btn-launch-card" data-pf-action="launch" data-profile-id="' + p.id + '">' +
          '<i data-lucide="play" style="width:12px;height:12px;"></i> Launch</button>' +
        '<button class="icon-btn" data-pf-action="default" data-profile-id="' + p.id + '" title="' + (isDefault ? 'Unset default' : 'Set as default') + '" aria-label="Set as default profile"><i data-lucide="star"' + (isDefault ? ' style="fill:currentColor;"' : '') + '></i></button>' +
        '<button class="icon-btn" data-pf-action="edit" data-profile-id="' + p.id + '" title="Edit" aria-label="Edit profile"><i data-lucide="pencil"></i></button>' +
        '<button class="icon-btn" data-pf-action="duplicate" data-profile-id="' + p.id + '" title="Duplicate" aria-label="Duplicate profile"><i data-lucide="copy"></i></button>' +
        '<button class="icon-btn" data-pf-action="delete" data-profile-id="' + p.id + '" title="Delete" aria-label="Delete profile"><i data-lucide="trash-2"></i></button>' +
        '<span class="profile-usage" title="Times launched">' + (p.uses || 0) + '×</span>' +
      '</div>' +
    '</div>';
  }

  function renderProfiles() {
    if (!$profileGrid) return;
    if (!PROFILES.length) {
      $profileGrid.innerHTML = '';
      $profileGrid.style.display = 'none';
      if ($profilesEmpty) $profilesEmpty.style.display = 'flex';
    } else {
      $profileGrid.style.display = '';
      if ($profilesEmpty) $profilesEmpty.style.display = 'none';
      $profileGrid.innerHTML = PROFILES.map(profileCardHtml).join('');
    }
    if (window.lucide) window.lucide.createIcons();
    renderProfileSelect();
  }

  /* Populate the launch panel "Profile" <select> + settings default select */
  function renderProfileSelect() {
    var sel = document.getElementById('select-profile');
    if (sel) {
      var cur = sel.value;
      sel.innerHTML = '<option value="">— Select a profile —</option>' +
        PROFILES.map(function (p) {
          var def = p.id === defaultProfileId ? ' (default)' : '';
          return '<option value="' + p.id + '">' + esc(p.name) + def + '</option>';
        }).join('');
      if (cur && profileById(cur)) sel.value = cur;
      else if (defaultProfileId && profileById(defaultProfileId)) sel.value = defaultProfileId;
      renderLaunchProfilePreview();
    }
    var dsel = document.getElementById('setting-default-profile');
    if (dsel) {
      dsel.innerHTML = '<option value="">— None —</option>' +
        PROFILES.map(function (p) {
          return '<option value="' + p.id + '"' + (p.id === defaultProfileId ? ' selected' : '') + '>' + esc(p.name) + '</option>';
        }).join('');
    }
  }

  /* ── Profile editor modal ────────────────────────────────────── */
  var $pfModal        = document.getElementById('profile-modal');
  var $pfModalOverlay = document.getElementById('profile-modal-overlay');
  var $pfModalTitle   = document.getElementById('profile-modal-title');

  /* ── KV-row editors (params + env) ───────────────────────────── */
  function kvRowHtml(kind, a, b) {
    var ph1 = kind === 'param' ? '--flag' : 'KEY';
    var ph2 = kind === 'param' ? 'value (optional)' : 'value';
    return '<div class="kv-row" data-kv="' + kind + '">' +
      '<input class="input" type="text" data-kv-a placeholder="' + ph1 + '" value="' + esc(a || '') + '" autocomplete="off" spellcheck="false" style="font-family:var(--font-mono);font-size:12px;" />' +
      '<span class="kv-eq">' + (kind === 'param' ? '' : '=') + '</span>' +
      '<input class="input" type="text" data-kv-b placeholder="' + ph2 + '" value="' + esc(b || '') + '" autocomplete="off" spellcheck="false" style="font-family:var(--font-mono);font-size:12px;" />' +
      '<button type="button" class="icon-btn" data-kv-remove aria-label="Remove row"><i data-lucide="x"></i></button>' +
    '</div>';
  }
  function addKvRow(listId, kind, a, b) {
    var list = document.getElementById(listId);
    if (!list) return;
    list.insertAdjacentHTML('beforeend', kvRowHtml(kind, a, b));
    if (window.lucide) window.lucide.createIcons();
  }
  function readKvList(listId) {
    var list = document.getElementById(listId);
    if (!list) return [];
    var out = [];
    list.querySelectorAll('.kv-row').forEach(function (row) {
      var a = (row.querySelector('[data-kv-a]') || {}).value || '';
      var b = (row.querySelector('[data-kv-b]') || {}).value || '';
      a = a.trim(); b = b.trim();
      if (!a) return;
      out.push({ a: a, b: b });
    });
    return out;
  }
  /* Remove-row delegation for both lists */
  ['pf-params-list', 'pf-env-list'].forEach(function (lid) {
    var list = document.getElementById(lid);
    if (!list) return;
    list.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-kv-remove]');
      if (btn) btn.closest('.kv-row').remove();
    });
  });
  wireKv('pf-add-param', 'pf-params-list', 'param');
  wireKv('pf-add-env', 'pf-env-list', 'env');
  function wireKv(btnId, listId, kind) {
    var b = document.getElementById(btnId);
    if (b) b.addEventListener('click', function () { addKvRow(listId, kind); });
  }

  function setModalAgent(agentClass) {
    pfFormAgent = agentClass;
    var picker = document.getElementById('pf-agent-picker');
    if (picker) {
      picker.querySelectorAll('.agent-card').forEach(function (c) {
        var on = c.getAttribute('data-agent') === agentClass;
        c.classList.toggle('selected', on);
        c.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }
  }

  function setModalColor(color) {
    pfFormColor = color;
    var picker = document.getElementById('pf-color-picker');
    if (picker) {
      picker.querySelectorAll('.swatch').forEach(function (s) {
        s.classList.toggle('selected', s.getAttribute('data-color') === color);
      });
    }
  }

  function openProfileModal(profile) {
    pfEditingId = profile ? profile.id : null;
    if ($pfModalTitle) $pfModalTitle.textContent = profile ? 'Edit Profile' : 'New Profile';

    var nameEl   = document.getElementById('pf-name');
    var scriptEl = document.getElementById('pf-start-script');
    var tplEl    = document.getElementById('pf-template');
    var delBtn   = document.getElementById('btn-profile-delete');

    var p = profile || {};
    setModalAgent(p.agentClass || 'agent-claude');
    setModalColor(p.color || 'blue');
    if (nameEl)   nameEl.value = p.name || '';
    if (scriptEl) scriptEl.value = p.startScript || '';
    if (tplEl)    tplEl.value = p.template || '';
    if (delBtn)   delBtn.style.display = profile ? '' : 'none';

    /* Fill params + env KV editors */
    var paramsList = document.getElementById('pf-params-list');
    var envList = document.getElementById('pf-env-list');
    if (paramsList) paramsList.innerHTML = '';
    if (envList) envList.innerHTML = '';
    (p.params || []).forEach(function (e) { addKvRow('pf-params-list', 'param', e.flag, e.value == null ? '' : e.value); });
    (p.env || []).forEach(function (e) { addKvRow('pf-env-list', 'env', e.key, e.value); });

    if (window.lucide) window.lucide.createIcons();
    if ($pfModalOverlay) $pfModalOverlay.classList.add('open');
    if ($pfModal) {
      $pfModal.classList.add('open');
      $pfModal.setAttribute('aria-hidden', 'false');
    }
    state.modalOpen = true;
    if (nameEl) setTimeout(function () { nameEl.focus(); }, 50);
  }

  function closeProfileModal() {
    if ($pfModalOverlay) $pfModalOverlay.classList.remove('open');
    if ($pfModal) {
      $pfModal.classList.remove('open');
      $pfModal.setAttribute('aria-hidden', 'true');
    }
    state.modalOpen = false;
  }

  function saveProfileFromModal() {
    var nameEl = document.getElementById('pf-name');
    var name = nameEl ? nameEl.value.trim() : '';
    if (!name) {
      toast('Profile name is required', 'error');
      if (nameEl) nameEl.focus();
      return;
    }
    /* Wire create_profile / update_profile payload:
       {name, agent_type, params:[{flag,value}], env:[{key,value}], start_script}
       agentType below maps 1:1 to agent_type; agentClass is derived for CSS.
       Client-only extras kept in localStorage: template, color */
    var agentType = agentTypeForClass(pfFormAgent);
    var data = {
      name: name,
      agentType: agentType,
      agentClass: classForAgentType(agentType),
      params: readKvList('pf-params-list').map(function (e) {
        return { flag: e.a, value: e.b || null }; /* ParamEntry.value: Option<String> */
      }),
      env: readKvList('pf-env-list').filter(function (e) {
        /* EnvEntry.value is String (required, not Option) — drop incomplete rows */
        return e.b !== '';
      }).map(function (e) {
        return { key: e.a, value: e.b };
      }),
      startScript: ((document.getElementById('pf-start-script') || {}).value || '').trim(),
      template: (document.getElementById('pf-template') || {}).value || '',
      color: pfFormColor
    };

    if (pfEditingId) {
      var existing = profileById(pfEditingId);
      if (existing) {
        existing.name = data.name;
        existing.agentType = data.agentType; existing.agentClass = data.agentClass;
        existing.params = data.params; existing.env = data.env;
        existing.startScript = data.startScript;
        existing.template = data.template; existing.color = data.color;
      }
      toast('Profile updated', 'success');
    } else {
      data.id = 'prof-' + pfSeq++;
      data.uses = 0;
      PROFILES.push(data);
      toast('Profile created', 'success');
    }
    saveProfiles();
    renderProfiles();
    closeProfileModal();
  }

  function duplicateProfile(id) {
    var src = profileById(id);
    if (!src) return;
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = 'prof-' + pfSeq++;
    copy.name = src.name + ' (copy)';
    copy.uses = 0;
    PROFILES.push(copy);
    saveProfiles();
    renderProfiles();
    toast('Profile duplicated', 'success');
  }

  function deleteProfile(id) {
    var idx = -1;
    for (var i = 0; i < PROFILES.length; i++) if (PROFILES[i].id === id) { idx = i; break; }
    if (idx === -1) return;
    PROFILES.splice(idx, 1);
    if (defaultProfileId === id) setDefaultProfile(null);
    saveProfiles();
    renderProfiles();
    toast('Profile deleted', 'info');
  }

  /* ── Confirm dialog ──────────────────────────────────────────── */
  var $confirmDialog  = document.getElementById('confirm-dialog');
  var $confirmOverlay = document.getElementById('confirm-overlay');

  function openConfirm(title, msg, okLabel, cb) {
    var t = document.getElementById('confirm-title');
    var m = document.getElementById('confirm-msg');
    var ok = document.getElementById('btn-confirm-ok');
    if (t) t.textContent = title;
    if (m) m.textContent = msg;
    if (ok) ok.textContent = okLabel || 'Confirm';
    confirmCb = cb;
    if ($confirmOverlay) $confirmOverlay.classList.add('open');
    if ($confirmDialog) {
      $confirmDialog.classList.add('open');
      $confirmDialog.setAttribute('aria-hidden', 'false');
    }
    state.confirmOpen = true;
  }
  function closeConfirm() {
    if ($confirmOverlay) $confirmOverlay.classList.remove('open');
    if ($confirmDialog) {
      $confirmDialog.classList.remove('open');
      $confirmDialog.setAttribute('aria-hidden', 'true');
    }
    confirmCb = null;
    state.confirmOpen = false;
  }

  /* ── Launch from profile ─────────────────────────────────────── */
  /* A session ALWAYS needs a project. From the profile grid we don't know
     which project, so: if exactly one project exists, use it; otherwise
     send the user to the launch form with the profile pre-selected. */
  function launchFromProfile(id) {
    var p = profileById(id);
    if (!p) return;
    /* Prefer the active project; fall back to the sole project. */
    var projId = activeProjectId || (PROJECTS.length === 1 ? PROJECTS[0].id : null);
    if (projId && projectById(projId)) {
      var newId = startSession(projId, id, '', p.template ? p.template : null);
      if (newId) { selectSession(newId); navigateTo('sessions'); }
      return;
    }
    if (!PROJECTS.length) {
      openProjectModal();
      toast('Create a project first', 'info');
      return;
    }
    /* Need a project choice → prefill launch form */
    navigateTo('launch');
    renderProjectSelect();
    renderProfileSelect();
    var profSel = document.getElementById('select-profile');
    if (profSel) profSel.value = id;
    renderLaunchProfilePreview();
    var promptEl = document.getElementById('input-prompt');
    if (promptEl && p.template) promptEl.value = p.template;
    var projSel = document.getElementById('select-project');
    if (projSel && !projSel.value) setTimeout(function () { projSel.focus(); }, 60);
    toast('Pick a project to launch “' + p.name + '”', 'info');
  }

  /* ── Wire events ─────────────────────────────────────────────── */

  /* New profile buttons */
  ['btn-new-profile', 'btn-empty-new-profile'].forEach(function (bid) {
    var b = document.getElementById(bid);
    if (b) b.addEventListener('click', function () { openProfileModal(null); });
  });

  /* Grid card actions (event delegation) */
  if ($profileGrid) {
    $profileGrid.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-pf-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-pf-action');
      var id = btn.getAttribute('data-profile-id');
      if (action === 'launch') launchFromProfile(id);
      else if (action === 'default') {
        setDefaultProfile(defaultProfileId === id ? null : id);
        renderProfiles();
        toast(defaultProfileId === id ? 'Set as default profile' : 'Default profile cleared', 'info');
      }
      else if (action === 'edit') { var p = profileById(id); if (p) openProfileModal(p); }
      else if (action === 'duplicate') duplicateProfile(id);
      else if (action === 'delete') {
        var pr = profileById(id);
        openConfirm('Delete profile?',
          'Delete “' + (pr ? pr.name : '') + '”? This cannot be undone.',
          'Delete',
          function () { deleteProfile(id); });
      }
    });
  }

  /* Modal: agent picker */
  var pfPicker = document.getElementById('pf-agent-picker');
  if (pfPicker) {
    pfPicker.addEventListener('click', function (e) {
      var c = e.target.closest('.agent-card');
      if (c) setModalAgent(c.getAttribute('data-agent'));
    });
    pfPicker.addEventListener('keydown', function (e) {
      var c = e.target.closest('.agent-card');
      if (c && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        setModalAgent(c.getAttribute('data-agent'));
      }
    });
  }

  /* Modal: color picker */
  var pfColorPicker = document.getElementById('pf-color-picker');
  if (pfColorPicker) {
    pfColorPicker.addEventListener('click', function (e) {
      var s = e.target.closest('.swatch');
      if (s) setModalColor(s.getAttribute('data-color'));
    });
  }

  /* Modal: save / cancel / close / delete */
  function wireClick(id, fn) { var b = document.getElementById(id); if (b) b.addEventListener('click', fn); }
  wireClick('btn-profile-save', saveProfileFromModal);
  wireClick('btn-profile-cancel', closeProfileModal);
  wireClick('btn-profile-modal-close', closeProfileModal);
  wireClick('pf-browse', function () { toast('Directory picker — not available in browser preview', 'info'); });
  wireClick('btn-profile-delete', function () {
    if (!pfEditingId) return;
    var pr = profileById(pfEditingId);
    var editId = pfEditingId;
    openConfirm('Delete profile?',
      'Delete “' + (pr ? pr.name : '') + '”? This cannot be undone.',
      'Delete',
      function () { deleteProfile(editId); closeProfileModal(); });
  });
  if ($pfModalOverlay) $pfModalOverlay.addEventListener('click', closeProfileModal);

  /* Confirm dialog buttons */
  wireClick('btn-confirm-cancel', closeConfirm);
  wireClick('btn-confirm-ok', function () { var cb = confirmCb; closeConfirm(); if (cb) cb(); });
  if ($confirmOverlay) $confirmOverlay.addEventListener('click', closeConfirm);

  /* Launch panel: project / profile selects */
  var $selProfile = document.getElementById('select-profile');
  if ($selProfile) {
    $selProfile.addEventListener('change', renderLaunchProfilePreview);
  }

  /* Settings: default profile select → SetDefaultProfile */
  var $selDefault = document.getElementById('setting-default-profile');
  if ($selDefault) {
    $selDefault.addEventListener('change', function () {
      setDefaultProfile(this.value || null);
      renderProfiles();
      toast(this.value ? 'Default profile set' : 'Default profile cleared', 'info');
    });
  }

  /* ================================================================
     INITIALISE
  ================================================================ */

  function wireSettingsTabs() {
    var tabs = document.getElementById('settings-tabs');
    if (!tabs) return;
    var panels = document.querySelectorAll('[data-stab-panel]');
    function activate(name) {
      tabs.querySelectorAll('.settings-tab').forEach(function (t) {
        var on = t.getAttribute('data-stab') === name;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panels.forEach(function (p) {
        p.hidden = p.getAttribute('data-stab-panel') !== name;
      });
      try { localStorage.setItem('agentry:settingsTab', name); } catch (e) {}
    }
    tabs.addEventListener('click', function (e) {
      var btn = e.target.closest('.settings-tab');
      if (btn) activate(btn.getAttribute('data-stab'));
    });
    var saved = 'general';
    try { saved = localStorage.getItem('agentry:settingsTab') || 'general'; } catch (e) {}
    if (!tabs.querySelector('[data-stab="' + saved + '"]')) saved = 'general';
    activate(saved);
  }

  function init() {
    loadProjects();
    loadActiveProject();
    loadProfiles();
    loadDefaultProfile();
    loadTweaks();
    applyTweaks();

    /* Render data-driven UI from SESSIONS state */
    renderProjectSwitcher();
    renderSidebar();
    renderOverview();
    renderProfiles();
    renderProjectSelect();
    renderProfileSelect();
    renderProjectsView();
    wireSettingsTabs();

    /* Restore last nav */
    try {
      var savedNav = localStorage.getItem(STORAGE_NAV);
      navigateTo(savedNav && VIEW_MAP[savedNav] ? savedNav : 'sessions');
    } catch (e) {
      navigateTo('sessions');
    }

    /* Initial session selection — must belong to the active project. */
    var initial = SESSIONS[state.activeSession];
    if (!initial || (activeProjectId && initial.projectId !== activeProjectId)) {
      state.activeSession = null;
      Object.keys(SESSIONS).some(function (sid) {
        if (!activeProjectId || SESSIONS[sid].projectId === activeProjectId) {
          state.activeSession = sid; return true;
        }
        return false;
      });
    }
    if (state.activeSession) selectSession(state.activeSession);
    else clearTerminalPane();

    /* Onboarding — no projects at all → guide into first-project create. */
    if (!PROJECTS.length) {
      navigateTo('projects');
      openProjectModal();
    }

    /* Hide toolbar if not on terminal view */
    if ($toolbarTerminal && state.activeView !== 'sessions') {
      $toolbarTerminal.style.display = 'none';
    }

    /* Begin live streaming for every running session */
    Object.keys(SESSIONS).forEach(function (id) {
      if (SESSIONS[id].status === 'running' && SESSIONS[id].stream) startStream(id);
    });
  }


  /* ================================================================
     REMOTE ACCESS (SERVER)
     This machine HOSTS the daemon. Remote Access exposes it to the
     user's other devices over their Tailscale tailnet. Default OFF —
     enabling is a conscious security decision (remote clients can run
     agents here). Tailscale must be up first (prerequisite gate).
     Connecting OUT to another machine is the *client* app's job, not
     this desktop GUI — so there is no pairing/connect-out flow here.
  ================================================================ */

  var RA_KEY = 'agentry:remoteAccess'; /* persisted on/off */

  /* Tailnet facts (real impl: query `tailscale status --json`). */
  var TAILNET = {
    ready: true,                       /* false → gate blocks enabling */
    reason: 'ok',                      /* 'not-installed'|'logged-out'|'stopped'|'ok' */
    machine: 'dev-macbook',
    fqdn: 'dev-macbook.tail9c2e.ts.net',
    port: 8723
  };

  /* Demo connected clients (real impl: from server, live). */
  var RA_CLIENTS = [
    { id: 'rc-1', name: 'iPhone 15 Pro', kind: 'mobile', address: '100.84.12.7', lastSeen: Date.now() - 40 * 1000, viewing: 'Refactor auth middleware' },
    { id: 'rc-2', name: 'MacBook Air', kind: 'desktop', address: '100.84.9.31', lastSeen: Date.now() - 6 * 60 * 1000, viewing: null }
  ];

  var raOn = localStorage.getItem(RA_KEY) === '1';

  /* server state: 'off' | 'listening' | 'error' | 'blocked' */
  function raServerState() {
    if (!raOn) return 'off';
    if (!TAILNET.ready) return 'blocked';
    return 'listening';
  }

  var KIND_ICON = { mobile: 'smartphone', desktop: 'monitor', web: 'globe' };

  function fmtSeen(ts) {
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 45) return 'active now';
    if (s < 90) return '1 min ago';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    return Math.floor(s / 3600) + 'h ago';
  }

  /* ── Elements ─────────────────────────────────────────────── */
  var $raPill      = document.getElementById('ra-state-pill');
  var $raPillText  = document.getElementById('ra-state-text');
  var $raToggle    = document.getElementById('ra-toggle');
  var $raToggleDesc= document.getElementById('ra-toggle-desc');
  var $raGate      = document.getElementById('ra-gate');
  var $raGateTitle = document.getElementById('ra-gate-title');
  var $raGateDesc  = document.getElementById('ra-gate-desc');
  var $raGateBtn   = document.getElementById('btn-ra-gate-action');
  var $raGateLabel = document.getElementById('ra-gate-action-label');
  var $raAddress   = document.getElementById('ra-address');
  var $raAddrUrl   = document.getElementById('ra-address-url');
  var $raClients   = document.getElementById('ra-clients');
  var $raClientsList = document.getElementById('ra-clients-list');
  var $raClientsCount= document.getElementById('ra-clients-count');
  var $raQr        = document.getElementById('ra-qr');
  var $raQrCanvas  = document.getElementById('ra-qr-canvas');

  /* topbar pill */
  var $hostPill     = document.getElementById('btn-host-pill');
  var $hostPillName = document.getElementById('host-pill-name');
  var $hostPillBadge= document.getElementById('host-pill-badge');
  var $hostMenu     = document.getElementById('host-menu');
  var $raMiniPill   = document.getElementById('ra-mini-pill');
  var $raMiniText   = document.getElementById('ra-mini-text');
  var $raMiniHost   = document.getElementById('ra-mini-host');
  var $raMiniClients= document.getElementById('ra-mini-clients');

  var GATE_COPY = {
    'not-installed': { title: 'Tailscale isn’t installed', desc: 'Remote access needs Tailscale running on this machine.', label: 'Install Tailscale' },
    'logged-out':    { title: 'Tailscale is logged out',     desc: 'Sign in to your tailnet to expose this daemon.',        label: 'Open Tailscale' },
    'stopped':       { title: 'Tailscale is stopped',        desc: 'Start Tailscale to bring this machine onto the tailnet.', label: 'Start Tailscale' }
  };

  function drawQrPlaceholder() {
    if (!$raQrCanvas) return;
    /* Deterministic faux-matrix from the fqdn — purely decorative. */
    var seed = (TAILNET.fqdn + ':' + TAILNET.port).split('').reduce(function (a, c) { return (a * 31 + c.charCodeAt(0)) >>> 0; }, 7);
    var N = 21, cells = '';
    for (var i = 0; i < N * N; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      var on = (seed >> 16) & 1;
      /* force finder-pattern corners on */
      var r = Math.floor(i / N), c = i % N;
      var corner = (r < 7 && c < 7) || (r < 7 && c >= N - 7) || (r >= N - 7 && c < 7);
      if (corner) on = ((r % 6 === 0 || c % 6 === 0) || (r > 1 && r < 5 && c > 1 && c < 5) || (r > 1 && r < 5 && c > N - 6 && c < N - 2) || (r > N - 6 && r < N - 2 && c > 1 && c < 5)) ? 1 : 0;
      cells += '<i' + (on ? ' class="on"' : '') + '></i>';
    }
    $raQrCanvas.innerHTML = cells;
  }

  function renderRemoteAccess() {
    var state = raServerState();
    var addr = TAILNET.fqdn + ':' + TAILNET.port;

    /* Toggle reflects intent; if blocked we keep it visually off. */
    if ($raToggle) $raToggle.checked = raOn && TAILNET.ready;

    /* Settings section pill */
    setRaPill($raPill, $raPillText, state);

    /* Gate (only when user wants on but tailnet not ready, OR proactively when off+not-ready) */
    if ($raGate) {
      var showGate = !TAILNET.ready;
      $raGate.hidden = !showGate;
      if (showGate) {
        var g = GATE_COPY[TAILNET.reason] || GATE_COPY['stopped'];
        if ($raGateTitle) $raGateTitle.textContent = g.title;
        if ($raGateDesc)  $raGateDesc.textContent  = g.desc;
        if ($raGateLabel) $raGateLabel.textContent = g.label;
      }
    }

    /* Toggle desc */
    if ($raToggleDesc) {
      $raToggleDesc.textContent = !TAILNET.ready
        ? 'Unavailable until Tailscale is ready'
        : (raOn ? 'Listening on ' + TAILNET.machine + ' · clients can control agents'
                : 'Off · this machine is not reachable remotely');
    }

    /* Address card + QR */
    var listening = state === 'listening';
    if ($raAddress) $raAddress.hidden = !listening;
    if ($raAddrUrl) $raAddrUrl.textContent = addr;
    if (!listening && $raQr) $raQr.hidden = true;

    /* Clients */
    if ($raClients) $raClients.hidden = !listening;
    renderRaClients();

    /* Topbar pill */
    if ($hostPillName) {
      $hostPillName.textContent = state === 'listening'
        ? (RA_CLIENTS.length ? RA_CLIENTS.length + ' connected' : 'Remote on')
        : (state === 'blocked' ? 'Remote blocked' : state === 'error' ? 'Remote error' : 'Remote off');
    }
    if ($hostPill) {
      $hostPill.setAttribute('data-ra', state);
      $hostPill.classList.toggle('is-on', listening);
    }
    if ($hostPillBadge) {
      var n = listening ? RA_CLIENTS.length : 0;
      $hostPillBadge.hidden = n === 0;
      $hostPillBadge.textContent = n;
    }

    /* Topbar mini summary */
    setRaPill($raMiniPill, $raMiniText, state);
    if ($raMiniHost) $raMiniHost.textContent = TAILNET.machine;
    if ($raMiniClients) {
      if (listening && RA_CLIENTS.length) {
        $raMiniClients.hidden = false;
        $raMiniClients.innerHTML = RA_CLIENTS.map(function (c) {
          return '<div class="ra-mini-client"><i data-lucide="' + (KIND_ICON[c.kind] || 'globe') + '"></i>' +
                 '<span>' + esc(c.name) + '</span><span class="ra-mini-seen">' + fmtSeen(c.lastSeen) + '</span></div>';
        }).join('');
      } else {
        $raMiniClients.hidden = true;
        $raMiniClients.innerHTML = '';
      }
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function setRaPill(pillEl, textEl, state) {
    if (pillEl) pillEl.setAttribute('data-ra', state);
    if (textEl) {
      textEl.textContent = state === 'listening' ? 'Listening'
        : state === 'blocked' ? 'Blocked'
        : state === 'error' ? 'Error' : 'Off';
    }
  }

  function renderRaClients() {
    if ($raClientsCount) $raClientsCount.textContent = RA_CLIENTS.length;
    if (!$raClientsList) return;
    if (RA_CLIENTS.length === 0) {
      $raClientsList.innerHTML = '<div class="ra-clients-empty">No devices connected right now.</div>';
      return;
    }
    $raClientsList.innerHTML = RA_CLIENTS.map(function (c) {
      return '' +
        '<div class="ra-client-row">' +
          '<span class="ra-client-icon"><i data-lucide="' + (KIND_ICON[c.kind] || 'globe') + '"></i></span>' +
          '<span class="ra-client-text">' +
            '<span class="ra-client-name">' + esc(c.name) + ' <span class="ra-client-kind">' + c.kind + '</span></span>' +
            '<span class="ra-client-meta mono">' + esc(c.address) + ' · ' + fmtSeen(c.lastSeen) +
              (c.viewing ? ' · viewing “' + esc(c.viewing) + '”' : '') +
            '</span>' +
          '</span>' +
          '<button class="btn btn-ghost btn-sm ra-client-kick" data-kick="' + c.id + '"><i data-lucide="log-out"></i> Disconnect</button>' +
        '</div>';
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function setRemoteAccess(on) {
    raOn = on;
    localStorage.setItem(RA_KEY, on ? '1' : '0');
    renderRemoteAccess();
    if (on && TAILNET.ready) {
      toast('Remote access on — listening on ' + TAILNET.fqdn, 'success');
    } else if (!on) {
      var hadClients = RA_CLIENTS.length;
      /* Turning off disconnects everyone. */
      RA_CLIENTS = [];
      renderRemoteAccess();
      toast(hadClients ? 'Remote access off — ' + hadClients + ' device(s) disconnected' : 'Remote access off', 'success');
    }
  }

  /* Toggle: enabling is a conscious decision → confirm. */
  if ($raToggle) {
    $raToggle.addEventListener('change', function () {
      var wantOn = $raToggle.checked;
      if (wantOn) {
        if (!TAILNET.ready) {
          $raToggle.checked = false;
          toast('Tailscale must be ready before enabling remote access', 'warn');
          renderRemoteAccess();
          return;
        }
        $raToggle.checked = false; /* wait for confirm */
        openConfirm(
          'Allow remote control of this machine?',
          'Devices on your tailnet will be able to view and control agents running here — including starting and killing sessions. Only your own Tailscale devices can connect.',
          'Enable',
          function () {
            /* re-seed demo clients so the panel isn\'t empty after a fresh enable */
            if (RA_CLIENTS.length === 0) {
              RA_CLIENTS = [
                { id: 'rc-1', name: 'iPhone 15 Pro', kind: 'mobile', address: '100.84.12.7', lastSeen: Date.now() - 40 * 1000, viewing: 'Refactor auth middleware' }
              ];
            }
            setRemoteAccess(true);
          }
        );
      } else {
        setRemoteAccess(false);
      }
    });
  }

  /* Gate action — demo: simulate Tailscale coming up. */
  if ($raGateBtn) {
    $raGateBtn.addEventListener('click', function () {
      toast('Opening Tailscale…', 'info');
      setTimeout(function () {
        TAILNET.ready = true; TAILNET.reason = 'ok';
        renderRemoteAccess();
        toast('Tailscale ready — you can enable remote access', 'success');
      }, 900);
    });
  }

  /* Copy address */
  var $raCopy = document.getElementById('btn-ra-copy');
  if ($raCopy) {
    $raCopy.addEventListener('click', function () {
      var addr = TAILNET.fqdn + ':' + TAILNET.port;
      if (navigator.clipboard) navigator.clipboard.writeText(addr).catch(function () {});
      toast('Address copied', 'success');
    });
  }

  /* QR toggle */
  var $raQrBtn = document.getElementById('btn-ra-qr');
  if ($raQrBtn) {
    $raQrBtn.addEventListener('click', function () {
      if (!$raQr) return;
      var show = $raQr.hidden;
      $raQr.hidden = !show;
      if (show) drawQrPlaceholder();
    });
  }

  /* Disconnect a client (confirm). */
  if ($raClientsList) {
    $raClientsList.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-kick]');
      if (!btn) return;
      var id = btn.getAttribute('data-kick');
      var c = RA_CLIENTS.filter(function (x) { return x.id === id; })[0];
      if (!c) return;
      openConfirm(
        'Disconnect ' + c.name + '?',
        'This device will lose remote access until it reconnects from your tailnet.',
        'Disconnect',
        function () {
          RA_CLIENTS = RA_CLIENTS.filter(function (x) { return x.id !== id; });
          renderRemoteAccess();
          toast(c.name + ' disconnected', 'success');
        }
      );
    });
  }

  /* ── Topbar pill menu ─────────────────────────────────────── */
  var hostMenuOpen = false;
  function openHostMenu() {
    if (!$hostMenu) return;
    hostMenuOpen = true;
    $hostMenu.classList.add('open');
    $hostMenu.setAttribute('aria-hidden', 'false');
    if ($hostPill) $hostPill.setAttribute('aria-expanded', 'true');
    renderRemoteAccess();
  }
  function closeHostMenu() {
    if (!$hostMenu) return;
    hostMenuOpen = false;
    $hostMenu.classList.remove('open');
    $hostMenu.setAttribute('aria-hidden', 'true');
    if ($hostPill) $hostPill.setAttribute('aria-expanded', 'false');
  }
  if ($hostPill) {
    $hostPill.addEventListener('click', function (e) {
      e.stopPropagation();
      hostMenuOpen ? closeHostMenu() : openHostMenu();
    });
  }
  document.addEventListener('click', function (e) {
    if (hostMenuOpen && !e.target.closest('#host-switcher')) closeHostMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && hostMenuOpen) closeHostMenu();
  });
  var $hostMenuManage = document.getElementById('host-menu-manage');
  if ($hostMenuManage) {
    $hostMenuManage.addEventListener('click', function () {
      closeHostMenu();
      if (typeof navigateTo === 'function') navigateTo('settings');
      /* Jump straight to the Remote Access tab */
      var tabBtn = document.querySelector('#settings-tabs [data-stab="remote"]');
      if (tabBtn) tabBtn.click();
      setTimeout(function () {
        var sec = document.getElementById('ra-state-pill');
        if (sec) sec.classList.add('ra-flash');
        setTimeout(function () { if (sec) sec.classList.remove('ra-flash'); }, 1400);
      }, 60);
    });
  }

  renderRemoteAccess();

  init();


  /* ── Lucide Icons — render after DOM is ready ─────────────── */
  if (typeof lucide !== 'undefined') lucide.createIcons();

  /* ================================================================
     MOBILE SIDEBAR TOGGLE
  ================================================================ */

  var $sidebar        = document.getElementById('sidebar');
  var $sidebarToggle  = document.getElementById('btn-sidebar-toggle');
  var $sidebarOverlay = document.getElementById('sidebar-overlay');

  function openMobileSidebar() {
    if (!$sidebar) return;
    $sidebar.classList.add('mobile-open');
    if ($sidebarOverlay) {
      $sidebarOverlay.classList.add('open');
      $sidebarOverlay.removeAttribute('aria-hidden');
    }
    if ($sidebarToggle) $sidebarToggle.setAttribute('aria-expanded', 'true');
  }

  function closeMobileSidebar() {
    if (!$sidebar) return;
    $sidebar.classList.remove('mobile-open');
    if ($sidebarOverlay) {
      $sidebarOverlay.classList.remove('open');
      $sidebarOverlay.setAttribute('aria-hidden', 'true');
    }
    if ($sidebarToggle) $sidebarToggle.setAttribute('aria-expanded', 'false');
  }

  function isMobile() {
    return window.innerWidth <= 640;
  }

  if ($sidebarToggle) {
    $sidebarToggle.addEventListener('click', function () {
      if ($sidebar && $sidebar.classList.contains('mobile-open')) {
        closeMobileSidebar();
      } else {
        openMobileSidebar();
      }
    });
  }

  if ($sidebarOverlay) {
    $sidebarOverlay.addEventListener('click', closeMobileSidebar);
  }

  var $sidebarClose = document.getElementById('btn-sidebar-close');
  if ($sidebarClose) {
    $sidebarClose.addEventListener('click', closeMobileSidebar);
  }

  /* Close sidebar on session select (mobile) */
  document.addEventListener('click', function (e) {
    var item = e.target.closest('.session-item');
    if (!item) return;
    if (e.target.closest('[data-action]')) return;
    if (isMobile()) closeMobileSidebar();
  });

  /* Close sidebar on nav change (mobile) — except "Sessions",
     which opens the session-list drawer (handled above). */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-nav]');
    if (!btn) return;
    if (btn.getAttribute('data-nav') === 'sessions') return;
    if (isMobile()) closeMobileSidebar();
  });

  /* Escape closes mobile sidebar too */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isMobile()) closeMobileSidebar();
  });

})();
