/**
 * save-snapshots-v2.ts
 *
 * Attempt to bypass Cloudflare Turnstile by waiting longer and
 * interacting with the challenge page.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const SNAPSHOT_DIR = join(import.meta.dirname ?? '.', '..', 'snapshots');
mkdirSync(SNAPSHOT_DIR, { recursive: true });

function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

async function waitForCloudflare(page: any, maxWaitSec = 45): Promise<boolean> {
    console.log('  Waiting for Cloudflare challenge to resolve...');
    const start = Date.now();
    while (Date.now() - start < maxWaitSec * 1000) {
        const content = await page.content();
        // If we see actual avto.net content (results or detail page), we're through
        if (content.includes('details.asp') || content.includes('OglasNaslov') || content.includes('ResultsAd') || content.includes('GO-Results')) {
            console.log('  ✅ Cloudflare passed!');
            return true;
        }
        // Try clicking the Turnstile checkbox if visible
        try {
            const frame = page.frames().find((f: any) => f.url().includes('challenges.cloudflare.com'));
            if (frame) {
                const checkbox = await frame.$('input[type="checkbox"], .cb-i');
                if (checkbox) {
                    console.log('  Found Turnstile checkbox, clicking...');
                    await checkbox.click();
                    await delay(5000);
                }
            }
        } catch {}
        await delay(2000);
    }
    console.log('  ❌ Cloudflare challenge not resolved after ' + maxWaitSec + 's');
    return false;
}

async function main() {
    console.log('Launching browser v2 (longer waits, Turnstile interaction)...');

    const browser = await chromium.launch({
        headless: false,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
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

    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5],
        });
        Object.defineProperty(navigator, 'languages', {
            get: () => ['sl', 'en-US', 'en'],
        });
        // Fake chrome object
        // @ts-ignore
        window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
    });

    const page = await context.newPage();

    // First, visit the homepage to get cookies
    console.log('Visiting homepage first to establish session...');
    await page.goto('https://www.avto.net/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // Just wait for Cloudflare to process — homepage won't have our content markers
    console.log('  Waiting 20s for Cloudflare on homepage...');
    await delay(20_000);
    const homeHtml = await page.content();
    const homePassed = !homeHtml.includes('challenge-platform');
    console.log(`  Homepage ${homePassed ? '✅ passed' : '❌ still challenged'} (${(homeHtml.length/1024).toFixed(0)} KB)`);
    await delay(5000);

    const SEARCH_URLS = [
        'https://www.avto.net/Ads/results.asp?zession=&Type=&Maker=&MakerN=&Model=&ModelN=&Category=1&SO=&GO=&NOC=&NOS=&NOV=&VOL=&KW=&CY=&FT=&TT=&BT=&SY=&ST=&EY=&ET=&Red=0&Q=&A=',
    ];

    const detailUrls: string[] = [];

    for (let i = 0; i < SEARCH_URLS.length; i++) {
        const url = SEARCH_URLS[i];
        console.log(`\n--- Search page ${i + 1}`);
        await delay(8000);

        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
            const passed = await waitForCloudflare(page, 60);

            const html = await page.content();
            const filename = passed ? `search-${i + 1}.html` : `search-${i + 1}-cf-blocked.html`;
            writeFileSync(join(SNAPSHOT_DIR, filename), html, 'utf-8');
            console.log(`Saved ${filename} (${(html.length / 1024).toFixed(0)} KB)`);

            if (passed) {
                const links = await page.$$eval(
                    'a[href*="/Ads/details.asp"], a[href*="details.asp"]',
                    (els: HTMLAnchorElement[]) => els.map((a) => a.href),
                );
                const unique = [...new Set(links)].filter((l) => l.includes('details.asp'));
                console.log(`Found ${unique.length} detail links`);
                detailUrls.push(...unique);
            }
        } catch (e) {
            console.error(`Failed:`, e);
        }
    }

    // If we got through, try a second search page via pagination
    if (detailUrls.length > 0) {
        console.log('\nTrying to navigate to page 2 via pagination...');
        await delay(10000);
        try {
            const nextLink = await page.$('a:has-text("Naslednja"), a:has-text("»"), a:has-text("2")');
            if (nextLink) {
                await nextLink.click();
                await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                await waitForCloudflare(page, 60);
                const html = await page.content();
                writeFileSync(join(SNAPSHOT_DIR, 'search-2.html'), html, 'utf-8');
                console.log(`Saved search-2.html (${(html.length / 1024).toFixed(0)} KB)`);
            }
        } catch (e) {
            console.log('Could not get page 2:', e);
        }
    }

    // Fetch detail pages
    const detailsToFetch = [...new Set(detailUrls)].slice(0, 5);
    console.log(`\nWill fetch ${detailsToFetch.length} detail pages`);

    for (let i = 0; i < detailsToFetch.length; i++) {
        const url = detailsToFetch[i];
        console.log(`\n--- Detail ${i + 1}: ${url.substring(0, 100)}...`);

        const wait = 15_000 + Math.random() * 5_000;
        console.log(`Waiting ${(wait / 1000).toFixed(1)}s...`);
        await delay(wait);

        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
            const passed = await waitForCloudflare(page, 60);
            const html = await page.content();
            const filename = passed ? `detail-${i + 1}.html` : `detail-${i + 1}-cf-blocked.html`;
            writeFileSync(join(SNAPSHOT_DIR, filename), html, 'utf-8');
            console.log(`Saved ${filename} (${(html.length / 1024).toFixed(0)} KB)`);
        } catch (e) {
            console.error(`Failed:`, e);
        }
    }

    await browser.close();
    console.log('\nDone!');
}

main().catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
});
