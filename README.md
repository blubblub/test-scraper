# avto.net Scraper

Scraper for avto.net car marketplace using Apify Crawlee + Playwright.

## Tech Stack
- TypeScript
- Crawlee (PlaywrightCrawler)
- Apify SDK
- Playwright (Chrome)

## Setup
```bash
npm install
npm start
```

## What it scrapes
- All car listings from avto.net
- Vehicle details: make, model, year, price, mileage, fuel type, etc.
- Seller info
- Images
- Equipment/extras

## URL Structure
- Search results: `https://www.avto.net/Ads/results.asp?...`
- Listing detail: `https://www.avto.net/Ads/details.asp?id=...`
