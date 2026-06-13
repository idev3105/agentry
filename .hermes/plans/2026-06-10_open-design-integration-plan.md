# Agentry × Open Design — Integration Plan

**Goal:** Use Open Design (nexu-io/open-design) to design Agentry's UI/UX — generate prototypes, establish a DESIGN.md brand contract, and use it to guide Agentry's Svelte 5 GUI.

---

## What Open Design Is (nexu-io/open-design)

**NOT** a component library. It is an **AI-native design studio** — open-source Claude Design alternative.

| Dimension | Detail |
|---|---|
| Stars | 62.7k ⭐ · 7k forks — very active |
| License | Apache 2.0 |
| Status | Active (commit 23 min ago, 2,169 commits, 860 branches) |
| Native app | macOS + Windows desktop app |
| Core concept | Agent writes briefs → coding agent (Claude Code / Hermes / Codex…) generates HTML artifacts shaped by a `DESIGN.md` brand contract |
| Output formats | HTML prototype · PDF · PPTX · MP4 · HyperFrames |
| Design systems | 150+ shipped (Linear, Stripe, Vercel, Airbnb, Notion, Anthropic, Cursor, Supabase…) |
| Plugins | 261 ready-to-use |
| Skills | 100+ agent skills |
| Hermes support | ✅ `od mcp install hermes` — first-class |

### Key concept: DESIGN.md

A 9-section brand contract markdown file:
1. Visual Theme & Atmosphere
2. Color Palette & Roles
3. Typography Rules
4. Spacing & Layout System
5. Component Patterns
6. Motion & Animation
7. Iconography & Imagery
8. Voice & Tone
9. Anti-patterns

This file + a skill + a brief → coding agent → sandboxed HTML artifact.
Agentry already has `app.css` with Gruvbox tokens → **directly maps to DESIGN.md format**.

### How it plugs into Hermes (our agent)
```bash
od mcp install hermes
# Then inside Hermes:
# > Use open-design to generate a dashboard with the Agentry design system
```

---

## Integration Strategy for Agentry

### Layer 1 — Create Agentry DESIGN.md (design contract)
Extract Agentry's existing design tokens from `app.css` into a `DESIGN.md` brand contract.
This becomes the source of truth for all Open Design artifact generation.

### Layer 2 — Generate UI prototypes via Open Design
Use Open Design to prototype Agentry UI screens (Overview, Session view, Settings) before implementing them in Svelte.
Output: sandboxed HTML → inspect → implement in Svelte 5.

### Layer 3 — MCP integration into Hermes workflow
Install `od mcp install hermes` → future design requests handled via OD MCP tools directly inside Hermes sessions.

---

## Phase Plan

### Phase 1 — Install Open Design + wire Hermes MCP

**Task 1.1 — Install Open Design desktop app**
- Download from https://open-design.ai or GitHub Releases
- macOS Apple Silicon: download `.dmg` from https://github.com/nexu-io/open-design/releases

**Task 1.2 — Install OD into Hermes Agent**
```bash
curl -fsSL https://open-design.ai/install.sh | sh -s hermes
# or:
od mcp install hermes
```
Verify: `od --version` works, Hermes can call `od` MCP tools.

**Task 1.3 — Verify MCP wiring**
Inside Hermes: `> Use open-design to list available design systems`
Expected: OD lists 150 design systems including Linear, Stripe, Vercel.

---

### Phase 2 — Author Agentry DESIGN.md

**Task 2.1 — Extract tokens from app.css → DESIGN.md**

