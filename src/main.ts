import { PlaywrightCrawler, Log, LogLevel } from 'crawlee';
import { router, stats } from './routes.js';
import { buildSearchUrl, loadFiltersFromEnv, loadCrawlerConfig } from './config.js';

const log = new Log({ level: LogLevel.INFO });
const config = loadCrawlerConfig();
const filters = loadFiltersFromEnv();

// Build start URL with any configured filters
const startUrl = buildSearchUrl(filters);
log.info(`Starting crawl from: ${startUrl}`);
log.info(`Config: maxRequests=${config.maxRequests}, concurrency=${config.maxConcurrency}, delay=${config.minDelayMs}-${config.maxDelayMs}ms`);

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
    log.info(`Errors: ${summary.errors}`);
    log.info(`Time: ${summary.elapsedSeconds.toFixed(1)}s`);
}
