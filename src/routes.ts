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

// Handler for individual listing detail pages (Issue #3)
router.addHandler('DETAIL', async ({ page, log, request }) => {
    log.info(`Processing listing: ${request.url}`);

    // Wait for the detail page to load
    try {
        await page.waitForSelector('.OglasData, .container, .classified-content', { timeout: 30_000 });
    } catch {
        log.warning(`Timeout waiting for detail page content: ${request.url}`);
        stats.recordError();
        return;
    }

    const data = await extractListingDetails(page, log);
    data.url = request.url;
    data.listingId = extractListingId(request.url);
    data.scrapedAt = new Date().toISOString();

    await Dataset.pushData(data);
    log.info(`Scraped listing: ${data.title || 'unknown'} — ${data.price || 'no price'}`);
});

/**
 * Extract listing ID from URL.
 */
function extractListingId(url: string): string {
    const match = url.match(/[?&]id=(\d+)/i);
    return match?.[1] ?? '';
}

/**
 * Extract all vehicle details from a listing detail page.
 */
async function extractListingDetails(page: Page, log: Log): Promise<Record<string, unknown>> {
    const data: Record<string, unknown> = {};

    // Title
    data.title = await safeText(page, [
        'h1',
        '.OglasNaslov',
        '.classified-title h1',
    ]);

    // Price
    data.price = await extractPrice(page);

    // Main technical specs from the table/grid
    const specs = await extractSpecTable(page, log);
    Object.assign(data, specs);

    // Description
    data.description = await safeText(page, [
        '.OglasOpisPolje',
        '.classified-description',
        '#TextContent',
        'div[itemprop="description"]',
    ]);

    // Equipment / extras list
    data.equipment = await extractEquipment(page);

    // Images
    data.images = await extractImages(page);

    // Seller info
    data.seller = await extractSellerInfo(page);

    return data;
}

/**
 * Safely get text content from first matching selector.
 */
async function safeText(page: Page, selectors: string[]): Promise<string | null> {
    for (const sel of selectors) {
        try {
            const el = await page.$(sel);
            if (el) {
                const text = await el.textContent();
                if (text?.trim()) return text.trim();
            }
        } catch { /* skip */ }
    }
    return null;
}

/**
 * Extract price from the page.
 */
async function extractPrice(page: Page): Promise<string | null> {
    const priceSelectors = [
        '.OglasCenaBox',
        '.price',
        'span[itemprop="price"]',
        '.classified-price',
    ];
    const raw = await safeText(page, priceSelectors);
    if (raw) {
        // Clean up: keep digits, dots, commas, and currency symbols
        return raw.replace(/\s+/g, ' ').trim();
    }
    return null;
}

/**
 * Extract spec table key/value pairs.
 * avto.net uses table rows with label + value pairs.
 */
async function extractSpecTable(page: Page, log: Log): Promise<Record<string, string | null>> {
    const specs: Record<string, string | null> = {};

    // Map of Slovenian labels to our field names
    const labelMap: Record<string, string> = {
        'Znamka': 'make',
        'Model': 'model',
        'Tip': 'variant',
        'Leto': 'year',
        '1. registracija': 'firstRegistration',
        'Prva registracija': 'firstRegistration',
        'Prevoženih': 'mileage',
        'Prevoženi km': 'mileage',
        'Kilometri': 'mileage',
        'Gorivo': 'fuelType',
        'Menjalnik': 'transmission',
        'Prostornina motorja': 'engineDisplacement',
        'Motor': 'engineDisplacement',
        'Moč': 'power',
        'Moč motorja': 'power',
        'Oblika': 'bodyType',
        'Karoserija': 'bodyType',
        'Barva': 'colorExterior',
        'Notranjost': 'colorInterior',
        'Barva notranjosti': 'colorInterior',
        'Število vrat': 'doors',
        'Vrata': 'doors',
        'Število lastnikov': 'owners',
        'Lastniki': 'owners',
        'Št. lastnikov': 'owners',
        'VIN': 'vin',
        'Emisijski razred': 'emissionClass',
        'Datum oglasa': 'listingDate',
    };

    try {
        // Try multiple table structures avto.net uses
        const rows = await page.$$([
            '.OglasDetail table tr',
            '.OglasTeh662 table tr',
            '.OglasData table tr',
            '.classified-specs tr',
            'table.table-bordered tr',
        ].join(', '));

        for (const row of rows) {
            try {
                const cells = await row.$$('td, th');
                if (cells.length >= 2) {
                    const label = (await cells[0].textContent())?.trim().replace(/:$/, '') ?? '';
                    const value = (await cells[1].textContent())?.trim() ?? '';

                    const fieldName = labelMap[label];
                    if (fieldName && value) {
                        specs[fieldName] = value;
                    }
                }
            } catch { /* skip row */ }
        }

        // Also try div-based label/value layout
        if (Object.keys(specs).length === 0) {
            const divPairs = await page.$$('.OglasDetail .Podatek, .OglasData .Podatek');
            for (const pair of divPairs) {
                try {
                    const label = await pair.$eval('.Lastnost, .label', (el) => el.textContent?.trim().replace(/:$/, '') ?? '');
                    const value = await pair.$eval('.Vrednost, .value', (el) => el.textContent?.trim() ?? '');
                    const fieldName = labelMap[label];
                    if (fieldName && value) {
                        specs[fieldName] = value;
                    }
                } catch { /* skip */ }
            }
        }
    } catch (e) {
        log.warning(`Failed to extract spec table: ${e}`);
    }

    return specs;
}

