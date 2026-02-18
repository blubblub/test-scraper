/**
 * save-snapshots.ts
 *
 * Fetches avto.net search results and detail pages, saving full HTML
 * for offline selector development. Designed to run with xvfb-run
 * in headed mode to bypass Cloudflare Turnstile.
 *
 * Usage: xvfb-run npx tsx scripts/save-snapshots.ts
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const SNAPSHOT_DIR = join(import.meta.dirname ?? '.', '..', 'snapshots');
mkdirSync(SNAPSHOT_DIR, { recursive: true });

const SEARCH_URLS = [
    'https://www.avto.net/Ads/results.asp?zession=&Pession=&Type=&Maker=&MakerN=&Model=&ModelN=&Category=1&SO=&GO=&NOC=&NOS=&NOV=&VOL=&KW=&CY=&FT=&TT=&BT=&SY=&ST=&EY=&ET=&AAession=&Kession=&Ession=&FY=&FT2=&TO=&TDO=&TOO=&Ession2=&ModelT=&AI=&AO=&Red=0&Q=&A=&Jession=&ESSION_TAB=&UESSION_TAB=',
    'https://www.avto.net/Ads/results.asp?zession=&Pession=&Type=&Maker=&MakerN=&Model=&ModelN=&Category=1&SO=&GO=&NOC=&NOS=&NOV=&VOL=&KW=&CY=&FT=&TT=&BT=&SY=&ST=&EY=&ET=&AAession=&KSession=&Ession=&FY=&FT2=&TO=&TDO=&TOO=&Ession2=&ModelT=&AI=&AO=&Red=0&Q=&A=&JSession=&ESSION_TAB=&UESSION_TAB=&stession=2',
];

function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

async function main() {
    console.log('Launching browser (headed mode for Cloudflare bypass)...');

    const browser = await chromium.launch({
        headless: false,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1080',
        ],
    });

    const context = await browser.newContext({
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'sl-SI',
        timezoneId: 'Europe/Ljubljana',
    });

    // Remove webdriver flag
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        // @ts-ignore
        delete navigator.__proto__.webdriver;
        // Fake plugins
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5],
        });
        Object.defineProperty(navigator, 'languages', {
            get: () => ['sl', 'en-US', 'en'],
        });
    });

    const page = await context.newPage();

    // Collect detail URLs from search pages
    const detailUrls: string[] = [];

    for (let i = 0; i < SEARCH_URLS.length; i++) {
        const url = SEARCH_URLS[i];
        console.log(`\n--- Fetching search page ${i + 1}: ${url.substring(0, 80)}...`);

        try {
            await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
            // Wait extra for Cloudflare challenge
            await delay(15_000);

            const html = await page.content();
            const filename = `search-${i + 1}.html`;
            writeFileSync(join(SNAPSHOT_DIR, filename), html, 'utf-8');
            console.log(`Saved ${filename} (${(html.length / 1024).toFixed(0)} KB)`);

            // Extract detail links
            const links = await page.$$eval(
                'a[href*="/Ads/details.asp"], a[href*="details.asp"]',
                (els) => els.map((a) => (a as HTMLAnchorElement).href),
            );
            const unique = [...new Set(links)].filter((l) => l.includes('details.asp'));
            console.log(`Found ${unique.length} detail links`);
            detailUrls.push(...unique);
        } catch (e) {
            console.error(`Failed to fetch search page ${i + 1}:`, e);
            // Save whatever we have
            try {
                const html = await page.content();
                writeFileSync(join(SNAPSHOT_DIR, `search-${i + 1}-partial.html`), html, 'utf-8');
                console.log(`Saved partial HTML for search-${i + 1}`);
            } catch {}
        }

        if (i < SEARCH_URLS.length - 1) {
            const wait = 10_000 + Math.random() * 5_000;
            console.log(`Waiting ${(wait / 1000).toFixed(1)}s...`);
            await delay(wait);
        }
    }

    // Fetch detail pages (up to 5)
    const detailsToFetch = [...new Set(detailUrls)].slice(0, 5);
    console.log(`\nWill fetch ${detailsToFetch.length} detail pages`);

    for (let i = 0; i < detailsToFetch.length; i++) {
        const url = detailsToFetch[i];
        console.log(`\n--- Fetching detail ${i + 1}: ${url.substring(0, 100)}...`);

        const wait = 10_000 + Math.random() * 10_000;
        console.log(`Waiting ${(wait / 1000).toFixed(1)}s before request...`);
        await delay(wait);

        try {
            await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
            await delay(10_000);

            const html = await page.content();
            const filename = `detail-${i + 1}.html`;
            writeFileSync(join(SNAPSHOT_DIR, filename), html, 'utf-8');
            console.log(`Saved ${filename} (${(html.length / 1024).toFixed(0)} KB)`);
        } catch (e) {
            console.error(`Failed to fetch detail ${i + 1}:`, e);
            try {
                const html = await page.content();
                writeFileSync(join(SNAPSHOT_DIR, `detail-${i + 1}-partial.html`), html, 'utf-8');
            } catch {}
        }
    }

    await browser.close();
    console.log('\nDone! Snapshots saved to snapshots/');
}

main().catch((e) => {
    console.error('Fatal error:', e);
    process.exit(1);
});
