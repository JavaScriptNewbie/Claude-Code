# ⟁ THE SYSTEM

A **Solo Leveling-style life-RPG habit tracker** — an installable, offline-first PWA.
Single-user, no backend, no accounts. Your progress lives on your device.

Dark holographic cyan HUD · Orbitron + Rajdhani · mobile-first portrait.

---

## What's inside

- **Player** — Level, Rank (E→S), evolving Title, total XP, and 5 independently-levelling
  attributes (STR / INT / FOC / CHA / GOLD).
- **Status** — animated SVG anime avatar (customisable hair/skin/eyes/outfit), rank-coloured
  aura + rising particles, a pentagon radar of your 5 stats, XP bar, daily decree.
- **Quests** — *Daily* (Core quests gate the streak + Bonus quests, reset at midnight) and
  *NPC Bounties* (one-time, then archived). Built-in XP evaluator: `XP = (Effort + Time) × Impact × 5`.
  Quests can evolve at level gates.
- **Streak + dormancy** — a single missed day just resets the streak (no XP loss); 3+ idle days
  trigger escalating XP/stat backlash (with a stat-decay warning + visual).
- **Arcs** — long-term goal bars; clearing one grants +300 XP.
- **System** — level-gated unlocks/titles, synth sound, haptics, reset.

### New in v2

- 📲 **Real installable PWA** — `manifest.json`, offline service worker, generated System-style icons.
- 💾 **Backup / restore** — JSON export & import, with a **versioned storage schema** and safe migrations.
- ⏰ **Local reminders** — 22:30 dog walk + a daily-reset nudge (configurable times).
- ☠ **Weekly Boss** — a fresh boss each ISO week; clear all core quests on N days to fell it (+250 XP).
- 🎨 **Rank-adaptive theme** — the HUD palette shifts as you climb ranks (toggleable).
- 🩸 **Stat-decay visuals** — dormancy reddens the avatar stage and raises a warning.

---

## Files

| File | Purpose |
|---|---|
| `index.html` | The whole app (HTML + CSS + JS inline → loads as one request, robust offline). |
| `manifest.json` | PWA manifest (name, icons, theme, shortcuts). |
| `sw.js` | Service worker — offline app-shell cache + Google Fonts runtime cache. |
| `icons/` | App icons (192 / 512 / 512-maskable / apple-touch / favicon). |
| `system.html` | Redirect → `index.html` (keeps old links/installs working). |
| `tools/make-icons.mjs` | Regenerates the icons (headless Chromium renders an SVG). |
| `tools/test.mjs` | Headless browser test suite (interactions, offline, migration, reminders). |
| `.github/workflows/deploy.yml` | Auto-deploy to GitHub Pages. |

Your saved data is shared across the whole origin, so `system.html` and `index.html` share the
same progress. (Data does **not** transfer from a local `file://` copy — use **Export → Import** for that.)

---

## Run locally

```bash
# any static server works; a service worker needs http(s), not file://
python3 -m http.server 8123
# open http://localhost:8123/index.html
```

Regenerate icons / run the tests (needs Playwright's Chromium):

```bash
NODE_PATH=$(npm root -g) node tools/make-icons.mjs
python3 -m http.server 8123 &  node tools/test.mjs
```

---

## Deploy

### Option A — GitHub Pages (recommended, automated)

1. Merge this branch into `main`.
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The included workflow publishes on every push to `main`.
   Live URL: **https://javascriptnewbie.github.io/claude-code/**

*Instant preview without merging:* Settings → Pages → "Deploy from a branch" → pick this branch, `/ (root)`.

### Option B — Netlify (drag-and-drop)

Drag the project folder onto <https://app.netlify.com/drop>. Done — you get a URL immediately.
(Relative paths mean it works at any URL, root or sub-path.)

---

## Add to Home Screen

**iOS (Safari):** open the live URL → Share → **Add to Home Screen** → Add.
Launches full-screen with the System icon. *(For notifications on iOS you must install it
to the Home Screen first — iOS only allows web notifications for installed PWAs, 16.4+.)*

**Android (Chrome):** open the URL → **⋮** menu → **Install app** / **Add to Home Screen**.
You may also get an automatic install prompt.

---

## Reminders — how far PWAs can go

Reminders fire **while the app is open or its service worker is alive** (e.g. recently used,
or open in the background). Phones aggressively pause background timers to save battery, so a
reminder may arrive when you next open the app rather than exactly on the minute.

True **scheduled background notifications** (firing while the app is fully closed for hours)
require a push server — which this app deliberately doesn't have (no backend, single user).
For a reliable hard alarm, also set a native phone alarm; THE SYSTEM's reminders are best-effort
nudges layered on top. On iOS, notifications work **only after** you Add to Home Screen.

---

## Back up your progress

Everything is stored in `localStorage` on one device. **System → Data Vault → Export Backup**
saves a JSON file; **Import Backup** restores it (also how you move to a new phone). Export
before any reset.
