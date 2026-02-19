# CLAUDE.md — Project Context

## Project: avto.net Scraper
Web scraper for avto.net car listings using Crawlee + Playwright.

## Tech Stack
- **Runtime:** Node.js, TypeScript (ES2022 modules)
- **Scraping:** Crawlee (PlaywrightCrawler), Playwright + Chrome
- **Platform:** Apify-compatible (Dockerfile included)

## Structure
```
/src/main.ts     — Crawler entry point, config
/src/routes.ts   — Request handlers (search results + detail pages)
```

## Key Commands
- `npx tsc` — Build TypeScript
- `node dist/main.js` — Run scraper
- `npx ts-node --esm src/main.ts` — Run directly

## Target Site
- avto.net — Slovenian car marketplace
- Search results: `https://www.avto.net/Ads/results.asp?...`
- Listing details: `https://www.avto.net/Ads/details.asp?...`
- Behind Cloudflare — requires Playwright with real Chrome

## Anti-Detection Guide
See `docs/ANTI-DETECTION.md` for comprehensive anti-detection techniques (Cloudflare bypass, fingerprinting, proxy strategies, Camoufox, SessionPool config, etc.)

## Conventions
- ESM modules (import/export)
- Strict TypeScript
- Crawlee router pattern for different page types
