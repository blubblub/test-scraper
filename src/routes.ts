import { createPlaywrightRouter, Dataset } from 'crawlee';

export const router = createPlaywrightRouter();

// Default handler for search results pages
router.addDefaultHandler(async ({ page, enqueueLinks, log }) => {
    log.info(`Processing search results: ${page.url()}`);

    // Extract listing URLs from search results
    const listingLinks = await page.$$eval(
        'a[href*="/Ads/details.asp"]',
        (links) => links.map((a) => (a as HTMLAnchorElement).href),
    );

    log.info(`Found ${listingLinks.length} listing links`);

    // Enqueue individual listing pages
    await enqueueLinks({
        urls: listingLinks,
        label: 'DETAIL',
    });

    // Handle pagination - find next page link
    await enqueueLinks({
        selector: 'a.Stranx',
        label: 'LIST',
    });
});

// Handler for individual listing detail pages
router.addHandler('DETAIL', async ({ page, log }) => {
    log.info(`Processing listing detail: ${page.url()}`);

    const title = await page.title();

    // Basic data extraction - will be expanded in Issue #3
    await Dataset.pushData({
        url: page.url(),
        title,
        scrapedAt: new Date().toISOString(),
    });
});

// Handler for paginated search results
router.addHandler('LIST', async ({ page, enqueueLinks, log }) => {
    log.info(`Processing search results page: ${page.url()}`);

    const listingLinks = await page.$$eval(
        'a[href*="/Ads/details.asp"]',
        (links) => links.map((a) => (a as HTMLAnchorElement).href),
    );

    log.info(`Found ${listingLinks.length} listing links`);

    await enqueueLinks({
        urls: listingLinks,
        label: 'DETAIL',
    });

    await enqueueLinks({
        selector: 'a.Stranx',
        label: 'LIST',
    });
});
