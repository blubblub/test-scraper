import { PlaywrightCrawler, Dataset, Log, LogLevel } from 'crawlee';
import { router, stats, setMaxDetails } from './routes.js';
import { buildSearchUrl, loadFiltersFromEnv, loadCrawlerConfig } from './config.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const log = new Log({ level: LogLevel.INFO });
const config = loadCrawlerConfig();
const filters = loadFiltersFromEnv();

// Configure detail scraping limit
setMaxDetails(config.maxDetails);

// Build start URL with any configured filters
const startUrl = buildSearchUrl(filters);
log.info(`Starting crawl from: ${startUrl}`);
log.info(`Config: maxRequests=${config.maxRequests}, maxDetails=${config.maxDetails}, concurrency=${config.maxConcurrency}, delay=${config.minDelayMs}-${config.maxDelayMs}ms`);

if (Object.values(filters).some(Boolean)) {
    log.info(`Active filters: ${JSON.stringify(filters)}`);
}

const crawler = new PlaywrightCrawler({
    requestHandler: router,

    // Safety limit on total requests
    maxRequestsPerCrawl: config.maxRequests,

    // Rate limiting — single concurrency + delays to be respectful
    maxConcurrency: config.maxConcurrency,
    maxRequestRetries: config.maxRetries,

    // Timeouts
    requestHandlerTimeoutSecs: config.requestHandlerTimeoutSecs,
    navigationTimeoutSecs: config.navigationTimeoutSecs,

    // Browser config — Chrome with stealth for Cloudflare
    headless: config.headless,
    launchContext: {
        launchOptions: {
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
            ],
        },
    },

    // Pre-navigation hook: add random delay for rate limiting
    preNavigationHooks: [
        async (_context, _goToOptions) => {
            const delay = config.minDelayMs + Math.random() * (config.maxDelayMs - config.minDelayMs);
            log.info(`Waiting ${Math.round(delay)}ms before next request...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
        },
    ],

    // Failed request handler
    failedRequestHandler: async ({ request }, error) => {
        log.error(`Request failed: ${request.url} — ${error.message}`);
        stats.recordError();
    },
});

try {
    await crawler.run([startUrl]);
} finally {
    // Always print summary
    const summary = stats.getSummary();
    log.info('=== Crawl Complete ===');
    log.info(`Pages processed: ${summary.pagesProcessed}`);
    log.info(`Listings found: ${summary.listingsFound}`);
    log.info(`Unique URLs: ${summary.uniqueUrls}`);
    log.info(`Listings enqueued: ${summary.listingsEnqueued}`);
    log.info(`Details scraped: ${summary.detailsScraped}`);
    log.info(`Errors: ${summary.errors}`);
    log.info(`Time: ${summary.elapsedSeconds.toFixed(1)}s`);

    // Merge search listings with detail data and output combined JSON
    await mergeAndExport(log);
}

/**
 * Post-crawl: read all dataset items, merge search listings with detail data
 * by listing ID, and write combined JSON output.
 */
async function mergeAndExport(log: Log): Promise<void> {
    const dataset = await Dataset.open();
    const { items } = await dataset.getData();

    const searchListings = items.filter((i) => i.label === 'search-listing');
    const detailPages = items.filter((i) => i.url && !i.label);

    log.info(`Merging ${searchListings.length} search listings with ${detailPages.length} detail pages`);

    // Index detail data by listing ID
    const detailMap = new Map<string, Record<string, unknown>>();
    for (const detail of detailPages) {
        const id = detail.listingId as string;
        if (id) detailMap.set(id, detail);
    }

    // Build combined output: search listing enriched with detail data
    const combined: Record<string, unknown>[] = [];
    for (const listing of searchListings) {
        const id = listing.listingId as string;
        const detail = id ? detailMap.get(id) : undefined;

        if (detail) {
            // Merge detail data into listing (detail fields override search summary)
            combined.push({
                ...listing,
                ...detail,
                // Preserve search-level fields that detail doesn't have
                searchPage: listing.searchPage,
                thumbnail: listing.thumbnail,
            });
            detailMap.delete(id);
        } else {
            // No detail page scraped — include search summary only
            combined.push({ ...listing, detailScraped: false });
        }
    }

    // Include any detail pages not matched to a search listing
    for (const detail of detailMap.values()) {
        combined.push(detail);
    }

    // Write output
    const outDir = process.env.OUTPUT_DIR || 'output';
    mkdirSync(outDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outPath = join(outDir, `listings-${timestamp}.json`);

    writeFileSync(outPath, JSON.stringify(combined, null, 2));
    log.info(`✅ Combined output: ${combined.length} listings → ${outPath}`);
    log.info(`   ${searchListings.length} from search, ${detailPages.length} with full details`);
}
