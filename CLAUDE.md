# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Nesodden G16 Kampoversikt — a Next.js 15 app that displays match schedules and squad lists ("kamptropp") for Nesodden IF's three G16 football teams. Data is scraped from fiks.fotball.no via Playwright automation and cached locally.

## Commands

```bash
npm run dev           # Dev server on port 3210
npm run build         # Production build
npm run start         # Production server on port 3210 (requires build first)

npm run sync          # Scrape FIKS → data/synced-data.json  (requires .env.test with FIKS credentials)
npm test              # Playwright UI tests (app-ui project)
npm run test:accuracy # FIKS auth + data accuracy comparison
npm run test:kamptropp # Verify squad endpoint returns real FIKS data (not mock)
npm run test:all      # All Playwright projects
npm run test:ui       # Playwright visual debugger

# Run a single test file:
npx playwright test tests/kamptropp.spec.ts

# Run a specific project:
npx playwright test --project=sync
```

**After modifying API routes or components, rebuild + restart the production server** if running `npm run start`. The dev server hot-reloads automatically.

## Environment Variables

```
# .env.test  (for Playwright tests including sync)
FIKS_EMAIL=your@email.no
FIKS_PASSWORD=yourpassword

# .env.local  (for POST /api/sync via the UI button)
FIKS_EMAIL=your@email.no
FIKS_PASSWORD=yourpassword
```

Both files are gitignored. The `.env.test.example` file documents this.

## Architecture

### Data Flow

Three tiers, applied in order per API request:

1. **Synced data** — `data/synced-data.json` (written by `npm run sync`)
2. **Live scrape** — Axios + Cheerio against fotball.no (HTML, not JS-rendered; players always return empty this way)
3. **Mock data** — `lib/mockData.ts` hardcoded fallback

The API always returns a `source` field (`'synced'` | `'scraped'` | `'mock'`) so the client can detect which tier responded.

### How Sync Works

`POST /api/sync` spawns a Playwright subprocess running `npm run sync` (`tests/fiks-sync.spec.ts`). Playwright cannot run inside a Next.js API route (no browser sandbox), so it must be a child process. The subprocess:

1. Loads `.auth/fiks.json` (pre-authenticated session from the `fiks-setup` project)
2. Navigates to each G16 team's FIKS page, scrapes the 8-column match table
3. For played matches and matches within the next 7 days, visits `/FiksWeb/MatchReport/View/{matchReportId}`, clicks the Hjemmelag/Bortelag buttons, and extracts squad data with a single `page.evaluate()` call
4. Extracts `data-home-club-id` / `data-away-club-id` from `#matchreport-container` to build logo URLs: `https://images.fotball.no/clublogos/{clubId}.png`
5. Writes everything to `data/synced-data.json`

Sync timeout is 2 minutes. Only past matches and those within 7 days get squad scraping (squads are never registered more than a week ahead).

### FIKS Scraping Details

**Match table** (8-column layout):
- `[0]` matchId (link href contains `/MatchReport/View/{internalId}`)
- `[1]` round, `[2]` homeTeam, `[3]` awayTeam
- `[4]` dateTime (dd.mm.yyyy HH:MM), `[5]` venue, `[6]` score, `[7]` "Endre"

**Squad page** (`/FiksWeb/MatchReport/View/{id}`):
- Click `button[name~=hjemmelag]` / `button[name~=bortelag]` to reveal squads
- `.player-category h6` → position header
- `.player-row-read-only` → player row (`p:first-child` = jersey, `p:last-child span:first-child` = name)
- Use a single `page.evaluate()` for the whole extraction — per-element evaluate calls in loops cause 15-minute hangs

**Authentication**: Playwright `storageState: '.auth/fiks.json'` handles FIKS session cookies. Regenerate with `npx playwright test --project=fiks-setup`.

### Key Files

| File | Role |
|------|------|
| `lib/types.ts` | `Team`, `Match`, `Squad`, `Player` interfaces — the single source of type truth |
| `lib/fiksSync.ts` | Read/write `data/synced-data.json`; no Playwright imports here |
| `lib/scraper.ts` | Axios+Cheerio live scraper (matches only; players always empty — JS-rendered) |
| `lib/mockData.ts` | `G16_TEAMS` array (3 teams with FIKS IDs) + mock match/player data |
| `tests/fiks-sync.spec.ts` | Full Playwright sync; contains all scraping logic and squad extraction |
| `app/api/sync/route.ts` | Spawns sync subprocess; `GET` returns status, `POST` triggers sync |
| `app/api/squads/[matchId]/route.ts` | Serves kamptropp by FIKS internal matchReportId |
| `components/MatchesView.tsx` | Main view: team tabs, sorted match list, sync button with spinner |
| `components/MatchCard.tsx` | Individual match: shows result between teams, lazy-loads kamptropp on expand |

### Playwright Projects

| Project | File | Notes |
|---------|------|-------|
| `fiks-setup` | `fiks-auth.setup.ts` | Must run first; saves `.auth/fiks.json` |
| `app-ui` | `app.spec.ts` | UI smoke tests; needs dev server running |
| `data-accuracy` | `accuracy.spec.ts` | Compares app vs FIKS; depends on fiks-setup |
| `sync` | `fiks-sync.spec.ts` | The data sync worker |
| `kamptropp` | `kamptropp.spec.ts` | Verifies real squad data for G16-1 vs Grüner (11.04.2026, matchReportId=8977342) |

All projects run with `workers: 1` (sequential) because FIKS sessions cannot be shared across parallel browser contexts.

### Constants to Know

- Nesodden club ID: `'82'` (used in `MatchCard` to identify which side is Nesodden)
- G16 team FIKS IDs: G16-1 = `134742`, G16-2 = `6895`, G16-3 = `154500`
- App port: `3210`
