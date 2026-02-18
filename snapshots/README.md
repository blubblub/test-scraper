# HTML Snapshots

Save HTML snapshots of avto.net pages here for offline selector development.

## How to save snapshots

Cloudflare blocks automated access. Save pages manually from a real browser:

1. Open Chrome, navigate to avto.net
2. Find a search results page → Right-click → "Save as" → "Webpage, HTML Only"
3. Save as `search-1.html`, `search-2.html`, etc.
4. Open 3-5 individual listing detail pages → Save each as `detail-1.html`, `detail-2.html`, etc.
5. Commit and push

Or use the automated script (may be blocked by Cloudflare):
```bash
npm run snapshot
```

## Testing selectors offline

Once you have HTML files here, test selectors against them:
```bash
npm run test-selectors
```

This loads each snapshot and runs the current detail/search selectors, reporting which fields are populated vs null.

## Files

- `search-*.html` — Search results pages
- `detail-*.html` — Individual listing detail pages
- `.gitkeep` — Keeps this directory in git