Create `design-systems/agentry/DESIGN.md` (either in OD's local dir or in Agentry repo at `gui/DESIGN.md`).

Map from current `app.css` `@theme inline {}`:

```markdown
# Agentry Design System

> Category: Developer Tools / Agent Management
> Terminal-native, dark-first, Gruvbox-inspired palette. Warm amber accents.

## 1. Visual Theme & Atmosphere
Dark mode native. Gruvbox warm dark (#282828 canvas).
Information-dense TUI-adjacent layout. Monospace-friendly typography.
Default theme: Gruvbox. Alt theme: One Dark (via data-theme="one-dark").

## 2. Color Palette & Roles
- Background: #282828 (gruvbox hard)
- Card/Elevated: #3c3836
- Border: #504945
- Foreground: #ebdbb2
- Muted: #a89984
- Accent (primary): #d79921 (gruvbox yellow)
- Status OK: #b8bb26 (green)
- Status Warn: #d79921 (yellow)
- Status Error: #fb4934 (red)
- Status Info: #83a598 (blue)
- Gruvbox accents: yellow #fabd2f, green #b8bb26, aqua #8ec07c,
  blue #83a598, orange #fe8019, purple #d3869b, red #fb4934

## 3. Typography Rules
- Primary font: system-ui / -apple-system / monospace stack
- Monospace: JetBrains Mono / SF Mono / ui-monospace (for terminal content)
- Density variants: compact / comfortable / spacious (via data-density attr)

## 4. Spacing & Layout System
- Layout: sidebar (220–520px fixed) + main content + inspector panel
- Component: ActivityBar (48px wide) | SessionSidebar | TerminalView | Inspector
- SplitPane: draggable dividers, localStorage persistence

## 5. Component Patterns
- Session rows: status badge + agent type dot + title + unread count
- Terminal: xterm.js full-bleed, gruvbox color scheme hardcoded
- Status colors: running=green pulse, queued=yellow, failed=red, finished=muted
- Command palette: modal overlay, keyboard-first (⌘K)

## 6. Motion & Animation
- Minimal: status badge transitions only (fade 150ms)
- No decorative animation — terminal-speed responsiveness priority
- Toasts: slide-in from bottom-right

## 7. Iconography
- Library: @lucide/svelte (all icons)
- Size: 14px inline, 18px action buttons, 20px view headers
- Color: text-muted-foreground default, accent on hover/active

## 8. Voice & Tone
- Terse, technical, no-fluff
- Error messages: factual, actionable
- Labels: lowercase, no punctuation

## 9. Anti-patterns
- No light mode default (always dark first)
- No rounded-xl cards — use rounded-md max
- No colorful backgrounds — accent only on text/icons/borders
- No alert() — always toasts
- No modal for confirmations that can be undone
```

Files to create/modify:
- `gui/DESIGN.md` (new) — Agentry brand contract
- Optionally symlink into OD's `design-systems/agentry/` folder

---

### Phase 3 — Generate UI prototypes via Open Design

**Task 3.1 — Prototype: Session Overview screen**

Inside Open Design desktop app or via Hermes+MCP:
```
Brief: Design an agent session management dashboard.
Design system: Agentry (Gruvbox dark).
Skill: dashboard / live-dashboard.
Screens: session list sidebar + terminal main area + inspector panel.
Output: HTML prototype.
```

**Task 3.2 — Prototype: Onboarding / Empty State**
```
Brief: First-run empty state for a developer tool desktop app.
Design system: Agentry.
Skill: mobile-onboarding (adapted for desktop).
Screens: no-project state, add-project flow, first-session start.
```

**Task 3.3 — Prototype: Settings / Profiles view**
```
Brief: Profile management screen for AI coding agents.
Design system: Agentry.
Screens: profile list, create/edit profile form, default profile selector.
```

**Task 3.4 — Review prototypes → extract UI improvements**
- Compare generated prototypes against current Svelte components
- Identify gaps (missing empty states, better session cards, etc.)
- Feed findings back into the UI improvement plan

---

### Phase 4 — Apply prototype findings to Svelte implementation

After prototype review, implement the highest-value findings:

**Task 4.1 — Session card redesign** (from prototype feedback)
- Agent type colored indicator (dot + icon)
- Better status badge layout
- Source: prototype comparison

**Task 4.2 — Improved empty state** (from prototype feedback)
- Full-bleed empty state with illustration/icon
- Clear CTA hierarchy

**Task 4.3 — Update DESIGN.md as living doc**
- As Svelte implementation diverges from prototype, update `gui/DESIGN.md`
- Keep as source of truth for future OD-assisted iteration

---

## Files to create

| File | Purpose |
|---|---|
| `gui/DESIGN.md` | Agentry brand contract (new) |
| `gui/DESIGN.md` → OD design-systems | Symlink or copy into Open Design |

## No Svelte code changes in Phase 1–3

Phases 1–3 are **design-only** (research + prototyping + brand doc). Zero risk to existing code.
Phase 4 implements findings — follows normal review cycle.

---

## Risks

1. OD MCP `hermes` install may need `od` CLI on PATH — verify `which od` after install.
2. Agentry DESIGN.md is custom (not one of the 150 shipped) — OD will use it as-is; agent quality depends on how detailed the DESIGN.md is.
3. Generated HTML prototypes use generic CSS — will NOT be Svelte/Tailwind; treat as **reference only**, not copy-paste source.
4. Open Design requires Node ~24 if running from source; desktop app avoids this.