/**
 * Extract equipment/extras list.
 */
async function extractEquipment(page: Page): Promise<string[]> {
    const equipment: string[] = [];

    const selectors = [
        '.OglasOprema li',
        '.OglasOpremaBox li',
        '.equipment-list li',
        '.classified-features li',
        '.OglasData .Oprema li',
    ];

    for (const sel of selectors) {
        try {
            const items = await page.$$eval(sel, (els) =>
                els.map((el) => el.textContent?.trim() ?? '').filter(Boolean),
            );
            if (items.length > 0) {
                equipment.push(...items);
                break;
            }
        } catch { /* try next */ }
    }

    return [...new Set(equipment)];
}

/**
 * Extract all image URLs from the listing.
 */
async function extractImages(page: Page): Promise<string[]> {
    const images: string[] = [];

    try {
        // Try multiple image container patterns
        const imgUrls = await page.$$eval(
            [
                '.OglasSlika img',
                '.OglasSlike img',
                '.classified-gallery img',
                '.fotorama img',
                '.rsImg img',
                'img[src*="images.avto.net"]',
                'a[href*="images.avto.net"] img',
            ].join(', '),
            (imgs) => imgs.map((img) => {
                const src = (img as HTMLImageElement).src ||
                    img.getAttribute('data-src') ||
                    img.getAttribute('data-full') || '';
                return src;
            }).filter(Boolean),
        );

        images.push(...imgUrls);

        // Also check for full-size image links
        const fullLinks = await page.$$eval(
            'a[href*="images.avto.net"]',
            (links) => links.map((a) => (a as HTMLAnchorElement).href).filter(Boolean),
        );
        images.push(...fullLinks);
    } catch { /* no images */ }

    // Deduplicate and prefer full-size images
    return [...new Set(images)].map((url) =>
        url.replace(/\/small\//g, '/big/').replace(/\/thumb\//g, '/big/'),
    );
}

/**
 * Extract seller information.
 */
async function extractSellerInfo(page: Page): Promise<Record<string, string | null>> {
    const seller: Record<string, string | null> = {
        name: null,
        type: null,
        location: null,
        phone: null,
    };

    // Seller name
    seller.name = await safeText(page, [
        '.OglasProdajalec a',
        '.OglasProdajalec',
        '.seller-name',
        '.classified-seller-name',
    ]);

    // Determine seller type (dealer vs private)
    try {
        const sellerArea = await page.$('.OglasProdajalec, .seller-info');
        if (sellerArea) {
            const text = (await sellerArea.textContent())?.toLowerCase() ?? '';
            seller.type = text.includes('prodajalec') || text.includes('salon') || text.includes('dealer')
                ? 'dealer' : 'private';
        }
    } catch { /* skip */ }

    // Location
    seller.location = await safeText(page, [
        '.OglasLokacija',
        '.OglasProdajalec .lokacija',
        '.seller-location',
    ]);

    // Phone
    seller.phone = await safeText(page, [
        '.OglasTelefon a',
        '.OglasTelefon',
        '.seller-phone',
        'a[href^="tel:"]',
    ]);

    return seller;
}
