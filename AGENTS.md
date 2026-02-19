# AGENTS.md — Project Context

## Project: avto.net Scraper
Web scraper for avto.net car listings using Crawlee + Playwright.

## Tech Stack
- **Runtime:** Node.js, TypeScript (ES2022 modules)
- **Scraping:** Crawlee (PlaywrightCrawler), Playwright + Chrome
- **Platform:** Apify-compatible (Dockerfile included)

## Key Docs
- `docs/ANTI-DETECTION.md` — Anti-detection techniques (Cloudflare bypass, fingerprinting, proxy strategies, Camoufox, SessionPool, etc.)
- `CLAUDE.md` — Additional project context

## Key Commands
- `npx tsc` — Build TypeScript
- `node dist/main.js` — Run scraper

## Conventions
- ESM modules (import/export)
- Strict TypeScript
- Crawlee router pattern for different page types
