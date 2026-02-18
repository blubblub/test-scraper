import { createPlaywrightRouter, Dataset, type Log } from 'crawlee';
import type { Page } from 'playwright';
import { CrawlerStats } from './stats.js';

export const stats = new CrawlerStats(
    // Will be replaced with actual log instance at runtime
    { info: console.log, warning: console.warn, error: console.error } as unknown as Log,
);

export const router = createPlaywrightRouter();

/**
 * Extract listing URLs from a search results page.
 * avto.net listing links contain "/Ads/details.asp" in the href.
 */
async function extractListingUrls(page: Page): Promise<string[]> {
    // Multiple selector strategies for resilience
    const urls = await page.$$eval(
        [
            // Primary: direct links to detail pages
            'a[href*="/Ads/details.asp"]',
            // Fallback: links within result containers
            '.ResultsAd a[href*="details.asp"]',
            '.GO-Results-Ede a[href*="details.asp"]',
        ].join(', '),
        (links) => {
            const hrefs = links.map((a) => (a as HTMLAnchorElement).href);
            // Deduplicate within the page
            return [...new Set(hrefs)];
        },
    );

    return urls.filter((url) => url.includes('details.asp'));
}

/**
 * Check if there's a next page and return its URL, or null.
 * avto.net uses various pagination patterns.
 */
async function getNextPageUrl(page: Page, log: Log): Promise<string | null> {
    // Try multiple pagination selectors
    const nextPageSelectors = [
        // "Naslednja" = "Next" in Slovenian
        'a:has-text("Naslednja")',
        'a:has-text("naslednja")',
        // Page navigation arrows
        'a.Stranx:last-of-type',
        // Generic next page patterns
        '.pagination a:last-child',
        'a[title*="nasledn"]',
        // The ">>" or ">" next button
        'a:has-text("»")',
        'a:has-text(">")',
    ];

    for (const selector of nextPageSelectors) {
        try {
            const nextLink = await page.$(selector);
            if (nextLink) {
                const href = await nextLink.getAttribute('href');
                if (href) {
                    // Resolve relative URL
                    const absoluteUrl = new URL(href, page.url()).toString();
                    log.info(`Found next page: ${absoluteUrl}`);
                    return absoluteUrl;
                }
            }
        } catch {
            // Selector didn't match, try next
        }
    }

    log.info('No next page found — reached last page');
    return null;
}

/**
 * Shared handler for search results pages (both initial and paginated).
 */
async function handleSearchResults(
    { page, enqueueLinks, log, request }: {
        page: Page;
        enqueueLinks: Parameters<Parameters<typeof router.addDefaultHandler>[0]>[0]['enqueueLinks'];
        log: Log;
        request: { url: string; userData: Record<string, unknown> };
    },
): Promise<void> {
    const pageNum = (request.userData['pageNum'] as number) || 1;
    log.info(`Processing search results page ${pageNum}: ${request.url}`);

    // Wait for results to load (Cloudflare might delay)
    try {
        await page.waitForSelector(
            'a[href*="details.asp"], .ResultsAd, .GO-Results-498',
            { timeout: 30_000 },
        );
    } catch {
        log.warning('Timeout waiting for results — page might be empty or blocked');
        stats.recordError();
        return;
    }

    // Extract listing URLs
    const listingUrls = await extractListingUrls(page);
    const newUrls = stats.deduplicateUrls(listingUrls);

    log.info(`Page ${pageNum}: found ${listingUrls.length} listings (${newUrls.length} new)`);
    stats.recordPage(listingUrls.length);

    // Enqueue new listing URLs for detail scraping
    if (newUrls.length > 0) {
        await enqueueLinks({
            urls: newUrls,
            label: 'DETAIL',
        });
        stats.recordEnqueued(newUrls.length);
    }

    // Find and enqueue next page
    const nextPageUrl = await getNextPageUrl(page, log);
    if (nextPageUrl) {
        await enqueueLinks({
            urls: [nextPageUrl],
            label: 'LIST',
            userData: { pageNum: pageNum + 1 },
        });
    }
}

// Default handler — first search results page
router.addDefaultHandler(async (context) => {
    await handleSearchResults({
        page: context.page,
        enqueueLinks: context.enqueueLinks,
        log: context.log,
        request: context.request,
    });
});

// Handler for subsequent paginated search results
router.addHandler('LIST', async (context) => {
    await handleSearchResults({
        page: context.page,
        enqueueLinks: context.enqueueLinks,
        log: context.log,
        request: context.request,
    });
});

// Handler for individual listing detail pages
// (Stub — will be fully implemented in Issue #3)
router.addHandler('DETAIL', async ({ page, log, request }) => {
    log.info(`Processing listing: ${request.url}`);

    const title = await page.title();

    await Dataset.pushData({
        url: request.url,
        title,
        scrapedAt: new Date().toISOString(),
    });
});
