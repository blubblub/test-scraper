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
// Selectors verified against real avto.net DOM (2026-02-18)
router.addHandler('DETAIL', async ({ page, log, request }) => {
    log.info(`Processing listing: ${request.url}`);

    // Wait for detail page — try spec table variants, then any table, then heading
    try {
        await page.waitForSelector('table.table-sm, table, .container h3', { timeout: 30_000 });
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
 * Selectors based on real avto.net DOM inspection (Bootstrap 4 layout).
 */
async function extractListingDetails(page: Page, log: Log): Promise<Record<string, unknown>> {
    const data: Record<string, unknown> = {};

    // Title — avto.net uses a plain h3 (no class) for the listing title
    data.title = await safeText(page, ['h3']);

    // Price — current price is in span inside .h2.font-weight-bold.text-danger
    // Old/crossed-out price is in .h2.GO-OglasDataStaraCena
    data.price = await extractPrice(page);

    // Description — text before the spec tables, often in a card body
    // avto.net puts the short description as plain text (e.g. "E-PERFORMANCE 2.0D + ...")
    data.description = await extractDescription(page);

    // Main technical specs from table.table-sm rows
    const specs = await extractSpecTable(page, log);
    Object.assign(data, specs);

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
 * Real DOM: current price span is inside an element with classes
 * "h2 font-weight-bold text-danger mb-3". Old price uses "GO-OglasDataStaraCena".
 */
async function extractPrice(page: Page): Promise<Record<string, string | null>> {
    const result: Record<string, string | null> = { current: null, original: null };

    // Primary: find <!-- PRICE --> comment anchor and read the following sibling div
    try {
        const priceFromComment = await page.evaluate(() => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
            let node: Node | null;
            while ((node = walker.nextNode())) {
                if ((node.nodeValue ?? '').trim().includes('PRICE')) {
                    let sibling = node.nextSibling;
                    while (sibling) {
                        if (sibling.nodeType === Node.ELEMENT_NODE) {
                            const text = (sibling as Element).textContent?.trim() ?? '';
                            if (text) return text;
                        }
                        sibling = sibling.nextSibling;
                    }
                }
            }
            return null;
        });
        if (priceFromComment?.includes('€')) result.current = priceFromComment;
    } catch { /* skip */ }

    // Fallback: parse card-body sections for regular and financing prices
    if (!result.current) {
        try {
            const prices = await page.evaluate(() => {
                const res: Record<string, string | null> = { current: null, original: null };
                // Find price spans in h1/h2 elements within card-body
                const priceEls = document.querySelectorAll('.card-body .h2 span, .card-body .h1 span');
                const priceTexts: string[] = [];
                for (const el of priceEls) {
                    const text = el.textContent?.trim() ?? '';
                    if (text.includes('€')) priceTexts.push(text);
                }
                // Deduplicate (mobile + desktop show same prices)
                const unique = [...new Set(priceTexts)];
                if (unique.length >= 2) {
                    // First = regular price, second = financing/discounted price
                    res.original = unique[0];
                    res.current = unique[1];
                } else if (unique.length === 1) {
                    res.current = unique[0];
                }
                return res;
            });
            if (prices.current) result.current = prices.current;
            if (prices.original) result.original = prices.original;
        } catch { /* skip */ }
    }

    // Final fallback: any price-like span
    if (!result.current) {
        try {
            const priceEl = await page.$('.font-weight-bold span');
            if (priceEl) {
                const text = await priceEl.textContent();
                if (text?.includes('€')) result.current = text.trim();
            }
        } catch { /* skip */ }
    }

    return result;
}

/**
 * Extract the description text.
 * On avto.net, the description appears as text content between the title/price
 * area and the spec tables — usually a short line like
 * "E-PERFORMANCE 2.0D + ZNANA SERVISNA ZGODOVINA + ..."
 */
async function extractDescription(page: Page): Promise<string | null> {
    try {
        // The description is often in the text content near icon rows,
        // appearing after the quick-stats icons and before "Osnovni podatki"
        const desc = await page.evaluate(() => {
            // Look for text nodes in the main content area that contain the description
            // Try table.table-sm first, then any generic table
            let firstTable = document.querySelector('table.table-sm') ??
                document.querySelector('table');
            if (!firstTable) return null;

            // Walk backwards from first table to find substantial text
            let el = firstTable.previousElementSibling;
            while (el) {
                const text = el.textContent?.trim() ?? '';
                // Skip empty, short labels, and "Osnovni podatki"
                if (text.length > 30 && !text.startsWith('Osnovni podatki')) {
                    return text;
                }
                el = el.previousElementSibling;
            }
            return null;
        });
        return desc;
    } catch {
        return null;
    }
}

/**
 * Extract spec table key/value pairs.
 * avto.net uses table.table-sm with rows containing tab-separated label:\tvalue.
 * First table is "Osnovni podatki" (basic info), others are fuel/equipment.
 */
async function extractSpecTable(page: Page, log: Log): Promise<Record<string, string | null>> {
    const specs: Record<string, string | null> = {};

    // Map Slovenian labels to our field names
    const labelMap: Record<string, string> = {
        'Starost': 'condition',
        'Leto proizvodnje': 'year',
        'Prva registracija': 'firstRegistration',
        'Prevoženi km': 'mileage',
        'Tehnični pregled velja do': 'technicalInspection',
        'Gorivo': 'fuelType',
        'Motor': 'engine',
        'Menjalnik': 'transmission',
        'Oblika': 'bodyType',
        'Št.vrat': 'doors',
        'Barva': 'colorExterior',
        'Notranjost': 'colorInterior',
        'VIN / številka šasije': 'vin',
        'Kraj ogleda': 'viewingLocation',
        'Kombinirana vožnja': 'fuelConsumption',
        'Emisijski razred': 'emissionClass',
        'Emisija CO2': 'co2Emissions',
    };

    // Primary: find <!-- DATA --> comment anchor and read the following sibling table
    // That table uses <th> for labels and <td> for values
    let usedCommentAnchor = false;
    try {
        const rowsFromComment = await page.evaluate(() => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
            let node: Node | null;
            while ((node = walker.nextNode())) {
                if ((node.nodeValue ?? '').trim().includes('DATA')) {
                    let sibling = node.nextSibling;
                    while (sibling) {
                        if (sibling.nodeType === Node.ELEMENT_NODE &&
                            (sibling as Element).tagName === 'TABLE') {
                            const table = sibling as HTMLTableElement;
                            const pairs: Array<[string, string]> = [];
                            for (const row of table.querySelectorAll('tr')) {
                                const th = row.querySelector('th');
                                const td = row.querySelector('td');
                                if (th && td) {
                                    const label = th.textContent?.trim().replace(/:\s*$/, '') ?? '';
                                    const value = td.textContent?.trim() ?? '';
                                    if (label && value) pairs.push([label, value]);
                                }
                            }
                            return pairs;
                        }
                        sibling = sibling.nextSibling;
                    }
                }
            }
            return null;
        });

        if (rowsFromComment && rowsFromComment.length > 0) {
            usedCommentAnchor = true;
            for (const [rawLabel, value] of rowsFromComment) {
                let fieldName = labelMap[rawLabel];
                if (!fieldName) {
                    for (const [key, name] of Object.entries(labelMap)) {
                        if (rawLabel.includes(key) || key.includes(rawLabel)) {
                            fieldName = name;
                            break;
                        }
                    }
                }
                if (fieldName && value) specs[fieldName] = value;
            }
        }
    } catch (e) {
        log.warning(`Failed to extract spec table via comment anchor: ${e}`);
    }

    // Fallback: table.table-sm with two <td> cells per row
    if (!usedCommentAnchor) {
        try {
            const rows = await page.$$('table.table-sm tr');

            for (const row of rows) {
                try {
                    const th = await row.$('th');
                    const td = await row.$('td');
                    if (th && td) {
                        const rawLabel = (await th.textContent())?.trim().replace(/:\s*$/, '') ?? '';
                        const value = (await td.textContent())?.trim() ?? '';

                        if (!rawLabel || !value) continue;

                        let fieldName = labelMap[rawLabel];

                        if (!fieldName) {
                            for (const [key, name] of Object.entries(labelMap)) {
                                if (rawLabel.includes(key) || key.includes(rawLabel)) {
                                    fieldName = name;
                                    break;
                                }
                            }
                        }

                        if (fieldName && value) specs[fieldName] = value;
                    }
                } catch { /* skip row */ }
            }
        } catch (e) {
            log.warning(`Failed to extract spec table via CSS selector: ${e}`);
        }
    }

    return specs;
}

/**
 * Extract equipment/extras list.
 * avto.net puts equipment in the 4th table.table-sm under categorized sections
 * like "Podvozje:", "Varnost:", "Notranjost:" with items as text nodes.
 */
async function extractEquipment(page: Page): Promise<string[]> {
    const equipment: string[] = [];

    try {
        // Equipment items are in table cells, often as line-separated text
        const items = await page.evaluate(() => {
            const tables = document.querySelectorAll('table.table-sm');
            const results: string[] = [];

            // The equipment table is typically the one with "Oprema" in its header
            for (const table of tables) {
                const headerText = table.querySelector('tr:first-child')?.textContent ?? '';
                if (headerText.includes('Oprema') || headerText.includes('oprema')) {
                    // Extract all text content from cells
                    const cells = table.querySelectorAll('td');
                    for (const cell of cells) {
                        const text = cell.textContent?.trim() ?? '';
                        // Split multi-line items
                        const lines = text.split('\n')
                            .map(l => l.trim())
                            .filter(l => l.length > 2 && !l.endsWith(':'));
                        results.push(...lines);
                    }
                }
            }

            return results;
        });

        equipment.push(...items);
    } catch { /* no equipment */ }

    return [...new Set(equipment)].filter(Boolean);
}

/**
 * Extract all image URLs from the listing.
 * avto.net uses GO-OglasPhoto/GO-OglasThumb classes and images.avto.net domain.
 */
async function extractImages(page: Page): Promise<string[]> {
    const images: string[] = [];

    try {
        const imgUrls = await page.$$eval(
            [
                '#BigPhoto img',
                '.GO-OglasPhoto img',
                '.GO-OglasThumb img',
                'img[src*="images.avto.net"]',
            ].join(', '),
            (imgs) => imgs.map((img) => {
                const src = (img as HTMLImageElement).src ||
                    img.getAttribute('data-src') ||
                    img.getAttribute('data-full') || '';
                return src;
            }).filter(Boolean),
        );

        images.push(...imgUrls);

        // Also check for full-size zoom links
        const zoomLinks = await page.$$eval(
            '.GO-OglasZoom a[href*="images.avto.net"], .GO-OglasZoomBlack[href*="images.avto.net"]',
            (links) => links.map((a) => (a as HTMLAnchorElement).href).filter(Boolean),
        );
        images.push(...zoomLinks);
    } catch { /* no images */ }

    // Deduplicate and prefer full-size images
    return [...new Set(images)].map((url) =>
        url.replace(/\/small\//g, '/big/').replace(/\/thumb\//g, '/big/'),
    );
}

/**
 * Extract seller information.
 * avto.net uses card layout with fa-* icons for seller details.
 * Location is in "Kraj ogleda" spec field. Phone uses fa-phone-square icon.
 */
async function extractSellerInfo(page: Page): Promise<Record<string, string | null>> {
    const seller: Record<string, string | null> = {
        name: null,
        type: null,
        location: null,
        phone: null,
    };

    try {
        // Seller info is typically in a card with fa-user icon
        // The seller name/link is near dealer branding or in the card footer area
        const sellerData = await page.evaluate(() => {
            const result: Record<string, string | null> = {
                name: null, type: null, location: null, phone: null,
            };

            // Phone — extract from tel: link href (avoids picking up label text like "PRODAJA VOZIL")
            const telLinks = document.querySelectorAll('a[href^="tel:"]');
            if (telLinks.length > 0) {
                const href = telLinks[0].getAttribute('href') ?? '';
                result.phone = href.replace('tel:', '').trim() || null;
            }

            // Seller name — look for fa-user icon area or card with dealer info
            const userIcon = document.querySelector('.fa-user');
            if (userIcon) {
                const parent = userIcon.closest('.card-body') || userIcon.parentElement;
                const nameEl = parent?.querySelector('a, .font-weight-bold');
                if (nameEl) result.name = nameEl.textContent?.trim() ?? null;
            }

            // Location — from "Kraj ogleda" in specs or fa-map-marker
            const mapIcon = document.querySelector('.fa-map-marker');
            if (mapIcon) {
                const parent = mapIcon.parentElement;
                if (parent) {
                    result.location = parent.textContent?.replace(/^\s*/, '').trim() ?? null;
                }
            }

            // Seller type — check for flaticon-109-car-dealer (dealer) presence
            const dealerIcon = document.querySelector('.flaticon-109-car-dealer');
            result.type = dealerIcon ? 'dealer' : 'private';

            return result;
        });

        Object.assign(seller, sellerData);
    } catch { /* skip */ }

    return seller;
}
