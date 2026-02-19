import { PlaywrightCrawler } from 'crawlee';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const SNAPSHOT_DIR = join(import.meta.dirname ?? '.', 'snapshots');
mkdirSync(SNAPSHOT_DIR, { recursive: true });

let pageCount = 0;
const MAX_PAGES = 4; // 1 search + 3 detail

const crawler = new PlaywrightCrawler({
    headless: true,
    maxConcurrency: 1,
    navigationTimeoutSecs: 60,
    requestHandlerTimeoutSecs: 120,
    maxRequestRetries: 3,
    launchContext: {
        launchOptions: {
            args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
        },
    },
    async requestHandler({ page, request, log }) {
        // Wait for real content (not Cloudflare challenge)
        await page.waitForTimeout(8000);
        const title = await page.title();
        log.info(`Page: ${title} — ${request.url}`);
        
        if (title.includes('moment') || title.includes('Cloudflare')) {
            log.warning('Still on Cloudflare challenge, waiting longer...');
            await page.waitForTimeout(15000);
        }
        
        const html = await page.content();
        pageCount++;
        
        if (request.label === 'SEARCH') {
            const fname = `search-${pageCount}.html`;
            writeFileSync(join(SNAPSHOT_DIR, fname), html);
            log.info(`Saved ${fname} (${html.length} bytes)`);
            
            // Extract first 3 detail links
            const links = await page.$$eval('a[href*="details.asp"], a.stretched-link', 
                (els) => els.map(a => (a as HTMLAnchorElement).href).filter(h => h.includes('details')).slice(0, 3)
            );
            log.info(`Found ${links.length} detail links`);
            for (const link of links) {
                await crawler.addRequests([{ url: link, label: 'DETAIL' }]);
            }
        } else {
            const fname = `detail-${pageCount}.html`;
            writeFileSync(join(SNAPSHOT_DIR, fname), html);
            log.info(`Saved ${fname} (${html.length} bytes)`);
        }
        
        // Long delay
        await page.waitForTimeout(7000);
    },
});

await crawler.run([{
    url: 'https://www.avto.net/Ads/results.asp?zession=&Type=&Maker=&Model=&PriceFrom=&PriceTo=&YearFrom=2020&YearTo=&ShowAs=&KmFrom=&KmTo=100000&FuelType=&resultsPerPage=10',
    label: 'SEARCH',
}]);

console.log(`Done. Saved ${pageCount} pages.`);
