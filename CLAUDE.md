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
4. Extracts `data-home-club-id` / `data-away-club-id` from `#matchreport-container` to build logo URLs and populate `homeClubId`/`awayClubId` on all matches
5. **Opponent pass**: for every opponent club found in Nesodden's schedule, visits `/FiksWeb/Club/View/{clubId}`, finds their G16 teams, scrapes those teams' full match schedules, and scrapes squads for played matches within the last 60 days
6. Writes everything to `data/synced-data.json`

Sync timeout is **10 minutes**. The first run is slow (scrapes all opponent squads); subsequent runs are fast because squads with `ready: true` are skipped (incremental guard). Only Nesodden matches within 7 days get near-future squad scraping; opponent squads are only scraped for past matches.

### synced-data.json Structure

```
{
  lastSynced: string,
  matches:         { [nesoddenTeamFiksId]: Match[] },   // Nesodden's 3 teams
  players:         { [nesoddenTeamFiksId]: Player[] },  // general rosters (fallback)
  squads:          { [matchReportId]: Squad },           // shared — Nesodden + opponent matches
  opponentMatches: { [teamFiksId]: Match[] },           // every G16 team for each opponent club
  opponentTeams:   { [teamFiksId]: OpponentTeam },      // metadata (name, clubId, division)
  clubTeams:       { [ageGroup: string]: Team[] }        // all Nesodden teams grouped by age (e.g. "G16", "J15")
}
```

The `squads` map is keyed by FIKS `matchReportId` and shared across both Nesodden and opponent match entries.

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

**Club page** (`/FiksWeb/Club/View/{clubId}`): links matching `a[href*="/FiksWeb/Team/View/"]` with text matching `/g[\s-]?16|gutter[\s-]?16/i` identify G16 teams.

**Authentication**: Playwright `storageState: '.auth/fiks.json'` handles FIKS session cookies. Regenerate with `npx playwright test --project=fiks-setup`.

### Spillerdeling mellom lag (Cross-team Player Sharing)

Shown in `CrossTeamPlayers` when a match card is expanded and squad data is ready.

**Nesodden side**: checks the last 3 played matches from the other two Nesodden G16 teams via `/api/teams/{fiksId}/matches` + `/api/squads/{matchReportId}`.

**Opponent side**: calls `GET /api/clubs/{clubId}/squads?exclude={matchReportId}`, which searches both `matches` and `opponentMatches` for any team in the same opponent club. Returns `ClubAppearance[]` sorted by date, where each entry includes `teamFiksId`, `teamName`, `division`, and `isHigher` (precomputed by the API by comparing division ranks). The component groups by `teamFiksId` and takes the most recent appearance per sibling team.

`isHigher` is computed in the API by: finding the current opponent's team in `opponentMatches` via the `exclude` matchReportId, looking up its division from `opponentTeams`, then comparing `divisionRank(siblingDivision) < divisionRank(currentDivision)`.

### App Navigation

`HomeRouter` (rendered by `app/page.tsx`) routes based on the `?ageGroup` query param:
- **No param** → `ClubOverview`: landing page, fetches all Nesodden teams from `GET /api/clubs/82/teams`, displays age-group cards (G16, J15, etc.). Clicking a card pushes `?ageGroup=G16&team=<fiksId>`.
- **`?ageGroup` present** → `MatchesView`: team tabs, match list, sync button.

### Key Files

| File | Role |
|------|------|
| `lib/types.ts` | `Team`, `Match`, `Squad`, `Player`, `OpponentTeam`, `ClubAppearance`, `MatchEvent` — single source of type truth |
| `lib/fiksSync.ts` | Read/write `data/synced-data.json`; defines `SyncedData` interface; mtime-based in-memory cache |
| `lib/scraper.ts` | Axios+Cheerio live scraper (matches only; players always empty — JS-rendered) |
| `lib/mockData.ts` | `G16_TEAMS` array (3 teams with FIKS IDs) + mock match/player data |
| `tests/fiks-sync.spec.ts` | Full Playwright sync; all scraping logic including opponent pass |
| `tests/helpers/fiks.ts` | Shared Playwright helpers: `extractFiksMatches`, `normaliseTeamName`, `fiksTeamUrl` |
| `app/api/sync/route.ts` | Spawns sync subprocess; `GET` returns status, `POST` triggers sync |
| `app/api/squads/[matchId]/route.ts` | Serves kamptropp by FIKS internal matchReportId |
| `app/api/clubs/[clubId]/squads/route.ts` | Cross-team appearance lookup; searches Nesodden + opponent matches |
| `app/api/clubs/[clubId]/teams/route.ts` | Teams for a club grouped by age group (synced → live scrape → G16 fallback) |
| `app/api/teams/[fiksId]/matches/route.ts` | Match list for a Nesodden team (synced → scraped → mock) |
| `components/HomeRouter.tsx` | Client router: shows `ClubOverview` or `MatchesView` based on `?ageGroup` |
| `components/ClubOverview.tsx` | Landing page: age-group cards for all Nesodden teams, sync button |
| `components/MatchesView.tsx` | Per-age-group view: team tabs, sorted match list |
| `components/MatchCard.tsx` | Individual match: result display, lazy-loads kamptropp on expand |
| `components/CrossTeamPlayers.tsx` | Player sharing detection across Nesodden teams and opponent sibling teams |
| `components/PlayerList.tsx` | Grouped squad list with position badges and match event icons (goals, cards) |
| `components/TeamEmblem.tsx` | Club logo image with 2-letter initials fallback |

### Playwright Projects

| Project | File | Notes |
|---------|------|-------|
| `fiks-setup` | `fiks-auth.setup.ts` | Must run first; saves `.auth/fiks.json` |
| `app-ui` | `app.spec.ts` | UI smoke tests; needs dev server running |
| `data-accuracy` | `accuracy.spec.ts` | Compares app vs FIKS; depends on fiks-setup |
| `sync` | `fiks-sync.spec.ts` | The data sync worker; depends on fiks-setup |
| `sync-fresh` | `fiks-sync.spec.ts` | Same sync worker but skips re-auth (reuses existing `.auth/fiks.json`) |
| `kamptropp` | `kamptropp.spec.ts` | Verifies real squad data for G16-1 vs Grüner (11.04.2026, matchReportId=8977342) |
| `cross-team` | `cross-team.spec.ts` | CrossTeamPlayers logic; all API calls mocked — no FIKS credentials needed |

All projects run with `workers: 1` (sequential) because FIKS sessions cannot be shared across parallel browser contexts.

### Constants to Know

- Nesodden club ID: `'82'` (used in `MatchCard` and sync to identify Nesodden's side)
- G16 team FIKS IDs: G16-1 = `134742`, G16-2 = `6895`, G16-3 = `154500`
- App port: `3210`
- Opponent squad lookback: 60 days (only past matches within this window get squad scraping)
