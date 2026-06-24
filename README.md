# Nesodden IF — Kampoversikt

Next.js 15-app som viser kampprogram, kamptropper og statistikk for Nesodden IF sine ungdomslag. Data hentes fra [fiks.fotball.no](https://fiks.fotball.no) via Playwright-automatisering og caches lokalt.

## Funksjoner

- **Kampprogram** — kommende og spilte kamper for alle aldersgrupper (G12+, J12+)
- **Kamptropper** — spillerlister for begge lag, hentet fra FIKS og fotball.no
- **Spillerdeling** — detekterer spillere som har spilt for søsterlag (Nesodden og motstandere), med nivå-indikator (høyere/lavere divisjon)
- **Statistikk** — tabellstand, toppscorere og kortstatistikk per turnering
- **Klubbemblemer** — automatiske logoer fra fotball.no med initialer som fallback

## Forutsetninger

- Node.js 18+
- FIKS-konto med tilgang til Nesodden IF sine lag

## Oppsett

```bash
npm install
npx playwright install chromium

# Opprett .env.test med FIKS-innlogging (se .env.test.example)
cp .env.test.example .env.test
# Rediger .env.test med dine FIKS-credentials
```

## Kjøring

```bash
# Synkroniser data fra FIKS (krever .env.test)
npm run sync

# Start utviklingsserver (port 3210)
npm run dev

# Produksjon
npm run build
npm run start
```

## Nattlig sync

Et cron-script kjører sync automatisk:

```bash
# Legg til i crontab (crontab -e):
3 3 * * * /path/to/scripts/nightly-sync.sh
```

Scriptet synkroniserer data, bygger appen og redeploy-er automatisk.

## Dataflyt

1. **Synced data** — `data/`-katalogen (gitignored), skrevet av `npm run sync`
2. **Live scrape** — Axios + Cheerio mot fotball.no for standings og squad-fallback
3. API-er returnerer et `source`-felt (`synced` | `scraped`) slik at klienten vet datakilden

## Tester

```bash
npm test                  # UI smoke tests
npm run test:cross-team   # Spillerdeling-logikk (mocka, ingen FIKS-creds)
npm run test:accuracy     # Sammenligner app-data mot FIKS
npm run test:all          # Alle Playwright-prosjekter
```

## Tech stack

- **Next.js 15** — App Router, React Server Components
- **Playwright** — FIKS-scraping (autentisert) og E2E-testing
- **Cheerio** — fotball.no-scraping (offentlig, ingen auth)
- **Tailwind CSS** — styling
- **TypeScript** — hele kodebasen

## Lisens

Privat prosjekt for Nesodden IF.
